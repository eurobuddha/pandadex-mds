# PandaDEX MDS parity with APK 0.4.15 — implementation in progress

Target source: APK commit `1974f657ae8cc66740c1e833530ccf612660157f`.
Starting MDS source: `c1c4a9c9c738d57550392377228f1837107ed894` / 0.4.6. Existing published packages are preserved.
This document supersedes the older PARITY.md target of APK 0.3.9.

| Area | Status / remaining work |
| --- | --- |
| Weighted displayed book + pool price | Ported for 0.4.7; same-side MINIMA sizes, unknown while current depth is pending. |
| Live transaction feedback | Ported for 0.4.7; immediate request feedback, 60 service messages, three-line summary, expanded dialog updates live. |
| Keyboard | Browser viewport requests content resizing; mobile runtime validation pending. |
| Transaction construction and submission | Port strict funding, validation, command/session boundaries, durable pre-post records and uncertain-result handling. |
| Maker authorization | Port identity/config epochs, quote checks and durable position recovery. |
| Owner/taker receipts and chain review | Port exact spend linkage, inclusion/reorg checks, conservative legacy repair and durable recovery. |
| Market history | Port pool executions, immediate taker indexing, bounded public history discovery and correct chain timestamps. |
| Balances and exports | Port unknown/stale reads, evidence-aware exports and failure handling. |
| Other platform behavior | Compare all source changes through 0.4.15; document Android-only lifecycle/IPC differences. |
| Package / deployment | Build only a uniquely versioned package; publish verified full-parity result, not this intermediate checkpoint. |

Reuse: existing MDS decimal.js, depth grouping, service messages and Node VM tests; Java PriceMath.weightedBookPrice, TradeView's best displayed levels and MainActivity's bounded/live activity log. Java/Android UI classes cannot run in MDS, so the same algorithms use existing ES5 and browser primitives. Contract expiry and renewal parameters are unchanged. No new concurrent-trade prevention was added.

## 0.4.7 validation

`node test.js` passed, including native weighted-price vectors and actual MDS page/service functions under the repository's Node VM harness. Added checks cover immediate feedback with the service callback held, live updates in the same dialog, a 60-message cap, repeated snapshots, safe text rendering, in-flight stage lifetime, mixed pool/book depth and unknown price for stale pool depth. `git diff --check` passed.

Review: no contract, funding, maker or receipt semantics changed in this checkpoint. Browser keyboard and responsive rendering still require actual runtime validation; the Node DOM fixture does not establish those. Full parity remains incomplete as listed above.

## 0.4.8 validation

Ported `TxValidation`, `CommandSafety` and completion-owned signing serialization from native. Transaction checks require every stock verdict in its real location. All construction steps are checked for command separators/control characters before the first step; service commands reject them independently. An elapsed timeout or local exception cannot start another signing operation. Failed/malformed block replies cannot drive maintenance using a fabricated tip. Recovery of an unknown write and durable receipts remain outstanding.

`node test.js` passed with the actual stock `txncheck` reply schema, every mandatory verdict missing or malformed, invalid command data, an elapsed signing timeout, and numeric/string block heights. The module is included in the shipping list and service VM checks. The native source tests reused are `TransactionHardeningTest` and `SerialQueueTest`. Existing integration fixtures still accept pending post replies; pending approval/submission identity will be addressed with durable receipts, not claimed fixed here.

## 0.4.9 validation

Ported native `FundingCoins`, `CoinLock` and bounded `Util.decOr` parsing. Funding counts each token before listing and derives standard wallet addresses from keys for larger wallets. Address slices are ranked and recounted before listing; crowded slices are skipped. Selection is largest-first, stateless, token-unit-aware and deduplicated. Queued input claims survive selection expiry and reject duplicates before signing. The transaction input cap is 20; the existing per-fill funding budget remains eight. Presentation failures cannot interrupt transaction progress.

Removed the obsolete `txnexport` size gate to match current APK `DexTxn.checkAndPost`: the node applies the chain's actual serialized TxPoW limit at `txnpost`. Its size error and actual limit are retained in the message.

`node test.js` passed, including the existing service boot/book fill/pool fill integration harness, native funding vectors, count/read failures, tokenamount requirements, crowded-address avoidance, slice recounts, duplicate inputs, claim expiry and node-size rejection. Older mock coin IDs were corrected to valid hexadecimal values; assertions now fail at the transaction callback with its actual error. `git diff --check` passed. No MDS package has been published from these intermediate commits.

## 0.4.10 validation

Ported native `MainActivity.balanceMeta` and `AssetsTab` behavior. Both tokens are queried separately; failed, wrong-token, ambiguous or malformed replies remain unknown. Valid empty non-native token responses are observed zero. Existing observations and timestamps survive failed refreshes. Missing sendable no longer falls back to confirmed, and an unloaded card/total renders unknown.

`node test.js` passed with native balance vectors and the actual page callbacks exercised under the VM harness: scoped queries, retained observations after failure and wrong-token rejection. Existing NEWBLOCK/NEWBALANCE refresh checks remain. No contract timing changes.

## 0.4.11 validation

Ported native `DexDb` additive migration behavior: older saved market and personal rows are preserved, and personal trades are no longer deleted by a rolling 8,000-row cap. A failed schema setup stops service initialization before trading becomes ready. Schema-marker replacement uses the existing PandaPools H2 `MERGE ... KEY` pattern.

`node test.js` passed. `test-rhino.js` passed 24 assertions using the actual Minima `rhino-1.7.14.jar` and `h2-2.4.240.jar`: upgrade a seeded legacy schema, preserve both historical rows, read migrated evidence columns, repeat initialization, and exercise atomic replacement. This test is offline and uses an in-memory database; it sends no node commands.

## Live validation authorization

The user explicitly authorized small real-money trades on the S10 Plus on 2026-09-11. The working validation limit is 1 MINIMA equivalent per test leg, with a live quote check and on-chain verification before the next leg. This authorizes bounded live validation after the candidate passes offline checks; it does not authorize changing seeds, wiping data or spending larger existing maker allocations. Full parity is still in progress.
