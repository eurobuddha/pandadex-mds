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
