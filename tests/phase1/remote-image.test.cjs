const test = require('node:test');const assert = require('node:assert/strict');const {EventEmitter} = require('node:events');
const {load,errorDependency}=require('./load-ts.cjs');
const sample=Buffer.from([0xff,0xd8,0xff,1,2,3]);
function harness({addresses=[{address:'93.184.215.14',family:4}],responses=[{status:200,type:'image/jpeg',body:sample}]}={}){
 const calls=[];let dnsCalls=0;
 const https={request(url,options,callback){
  const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{
   calls.push({url:String(url),options});const fixture=responses.shift()||{};
   options.lookup(url.hostname,{all:false},(error,address,family)=>{assert.equal(error,null);assert.equal(address,addresses[0].address);assert.equal(family,addresses[0].family);});
   options.lookup(url.hostname,{all:true},(error,resolved)=>{assert.equal(error,null);assert.deepEqual(resolved,[addresses[0]]);});
   const res=new EventEmitter();res.destroy=()=>{};res.statusCode=fixture.status;res.headers={'content-type':fixture.type,...fixture.headers};
   callback(res);if(fixture.body)res.emit('data',fixture.body);res.emit('end');
  });return req;
 }};
 const mod=load('src/app/helpers/remoteImage.ts',{'node:https':https,'node:dns/promises':{lookup:async()=>{dnsCalls++;return addresses;}},'../../errors/ApiError':errorDependency});
 return {...mod,calls,get dnsCalls(){return dnsCalls;}};
}
for(const address of ['127.0.0.1','10.1.1.1','169.254.169.254','172.31.2.2','192.168.1.1','100.100.100.200','0.0.0.0','224.1.1.1','203.0.113.1',
 '::1','::','fc00::1','fe80::1','::ffff:127.0.0.1','::ffff:7f00:1','64:ff9b::7f00:1','2002:7f00:1::','2001:db8::1','bad']){
 test(`remote images reject non-public ${address}`,()=>assert.equal(harness().isPublicImageAddress(address),false));
}
for(const address of ['8.8.8.8','93.184.215.14','2606:4700:4700::1111'])test(`remote images accept public ${address}`,()=>assert.equal(harness().isPublicImageAddress(address),true));
for(const url of ['http://images.example/photo.jpg','https://user:pass@images.example/photo.jpg','https://images.example:8443/photo.jpg','https://localhost/photo.jpg','https://169.254.169.254/photo.jpg','https://[::ffff:7f00:1]/photo.jpg']){
 test(`remote image URL rejects ${url}`,async()=>{const h=harness();await assert.rejects(h.readRemoteImage(url),{statusCode:400});assert.equal(h.calls.length,0);});
}
test('remote image connection uses the validated address without a second DNS lookup',async()=>{
 const h=harness();const image=await h.readRemoteImage('https://images.example/photo.jpg');assert.equal(h.dnsCalls,1);assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].options.agent,false);assert.equal(h.calls[0].options.rejectUnauthorized,true);assert.deepEqual(image.buffer,sample);
});
test('mixed public/private DNS answers reject the entire import',async()=>{
 const h=harness({addresses:[{address:'93.184.215.14',family:4},{address:'127.0.0.1',family:4}]});
 await assert.rejects(h.readRemoteImage('https://images.example/photo.jpg'),{statusCode:400});assert.equal(h.calls.length,0);
});
test('redirect to metadata is rejected before connecting to it',async()=>{
 const h=harness({responses:[{status:302,headers:{location:'https://169.254.169.254/latest/meta-data'}}]});
 await assert.rejects(h.readRemoteImage('https://images.example/photo.jpg'),{statusCode:400});assert.equal(h.calls.length,1);
});
test('each allowed redirect is resolved and pinned separately',async()=>{
 const h=harness({responses:[{status:302,headers:{location:'https://cdn.example/image.jpg'}},{status:200,type:'image/jpeg',body:sample}]});
 assert.equal((await h.readRemoteImage('https://images.example/photo.jpg')).size,sample.length);assert.equal(h.dnsCalls,2);assert.equal(h.calls.length,2);
});
test('mislabeled image data is rejected',async()=>{
 const h=harness({responses:[{status:200,type:'image/jpeg',body:Buffer.from('<html>not an image</html>')}]});
 await assert.rejects(h.readRemoteImage('https://images.example/photo.jpg'),{statusCode:400});
});
test('oversized declared image is rejected without retaining the body',async()=>{
 const h=harness({responses:[{status:200,type:'image/jpeg',headers:{'content-length':'30000000'},body:sample}]});
 await assert.rejects(h.readRemoteImage('https://images.example/photo.jpg'),{statusCode:413});
});
test('oversized streaming image is rejected when content-length is absent',async()=>{
 const h=harness({responses:[{status:200,type:'image/jpeg',body:Buffer.alloc(20*1024*1024+1)}]});
 await assert.rejects(h.readRemoteImage('https://images.example/photo.jpg'),{statusCode:413});
});
