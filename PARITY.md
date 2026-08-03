# Parity audit — PandaDEX MiniDapp vs native PandaDEX

Native reference: `apks/pandadex` **0.3.9** (50 classes, 27 test classes).
MiniDapp audited: **0.3.9**.

Every row was checked by reading both sides. Status is one of **Yes** (behaviour matches),
**Partial** (present but differs — the difference is stated), **No** (absent), or **N/A**
(impossible on MDS, with the reason).

This file exists because parity was claimed twice before without being verified. If a row says Yes,
it was read; if it says Partial or No, the gap is named rather than rounded up.

---

## 1. Screens and navigation

| Native | Behaviour | Status | Evidence / gap |
|---|---|---|---|
| `MainActivity` | Six tabs: TRADE, CHART, TRADES, ORDERS, ASSETS, MAKER | **Yes** | `index.html` `.app-tabs`, `switchView()` |
| `MainActivity` | Version pill, theme toggle, node pill, block pill, refresh | **Yes** | `.topbar` / `updateChrome()` |
| `Design` | ONYX/DAYLIGHT palettes, exact hex, Inter + JetBrains Mono | **Yes** | `style.css` / `parity.css` tokens lifted 1:1 from `Design.java:69-89` |
| `Design.pulse` | Last price bounces and flashes on change | **No** | Static text; no animation |
| `Design.pressable` | 0.96 scale on touch | **Partial** | CSS active states only |

## 2. TRADE tab (`TradeView`)

| Behaviour | Status | Evidence / gap |
|---|---|---|
| Stage line, orange pill, hidden when empty | **Yes** | `paintNotice()` |
| Stage auto-expires after 45s + 1 Hz repaint | **Yes** | `STAGE_HOLD_MS`, `setInterval` (page-side) |
| Ticker: last trade, age, 24h Δ/High/Low/Vol | **Yes** | `renderTicker()` |
| Order book: 10 rows/side, asks top-down, cumulative depth bars | **Yes** | `renderBookRows()` |
| Price grouping `0.00001 / 0.0001 / 0.001 / 0.01`, asks ceil / bids floor | **Yes** | `GROUPS`, `levelPrice()` |
| `•` own-order marker, `FILLING…` while taking | **Yes** | `renderBookRows()` |
| `BOOK x / POOL y` split labels | **Yes** | `renderBookRows()` |
| Tap a level to prefill its exact price | **Yes** | `prefillPrice()` |
| Amounts cut, never rounded up (`fmtDown(v,2)`) | **Yes** | `fmtDown()` |
| BUY/SELL segment, price, amount, 25/50/75/100 chips | **Yes** | `.percent-row`, `percent()` |
| Live total, debounced | **Yes** | `preview()` |
| GTC toggle; Advanced → minimum remainder with native's explanation | **Yes** | `advanced()` |
| Submit routes composite → sweep → place | **Yes** | `place()` → `LIMIT` → `limitWithPools()` |
| Open orders card with pending rows, edit/cancel, EXPIRED badge | **Yes** | `renderOrders()` |
| Cancel-all button when >1 order | **Yes** | `cancelAllOrders()` |

## 3. CHART tab (`ChartTab` / `Candles` / `CandleView`)

| Behaviour | Status | Evidence / gap |
|---|---|---|
| 15m/1H/4H/1D, default 1H, 120-candle cap | **Yes** | `CHARTS`, `chartSel = 1` |
| OHLC candles + volume subchart, price axis, last-price line | **Yes** | `renderChartPage()` |
| Readout `dd MMM HH:mm  O H L C V` | **Yes** | `showCandle()` |
| Touch crosshair | **Partial** | Hover/click selects a candle; no dragging crosshair |

## 4. TRADES tab (`TapeTab`)

