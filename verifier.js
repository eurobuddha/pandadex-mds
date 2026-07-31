/* Android FillVerifier port: full-vanish fill vs cancel adjudication. */
var PandaVerify = PandaVerify || {};
(function (V, P) {
  V.EVIDENCE_BLOCKS = 12;
  V.CANCELLED = "CANCELLED";
  V.FILLED = "FILLED";
  V.UNKNOWN = "UNKNOWN";
  V.sameToken = function (a, b) { return String(a || "0x00").toUpperCase() === String(b || "0x00").toUpperCase(); };
  V.coinValue = function (coin) { var tok = coin && coin.tokenid || "0x00"; return P.d(!V.sameToken(tok, "0x00") ? (coin.tokenamount || coin.amount || 0) : (coin.amount || 0)); };
  V.rows = function (reply) {
    var r = reply && reply.response;
    if (Array.isArray(r)) return r;
    if (r && Array.isArray(r.coins)) return r.coins;
    return null;
  };
  V.adjudicate = function (reply, order, seenBlock) {
    var arr = V.rows(reply), refund = false, payment = false, earliest, i, c, tok, amt;
    if (!arr || !order) return V.UNKNOWN;
    earliest = Math.max(Number(order.created || 0), Number(seenBlock || 0) - V.EVIDENCE_BLOCKS);
    for (i = 0; i < arr.length; i++) {
      c = arr[i]; if (!c) continue;
      if (Number(c.created || 0) < earliest) continue;
      tok = c.tokenid || "0x00"; amt = V.coinValue(c);
      if (!amt.gt(0)) continue;
      if (V.sameToken(tok, order.lockedTok) && amt.eq(order.locked)) refund = true;
      else if (V.sameToken(tok, order.wantTok) && amt.eq(order.wantAmt)) payment = true;
    }
    if (refund && !payment) return V.CANCELLED;
    if (payment) return V.FILLED;
    return V.UNKNOWN;
  };
  V.verify = function (cmd, order, seenBlock, done) {
    if (!order || !order.wantAddr) return done(V.UNKNOWN);
    cmd("coins simplestate:true address:" + order.wantAddr + " coinage:0 depth:" + V.EVIDENCE_BLOCKS, function (reply) {
      if (!reply || !reply.status) return done(V.UNKNOWN);
      done(V.adjudicate(reply, order, seenBlock));
    });
  };
})(PandaVerify, PandaDEX);
