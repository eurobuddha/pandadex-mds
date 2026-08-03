# Changelog

Newest first. Each entry names the native PandaDEX version it reaches parity with, and the specific
on-chain failure it prevents.

## [0.4.5] — the export leaves as one archive again

**Fixed — four downloads instead of one file.** Native writes a single
`pandadex-trades-<date>.zip` holding `summary.txt`, `confirmed_trades.csv`, `reconciliation.csv`
and `verification.csv` (`TradeExportWriter`). The MiniDapp fired four separate browser downloads:
four save prompts, four loose files in Downloads, and four parts that can drift away from each
other. That last one is the reason it matters — the reconciliation CSV means nothing without the
summary stating the window, wallet and balances it reconciles against.

There is no ZIP library in the page and no CDN to pull one from (a MiniDapp is served from the node
and must be self-contained), so `zip.js` writes the format directly. Two decisions keep that small:

- entries are **STORED**, not deflated, so the entire compression half of the format is simply not
  implemented — an export is a few KB of CSV and compression would only buy complexity;
- **no ZIP64**, guarded rather than assumed: `build()` refuses past 4GB instead of emitting an
  archive with silently truncated offsets.

The writer is pure — the export timestamp is passed in — so the same trades always produce
byte-identical output. It is tested by handing the archive to the system `unzip`: `-t` to verify
every entry's CRC (the failure a hand-rolled writer actually makes, and one that would only surface
when the user tried to open the file), then `-p` on each entry to prove the contents round-trip
byte-for-byte, including the `·`, `≈` and non-BMP characters that a broken UTF-8 encoder would
corrupt silently.

