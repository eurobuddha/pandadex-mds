/* ES5 service: the sole chain/transaction owner. Never touches the DOM. */
MDS.load("decimal.js"); MDS.load("covenant.js"); MDS.load("book.js"); MDS.load("txn.js"); MDS.load("tape.js"); MDS.load("maker.js"); MDS.load("price.js"); MDS.load("verifier.js"); MDS.load("pending.js"); MDS.load("stats.js");

var PDService = { book:[], block:0, identity:null, keyset:{}, addrset:{}, ready:false, scanning:false, busy:false,
  pendingRows:[], pendingRefs:{}, filling:{}, stage:"", fillCoins:null, fillBlock:0, fillMeta:null, tape:[], myTrades:[],
  stats:{last:null, changePct:null, high:null, low:null, volume:"0", lastFill:null},
  cancelled:{}, diff:null, restQueue:null, restQueueCoins:null, restQueueBlock:0,
  maker:{cfg:null, working:false, lastCycleMs:0, pendingIdle:null}, processor:{working:false} };
PDService.SWEEP_DEADLINE_BLOCKS = 6;
PDService.MAKER_MIN_CYCLE_MS = 60000;
PDService.MAKER_MAX_ACTIONS = 4;
PDService.MAKER_MAX_CREATES_SIDE = 1;
PDService.MAKER_PATIENCE_BLOCKS = 4;
PDService.MAKER_TOMBSTONE_BLOCKS = 10;
PDService.tell = function(type, data) {
  /* solo messages are echoed to every MiniDapp component, including this service.
     The origin field prevents an echoed STATE/POSTED update becoming a command. */
  MDS.comms.solo(JSON.stringify({origin:"service", type:type, data:data || {}}), function(){});
};
PDService.notify = function(message) {
  try { if (MDS.notify) MDS.notify(String(message || "")); } catch (ignore) {}
};
PDService.notifyPending = function(event) {
  var row, side, line;
  if (!event || !event.row) return;
  row = event.row;
  side = row.buy ? "Buy " : "Sell ";
  line = side + PandaDEX.plain(row.minima) + " MINIMA @ " + PandaDEX.plain(row.price);
  if (event.type === "live") PDService.notify("Order live: " + line + " is on the order book");
  else if (event.type === "settled" && row.kind === PandaPending.CANCEL) PDService.notify("Order cancelled: funds are back in your wallet");
  else if (event.type === "settled" && row.kind === PandaPending.EDIT) PDService.notify("New price live: " + line);
};
PDService.cmd = function(command, callback) { MDS.cmd(command, function(result) { callback(result || {status:false,error:"No node response"}); }); };
PDService.escSql = function(value) { return String(value).replace(/'/g, "''"); };
PDService.maybeDec = function(value) {
  try {
    if (value === undefined || value === null || value === "" || value === "—") return null;
    return PandaDEX.d(value);
  } catch (ignore) {
    return null;
  }
};
PDService.dec = function(value, fallback) {
  var d = PDService.maybeDec(value);
  if (d) return d;
  d = PDService.maybeDec(fallback === undefined ? 0 : fallback);
  return d || PandaDEX.d(0);
};
PDService.rebuildPendingRefs = function() { PDService.pendingRefs = PandaPending.refs(PDService.pendingRows); };
PDService.pendingInit = function(done) {
  MDS.sql("CREATE TABLE IF NOT EXISTS `pending_state` (`id` int primary key, `json` clob)", function() {
    MDS.sql("SELECT `json` FROM `pending_state` WHERE `id`=1", function(result) {
      var rows = result && result.rows, raw = [], i;
      try { if (rows && rows.length) raw = JSON.parse(rows[0].json || rows[0].JSON || "[]"); } catch (ignore) { raw = []; }
      PDService.pendingRows = [];
      for (i = 0; i < raw.length; i++) PDService.pendingRows.push(PandaPending.clean(raw[i]));
      PDService.rebuildPendingRefs();
      if (done) done();
    });
  });
};
PDService.savePending = function(done) {
  var json = PDService.escSql(JSON.stringify(PDService.pendingRows || []));
  MDS.sql("DELETE FROM `pending_state` WHERE `id`=1", function() {
    MDS.sql("INSERT INTO `pending_state` (`id`,`json`) VALUES (1,'" + json + "')", function() { if (done) done(); });
  });
};
PDService.pendingMessage = function(type, row) {
  if (!row) return "";
  if (type === "live") return "Order is live on the book";
  if (type === "settled" && row.kind === PandaPending.CANCEL) return "Order cancelled — funds are returning to your wallet";
  if (type === "settled" && row.kind === PandaPending.EDIT) return "New price is live on the book";
  if (type === "gaveup" && row.kind === PandaPending.PLACE) return "Never saw that order rest on the book — it may have been taken immediately. Check Orders and your balance.";
  if (type === "gaveup") return "Still no confirmation for that request — check Orders and your balance.";
  return "";
};
PDService.addPending = function(kind, row, done) {
  var next = PandaPending.clean({
    kind:kind, orderId:row && row.orderId, coinid:row && row.coinid, buy:row && row.buy,
    minima:row && row.minima, price:row && row.price, submitMs:Date.now(), submitBlock:PDService.block
  });
  PDService.pendingRows.push(next);
  PDService.rebuildPendingRefs();
  PDService.savePending(function() { PDService.snapshot(); if (done) done(); });
};
PDService.addPendingRows = function(rows, done) {
  var i;
  rows = rows || [];
  for (i = 0; i < rows.length; i++) PDService.pendingRows.push(PandaPending.clean(rows[i]));
  PDService.rebuildPendingRefs();
  PDService.savePending(function() { PDService.snapshot(); if (done) done(); });
};
PDService.isMine = function(order) { return !!(order && PDService.keyset[order.ownerPk]); };
PDService.owns = function(order) { return !!(order && PDService.keyset[order.ownerPk] && (PDService.emptyMap(PDService.addrset) || PDService.addrset[order.wantAddr])); };
PDService.emptyMap = function(map) { var k; for (k in map) if (map.hasOwnProperty(k)) return false; return true; };
PDService.snapshot = function() {
  var mine = [], i, order;
  for (i = 0; i < PDService.book.length; i++) {
    order = PDService.book[i];
    if (PDService.owns(order)) mine.push(order);
  }
  PDService.tell("STATE", {ready:PDService.ready, block:PDService.block, identity:PDService.identity,
    book:PDService.book, mine:mine, pending:PDService.pendingRefs, pendingRows:PDService.pendingRows,
    filling:PDService.filling, stats:PDService.stats,
    stage:PDService.stage, busy:PDService.busy, tape:PDService.tape, myTrades:PDService.myTrades,
    maker:PDService.makerPublic()});
};
PDService.setStage = function(message) { PDService.stage = message || ""; PDService.snapshot(); };
PDService.loadTape = function(done) {
  PandaTape.tapeRows(120, function(tape) {
    PDService.tape = tape;
    PandaTape.myTrades(200, function(trades) {
      PDService.myTrades = trades;
      PandaTape.fillsSince(Date.now() - PandaStats.D1, 8000, function(fills) {
        PDService.stats = PandaStats.stats24h(fills, Date.now());
        PandaTape.lastFill(function(last) {
          PDService.stats.lastFill = last ? PandaStats.lastFill([last], Date.now()) : null;
          if (done) done();
        });
      });
    });
  });
};
PDService.recordFill = function() {
  var m = PDService.fillMeta;
  if (!m) return;
  PDService.fillMeta = null;
  PandaTape.addMyTrade({spentcoin:m.spentcoin, timems:Date.now(), block:PDService.block, price:m.price,
    size:m.size, buy:m.buy, maker:false, orderid:""}, function(added) {
      if (added) PDService.notify("Trade complete: " + (m.buy ? "Bought " : "Sold ") + PandaDEX.plain(m.size) + " MINIMA @ " + PandaDEX.plain(m.price) + " mxUSDT. Funds are confirming.");
      PDService.loadTape(function() { PDService.snapshot(); });
    });
};
PDService.recordObservedFill = function(spentCoin, order, size, price, takerBuy, partial) {
  var mine = PDService.owns(order);
  if (!partial) {
    return PandaVerify.verify(PDService.cmd, order, PDService.block, function(verdict) {
      if (verdict === PandaVerify.CANCELLED) { PDService.cancelled[spentCoin] = true; return; }
      PDService.recordObservedFill(spentCoin, order, size, price, takerBuy, true);
    });
  }
  PandaTape.addFill({spentcoin:spentCoin, timems:Date.now(), block:PDService.block, price:price,
    size:size, buy:takerBuy, partial:partial === true && size.lt(order.minima), mine:mine}, function() {
    if (mine) {
      PandaTape.addMyTrade({spentcoin:spentCoin, timems:Date.now(), block:PDService.block, price:price,
        size:size, buy:takerBuy, maker:true, orderid:order.orderId}, function(added) {
          if (added) PDService.notify((partial === true && size.lt(order.minima) ? "Order partially filled: " : "Order filled: ") + (order.sell ? "Sold " : "Bought ") + PandaDEX.plain(size) + " MINIMA @ " + PandaDEX.plain(price) + " mxUSDT");
          PDService.loadTape(function() { PDService.snapshot(); });
        });
    } else {
      PDService.loadTape(function() { PDService.snapshot(); });
    }
  });
};
PDService.makerDefault = function() {
  return {pegged:true, stepPct:"0.20", levelCount:3, askSize:"0", bidSize:"0", manualMid:"0",
    skewPct:"0", repricePct:"0.25", armed:false, asks:[], bids:[], slots:{}, tombstones:{}, lastActedMid:null};
};
PDService.levelIn = function(level) { return {price:PandaDEX.plain(PDService.dec(level && level.price)), sizeMinima:PandaDEX.plain(PDService.dec(level && (level.sizeMinima || level.size)))}; };
PDService.levelOut = function(level) { return {price:PDService.dec(level && level.price), sizeMinima:PDService.dec(level && level.sizeMinima)}; };
PDService.normalizeMaker = function(raw) {
  var d = PDService.makerDefault(), c = raw || {}, i;
  for (i in d) if (d.hasOwnProperty(i) && c[i] !== undefined) d[i] = c[i];
  d.pegged = d.pegged !== false; d.armed = d.armed === true;
  d.stepPct = PandaDEX.plain(PDService.dec(d.stepPct, "0.20")); d.askSize = PandaDEX.plain(PDService.dec(d.askSize)); d.bidSize = PandaDEX.plain(PDService.dec(d.bidSize));
  d.manualMid = PandaDEX.plain(PDService.dec(d.manualMid)); d.skewPct = PandaDEX.plain(PDService.dec(d.skewPct)); d.repricePct = PandaDEX.plain(PDService.dec(d.repricePct, "0.25"));
  if (PDService.dec(d.skewPct).gt(20)) d.skewPct = "20";
  if (PDService.dec(d.skewPct).lt(-20)) d.skewPct = "-20";
  if (!PDService.dec(d.repricePct).gt(0)) d.repricePct = "0.25";
  d.levelCount = Math.max(1, Math.min(PandaMaker.MAX_LEVELS, Number(d.levelCount || 3)));
  d.asks = Array.isArray(d.asks) ? d.asks : []; d.bids = Array.isArray(d.bids) ? d.bids : [];
  for (i = 0; i < d.asks.length; i++) d.asks[i] = PDService.levelIn(d.asks[i]);
  for (i = 0; i < d.bids.length; i++) d.bids[i] = PDService.levelIn(d.bids[i]);
  d.slots = d.slots && typeof d.slots === "object" ? d.slots : {}; d.tombstones = d.tombstones && typeof d.tombstones === "object" ? d.tombstones : {};
  return d;
};
PDService.makerLadderConfig = function() {
  var c = PDService.maker.cfg || PDService.makerDefault(), asks = [], bids = [], i;
  for (i = 0; i < c.asks.length && i < PandaMaker.MAX_LEVELS; i++) asks.push(PDService.levelOut(c.asks[i]));
  for (i = 0; i < c.bids.length && i < PandaMaker.MAX_LEVELS; i++) bids.push(PDService.levelOut(c.bids[i]));
  return {pegged:c.pegged, stepPct:c.stepPct, asks:asks, bids:bids, skewPct:c.skewPct, repricePct:c.repricePct};
};
PDService.makerPublic = function() {
  var c = PDService.maker.cfg || PDService.makerDefault(), desired = PDService.makerDesired(), cleanDesired = [], commitments = PandaMaker.commitments(desired), slots = 0, tombs = 0, k, i, s;
  for (i = 0; i < desired.length; i++) { s = desired[i]; cleanDesired.push({id:s.id, sell:s.sell, price:PandaDEX.plain(s.price), sizeMinima:PandaDEX.plain(s.sizeMinima)}); }
  for (k in c.slots) if (c.slots.hasOwnProperty(k)) slots++;
  for (k in c.tombstones) if (c.tombstones.hasOwnProperty(k)) tombs++;
  return {cfg:c, working:PDService.maker.working, desired:cleanDesired, commitments:{askMinima:PandaDEX.plain(commitments.askMinima), bidUsdt:PandaDEX.plain(commitments.bidUsdt)}, slots:slots, tombstones:tombs, mid:PandaDEX.plain(PDService.makerMid() || 0), feed:{mid:PandaDEX.plain(PandaPrice.mid()), label:PandaPrice.stateLabel(), fresh:PandaPrice.fresh(), mustWithdraw:PandaPrice.mustWithdraw(), widen:PandaPrice.widenFactor(), error:PandaPrice.lastError || ""}};
};
PDService.loadMaker = function(done) {
  MDS.sql("CREATE TABLE IF NOT EXISTS `maker_state` (`id` int primary key, `json` clob)", function() {
    MDS.sql("SELECT `json` FROM `maker_state` WHERE `id`=1", function(result) {
      var rows = result && result.rows, raw = null;
      try { if (rows && rows.length) raw = JSON.parse(rows[0].json || rows[0].JSON || "{}"); } catch (ignore) {}
      PDService.maker.cfg = PDService.normalizeMaker(raw);
      if (done) done();
    });
  });
};
PDService.saveMaker = function(done) {
  var json = PDService.escSql(JSON.stringify(PDService.maker.cfg || PDService.makerDefault()));
  MDS.sql("DELETE FROM `maker_state` WHERE `id`=1", function() {
    MDS.sql("INSERT INTO `maker_state` (`id`,`json`) VALUES (1,'" + json + "')", function() { if (done) done(); });
  });
};
PDService.makerMid = function() {
  var mid = PandaPrice && PandaPrice.mid ? PDService.maybeDec(PandaPrice.mid()) : null;
  return mid && mid.gt(0) ? mid.toDecimalPlaces(PandaDEX.PRICE_DP, Decimal.ROUND_HALF_UP) : null;
};
PDService.bookMid = function() {
  var bid = null, ask = null, i, o, price;
  for (i = 0; i < PDService.book.length; i++) {
    o = PDService.book[i];
    price = PDService.maybeDec(o && o.price);
    if (!price || !price.gt(0)) continue;
    if (o.sell) { if (!ask || price.lt(ask)) ask = price; }
    else { if (!bid || price.gt(bid)) bid = price; }
  }
  return bid && ask ? bid.add(ask).div(2).toDecimalPlaces(PandaDEX.PRICE_DP, Decimal.ROUND_HALF_UP) : null;
};
PDService.makerDesired = function() {
  var c = PDService.maker.cfg || PDService.makerDefault(), mid = c.pegged ? PDService.makerMid() : PDService.dec(c.manualMid);
  return PandaMaker.desired(mid, PDService.makerLadderConfig(), c.pegged ? String(PandaPrice.widenFactor()) : "1");
};
PDService.makerOwnedIds = function() {
  var c = PDService.maker.cfg || PDService.makerDefault(), ids = {}, k;
  for (k in c.slots) if (c.slots.hasOwnProperty(k)) ids[c.slots[k].orderId] = true;
  for (k in c.tombstones) if (c.tombstones.hasOwnProperty(k)) ids[k] = true;
  return ids;
};
PDService.makerLiveById = function(includeTombs) {
  var out = {}, c = PDService.maker.cfg || PDService.makerDefault(), i, o;
  for (i = 0; i < PDService.book.length; i++) {
    o = PDService.book[i];
    if (PDService.owns(o) && (includeTombs || !c.tombstones[o.orderId])) out[o.orderId] = o;
  }
  return out;
};
PDService.makerRemember = function(slot, orderId, block) {
  var c = PDService.maker.cfg; c.slots[slot.id] = {orderId:orderId, size:PandaDEX.plain(slot.sizeMinima), sentBlock:block || 0, lastActionBlock:0}; PDService.saveMaker();
};
PDService.makerForgetByOrderId = function(orderId) {
  var c = PDService.maker.cfg, k;
  for (k in c.slots) if (c.slots.hasOwnProperty(k) && c.slots[k].orderId === orderId) { delete c.slots[k]; PDService.saveMaker(); return; }
};
PDService.makerTombstone = function(orderId, createdBlock, lastAttemptBlock) {
  var c = PDService.maker.cfg, t;
  if (!orderId) return;
  t = c.tombstones[orderId];
  if (!t) c.tombstones[orderId] = {createdBlock:createdBlock || PDService.block, lastAttemptBlock:lastAttemptBlock || 0};
  else if ((lastAttemptBlock || 0) > Number(t.lastAttemptBlock || 0)) t.lastAttemptBlock = lastAttemptBlock;
  PDService.saveMaker();
};
PDService.makerSetStage = function(message) { if (message) PDService.setStage(message); };
PDService.makerRun = function(actions, idx, mid, posted, chainBlock) {
  var a, createOid, input, o, newWant;
  if (idx >= actions.length) {
    PDService.maker.working = false;
    if (posted > 0 && PDService.dec(mid).gt(0)) PDService.maker.cfg.lastActedMid = PandaDEX.plain(mid);
    PDService.saveMaker(function() { PDService.makerSetStage(posted > 0 ? "Maker: " + posted + " action" + (posted === 1 ? "" : "s") + " accepted — mining now" : "Maker: no adjustment could be posted — will retry"); PDService.snapshot(); });
    return;
  }
  PDService.maker.working = true;
  a = actions[idx];
  if (a.kind === PandaMaker.K_CREATE) {
    return PDService.cmd("random", function(rand) {
      createOid = rand && rand.status && rand.response && rand.response.random;
      if (!createOid) { PDService.makerSetStage("Maker: CREATE failed — could not create order id"); return PDService.makerRun(actions, idx + 1, mid, posted, chainBlock); }
      input = {buy:!a.slot.sell, minima:PandaDEX.plain(a.slot.sizeMinima), price:PandaDEX.plain(a.slot.price), gtc:true, minRem:PandaDEX.plain(PandaMaker.minRemainderFor(a.slot)), orderId:createOid};
      PandaTxn.create(PDService.cmd, PDService.identity, input, function(error, tx, orderId) {
        if (error) { PDService.makerSetStage("Maker: CREATE failed — " + error); return PDService.makerRun(actions, idx + 1, mid, posted, chainBlock); }
        PDService.makerRemember(a.slot, orderId, chainBlock);
        PDService.addPending(PandaPending.PLACE, {orderId:orderId, buy:!a.slot.sell, minima:input.minima, price:input.price});
        PDService.tell("POSTED", {message:"Maker rung submitted — it appears after confirmation", tx:tx});
        PDService.makerRun(actions, idx + 1, mid, posted + 1, chainBlock);
      });
    });
  }
  if (a.kind === PandaMaker.K_RELOCK) {
    o = a.order;
    newWant = o.sell ? PandaDEX.up(PDService.dec(o.locked).mul(a.slot.price), PandaDEX.DP) : PandaDEX.down(PDService.dec(o.locked).div(a.slot.price), PandaDEX.DP);
    return PandaTxn.relock(PDService.cmd, o, newWant, function(error, tx) {
      if (error) { PDService.makerSetStage("Maker: RELOCK failed — " + error); return PDService.makerRun(actions, idx + 1, mid, posted, chainBlock); }
      if (PDService.maker.cfg.slots[a.slot.id]) PDService.maker.cfg.slots[a.slot.id].lastActionBlock = chainBlock;
      PDService.saveMaker(); PDService.addPending(PandaPending.EDIT, {orderId:o.orderId, coinid:o.coinid, buy:!o.sell, minima:PandaDEX.plain(o.minima), price:PandaDEX.plain(a.slot.price)});
      PDService.tell("POSTED", {message:"Maker rung reprice submitted — mining now", tx:tx});
      PDService.makerRun(actions, idx + 1, mid, posted + 1, chainBlock);
    });
  }
  if (a.kind === PandaMaker.K_CANCEL) {
    return PandaTxn.cancel(PDService.cmd, a.order, function(error, tx) {
      if (error) { PDService.makerSetStage("Maker: CANCEL failed — " + error); return PDService.makerRun(actions, idx + 1, mid, posted, chainBlock); }
      PDService.makerForgetByOrderId(a.order.orderId); PDService.makerTombstone(a.order.orderId, chainBlock, chainBlock);
      PDService.addPending(PandaPending.CANCEL, {orderId:a.order.orderId, coinid:a.order.coinid, buy:!a.order.sell, minima:PandaDEX.plain(a.order.minima), price:PandaDEX.plain(a.order.price)});
      PDService.tell("POSTED", {message:"Maker rung cancellation submitted — mining now", tx:tx});
      PDService.makerRun(actions, idx + 1, mid, posted + 1, chainBlock);
    });
  }
  PDService.makerRun(actions, idx + 1, mid, posted, chainBlock);
};
PDService.makerOnBook = function() {
  var c = PDService.maker.cfg, now = Date.now(), mid, desired, byOrderId, liveBySlot = {}, settling = {}, partial = {}, renew = {}, postedSizes = {}, dirty = false, k, r, o, complete, actions, ids;
  if (!c || PDService.busy || PDService.maker.working) return;
  PDService.makerSweepTombstones();
  if (PDService.maker.working) return;
  if (!c.armed) return;
  if (now - PDService.maker.lastCycleMs < PDService.MAKER_MIN_CYCLE_MS) return;
  if (c.pegged && (!PDService.dec(c.stepPct).gt(0) || (!PandaMaker.hasSizedRung(PDService.makerLadderConfig().asks) && !PandaMaker.hasSizedRung(PDService.makerLadderConfig().bids)))) return;
  if (c.pegged) {
    PandaPrice.refreshAsync();
    if (PandaPrice.mustWithdraw()) {
      if (PDService.hasMakerSlots()) { PDService.setStage("Price feed stale — withdrawing the ladder"); PDService.makerWithdrawAll(false); }
      return;
    }
  }
  mid = c.pegged ? PDService.makerMid() : PDService.dec(c.manualMid);
  desired = PDService.makerDesired();
  byOrderId = PDService.makerLiveById(false);
  for (k in c.slots) if (c.slots.hasOwnProperty(k)) {
    r = c.slots[k];
    if (!r.sentBlock || r.sentBlock <= 0) { r.sentBlock = PDService.block; dirty = true; continue; }
    if (!byOrderId[r.orderId] && PDService.block - Number(r.sentBlock || 0) >= PDService.MAKER_PATIENCE_BLOCKS) { delete c.slots[k]; dirty = true; }
  }
  if (dirty) PDService.saveMaker();
  if (!desired.length) return;
  for (k in c.slots) if (c.slots.hasOwnProperty(k)) {
    r = c.slots[k]; o = byOrderId[r.orderId];
    if (!o) settling[k] = true;
    else {
      liveBySlot[k] = o;
      if (r.lastActionBlock && PDService.block - Number(r.lastActionBlock) < PDService.MAKER_PATIENCE_BLOCKS) settling[k] = true;
      postedSizes[k] = PDService.dec(r.size);
      if (PDService.dec(o.minima).lt(postedSizes[k])) partial[o.coinid] = true;
      if (o.gtc && PDService.block - Number(o.created || 0) >= PandaDEX.EXPIRY - 80) renew[k] = true;
    }
  }
  complete = true;
  for (k in settling) if (settling.hasOwnProperty(k)) complete = false;
  ids = c.tombstones; for (k in ids) if (ids.hasOwnProperty(k)) complete = false;
  for (k = 0; k < desired.length; k++) if (!liveBySlot[desired[k].id]) complete = false;
  if (c.pegged && complete && !PandaMaker.worthRepricing(c.lastActedMid, mid, c.repricePct)) return;
  actions = PandaMaker.reconcile(desired, liveBySlot, settling, renew, c.pegged ? PDService.dec(c.repricePct) : PandaDEX.d(0), partial, postedSizes, PandaMaker.budget(PDService.MAKER_MAX_ACTIONS, PDService.MAKER_MAX_CREATES_SIDE));
  if (!actions.length) return;
  PDService.maker.lastCycleMs = now;
  PDService.makerSetStage("Maker: " + actions.length + " adjustment" + (actions.length === 1 ? "" : "s") + (PDService.dec(mid).gt(0) ? " at mid " + PDService.dec(mid).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6) : ""));
  PDService.makerRun(actions, 0, mid, 0, PDService.block);
};
PDService.makerSweepTombstones = function() {
  var c = PDService.maker.cfg, mineById, done = [], target = null, k, t, o;
  if (!c || PDService.busy || PDService.maker.working) return;
  mineById = PDService.makerLiveById(true);
  for (k in c.tombstones) if (c.tombstones.hasOwnProperty(k)) {
    t = c.tombstones[k]; o = mineById[k];
    if (!o) { if (PDService.block - Number(t.createdBlock || 0) >= PDService.MAKER_TOMBSTONE_BLOCKS) done.push(k); }
    else if (!target && (!t.lastAttemptBlock || PDService.block - Number(t.lastAttemptBlock || 0) >= PDService.MAKER_PATIENCE_BLOCKS)) target = o;
  }
  for (k = 0; k < done.length; k++) delete c.tombstones[done[k]];
  if (done.length) PDService.saveMaker();
  if (!target) return;
  PDService.makerTombstone(target.orderId, PDService.block, PDService.block);
  PDService.maker.working = true; PDService.makerSetStage("Maker: cancelling a late order");
  PandaTxn.cancel(PDService.cmd, target, function(error, tx) {
    PDService.maker.working = false;
    if (!error) {
      PDService.addPending(PandaPending.CANCEL, {orderId:target.orderId, coinid:target.coinid, buy:!target.sell, minima:PandaDEX.plain(target.minima), price:PandaDEX.plain(target.price)});
      PDService.tell("POSTED", {message:"Late maker order cancellation submitted", tx:tx});
    }
    PDService.snapshot();
  });
};
PDService.hasMakerSlots = function() {
  var c = PDService.maker.cfg, k;
  if (!c) return false;
  for (k in c.slots) if (c.slots.hasOwnProperty(k)) return true;
  for (k in c.tombstones) if (c.tombstones.hasOwnProperty(k)) return true;
  return false;
};
PDService.makerCancelChunks = function(live, idx) {
  var chunk = live.slice(idx, idx + PandaDEX.MAX_ORDERS);
  if (!chunk.length) { PDService.maker.working = false; PDService.setStage("Maker withdraw submitted — orders leave as blocks confirm"); return PDService.refresh(); }
  PandaTxn.cancelBatch(PDService.cmd, chunk, function(error, tx) {
    var i;
    if (error) { for (i = 0; i < chunk.length; i++) PDService.makerTombstone(chunk[i].orderId, PDService.block, 0); PDService.tell("ERROR", {message:error}); }
    else {
      for (i = 0; i < chunk.length; i++) {
        PDService.makerTombstone(chunk[i].orderId, PDService.block, PDService.block);
        PDService.addPending(PandaPending.CANCEL, {orderId:chunk[i].orderId, coinid:chunk[i].coinid, buy:!chunk[i].sell, minima:PandaDEX.plain(chunk[i].minima), price:PandaDEX.plain(chunk[i].price)});
      }
      PDService.tell("POSTED", {message:"Maker withdraw batch submitted", tx:tx});
    }
    PDService.makerCancelChunks(live, idx + chunk.length);
  });
};
PDService.makerWithdrawAll = function(disarm) {
  var c = PDService.maker.cfg, byId = PDService.makerLiveById(true), live = [], k, r;
  if (!c) return;
  if (disarm) c.armed = false;
  for (k in c.slots) if (c.slots.hasOwnProperty(k)) {
    r = c.slots[k];
    if (byId[r.orderId]) live.push(byId[r.orderId]);
    else PDService.makerTombstone(r.orderId, PDService.block, 0);
  }
  c.slots = {}; PDService.saveMaker();
  if (!live.length) { PDService.setStage("Maker: no visible ladder orders to cancel"); return PDService.snapshot(); }
  PDService.maker.working = true; PDService.setStage("Maker: withdrawing " + live.length + " visible order" + (live.length === 1 ? "" : "s"));
  PDService.makerCancelChunks(live, 0);
};
PDService.makerWithdraw = function() { PDService.makerWithdrawAll(true); };
PDService.cancelAllRun = function(list, idx, ok, failed) {
  var chunk, i, rows = [];
  if (idx >= list.length) {
    PDService.busy = false;
    PDService.setStage(failed === 0 ? "Cancel sent for " + ok + " order" + (ok === 1 ? "" : "s") + " — each leaves the book when a block confirms it" : "Cancel sent for " + ok + "; " + failed + " could not be cancelled — check your open orders");
    return PDService.refresh();
  }
  chunk = list.slice(idx, idx + PandaDEX.MAX_ORDERS);
  PDService.busy = true;
  PDService.setStage("Cancelling " + Math.min(idx + chunk.length, list.length) + " of " + list.length + "…");
  PandaTxn.cancelBatch(PDService.cmd, chunk, function(error, tx) {
    if (error) {
      PDService.tell("ERROR", {message:"Cancel batch failed — " + error});
      return PDService.cancelAllRun(list, idx + chunk.length, ok, failed + chunk.length);
    }
    for (i = 0; i < chunk.length; i++) {
      rows.push({kind:PandaPending.CANCEL, orderId:chunk[i].orderId, coinid:chunk[i].coinid, buy:!chunk[i].sell, minima:PandaDEX.plain(chunk[i].minima), price:PandaDEX.plain(chunk[i].price), submitMs:Date.now(), submitBlock:PDService.block});
    }
    PDService.addPendingRows(rows, function() {
      PDService.tell("POSTED", {message:"Cancel batch submitted", tx:tx});
      PDService.cancelAllRun(list, idx + chunk.length, ok + chunk.length, failed);
    });
  });
};
PDService.processorInit = function(done) {
  MDS.sql("CREATE TABLE IF NOT EXISTS `processor_inflight` (`coinid` varchar(160) PRIMARY KEY, `block` bigint)", function() { if (done) done(); });
};
PDService.processorMark = function(coinid) {
  MDS.sql("DELETE FROM `processor_inflight` WHERE `coinid`='" + PDService.escSql(coinid) + "'", function() {
    MDS.sql("INSERT INTO `processor_inflight` (`coinid`,`block`) VALUES ('" + PDService.escSql(coinid) + "'," + Number(PDService.block || 0) + ")", function(){});
  });
};
PDService.processorClear = function(coinid) { MDS.sql("DELETE FROM `processor_inflight` WHERE `coinid`='" + PDService.escSql(coinid) + "'", function(){}); };
PDService.processorProcess = function() {
  if (PDService.processor.working || PDService.busy || PDService.maker.working || PDService.block <= 0) return;
  MDS.sql("SELECT `coinid`,`block` FROM `processor_inflight`", function(res) {
    var rows = res && res.rows || [], inflight = {}, present = {}, i, r, o, actions = [], mine, skip = PDService.makerOwnedIds();
    for (i = 0; i < rows.length; i++) {
      r = rows[i]; inflight[r.COINID || r.coinid] = Number(r.BLOCK || r.block || 0);
    }
    for (i = 0; i < PDService.book.length; i++) present[PDService.book[i].coinid] = true;
    for (r in inflight) if (inflight.hasOwnProperty(r)) {
      if (!present[r] || PDService.block - inflight[r] > 6) PDService.processorClear(r);
    }
    for (i = 0; i < PDService.book.length && actions.length < 2; i++) {
      o = PDService.book[i];
      if (!PDService.owns(o) || skip[o.orderId] || inflight[o.coinid]) continue;
      if (o.gtc && PDService.block - Number(o.created || 0) >= PandaDEX.EXPIRY - 80 && PDService.block - Number(o.created || 0) <= PandaDEX.EXPIRY) actions.push({kind:"renew", order:o});
      else if (PDService.block - Number(o.created || 0) > PandaDEX.EXPIRY) actions.push({kind:"collect", order:o});
    }
    if (!actions.length) return;
    PDService.processorRun(actions, 0);
  });
};
PDService.processorRun = function(actions, idx) {
  var a;
  if (idx >= actions.length) { PDService.processor.working = false; return PDService.refresh(); }
  PDService.processor.working = true;
  a = actions[idx];
  PDService.processorMark(a.order.coinid);
  if (a.kind === "renew") {
    return PandaTxn.relock(PDService.cmd, a.order, null, function(error) {
      if (error) { PDService.processorClear(a.order.coinid); PDService.notify("Couldn't renew an order: order @ " + PandaDEX.plain(a.order.price) + " — will retry"); PDService.tell("ERROR", {message:"Renewal failed for order @ " + PandaDEX.plain(a.order.price) + " — will retry"}); }
      else PDService.addPending(PandaPending.EDIT, {orderId:a.order.orderId, coinid:a.order.coinid, buy:!a.order.sell, minima:PandaDEX.plain(a.order.minima), price:PandaDEX.plain(a.order.price)});
      PDService.processorRun(actions, idx + 1);
    });
  }
  return PandaTxn.collectExpired(PDService.cmd, a.order, function(error) {
    if (error) PDService.processorClear(a.order.coinid);
    else {
      PDService.addPending(PandaPending.CANCEL, {orderId:a.order.orderId, coinid:a.order.coinid, buy:!a.order.sell, minima:PandaDEX.plain(a.order.minima), price:PandaDEX.plain(a.order.price)});
    }
    PDService.processorRun(actions, idx + 1);
  });
};
PDService.reconcileFill = function(book) {
  var i, j, coinid;
  if (!PDService.fillCoins) return;
  for (i = 0; i < PDService.fillCoins.length; i++) {
    coinid = PDService.fillCoins[i];
    if (PDService.sourceStillLive(book, coinid)) {
      if (PDService.fillBlock > 0 && PDService.block - PDService.fillBlock > PDService.SWEEP_DEADLINE_BLOCKS && !PDService.restQueueCoins) {
        PDService.fillCoins = null; PDService.fillBlock = 0; PDService.filling = {}; PDService.fillMeta = null;
        PDService.stage = "That trade never confirmed. Nothing was spent; try again.";
      }
      return;
    }
  }
  PDService.fillCoins = null; PDService.fillBlock = 0; PDService.filling = {};
  PDService.recordFill();
  if (!PDService.restQueueCoins) PDService.stage = "Trade confirmed — proceeds are confirming";
};
PDService.restReady = function(book) {
  var i, coinid;
  if (!PDService.restQueueCoins) return false;
  for (i = 0; i < PDService.restQueueCoins.length; i++) {
    coinid = PDService.restQueueCoins[i];
    if (PDService.sourceStillLive(book, coinid)) {
      if (PDService.restQueueBlock > 0 && PDService.block - PDService.restQueueBlock > PDService.SWEEP_DEADLINE_BLOCKS) {
        PDService.restQueue = null; PDService.restQueueCoins = null; PDService.restQueueBlock = 0;
        PDService.fillCoins = null; PDService.fillBlock = 0; PDService.filling = {}; PDService.fillMeta = null;
        PDService.setStage("That trade never confirmed — your resting limit order was NOT placed. Nothing was spent; try again.");
      }
      return false;
    }
  }
  return true;
};
PDService.sourceStillLive = function(book, coinid) {
  var i;
  for (i = 0; i < (book || []).length; i++) if (book[i].coinid === coinid) return true;
  return false;
};
PDService.placeRest = function() {
  var q = PDService.restQueue;
  PDService.restQueue = null; PDService.restQueueCoins = null; PDService.restQueueBlock = 0;
  if (!q) return;
  PDService.setStage("Placing the unfilled balance as a resting limit order");
  PDService.busy = true;
  PandaTxn.create(PDService.cmd, PDService.identity, q, function(error, tx, orderId) {
    PDService.busy = false;
    if (error) { PDService.setStage("Resting order failed — " + error); return PDService.tell("ERROR", {message:error}); }
    PDService.addPending(PandaPending.PLACE, {orderId:orderId, buy:!!q.buy, minima:q.minima, price:q.price});
    PDService.setStage("Resting limit order submitted — waiting for confirmation");
    PDService.tell("POSTED", {message:"Resting limit order submitted — it appears after confirmation (~50 seconds)", tx:tx});
    PDService.refresh();
  });
};
PDService.refresh = function() {
  if (PDService.scanning) return;
  PDService.scanning = true;
  PandaPrice.refreshAsync();
  PandaBook.scan(PDService.cmd, function(error, book, incomplete) {
    var resolved, i, msg, changed, visibleBook;
    PDService.scanning = false;
    if (error) return PDService.tell("ERROR", {message:error + (incomplete ? " (keeping last good book)" : "")});
    visibleBook = incomplete && PDService.book.length ? PDService.book : book;
    if (PDService.diff) PandaTape.ingest(PDService.diff, visibleBook, incomplete, PDService.block, {onFill:PDService.recordObservedFill});
    PDService.book = visibleBook;
    if (!incomplete) {
      resolved = PandaPending.resolve(PDService.pendingRows, visibleBook, Date.now());
      changed = resolved.events.length || resolved.rows.length !== PDService.pendingRows.length;
      PDService.pendingRows = resolved.rows; PDService.pendingRefs = resolved.refs;
      for (i = 0; i < resolved.events.length; i++) {
        msg = PDService.pendingMessage(resolved.events[i].type, resolved.events[i].row);
        if (msg) PDService.stage = msg;
        PDService.notifyPending(resolved.events[i]);
      }
      if (changed) PDService.savePending();
    }
    PDService.reconcileFill(visibleBook);
    PDService.makerOnBook();
    PDService.processorProcess();
    PDService.snapshot();
    if (PDService.restReady(visibleBook)) PDService.placeRest();
  });
};
PDService.scriptArg = function() { return '"' + PandaDEX.script.replace(/"/g, '\\"') + '"'; };
PDService.loadKeys = function(done) {
  PDService.keyset = {}; PDService.addrset = {};
  if (PDService.identity && PDService.identity.publickey) PDService.keyset[PDService.identity.publickey] = true;
  if (PDService.identity && PDService.identity.address) PDService.addrset[PDService.identity.address] = true;
  /* Keys rather than the current receive address identify an order owner. A later wallet
     address must not hide an order that the user can still cancel. */
  PDService.cmd("keys action:list", function(result) {
    /* Nodes return either response:[{publickey:...}] or response:{keys:[...]}. */
    var rows = result && result.response, i, entry, key;
    if (rows && !Array.isArray(rows) && Array.isArray(rows.keys)) rows = rows.keys;
    if (rows && rows.length) for (i = 0; i < rows.length; i++) {
      entry = rows[i];
      key = typeof entry === "string" ? entry : (entry.publickey || entry.key);
      if (key) PDService.keyset[key] = true;
    }
    PDService.cmd("scripts", function(scriptRows) {
      var scripts = scriptRows && scriptRows.response, j, sc, addr;
      if (scripts && !Array.isArray(scripts) && Array.isArray(scripts.scripts)) scripts = scripts.scripts;
      if (scripts && scripts.length) for (j = 0; j < scripts.length; j++) {
        sc = scripts[j]; addr = typeof sc === "string" ? sc : sc.address;
        if (addr) PDService.addrset[addr] = true;
      }
      done();
    });
  });
};
PDService.boot = function() {
  PDService.cmd("runscript script:" + PDService.scriptArg(), function(scriptResult) {
    var script = scriptResult && scriptResult.response && scriptResult.response.script;
    if (!scriptResult.status || !scriptResult.response.parseok || !script || String(script.address).toUpperCase() !== PandaDEX.ADDR.toUpperCase())
      return PDService.tell("ERROR", {message:"PandaDEX V5 covenant mismatch; trading disabled"});
    PDService.cmd("newscript trackall:false script:" + PDService.scriptArg(), function(registerResult) {
      if (!registerResult.status) return PDService.tell("ERROR", {message:registerResult.error || "Could not register covenant"});
      PDService.cmd("getaddress", function(addressResult) {
        if (!addressResult.status) return PDService.tell("ERROR", {message:addressResult.error || "Could not read wallet identity"});
        PDService.identity = {address:addressResult.response.address, publickey:addressResult.response.publickey, miniaddress:addressResult.response.miniaddress};
        PDService.loadKeys(function() {
        PandaTape.init(function() {
          PDService.diff = PandaTape.newDiff({consume:function(coinid){ return !!PDService.cancelled[coinid]; }});
          PDService.processorInit(function() {
            PDService.pendingInit(function() {
              PDService.loadMaker(function() {
                PDService.loadTape(function() {
                  PDService.ready = true;
                  PDService.cmd("block", function(blockResult) { PDService.block = Number(blockResult && blockResult.response && blockResult.response.block || 0); PDService.refresh(); });
                });
              });
            });
          });
        });
        });
      });
    });
  });
};
PDService.action = function(message) {
  var i, order = null, plan, rest, data, amountD, priceD, limitD, minRemD;
  if (message.type === "REFRESH") { if (!PDService.ready) { PDService.snapshot(); return; } return PDService.refresh(); }
  if (!PDService.ready) { PDService.setStage("PandaDEX is still starting…"); return; }
  if (PDService.busy) return PDService.tell("ERROR", {message:"A transaction is already in flight"});
  if (message.type === "CREATE") {
    data = message.data || {};
    amountD = PDService.maybeDec(data.minima); priceD = PDService.maybeDec(data.price); minRemD = PDService.dec(data.minRem);
    if (!amountD || !amountD.gt(0)) return PDService.tell("ERROR", {message:"Enter a valid MINIMA amount"});
    if (!priceD || !priceD.gt(0)) return PDService.tell("ERROR", {message:"Enter a valid price"});
    amountD = PandaDEX.down(amountD, PandaDEX.DP); minRemD = Decimal.max(PandaDEX.d(0), PandaDEX.down(minRemD, PandaDEX.DP));
    data.minima = PandaDEX.plain(amountD); data.price = PandaDEX.plain(priceD); data.minRem = PandaDEX.plain(minRemD);
    return PandaTxn.create(PDService.cmd, PDService.identity, data, function(error, tx, orderId) {
    if (error) return PDService.tell("ERROR", {message:error});
    PDService.addPending(PandaPending.PLACE, {orderId:orderId, buy:!!data.buy, minima:data.minima, price:data.price});
    PDService.tell("POSTED", {message:"Order submitted — it appears after confirmation (~50 seconds)", tx:tx}); PDService.refresh();
    });
  }
  if (message.type === "FILL") {
    data = message.data || {};
    amountD = PDService.maybeDec(data.amount); limitD = data.limit ? PDService.maybeDec(data.limit) : null;
    if (!amountD || !amountD.gt(0)) return PDService.tell("ERROR", {message:"Enter a valid MINIMA amount"});
    if (data.limit && (!limitD || !limitD.gt(0))) return PDService.tell("ERROR", {message:"Enter a valid limit price"});
    data.amount = PandaDEX.plain(PandaDEX.down(amountD, PandaDEX.DP)); if (limitD) data.limit = PandaDEX.plain(limitD);
    plan = PandaBook.plan(PDService.book, !!data.buy, data.amount, data.limit || null, PDService.block);
    if (!plan || !plan.takes || !plan.takes.length) return PDService.tell("ERROR", {message:"No eligible orders match that sweep"});
    PDService.filling = {};
    for (i = 0; i < plan.takes.length; i++) PDService.filling[plan.takes[i].order.coinid] = true;
    PDService.busy = true; PDService.setStage("Building transaction… selecting coins and signing");
    return PandaTxn.fill(PDService.cmd, PDService.identity, plan, function(error, tx) {
      PDService.busy = false;
      if (error) { PDService.filling = {}; PDService.setStage("Trade failed — " + error); return PDService.tell("ERROR", {message:error}); }
      PDService.setStage("Posted — waiting for a block to confirm your " + (data.buy ? "buy" : "sell") + " of " + PandaDEX.plain(plan.totalMinima) + " MINIMA");
      PDService.tell("POSTED", {message:"Sweep submitted — waiting for confirmation", tx:tx});
      PDService.fillCoins = [];
      for (i = 0; i < plan.takes.length; i++) PDService.fillCoins.push(plan.takes[i].order.coinid);
      PDService.fillBlock = PDService.block;
      PDService.fillMeta = {spentcoin:plan.takes[0].order.coinid, price:plan.average, size:plan.totalMinima, buy:!!data.buy};
      PDService.refresh();
    });
  }
  if (message.type === "LIMIT") {
    data = message.data || {};
    amountD = PDService.maybeDec(data.minima); priceD = PDService.maybeDec(data.price); minRemD = PDService.dec(data.minRem);
    if (!amountD || !amountD.gt(0)) return PDService.tell("ERROR", {message:"Enter a valid MINIMA amount"});
    if (!priceD || !priceD.gt(0)) return PDService.tell("ERROR", {message:"Enter a valid price"});
    amountD = PandaDEX.down(amountD, PandaDEX.DP); minRemD = Decimal.max(PandaDEX.d(0), PandaDEX.down(minRemD, PandaDEX.DP));
    data.minima = PandaDEX.plain(amountD); data.price = PandaDEX.plain(priceD); data.minRem = PandaDEX.plain(minRemD);
    plan = PandaBook.plan(PDService.book, !!data.buy, data.minima, data.price || null, PDService.block);
    if (!plan || !plan.takes || !plan.takes.length) {
      PDService.busy = true; PDService.setStage("Building transaction… selecting coins and signing");
      return PandaTxn.create(PDService.cmd, PDService.identity, data, function(error, tx, orderId) {
        PDService.busy = false;
        if (error) { PDService.setStage("Order failed — " + error); return PDService.tell("ERROR", {message:error}); }
        PDService.addPending(PandaPending.PLACE, {orderId:orderId, buy:!!data.buy, minima:data.minima, price:data.price});
        PDService.setStage("Order submitted — waiting for confirmation");
        PDService.tell("POSTED", {message:"Order submitted — it appears after confirmation (~50 seconds)", tx:tx}); PDService.refresh();
      });
    }
    PDService.filling = {};
    for (i = 0; i < plan.takes.length; i++) PDService.filling[plan.takes[i].order.coinid] = true;
    rest = PDService.dec(data.minima).sub(plan.totalMinima);
    PDService.busy = true; PDService.setStage("Building transaction… selecting coins and signing");
    return PandaTxn.fill(PDService.cmd, PDService.identity, plan, function(error, tx) {
      PDService.busy = false;
      if (error) { PDService.filling = {}; PDService.setStage("Trade failed — " + error); return PDService.tell("ERROR", {message:error}); }
      PDService.setStage("Posted — waiting for a block to confirm your " + (data.buy ? "buy" : "sell") + " of " + PandaDEX.plain(plan.totalMinima) + " MINIMA");
      PDService.tell("POSTED", {message:"Trade submitted — waiting for confirmation", tx:tx});
      if (rest.gt(0)) {
        PDService.restQueue = {buy:!!data.buy, minima:PandaDEX.plain(rest), price:data.price, gtc:data.gtc, minRem:data.minRem};
        PDService.restQueueCoins = [];
        for (i = 0; i < plan.takes.length; i++) PDService.restQueueCoins.push(plan.takes[i].order.coinid);
        PDService.restQueueBlock = PDService.block;
      }
      PDService.fillCoins = [];
      for (i = 0; i < plan.takes.length; i++) PDService.fillCoins.push(plan.takes[i].order.coinid);
      PDService.fillBlock = PDService.block;
      PDService.fillMeta = {spentcoin:plan.takes[0].order.coinid, price:plan.average, size:plan.totalMinima, buy:!!data.buy};
      PDService.refresh();
    });
  }
  if (message.type === "CANCEL") {
    data = message.data || {};
    for (i = 0; i < PDService.book.length; i++) if (PDService.book[i].coinid === data.coinid) order = PDService.book[i];
    if (!PDService.owns(order)) return PDService.tell("ERROR", {message:"That is not one of your active orders"});
    if (PDService.pendingRefs[order.coinid] === "cancel") return PDService.tell("ERROR", {message:"That cancellation is already waiting for confirmation"});
    PDService.busy = true; PDService.setStage("Submitting cancellation…");
    return PandaTxn.cancel(PDService.cmd, order, function(error, tx) {
      var wasMaker = PDService.makerOwnedIds()[order.orderId];
      PDService.busy = false;
      if (error) { PDService.setStage("Cancellation failed — " + error); return PDService.tell("ERROR", {message:error}); }
      if (wasMaker) { PDService.makerForgetByOrderId(order.orderId); PDService.makerTombstone(order.orderId, PDService.block, PDService.block); }
      PDService.addPending(PandaPending.CANCEL, {orderId:order.orderId, coinid:order.coinid, buy:!order.sell, minima:PandaDEX.plain(order.minima), price:PandaDEX.plain(order.price)});
      PDService.setStage("Cancellation submitted — waiting for confirmation");
      PDService.tell("POSTED", {message:"Cancellation submitted — funds return when it confirms (~50 seconds)", tx:tx}); PDService.refresh();
    });
  }
  if (message.type === "CANCEL_ALL") {
    var mine = [], c = PDService.maker.cfg;
    for (i = 0; i < PDService.book.length; i++) {
      order = PDService.book[i];
      if (PDService.owns(order) && PDService.pendingRefs[order.coinid] !== "cancel" && String(PDService.pendingRefs[order.coinid] || "").indexOf("edit:") !== 0) mine.push(order);
    }
    if (!mine.length) return PDService.tell("ERROR", {message:"No cancellable open orders"});
    if (c && c.armed) {
      c.armed = false; c.slots = {}; c.tombstones = {};
      PDService.saveMaker();
      PDService.setStage("Market maker stopped — cancelling every order");
    }
    return PDService.cancelAllRun(mine, 0, 0, 0);
  }
  if (message.type === "EDIT") {
    data = message.data || {};
    for (i = 0; i < PDService.book.length; i++) if (PDService.book[i].coinid === data.coinid) order = PDService.book[i];
    if (!PDService.owns(order)) return PDService.tell("ERROR", {message:"That is not one of your active orders"});
    if (PDService.pendingRefs[order.coinid] === "cancel") return PDService.tell("ERROR", {message:"That order is already being cancelled"});
    if (String(PDService.pendingRefs[order.coinid] || "").indexOf("edit:") === 0) return PDService.tell("ERROR", {message:"That reprice is already waiting for confirmation"});
    priceD = PDService.maybeDec(data.price);
    if (!priceD || !priceD.gt(0)) return PDService.tell("ERROR", {message:"Enter a valid new price"});
    data.price = PandaDEX.plain(priceD);
    PDService.busy = true; PDService.setStage("Submitting reprice…");
    return PandaTxn.relock(PDService.cmd, order, PandaTxn.newWantForPrice(order, data.price), function(error, tx) {
      PDService.busy = false;
      if (error) { PDService.setStage("Reprice failed — " + error); return PDService.tell("ERROR", {message:error}); }
      PDService.addPending(PandaPending.EDIT, {orderId:order.orderId, coinid:order.coinid, buy:!order.sell, minima:PandaDEX.plain(order.minima), price:data.price});
      PDService.setStage("Reprice submitted — waiting for confirmation");
      PDService.tell("POSTED", {message:"Reprice submitted — the order updates after confirmation", tx:tx});
      PDService.refresh();
    });
  }
  if (message.type === "MAKER_SAVE" || message.type === "MAKER_PUBLISH" || message.type === "MAKER_APPLY") {
    data = message.data || {};
    PDService.maker.cfg = PDService.normalizeMaker(data.cfg || data);
    if (message.type === "MAKER_PUBLISH") { PDService.maker.cfg.armed = true; PDService.maker.cfg.lastActedMid = null; PDService.maker.lastCycleMs = 0; }
    if (message.type === "MAKER_APPLY") PDService.maker.lastCycleMs = 0;
    return PDService.saveMaker(function() { PDService.setStage(message.type === "MAKER_PUBLISH" ? "Maker published — first cycle starting" : "Maker settings saved"); PDService.refresh(); });
  }
  if (message.type === "MAKER_WITHDRAW") return PDService.makerWithdraw();
  if (!message.type) return;
  PDService.tell("ERROR", {message:"Unsupported request: " + String(message.type)});
};
MDS.init(function(message) {
  var packet;
  if (message.event === "inited") PDService.boot();
  else if (message.event === "NEWBLOCK") PDService.cmd("block", function(result) { PDService.block = Number(result && result.response && result.response.block || PDService.block); PDService.refresh(); });
  else if (message.event === "MDSCOMMS" && message.data && !message.data.public) {
    try { packet = JSON.parse(message.data.message || "{}"); if (packet.origin === "ui") PDService.action(packet); }
    catch (error) { PDService.tell("ERROR", {message:"Bad request"}); }
  }
});
