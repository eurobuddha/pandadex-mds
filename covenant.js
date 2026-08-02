/* Shared V5 constants and exact, decimal-safe order parsing. */
var PandaDEX = PandaDEX || {};
(function (P) {
  P.USDT = "0x7D39745FBD29049BE29850B55A18BF550E4D442F930F86266E34193D89042A90";
  P.ADDR = "0x2D43279DD85DABCA3EA90C9997DAB9169D8B7A0E8CB594236AF44542489774A5";
  /* HORIZON is the node's own visibility ceiling (MINIMA_CASCADE_START_DEPTH): a light node cannot
     see a coin older than this, which is why EXPIRY must sit well under it — an order has to be
     able to expire AND still be visible long enough for anyone to sweep it home.
     SCAN_DEPTH must exceed EXPIRY or expired orders are simply never seen: at 600 the collect-
     expired path could never fire, because a coin only becomes collectable at the exact age the
     scan stopped looking. 1000 keeps us under the 1024 trim, as native does.
     RENEW_AT is when a GTC order starts trying to renew. Native renews from age 200, leaving ~5.5h
     of retries. MDS has no Doze-proof watcher and only runs while the node is up, so the wide
     margin matters more here, not less. */
  P.HORIZON = 1024; P.EXPIRY = 600; P.RENEW_AT = 200; P.SCAN_DEPTH = 1000; P.MAX_ORDERS = 5;
  P.MIN_ORDER = "0.01"; P.DP = 8; P.PRICE_DP = 12;
  Decimal.set({ precision: 40, rounding: Decimal.ROUND_DOWN, toExpNeg: -1000000000, toExpPos: 1000000000 });
  P.d = function (v) { return new Decimal(v === undefined || v === null || v === "" ? 0 : v); };
  P.plain = function (v) { return P.d(v).toFixed(); };
  P.down = function (v, dp) { return P.d(v).toDecimalPlaces(dp, Decimal.ROUND_DOWN); };
  P.up = function (v, dp) { return P.d(v).toDecimalPlaces(dp, Decimal.ROUND_CEIL); };
  P.eqTok = function (a, b) { return String(a || "0x00").toUpperCase() === String(b || "0x00").toUpperCase(); };
  P.state = function (coin, port) {
    var s = coin && coin.state, i, e;
    if (s && !Array.isArray(s) && s[String(port)] !== undefined) return String(s[String(port)]);
    if (Array.isArray(s)) for (i = 0; i < s.length; i++) { e = s[i]; if (e && Number(e.port) === port) return String(e.data); }
    return null;
  };
  P.order = function (coin) {
    try {
      var p0=P.state(coin,0), p1=P.state(coin,1), p2=P.state(coin,2), p3=P.state(coin,3), p4=P.state(coin,4);
      if (!coin || !coin.coinid || !p0 || !p1 || !p2 || !p4) return null;
      var sell = P.state(coin,5) !== "0", tok = coin.tokenid || "0x00";
      var locked = P.d((P.eqTok(tok,"0x00") ? coin.amount : (coin.tokenamount || coin.amount)) || 0), want=P.d(p2);
      var o = { coinid:coin.coinid, ownerPk:p0, wantAddr:p1, wantAmt:want, wantTok:p3 || "0x00", orderId:p4,
        sell:sell, gtc:P.state(coin,7)==="1", minRem:P.d(P.state(coin,8)||0), locked:locked, lockedTok:tok,
        created:Number(coin.created||0) };
      if (!o.locked.gt(0) || !o.wantAmt.gt(0) || !P.fillable(o)) return null;
      o.minima = sell ? locked : want; o.usdt = sell ? want : locked;
      o.price = o.usdt.div(o.minima);
      return o;
    } catch (ignore) { return null; }
  };
  P.fillable = function (o) {
    var expectedWant=o.sell ? P.USDT : "0x00", expectedLock=o.sell ? "0x00" : P.USDT;
    return P.eqTok(o.wantTok, expectedWant) && P.eqTok(o.lockedTok, expectedLock) &&
      /^0x[0-9a-f]{64}$/i.test(o.wantAddr) && !P.eqTok(o.wantAddr,P.ADDR) &&
      o.locked.decimalPlaces() <= P.DP && o.wantAmt.decimalPlaces() <= P.DP && o.minRem.decimalPlaces() <= P.DP && !o.minRem.lt(0);
  };
  P.script = "LET u="+P.USDT+" IF (@TOKENID NEQ 0x00 AND @TOKENID NEQ u) OR (PREVSTATE(3) NEQ 0x00 AND PREVSTATE(3) NEQ u) THEN RETURN FALSE ENDIF IF SIGNEDBY(PREVSTATE(0)) THEN IF GETOUTADDR(@INPUT) EQ @ADDRESS THEN IF SAMESTATE(0 1) AND SAMESTATE(3 5) AND SAMESTATE(7 8) AND STATE(2) GT 0 AND VERIFYOUT(@INPUT @ADDRESS @AMOUNT @TOKENID TRUE) THEN RETURN TRUE ENDIF ENDIF IF VERIFYOUT(@INPUT PREVSTATE(1) @AMOUNT @TOKENID FALSE) THEN RETURN TRUE ENDIF ENDIF IF @COINAGE GT 600 THEN RETURN VERIFYOUT(@INPUT PREVSTATE(1) @AMOUNT @TOKENID FALSE) ENDIF LET w=PREVSTATE(2) LET r=0 IF @TOTOUT GT @INPUT+1 THEN IF GETOUTADDR(@INPUT+1) EQ @ADDRESS THEN LET r=GETOUTAMT(@INPUT+1) ENDIF ENDIF IF r EQ 0 THEN RETURN VERIFYOUT(@INPUT PREVSTATE(1) w PREVSTATE(3) FALSE) ENDIF RETURN r LT @AMOUNT AND r GTE PREVSTATE(8) AND VERIFYOUT(@INPUT+1 @ADDRESS r @TOKENID TRUE) AND SAMESTATE(0 1) AND SAMESTATE(3 5) AND SAMESTATE(7 8) AND STATE(2)*@AMOUNT GTE w*r AND STATE(2) LTE w AND GETOUTADDR(@INPUT) EQ PREVSTATE(1) AND GETOUTTOK(@INPUT) EQ PREVSTATE(3) AND GETOUTAMT(@INPUT)*@AMOUNT GTE w*(@AMOUNT-r)";
})(PandaDEX);
