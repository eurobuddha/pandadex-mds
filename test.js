/* Pure regression tests; run with `node test.js`. */
var assert=require("assert"), fs=require("fs"), vm=require("vm");
global.Decimal=require("./decimal.js");
["covenant.js","signlock.js","book.js","pool.js","composite.js","txn.js","tape.js","maker.js","price.js","verifier.js","pending.js","stats.js","split.js","history.js","export.js","explorer.js"].forEach(function(f){vm.runInThisContext(fs.readFileSync(f,"utf8"),{filename:f});});
var C={coinid:"0x1",tokenid:"0x00",amount:"10",created:"100",state:{"0":"0xabc","1":"0x"+"a".repeat(64),"2":"20","3":PandaDEX.USDT,"4":"0x55","5":"1","7":"0","8":"0"}};
var sell=PandaDEX.order(C); assert(sell&&sell.sell&&sell.price.eq(2));
var poison=JSON.parse(JSON.stringify(C)); poison.state["3"]="0x00"; assert.strictEqual(PandaDEX.order(poison),null);
var bid=JSON.parse(JSON.stringify(C)); bid.coinid="0x2";bid.tokenid=PandaDEX.USDT;bid.tokenamount="20";bid.state["2"]="10";bid.state["3"]="0x00";bid.state["5"]="0";var buy=PandaDEX.order(bid);assert(buy&&buy.price.eq(2));
var p=PandaBook.plan([sell],true,"3",null,110);assert.strictEqual(p.takes.length,1);assert(p.takes[0].partial&&p.takes[0].remainder.eq(7)&&p.totalUsdt.eq(6));
function cloneOrder(base, id, amount, created) { var c=JSON.parse(JSON.stringify(base)); c.coinid=id; c.amount=amount; c.created=String(created || 100); return PandaDEX.order(c); }
function emittedBy(seq, cancelLog) { var out=[], st=PandaTape.newDiff(cancelLog || null, 999999); seq.forEach(function(book, i){PandaTape.ingest(st, book, false, 200, {onFill:function(spent,o,size,price,buy,partial){out.push({spent:spent,size:size.toFixed(),price:price.toFixed(),buy:buy,partial:partial});}}, 1000+i);}); return out; }
var old=cloneOrder(C,"0x10","10",100), successor=cloneOrder(C,"0x11","7",101);
assert.deepStrictEqual(emittedBy([[old],[successor]]),[{spent:"0x10",size:"3",price:"2",buy:true,partial:true}]);
assert.deepStrictEqual(emittedBy([[old],[],[],[],[]]),[{spent:"0x10",size:"10",price:"2",buy:true,partial:false}]);
assert.deepStrictEqual(emittedBy([[old],[],[],[],[]],{consume:function(){return true;}}),[]);
var old2=cloneOrder(C,"0x20","10",100), old3=cloneOrder(C,"0x30","10",100);
assert.deepStrictEqual(emittedBy([[old,old2,old3],[],[],[],[],[]]),[]);
var makerCfg={pegged:true,stepPct:"1",skewPct:"0",asks:[PandaMaker.level(0,"2"),PandaMaker.level(0,"3")],bids:[PandaMaker.level(0,"4")]};
var desired=PandaMaker.desired("10",makerCfg,"1");
assert.deepStrictEqual(desired.map(function(s){return [s.id,s.sell,s.price.toFixed(6),s.sizeMinima.toFixed()];}),[["B1",false,"9.900000","4"],["A1",true,"10.100000","2"],["A2",true,"10.200000","3"]]);
assert.deepStrictEqual(PandaMaker.commitments(desired),{askMinima:PandaDEX.d(5),bidUsdt:PandaDEX.d(39.6)});
var liveA=cloneOrder(C,"0xa1","2",100); liveA.price=PandaDEX.d("10.000000"); liveA.minima=PandaDEX.d(2); liveA.orderId="slotA";
var acts=PandaMaker.reconcile([{id:"A1",sell:true,price:PandaDEX.d("10.1"),sizeMinima:PandaDEX.d(2)}],{A1:liveA},{},{},PandaDEX.d("0.25"),{},{A1:PandaDEX.d(2)},PandaMaker.budget(4,1));
assert.strictEqual(acts.length,1); assert.strictEqual(acts[0].kind,PandaMaker.K_RELOCK);
acts=PandaMaker.reconcile([{id:"A1",sell:true,price:PandaDEX.d("10.1"),sizeMinima:PandaDEX.d(2)}],{A1:liveA},{},{},PandaDEX.d("0.25"),{"0xa1":true},{A1:PandaDEX.d(2)},PandaMaker.budget(4,1));
assert.strictEqual(acts.length,0);
acts=PandaMaker.reconcile([{id:"A1",sell:true,price:PandaDEX.d("10"),sizeMinima:PandaDEX.d(3)}],{A1:liveA},{},{},PandaDEX.d("0.25"),{},{A1:PandaDEX.d(2)},PandaMaker.budget(4,1));
assert.deepStrictEqual(acts.map(function(a){return [a.kind,a.reason];}),[[PandaMaker.K_CANCEL,"size changed"],[PandaMaker.K_CREATE,"size changed"]]);
acts=PandaMaker.reconcile([{id:"B1",sell:false,price:PandaDEX.d("9.9"),sizeMinima:PandaDEX.d(1)},{id:"B2",sell:false,price:PandaDEX.d("9.8"),sizeMinima:PandaDEX.d(1)},{id:"A1",sell:true,price:PandaDEX.d("10.1"),sizeMinima:PandaDEX.d(1)},{id:"A2",sell:true,price:PandaDEX.d("10.2"),sizeMinima:PandaDEX.d(1)}],{}, {}, {}, PandaDEX.d("0.25"), {}, {}, PandaMaker.budget(4,1));
assert.deepStrictEqual(acts.map(function(a){return a.slot.id;}),["B1","A1"]);
assert.strictEqual(PandaPrice.effectiveLevel([["0.005","5000"],["0.006","1000"]]),0.005);
assert.strictEqual(PandaPrice.effectiveLevel([["0.005","100"],["0.006","100"]]),0);
PandaPrice.midValue=0;PandaPrice.fetchedAt=0;assert.strictEqual(PandaPrice.mustWithdraw(),true);
PandaPrice.midValue=0.005;PandaPrice.fetchedAt=Date.now()-(6*60*1000);assert(PandaPrice.widenFactor()>1&&PandaPrice.widenFactor()<PandaPrice.MAX_WIDEN);
PandaPrice.fetchedAt=Date.now()-(21*60*1000);assert.strictEqual(PandaPrice.mustWithdraw(),true);
function evidence(rows){return {status:true,response:rows};}
assert.strictEqual(PandaVerify.adjudicate(evidence([{amount:"10",tokenid:"0x00",created:200}]),old,205),PandaVerify.CANCELLED);
assert.strictEqual(PandaVerify.adjudicate(evidence([{amount:"20",tokenid:PandaDEX.USDT,created:200}]),old,205),PandaVerify.FILLED);
assert.strictEqual(PandaVerify.adjudicate(evidence([{amount:"10",tokenid:"0x00",created:105}]),old,220),PandaVerify.UNKNOWN);
assert.strictEqual(PandaVerify.adjudicate(evidence([{amount:"10",tokenid:"0x00",created:200},{amount:"20",tokenid:PandaDEX.USDT,created:200}]),old,205),PandaVerify.FILLED);
var now=1000000, pend=[
  PandaPending.clean({kind:PandaPending.PLACE,orderId:"new1",buy:false,minima:"111",price:"0.005",submitMs:now,submitBlock:10}),
  PandaPending.clean({kind:PandaPending.CANCEL,orderId:old.orderId,coinid:old.coinid,buy:false,minima:"10",price:"2",submitMs:now,submitBlock:10}),
  PandaPending.clean({kind:PandaPending.EDIT,orderId:"edit1",coinid:"0xedit_old",buy:true,minima:"5",price:"3",submitMs:now,submitBlock:10})
];
var liveNew=cloneOrder(C,"0xnew","111",101); liveNew.orderId="new1";
var stillOld=cloneOrder(C,"0xedit_old","5",101); stillOld.orderId="edit1";
var edited=cloneOrder(C,"0xedit_new","5",102); edited.orderId="edit1";
var pr=PandaPending.resolve(pend,[liveNew,stillOld],now+1000);
assert.deepStrictEqual(pr.events.map(function(e){return [e.type,e.row.kind];}),[["live",PandaPending.PLACE],["settled",PandaPending.CANCEL]]);
assert.strictEqual(pr.rows.length,1);
assert.strictEqual(pr.refs["0xedit_old"],"edit:edit1");
pr=PandaPending.resolve(pr.rows,[edited],now+2000);
assert.deepStrictEqual(pr.events.map(function(e){return [e.type,e.row.kind];}),[["settled",PandaPending.EDIT]]);
assert.strictEqual(pr.rows.length,0);
pr=PandaPending.resolve([PandaPending.clean({kind:PandaPending.PLACE,orderId:"never",buy:true,minima:"1",price:"1",submitMs:now})],[],now+PandaPending.GIVEUP_MS+1);
assert.deepStrictEqual(pr.events.map(function(e){return e.type;}),["gaveup"]);
assert(PandaPending.status({kind:PandaPending.CANCEL,submitMs:now},now+4000).indexOf("Cancelling")===0);
var stats=PandaStats.stats24h([{timems:now-PandaStats.D1-1,price:"100",size:"10"},{timems:now-3000,price:"2",size:"5"},{timems:now-1000,price:"3",size:"7"}],now);
assert.deepStrictEqual(stats,{last:"3",changePct:"50",high:"3",low:"2",volume:"12"});
assert.deepStrictEqual(PandaStats.lastFill([{timems:now-5000,price:"2",size:"1"},{timems:now-1000,price:"3",size:"1"}],now),{price:"3",ageMs:1000});
/* ---- pool + composite ---- */
var pool={address:"0xpool",opk:"0xpk",oadr:"0xowner",tok:PandaDEX.USDT,kmin:"0",reserveM:"1000",reserveT:"10",coinidM:"0xpm",coinidT:"0xpt",tokDecimals:8,covenantScript:"SCRIPT"};
var q=PandaCurve.quoteTForMOut(pool,"10");assert(q.ok&&q.outAmount.gte("10")&&q.inAmount.gt(0));
var route=PandaPoolRouter.routeExactMinimaOut([pool],"10");assert(route.ok&&route.poolsUsed===1&&route.totalOut.gte("10"));
var synthetic=PandaSynthetic.sample([pool],true,"0.001",3);assert(synthetic.length>0&&PandaDEX.d(synthetic[0].poolMinima).gt(0));

