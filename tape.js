var PandaTape = PandaTape || {};
(function (T, P) {
  T.MISS_GRACE = 2;
  T.MISS_GRACE_SUSPECT = 4;
  T.MAX_VANISH_PER_SCAN = 2;
  T.VANISH_AGE = P.SCAN_DEPTH - 80;
  T.STALE_PREV_MS = 4 * 60 * 1000;
  T.esc = function (v) { return String(v).replace(/'/g, "''"); };
  T.identity = function (o) { return o.orderId + "|" + o.ownerPk + "|" + o.wantAddr + "|" + (o.sell ? "s" : "b"); };
  T.bookMap = function (book) { var out = {}, i; for (i = 0; i < (book || []).length; i++) out[book[i].coinid] = book[i]; return out; };
  T.minimaDelta = function (old, successor) {
    var d = old.locked.sub(successor.locked), price;
    if (old.sell) return d;
    price = old.price;
    if (!price || !price.gt(0)) return P.d(0);
    return d.div(price).toDecimalPlaces(P.DP, Decimal.ROUND_DOWN);
  };
  T.newDiff = function (cancelLog, staleMs) {
    return { prev:null, prevAtMs:0, missing:{}, cancels:cancelLog || null, staleMs:staleMs || T.STALE_PREV_MS };
  };
  T.ingest = function (state, bookArr, truncated, chainBlock, sink, nowMs) {
    var book, now, stale, id, vanished = 0, prevCount = 0, bookEmptied, massVanish, needed,
      byIdentity = {}, i, o, ident, list, emitted = 0, coinid, old, candidates, successor,
      cmp, misses, next = {};
    if (!state) return;
    if (truncated || chainBlock <= 0) return;
    book = T.bookMap(bookArr);
    now = nowMs || Date.now();
    stale = state.prevAtMs > 0 && now - state.prevAtMs > state.staleMs;
    if (!state.prev || stale) {
      state.prev = book;
      state.prevAtMs = now;
      state.missing = {};
      return;
    }
    for (id in state.prev) if (state.prev.hasOwnProperty(id)) {
      prevCount++;
      if (!book[id]) vanished++;
    }
    bookEmptied = (bookArr || []).length === 0 && prevCount > 0;
    massVanish = vanished > T.MAX_VANISH_PER_SCAN && vanished * 2 > prevCount;
    needed = (bookEmptied || massVanish) ? T.MISS_GRACE_SUSPECT : T.MISS_GRACE;
    if (bookEmptied && vanished > T.MAX_VANISH_PER_SCAN) {
      state.prevAtMs = now;
      return;
    }
    for (i = 0; i < (bookArr || []).length; i++) {
      o = bookArr[i];
      ident = T.identity(o);
      if (!byIdentity[ident]) byIdentity[ident] = [];
      byIdentity[ident].push(o);
    }
    for (coinid in state.prev) if (state.prev.hasOwnProperty(coinid)) {
      old = state.prev[coinid];
      if (book[coinid]) continue;
      candidates = byIdentity[T.identity(old)];
      successor = candidates && candidates.length === 1 ? candidates[0] : null;
      if (successor && (state.prev[successor.coinid] || Number(successor.created || 0) < Number(old.created || 0))) successor = null;
      if (successor && successor.coinid === coinid) continue;
      if (successor) {
        delete state.missing[coinid];
        cmp = successor.locked.cmp(old.locked);
        if (cmp < 0 && sink && sink.onFill) sink.onFill(coinid, old, T.minimaDelta(old, successor), old.price, old.sell, true);
        continue;
      }
      misses = Number(state.missing[coinid] || 0) + 1;
      state.missing[coinid] = misses;
      if (misses < needed) continue;
      delete state.missing[coinid];
      if (state.cancels && state.cancels.consume && state.cancels.consume(coinid)) continue;
      if (chainBlock - Number(old.created || 0) > P.EXPIRY) continue;
      if (chainBlock - Number(old.created || 0) >= T.VANISH_AGE) continue;
      if (emitted >= T.MAX_VANISH_PER_SCAN) {
        state.missing[coinid] = needed;
        continue;
      }
      emitted++;
      if (sink && sink.onFill) sink.onFill(coinid, old, old.minima, old.price, old.sell, false);
    }
    for (id in state.missing) if (state.missing.hasOwnProperty(id) && book[id]) delete state.missing[id];
    for (id in book) if (book.hasOwnProperty(id)) next[id] = book[id];
    for (id in state.missing) if (state.missing.hasOwnProperty(id) && state.prev[id]) next[id] = state.prev[id];
    state.prev = next;
    state.prevAtMs = now;
  };
  T.init = function (done) {
    MDS.sql("CREATE TABLE IF NOT EXISTS `market_tape` (`spentcoin` varchar(160) PRIMARY KEY, `timems` bigint, `block` bigint, `price` varchar(80), `size` varchar(80), `buy` int, `partial` int, `mine` int)", function () {
      MDS.sql("CREATE TABLE IF NOT EXISTS `my_trades` (`spentcoin` varchar(160) PRIMARY KEY, `timems` bigint, `block` bigint, `price` varchar(80), `size` varchar(80), `buy` int, `maker` int, `orderid` varchar(160))", function () {
        T.migrateEvidence(done);
      });
    });
  };
  /* Evidence columns, added after the table shipped. Probe first and only ALTER when the column
     is genuinely absent: a bare ALTER on every launch is noise at best, and on a restricted node
     each unnecessary statement is another approval prompt. Each column is independent, so a
     failure on one does not abandon the rest. */
  T.EVIDENCE_COLUMNS = [
    ["txpowid", "varchar(160)"], ["source_kind", "varchar(16)"], ["source_coinids", "text"],
    ["proceeds_coinid", "varchar(160)"], ["verification_status", "varchar(32)"],
    ["verification_note", "varchar(400)"], ["verified_block", "bigint"]
  ];
  T.migrateEvidence = function (done, idx) {
    var i = idx || 0, col;
    if (i >= T.EVIDENCE_COLUMNS.length) { if (done) done(); return; }
    col = T.EVIDENCE_COLUMNS[i];
    MDS.sql("SELECT `" + col[0] + "` FROM `my_trades` LIMIT 1", function (probe) {
      if (probe && probe.status) return T.migrateEvidence(done, i + 1);
      MDS.sql("ALTER TABLE `my_trades` ADD COLUMN `" + col[0] + "` " + col[1], function () { T.migrateEvidence(done, i + 1); });
    });
  };
  T.insertOnce = function (table, row, done) {
    MDS.sql("SELECT `spentcoin` FROM `" + table + "` WHERE `spentcoin`='" + T.esc(row.spentcoin) + "'", function (found) {
      if (found && found.status && found.rows && found.rows.length) { if (done) done(false); return; }
      MDS.sql("INSERT INTO `" + table + "` (`spentcoin`,`timems`,`block`,`price`,`size`,`buy`,`" + (table === "market_tape" ? "partial`,`mine" : "maker`,`orderid") + "`) VALUES ('" +
        T.esc(row.spentcoin) + "'," + Number(row.timems || Date.now()) + "," + Number(row.block || 0) + ",'" +
        T.esc(P.plain(row.price)) + "','" + T.esc(P.plain(row.size)) + "'," + (row.buy ? 1 : 0) + "," +
        (table === "market_tape" ? ((row.partial ? 1 : 0) + "," + (row.mine ? 1 : 0)) : ((row.maker ? 1 : 0) + ",'" + T.esc(row.orderid || "") + "'")) + ")", function (res) {
          MDS.sql("DELETE FROM `" + table + "` WHERE `spentcoin` NOT IN (SELECT `spentcoin` FROM `" + table + "` ORDER BY `timems` DESC LIMIT 8000)", function () {});
          if (done) done(!!(res && res.status));
        });
    });
  };
  T.addFill = function (row, done) { T.insertOnce("market_tape", row, done); };
  T.addMyTrade = function (row, done) { T.insertOnce("my_trades", row, done); };
  T.tapeRows = function (limit, done) {
    MDS.sql("SELECT `timems`,`price`,`size`,`buy`,`mine` FROM `market_tape` ORDER BY `timems` DESC LIMIT " + Number(limit || 120), function (res) {
      var out = [], rows = res && res.rows || [], i, r;
      for (i = 0; i < rows.length; i++) { r = rows[i]; out.push({timems:Number(r.TIMEMS || 0), price:r.PRICE || "0", size:r.SIZE || "0", buy:Number(r.BUY || 0) === 1, mine:Number(r.MINE || 0) === 1}); }
      done(out);
    });
  };
  T.fillsSince = function (sinceMs, limit, done) {
    MDS.sql("SELECT `timems`,`price`,`size`,`buy`,`mine` FROM `market_tape` WHERE `timems`>=" + Number(sinceMs || 0) + " ORDER BY `timems` ASC LIMIT " + Number(limit || 8000), function (res) {
      var out = [], rows = res && res.rows || [], i, r;
      for (i = 0; i < rows.length; i++) { r = rows[i]; out.push({timems:Number(r.TIMEMS || 0), price:r.PRICE || "0", size:r.SIZE || "0", buy:Number(r.BUY || 0) === 1, mine:Number(r.MINE || 0) === 1}); }
      done(out);
    });
  };
  T.lastFill = function (done) {
    MDS.sql("SELECT `timems`,`price`,`size`,`buy`,`mine` FROM `market_tape` ORDER BY `timems` DESC LIMIT 1", function (res) {
      var rows = res && res.rows || [], r;
      if (!rows.length) return done(null);
      r = rows[0];
      done({timems:Number(r.TIMEMS || 0), price:r.PRICE || "0", size:r.SIZE || "0", buy:Number(r.BUY || 0) === 1, mine:Number(r.MINE || 0) === 1});
    });
  };
  T.myTrades = function (limit, done) {
    /* H2 hands column names back UPPERCASED. */
    MDS.sql("SELECT `timems`,`block`,`spentcoin`,`price`,`size`,`buy`,`maker`,`orderid`,`txpowid`,`source_kind`,`verification_status`,`verification_note` FROM `my_trades` ORDER BY `timems` DESC LIMIT " + Number(limit || 200), function (res) {
      var out = [], rows = res && res.rows || [], i, r;
      for (i = 0; i < rows.length; i++) { r = rows[i]; out.push({timems:Number(r.TIMEMS || 0), block:Number(r.BLOCK || 0), spentcoin:r.SPENTCOIN || "", price:r.PRICE || "0", size:r.SIZE || "0", buy:Number(r.BUY || 0) === 1, maker:Number(r.MAKER || 0) === 1, orderid:r.ORDERID || "", txpowid:r.TXPOWID || "", source_kind:r.SOURCE_KIND || "", verification_status:r.VERIFICATION_STATUS || "", verification_note:r.VERIFICATION_NOTE || ""}); }
      done(out);
    });
  };
})(PandaTape, PandaDEX);
