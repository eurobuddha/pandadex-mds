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
 * PandaDEX supplies that concurrency generously. The maker engine posts several actions per cycle;
 * the order processor renews GTC orders on the same blocks; and the UI command path can fire while
 * either is mid-chain. The three `working` booleans in service.js do not cross-check each other, so
 * a maker cycle plus a user tapping CANCEL is enough to sign twice at once.
 *
 * EVERY path that signs must pass through here — the `txnsign` chains AND the bare `send` commands
 * that create orders and split funding coins, because `send` signs internally too.
 *
 * TWO LAYERS, deliberately:
 *
 *   A. An in-process FIFO queue. Direct port of SignGate.java. In MDS this is the load-bearing
 *      guard, because the service is the sole signer and runs in one JS context.
 *   B. A SQL mutex in `sign_lock`, claimed by an INSERT whose primary-key violation IS the
 *      "someone else holds it" signal. Layer B is not strictly required today, but it survives a
 *      service restart mid-chain (a TTL frees it, where an in-memory queue would simply forget),
 *      and it is the only thing that holds if the page ever gains a signing path. Adapted from
 *      pandapools-mds/poolmgr.js:105-144, which solves the same problem across its page/service split.
 *
 * The node's own signing has since been synchronised upstream, but this gate stays: the app also
 * runs against nodes we do not control, and serialising is correct anyway.
 */
var PandaSignLock = PandaSignLock || {};
(function (L) {

  L.TABLE = "sign_lock";
  L.TTL_MS = 5 * 60 * 1000;      /* a holder that dies without releasing frees itself after this */
  L.HEARTBEAT_MS = 30 * 1000;    /* ...so a live holder must keep saying it is alive */
  L.RETRY_MS = 400;              /* contended-acquire backoff */
  /* Longer than the node's write timeout, so this only fires for a genuinely lost callback and
     never for a chain that is merely slow — proof-of-work on a phone is not quick. */
  L.MAX_HOLD_MS = 200 * 1000;

  var sqlFn = null, QUEUE = [], BUSY = false, ACTIVE = null, WATCHDOG = null;

  /* Inject MDS.sql once at service boot. Without it the SQL layer is skipped and the in-process
     queue still serialises correctly — which is what the unit tests run against. */
  L.use = function (fn) { sqlFn = typeof fn === "function" ? fn : null; };
  L.busy = function () { return BUSY; };
  L.queued = function () { return QUEUE.length; };
  /* Test hook only. Drops queued work and forgets the active holder without releasing it. */
  L.reset = function () { clearWatchdog(); if (ACTIVE) stopBeat(ACTIVE.beat); QUEUE = []; BUSY = false; ACTIVE = null; };

  function esc(v) { return String(v === undefined || v === null ? "" : v).replace(/'/g, "''"); }
  function tag() { return Date.now() + "_" + Math.floor(Math.random() * 0xffffff).toString(16); }
  /* unref so a pending watchdog never holds a `node test.js` run open. */
  function after(fn, ms) { var t = setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; }
  function every(fn, ms) { var t = setInterval(fn, ms); if (t && t.unref) t.unref(); return t; }
  function stopBeat(t) { if (t) clearInterval(t); }

  /* ---- Layer B: the durable SQL mutex ---- */

  function table(cb) {
    if (!sqlFn) return cb();
    sqlFn("CREATE TABLE IF NOT EXISTS `" + L.TABLE + "` (`id` int primary key, `owner` varchar(160), `ts` bigint)", function () { cb(); });
  }
  function acquire(owner, cb) {
    if (!sqlFn) return cb();
    table(function () {
      /* Prune both directions. A row stamped in the future — a device whose clock was later
         corrected backwards — would never age out of a `ts <` test, wedging every signing path
         until the clock caught up. */
      sqlFn("DELETE FROM `" + L.TABLE + "` WHERE `ts`<" + (Date.now() - L.TTL_MS) + " OR `ts`>" + (Date.now() + L.TTL_MS), function () {
        /* The primary-key violation is the mutex: status:false means somebody else holds row 1. */
        sqlFn("INSERT INTO `" + L.TABLE + "` (`id`,`owner`,`ts`) VALUES (1,'" + esc(owner) + "'," + Date.now() + ")", function (r) {
          if (r && r.status === true) return cb();
          after(function () { acquire(owner, cb); }, L.RETRY_MS);
        });
      });
    });
  }
  function touch(owner) {
    if (!sqlFn) return;
    sqlFn("UPDATE `" + L.TABLE + "` SET `ts`=" + Date.now() + " WHERE `id`=1 AND `owner`='" + esc(owner) + "'", function () {});
  }
  function release(owner, cb) {
    if (!sqlFn) return cb();
    sqlFn("DELETE FROM `" + L.TABLE + "` WHERE `id`=1 AND `owner`='" + esc(owner) + "'", function () { cb(); });
  }

  /* ---- Layer A: the in-process queue ---- */

  /* Queue a signing operation. `work` is called with a release whose free() it MUST call exactly
     once, however the chain ends — success, validation failure, post rejection or transport error.
     NOT RE-ENTRANT: gating something that itself reaches T.checkPost self-deadlocks, because the
     inner claim waits on a release that only the outer chain can perform. Gate at exactly one
     level — currently T.checkPost and the bare `send` paths. */
  L.gate = function (prefix, work) {
    QUEUE.push({ prefix: prefix || "sign", work: work });
    if (!BUSY) next();
  };

  function next() {
    clearWatchdog();
    var job = QUEUE.shift();
    if (!job) { BUSY = false; ACTIVE = null; return; }
    BUSY = true;
    var owner = job.prefix + "_" + tag();
    acquire(owner, function () {
      var beat = sqlFn ? every(function () { touch(owner); }, L.HEARTBEAT_MS) : null;
      ACTIVE = { owner: owner, beat: beat };
      scheduleWatchdog();
      var rel = makeRelease(owner, beat);
      /* A throw inside the chain must not strand the lock for MAX_HOLD_MS. */
      try { job.work(rel); } catch (error) { rel.free(); }
    });
  }

  /* Idempotent — a chain with several exit paths can call free() from all of them. */
  function makeRelease(owner, beat) {
    var freed = false;
    return { free: function () {
      if (freed) return;
      freed = true;
      clearWatchdog();
      stopBeat(beat);
      release(owner, function () {
        if (ACTIVE && ACTIVE.owner === owner) ACTIVE = null;
        next();
      });
    } };
  }

  function scheduleWatchdog() {
    clearWatchdog();
    WATCHDOG = after(function () {
      WATCHDOG = null;
      var held = ACTIVE;
      if (!held) { next(); return; }
      stopBeat(held.beat);
      release(held.owner, function () {
        if (ACTIVE && ACTIVE.owner === held.owner) ACTIVE = null;
        next();
      });
    }, L.MAX_HOLD_MS);
  }
  function clearWatchdog() { if (WATCHDOG) { clearTimeout(WATCHDOG); WATCHDOG = null; } }

})(PandaSignLock);