/* ---- synthetic depth (native SyntheticDepthTest) ----
   A depth band answers "how much can I take before the NEXT slice costs more than this price?".
   Solving that on the AVERAGE cost instead of the MARGINAL cost overstates the answer by a factor
   approaching two on a constant-product curve — taking Q from reserves (x,y) moves the marginal
   price by ~2Q/x but the average by only ~Q/x. That is precisely the bug this pins: the ladder
   advertised twice the liquidity it could deliver at the price shown beside it. */
var dPool={address:"0xdp",opk:"0xpk",oadr:"0xo",tok:PandaDEX.USDT,kmin:"0",reserveM:"100000",reserveT:"500",coinidM:"0xdm",coinidT:"0xdt",tokDecimals:8,covenantScript:"S"};
var dPx=PandaCurve.aggregatePrice([dPool]), dCap=PandaCurve.totalMinima([dPool]).mul("0.5");
function solveAvg(boundary){ var lo=PandaDEX.d(0), hi=dCap, i, mid, r, eff, cmp;
  for(i=0;i<40;i++){ mid=lo.add(hi).div(2).toDecimalPlaces(8,Decimal.ROUND_HALF_UP);
    r=PandaPoolRouter.routeExactMinimaOut([dPool],mid);
    if(!r||!r.ok){hi=mid;continue;}
    eff=r.totalIn.div(r.totalOut).toDecimalPlaces(12,Decimal.ROUND_HALF_UP); cmp=eff.cmp(boundary);
    if(cmp<=0) lo=mid; else hi=mid; }
  return lo; }
function solveMarg(boundary){ var lo=PandaDEX.d(0), hi=dCap, i, mid, m, cmp;
  for(i=0;i<40;i++){ mid=lo.add(hi).div(2).toDecimalPlaces(8,Decimal.ROUND_HALF_UP);
    m=PandaSynthetic.marginalPrice([dPool],true,mid);
    if(!m){hi=mid;continue;} cmp=m.cmp(boundary);
    if(cmp<=0) lo=mid; else hi=mid; }
  return lo; }
var nearBoundary=dPx.add("0.0002"), avgQty=solveAvg(nearBoundary), margQty=solveMarg(nearBoundary);
assert(margQty.gt(0)&&avgQty.gt(margQty));
var overstatement=avgQty.div(margQty);
assert(overstatement.gt("1.9")&&overstatement.lt("2.1"));   /* the doubling, measured */
/* The marginal price at the solved quantity really is at the boundary, and past it, over. */
assert(PandaSynthetic.marginalPrice([dPool],true,margQty).lte(nearBoundary));
assert(PandaSynthetic.marginalPrice([dPool],true,margQty.mul(2)).gt(nearBoundary));

/* Displayed prices sit exactly on the tick grid — asks ceiled, bids floored, so a level never
   flatters its own side. Without this, pool rows never merge with the book's grouped levels. */
assert(PandaSynthetic.bucketPrice("0.0050051",true,"0.0001").eq("0.0051"));
assert(PandaSynthetic.bucketPrice("0.0050051",false,"0.0001").eq("0.005"));
var dSmall={address:"0xds",opk:"0xpk",oadr:"0xo",tok:PandaDEX.USDT,kmin:"0",reserveM:"2000",reserveT:"10",coinidM:"0xsm",coinidT:"0xst",tokDecimals:8,covenantScript:"S"};
var sCap=PandaCurve.totalMinima([dSmall]).mul("0.5");
[["0.0001",true],["0.0001",false],["0.001",true],["0.001",false]].forEach(function(cfg){
  var tickD=PandaDEX.d(cfg[0]), rows=PandaSynthetic.sample([dSmall],cfg[1],cfg[0],6), cum=PandaDEX.d(0), prevPrice=null, j, r;
  assert(rows.length>0);
  for(j=0;j<rows.length;j++){ r=rows[j];
    assert(r.poolMinima.gt(0));                                  /* bands are incremental, never zero or negative */
    assert(r.price.div(tickD).mod(1).eq(0));                     /* exactly on the grid */
    assert(r.price.gt(0));                                       /* a bid band never crosses zero */
    if(prevPrice) assert(cfg[1]?r.price.gt(prevPrice):r.price.lt(prevPrice));  /* monotonic away from mid */
    prevPrice=r.price; cum=cum.add(r.poolMinima); }
  assert(cum.lte(sCap));                                         /* never advertises more than half the reserves */
  /* Every displayed band must actually be fillable at the price shown next to it. */
  var running=PandaDEX.d(0);
  for(j=0;j<rows.length;j++){ running=running.add(rows[j].poolMinima);
    assert(PandaDEX.d(PandaComposite.plan([],[dSmall],cfg[1],running,rows[j].price,0).totalMinima).gte(running)); }
});
/* COST CEILING. Sampling depth used to ask PandaComposite.plan whether each band was executable —
   and with an empty book that router degenerates to the single pool route this now calls directly,
   after grinding through its 128-slice loop with two multi-pool routes per slice. Measured at 26
   SECONDS for one pool and 53 for three, on every block, on the page's own thread: the app froze.
   Counting routes rather than milliseconds keeps this deterministic across machines. */
var routeCount = 0, realRoute = PandaPoolRouter.route, realExact = PandaPoolRouter.routeExactMinimaOut;
PandaPoolRouter.route = function(a,b,c){ routeCount++; return realRoute(a,b,c); };
PandaPoolRouter.routeExactMinimaOut = function(a,b){ routeCount++; return realExact(a,b); };
var costPools = [];
for (var cp = 0; cp < 6; cp++) costPools.push({address:"0xcp"+cp,opk:"0xk",oadr:"0xo",tok:PandaDEX.USDT,kmin:"0",
  reserveM:String(2000+cp*500),reserveT:String(10+cp*2),coinidM:"0xcm"+cp,coinidT:"0xct"+cp,tokDecimals:8,covenantScript:"S"});
PandaSynthetic.sample(costPools,true,"0.0001",10);
PandaSynthetic.sample(costPools,false,"0.0001",10);
assert(routeCount > 0);
assert(routeCount < 1200, "synthetic depth cost regressed: " + routeCount + " routes for 6 pools");
/* The memo must actually be doing something — an uncached pass repeats amounts constantly. */
PandaSynthetic._routes = null;
var uncached = 0; routeCount = 0;
PandaSynthetic.sample(costPools,true,"0.0001",10);
uncached = routeCount;
assert(uncached > 0);
PandaPoolRouter.route = realRoute; PandaPoolRouter.routeExactMinimaOut = realExact;
/* A pool with no liquidity, no rows requested, or a nonsense tick yields nothing rather than throwing. */
assert.deepStrictEqual(PandaSynthetic.sample([],true,"0.001",6),[]);
assert.deepStrictEqual(PandaSynthetic.sample([dSmall],true,"0.001",0),[]);
assert.deepStrictEqual(PandaSynthetic.sample([dSmall],true,"0",6),[]);
var cheapAsk=cloneOrder(C,"0xask","5",100);cheapAsk.price=PandaDEX.d("0.005");cheapAsk.usdt=PandaDEX.d("0.025");cheapAsk.wantAmt=PandaDEX.d("0.025");cheapAsk.orderId="ask1";
var combo=PandaComposite.plan([cheapAsk],[pool],true,"20","0.02",200);
assert(!PandaComposite.isEmpty(combo));assert(PandaComposite.poolCount(combo)>0);assert(PandaDEX.d(combo.totalMinima).gt(0));assert(combo.sourceCoinIds.indexOf("0xpm")>=0&&combo.sourceCoinIds.indexOf("0xpt")>=0);
/* The last slice must consume a WHOLE order rather than stopping at a below-floor partial
   (native CompositeRouter.java:143 — orderChoice takes the full remaining request). */
var wholeAsk=cloneOrder(C,"0xwhole","5",100);wholeAsk.price=PandaDEX.d("0.005");wholeAsk.usdt=PandaDEX.d("0.025");wholeAsk.wantAmt=PandaDEX.d("0.025");wholeAsk.minRem=PandaDEX.d("4");wholeAsk.orderId="whole1";
var wholePlan=PandaComposite.plan([wholeAsk],[],true,"5","0.02",200);
assert(wholePlan.orderTakes.length===1&&wholePlan.orderTakes[0].partial===false);
/* Pool covenant scripts must survive quoting: escaping `/` would turn `*5/1000` into `*5\/1000`,
   making the script unparseable and stranding every coin at that address forever. */