The confirmation line now matches native's too: `2 confirmed personal trades · net 3 MINIMA ·
net −6.5 mxUSDT` rather than a count of files written.

## [0.4.4] — the ASSETS card was telling you money was confirming when it was locked

**Fixed — a wrong figure under a wrong label.** The per-asset card showed *Available / In orders /
Confirming*, and `Confirming` was computed as `confirmed − sendable` with the caption "Funds from a
recent trade are still confirming." That is the **locked** figure: money the node has fully
confirmed and will not spend — coins held in a contract, or change whose spend has not settled.
Waiting does not release it, so the caption asked you to wait for something that was not coming.

Worse, the node reports a real `unconfirmed` figure of its own — the one number that *does* become
spendable by waiting — and the page never read it. The genuinely pending money was invisible, and
the money that was not pending was labelled as pending.

The node gives four independent figures and they stay four now, exactly as native `AssetsTab` and
AtomiX's wallet card show them:

```
MINIMA · available to trade                                    7.5
confirmed 10  ·  locked ≈ 2.5  ·  unconfirmed 2.25  ·  4 coins  ·  updated 12s ago
in PandaDEX orders 3
```

The headline number is now **sendable** — the only figure an order can actually be funded from. The
summary card above it says AVAILABLE TO TRADE and values sendable funds only; it previously said
PORTFOLIO and totalled free + locked + confirming, which native does not show anywhere.

`updated <ago>` is repainted once a second while ASSETS is open. Painted once, an age line starts
lying immediately — the same defect fixed for the transaction stage line in 0.4.0.

**Also — the coin count now does the job it does in native.** One coin funds one rung per block, so
ten MINIMA in one coin builds a ladder far more slowly than ten MINIMA in ten coins. Publishing a
ladder with fewer funding coins than rungs now warns before it starts, and points at Split funding
coins (native `makerFundingHint`). A funding shortfall also names *why* the rest is unusable —
`you have 3 sendable (2 confirmed locked, 1 unconfirmed)` — instead of just stating the shortfall
(native `appendUnavailable`).

Parsing lives in `balance.js` and is covered by the cases from native's `BalanceDisplayTest`, plus
sendable-exceeds-confirmed (locked must floor at zero, not render negative) and a missing `sendable`
key falling back to confirmed rather than reading as an empty wallet.

## [0.3.7] — the app could not sign or post anything, and had not been able to since 0.2.33

**Fixed — every fund-moving action was impossible.** `signlock.js`, the serial signing gate added in
0.2.33, called `setInterval` to start its heartbeat. The MDS service is Rhino: `ServiceJSRunner`
builds the scope with `ctx.initStandardObjects()` and injects only `MDS`. There is no `setTimeout`,
no `setInterval`, no `XMLHttpRequest`. Run in exactly that scope the module gives:

```
{"workRan":false,"threw":"ReferenceError: setInterval is not defined","busyStuck":true}
```

The throw lands on the line *before* the local `try`, so the work function never ran, the gate never
released, and every later signing operation queued behind it forever. `MDSJS.sql` invokes JS
callbacks with no `try`/`catch`, so the error vanished upward and the UI simply never changed.

Affected: place, cancel, cancel-all, edit, GTC renewal, expiry sweep, book sweep, composite fill,
maker rungs, funding split — everything. No funds moved and nothing was left stuck on chain; the
transactions were never built. Every test until now ran under Node, where the timers exist.

The gate is now **timer-free**. `Date.now()` is all the service has, so the heartbeat, the
lost-callback watchdog and contended-claim retries all ride a new `PandaSignLock.tick()` that the
service calls on each NEWBLOCK. A claim that cannot be taken within 90s now **fails the caller with
a real message** instead of retrying every 400ms forever behind a frozen banner — the old behaviour
turned a stale lock row from a killed service into a five-minute silent wait.

**Fixed — a latent double-sign hazard in the same file.** The watchdog was module-global while the
release closed over a per-job owner, so a stalled job whose callback arrived late would clear the
*current* holder's watchdog and start a third job alongside it — two chains signing at once, the
exact Winternitz leaf-reuse this file exists to prevent. Releases are now identified by token and a
late one cannot free somebody else's lock.

**Fixed — `busy` had no escape.** One lost callback left it true for the rest of the session,
refusing every later action and silently disabling the maker and the processor. It now carries a
block stamp and clears after `BUSY_STUCK_BLOCKS` with an honest message.

**Fixed — the frozen banner.** A stage line now expires after 45 seconds, as native's does, and the
page repaints once a second while anything is in flight so it can expire and the pending clocks can
move. The transaction chain also narrates each phase — waiting for the lock, selecting funding
coins, registering pool scripts, signing, checking, posting — instead of one line for the whole run.

**Fixed — `price.js` used `setTimeout`** for its fetch watchdog. Replaced with a wall-clock stale
check driven by the same block loop.

**The guard that should have existed from the start.** `test.js` now builds a faithful model of the
MDS service scope — `initStandardObjects()` globals plus a fake `MDS`, nothing else — loads every
module `service.js` loads, and asserts that a real signing operation runs and releases, that two
operations serialise, and that no service-side file references a browser global at all. `build.sh`
already gates the zip on `node test.js`, so this class of defect now fails the build instead of a
user's node.

## [0.3.6] — the depth ladder froze the app

**Fixed — 0.3.4 made the app unusable whenever a pool was visible.** Checking that a displayed depth
band was actually executable asked `PandaComposite.plan` with an empty book. With no orders that
router degenerates to exactly the single pool route it could have called directly — but only after
grinding through its 128-slice loop with two full multi-pool routes per slice. That is 32,768 curve
quotes for an answer one route gives in 128, run up to 8 times per band, for 10 bands, twice, on
both sides: **over 10 million arbitrary-precision operations per repaint.**

Measured before the fix: **26 seconds for one pool, 53 for three**, on every block, on the page's
own thread. Native carries the same computation but on a dedicated depth thread with Java
BigDecimal; here it ran inside the paint.

Three changes:
- The executability check calls the pool router directly and applies the limit price itself.
- Routes are memoised for the duration of one sampling pass — the binary search revisits amounts,
  and the final executability walk re-prices totals the per-band cap already computed.
- Sampling no longer runs inside the paint. The book renders from the last completed snapshot and
  recomputes off the paint, repainting the depth columns when the new numbers land — which is what
  native's background depth worker does. The UI cannot block on it regardless of how long it takes.

Route calls for six pools across both sides went from tens of thousands to **190**, and `test.js`
now asserts a ceiling on that count, so this class of regression fails the build rather than the
user's node. Displayed numbers are unchanged.

## [0.3.5] — phantom trades, a price feed that could never work, and five more

Findings from a full review of the hand-written MDS code. Every fix is pinned by a test.

**Fixed — an unexplained disappearance was recorded as a trade.** `recordObservedFill` verified a
full vanish but suppressed only `CANCELLED`; `UNKNOWN` fell through and was written to the tape.
`PandaVerify` returns `UNKNOWN` for any reply it cannot read, so one node hiccup was enough to
invent a trade that never happened — into the tape, the candles, the 24h stats, `my_trades`, the
P&L and the accounting export. Native drops `UNKNOWN` for exactly this reason: a lost trade is
invisible to the user, a phantom one is not. Only `FILLED` records now.

**Fixed — pegged market-making could never work, and would have pulled the ladder off the book.**
`price.js` fetched with `XMLHttpRequest`, but it is loaded only into the service — Rhino with a
Java-backed `MDS`, which has no XHR. Every fetch threw and was swallowed as "network error", so the
mid stayed 0 and `mustWithdraw()` stayed true: a pegged ladder could not be published, and an armed
one would be auto-withdrawn. Now uses `MDS.net.GET` with the body normalised (string / base64 /
object) and a watchdog, because `net.GET` can fail to call back at all.

**Fixed — an over-cap book scan silently dropped orders.** The window only halved on `status:false`,
but an MDS reply over ~256KB comes back *empty*, which read as a genuinely empty range. Those orders
vanished from the book and the tape then saw them as vanished. A wide empty window is now
re-checked once at half width, bounded to one extra call per region.

**Fixed — `T.fill` had no funding-input cap.** It inlined its own coin selection with no limit, so a
wallet of dust built an oversized transaction caught only by the 60KB gate — *after* signing, which
burns a one-time key leaf for nothing. It now uses `findCoins`, which caps at 8 and refuses up front.

**Fixed — the wrong pool was dropped when a composite plan exceeded capacity.** `smallestPool`
ranked by `quote.outAmount`, which is the mxUSDT leg on the sell side. It now measures the MINIMA
contribution per side, as native does.

**Fixed — CSV formula injection in the export.** An order id is state port 4, chosen by whoever
created the order and never validated, and it landed unescaped in `confirmed_trades.csv`. Anyone
could put `=HYPERLINK(...)` on the book and have it execute when you opened your reconciliation.

**Fixed — `T.create` bounded only the locked leg.** The covenant compares by cross-multiplication and
overflow safety rests on the per-*leg* cap, so a large sell above price 1 sent an unbounded want side.

**Also:** `market_tape` gains the `timems` index native has; port 6 is want-per-locked everywhere and
rounded to `PRICE_DP` instead of emitting up to 40 digits; the buy side reports the MINIMA actually
delivered rather than a floored figure that made the resting remainder too large; the sign lock
prunes future timestamps so a backwards clock cannot wedge signing; `onclick` arguments are gated to
a charset that cannot close the JS string; `VANISH_AGE` derives from `HORIZON` again.

## [0.3.4] — pool depth was showing twice the liquidity it could deliver

Parity: native `SyntheticDepth`.

**Fixed** — a depth band answers *"how much can I take before the next slice costs more than this
price?"* — a **marginal** price. `Synthetic.solveToBoundary` was searching on the **average**
effective price over the whole size. On a constant-product curve those differ by a factor
approaching two: taking `Q` from reserves `(x,y)` moves the marginal price by ~`2Q/x` but the
average by only ~`Q/x`. Measured on a 100000/500 pool the overstatement was **1.975×** one tick out,
rising toward 2.0 as the band narrows. Only the display was affected — the router already priced on
true marginal cost — but the ladder advertised depth that was not there at that price.

**Also fixed in the same function:** band prices are now snapped onto the tick grid (ceiling for
asks, floor for bids) so pool rows merge with the book's own levels instead of sitting at raw curve
prices; and each cumulative band is re-planned through the real router at its own displayed limit
and shaved back until the plan actually fills it. Solve iterations are 8, matching native.

Sampling is memoised on block, tick and pool reserves — it became far more expensive, and native hit
the same wall and moved it to a background depth worker.

## [0.3.3] — a partial fill that hit the dust floor built a transaction the covenant rejects

Parity: native `0.3.9` arithmetic (`PriceMath`, `SweepPlanner`).

**Fixed**
- `PandaBook.plan` shrinks a take when the partial would leave less than the maker's minimum
  remainder, but it adjusted the amount consumed without recomputing the remainder — and the
  remainder is what `txn.js` writes as the covenant output and derives the new want from. A sweep
  against any order with a minimum remainder produced a transaction whose amounts did not add up
  and whose remainder sat below the floor the covenant enforces. The node rejected it every time,
  silently, after the taker had already paid for the proof-of-work. A 10 MINIMA ask with a 4 MINIMA
  floor, swept for 9, correctly reduced the take to 6 but still claimed a remainder of 1.

**Added**
- `covenant.js` names the arithmetic the chain enforces — `payFor`, `newWantFor`, `covenantAccepts`
  — instead of re-deriving it inline at each call site.
- Tests ported from native `PriceMathTest`, `OrderValidationTest` and `SweepPlannerTest`: honest
  partials at every ratio including 1e9 and sub-grain; shaved payment, shaved new-want,
  no-progress, dust-remainder and inflated-want all rejected; hostile orders rejected by the parser
  and unreachable through the planner; one partial per transaction; the per-transaction order cap.

## [0.3.2] — funding split, trade export, explorer verification

Parity: native `0.3.9` (`SelfSplit`, `TradeExport`, `ExplorerVerifier`).

**Added**
- `split.js` — a `split:10` self-send. A ladder rung's change has to confirm before the next rung
  on that side can be funded from it, so one fat wallet coin serialises the whole ladder. Splitting
  first lets it build at the speed of blocks.
- `export.js` — `summary.txt` plus confirmed-trades, reconciliation and verification CSVs, from
  confirmed personal fills only. Pure logic; every notional cut down so nothing overstates what was
  received.
- `explorer.js` — optional third-party confirmation that a recorded fill exists. Never blocks
  anything; an unreachable explorer is reported as exactly that.
- `my_trades` gains seven evidence columns by probe-then-ALTER, so a normal launch issues no
  unnecessary statements — on a restricted node each one is another approval prompt.

## [0.3.1] — delete the superseded pre-parity UI

Parity: native `0.3.2`, `0.3.3` display rules.

**Removed**
- The `#ladder` pane and `renderLadder()` (running every block, painting a hidden element), the
  sweep card and its `fill()`, the orphaned `FILL` handler, the unreachable `CREATE` handler,
  `sweep.js` (zero callers, still being shipped), and the dead `best()` and `tab()`.

