/* Android MakerLadder port: pure ladder math and reconcile decisions. ES5 only. */
var PandaMaker = PandaMaker || {};
(function (M, P) {
  M.MAX_LEVELS = 6;
  M.K_CREATE = "CREATE";
  M.K_RELOCK = "RELOCK";
  M.K_CANCEL = "CANCEL";

  M.level = function (price, size) { return {price:P.d(price), sizeMinima:P.d(size)}; };
  M.sizeAt = function (rungs, i) {
    var level;
    if (!rungs || i >= rungs.length) return P.d(0);
    level = rungs[i];
    if (!level || level.sizeMinima === undefined || level.sizeMinima === null) return P.d(0);
    level = P.d(level.sizeMinima);
    return level.gt(0) ? level : P.d(0);
  };
  M.hasSizedRung = function (rungs) {
    var i;
    for (i = 0; i < M.MAX_LEVELS; i++) if (M.sizeAt(rungs, i).gt(0)) return true;
    return false;
  };
  M.applyCount = function (side, n, seedSize) {
    var want = Math.max(0, Math.min(Number(n || 0), M.MAX_LEVELS)), inherit = P.d(0), seed = P.d(seedSize || 0), out = [], i, existing;
    for (i = 0; i < M.MAX_LEVELS; i++) if (M.sizeAt(side, i).gt(0)) inherit = M.sizeAt(side, i);
    if (!inherit.gt(0) && seed.gt(0)) inherit = seed;
    for (i = 0; i < M.MAX_LEVELS; i++) {
      if (i >= want) { out.push(P.d(0)); continue; }
      existing = M.sizeAt(side, i);
      out.push(existing.gt(0) ? existing : inherit);
    }
    return out;
  };
  M.sanitize = function (levels, asks) {
    var out = [], i, l, p, s;
    levels = levels || [];
    for (i = 0; i < levels.length; i++) {
      l = levels[i];
      if (!l) continue;
      p = P.d(l.price || 0); s = P.d(l.sizeMinima || 0);
      if (p.gt(0) && s.gt(0)) out.push({price:p, sizeMinima:s});
    }
    out.sort(function (a, b) { return asks ? a.price.cmp(b.price) : b.price.cmp(a.price); });
    return out.slice(0, M.MAX_LEVELS);
  };
  M.crossed = function (asks, bids) {
    var a = M.sanitize(asks, true), b = M.sanitize(bids, false);
    return !!(a.length && b.length && b[0].price.gte(a[0].price));
  };
  M.desired = function (mid, cfg, widenFactor) {
    var out = [], hundred = P.d(100), asks, bids, i, widen, skewed, off, bidSz, askSz, price;
    if (!cfg) return out;
    if (!cfg.pegged) {
      asks = M.sanitize(cfg.asks, true); bids = M.sanitize(cfg.bids, false);
      for (i = 0; i < asks.length; i++) out.push({id:"A" + (i + 1), sell:true, price:asks[i].price, sizeMinima:asks[i].sizeMinima});
      for (i = 0; i < bids.length; i++) out.push({id:"B" + (i + 1), sell:false, price:bids[i].price, sizeMinima:bids[i].sizeMinima});
      return out;
    }
    mid = P.d(mid || 0);
    if (!mid.gt(0) || !P.d(cfg.stepPct || 0).gt(0)) return out;
    if (!M.hasSizedRung(cfg.asks) && !M.hasSizedRung(cfg.bids)) return out;
    widen = P.d(widenFactor || 1); if (!widen.gt(0)) widen = P.d(1);
    skewed = mid.mul(P.d(1).add(P.d(cfg.skewPct || 0).div(hundred)));
    for (i = 0; i < M.MAX_LEVELS; i++) {
      off = P.d(cfg.stepPct).mul(i + 1).mul(widen).div(hundred);
      bidSz = M.sizeAt(cfg.bids, i); askSz = M.sizeAt(cfg.asks, i);
      if (bidSz.gt(0)) {
        price = skewed.mul(P.d(1).sub(off)).toDecimalPlaces(6, Decimal.ROUND_DOWN);
        if (price.gt(0)) out.push({id:"B" + (i + 1), sell:false, price:price, sizeMinima:bidSz});
      }
      if (askSz.gt(0)) {
        price = skewed.mul(P.d(1).add(off)).toDecimalPlaces(6, Decimal.ROUND_CEIL);
        out.push({id:"A" + (i + 1), sell:true, price:price, sizeMinima:askSz});
      }
    }
    return out;
  };
  M.commitments = function (desired) {
    var ask = P.d(0), bid = P.d(0), i, s;
    desired = desired || [];
    for (i = 0; i < desired.length; i++) {
      s = desired[i]; if (!s) continue;
      if (s.sell) ask = ask.add(s.sizeMinima);
      else bid = bid.add(P.up(P.d(s.sizeMinima).mul(s.price), P.DP));
    }
    return {askMinima:ask, bidUsdt:bid};
  };
  M.action = function (kind, slot, order, reason) { return {kind:kind, slot:slot || null, order:order || null, reason:reason || ""}; };
  M.budget = function (maxActions, maxCreatesPerSide) { return {maxActions:Number(maxActions || 0), maxCreatesPerSide:maxCreatesPerSide === undefined ? 2147483647 : Number(maxCreatesPerSide)}; };
  M.livePrice = function (order) { return P.d(order.price); };
  M.worthRepricing = function (lastMid, newMid, pct) {
    lastMid = P.d(lastMid || 0); newMid = P.d(newMid || 0); pct = P.d(pct || 0);
    if (!lastMid.gt(0)) return true;
    if (!newMid.gt(0)) return false;
    return newMid.sub(lastMid).abs().div(lastMid).mul(100).gte(pct);
  };
  M.reconcile = function (desired, liveBySlot, settlingSlots, renewSlots, repricePct, partiallyFilled, postedSizes, budget) {
    var relocks = [], creates = [], cancels = [], resizes = [], want = {}, actions = [], k, i, s, live, posted, used, movePct, move, reason, bidCreates = 0, askCreates = 0, max, exact, b;
    desired = desired || []; liveBySlot = liveBySlot || {}; settlingSlots = settlingSlots || {}; renewSlots = renewSlots || {}; partiallyFilled = partiallyFilled || {}; postedSizes = postedSizes || {};
    b = budget || M.budget(0, 2147483647);
    for (i = 0; i < desired.length; i++) want[desired[i].id] = desired[i];
    for (k in liveBySlot) if (liveBySlot.hasOwnProperty(k)) {
      if (settlingSlots[k]) continue;
      if (!want[k] && liveBySlot[k]) cancels.push(M.action(M.K_CANCEL, null, liveBySlot[k], "level removed"));
    }
    for (i = 0; i < desired.length; i++) {
      s = desired[i];
      if (settlingSlots[s.id]) continue;
      live = liveBySlot[s.id];
      if (!live) {
        used = s.sell ? askCreates : bidCreates;
        if (used < b.maxCreatesPerSide) {
          creates.push(M.action(M.K_CREATE, s, null, "level missing"));
          if (s.sell) askCreates++; else bidCreates++;
        }
        continue;
      }
      if (partiallyFilled[live.coinid]) continue;
      posted = postedSizes[s.id];
      if (posted !== undefined && posted !== null && P.d(posted).cmp(s.sizeMinima) !== 0) {
        used = s.sell ? askCreates : bidCreates;
        if (used < b.maxCreatesPerSide) {
          resizes.push(M.action(M.K_CANCEL, null, live, "size changed"));
          resizes.push(M.action(M.K_CREATE, s, null, "size changed"));
          if (s.sell) askCreates++; else bidCreates++;
        }
        continue;
      }
      if (!M.livePrice(live).gt(0)) continue;
      if (repricePct === null || repricePct === undefined || !P.d(repricePct).gt(0)) {
        exact = s.price.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).cmp(M.livePrice(live).toDecimalPlaces(6, Decimal.ROUND_HALF_UP)) !== 0;
        move = exact; reason = "price edited";
      } else {
        movePct = s.price.sub(M.livePrice(live)).abs().div(M.livePrice(live)).mul(100);
        move = movePct.gte(repricePct); reason = "moved " + movePct.toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed() + "%";
      }
      if (!move && renewSlots[s.id]) { move = true; reason = "renewing"; }
      if (move) relocks.push(M.action(M.K_RELOCK, s, live, reason));
    }
    actions = relocks.concat(creates).concat(cancels).concat(resizes);
    max = Number(b.maxActions || 0);
    return max > 0 && actions.length > max ? actions.slice(0, max) : actions;
  };
  M.minRemainderFor = function (slot) {
    var fivePct = P.d(slot.sizeMinima).mul("0.05"), floor = Decimal.max(fivePct, P.d(P.MIN_ORDER)), half = P.d(slot.sizeMinima).div(2).toDecimalPlaces(P.DP, Decimal.ROUND_DOWN);
    return P.down(Decimal.min(floor, half), P.DP);
  };
})(PandaMaker, PandaDEX);
