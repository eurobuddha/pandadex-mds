/* Offline runtime check using Minima's own Rhino and H2 jars; no node/network or funded wallet.
 * java -cp <rhino.jar>:<h2.jar> org.mozilla.javascript.tools.shell.Main -version 200 test-rhino.js
 */
var checks=0;
function check(value,message){checks++;if(!value)throw new Error(message);}
Packages.java.lang.Class.forName("org.h2.Driver");
var connection=Packages.java.sql.DriverManager.getConnection("jdbc:h2:mem:pandadex_parity;DB_CLOSE_DELAY=-1","sa","");
var MDS={sql:function(sql,callback){
  var statement=connection.createStatement(),result={status:true,rows:[]},rs=null,meta,i,row;
  try {
    if(statement.execute(String(sql))){rs=statement.getResultSet();meta=rs.getMetaData();while(rs.next()){row={};for(i=1;i<=meta.getColumnCount();i++)row[String(meta.getColumnLabel(i))]=rs.getString(i)===null?null:String(rs.getString(i));result.rows.push(row);}}
  }catch(error){result={status:false,error:String(error),rows:[]};}
  finally {if(rs!==null)rs.close();statement.close();}
  if(callback)callback(result);
}};
function sql(q){var result;MDS.sql(q,function(r){result=r;});check(result.status,"SQL failed: "+q+" "+result.error);return result.rows;}
load("decimal.js");load("covenant.js");load("safety.js");load("funding.js");load("tape.js");
/* An actual pre-evidence schema with user data. Both schema 1 and a repeated upgrade must retain it. */
sql("CREATE TABLE market_tape (spentcoin varchar(160) PRIMARY KEY,timems bigint,block bigint,price varchar(80),size varchar(80),buy int,partial int,mine int)");
sql("CREATE TABLE my_trades (spentcoin varchar(160) PRIMARY KEY,timems bigint,block bigint,price varchar(80),size varchar(80),buy int,maker int,orderid varchar(160))");
sql("INSERT INTO market_tape VALUES ('0xaa',1000,100,'0.00443','10',1,0,1)");
sql("INSERT INTO my_trades VALUES ('0xaa',1000,100,'0.00443','10',1,0,'0xbb')");
sql("CREATE TABLE dex_schema (k varchar(32) PRIMARY KEY,v int)");sql("INSERT INTO dex_schema VALUES ('tape',1)");
var initialized=false;PandaTape.init(function(ok){initialized=ok;});check(initialized,"actual H2 schema upgrade completed");
check(sql("SELECT COUNT(*) AS C FROM market_tape")[0].C==="1","market row retained");
check(sql("SELECT COUNT(*) AS C FROM my_trades")[0].C==="1","personal row retained");
check(sql("SELECT v FROM dex_schema WHERE k='tape'")[0].V==="3","schema marker advanced atomically");
var rows;PandaTape.myTrades(200,function(r){rows=r;});check(rows.length===1&&rows[0].spentcoin==="0xaa","migrated row renders through actual reader");
PandaTape.init(function(ok){initialized=ok;});check(initialized,"repeated upgrade succeeds");check(sql("SELECT COUNT(*) AS C FROM my_trades")[0].C==="1","repeat initialization preserves personal history");
/* Same MERGE syntax used by the proven PandaPools store; it retains a row across replacement. */
sql("CREATE TABLE state_fixture (id int PRIMARY KEY,json clob)");
sql("MERGE INTO state_fixture (id,json) KEY(id) VALUES (1,'first')");sql("MERGE INTO state_fixture (id,json) KEY(id) VALUES (1,'second')");
check(sql("SELECT json FROM state_fixture WHERE id=1")[0].JSON==="second","H2 atomic replacement works");
check(PandaSafety.decimal("1e999999999")===null,"Rhino bounded decimal parsing");
check(PandaFunding.count({status:true,response:[{tokenid:"0x00",coins:"8"}]},"0x00")===8,"Rhino funding parser");
load("input-claims.js");
var coin="0x"+Array(65).join("a"),ok=null;
PoolInputClaims.load([coin],function(v){ok=v;});check(ok===true,"fresh reserve is available in H2");
PoolInputClaims.post([coin],"swap_fixture",function(v){ok=v;});check(ok===true,"submitted claim commits in H2");
load("input-claims.js"); // new JS context state, same persistent SQL
PoolInputClaims.load([coin],function(v){ok=v;});check(ok===false,"submitted reserve stays held after restart");
PoolInputClaims.release([coin],"other_handle",function(){});PoolInputClaims.load([coin],function(v){ok=v;});check(ok===false,"another handle cannot free the claim");
PoolInputClaims.release([coin],"swap_fixture",function(v){ok=v;});check(ok===true,"a rejected post's claim is deleted in H2");
load("input-claims.js");PoolInputClaims.load([coin],function(v){ok=v;});check(ok===true,"released reserve is free after restart");
// review 7 Nov (C-1): a claim whose post never happened is swept after SWEEP_MS; one in the mempool stays held
var coin2="0x"+Array(65).join("b"),coin3="0x"+Array(65).join("c"),freed=-1;
PoolInputClaims.post([coin2,coin3],"lost_post",function(v){ok=v;});check(ok===true,"two uncertain claims held");
var node=function(c,cb){cb(c.indexOf(coin2)>0?{status:true,response:[{coinid:coin2,spent:false}]}:{status:true,response:[]});};
PoolInputClaims.sweepUnposted(node,1000,function(n){freed=n;});check(freed===0,"first sweep only notes the claims");
PoolInputClaims.sweepUnposted(node,1000+5*60000,function(n){freed=n;});check(freed===0,"nothing released before 10 minutes");
PoolInputClaims.sweepUnposted(node,1000+11*60000,function(n){freed=n;});check(freed===1,"the provably unposted claim is released");
PoolInputClaims.load([coin2],function(v){ok=v;});check(ok===true,"never-posted input usable again");
PoolInputClaims.load([coin3],function(v){ok=v;});check(ok===false,"in-mempool input stays held");
connection.close();print("PASS "+checks+" Rhino/H2 assertions");
