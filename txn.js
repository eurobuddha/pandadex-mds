var PandaTxn = PandaTxn || {};
(function (T, P) {
  T.run = function (cmd, steps, fail, done, n) { n=n||0; if(n>=steps.length)return done(null); cmd(steps[n],function(r){if(!r||!r.status){if(fail)cmd("txndelete id:"+fail,function(){});return done((r&&r.error)||("Failed: "+steps[n]));}T.run(cmd,steps,fail,done,n+1);}); };
  T.id = function (prefix) { return prefix+"_"+Date.now()+"_"+Math.floor(Math.random()*1000000000); };
  T.checkPost = function (cmd,id,steps,done,signKey) {
    /* txncheck is the only command whose response is the validation verdict. Do not infer
     * validity from txnlist or txnpost: the latter merely means mempool acceptance. */
    steps.push("txnsign id:"+id+" publickey:"+(signKey||"auto"),"txnbasics id:"+id);
    T.run(cmd,steps,id,function(err){ if(err)return done(err);
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
          return done("Transaction failed validation (scripts="+scripts+" basic="+basic+" amounts="+amounts+" mmr="+mmr+" sigs="+sigs+")");
        }
        cmd("txnpost id:"+id,function(post){if(!post||(!post.status&&!post.pending)){cmd("txndelete id:"+id,function(){});return done((post&&post.error)||"Transaction was not accepted");}cmd("txndelete id:"+id,function(){});done(null,post.response&&post.response.txpowid||id);});
      });
    });
  };
  /* Orders can belong to an older wallet key. `auto` may choose the current receive key,
     but the V5 owner branch requires SIGNEDBY(port 0), so cancel must name that exact key. */
  T.cancel = function(cmd,o,done){var id=T.id("cancel"),s=["txncreate id:"+id,"txninput id:"+id+" coinid:"+o.coinid,"txnoutput id:"+id+" amount:"+P.plain(o.locked)+" address:"+o.wantAddr+(P.eqTok(o.lockedTok,"0x00")?"":" tokenid:"+o.lockedTok)+" storestate:false"];T.checkPost(cmd,id,s,done,o.ownerPk);};
  /* Android DexTxn.cancelBatch port: order inputs first, index-matched full refunds. */
  T.cancelBatch = function(cmd,orders,done){var id=T.id("cancelb"),s=["txncreate id:"+id],signed={},i,o;if(!orders||!orders.length)return done("Nothing to cancel");if(orders.length>P.MAX_ORDERS)return done("Too many orders for one transaction");if(orders.length===1)return T.cancel(cmd,orders[0],done);for(i=0;i<orders.length;i++){o=orders[i];s.push("txninput id:"+id+" coinid:"+o.coinid);}for(i=0;i<orders.length;i++){o=orders[i];s.push("txnoutput id:"+id+" amount:"+P.plain(o.locked)+" address:"+o.wantAddr+(P.eqTok(o.lockedTok,"0x00")?"":" tokenid:"+o.lockedTok)+" storestate:false");}for(i=0;i<orders.length;i++){o=orders[i];if(o.ownerPk&&!signed[o.ownerPk]){signed[o.ownerPk]=true;s.push("txnsign id:"+id+" publickey:"+o.ownerPk);}}s.push("txnbasics id:"+id);T.run(cmd,s,id,function(err){if(err)return done(err);cmd("txncheck id:"+id,function(check){var response=check&&check.response,valid=response&&response.valid,scripts=!!(valid&&valid.scripts),basic=!!(valid&&valid.basic),mmr=!!(valid&&valid.mmrproofs),amounts=true,sigs=!response||response.allsignaturesvalid!==false;if(valid&&valid.validamounts!==undefined)amounts=!!valid.validamounts;else if(response&&response.validamounts!==undefined)amounts=!!response.validamounts;if(!check||!check.status||!scripts||!basic||!amounts||!mmr||!sigs){cmd("txndelete id:"+id,function(){});return done("Transaction failed validation (scripts="+scripts+" basic="+basic+" amounts="+amounts+" mmr="+mmr+" sigs="+sigs+")");}cmd("txnpost id:"+id,function(post){if(!post||(!post.status&&!post.pending)){cmd("txndelete id:"+id,function(){});return done((post&&post.error)||"Transaction was not accepted");}cmd("txndelete id:"+id,function(){});done(null,post.response&&post.response.txpowid||id);});});});};
  /* Android DexTxn.relock port: owner branch keeps the same funds on the covenant address,
     optionally changing port 2 / price. */
  T.relock = function(cmd,o,newWant,done){var id=T.id("relock"),want=newWant===null||newWant===undefined?o.wantAmt:P.d(newWant),price=o.sell?want.div(o.locked):o.locked.div(want),s=["txncreate id:"+id,"txninput id:"+id+" coinid:"+o.coinid,"txnoutput id:"+id+" amount:"+P.plain(o.locked)+" address:"+P.ADDR+(P.eqTok(o.lockedTok,"0x00")?"":" tokenid:"+o.lockedTok)+" storestate:true","txnstate id:"+id+" port:0 value:"+o.ownerPk,"txnstate id:"+id+" port:1 value:"+o.wantAddr,"txnstate id:"+id+" port:2 value:"+P.plain(want),"txnstate id:"+id+" port:3 value:"+o.wantTok,"txnstate id:"+id+" port:4 value:"+o.orderId,"txnstate id:"+id+" port:5 value:"+(o.sell?"1":"0"),"txnstate id:"+id+" port:6 value:"+P.plain(price),"txnstate id:"+id+" port:7 value:"+(o.gtc?"1":"0"),"txnstate id:"+id+" port:8 value:"+P.plain(o.minRem)];T.checkPost(cmd,id,s,done,o.ownerPk);};
  T.newWantForPrice = function(o, price){price=P.d(price);return o.sell?P.up(P.d(o.locked).mul(price),P.DP):P.down(P.d(o.locked).div(price),P.DP);};
  T.collectExpired = function(cmd,o,done){var id=T.id("collect"),s=["txncreate id:"+id,"txninput id:"+id+" coinid:"+o.coinid,"txnoutput id:"+id+" amount:"+P.plain(o.locked)+" address:"+o.wantAddr+(P.eqTok(o.lockedTok,"0x00")?"":" tokenid:"+o.lockedTok)+" storestate:false"];T.checkPost(cmd,id,s,done);};
  T.coinValue = function(c){return P.d(P.eqTok(c.tokenid,"0x00")?c.amount:(c.tokenamount||c.amount));};
  T.findCoins = function(cmd,payTok,needed,exclude,maxCoins,done){cmd("coins relevant:true simplestate:true",function(res){var cs=res&&res.response,chosen=[],sum=P.d(0),i,c,val,addr;if(!res||!res.status||!Array.isArray(cs))return done("Could not read funding coins");exclude=exclude||{};for(i=0;i<cs.length&&sum.lt(needed)&&chosen.length<(maxCoins||8);i++){c=cs[i];addr=String(c.address||"").toLowerCase();if(c.spent||!P.eqTok(c.tokenid,payTok)||exclude[addr])continue;val=T.coinValue(c);if(val.gt(0)){chosen.push(c);sum=sum.add(val);}}if(sum.lt(needed))return done("Insufficient confirmed funds for trade");done(null,chosen,sum);});};
  /* Direct port of Android DexTxn.createOrder: port 8 is denominated in the LOCKED asset,
     so a buy converts the user's MINIMA remainder through its own limit price. */
  T.create = function(cmd,identity,input,done){var minima=P.down(input.minima,P.DP),price=P.d(input.price),usdt=P.up(minima.mul(price),P.DP),buy=!!input.buy,lock=buy?usdt:minima,want=buy?minima:usdt,minimaRem=P.down(input.minRem||0,P.DP),minRem=buy?P.up(minimaRem.mul(price),P.DP):minimaRem;if(minima.lt(P.MIN_ORDER)||lock.gt("1000000000"))return done("Order size is outside the permitted range");if(minRem.gt(lock))return done("Minimum remainder is larger than the order itself");function sendOrder(oid){var state={"0":identity.publickey,"1":identity.address,"2":P.plain(want),"3":buy?"0x00":P.USDT,"4":oid,"5":buy?"0":"1","6":P.plain(price),"7":input.gtc===false?"0":"1","8":P.plain(minRem)};cmd("send amount:"+P.plain(lock)+" address:"+P.ADDR+(buy?" tokenid:"+P.USDT:"")+" state:"+JSON.stringify(state),function(r){done((!r||(!r.status&&!r.pending))&&((r&&r.error)||"Order was not accepted"),r&&r.response&&r.response.txpowid,oid);});}if(input.orderId)return sendOrder(input.orderId);cmd("random",function(rand){var oid=rand&&rand.status&&rand.response&&rand.response.random;if(!oid)return done("Could not create a safe order id");sendOrder(oid);});};
  T.fill = function(cmd,identity,plan,done){
    if(!plan||!plan.takes||!plan.takes.length)return done("Nothing to fill");
    var buy=plan.takes[0].order.sell,payTok=buy?P.USDT:"0x00",needed=P.d(0),i,t,o,partial=null,proceeds=P.d(0),steps=[],id=T.id("sweep");
    for(i=0;i<plan.takes.length;i++){t=plan.takes[i];needed=needed.add(t.pay);proceeds=proceeds.add(t.lockedTake);if(t.partial)partial=t;}
    cmd("coins relevant:true simplestate:true",function(res){var cs=res&&res.response,chosen=[],sum=P.d(0),c,val;if(!res||!res.status||!Array.isArray(cs))return done("Could not read funding coins");for(i=0;i<cs.length&&sum.lt(needed);i++){c=cs[i];if(c.spent||!P.eqTok(c.tokenid,payTok)||c.address===P.ADDR)continue;val=P.d(P.eqTok(payTok,"0x00")?c.amount:(c.tokenamount||c.amount));if(val.gt(0)){chosen.push(c);sum=sum.add(val);}}if(sum.lt(needed))return done("Insufficient confirmed funds for this sweep");
      steps.push("txncreate id:"+id);for(i=0;i<plan.takes.length;i++)steps.push("txninput id:"+id+" coinid:"+plan.takes[i].order.coinid);for(i=0;i<chosen.length;i++)steps.push("txninput id:"+id+" coinid:"+chosen[i].coinid);
      for(i=0;i<plan.takes.length;i++){t=plan.takes[i];o=t.order;steps.push("txnoutput id:"+id+" amount:"+P.plain(t.pay)+" address:"+o.wantAddr+(P.eqTok(o.wantTok,"0x00")?"":" tokenid:"+o.wantTok)+" storestate:false");}
      if(partial){o=partial.order;steps.push("txnoutput id:"+id+" amount:"+P.plain(partial.remainder)+" address:"+P.ADDR+(P.eqTok(o.lockedTok,"0x00")?"":" tokenid:"+o.lockedTok)+" storestate:true");}
      steps.push("txnoutput id:"+id+" amount:"+P.plain(proceeds)+" address:"+identity.address+(buy?"":" tokenid:"+P.USDT)+" storestate:false");var change=sum.sub(needed);if(change.gt(0))steps.push("txnoutput id:"+id+" amount:"+P.plain(change)+" address:"+identity.address+(P.eqTok(payTok,"0x00")?"":" tokenid:"+payTok)+" storestate:false");
      if(partial){o=partial.order;var nw=P.up(o.wantAmt.mul(partial.remainder).div(o.locked),P.DP);steps.push("txnstate id:"+id+" port:0 value:"+o.ownerPk,"txnstate id:"+id+" port:1 value:"+o.wantAddr,"txnstate id:"+id+" port:2 value:"+P.plain(nw),"txnstate id:"+id+" port:3 value:"+o.wantTok,"txnstate id:"+id+" port:4 value:"+o.orderId,"txnstate id:"+id+" port:5 value:"+(o.sell?"1":"0"),"txnstate id:"+id+" port:6 value:"+P.plain(nw.div(partial.remainder)),"txnstate id:"+id+" port:7 value:"+(o.gtc?"1":"0"),"txnstate id:"+id+" port:8 value:"+P.plain(o.minRem));}
      T.checkPost(cmd,id,steps,done);
    });
  };
})(PandaTxn,PandaDEX);