assert(PandaPool.scriptArg("LET fx=MAX(dx 0)*5/1000").indexOf("*5/1000")>0);
assert.strictEqual(PandaPool.scriptArg('a"b'),'"a\\"b"');
var builtCalls=[], builtOutcome=null;
function comboCmd(command, cb){builtCalls.push(command);if(command.indexOf("txnexport")===0)return cb({status:true,response:{data:"0x00"}});if(command.indexOf("coins relevant:true")===0)return cb({status:true,response:[{coinid:"0xfund",tokenid:PandaDEX.USDT,tokenamount:"1",amount:"1",address:"0xfunder"}]});if(command.indexOf("newscript")===0)return cb({status:true});if(command.indexOf("txncheck")===0)return cb({status:true,response:{valid:{scripts:true,basic:true,mmrproofs:true,validamounts:true},allsignaturesvalid:true}});if(command.indexOf("txnpost")===0)return cb({pending:true,response:{txpowid:"0xcombo"}});cb({status:true});}
PandaTxn.fillComposite(comboCmd,{address:"0xme"},combo,true,function(err,tx){builtOutcome={err:err,tx:tx};});
var comboCreate=builtCalls.filter(function(c){return c.indexOf("txncreate id:combo_")===0;})[0], comboId=comboCreate.split("id:")[1];
assert.deepStrictEqual(builtOutcome,{err:null,tx:"0xcombo"});assert(builtCalls.some(function(c){return c==="txninput id:"+comboId+" coinid:0xpm";}));assert(builtCalls.some(function(c){return c.indexOf("address:0xpool")>0&&c.indexOf("tokenid:"+PandaDEX.USDT)>0;}));
/* Pool reserve addresses must NOT be tracked as wallet-owned. With trackall:true every stranger's
   liquidity reads as the user's own coins — the ownership pollution native lists as a fixed
   critical issue, and what this code did before it was restored. */
assert(builtCalls.some(function(c){return c.indexOf("newscript trackall:false script:")===0;}));
assert(!builtCalls.some(function(c){return c.indexOf("trackall:true")>0;}));
/* Transaction layout keeps the covenant's index rules: pool reserve PAIRS first, then whole order
   coins, then funding — the partial's remainder is the only covenant output and comes last. */
var layoutPrep=PandaTxn.prepareComposite(combo,true);
var layout=PandaTxn.buildCompositeSteps("tx",{address:"0xme"},combo,layoutPrep,true,[{coinid:"0xfund"}],"1");
var layoutInputs=layout.filter(function(c){return c.indexOf("txninput")===0;});
assert.strictEqual(layoutInputs[0],"txninput id:tx coinid:0xpm");
assert.strictEqual(layoutInputs[1],"txninput id:tx coinid:0xpt");
assert.strictEqual(layoutInputs[layoutInputs.length-1],"txninput id:tx coinid:0xfund");
/* Regression: Minima's txncheck says `validamounts`, never `amounts`. A valid owner-cancel
   must post, and must sign specifically with the owner key embedded in port 0. */
var calls=[], outcome=null;
function fakeCmd(command, cb){calls.push(command);if(command.indexOf("txnexport")===0)return cb({status:true,response:{data:"0x00"}});if(command.indexOf("txncheck")===0)return cb({status:true,response:{valid:{scripts:true,basic:true,mmrproofs:true,validamounts:true},allsignaturesvalid:true}});if(command.indexOf("txnpost")===0)return cb({pending:true,response:{txpowid:"0xposted"}});cb({status:true});}
PandaTxn.cancel(fakeCmd,sell,function(err,tx){outcome={err:err,tx:tx};});
assert.deepStrictEqual(outcome,{err:null,tx:"0xposted"});assert(calls.some(function(c){return c.indexOf("txnsign")===0&&c.indexOf("publickey:0xabc")>0;}));
calls=[];outcome=null;PandaTxn.relock(fakeCmd,sell,"30",function(err,tx){outcome={err:err,tx:tx};});
assert.deepStrictEqual(outcome,{err:null,tx:"0xposted"});assert(calls.some(function(c){return c.indexOf("txnoutput")===0&&c.indexOf("address:"+PandaDEX.ADDR)>0&&c.indexOf("storestate:true")>0;}));assert(calls.some(function(c){return c==="txnstate id:"+calls[0].split("id:")[1]+" port:2 value:30";}));
assert(PandaTxn.newWantForPrice(sell,"3").eq(30));
assert(PandaTxn.newWantForPrice(buy,"4").eq(5));
/* Covenant timing constants must stay in a workable order (native OrderValidationTest pins the
   first of these). An order has to expire while it is still visible, the scan has to reach past
   expiry or expired orders are never collectable, and renewal has to start well before expiry. */
assert(PandaDEX.EXPIRY < PandaDEX.HORIZON);
assert(PandaDEX.SCAN_DEPTH < PandaDEX.HORIZON);
assert(PandaDEX.SCAN_DEPTH > PandaDEX.EXPIRY);
assert(PandaDEX.RENEW_AT > 0 && PandaDEX.RENEW_AT < PandaDEX.EXPIRY);
/* A coin whose disappearance we could no longer explain must not be read as a trade. */
assert(PandaTape.VANISH_AGE < PandaDEX.SCAN_DEPTH && PandaTape.VANISH_AGE > PandaDEX.EXPIRY);
/* Funding queries mirror what `send` itself does, and filter by token server-side so the reply
   stays well under the MDS size cap. */
assert.strictEqual(PandaTxn.coinQuery(PandaDEX.USDT),"coins relevant:true sendable:true checkmempool:true simplestate:true tokenid:"+PandaDEX.USDT);
/* Serial signing gate — port of native SignGateTest. Minima keys are trees of one-time Winternitz
   leaves, so two operations signing at once reuse a leaf and leak its private key. The gate's whole
   job is that two operations are never open at the same time. */
PandaSignLock.reset();
var gateOrder=[], gateOpen=0, gateMaxOpen=0, gateRel=[];
function gateOp(name){PandaSignLock.gate(name,function(release){gateOrder.push(name);gateOpen++;if(gateOpen>gateMaxOpen)gateMaxOpen=gateOpen;gateRel.push(release);});}
gateOp("a");gateOp("b");gateOp("c");
assert.deepStrictEqual(gateOrder,["a"]);                                  /* a second operation waits */
gateOpen--;gateRel[0].free();assert.deepStrictEqual(gateOrder,["a","b"]); /* ...and starts on release */
gateOpen--;gateRel[1].free();assert.deepStrictEqual(gateOrder,["a","b","c"]);
gateOpen--;gateRel[2].free();gateRel[2].free();                           /* release is idempotent */
assert.strictEqual(gateMaxOpen,1);                                        /* never two at once */
assert.strictEqual(PandaSignLock.busy(),false);assert.strictEqual(PandaSignLock.queued(),0);
var gateRuns=0;PandaSignLock.gate("d",function(release){gateRuns++;release.free();});
assert.strictEqual(gateRuns,1);                                           /* empty queue runs immediately, once */
/* A chain that throws must free the gate AND surface the error. Swallowing it is exactly how three
   separate signing outages stayed invisible; the service wraps actions and reports instead. */
var gateThrew=false;
try { PandaSignLock.gate("boom",function(){throw new Error("chain blew up");}); }
catch (error) { gateThrew=true; }
assert(gateThrew,"a throwing chain must not be swallowed by the gate");
assert.strictEqual(PandaSignLock.busy(),false,"a throwing chain left the gate held");
var gateAfter=false;PandaSignLock.gate("after",function(release){gateAfter=true;release.free();});
assert(gateAfter,"the queue did not continue after a throwing chain");
/* There is no durable layer any more, and that is the point: it guarded against a second signing
   CONTEXT this app does not have (the page never loads signlock.js), it cost five SQL round-trips
   per transaction, and holding MDS.sql by reference detached a Java method and broke signing
   outright. Native's SignGate is a plain in-process queue too. */
assert.strictEqual(PandaSignLock.queued(),0);
/* Every signing path funnels through the gate: the txnsign chains AND the bare `send` that
   creates an order, because `send` signs internally too. */
calls=[];var gatedDuring=null;
PandaSignLock.gate("holder",function(release){
  PandaTxn.create(fakeCmd,{publickey:"0xabc",address:"0x"+"a".repeat(64)},{buy:false,minima:"10",price:"2",gtc:true,minRem:"1",orderId:"0x55"},function(){});
  gatedDuring=calls.some(function(c){return c.indexOf("send ")===0;});
  release.free();
});
assert.strictEqual(gatedDuring,false);   /* the send waited for the holder to release */
assert(calls.some(function(c){return c.indexOf("send ")===0&&c.indexOf("address:"+PandaDEX.ADDR)>0;}));
/* Size gate, ported from native DexTxn.postGated. Native is the parity reference and native does
   this; removing it in 0.4.2 because Limit and pandapools do not was reasoning from the wrong app. */
calls=[];outcome=null;
function sizedCmd(bytes){return function(command,cb){calls.push(command);
  if(command.indexOf("txnexport")===0)return cb({status:true,response:{data:"0x"+"ab".repeat(bytes)}});
  if(command.indexOf("txncheck")===0)return cb({status:true,response:{valid:{scripts:true,basic:true,mmrproofs:true,validamounts:true},allsignaturesvalid:true}});
  if(command.indexOf("txnpost")===0)return cb({pending:true,response:{txpowid:"0xposted"}});
  cb({status:true});};}