| Behaviour | Status | Evidence / gap |
|---|---|---|
| Two segments, **MY TRADES default** | **Yes** | `tapeSub = 0` |
| `Rows N   Net X MINIMA   Y mxUSDT`, signed wallet-side | **Yes** | `myTradeTotals()` |
| "Only wallet-owned confirmed fills…" caption | **Yes** | `renderMyTradesPage()` |
| EXPORT + RECONCILE, shown unconditionally | **Yes** | `downloadExport()` |
| Row: side+size coloured, price neutral 6dp | **Yes** | `.mytrade-top` |
| Row: `dd MMM HH:mm   TAKER   POOL   LOCAL_VERIFIED` | **Yes** | `.mytrade-meta` |
| Row: txpowid in full, falling back to spent coinid | **Yes** | `.mytrade-evi` |
| MARKET TAPE caption, `YOU` marker, price coloured by side | **Yes** | `renderMarketTapePage()` |
| Empty states for both segments | **Yes** | both renderers |
| Native prints `LOCAL_VERIFIED` when `source_kind` is blank | **Partial** | We omit blank fields instead — a native display bug not replicated deliberately |

## 5. ORDERS tab (`OrdersTab`)

| Behaviour | Status | Evidence / gap |
|---|---|---|
| OPEN / MY TRADES segments, OPEN default | **Yes** | `ordersSub` |
| Pending rows first with a live clock | **Yes** | `pendingCard()` |
| Meta line: GTC/expires, age, min remainder, total | **Yes** | `renderOrders()` |
| `MAKER RUNG` badge | **Yes** | `makerOrderMap()` |
| Fills summary + P&L vs book mid | **Yes** | `renderOrdersPage()` |
| Export from this tab | **Yes** | shared with TRADES |

## 6. ASSETS tab (`AssetsTab`)

| Behaviour | Status | Evidence / gap |
|---|---|---|
| Portfolio value at book mid | **Yes** | `renderAssetsPage()` |
| Per-asset card | **Partial** | We show Available / In orders / Confirming. Native shows **sendable, confirmed, locked, unconfirmed, coin count and "updated <ago>"** — four figures plus two we do not have |
| `in PandaDEX orders` from resting orders | **Yes** | `lockedTotals()` |
| RECEIVE card, tap to copy | **Yes** | `copyReceive()` |
| NEED mxUSDT card | **Yes** | `renderAssetsPage()` |

## 7. MAKER tab (`MakerTab` / `MakerLadder` / `MakerEngine` / `MakerConfig` / `MakerStatus`)

| Behaviour | Status | Evidence / gap |
|---|---|---|
| Status card: NOT PUBLISHED / PUBLISHED / WITHDRAWN — STALE FEED | **Yes** | `renderMakerPage()` |
| Peg to MEXC switch, skew %, reprice ≥ % | **Yes** | `makerConfigFromDom()` |
| Auto-fill: mid, step, levels, ask size, bid size; regenerate on edit | **Yes** | `makerSeedGen()` / `makerPriceGen()` |
| ASKS rendered A6→A1, BIDS B1→B6 | **Yes** | `hydrateMaker()` |
| Pegged mode disables price cells, never amounts | **Yes** | `makerPriceGen()` |
| Preview line + crossed-market warning | **Yes** | `makerPreview()` |
| ON-CHAIN STATUS lines, native wording | **Yes** | `makerStatusLines()` |
| PUBLISH with affordability check and itemised shortfall | **Yes** | `publishMaker()` |
| APPLY EDITS with relock/repost/create/cancel counts | **Yes** | `makerEditCounts()` |
| WITHDRAW, batched ≤5 per transaction | **Yes** | `makerCancelChunks()` |
| SPLIT FUNDS INTO 10 UTXOS | **Yes** | `splitFunding()` → `split.js` |
| Ladder maths: `desired`, `commitments`, `reconcile`, `minRemainderFor` | **Yes** | `maker.js`, verified rule-by-rule against `MakerLadder.java` |
| Slots, tombstones, patience blocks, per-side create budget | **Yes** | `service.js` maker engine |
| 2s peg tick / deferred edit until a price arrives | **Partial** | We regenerate on block and on input, not on a 2s timer |

## 8. Transactions and fund safety (`DexTxn`, `SignGate`, `PriceMath`)

