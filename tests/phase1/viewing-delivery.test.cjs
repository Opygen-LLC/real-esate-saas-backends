const test = require('node:test'); const assert = require('node:assert/strict');
const { load, query, errorDependency } = require('./load-ts.cjs');
const isolated = load('src/app/db/isolatedTestDatabase.ts');
for (const uri of [undefined, 'mongodb+srv://cloud/phase1_test', 'mongodb://example.com/phase1_test?directConnection=true',
  'mongodb://127.0.0.1/production?directConnection=true', 'mongodb://localhost/phase1_test', 'mongodb://localhost/phase1_test?directConnection=false',
  'mongodb://localhost:27018/phase1_test/extra?directConnection=true']) {
  test(`isolated database rejects ${String(uri)}`, () => assert.throws(() => isolated.assertIsolatedTestDatabase(uri)));
}
test('isolated database allows only explicitly selected local phase1 fixtures', () => {
  const uri = 'mongodb://127.0.0.1:27018/phase1_atomic?replicaSet=rs0&directConnection=true';
  assert.equal(isolated.assertIsolatedTestDatabase(uri), uri);
});
function limiterHarness() {
  const counts = new Map(); const writes = []; const connection = {readyState:1}; let fail = false;
  const Counter = { findOneAndUpdate(filter, update) {
    writes.push({filter,update});
    return {lean: async () => {if(fail) throw new Error('offline'); const count=(counts.get(filter._id)||0)+1;counts.set(filter._id,count);return {count};}};
  }};
  class Schema {index() {}}
  const mongoose = {connection,Schema,model:()=>Counter,models:{PublicViewingRateCounter:Counter}};
  const code = load('src/app/middlewares/publicViewingRateLimiter.ts', {'mongoose':mongoose,'../../errors/ApiError':errorDependency});
  return {...code,connection,writes,setFail(value){fail=value;}};
}
for(const [ip, expected] of [['192.0.2.10','192.0.2.10'],['::ffff:192.0.2.10','192.0.2.10'],['::ffff:c000:20a','192.0.2.10'],
 ['2001:db8:abcd:1234:1111:2222:3333:4444','2001:db8:abcd:1234::/64'],['2001:db8::1','2001:db8:0:0::/64'],['2001:0db8:0:0:ffff::1','2001:db8:0:0::/64'],['bad input','unknown']]) {
 test(`rate limit normalizes ${ip}`,()=>assert.equal(limiterHarness().clientNetwork(ip),expected));
}
async function requestLimit(harness, ip='192.0.2.10', tenant=false) {
  const headers={};let error;let nextCalls=0;
  await harness[tenant?'publicViewingTenantRateLimiter':'publicViewingRateLimiter']({ip,socket:{},body:{organizationId:'org_fixture'}},
    {setHeader:(key,value)=>headers[key]=value},value=>{nextCalls++;error=value;});
  assert.equal(nextCalls,1); return {headers,error};
}
test('Mongo-backed network limit accepts twenty and rejects request twenty-one', async()=>{
 const h=limiterHarness();for(let i=0;i<20;i++)assert.equal((await requestLimit(h)).error,undefined);
 const denied=await requestLimit(h);assert.equal(denied.error.statusCode,429);assert.ok(Number(denied.headers['Retry-After'])>0);
 assert.equal(denied.headers['RateLimit-Remaining'],'0'); assert.match(h.writes[0].filter._id,/^[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify(h.writes).includes('192.0.2.10'));
});
test('Mongo-backed limiter refuses requests when its database is unavailable',async()=>{
 const h=limiterHarness();h.connection.readyState=0;assert.equal((await requestLimit(h)).error.statusCode,503);assert.equal(h.writes.length,0);
});
test('Mongo-backed limiter converts counter failures to retryable unavailability',async()=>{
 const h=limiterHarness();h.setFail(true);assert.equal((await requestLimit(h)).error.code,'RATE_LIMIT_UNAVAILABLE');
});
test('tenant limit uses a separate three-hundred request bucket',async()=>{
 const h=limiterHarness();for(let i=0;i<300;i++) assert.equal((await requestLimit(h,'192.0.2.10',true)).error,undefined);
 assert.equal((await requestLimit(h,'192.0.2.11',true)).error.statusCode,429);assert.equal((await requestLimit(h)).error,undefined);
});
function transactionHarness(access={workspaceAllowed:true,publicWritesAllowed:true}, organization={organizationId:'org_fixture'}){
 const operations=[];const session={marker:'session'};
 const code=load('src/app/module/viewing/viewingTransaction.ts',{'../../../errors/ApiError':errorDependency,
 '../../db/requiredTransaction':{requiredTransaction:async work=>{operations.push('transaction');return work(session);}},
 '../organization/organization.model':{Organization:{findOneAndUpdate:async(filter,update,options)=>{operations.push('lock');assert.equal(options.session,session);assert.equal(update.$inc.viewingMutationVersion,1);return organization;}}},
 '../tenantAccess/tenantAccess.policy':{evaluateTenantAccessOrganization:()=>access}});
 return {...code,operations,session};
}
test('viewing transaction locks shared tenant record before availability work',async()=>{
 const h=transactionHarness();assert.equal(await h.viewingTransaction('org_fixture',async(session)=>{assert.equal(session,h.session);h.operations.push('availability');return 'ok';}), 'ok');
 assert.deepEqual(h.operations,['transaction','lock','availability']);
});
test('viewing transaction rejects inactive workspace before business writes',async()=>{
 const h=transactionHarness({workspaceAllowed:false,publicWritesAllowed:false});let writes=0;
 await assert.rejects(h.viewingTransaction('org_fixture',async()=>{writes++;}),{code:'TENANT_ACCESS_INACTIVE'});assert.equal(writes,0);
});
test('viewing transaction requires public-write access for a public capture',async()=>{
 const h=transactionHarness({workspaceAllowed:true,publicWritesAllowed:false});
 await assert.rejects(h.viewingTransaction('org_fixture',async()=>1,true),{statusCode:403});
});
function reminderHarness(){
 let state={job:{_id:'job_1',organizationId:'org_fixture',entityId:'view_1',status:'processing',lockedBy:'lease',effectsCommittedAt:null,payload:{scheduleVersion:1}},
 viewing:{_id:'view_1',status:'Scheduled',scheduleVersion:1,date:'2099-01-01',startTime:'10:00',agentId:'agent',clientName:'Fixture'},notifications:[],events:[]};
 let fail=false;const session={};
 const deps={'../operationsQueue/operationsJob.model':{OperationsJob:{findOneAndUpdate:async(filter,update,options)=>{
   assert.equal(options.session,session);if(state.job.status!==filter.status||state.job.lockedBy!==filter.lockedBy||state.job.effectsCommittedAt!==null)return null;
   Object.assign(state.job,update.$set);return state.job;}}},
 '../notification/notification.service':{NotificationService:{createFromJob:async(payload,s)=>{assert.equal(s,session);if(fail)throw new Error('notification unavailable');state.notifications.push(payload);return {_id:'notification_1'};}}},
 '../domainEvent/transactionalOutbox.service':{TransactionalOutbox:{emit:async(event,s)=>{assert.equal(s,session);state.events.push(event);},queuePublish:async(event,s)=>{assert.equal(s,session);state.events.push(event);}}},
 './viewing.model':{Viewing:{findOne:()=>query(()=>state.viewing)}},
 './viewingTransaction':{viewingTransaction:async(org,work)=>{const backup=structuredClone(state);try{return await work(session);}catch(error){state=backup;throw error;}}},
 './viewingWindow':load('src/app/module/viewing/viewingWindow.ts',{'../../../errors/ApiError':errorDependency})};
 const code=load('src/app/module/viewing/viewingReminder.service.ts',deps);
 return {...code,get state(){return state;},setFail(value){fail=value;}};
}
test('reminder durable effect marker prevents duplicate notifications after retry',async()=>{
 const h=reminderHarness();const job=structuredClone(h.state.job);
 assert.deepEqual(await h.deliverViewingReminder(job),{delivered:true});assert.deepEqual(await h.deliverViewingReminder(job),{delivered:false});
 assert.equal(h.state.notifications.length,1);assert.equal(h.state.events.length,2);
});
test('failed reminder effects roll back their delivery marker and can be retried',async()=>{
 const h=reminderHarness();const job=structuredClone(h.state.job);h.setFail(true);
 await assert.rejects(h.deliverViewingReminder(job),/notification unavailable/);assert.equal(h.state.job.effectsCommittedAt,null);assert.equal(h.state.events.length,0);
 h.setFail(false);assert.deepEqual(await h.deliverViewingReminder(job),{delivered:true});
});
for(const change of ['version','cancelled','past','lease'])test(`reminder ignores ${change} job`,async()=>{
 const h=reminderHarness();const job=structuredClone(h.state.job);
 if(change==='version')h.state.viewing.scheduleVersion=2;if(change==='cancelled')h.state.viewing.status='Cancelled';
 if(change==='past')h.state.viewing.date='2020-01-01';if(change==='lease')h.state.job.lockedBy='new-lease';
 assert.deepEqual(await h.deliverViewingReminder(job),{delivered:false});assert.equal(h.state.notifications.length,0);
});