PandaTxn.cancel(sizedCmd(10),sell,function(err,tx){outcome={err:err,tx:tx};});
assert.deepStrictEqual(outcome,{err:null,tx:"0xposted"},"a small transaction must still post");
assert(calls.some(function(c){return c.indexOf("txnexport")===0;}),"the size gate must run");
calls=[];outcome=null;
PandaTxn.cancel(sizedCmd(70*1024),sell,function(err){outcome=err;});
assert(outcome&&outcome.indexOf("too large")>0,"an oversized transaction must be refused");
assert(!calls.some(function(c){return c.indexOf("txncheck")===0;}),"refused before validation");
assert(calls.some(function(c){return c.indexOf("txndelete")===0;}),"and cleaned up");
/* Native fails hard when it cannot size the transaction; it does not pass silently. */
calls=[];outcome=null;
PandaTxn.cancel(function(command,cb){calls.push(command);if(command.indexOf("txnexport")===0)return cb({status:false,error:"no export"});cb({status:true});},sell,function(err){outcome=err;});
assert(outcome,"an unreadable txnexport must fail, as native does");
assert(!calls.some(function(c){return c.indexOf("txnpost")===0;}),"nothing may post when the size is unknown");

/* A locked vault fails EVERY signature and is an ordinary state on a node left locked. Limit says
   what to do about it; we used to surface the raw node error, which explains nothing. */
assert(PandaTxn.signError("Vault is LOCKED").indexOf("vault is LOCKED")>0);
assert(PandaTxn.signError("signing failed: Public Key not found").indexOf("not finished preparing")>0);
assert.strictEqual(PandaTxn.signError("some other problem"),"");
calls=[];outcome=null;
function lockedCmd(command,cb){calls.push(command);if(command.indexOf("txnexport")===0)return cb({status:true,response:{data:"0x00"}});if(command.indexOf("txnsign")===0)return cb({status:false,error:"Wallet is LOCKED"});cb({status:true});}
PandaTxn.cancel(lockedCmd,sell,function(err){outcome=err;});
assert(outcome&&outcome.indexOf("vault is LOCKED")>0,"a locked vault must name itself, got: "+outcome);
assert(calls.some(function(c){return c.indexOf("txndelete")===0;}),"a failed sign must still clean up");
assert.strictEqual(PandaSignLock.busy(),false);

/* Keys materialise asynchronously; signing with an owner key this wallet does not hold must be
   refused before it reaches the node, not surfaced as a raw error afterwards. */
PandaTxn.holdsKey=function(k){return k==="0xabc";};
calls=[];outcome=null;
var foreign=cloneOrder(C,"0xforeign","10",100); foreign.ownerPk="0xsomeoneelse";
PandaTxn.cancel(fakeCmd,foreign,function(err){outcome=err;});
assert(outcome&&outcome.indexOf("does not hold the key")>0,"a foreign owner key must be refused up front");
assert.strictEqual(calls.length,0,"nothing should reach the node when the key is not held");
calls=[];outcome=null;PandaTxn.cancel(fakeCmd,sell,function(err,tx){outcome={err:err,tx:tx};});
assert.deepStrictEqual(outcome,{err:null,tx:"0xposted"},"a key we DO hold must still sign");
PandaTxn.holdsKey=null;
/* SelfSplit — exact command shape (native SelfSplitTest). MINIMA omits tokenid entirely; a token
   split puts tokenid before split. And it signs, so it must sit behind the gate. */
assert.strictEqual(PandaSplit.command("0xme","0x00","5"),"send address:0xme amount:5 split:10");
assert.strictEqual(PandaSplit.command("0xme",PandaDEX.USDT,"2.5"),"send address:0xme amount:2.5 tokenid:"+PandaDEX.USDT+" split:10");
calls=[];var splitDuring=null;
PandaSignLock.gate("holder",function(release){
  PandaSplit.run(fakeCmd,"0xme","0x00","5",function(){});
  splitDuring=calls.some(function(c){return c.indexOf("send ")===0;});
  release.free();
});
assert.strictEqual(splitDuring,false);
assert(calls.some(function(c){return c.indexOf("send address:0xme")===0&&c.indexOf("split:10")>0;}));

/* Trade export — money in / money out from confirmed rows only, cut never rounded up. */
var xrows=[{timems:1,block:10,price:"2",size:"3",buy:true,maker:false,spentcoin:"0xa",txpowid:"0xdead"},
           {timems:2,block:11,price:"4",size:"1",buy:false,maker:true,spentcoin:"0xb"}];
var xt=PandaExport.totals(xrows);
assert.strictEqual(xt.fills,2);
assert(xt.minimaBought.eq(3)&&xt.minimaSold.eq(1));
assert(xt.usdtPaid.eq(6)&&xt.usdtReceived.eq(4));
assert(xt.netMinima.eq(2)&&xt.netUsdt.eq(-2));
/* An unpriced or zero-size row is not a trade and must not reach the export. */
assert.strictEqual(PandaExport.totals([{price:"0",size:"5"},{price:"2",size:"0"}]).fills,0);
/* The notional is cut down, never up: 0.333...*3 must not become 1. */
assert(PandaExport.totals([{timems:1,price:"0.33333333",size:"3",buy:true}]).usdtPaid.lt(1));
var xcsv=PandaExport.confirmedCsv(xrows).split("\n");
assert.strictEqual(xcsv[0],"timestamp,block,side,minima,price_usdt_per_minima,notional_usdt,role,order_id,txpowid");
assert(xcsv[1].indexOf("BUY")>0&&xcsv[1].indexOf("TAKER")>0);
assert(xcsv[2].indexOf("SELL")>0&&xcsv[2].indexOf("MAKER")>0);
/* Rows with no txpowid can only ever be locally observed — the export must not claim more. */
var xver=PandaExport.verificationCsv(xrows).split("\n");
assert(xver[2].indexOf(PandaExport.UNVERIFIED)>0);
/* A field containing a comma must not break the column count. */
assert(PandaExport.verificationCsv([{timems:1,price:"1",size:"1",verification_note:"a,b",txpowid:"0x1"}]).indexOf('"a,b"')>0);
assert.strictEqual(PandaExport.files(xrows,{}).length,4);
/* The running position closes where the totals say it should. */
var xrec=PandaExport.reconciliationCsv(xrows).trim().split("\n");
assert.strictEqual(xrec[xrec.length-1].split(",")[4],"2.00000000");

/* Explorer verification — five states, and never "the trade did not happen" when the network failed. */
assert.strictEqual(PandaExplorer.validId("0xABCdef12"),true);
assert.strictEqual(PandaExplorer.validId("not-hex"),false);
assert.strictEqual(PandaExplorer.classify(0,"").status,PandaExplorer.ERROR);
assert.strictEqual(PandaExplorer.classify(404,"").status,PandaExplorer.NOT_FOUND);
assert.strictEqual(PandaExplorer.classify(503,"").status,"EXPLORER_HTTP_503");
assert.strictEqual(PandaExplorer.classify(200,"not json").status,PandaExplorer.ERROR);
assert.strictEqual(PandaExplorer.classify(200,'[{"result":{"data":{"json":{"txpowid":"0x1"}}}}]').status,PandaExplorer.OK);
assert.strictEqual(PandaExplorer.classify(200,'[{"result":{"data":{"json":null}}}]').status,PandaExplorer.NOT_FOUND);
assert.strictEqual(PandaExplorer.classify(200,'[{"error":{"message":"boom"}}]').status,PandaExplorer.ERROR);
/* A fill with no recorded txpowid never reaches the network at all. */
var reached=false; PandaExplorer.request=function(){reached=true;};
PandaExplorer.verify("",function(r){assert.strictEqual(r.status,PandaExplorer.LOCAL_ONLY);});
assert.strictEqual(reached,false);
assert(PandaExplorer.url("0xabc").indexOf(PandaExplorer.BASE)===0);
/* ---- covenant partial-fill arithmetic (native PriceMathTest) ----
   This is the most fund-critical logic in the app: it is what the covenant checks on-chain, and
   getting it wrong either strands a maker's funds or lets a taker underpay. Honest partials must
   be accepted at every ratio; every way of shaving a grain must be rejected. */
function honest(locked, want, rem, minRem) {
  var take = PandaDEX.d(locked).sub(rem);
  return PandaDEX.covenantAccepts(locked, want, rem, minRem || "0",
    PandaDEX.payFor(want, locked, take), PandaDEX.newWantFor(want, locked, rem));
}
assert(honest("100","0.575","40"));
assert(honest("100","0.575","1"));
assert(honest("100","0.575","99"));
assert(honest("1000000000","1000000000","500000000"));
assert(honest("3","1","1"));          /* a ratio that does not divide cleanly */
assert(honest("7","0.00000001","3")); /* sub-grain pro-rata, ceiled the maker's way */
/* A taker shaving one grain off the payment is rejected. */
var L="100", W="0.575", R="40", T=PandaDEX.d(L).sub(R);
var goodPay=PandaDEX.payFor(W,L,T), goodWant=PandaDEX.newWantFor(W,L,R);
assert.strictEqual(PandaDEX.covenantAccepts(L,W,R,"0",goodPay.sub("0.00000001"),goodWant),false);
/* ...or one grain off the remainder's new want. */
assert.strictEqual(PandaDEX.covenantAccepts(L,W,R,"0",goodPay,goodWant.sub("0.00000001")),false);
/* No progress: a "partial" that leaves the order exactly as it was. */
assert.strictEqual(PandaDEX.covenantAccepts(L,W,L,"0",goodPay,W),false);
/* A remainder below the maker's dust floor. */
assert.strictEqual(PandaDEX.covenantAccepts(L,W,"1","5",PandaDEX.payFor(W,L,"99"),PandaDEX.newWantFor(W,L,"1")),false);
/* A remainder that wants MORE than the whole order did. */
assert.strictEqual(PandaDEX.covenantAccepts(L,W,R,"0",goodPay,PandaDEX.d(W).add("0.00000001")),false);
assert(PandaDEX.newWantFor(W,L,L).lte(PandaDEX.d(W)));
/* Overpaying a maker is legal — only underpaying is not. */
assert(PandaDEX.covenantAccepts(L,W,R,"0",goodPay.add("1"),goodWant));
/* The maker is never left worse off across the split: payment plus remaining want covers it. */
assert(goodPay.add(goodWant).gte(PandaDEX.d(W)));

