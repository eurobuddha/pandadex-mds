const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),os=require('node:os'),path=require('node:path');
const root=__dirname,desktop=path.resolve(root,'../../desktop/minimacore-desktop');
const {makeSqlShim}=require(path.join(desktop,'main/pandapools/sqlshim'));
const id=n=>'0x'+String(n).repeat(64);
async function harness(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dex-claims-')),db=await makeSqlShim(path.join(dir,'db.sqlite'));
 const trace=[];let pending=false;
 const c={MDS:{sql:(q,cb)=>db.sql(q,cb),persistRecovery:cb=>cb(db.flushChecked())}};vm.createContext(c);
 for(const f of ['decimal.js','safety.js','covenant.js','funding.js','input-claims.js','signlock.js','book.js','pool.js','composite.js','txn.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),c,{filename:f});
 c.PandaTxn.holdsKey=()=>true;
 const cmd=(q,cb)=>{trace.push(q);if(q.startsWith('coins checkmempool:true coinid:'))return cb({status:true,response:[{coinid:q.split('coinid:')[1],spent:false}]});
  if(q.startsWith('txncheck'))return cb({status:true,response:{valid:{scripts:true,basic:true,mmrproofs:true},validamounts:true,allsignaturesvalid:true,validtransaction:true}});
  if(q.startsWith('txnpost'))return cb({status:!pending,pending,response:{txpowid:id(8)}});
  if(cb)cb({status:true});
 };
 const post=(handle,coin=id(1))=>new Promise(resolve=>c.PandaTxn.checkPost(cmd,handle,['txncreate id:'+handle,'txninput id:'+handle+' coinid:'+coin,'txnoutput id:'+handle+' amount:1 address:'+id(2)+' storestate:false'],(err,tx)=>resolve({err,tx})));
 return {c,post,trace,setPending:()=>{pending=true;},close:()=>{db._db.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('real transaction engine does not sign or post a second spend of submitted reserves',async()=>{
 const h=await harness();try{
  const first=await h.post('first');assert.equal(first.err,null);assert.equal(first.tx,id(8));
  const second=await h.post('second');assert.match(second.err,/already submitted/);
  assert.equal(h.trace.filter(q=>q.startsWith('txnsign ')).length,1);assert.equal(h.trace.filter(q=>q.startsWith('txnpost ')).length,1);
  const fresh=await h.post('fresh',id(3));assert.equal(fresh.err,null);
 }finally{h.close();}
});
test('node approval queue is not reported as a successful post and cannot be retried automatically',async()=>{
 const h=await harness();try{h.setPending();const first=await h.post('pending');assert(first.err);assert.equal(first.tx,undefined);const retry=await h.post('retry');assert(retry.err);assert.equal(h.trace.filter(q=>q.startsWith('txnpost ')).length,1);}finally{h.close();}
});
