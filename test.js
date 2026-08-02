/* Pure regression tests; run with `node test.js`. */
var assert=require("assert"), fs=require("fs"), vm=require("vm");
global.Decimal=require("./decimal.js");
["covenant.js","signlock.js","book.js","pool.js","composite.js","txn.js","tape.js","maker.js","price.js","verifier.js","pending.js","stats.js"].forEach(function(f){vm.runInThisContext(fs.readFileSync(f,"utf8"),{filename:f});});
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
function comboCmd(command, cb){builtCalls.push(command);if(command.indexOf("coins relevant:true")===0)return cb({status:true,response:[{coinid:"0xfund",tokenid:PandaDEX.USDT,tokenamount:"1",amount:"1",address:"0xfunder"}]});if(command.indexOf("newscript")===0)return cb({status:true});if(command.indexOf("txncheck")===0)return cb({status:true,response:{valid:{scripts:true,basic:true,mmrproofs:true,validamounts:true},allsignaturesvalid:true}});if(command.indexOf("txnpost")===0)return cb({pending:true,response:{txpowid:"0xcombo"}});cb({status:true});}
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
function fakeCmd(command, cb){calls.push(command);if(command.indexOf("txncheck")===0)return cb({status:true,response:{valid:{scripts:true,basic:true,mmrproofs:true,validamounts:true},allsignaturesvalid:true}});if(command.indexOf("txnpost")===0)return cb({pending:true,response:{txpowid:"0xposted"}});cb({status:true});}
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
/* A chain that throws must free the gate, not strand it until the watchdog fires. */
PandaSignLock.gate("boom",function(){throw new Error("chain blew up");});
var gateAfter=false;PandaSignLock.gate("after",function(release){gateAfter=true;release.free();});
assert(gateAfter);
/* With the durable layer injected, the claim is an INSERT whose primary-key violation IS the
   "someone else holds it" signal, and the release is the matching DELETE. */
var sqlLog=[];PandaSignLock.use(function(query,cb){sqlLog.push(query);cb({status:true});});
PandaSignLock.gate("dex",function(release){release.free();});
assert(sqlLog.some(function(q){return q.indexOf("INSERT INTO `sign_lock`")===0;}));
assert(sqlLog.some(function(q){return q.indexOf("DELETE FROM `sign_lock` WHERE `id`=1")===0;}));
PandaSignLock.use(null);
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
/* A transaction over the node's size limit is refused before txncheck, and the stored txn is
   always deleted — never left behind in txnlist. An unreadable txnexport is NOT a failure. */
calls=[];outcome=null;
function bigCmd(command,cb){calls.push(command);if(command.indexOf("txnexport")===0)return cb({status:true,response:{data:"0x"+"ab".repeat(70*1024)}});if(command.indexOf("txncheck")===0)return cb({status:true,response:{valid:{scripts:true,basic:true,mmrproofs:true,validamounts:true},allsignaturesvalid:true}});if(command.indexOf("txnpost")===0)return cb({pending:true,response:{txpowid:"0xposted"}});cb({status:true});}
PandaTxn.cancel(bigCmd,sell,function(err,tx){outcome={err:err,tx:tx};});
assert(outcome.err&&outcome.err.indexOf("too large")>0);
assert(!calls.some(function(c){return c.indexOf("txncheck")===0;}));   /* refused before validation */
assert(calls.some(function(c){return c.indexOf("txndelete")===0;}));   /* and cleaned up */
assert.strictEqual(PandaSignLock.busy(),false);                        /* and the gate was released */
console.log("PandaDEX pure tests passed");