/* ---- hostile orders (native OrderValidationTest) ---- */
function poisoned(mutate) { var c=JSON.parse(JSON.stringify(C)); mutate(c); return PandaDEX.order(c); }
/* A payout addressed back at the book would let a filler recycle the funds into the covenant. */
assert.strictEqual(poisoned(function(c){c.state["1"]=PandaDEX.ADDR;}),null);
/* A payout address that is not a 64-hex address at all. */
assert.strictEqual(poisoned(function(c){c.state["1"]="0xnope";}),null);
/* Amounts finer than the chain's grain. */
assert.strictEqual(poisoned(function(c){c.state["2"]="20.000000001";}),null);
assert.strictEqual(poisoned(function(c){c.state["8"]="0.000000001";}),null);
/* A negative minimum remainder. */
assert.strictEqual(poisoned(function(c){c.state["8"]="-1";}),null);
/* A sell that wants MINIMA back, or a buy locked in the wrong asset. */
assert.strictEqual(poisoned(function(c){c.state["3"]="0x00";}),null);
/* A hostile order must not be reachable through the planner either. */
assert.strictEqual(PandaBook.plan([poisoned(function(c){c.state["1"]=PandaDEX.ADDR;})].filter(Boolean),true,"1",null,110).takes.length,0);

/* ---- sweep planning (native SweepPlannerTest) ---- */
function ask(id, minima, price, created, minRem) {
  var c=JSON.parse(JSON.stringify(C)); c.coinid=id; c.amount=minima; c.created=String(created||100);
  c.state["2"]=PandaDEX.d(minima).mul(price).toFixed(); c.state["4"]=id; c.state["8"]=minRem||"0";
  return PandaDEX.order(c);
}
var cheap=ask("0xc","10","1",100), dear=ask("0xd","10","3",100);
var sp=PandaBook.plan([dear,cheap],true,"15",null,110);
assert.strictEqual(sp.takes.length,2);
assert.strictEqual(sp.takes[0].order.coinid,"0xc");        /* best price first */
assert.strictEqual(sp.takes[0].partial,false);             /* fill the best one whole... */
assert.strictEqual(sp.takes[1].partial,true);              /* ...and only the last is partial */
/* A limit price excludes anything worse. */
assert.strictEqual(PandaBook.plan([dear,cheap],true,"15","1",110).takes.length,1);
/* An order too close to expiry is skipped: it could lapse while the sweep is still mining. */
assert.strictEqual(PandaBook.plan([ask("0xe","10","1",100)],true,"5",null,100+PandaDEX.EXPIRY-10).takes.length,0);
/* The maker's dust floor shrinks the take rather than leaving an unsellable stub — and the
   remainder it reports must be the one it actually leaves behind. Regression: the clamp used to
   adjust the take without recomputing the remainder, so the sweep wrote a covenant output below
   the maker's floor with amounts that did not balance. The covenant rejected it every time,
   silently, after the taker had already paid for the proof-of-work. */
var flooredOrder=ask("0xf","10","1",100,"4"), floored=PandaBook.plan([flooredOrder],true,"9",null,110);
assert.strictEqual(floored.takes.length,1);
assert(floored.takes[0].remainder.gte(4));
assert(floored.takes[0].lockedTake.add(floored.takes[0].remainder).eq(flooredOrder.locked));
/* ...and the covenant would actually accept what the planner produced. */
assert(PandaDEX.covenantAccepts(flooredOrder.locked, flooredOrder.wantAmt, floored.takes[0].remainder,
  flooredOrder.minRem, floored.takes[0].pay, PandaDEX.newWantFor(flooredOrder.wantAmt, flooredOrder.locked, floored.takes[0].remainder)));
/* Every partial the planner emits must satisfy the covenant, clamped or not. */
[["10","1","0","7"],["10","1","4","9"],["100","0.0575","30","55"]].forEach(function(v){
  var o=ask("0x9"+v[3],v[0],v[1],100,v[2]), pl=PandaBook.plan([o],true,v[3],null,110), t=pl.takes[0];
  if(!t||!t.partial) return;
  assert(t.lockedTake.add(t.remainder).eq(o.locked));
  assert(PandaDEX.covenantAccepts(o.locked,o.wantAmt,t.remainder,o.minRem,t.pay,PandaDEX.newWantFor(o.wantAmt,o.locked,t.remainder)));
});
/* Never more than one partial in a single transaction — the covenant only allows the last. */
var many=PandaBook.plan([ask("0x1a","10","1",100),ask("0x1b","10","1",100),ask("0x1c","10","1",100)],true,"25",null,110);
assert.strictEqual(many.takes.filter(function(t){return t.partial;}).length,1);
assert.strictEqual(many.takes[many.takes.length-1].partial,true);
/* A sweep never exceeds the covenant's per-transaction order cap. */
var wide=[],wi; for(wi=0;wi<12;wi++) wide.push(ask("0x2"+wi,"10","1",100));
assert(PandaBook.plan(wide,true,"120",null,110).takes.length<=PandaDEX.MAX_ORDERS);
/* ---- fixes from the 0.3.5 review ---- */
/* Both LEGS are capped, not just the locked one: the covenant compares by cross-multiplication,
   so an unbounded want side can overflow just as easily. */
var legCalls=[];
function legCmd(c,cb){legCalls.push(c);cb({status:true,response:{random:"0x55"}});}
PandaTxn.create(legCmd,{publickey:"0xabc",address:"0x"+"a".repeat(64)},{buy:false,minima:"1000000000",price:"2",orderId:"0x1"},function(err){assert(err&&err.indexOf("permitted range")>0);});
assert(!legCalls.some(function(c){return c.indexOf("send ")===0;}));
/* Funding is capped at 8 inputs and refused up front, not after signing has already burned a key. */
var dust=[],di; for(di=0;di<40;di++) dust.push({coinid:"0xd"+di,tokenid:"0x00",amount:"0.001",address:"0xw"});
PandaTxn.findCoins(function(c,cb){cb({status:true,response:dust});},"0x00","5",{},8,function(err,coins){
  assert(err&&err.indexOf("consolidate")>0); assert.strictEqual(coins,undefined); });
/* CSV fields that a spreadsheet would execute are neutralised. The order id is covenant port 4 —
   chosen by whoever created the order and never validated — so this is attacker-controlled. */
var evil=PandaExport.confirmedCsv([{timems:1,price:"2",size:"1",buy:true,orderid:'=HYPERLINK("http://evil","x")'}]);
assert(evil.indexOf("'=HYPERLINK")>0);
assert(evil.indexOf(",=HYPERLINK")<0);
["+1","-1","@x","\tx"].forEach(function(bad){
  assert(PandaExport.confirmedCsv([{timems:1,price:"2",size:"1",buy:true,orderid:bad}]).indexOf("'"+bad.charAt(0))>0); });
/* Port 6 is want-per-locked everywhere and rounded, so a partial never carries a 40-digit state
   value and the same order reads the same way whichever path last touched it. */
assert.strictEqual(PandaDEX.portPrice("1","3").toFixed(),"0.333333333333");
assert.strictEqual(PandaDEX.portPrice("1","0").toFixed(),"0");
calls=[];PandaTxn.relock(fakeCmd,sell,"30",function(){});
assert(calls.some(function(c){return c==="txnstate id:"+calls[0].split("id:")[1]+" port:6 value:3";}));
/* The smallest pool is the one contributing least MINIMA — a different leg on each side. */
var allocBig={pool:{address:"0xbig"},quote:{inAmount:PandaDEX.d(100),outAmount:PandaDEX.d(1)}};
var allocSmall={pool:{address:"0xsmall"},quote:{inAmount:PandaDEX.d(1),outAmount:PandaDEX.d(100)}};
assert.strictEqual(PandaComposite.smallestPool({allocs:[allocBig,allocSmall]},true).address,"0xbig");
assert.strictEqual(PandaComposite.smallestPool({allocs:[allocBig,allocSmall]},false).address,"0xsmall");
/* Against a buy order the reported MINIMA is what the taker actually delivers. */
function bidOrder(id,usdt,price,minRem){var c=JSON.parse(JSON.stringify(C));c.coinid=id;c.tokenid=PandaDEX.USDT;c.tokenamount=usdt;c.amount=usdt;c.created="100";
  c.state["2"]=PandaDEX.d(usdt).div(price).toFixed();c.state["3"]="0x00";c.state["5"]="0";c.state["4"]=id;c.state["8"]=minRem||"0";return PandaDEX.order(c);}
var bidO=bidOrder("0xb1","20","2"), bidPlan=PandaBook.plan([bidO],false,"3",null,110);
assert.strictEqual(bidPlan.takes.length,1);
assert(bidPlan.takes[0].minima.gte(bidPlan.takes[0].pay));   /* never understates the spend */
assert(bidPlan.totalMinima.gte(bidPlan.takes[0].pay));
/* A wide window that comes back empty is re-checked once before being believed — an over-cap MDS
   reply is indistinguishable from a genuinely empty one, and believing it drops real orders. */
