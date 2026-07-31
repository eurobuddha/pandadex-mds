/* Android MarketPrice port for MDS. ES5, cached, rate-limited, no chain writes. */
var PandaPrice = PandaPrice || {};
(function (X) {
  X.DEPTH_URL = "https://api.mexc.com/api/v3/depth?symbol=MINIMAUSDT&limit=20";
  X.BOOK_URL = "https://api.mexc.com/api/v3/ticker/bookTicker?symbol=MINIMAUSDT";
  X.FRESH_MS = 5 * 60 * 1000;
  X.FETCH_GAP_MS = 30 * 1000;
  X.DEPTH_MIN_USDT = 25;
  X.MAX_SPREAD = 0.20;
  X.WITHDRAW_MS = 20 * 60 * 1000;
  X.WIDEN_FULL_MS = 15 * 60 * 1000;
  X.MAX_WIDEN = 6;
  X.midValue = 0;
  X.fetchedAt = 0;
  X.lastTryMs = 0;
  X.fetching = false;
  X.lastError = "";
  X.mid = function () { return Number(X.midValue || 0); };
  X.ageMs = function () { var a; if (!X.fetchedAt) return 9007199254740991; a = Date.now() - Number(X.fetchedAt); return a < 0 ? 9007199254740991 : a; };
  X.fresh = function () { return X.mid() > 0 && X.ageMs() <= X.FRESH_MS; };
  X.mustWithdraw = function () { return X.mid() <= 0 || X.ageMs() >= X.WITHDRAW_MS; };
  X.widenFactor = function () {
    var age = X.ageMs(), t;
    if (age >= 9007199254740991) return X.MAX_WIDEN;
    if (age <= X.FRESH_MS) return 1;
    if (age >= X.WIDEN_FULL_MS) return X.MAX_WIDEN;
    t = (age - X.FRESH_MS) / (X.WIDEN_FULL_MS - X.FRESH_MS);
    return 1 + t * (X.MAX_WIDEN - 1);
  };
  X.stateLabel = function () {
    var age = X.ageMs(), ago;
    if (X.mid() <= 0 || age >= 9007199254740991) return "no price feed" + (X.lastError ? " — " + X.lastError : "");
    if (age >= X.WITHDRAW_MS) return "feed stale — withdrawn";
    ago = age < 60000 ? Math.floor(age / 1000) + "s ago" : Math.floor(age / 60000) + "m ago";
    return age > X.FRESH_MS ? "feed " + ago + " — quoting wider" : "feed " + ago;
  };
  X.effectiveLevel = function (side) {
    var cum = 0, i, row, px, qty;
    if (!side || !side.length) return 0;
    for (i = 0; i < side.length; i++) {
      row = side[i]; if (!row || row.length < 2) return 0;
      px = Number(row[0]); qty = Number(row[1]);
      if (!(px > 0) || !(qty > 0)) return 0;
      cum += px * qty;
      if (cum >= X.DEPTH_MIN_USDT) return px;
    }
    return 0;
  };
  X.http = function (url, done) {
    var xhr, called = false;
    function finish(err, json) { if (called) return; called = true; done(err, json); }
    try {
      xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.timeout = 10000;
      xhr.onreadystatechange = function () {
        var body, json;
        if (xhr.readyState !== 4) return;
        if (xhr.status < 200 || xhr.status >= 300) return finish("HTTP " + xhr.status);
        body = xhr.responseText || "";
        if (body.length > 16384) body = body.substring(0, 16384);
        try { json = JSON.parse(body); } catch (e) { return finish("bad JSON"); }
        finish(null, json);
      };
      xhr.onerror = function () { finish("network error"); };
      xhr.ontimeout = function () { finish("timeout"); };
      xhr.send();
    } catch (e) { finish(e && e.message || "network error"); }
  };
  X.accept = function (bid, ask) {
    var mid;
    if (!(bid > 0) || !(ask > 0) || bid > ask) throw "thin/empty book";
    if ((ask - bid) / ask >= X.MAX_SPREAD) throw "spread too wide — book too thin to quote";
    mid = (ask + bid) / 2;
    if (!(mid > 0) || !isFinite(mid)) throw "bad price";
    X.midValue = mid;
    X.fetchedAt = Date.now();
    X.lastError = "";
  };
  X.refreshAsync = function (done) {
    var now = Date.now();
    if (X.fetching || now - X.lastTryMs < X.FETCH_GAP_MS) { if (done) done(null, X.mid()); return; }
    X.fetching = true; X.lastTryMs = now;
    X.http(X.DEPTH_URL, function (err, depth) {
      var bid, ask;
      if (!err) {
        try {
          bid = X.effectiveLevel(depth && depth.bids);
          ask = X.effectiveLevel(depth && depth.asks);
          X.accept(bid, ask);
          X.fetching = false; if (done) done(null, X.mid()); return;
        } catch (e1) { err = String(e1); }
      }
      X.http(X.BOOK_URL, function (err2, book) {
        try {
          if (err2) throw err2;
          X.accept(Number(book && book.bidPrice || 0), Number(book && book.askPrice || 0));
          X.fetching = false; if (done) done(null, X.mid()); return;
        } catch (e2) {
          X.lastError = String(e2);
          X.fetching = false; if (done) done(X.lastError);
        }
      });
    });
  };
})(PandaPrice);
