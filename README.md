# PandaDEX MiniDapp

A fully-decentralized, MEXC-style limit-order exchange for **MINIMA ⇄ mxUSDT**, running as a
MiniDapp inside your own Minima node.

There is no server. No matching engine, no order-book API, no relay. The order book *is* a set of
coins locked at one on-chain covenant address; your node reads it directly and your device builds
the transactions that fill it. It shares that book with the **PandaDEX Android app** — the same
covenant, the same orders, so a MiniDapp user and an APK user trade with each other directly.

> **This is development software. It moves real funds on mainnet. Use at your own risk.**

MiniDapp `0.3.7` tracks native PandaDEX `0.3.9`.

## What it does

- **Real limit orders with partial fills.** A resting order can be eaten a piece at a time — the
  taker's transaction pays the maker pro-rata and re-locks the remainder at the same price,
  atomically. Enforced by the covenant, not by the app.
- **Marketable limits.** An order that crosses the book sweeps the resting liquidity first (best
  price first, up to 5 orders in one transaction) and rests only the unfilled balance.
- **Composite liquidity.** When a PandaPools AMM pool quotes better at the margin than the next
  resting order, the same transaction takes from both — order coins and pool reserves together.
- **Good-till-cancelled orders that survive.** Orders renew by an atomic in-place re-lock: one
  transaction, funds never leave the book. Renewal begins at age 200 of a 600-block lifetime, so a
  missed window has ~5.5 hours of retries.
- **Atomic reprice.** Editing an order's price is one transaction; the order never leaves the book
  and your funds are never sitting loose in your wallet.
- **A market maker.** A six-rung-per-side ladder, optionally pegged to the MEXC MINIMA/USDT mid,
  that reprices in place when the mid moves past your threshold and withdraws itself if the feed
  goes stale.
- **An honest chart.** Candles, the trades tape, 24h stats and your P&L are built from fills *your
  node observed on-chain*. Nothing is fetched from an exchange.
- **Exportable accounting.** Confirmed personal fills export as a summary plus three CSVs, with
  every notional cut down so nothing overstates what was received.

## Screens

`TRADE` — ticker, order book with cumulative-depth bars and price grouping, buy/sell panel with
percent chips, and your open orders with edit/cancel.
`CHART` — OHLC candles and volume, 15m/1H/4H/1D.
`TRADES` — the market tape of observed fills.
`ORDERS` — open orders, and your fill history with P&L against the book mid and the export button.
`ASSETS` — balances split into available, in-orders and confirming, portfolio value, receive address.
`MAKER` — the ladder editor, per-rung on-chain status, and the funding-split tool.

## The contract

The book lives at one address, derived from a frozen KISS-VM covenant:

```
0x2D43279DD85DABCA3EA90C9997DAB9169D8B7A0E8CB594236AF44542489774A5
```

Spend paths: owner cancel (refund), owner atomic re-lock (renew/reprice), third-party expiry sweep
after 600 blocks, full fill, and partial fill with a pro-rata remainder. The 600-block lifetime is
deliberate — a light node cannot see a coin older than ~1024 blocks, so an order must be able to
expire *and still be visible* long enough for anyone to sweep it home. Prices are enforced by
cross-multiplication (no division, no rounding slack), always rounded in the maker's favour, with a
maker-set minimum remainder to stop dust griefing.

The proofs live in the native repo: `contract/RESULTS.md` (134/134 arithmetic vectors, full
lifecycle mined on a private chain, 9 adversarial attacks all rejected with the order coin
untouched) and `contract/COMPOSITE_LIVE_INTEROP.md`.

## Files

| file | role |
|---|---|
| `dapp.conf` | MDS manifest. **Must be the first entry in the zip** or install silently fails. |
| `index.html` | The whole page: markup, styles hookup, and one script block. |
| `style.css` / `parity.css` / `fonts.css` | Design tokens lifted 1:1 from the native `Design.java`, plus the Android TradeView layout. |
| `covenant.js` | V5 covenant text, constants, order parsing, the poison filter, and the partial-fill arithmetic the chain enforces. |
| `book.js` | Sliced order-book scan and the taker planner. |
| `pool.js` / `composite.js` | PandaPools discovery and curve, and the blended book+pool router. |
| `txn.js` | Every transaction the app posts. |
| `signlock.js` | The serial signing gate. Nothing signs without it. |
| `tape.js` | Fill discovery by book diffing, and the trade tables. |
| `verifier.js` | Adjudicates a vanished order as filled, cancelled or unknown. |
| `maker.js` | Pure ladder generation and reconciliation. |
| `price.js` | The MEXC reference feed and its staleness state machine. |
| `pending.js` | Optimistic order lifecycle. |
| `split.js` | The funding-coin split tool. |
| `export.js` | Trade export and reconciliation. Pure logic. |
| `explorer.js` | Optional third-party txpow confirmation. |
| `service.js` | The background service: the sole owner of chain and transactions. |
| `test.js` | `node test.js` — pure regression tests, no node required. |

## Fund-safety design

Each of these exists because of a specific, observed failure:

- **Nothing signs concurrently.** Minima keys are trees of one-time Winternitz leaves; two
  transactions signing one key at once sign the same leaf over different data and leak it. Native
  confirmed 7 of 64 keys re-used on a live node. Every signing path funnels through `signlock.js`.
- **`txncheck` is the only verdict.** Never `txnlist`, never `txnpost` — the latter means mempool
  acceptance, not validity. The gate checks `valid.scripts`, `validamounts`, `valid.mmrproofs` and
  `allsignaturesvalid`; the top-level `scripts` field is a count, not a verdict.
- **Every terminal path runs `txndelete`.** Nothing is left in `txnlist`.
- **`newscript trackall:false`.** With `trackall:true` every coin at the covenant address reads as
  wallet-relevant, and every stranger's order looks like yours.
- **The pool covenant is quoted without escaping `/`.** Escaping it turns `*5/1000` into `*5\/1000`,
  which makes the script unparseable and strands every coin at that address permanently.
- **Every node query is bounded.** An MDS reply over ~256KB comes back empty rather than erroring,
  so an unbounded query reads as "no results" — which for a funding query means "no funds".
- **A single empty scan is never believed.** A resyncing node answers `status:true` with an empty
  list; acting on that would empty the book and the pool set.
- **The key set never shrinks on failure.** A momentarily blind key set makes the maker unable to
  see its own rungs, and it would post the whole ladder again.

## Install

Build the zip, then either `mds action:install file:/path/to/PandaDEX_<version>.mds.zip` or upload
it through MiniHub at `https://<your-node>:9003`.

## Build

```
./build.sh
```

It runs the tests, refuses on version drift between `dapp.conf` and `index.html`, refuses to
overwrite an existing artifact, checks that everything loaded at runtime is shipped and everything
shipped is loaded, and writes `dapp.conf` into the zip first.

## Release status

The order-book path is the one the native app has settled real mainnet trades on. The composite
book+pool path is implemented and proven on a private chain, but it is **still behind the real-funds
dust gate** in the native repo's `contract/COMPOSITE_LIVE_INTEROP.md` — that test must be run by
hand on real devices. Until it passes, treat blended fills as unproven on mainnet.

## License

See `LICENSE`.