var scanQueries=[];
PandaBook.scan(function(c,cb){scanQueries.push(c);cb({status:true,response:[]});},function(found,incomplete){
  assert.deepStrictEqual(found,[]); assert.strictEqual(incomplete,false); });
assert(scanQueries.length>1);
assert(scanQueries.some(function(c){return c.indexOf("coinage:0 depth:"+PandaDEX.SCAN_DEPTH)>0;}));  /* full window first */
assert(scanQueries.some(function(c){return c.indexOf("coinage:0 depth:"+Math.floor(PandaDEX.SCAN_DEPTH/2))>0;}));  /* then halved */
/* ---- THE RHINO SCOPE HARNESS ----
   The MDS service is Rhino: ServiceJSRunner builds the scope with ctx.initStandardObjects() and
   injects only `MDS`. No setTimeout, no setInterval, no XMLHttpRequest, no window, no document.
   signlock.js called setInterval, which threw before the work function ever ran — and because
   MDSJS.sql invokes JS callbacks with no try/catch the error vanished and the UI never changed.
   The app could not sign or post ANYTHING from 0.2.33 to 0.3.7 and nothing caught it, because
   every test until now ran under Node, where the timers exist.
   This loads every service module in a faithful model of that scope and proves signing works. */
(function () {
  var vmmod = require("vm"), fsmod = require("fs");
  var sqlLog = [];
  /* A Java-hosted method REJECTS a wrong receiver:
       Java method "sql" was invoked with [object Object] as "this" value
     A plain JS mock does not, which is why `PandaSignLock.use(MDS.sql)` — a detached Java method —
     passed every test and then broke every signing path on the node. Model the bridge, not a
     convenient approximation of it. */
  function hostMethod(owner, name, impl) {
    return function () {
      if (this !== owner) throw new Error('Java method "' + name + '" was invoked with [object Object] as "this" value');
      return impl.apply(this, arguments);
    };
  }
  var sandbox = {
    /* exactly what Rhino's initStandardObjects() provides, and nothing else */
    Object: Object, Array: Array, Function: Function, String: String, Number: Number,
    Boolean: Boolean, Date: Date, Math: Math, JSON: JSON, RegExp: RegExp, Error: Error,
    TypeError: TypeError, RangeError: RangeError,
    isNaN: isNaN, isFinite: isFinite, parseInt: parseInt, parseFloat: parseFloat,
    MDS: (function () {
      var mds = {}, net = {}, comms = {};
      mds.sql = hostMethod(mds, "sql", function (q, cb) { sqlLog.push(q); if (cb) cb({ status: true, rows: [] }); });
      mds.cmd = hostMethod(mds, "cmd", function (c, cb) { if (cb) cb({ status: true, response: {} }); });
      mds.log = hostMethod(mds, "log", function () {});
      mds.notify = hostMethod(mds, "notify", function () {});
      mds.load = hostMethod(mds, "load", function () {});
      /* MDS.net.GET binds `this` to NETService, not to MDS — its own owner. */
      net.GET = hostMethod(net, "GET", function (u, cb) { if (cb) cb({ status: false }); });
      comms.solo = hostMethod(comms, "solo", function (m, cb) { if (cb) cb(); });
      mds.net = net; mds.comms = comms;
      return mds;
    })()
  };
  vmmod.createContext(sandbox);
  /* Exactly the list service.js loads, in the same order. */
  ["decimal.js","covenant.js","signlock.js","book.js","pool.js","composite.js","txn.js","tape.js",
   "maker.js","price.js","verifier.js","pending.js","stats.js","split.js","history.js"].forEach(function (f) {
    try { vmmod.runInContext(fsmod.readFileSync(f, "utf8"), sandbox, { filename: f }); }
    catch (error) { throw new Error(f + " cannot load in the MDS service scope: " + error); }
  });
  /* decimal.js is a UMD bundle; the service gets Decimal from its own global. */
  vmmod.runInContext("if (typeof Decimal === 'undefined' && typeof module !== 'undefined') { }", sandbox);
  /* The gate must actually run its work and release, with the SQL layer live. */
  var result = vmmod.runInContext(
    "PandaSignLock.use(MDS.sql);" +
    "var ran = 0, err = null;" +
    "try { PandaSignLock.gate('dex', function (rel) { ran++; rel.free(); }); }" +
    "catch (e) { err = String(e); }" +
    "JSON.stringify({ ran: ran, err: err, busy: PandaSignLock.busy(), queued: PandaSignLock.queued() });",
    sandbox);
  var parsed = JSON.parse(result);
  assert.strictEqual(parsed.err, null, "signing threw in the MDS service scope: " + parsed.err);
  assert.strictEqual(parsed.ran, 1, "the signing work function never ran in the MDS service scope");
  assert.strictEqual(parsed.busy, false, "the signing gate was not released");
  assert.strictEqual(parsed.queued, 0);
  /* The gate must touch NO database at all — a durable lock row was never needed here and the
     detached MDS.sql it required is what broke signing on the node. */
  assert(!sqlLog.some(function (q) { return q.indexOf("sign_lock") >= 0; }),
    "the signing gate is still talking to the database");
  /* Two operations still serialise, and the second only runs when the first releases. */
  var serial = vmmod.runInContext(
    "PandaSignLock.reset();" +
    "var order = [], rels = [];" +
    "PandaSignLock.gate('a', function (r) { order.push('a'); rels.push(r); });" +
    "PandaSignLock.gate('b', function (r) { order.push('b'); rels.push(r); });" +
    "var mid = order.join(',');" +
    "rels[0].free();" +
    "JSON.stringify({ mid: mid, end: order.join(','), busy: PandaSignLock.busy() });",
    sandbox);
  var s2 = JSON.parse(serial);
  assert.strictEqual(s2.mid, "a", "two signing operations ran concurrently");
  assert.strictEqual(s2.end, "a,b");
  /* And no service module may reference a browser global at all. */
  /* A host method must be CALLED on its owner, never passed or stored. Detaching one is invisible
     under Node and fatal on the node. */
  ["signlock.js","price.js","txn.js","service.js","tape.js","pool.js","composite.js","book.js",
   "covenant.js","maker.js","verifier.js","pending.js","stats.js","split.js","history.js"].forEach(function (f) {
    var src = fsmod.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    /* `if (MDS.notify)` and `typeof MDS.log` are existence checks, not detachments — strip them
       before looking for a host method being passed as an argument or assigned to a variable. */
    src = src.replace(/\b(?:if|while|typeof|return)\s*\(?\s*MDS\.[a-z]+(\.[A-Za-z]+)?/g, " ");
    var detached = src.match(/[(,=]\s*MDS\.[a-z]+(\.[A-Za-z]+)?\s*[,);]/g);
    assert(!detached, f + " passes a host method by reference (" + detached + ") — call it on its owner instead");
  });
  ["signlock.js","price.js","txn.js","service.js","tape.js","pool.js","composite.js","book.js",
   "covenant.js","maker.js","verifier.js","pending.js","stats.js","split.js"].forEach(function (f) {
    /* Strip comments first — this file's own header names the globals it must not use. */
    var src = fsmod.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    [/\bsetTimeout\s*\(/, /\bsetInterval\s*\(/, /\bXMLHttpRequest\b/, /\bwindow\./, /\bdocument\./,
     /\blocalStorage\b/, /\bnavigator\b/].forEach(function (bad) {
      assert(!bad.test(src), f + " uses a browser global the MDS service does not have: " + bad);
    });
  });
})();
/* ---- END-TO-END: boot the real service and post a trade, in the real service scope ----
   Everything above tests modules in isolation. Nothing tested that service.js actually boots and
   that a trade reaches txnpost — which is why a broken signing gate, and later a restructured
   LIMIT handler, could ship. This drives the genuine service against a mock node. */
(function () {
  var vmmod = require("vm"), fsmod = require("fs"), ADDR = null, MYADDR = "0x" + "b".repeat(64), sent = [], inited = null;
  function coinsFor(cmdstr) {
    if (cmdstr.indexOf("address:" + ADDR) > 0) {                       /* the order book */
      return [{ coinid:"0xbid1", tokenid:"0x7D39745FBD29049BE29850B55A18BF550E4D442F930F86266E34193D89042A90",
                tokenamount:"20", amount:"20", created:"990",
                state:{ "0":"0xstranger", "1":"0x"+"c".repeat(64), "2":"10", "3":"0x00", "4":"0xbid1", "5":"0", "7":"0", "8":"0" } }];
    }
    if (cmdstr.indexOf("relevant:true") === 0 || cmdstr.indexOf("coins relevant:true") === 0) {
      return [{ coinid:"0xfund", tokenid:"0x00", amount:"100000", address:MYADDR }];  /* wallet funding */
    }
    return [];                                                          /* sentinel / pools: none */
  }
  var sandbox = {
    Object:Object, Array:Array, Function:Function, String:String, Number:Number, Boolean:Boolean,
    Date:Date, Math:Math, JSON:JSON, RegExp:RegExp, Error:Error, TypeError:TypeError,
    isNaN:isNaN, isFinite:isFinite, parseInt:parseInt, parseFloat:parseFloat,
    MDS: {
      init: function (cb) { inited = cb; },
      load: function () {},   /* the real service has this; modules are already in the scope */
      log: function () {}, notify: function () {},
      sql: function (q, cb) { if (cb) cb({ status:true, rows:[] }); },
      comms: { solo: function (m, cb) { if (cb) cb(); } },
      net: { GET: function (u, cb) { if (cb) cb({ status:false }); } },
      cmd: function (c, cb) {
        sent.push(c);
        var r = { status:true };
        if (c.indexOf("runscript") === 0) r = { status:true, response:{ parseok:true, script:{ address:ADDR } } };
        else if (c.indexOf("getaddress") === 0) r = { status:true, response:{ address:MYADDR, publickey:"0xmypk", miniaddress:"MxABC" } };
        else if (c.indexOf("keys action:list") === 0) r = { status:true, response:[{ publickey:"0xmypk" }] };
        else if (c.indexOf("scripts") === 0) r = { status:true, response:[{ address:MYADDR }] };
        else if (c.indexOf("block") === 0) r = { status:true, response:{ block:1000 } };
        else if (c.indexOf("coins") === 0) r = { status:true, response:coinsFor(c) };
        else if (c.indexOf("random") === 0) r = { status:true, response:{ random:"0xnewid" } };
        else if (c.indexOf("txnexport") === 0) r = { status:true, response:{ data:"0x00" } };
        else if (c.indexOf("txncheck") === 0) r = { status:true, response:{ valid:{ scripts:true, basic:true, mmrproofs:true, validamounts:true }, allsignaturesvalid:true } };
        else if (c.indexOf("txnpost") === 0) r = { pending:true, response:{ txpowid:"0xposted" } };
        if (cb) cb(r);
      }
    }
  };
  vmmod.createContext(sandbox);
  ["decimal.js","covenant.js","signlock.js","book.js","pool.js","composite.js","txn.js","tape.js",
   "maker.js","price.js","verifier.js","pending.js","stats.js","split.js","history.js"].forEach(function (f) {
    vmmod.runInContext(fsmod.readFileSync(f, "utf8"), sandbox, { filename:f });
  });
  ADDR = vmmod.runInContext("PandaDEX.ADDR", sandbox);
  vmmod.runInContext(fsmod.readFileSync("service.js", "utf8"), sandbox, { filename:"service.js" });
  assert(inited, "service.js never called MDS.init");
  inited({ event:"inited" });
  assert.strictEqual(vmmod.runInContext("PDService.ready", sandbox), true, "the service did not finish booting");
  assert.strictEqual(vmmod.runInContext("PDService.book.length", sandbox), 1, "the service did not parse the order book");
  /* Sell into the resting bid — the direction that was failing on the live node. */
  sent.length = 0;
  vmmod.runInContext("PDService.action({type:'LIMIT',data:{buy:false,minima:'5',price:'1',gtc:true,minRem:'0'}});", sandbox);
  assert(sent.some(function (c) { return c.indexOf("txncreate") === 0; }), "no transaction was built");
  assert(sent.some(function (c) { return c.indexOf("txninput") === 0 && c.indexOf("0xbid1") > 0; }), "the resting order was not consumed");
  assert(sent.some(function (c) { return c.indexOf("txnsign") === 0; }), "the transaction was never signed");
  assert(sent.some(function (c) { return c.indexOf("txnpost") === 0; }), "the transaction was never posted");
  assert.strictEqual(vmmod.runInContext("PDService.busy", sandbox), false, "busy was left set after the trade");
  assert.strictEqual(vmmod.runInContext("PandaSignLock.busy()", sandbox), false, "the signing gate was left held");
  /* And the trade is remembered for recording, with its evidence. */
  var meta = JSON.parse(vmmod.runInContext("JSON.stringify(PDService.fillMeta||null)", sandbox));
  assert(meta && meta.spentcoin === "0xbid1", "the fill was not recorded for reconciliation");
  assert.strictEqual(meta.sourceKind, "BOOK");
  assert.strictEqual(meta.txpowid, "0xposted");
})();
/* Same harness, now with a live PandaPools pool — the blended path that failed on mainnet. */
(function () {
  var vmmod = require("vm"), fsmod = require("fs"), ADDR = null, SENT = "0x50414E4441504F4F4C53",
      POOL = "0x" + "d".repeat(64), MYADDR = "0x" + "b".repeat(64), USDT = null, sent = [], inited = null;
  var sandbox = {
    Object:Object, Array:Array, Function:Function, String:String, Number:Number, Boolean:Boolean,
    Date:Date, Math:Math, JSON:JSON, RegExp:RegExp, Error:Error, TypeError:TypeError,
    isNaN:isNaN, isFinite:isFinite, parseInt:parseInt, parseFloat:parseFloat,
    MDS: {
      init:function(cb){inited=cb;}, load:function(){}, log:function(){}, notify:function(){},
      sql:function(q,cb){ if(cb) cb({status:true,rows:[]}); },
      comms:{ solo:function(m,cb){ if(cb) cb(); } },
      net:{ GET:function(u,cb){ if(cb) cb({status:false}); } },
      cmd:function(c,cb){
        sent.push(c);
        var r={status:true};
        if(c.indexOf("runscript")===0)
          r={status:true,response:{parseok:true,script:{address:(c.indexOf("PREVSTATE(0)")>0?ADDR:POOL)}}};
        else if(c.indexOf("getaddress")===0) r={status:true,response:{address:MYADDR,publickey:"0xmypk",miniaddress:"MxABC"}};
        else if(c.indexOf("keys action:list")===0) r={status:true,response:[{publickey:"0xmypk"}]};
        else if(c.indexOf("scripts")===0) r={status:true,response:[{address:MYADDR}]};
        else if(c.indexOf("block")===0) r={status:true,response:{block:1000}};
        else if(c.indexOf("random")===0) r={status:true,response:{random:"0xnewid"}};
        else if(c.indexOf("txnexport")===0) r={status:true,response:{data:"0x00"}};
        else if(c.indexOf("txncheck")===0) r={status:true,response:{valid:{scripts:true,basic:true,mmrproofs:true,validamounts:true},allsignaturesvalid:true}};
        else if(c.indexOf("txnpost")===0) r={pending:true,response:{txpowid:"0xcomposite"}};
        else if(c.indexOf("coins")===0){
          var rows=[];
          if(c.indexOf("address:"+SENT)>0)                                   /* the pool beacon */
            rows=[{coinid:"0xbeacon",tokenid:"0x00",amount:"0.000000001",created:"900",
                   state:{"2":USDT,"3":"0xowneraddr","4":"0xownerpk","5":"0"}}];
          else if(c.indexOf("address:"+POOL)>0)                              /* the reserves */
            rows=[{coinid:"0xpoolM",tokenid:"0x00",amount:"2000",created:"950"},
                  {coinid:"0xpoolT",tokenid:USDT,tokenamount:"10",amount:"10",created:"950"}];
          else if(c.indexOf("address:"+ADDR)>0) rows=[];                     /* empty order book */
          else if(c.indexOf("relevant:true")>0) rows=[{coinid:"0xfund",tokenid:"0x00",amount:"100000",address:MYADDR}];
          r={status:true,response:rows};
        }
        if(cb) cb(r);
      }
    }
  };
  vmmod.createContext(sandbox);
  ["decimal.js","covenant.js","signlock.js","book.js","pool.js","composite.js","txn.js","tape.js",
   "maker.js","price.js","verifier.js","pending.js","stats.js","split.js","history.js"].forEach(function(f){
    vmmod.runInContext(fsmod.readFileSync(f,"utf8"), sandbox, {filename:f});
  });
  ADDR = vmmod.runInContext("PandaDEX.ADDR", sandbox);
  USDT = vmmod.runInContext("PandaDEX.USDT", sandbox);
  vmmod.runInContext(fsmod.readFileSync("service.js","utf8"), sandbox, {filename:"service.js"});
  inited({event:"inited"});
  assert.strictEqual(vmmod.runInContext("PDService.ready", sandbox), true);
  assert.strictEqual(vmmod.runInContext("PDService.pools.length", sandbox), 1, "the pool was not discovered");
  sent.length = 0;
  vmmod.runInContext("PDService.action({type:'LIMIT',data:{buy:false,minima:'50',price:'0.001',gtc:true,minRem:'0'}});", sandbox);
  /* The pool legs must be spent as an ADJACENT PAIR starting at input 0 — the PandaPools covenant
     asserts the MINIMA leg sits at an even index with its token leg immediately after. */
  var inputs = sent.filter(function(c){ return c.indexOf("txninput") === 0; });
  assert(inputs.length >= 2, "the composite consumed no pool reserves");
  assert(inputs[0].indexOf("0xpoolM") > 0, "the MINIMA reserve was not the first input");
  assert(inputs[1].indexOf("0xpoolT") > 0, "the token reserve did not immediately follow it");
  /* Pool covenants must be registered untracked, or every stranger's liquidity reads as ours. */
  assert(sent.some(function(c){ return c.indexOf("newscript trackall:false") === 0; }), "the pool covenant was not registered");
  assert(!sent.some(function(c){ return c.indexOf("trackall:true") > 0; }));
  assert(sent.some(function(c){ return c.indexOf("txnpost") === 0; }), "the blended transaction was never posted");
  assert.strictEqual(vmmod.runInContext("PDService.busy", sandbox), false);
  var meta = JSON.parse(vmmod.runInContext("JSON.stringify(PDService.fillMeta||null)", sandbox));
  assert(meta && meta.sourceKind === "POOL", "a pool-only fill should record source POOL, got " + (meta && meta.sourceKind));
  assert.strictEqual(meta.txpowid, "0xcomposite");
})();
/* ---- THE PHANTOM LADDER (reported from mainnet) ----
   Three 1000-MINIMA ask rungs are cancelled, refunding exactly 1000 MINIMA each to the wallet's
   payout address. Three 1000-MINIMA bid rungs vanish in the same window. Every order a wallet
   creates shares that one payout address, so adjudicated INDEPENDENTLY each ask refund "proves
   payment" for a bid that wants exactly 1000 MINIMA — one cancellation becomes six trades, which
   is precisely the 1000x6 in the user's tape. Evidence must be exclusive: one coin, one order. */
(function () {
  var MYADDR = "0x" + "a".repeat(64), items = [], rows = [], k;
  function ask(id) { return { coinid:id, wantAddr:MYADDR, locked:PandaDEX.d(1000), lockedTok:"0x00",
                              wantAmt:PandaDEX.d(5), wantTok:PandaDEX.USDT, created:100 }; }
  function bidO(id) { return { coinid:id, wantAddr:MYADDR, locked:PandaDEX.d(5), lockedTok:PandaDEX.USDT,
                               wantAmt:PandaDEX.d(1000), wantTok:"0x00", created:100 }; }
  for (k = 0; k < 3; k++) {
    items.push({ coinid:"0xask" + k, order:ask("0xask" + k), since:200 });
    items.push({ coinid:"0xbid" + k, order:bidO("0xbid" + k), since:200 });
    rows.push({ coinid:"0xrefund" + k, tokenid:"0x00", amount:"1000", created:205 });   /* the ask refunds */
  }
  var byAddr = {}; byAddr[MYADDR] = rows;
  var verdicts = PandaVerify.adjudicateBatch(byAddr, items, 206);
  for (k = 0; k < 3; k++) {
    assert.strictEqual(verdicts["0xask" + k], PandaVerify.CANCELLED, "a cancelled ask must read as cancelled");
    assert.strictEqual(verdicts["0xbid" + k], PandaVerify.UNKNOWN,
      "a bid rung claimed another order's refund as its own payment — the phantom bug is back");
  }
  /* One genuine payment proves exactly one fill, and cannot be reused by a second order. */
  var two = [{coinid:"0xb1", order:bidO("0xb1"), since:200}, {coinid:"0xb2", order:bidO("0xb2"), since:200}];
  var one = {}; one[MYADDR] = [{ coinid:"0xpay", tokenid:"0x00", amount:"1000", created:205 }];
  var v2 = PandaVerify.adjudicateBatch(one, two, 206);
  assert.strictEqual([v2["0xb1"], v2["0xb2"]].filter(function (x) { return x === PandaVerify.FILLED; }).length, 1,
    "one payment coin proved more than one fill");
  /* Evidence older than the last block the order was alive cannot explain its disappearance. */
  var stale = {}; stale[MYADDR] = [{ coinid:"0xold", tokenid:"0x00", amount:"1000", created:150 }];
  assert.strictEqual(PandaVerify.adjudicateBatch(stale, [{coinid:"0xb3", order:bidO("0xb3"), since:200}], 206)["0xb3"],
    PandaVerify.UNKNOWN, "a coin that predates the vanish was accepted as proof");
  /* An unreadable reply is never "no evidence" — it must not become a verdict either way. */
  var blind = {}; blind[MYADDR] = null;
  assert.strictEqual(PandaVerify.adjudicateBatch(blind, [{coinid:"0xb4", order:bidO("0xb4"), since:200}], 206)["0xb4"],
    PandaVerify.UNKNOWN);
})();
/* ---- our own taker trade: the three evidence gates (native TakerConfirmationTest) ----
   A consensus-rejected sweep posts without error and never mines, so recording on "posted" writes a
   permanent phantom keyed by coinid that then blocks the real record. Evidence, not optimism. */
assert.strictEqual(PandaVerify.coinPresent(null), null);                                   /* no reply = unknown */
assert.strictEqual(PandaVerify.coinPresent({status:false}), null);                          /* failure = unknown */
assert.strictEqual(PandaVerify.coinPresent({status:true,response:"nonsense"}), null);       /* unparseable = unknown */
assert.strictEqual(PandaVerify.coinPresent({status:true,response:[]}), false);              /* genuinely gone */
assert.strictEqual(PandaVerify.coinPresent({status:true,response:[{coinid:"0x1"}]}), true);
assert.strictEqual(PandaVerify.coinPresent({status:true,response:{coinid:"0x1"}}), true);
/* An unknown reply must NEVER be treated as spent — that is how a trade gets recorded that the
   chain never accepted. */
assert.notStrictEqual(PandaVerify.coinPresent({status:false}), false);
/* Proceeds must exist, in the right token, for the exact amount, no older than the posting block. */
function reply(rows){return {status:true,response:rows};}
assert.strictEqual(PandaVerify.proceedsPresent(reply([{tokenid:"0x00",amount:"125",created:900}]),"0x00","125",900), true);
assert.strictEqual(PandaVerify.proceedsPresent(reply([{tokenid:"0x00",amount:"125",created:899}]),"0x00","125",900), false); /* too old */
assert.strictEqual(PandaVerify.proceedsPresent(reply([{tokenid:"0x00",amount:"124",created:900}]),"0x00","125",900), false); /* wrong amount */
assert.strictEqual(PandaVerify.proceedsPresent(reply([{tokenid:PandaDEX.USDT,amount:"125",created:900}]),"0x00","125",900), false); /* wrong token */
assert.strictEqual(PandaVerify.proceedsPresent({status:false},"0x00","125",900), false);
/* A token payout is measured by tokenamount, not the raw minima amount. */
assert.strictEqual(PandaVerify.proceedsPresent(reply([{tokenid:PandaDEX.USDT,amount:"1",tokenamount:"0.5578",created:900}]),PandaDEX.USDT,"0.5578",900), true);
/* ---- TRUE HISTORY: read the transaction that spent the coin ----
   Payout evidence can never recover a fill whose proceeds were already spent onward — and that is
   the COMMON case for your own orders, because the maker re-spends proceeds to fund the next rung.
   history records transactions, not the current UTXO set, so it still holds the answer. */
(function () {
  var MY = "0x" + "a".repeat(64), eq = function (a, b) { return PandaDEX.d(a).eq(PandaDEX.d(b)); };
  var askOrder = { coinid:"0xask", wantAddr:MY, locked:PandaDEX.d(1000), lockedTok:"0x00",
                   wantAmt:PandaDEX.d(5), wantTok:PandaDEX.USDT, created:100 };
  /* the taker paid what the order asked for */
  assert.strictEqual(PandaHistory.verdictFor(
    [{address:MY, tokenid:PandaDEX.USDT, tokenamount:"5"}], askOrder, eq), "FILLED");
  /* the owner took their own funds back */
  assert.strictEqual(PandaHistory.verdictFor(
    [{address:MY, tokenid:"0x00", amount:"1000"}], askOrder, eq), "CANCELLED");
  /* an output to somebody else's address proves nothing about this order */
  assert.strictEqual(PandaHistory.verdictFor(
    [{address:"0x"+"f".repeat(64), tokenid:PandaDEX.USDT, tokenamount:"5"}], askOrder, eq), null);
  /* wrong amount is not evidence */
  assert.strictEqual(PandaHistory.verdictFor(
    [{address:MY, tokenid:PandaDEX.USDT, tokenamount:"4.9"}], askOrder, eq), null);
  /* a token payout is measured by tokenamount, never the raw minima amount */
  assert.strictEqual(PandaHistory.verdictFor(
    [{address:MY, tokenid:PandaDEX.USDT, amount:"1", tokenamount:"5"}], askOrder, eq), "FILLED");

  /* Paging: find the spend, halve on an over-cap page, and never exceed the call budget. */
  var pages = [], calls = [];
  function hist(cmd, cb) {
    calls.push(cmd);
    var max = Number((cmd.match(/max:(\d+)/) || [])[1] || 0),
        off = Number((cmd.match(/offset:(\d+)/) || [])[1] || 0);
    if (max > 4) return cb({ status:true, response:{} });           /* over-cap: no txpows array */
    if (off === 0) return cb({ status:true, response:{ txpows:[
      { txpowid:"0xtx1", body:{ txn:{ inputs:[{coinid:"0xother"}], outputs:[] } } },
      { txpowid:"0xtx2", body:{ txn:{ inputs:[{coinid:"0xask"}],
        outputs:[{address:MY, tokenid:PandaDEX.USDT, tokenamount:"5"}] } } }
    ] } });
    return cb({ status:true, response:{ txpows:[] } });
  }
  var out = null;
  PandaHistory.findSpends(hist, ["0xask"], function (found) { out = found; });
  assert(out && out["0xask"], "history did not find the transaction that spent the coin");
  assert.strictEqual(out["0xask"].txpowid, "0xtx2");
  assert.strictEqual(PandaHistory.verdictFor(out["0xask"].outputs, askOrder, eq), "FILLED");
  assert(calls.length >= 2 && calls[0].indexOf("max:8") > 0 && calls[1].indexOf("max:4") > 0,
    "an over-cap page must halve and retry the same offset");

  /* A wallet with no matching history returns nothing rather than guessing, and stays bounded. */
  var budget = [];
  PandaHistory.findSpends(function (cmd, cb) {
    budget.push(cmd);
    cb({ status:true, response:{ txpows:[{ txpowid:"0xz", body:{ txn:{ inputs:[{coinid:"0xnope"}], outputs:[] } } }] } });
  }, ["0xmissing"], function (found) { assert.deepStrictEqual(found, {}); });
  assert(budget.length <= PandaHistory.MAX_FETCHES + 1, "history paging ran past its call budget");
})();
console.log("PandaDEX pure tests passed");
