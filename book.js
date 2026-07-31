var PandaBook = PandaBook || {};
(function (B, P) {
  B.parse = function (coins) { var out=[], i,o; for(i=0;i<(coins||[]).length;i++){o=P.order(coins[i]);if(o)out.push(o);} return out; };
  B.scan = function (cmd, cb, depth) {
    depth=depth||P.SCAN_DEPTH;
    /* Match the Android scanner's query: newest live covenant coins first, with the
       same bounded 600-block visibility window. */
    cmd("coins simplestate:true order:desc address:"+P.ADDR+" coinage:0 depth:"+depth, function (r) {
      if (r && r.status && Array.isArray(r.response)) return cb(null, B.parse(r.response), false);
      if(depth>75) return B.scan(cmd,cb,Math.floor(depth/2));
      cb((r&&r.error)||"Book scan failed",[],true);
    });
  };
  B.plan = function (book, buy, amount, limit, block) {
    var side=[],i,o,remaining=P.d(amount), takes=[], totalMin=P.d(0), totalUsdt=P.d(0), expiryMargin=12;
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