| Behaviour | Status | Evidence / gap |
|---|---|---|
| Serial signing gate over every signing path | **Yes** | `signlock.js`, timer-free |
| `txncheck` as sole verdict (`valid.scripts`, `validamounts`, `mmrproofs`, `allsignaturesvalid`) | **Yes** | `txn.js` `checkPost` |
| `txndelete` on every terminal path | **Yes** | `checkPost` |
| Transaction size gate before validation | **Yes** | `txnexport`, 60KB |
| Coin selection: largest-first, exclusions, ≤8 inputs, drop state-bearing coins | **Yes** | `findCoins` |
| `checkmempool:true sendable:true` funding queries | **Yes** | `coinQuery` |
| Create / cancel / cancelBatch / relock / collectExpired / fillSweep / fillComposite | **Yes** | `txn.js` |
| Covenant arithmetic (`payFor`, `newWantFor`, `covenantAccepts`) | **Yes** | `covenant.js`, pinned by tests |
| Per-leg 1e9 cap | **Yes** | `T.create` |
| Restricted-node pending-sign resume | **No** | Native has no equivalent either; pandapools does. Not required for a WRITE-permission dapp |

## 9. Order book and fill detection (`BookScanner`, `BookRepository`, `FillTape`, `FillVerifier`)

| Behaviour | Status | Evidence / gap |
|---|---|---|
| Sliced scan, halving on failure to `MIN_SLICE_BLOCKS` | **Yes** | `book.js` |
| Ambiguous empty window re-checked before being believed | **Yes** | `book.js` probe |
| `SCAN_DEPTH` 1000 under the 1024 horizon | **Yes** | `covenant.js` |
| Book belief rule (`believable`, `EMPTY_CONFIRM = 3`) | **Partial** | We keep the last good book when a scan is incomplete, but do not implement native's confirm-count rule. Pools have it; the book does not |
| Cold-start book cache persisted, seeded minus cancelled ids | **No** | Native caches the book in SQLite and paints it before the first scan. We start empty every launch |
| Fill diff: partial by successor, full after miss grace | **Yes** | `tape.js` |
| Anti-phantom guards: truncated, mass-vanish, stale-prev, per-scan cap | **Yes** | `tape.js` |
| Cancel log consulted before adjudication | **Yes** | `cancelled_coins`, registered at submit time |
| `FillVerifier` CANCELLED / FILLED / UNKNOWN, UNKNOWN dropped | **Yes** | `verifier.js` + `recordObservedFill` |
| Evidence linked to the specific order | **Yes** | Exclusive batch adjudication — see §15. Stronger than native |

## 10. Pools and composite (`PoolBook`, `VirtualCurve`, `PoolRouter`, `CompositeRouter`, `SyntheticDepth`)

| Behaviour | Status | Evidence / gap |
|---|---|---|
| Sentinel discovery, bounded `depth:1500`, `parseok` pre-flight | **Yes** | `pool.js` |
| `newscript trackall:false` for pool covenants | **Yes** | `ensurePools`, test-pinned |
| `scriptArg` never escapes `/` | **Yes** | `Pool.scriptArg`, test-pinned |
| Curve: 5/1000 fee, `FEE_KEEP`, `MINIMA_DP` 11, forward-verified inverse | **Yes** | `curve` block, read against `VirtualCurve.java` |
| Router: 6 pools, 128 steps, exact-out fails rather than underfills | **Yes** | `pool.js` |
| Composite: 128 slices, capacity 12, drop-smallest-pool, whole-order last slice | **Yes** | `composite.js` |
| Synthetic depth: marginal price, tick bucketing, executability cap | **Yes** | `pool.js`, cost-ceiling tested |
| Pools re-read before planning a trade | **Yes** | `limitWithPools` |
| Composite transaction layout (pool pairs first, index-matched) | **Yes** | `buildCompositeSteps`, end-to-end tested |
| Live real-funds interop gate | **N/A** | Human-only, per `contract/COMPOSITE_LIVE_INTEROP.md` |

## 11. Background and lifecycle

| Native | Status | Reason |
|---|---|---|
| `DexKeepAliveService` foreground service | **N/A** | MDS has no foreground service. Work rides NEWBLOCK |
| `HeartbeatReceiver` exact alarms | **N/A** | No alarm API |
| `DexWatchWorker` WorkManager | **N/A** | No WorkManager |
| `BootReceiver` restart on boot | **N/A** | The node starts the service |
| 30s backstop poll | **Partial** | Block-driven only (~50s); no independent timer, because the service has none |
| `DexProcessor` GTC renewal + expiry sweep, ≤2/pass, inflight table | **Yes** | `processorProcess` |
| Renewal from age 200 | **Yes** | `RENEW_AT` |
| `Notifier` system notifications | **Partial** | `MDS.notify` text only; no channel, no actions |