**Changed**
- Finest price-grouping tick is `0.00001`; the "exact" option is gone.
- Book amounts use `fmtDown(v,2)` — cut, never rounded up, so displayed depth cannot overstate.

## [0.3.0] — composite liquidity

Parity: native `0.3.0`–`0.3.4` (`CompositeRouter`, `PoolRouter`, `VirtualCurve`, `SyntheticDepth`).

**Added**
- Blended routing across the V5 order book and PandaPools reserves, slice by slice at the margin,
  in a single transaction. Pool discovery via the `PANDAPOOLS` sentinel with a bounded scan.
- The book shows blended depth with BOOK/POOL split labels; the confirm dialog itemises both legs
  with the effective and worst marginal price.

**Fixed**
- Pool covenants were registered with `newscript trackall:true`, which makes every stranger's
  liquidity read as the user's own coins — the ownership pollution native lists as a fixed critical
  issue. Now `false`, pinned by a test.
- `Pool.scriptArg` escaped only `"`. It now matches PandaPools' proven quoter, which escapes `"`
  and `\` and leaves `/` strictly alone: escaping `/` turns the covenant's `*5/1000` into
  `*5\/1000`, making the script unparseable and stranding every coin at that address forever.
- The router's last slice now consumes a whole order instead of stopping at a below-floor partial.

**Not yet proven live.** The composite path is gated on the real-funds dust test in the native
repo's `contract/COMPOSITE_LIVE_INTEROP.md`, which must be run by hand on real devices.

## [0.2.34] — expired orders become visible, GTC renews with real margin, keys never shrink

Parity: native `0.2.19` constants (`DexContract`, `KeySet`, `DexTxn`).

**Fixed**
- `SCAN_DEPTH` was 600, but an order becomes collectable at age > 600 — the exact age the scan
  stopped looking. The expiry-sweep path could never fire. Now 1000, under the node's 1024
  visibility trim.
- GTC renewal started at age 520, leaving ~1.1 hours to get renewed. Native renews from 200. This
  app has no Doze-proof watcher and only runs while the node is up, so the wide margin matters more
  here, not less.
- `loadKeys` emptied both key sets before querying, so a failed `keys action:list` left the service
  owning nothing — and a maker that cannot see its own rungs posts the whole ladder again. Each
  half is now replaced only on success, and the maker and processor stand down while the key set is
  unusable.

**Added**
- A 60KB transaction-size gate before validation, with an error that says what to do about it.
- Funding queries use `sendable:true checkmempool:true` and filter by tokenid server-side.

## [0.2.33] — never sign two transactions at once

Parity: native `0.3.8` (`SignGate`).

**Fixed**
- Minima signatures are stateful: each key is a tree of one-time Winternitz leaves, and two
  transactions signing one key at once sign the same leaf over different data, which leaks that
  leaf's private key. Native confirmed 7 of 64 default keys re-used on a live node. This was
  reachable here — `makerOnBook` and `makerSweepTombstones` never checked `processor.working`, so a
  maker cycle and a GTC renewal could build transactions together.
- A `NEWBLOCK` arriving mid-scan was dropped outright, so work deferred to "next refresh" could
  wait on a block that had already come.
- `processor.working` was cleared only on normal completion, so a callback the node never delivered
  wedged GTC renewal for the rest of the session.

**Added**
- `signlock.js` — an in-process queue plus a SQL mutex in `sign_lock` claimed by an INSERT whose
  primary-key violation is the "someone else holds it" signal, with a TTL, heartbeat and
  lost-callback watchdog.

**Changed**
- `checkPost` accepts one key, several, or none. `cancelBatch` had a verbatim copy of the whole
  validation gate purely because it needed several signatures; it now passes the array.

## [0.2.32] — baseline

The accumulated working-tree work, committed as a baseline: sliced order-book scan that halves its
window on node failure instead of freezing, stale-book protection so a truncated reply cannot wipe
the visible book, null-safe numeric rendering, and tighter sweep caps (`MAX_ORDERS` 10 → 5, expiry
margin 12 → 30).
