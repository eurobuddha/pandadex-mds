var PandaTxn = PandaTxn || {};
(function (T, P) {
  T.run = function (cmd, steps, fail, done, n) { n=n||0; if(n>=steps.length)return done(null); cmd(steps[n],function(r){if(!r||!r.status){if(fail)cmd("txndelete id:"+fail,function(){});return done((r&&r.error)||("Failed: "+steps[n]));}T.run(cmd,steps,fail,done,n+1);}); };
  T.id = function (prefix) { return prefix+"_"+Date.now()+"_"+Math.floor(Math.random()*1000000000); };
  T.MAX_TX_BYTES = 60 * 1024;
  T.MAX_FUNDING_INPUTS = 8;
  /* `signKey` may be one key, an array of keys (a batch cancel needs one signature per distinct
     owner), or nothing at all — which means `auto`. Every build->sign->post chain in this file
     funnels through here, so this is where the serial signing gate is held. See signlock.js: two
     concurrent signs of one Winternitz key reuse a leaf and leak it. */
  T.checkPost = function (cmd,id,steps,done,signKey) {
    var keys = signKey ? (Array.isArray(signKey)?signKey:[signKey]) : ["auto"];
    PandaSignLock.gate("dex", function (release) {
      /* Release exactly once, on every exit path — success, validation failure, post rejection
         and build error alike. Holding it past the chain would stall the maker for MAX_HOLD_MS. */
      function finish(err, tx) { release.free(); done(err, tx); }
      var k;
      for (k = 0; k < keys.length; k++) steps.push("txnsign id:"+id+" publickey:"+keys[k]);
      steps.push("txnbasics id:"+id);
      /* txncheck is the only command whose response is the validation verdict. Do not infer
       * validity from txnlist or txnpost: the latter merely means mempool acceptance. */
      T.run(cmd,steps,id,function(err){ if(err)return finish(err);
        /* Size gate before the validation gate. A transaction over the node's limit is rejected
           at post with a far less useful error, and composite fills (pool pairs + order coins +
           funding) are exactly the shape that overflows. A txnexport we cannot read is not
           treated as a failure — only a size we can read and know is too big. */
        cmd("txnexport id:"+id,function(exp){
          var data=exp&&exp.response&&(exp.response.data||exp.response.txndata||exp.response.transaction), bytes=0;
          if(typeof data==="string") bytes=Math.floor((data.indexOf("0x")===0?data.length-2:data.length)/2);
          if(bytes>T.MAX_TX_BYTES){
            cmd("txndelete id:"+id,function(){});
            return finish("Transaction is too large ("+Math.round(bytes/1024)+"KB) — reduce the number of orders or consolidate your wallet coins");
          }
        cmd("txncheck id:"+id,function(check){
          /* Mirror Android's proven gate. `validamounts` is the Minima verdict field;
             older node responses carry it beside `valid`, not inside it. */
          var response=check&&check.response, valid=response&&response.valid,
            scripts=!!(valid&&valid.scripts), basic=!!(valid&&valid.basic), mmr=!!(valid&&valid.mmrproofs),
            amounts=true, sigs=!response||response.allsignaturesvalid!==false;
          if(valid&&valid.validamounts!==undefined) amounts=!!valid.validamounts;
          else if(response&&response.validamounts!==undefined) amounts=!!response.validamounts;
          if(!check||!check.status||!scripts||!basic||!amounts||!mmr||!sigs){
            cmd("txndelete id:"+id,function(){});
            return finish("Transaction failed validation (scripts="+scripts+" basic="+basic+" amounts="+amounts+" mmr="+mmr+" sigs="+sigs+")");
          }
          cmd("txnpost id:"+id,function(post){if(!post||(!post.status&&!post.pending)){cmd("txndelete id:"+id,function(){});return finish((post&&post.error)||"Transaction was not accepted");}cmd("txndelete id:"+id,function(){});finish(null,post.response&&post.response.txpowid||id);});
        });
        });
      });
    });
  };
  /* Orders can belong to an older wallet key. `auto` may choose the current receive key,
     but the V5 owner branch requires SIGNEDBY(port 0), so cancel must name that exact key. */
  T.cancel = function(cmd,o,done){var id=T.id("cancel"),s=["txncreate id:"+id,"txninput id:"+id+" coinid:"+o.coinid,"txnoutput id:"+id+" amount:"+P.plain(o.locked)+" address:"+o.wantAddr+(P.eqTok(o.lockedTok,"0x00")?"":" tokenid:"+o.lockedTok)+" storestate:false"];T.checkPost(cmd,id,s,done,o.ownerPk);};
  /* Android DexTxn.cancelBatch port: order inputs first, index-matched full refunds. */
  T.cancelBatch = function(cmd,orders,done){var id=T.id("cancelb"),s=["txncreate id:"+id],keys=[],seen={},i,o;if(!orders||!orders.length)return done("Nothing to cancel");if(orders.length>P.MAX_ORDERS)return done("Too many orders for one transaction");if(orders.length===1)return T.cancel(cmd,orders[0],done);for(i=0;i<orders.length;i++){o=orders[i];s.push("txninput id:"+id+" coinid:"+o.coinid);}for(i=0;i<orders.length;i++){o=orders[i];s.push("txnoutput id:"+id+" amount:"+P.plain(o.locked)+" address:"+o.wantAddr+(P.eqTok(o.lockedTok,"0x00")?"":" tokenid:"+o.lockedTok)+" storestate:false");}for(i=0;i<orders.length;i++){o=orders[i];if(o.ownerPk&&!seen[o.ownerPk]){seen[o.ownerPk]=true;keys.push(o.ownerPk);}}T.checkPost(cmd,id,s,done,keys);};
  /* Android DexTxn.relock port: owner branch keeps the same funds on the covenant address,
     optionally changing port 2 / price. */
  T.relock = function(cmd,o,newWant,done){var id=T.id("relock"),want=newWant===null||newWant===undefined?o.wantAmt:P.d(newWant),price=P.portPrice(want,o.locked),s=["txncreate id:"+id,"txninput id:"+id+" coinid:"+o.coinid,"txnoutput id:"+id+" amount:"+P.plain(o.locked)+" address:"+P.ADDR+(P.eqTok(o.lockedTok,"0x00")?"":" tokenid:"+o.lockedTok)+" storestate:true","txnstate id:"+id+" port:0 value:"+o.ownerPk,"txnstate id:"+id+" port:1 value:"+o.wantAddr,"txnstate id:"+id+" port:2 value:"+P.plain(want),"txnstate id:"+id+" port:3 value:"+o.wantTok,"txnstate id:"+id+" port:4 value:"+o.orderId,"txnstate id:"+id+" port:5 value:"+(o.sell?"1":"0"),"txnstate id:"+id+" port:6 value:"+P.plain(price),"txnstate id:"+id+" port:7 value:"+(o.gtc?"1":"0"),"txnstate id:"+id+" port:8 value:"+P.plain(o.minRem)];T.checkPost(cmd,id,s,done,o.ownerPk);};
  T.newWantForPrice = function(o, price){price=P.d(price);return o.sell?P.up(P.d(o.locked).mul(price),P.DP):P.down(P.d(o.locked).div(price),P.DP);};
  T.collectExpired = function(cmd,o,done){var id=T.id("collect"),s=["txncreate id:"+id,"txninput id:"+id+" coinid:"+o.coinid,"txnoutput id:"+id+" amount:"+P.plain(o.locked)+" address:"+o.wantAddr+(P.eqTok(o.lockedTok,"0x00")?"":" tokenid:"+o.lockedTok)+" storestate:false"];T.checkPost(cmd,id,s,done);};
  T.coinValue = function(c){return P.d(P.eqTok(c.tokenid,"0x00")?c.amount:(c.tokenamount||c.amount));};
  /* `sendable:true checkmempool:true` is what `send` itself uses — without it we can pick a coin
     already spent by an unconfirmed transaction. Filtering by tokenid server-side also keeps the
     reply small, which matters because an over-cap MDS reply comes back empty rather than erroring
     and would read here as "insufficient funds". */
  T.coinQuery = function(tok){return "coins relevant:true sendable:true checkmempool:true simplestate:true tokenid:"+tok;};
  T.findCoins = function(cmd,payTok,needed,exclude,maxCoins,done){cmd(T.coinQuery(payTok),function(res){var cs=res&&res.response,chosen=[],sum=P.d(0),i,c,val,addr;if(!res||!res.status||!Array.isArray(cs))return done("Could not read funding coins");exclude=exclude||{};for(i=0;i<cs.length&&sum.lt(needed)&&chosen.length<(maxCoins||8);i++){c=cs[i];addr=String(c.address||"").toLowerCase();if(c.spent||!P.eqTok(c.tokenid,payTok)||exclude[addr])continue;val=T.coinValue(c);if(val.gt(0)){chosen.push(c);sum=sum.add(val);}}if(chosen.length>=(maxCoins||T.MAX_FUNDING_INPUTS)&&sum.lt(needed))return done("Your wallet needs more than "+(maxCoins||T.MAX_FUNDING_INPUTS)+" coins to fund this — consolidate them and retry");if(sum.lt(needed))return done("Insufficient confirmed funds for trade");done(null,chosen,sum);});};
  /* ---- composite (order book + PandaPools reserves in one transaction) ----
     `trackall:false` is load-bearing and was WRONG here before: with trackall:true every coin at
     a pool address reads as wallet-relevant, so every stranger's liquidity looked like the user's
     own. Native lists that exact bug ("trackall:true ownership pollution") as a fixed critical
     issue, and DexTxnCompositeLayoutTest asserts the false. */
  T.ensurePools = function(cmd,allocs,idx,done){var p,script;if(idx>=(allocs||[]).length)return done();p=allocs[idx].pool;script=p.covenantScript||PandaPool.script(p.opk,p.oadr,p.tok,p.kmin);cmd("newscript trackall:false script:"+PandaPool.scriptArg(script),function(){T.ensurePools(cmd,allocs,idx+1,done);});};
  T.prepareComposite = function(plan,takerBuys){var prep={route:plan.poolRoute,payTok:takerBuys?P.USDT:"0x00",needed:P.d(0),payments:[],partial:null,partialRem:null,partialNewWant:null},i,t,o,lockedTake,pay;for(i=0;i<(plan.orderTakes||[]).length;i++){t=plan.orderTakes[i];o=t.order;lockedTake=!t.partial?P.d(o.locked):(o.sell?P.d(t.minima):P.up(P.d(t.minima).mul(o.price),P.DP));pay=t.partial?P.up(P.d(o.wantAmt).mul(lockedTake).div(o.locked),P.DP):P.d(o.wantAmt);prep.payments.push([P.plain(pay),o.wantAddr,o.wantTok]);prep.needed=prep.needed.add(pay);if(t.partial){prep.partial=t;prep.partialRem=P.d(o.locked).sub(lockedTake);prep.partialNewWant=P.up(P.d(o.wantAmt).mul(prep.partialRem).div(o.locked),P.DP);if(prep.partialNewWant.gt(o.wantAmt))prep.partialNewWant=P.d(o.wantAmt);}}if(prep.route&&prep.route.ok)prep.needed=prep.needed.add(prep.route.totalIn);return prep;};
  T.fillComposite = function(cmd,identity,plan,takerBuys,done){var prep,exclude={},i,a;if(!plan||PandaComposite.isEmpty(plan))return done("Nothing to fill");prep=T.prepareComposite(plan,!!takerBuys);exclude[String(P.ADDR).toLowerCase()]=true;if(prep.route){for(i=0;i<(prep.route.pairAddresses||[]).length;i++)exclude[String(prep.route.pairAddresses[i]||"").toLowerCase()]=true;for(i=0;i<(prep.route.allocs||[]).length;i++){a=prep.route.allocs[i];exclude[String(a.pool.address||"").toLowerCase()]=true;exclude[String(a.pool.oadr||"").toLowerCase()]=true;}}T.findCoins(cmd,prep.payTok,prep.needed,exclude,8,function(err,coins,sum){if(err)return done(err);T.ensurePools(cmd,prep.route&&prep.route.ok?prep.route.allocs:[],0,function(){T.buildComposite(cmd,identity,plan,prep,!!takerBuys,coins,sum,done);});});};
  /* Pure so the covenant's index rules are directly testable: pool reserve PAIRS first (even leg
     MINIMA, odd leg token), then whole order coins, then funding; outputs recreate each pool, then
     index-matched order payments, then the single partial remainder, then proceeds, then change. */
  T.buildCompositeSteps = function(id,identity,plan,prep,takerBuys,coins,fundTotal){var s=["txncreate id:"+id],route=prep.route,i,a,o,p,partial,proceedsTok,proceeds,change,nw;if(route&&route.ok){for(i=0;i<route.allocs.length;i++){a=route.allocs[i];s.push("txninput id:"+id+" coinid:"+a.pool.coinidM,"txninput id:"+id+" coinid:"+a.pool.coinidT);}}for(i=0;i<(plan.orderTakes||[]).length;i++)s.push("txninput id:"+id+" coinid:"+plan.orderTakes[i].order.coinid);for(i=0;i<coins.length;i++)s.push("txninput id:"+id+" coinid:"+coins[i].coinid);if(route&&route.ok){for(i=0;i<route.allocs.length;i++){a=route.allocs[i];s.push("txnoutput id:"+id+" amount:"+P.plain(a.quote.newX)+" address:"+a.pool.address+" storestate:false","txnoutput id:"+id+" amount:"+P.plain(a.quote.newY)+" address:"+a.pool.address+" tokenid:"+a.pool.tok+" storestate:false");}}for(i=0;i<prep.payments.length;i++){p=prep.payments[i];s.push("txnoutput id:"+id+" amount:"+p[0]+" address:"+p[1]+(P.eqTok(p[2],"0x00")?"":" tokenid:"+p[2])+" storestate:false");}partial=prep.partial;if(partial){o=partial.order;s.push("txnoutput id:"+id+" amount:"+P.plain(prep.partialRem)+" address:"+P.ADDR+(P.eqTok(o.lockedTok,"0x00")?"":" tokenid:"+o.lockedTok)+" storestate:true");}proceedsTok=takerBuys?"0x00":P.USDT;proceeds=takerBuys?P.d(plan.totalMinima):P.d(plan.totalUsdt);s.push("txnoutput id:"+id+" amount:"+P.plain(proceeds)+" address:"+identity.address+(P.eqTok(proceedsTok,"0x00")?"":" tokenid:"+proceedsTok)+" storestate:false");change=P.d(fundTotal).sub(prep.needed);if(change.gt(0))s.push("txnoutput id:"+id+" amount:"+P.plain(change)+" address:"+identity.address+(P.eqTok(prep.payTok,"0x00")?"":" tokenid:"+prep.payTok)+" storestate:false");if(partial){o=partial.order;nw=prep.partialNewWant;s.push("txnstate id:"+id+" port:0 value:"+o.ownerPk,"txnstate id:"+id+" port:1 value:"+o.wantAddr,"txnstate id:"+id+" port:2 value:"+P.plain(nw),"txnstate id:"+id+" port:3 value:"+o.wantTok,"txnstate id:"+id+" port:4 value:"+o.orderId,"txnstate id:"+id+" port:5 value:"+(o.sell?"1":"0"),"txnstate id:"+id+" port:6 value:"+P.plain(P.portPrice(nw,prep.partialRem)),"txnstate id:"+id+" port:7 value:"+(o.gtc?"1":"0"),"txnstate id:"+id+" port:8 value:"+P.plain(o.minRem));}return s;};
  T.buildComposite = function(cmd,identity,plan,prep,takerBuys,coins,fundTotal,done){var id=T.id("combo");T.checkPost(cmd,id,T.buildCompositeSteps(id,identity,plan,prep,takerBuys,coins,fundTotal),done);};
  /* Direct port of Android DexTxn.createOrder: port 8 is denominated in the LOCKED asset,
     so a buy converts the user's MINIMA remainder through its own limit price. */
  T.create = function(cmd,identity,input,done){var minima=P.down(input.minima,P.DP),price=P.d(input.price),usdt=P.up(minima.mul(price),P.DP),buy=!!input.buy,lock=buy?usdt:minima,want=buy?minima:usdt,minimaRem=P.down(input.minRem||0,P.DP),minRem=buy?P.up(minimaRem.mul(price),P.DP):minimaRem;if(minima.lt(P.MIN_ORDER)||lock.gt(P.MAX_ORDER)||want.gt(P.MAX_ORDER))return done("Order size is outside the permitted range");if(minRem.gt(lock))return done("Minimum remainder is larger than the order itself");/* `send` signs internally, so it needs the gate exactly as much as a txnsign chain does —
     this is the case SignGate.java's javadoc singles out. The `random` call below is read-only
     and deliberately stays outside it. */
  function sendOrder(oid){var state={"0":identity.publickey,"1":identity.address,"2":P.plain(want),"3":buy?"0x00":P.USDT,"4":oid,"5":buy?"0":"1","6":P.plain(price),"7":input.gtc===false?"0":"1","8":P.plain(minRem)};PandaSignLock.gate("send",function(release){cmd("send amount:"+P.plain(lock)+" address:"+P.ADDR+(buy?" tokenid:"+P.USDT:"")+" state:"+JSON.stringify(state),function(r){release.free();done((!r||(!r.status&&!r.pending))&&((r&&r.error)||"Order was not accepted"),r&&r.response&&r.response.txpowid,oid);});});}if(input.orderId)return sendOrder(input.orderId);cmd("random",function(rand){var oid=rand&&rand.status&&rand.response&&rand.response.random;if(!oid)return done("Could not create a safe order id");sendOrder(oid);});};
  T.fill = function(cmd,identity,plan,done){
    if(!plan||!plan.takes||!plan.takes.length)return done("Nothing to fill");
    var buy=plan.takes[0].order.sell,payTok=buy?P.USDT:"0x00",needed=P.d(0),i,t,o,partial=null,proceeds=P.d(0),steps=[],id=T.id("sweep"),exclude={};
    exclude[String(P.ADDR).toLowerCase()]=true;
    for(i=0;i<plan.takes.length;i++){t=plan.takes[i];needed=needed.add(t.pay);proceeds=proceeds.add(t.lockedTake);if(t.partial)partial=t;}
    /* Uses the shared selector so the 8-input cap applies here too. Inlining it meant an
       unbounded number of funding inputs: a wallet full of dust built a transaction that only
       the 60KB size gate caught — AFTER signing, burning a one-time key leaf for nothing. */
    T.findCoins(cmd,payTok,needed,exclude,T.MAX_FUNDING_INPUTS,function(err,chosen,sum){
      if(err)return done(err==="Insufficient confirmed funds for trade"?"Insufficient confirmed funds for this sweep":err);
      steps.push("txncreate id:"+id);for(i=0;i<plan.takes.length;i++)steps.push("txninput id:"+id+" coinid:"+plan.takes[i].order.coinid);for(i=0;i<chosen.length;i++)steps.push("txninput id:"+id+" coinid:"+chosen[i].coinid);
      for(i=0;i<plan.takes.length;i++){t=plan.takes[i];o=t.order;steps.push("txnoutput id:"+id+" amount:"+P.plain(t.pay)+" address:"+o.wantAddr+(P.eqTok(o.wantTok,"0x00")?"":" tokenid:"+o.wantTok)+" storestate:false");}
      if(partial){o=partial.order;steps.push("txnoutput id:"+id+" amount:"+P.plain(partial.remainder)+" address:"+P.ADDR+(P.eqTok(o.lockedTok,"0x00")?"":" tokenid:"+o.lockedTok)+" storestate:true");}
      steps.push("txnoutput id:"+id+" amount:"+P.plain(proceeds)+" address:"+identity.address+(buy?"":" tokenid:"+P.USDT)+" storestate:false");var change=sum.sub(needed);if(change.gt(0))steps.push("txnoutput id:"+id+" amount:"+P.plain(change)+" address:"+identity.address+(P.eqTok(payTok,"0x00")?"":" tokenid:"+payTok)+" storestate:false");
      if(partial){o=partial.order;var nw=P.up(o.wantAmt.mul(partial.remainder).div(o.locked),P.DP);steps.push("txnstate id:"+id+" port:0 value:"+o.ownerPk,"txnstate id:"+id+" port:1 value:"+o.wantAddr,"txnstate id:"+id+" port:2 value:"+P.plain(nw),"txnstate id:"+id+" port:3 value:"+o.wantTok,"txnstate id:"+id+" port:4 value:"+o.orderId,"txnstate id:"+id+" port:5 value:"+(o.sell?"1":"0"),"txnstate id:"+id+" port:6 value:"+P.plain(P.portPrice(nw,partial.remainder)),"txnstate id:"+id+" port:7 value:"+(o.gtc?"1":"0"),"txnstate id:"+id+" port:8 value:"+P.plain(o.minRem));}
      T.checkPost(cmd,id,steps,done);
    });
  };
})(PandaTxn,PandaDEX);
