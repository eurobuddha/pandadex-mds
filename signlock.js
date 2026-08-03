/* signlock.js — MiniDapp-wide serial signing gate. Service-only; the page never signs.
 *
 * WHY THIS EXISTS (carried across from the native SignGate.java, because the reason will not
 * survive a refactor otherwise):
 *
 *   Minima signatures are stateful. Each key is a tree of one-time (Winternitz) signatures and the
 *   node picks the next leaf by reading, incrementing and writing a per-key `uses` counter. Two
 *   transactions signing the same key at once both read the same value and both sign the SAME leaf
 *   over DIFFERENT data — a reused one-time signature, which leaks that leaf's private key. This is
 *   not theoretical: 7 of 64 default keys on a live node were confirmed re-used, witness-exact.
 *
 * NO TIMERS. THIS IS NOT NEGOTIABLE.
 *   The MDS service is Rhino. ServiceJSRunner builds the scope with ctx.initStandardObjects() and
 *   injects only `MDS` — there is no setTimeout, no setInterval, no XMLHttpRequest. The first
 *   version of this file called setInterval to start a heartbeat; it threw ReferenceError before
 *   the work function was ever invoked, the gate stayed held, and the app could not sign or post
 *   ANYTHING from 0.2.33 until 0.3.7. MDSJS.sql calls JS callbacks with no try/catch, so the error
 *   vanished upward and the UI simply never changed.
 *   Date.now() is available. Everything time-based here rides L.tick(), which the service calls on
 *   every NEWBLOCK. If you add a timer to this file you will break signing again, silently.
 *
 * TWO LAYERS:
 *   A. An in-process FIFO queue — the load-bearing guard, since the service is the sole signer.
 *   B. A SQL mutex in `sign_lock`, claimed by an INSERT whose primary-key violation IS the
 *      "someone else holds it" signal. It survives a service restart mid-chain, where an in-memory
 *      queue would simply forget. A contended claim is retried from tick() and eventually FAILS the
 *      job with a real error — it must never spin silently, which is how a stale row from a killed
 *      service turned into a five-minute wait with no explanation.
 */
