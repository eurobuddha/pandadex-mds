/* history.js — what ACTUALLY happened to a coin, read from the transaction that spent it.
 *
 * Everything else in this app infers a verdict from the current UTXO set: the order coin is gone,
 * and some coin at the payout address looks like it could explain that. Exclusive matching
 * (verifier.js) makes that inference honest, but it cannot rescue the case where the payout has
 * already been SPENT ONWARD — there is no unspent coin left to point at, so a real fill reads
 * UNKNOWN and is dropped.
 *
 * That case is not rare, it is the common one for your own orders: the market maker spends its
 * proceeds immediately to fund the next rung. The fills most likely to be lost are exactly the
 * ones you most want recorded.
 *
 * `history` records TRANSACTIONS, not the current UTXO set, so it still holds the answer long
 * after the proceeds have moved. Find the transaction whose inputs include the order coin and read
 * its outputs: a payout of `wantAmt` in `wantTok` to the order's payout address means FILLED; a
 * refund of `locked` in `lockedTok` means CANCELLED. Order-linked and definitive — no amount
 * coincidence between two orders can confuse it.
 *
 * `history relevant:true` only returns transactions relevant to this wallet, which is precisely the
 * set worth spending calls on: our own orders, and orders we filled ourselves. A stranger's order
 * filled by another stranger never appears, and correctly falls back to payout evidence.
 *
 * It also answers something nothing else can: a cancel posted from ANOTHER device on the same seed.
 * That transaction is wallet-relevant here, so this node sees it — where the local cancel log,
 * which only knows what this app submitted, would read it as a fill.
 *
 * PAGING. An unbounded `history` reply is one of the queries that comes back empty rather than
 * erroring when it exceeds the node's ~256KB cap. The paging discipline below is lifted from
 * pandapools-mds/history.js, which has been carrying it on mainnet: start small, halve on a bad
 * page and retry the same offset, and at max:1 skip past the single oversized transaction so it
 * cannot stall everything behind it. NO TIMERS — the service scope has none (see signlock.js).
 */
var PandaHistory = PandaHistory || {};
(function (H) {

  H.PAGE_MAX = 8;        /* transactions per page to start with */
  H.MAX_FETCHES = 12;    /* hard ceiling on node calls for one lookup */
  H.MAX_SKIP = 3;        /* consecutive oversized transactions we will step over */

  H.same = function (a, b) { return String(a || "").toUpperCase() === String(b || "").toUpperCase(); };
  H.isMinima = function (tok) { return !tok || String(tok).toUpperCase() === "0X00" || String(tok) === "0x00"; };
  H.value = function (coin) {
    if (!coin) return "0";
    return H.isMinima(coin.tokenid) ? String(coin.amount || "0") : String(coin.tokenamount || coin.amount || "0");
  };
  H.coinsOf = function (tx, which) {
    var body = tx && tx.body, txn = body && body.txn, arr = txn && txn[which];
    return Array.isArray(arr) ? arr : [];
  };

  /* Pure: given the spending transaction's outputs, what happened to this order?
     Returns "FILLED", "CANCELLED", or null when the outputs say neither. */
  H.verdictFor = function (outputs, order, eq) {
    var i, o, addr, tok, val;
    for (i = 0; i < (outputs || []).length; i++) {
      o = outputs[i];
      addr = o && (o.address || o.miniaddress);
      if (!H.same(addr, order.wantAddr)) continue;
      tok = o.tokenid || "0x00"; val = H.value(o);
      /* the taker paid the maker what the order asked for */
      if (H.same(tok, order.wantTok) && eq(val, order.wantAmt)) return "FILLED";
      /* the owner took their own funds back */
      if (H.same(tok, order.lockedTok) && eq(val, order.locked)) return "CANCELLED";
    }
    return null;
  };

  /* Walk recent wallet history until every wanted coinid is accounted for, or the budget runs out.
     cb({coinid: {txpowid, outputs}}) — only coins actually found are present. */
  H.findSpends = function (cmd, coinids, cb) {
    var wanted = {}, found = {}, remaining = 0, i,
        state = { pageMax: H.PAGE_MAX, fetches: 0, skips: 0 };
    for (i = 0; i < (coinids || []).length; i++) { if (!wanted[coinids[i]]) { wanted[coinids[i]] = true; remaining++; } }
    if (!remaining) return cb({});

    function page(offset) {
      if (state.fetches++ >= H.MAX_FETCHES) return cb(found);
      cmd("history relevant:true max:" + state.pageMax + " offset:" + offset, function (reply) {
        var resp = (reply && reply.status) ? reply.response : null,
            txpows = resp && Array.isArray(resp.txpows) ? resp.txpows : null,
            got, j, k, tx, ins, outs, id;
        /* A dropped or over-cap page: halve and ask again for the SAME offset. */
        if (!txpows) {
          if (state.pageMax > 1) { state.pageMax = Math.max(1, Math.floor(state.pageMax / 2)); return page(offset); }
          if (++state.skips <= H.MAX_SKIP) return page(offset + 1);
          return cb(found);
        }
        state.skips = 0;
        got = txpows.length;
        for (j = 0; j < got && remaining > 0; j++) {
          tx = txpows[j];
          ins = H.coinsOf(tx, "inputs");
          outs = H.coinsOf(tx, "outputs");
          for (k = 0; k < ins.length; k++) {
            id = ins[k] && ins[k].coinid;
            if (id && wanted[id] && !found[id]) {
              found[id] = { txpowid: (tx && tx.txpowid) || "", outputs: outs };
              remaining--;
            }
          }
        }
        if (!remaining) return cb(found);
        if (got < state.pageMax) return cb(found);   /* reached the end of history */
        page(offset + got);
      });
    }
    page(0);
  };

})(PandaHistory);
