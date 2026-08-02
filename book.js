var PandaBook = PandaBook || {};
(function (B, P) {
  B.parse = function (coins) { var out=[], i,o; for(i=0;i<(coins||[]).length;i++){o=P.order(coins[i]);if(o)out.push(o);} return out; };
  B.MIN_SLICE_BLOCKS = 12;
  B.scan = function (cmd, cb) { B.slice(cmd, cb, [], {}, 0, P.SCAN_DEPTH, false); };
  B.slice = function(cmd, cb, found, seen, fromAge, width, incomplete) {
    var depth;
    if (fromAge >= P.SCAN_DEPTH) return cb(null, found, incomplete);
    depth = Math.min(fromAge + width, P.SCAN_DEPTH);
    cmd("coins simplestate:true order:desc address:"+P.ADDR+" coinage:"+fromAge+" depth:"+depth, function (r) {
      var rows, parsed, i, o;
      if (r && r.status && Array.isArray(r.response)) {
        rows = r.response; parsed = B.parse(rows);
        for (i = 0; i < parsed.length; i++) { o = parsed[i]; if (!seen[o.coinid]) { seen[o.coinid] = true; found.push(o); } }
        return B.slice(cmd, cb, found, seen, depth, width, incomplete);
      }
      if (width > B.MIN_SLICE_BLOCKS) return B.slice(cmd, cb, found, seen, fromAge, Math.max(B.MIN_SLICE_BLOCKS, Math.floor(width / 2)), incomplete);
      B.slice(cmd, cb, found, seen, depth, width, true);
    });
  };
  B.plan = function (book, buy, amount, limit, block) {
    var side=[],i,o,remaining=P.d(amount), takes=[], totalMin=P.d(0), totalUsdt=P.d(0), expiryMargin=30;
    for(i=0;i<book.length;i++){o=book[i]; if(o.sell!==buy || (block-o.created)>P.EXPIRY-expiryMargin)continue; if(limit && (buy?o.price.gt(limit):o.price.lt(limit)))continue; side.push(o);}
    side.sort(function(a,b){return buy?a.price.cmp(b.price):b.price.cmp(a.price);});
    for(i=0;i<side.length && takes.length<P.MAX_ORDERS && remaining.gt(0);i++){
      o=side[i]; var avail=o.minima, take=remaining.gte(avail)?avail:remaining, partial=take.lt(avail), lockedTake=o.sell?take:P.up(take.mul(o.price),P.DP), rem=o.locked.sub(lockedTake);
      if(partial && rem.lt(o.minRem)){ lockedTake=o.locked.sub(o.minRem); take=o.sell?lockedTake:P.down(lockedTake.div(o.price),P.DP); if(!take.gt(0))break; partial=true; }
      var pay=partial?P.up(o.wantAmt.mul(lockedTake).div(o.locked),P.DP):o.wantAmt;
      takes.push({order:o,minima:take,partial:partial,lockedTake:lockedTake,pay:pay,remainder:rem}); totalMin=totalMin.add(take); totalUsdt=totalUsdt.add(o.sell?pay:lockedTake); remaining=remaining.sub(take); if(partial)break;
    }
    return {takes:takes,totalMinima:totalMin,totalUsdt:totalUsdt,average:totalMin.gt(0)?totalUsdt.div(totalMin):P.d(0)};
  };
})(PandaBook,PandaDEX);