var PandaSignLock = PandaSignLock || {};
(function (L) {

  L.TABLE = "sign_lock";
  L.TTL_MS = 5 * 60 * 1000;          /* a holder that dies without releasing frees itself after this */
  L.HEARTBEAT_MS = 30 * 1000;        /* ...so a live holder must keep saying it is alive */
  L.CLAIM_DEADLINE_MS = 90 * 1000;   /* give up claiming and tell the caller, rather than spin */
  /* Longer than the node's write timeout, so this only fires for a genuinely lost callback and
     never for a chain that is merely slow — proof-of-work on a phone is not quick. */
  L.MAX_HOLD_MS = 200 * 1000;

  var sqlFn = null, QUEUE = [], ACTIVE = null, CLAIMING = false, TOKEN = 0;

  /* Inject MDS.sql once at service boot. Without it the SQL layer is skipped and the in-process
     queue still serialises correctly — which is what the unit tests run against. */
  L.use = function (fn) { sqlFn = typeof fn === "function" ? fn : null; };
  L.busy = function () { return !!ACTIVE; };
  L.queued = function () { return QUEUE.length; };
  /* Test hook only. Drops queued work and forgets the active holder without releasing it. */
  L.reset = function () { QUEUE = []; ACTIVE = null; CLAIMING = false; };

  function now() { return Date.now(); }
  function esc(v) { return String(v === undefined || v === null ? "" : v).replace(/'/g, "''"); }
  function tag() { return now() + "_" + Math.floor(Math.random() * 0xffffff).toString(16); }

  /* ---- Layer B: the durable SQL mutex ---- */

  function table(cb) {
    if (!sqlFn) return cb();
    sqlFn("CREATE TABLE IF NOT EXISTS `" + L.TABLE + "` (`id` int primary key, `owner` varchar(160), `ts` bigint)", function () { cb(); });
  }
  /* One attempt. Never retries internally — retrying is tick()'s job, so a caller can be told. */
  function acquireOnce(owner, cb) {
    if (!sqlFn) return cb(true);
    table(function () {
      /* Prune both directions. A row stamped in the future — a device whose clock was later
         corrected backwards — would never age out of a `ts <` test. */
      sqlFn("DELETE FROM `" + L.TABLE + "` WHERE `ts`<" + (now() - L.TTL_MS) + " OR `ts`>" + (now() + L.TTL_MS), function () {
        sqlFn("INSERT INTO `" + L.TABLE + "` (`id`,`owner`,`ts`) VALUES (1,'" + esc(owner) + "'," + now() + ")", function (r) {
          cb(!!(r && r.status === true));
        });
      });
    });
  }
  function touch(owner) {
    if (!sqlFn) return;
    sqlFn("UPDATE `" + L.TABLE + "` SET `ts`=" + now() + " WHERE `id`=1 AND `owner`='" + esc(owner) + "'", function () {});
  }
  function release(owner, cb) {
    if (!sqlFn) return cb();
    sqlFn("DELETE FROM `" + L.TABLE + "` WHERE `id`=1 AND `owner`='" + esc(owner) + "'", function () { cb(); });
  }

  /* ---- Layer A: the in-process queue ---- */

  /* Queue a signing operation. `work` is called with a release whose free() it MUST call exactly
     once, however the chain ends. `onBlocked` is called instead if the lock could not be claimed
     within CLAIM_DEADLINE_MS — the caller then reports a real failure rather than hanging.
     NOT RE-ENTRANT: gating something that itself reaches T.checkPost self-deadlocks. Gate at
     exactly one level — currently T.checkPost and the bare `send` paths. */
  L.gate = function (prefix, work, onBlocked) {
    QUEUE.push({ prefix: prefix || "sign", work: work, onBlocked: onBlocked || null, claimAt: 0 });
    pump();
  };

  function pump() {
    var job, owner;
    if (ACTIVE || CLAIMING) return;
    job = QUEUE[0];
    if (!job) return;
    if (!job.claimAt) job.claimAt = now();
    CLAIMING = true;
    owner = job.prefix + "_" + tag();
    acquireOnce(owner, function (ok) {
      CLAIMING = false;
      if (ok) {
        QUEUE.shift();
        TOKEN++;
        ACTIVE = { owner: owner, token: TOKEN, startedAt: now(), beatAt: now() };
        var rel = makeRelease(TOKEN);
        /* A throw inside the chain must not strand the lock until MAX_HOLD_MS. */
        try { job.work(rel); } catch (error) { rel.free(); }
        return;
      }
      if (now() - job.claimAt > L.CLAIM_DEADLINE_MS) {
        QUEUE.shift();
        if (job.onBlocked) { try { job.onBlocked("Another PandaDEX operation still holds the signing lock — nothing was sent; try again shortly"); } catch (ignore) {} }
        pump();
      }
      /* otherwise the job stays at the head of the queue and tick() tries again */
    });
  }

  /* Idempotent, and identified by token so a LATE release cannot free somebody else's lock.
     The previous version compared nothing: a job whose callback arrived after its watchdog had
     already fired would clear the CURRENT holder's watchdog and start a third job alongside it —
     two chains signing at once, which is the exact hazard this file exists to prevent. */
  function makeRelease(token) {
    var freed = false;
    return { free: function () {
      var owner;
      if (freed) return;
      freed = true;
      if (!ACTIVE || ACTIVE.token !== token) { pump(); return; }
      owner = ACTIVE.owner;
      ACTIVE = null;
      release(owner, function () { pump(); });
    } };
  }

  /* Called by the service on every NEWBLOCK. Does what the timers used to: retry a contended
     claim, keep a live holder's row fresh, and force-release a chain whose callback was lost. */
  L.tick = function () {
    var held = ACTIVE, n = now();
    if (!held) { pump(); return; }
    if (n - held.startedAt > L.MAX_HOLD_MS) {
      ACTIVE = null;
      release(held.owner, function () { pump(); });
      return;
    }
    if (n - held.beatAt >= L.HEARTBEAT_MS) { held.beatAt = n; touch(held.owner); }
  };

})(PandaSignLock);