**Consequence, stated plainly:** GTC renewal and the maker only run while the Minima node is
running. Native survives the phone sleeping; this cannot. That is a platform limit, not an omission.

## 12. Data and persistence (`DexDb`)

| Native table | Status | Evidence / gap |
|---|---|---|
| `tape` + index | **Yes** | `market_tape` + `tape_time` |
| `mytrade` incl. seven evidence columns | **Yes** | `my_trades`, probe-then-ALTER |
| `cancelled` | **Yes** | `cancelled_coins`, 24h prune |
| `book` cache | **No** | See §9 |
| `meta` | **Partial** | `dex_schema` for the migration only |
| `myorder` | **N/A** | Deliberately disabled in native too |
| One-time destructive purge of bad rows | **Yes** | `ensureSchema`, mirrors `DexDb v<3` |
| 8000-row cap | **Yes** | trim on insert |

## 13. Export and verification

| Behaviour | Status | Evidence / gap |
|---|---|---|
| summary + confirmed_trades + reconciliation + verification | **Yes** | `export.js` |
| Notional cut down, never overstated | **Yes** | `export.js` |
| Formula-injection guard | **Yes** | beyond native — native has no guard |
| Delivered as one ZIP | **Partial** | Four separate downloads; no ZIP library available |
| Explorer txpow verification | **Yes** | `explorer.js` |

## 14. Own-trade recording — CLOSED in 0.3.9

Native gates a taker row behind three checks (`MainActivity.reconcileTakerFill` /
`completeTakerFill`). All three are now implemented:

1. no source coin still present locally — `sourceStillLive` — **Yes**;
2. `coins coinid:<id>` per source says spent, **tri-state, unknown ≠ spent** — `allSourcesSpent`
   + `PandaVerify.coinPresent` — **Yes**;
3. an exact-amount proceeds coin at our address with `created >= postBlock` — `proceedsArrived`
   + `PandaVerify.proceedsPresent` — **Yes**.

`LOCAL_VERIFIED` is only written once all three hold, so the claim is now true. `fillMeta` is
persisted in `fill_state`, so a service restart between posting and confirmation no longer loses
the trade. Ported from `TakerConfirmationTest`, including that an unreadable reply must never read
as spent, and that a token payout is measured by `tokenamount` rather than the raw amount.

## 15. Fill adjudication — STRONGER THAN NATIVE in 0.3.9

Native's `FillVerifier` adjudicates each vanished order **independently**: fetch coins at its payout
address, match on token and amount. Every order a wallet creates carries the same payout address, so
one cancelled ask rung's refund satisfies "payment" for every bid rung of the same size that vanishes
in the same window. Measured on the reported ladder: **three cancellations produced three phantom
trades**; with the fix, zero, and the three cancels are correctly identified.

The fix is exclusivity, not a better predicate. `PandaVerify.adjudicateBatch` settles every vanish in
a scan together, and **a coin is evidence for at most one order** — clean refunds claim first (which
is what stops a refund being read as somebody else's payment), payments take what remains, and
native's payment-wins precedence is preserved for a genuinely ambiguous single order so this ports
back without a behaviour change. Evidence must also be newer than the last block the order was
actually seen alive, so a pre-existing coin cannot explain a disappearance.

**This is the item to port back to the APK.** `verifier.js` `adjudicateBatch` / `findUnclaimed` /
`earliest` map directly onto `FillVerifier`, and `tape.js` supplies the last-seen block.

---

## Summary

| | Count |
|---|---|
| Yes | 76 |
| Partial | 11 |
| No | 4 |
| N/A (platform) | 6 |

**The four real absences:** ticker pulse animation; persisted book cache / cold-start paint; the
book's confirm-count belief rule; and restricted-node pending-sign (not needed for a WRITE dapp).

**The Partials that matter**, in order: ASSETS balance detail (§6) and the ZIP export (§13).
Everything else is cosmetic or a platform limit.

Fill adjudication (§15) is now **ahead** of native and is queued to be ported back to the APK.
