import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require=createRequire(import.meta.url);
test('patched URI decoder remains callable by query-string and handles malformed input without hanging',()=>{
 const decoder=require('decode-uri-component');
 assert.equal(typeof decoder,'function');
 for(const value of ['中文','hello world','😀','a+b','/%#'])assert.equal(decoder(encodeURIComponent(value)),value);
 const query=require('query-string');assert.deepEqual({...query.parse('q=%E4%B8%AD%E6%96%87&x=a%2Bb')},{q:'中文',x:'a+b'});
 for(const value of ['%','%G0','%E0%A4%A','%FE%FF','%C2'])assert.equal(typeof decoder(value),'string');
 const result=execFileSync(process.execPath,['-e',"const d=require('decode-uri-component');for(const n of [100,1000,10000])d('%FF'.repeat(n));process.stdout.write('ok')"],{cwd:process.cwd(),timeout:5000,encoding:'utf8'});
 assert.equal(result,'ok');
});
test('xcode UUID generation retains its 24-character uppercase contract',()=>{
 const project=require('xcode').project('/unused.xcodeproj/project.pbxproj');project.hash={project:{objects:{}}};
 const ids=new Set(Array.from({length:100},()=>project.generateUuid()));assert.equal(ids.size,100);for(const id of ids)assert.match(id,/^[0-9A-F]{24}$/);
});

test('brace walkers reject deep nesting and cycles without overflowing; normal glob contract stays intact',()=>{
 const b=require('braces');
 assert.deepEqual(b.expand('src/{app,ui}/*.{ts,tsx}'),['src/app/*.ts','src/app/*.tsx','src/ui/*.ts','src/ui/*.tsx']);
 assert.equal(require('micromatch').isMatch('src/app/index.tsx','src/{app,ui}/**/*.{ts,tsx}'),true);
 assert.equal(b.stringify(b.parse('x{a,b}y')),'x{a,b}y');
 const result=execFileSync(process.execPath,['-e',`const b=require('braces');for(const n of [200,1000,20000]){for(const make of [n=>'{'.repeat(n)+'x'+'}'.repeat(n),n=>'('.repeat(n)+'x'+')'.repeat(n)]){try{b(make(n));throw new Error('accepted')}catch(e){if(!(e instanceof SyntaxError))throw e}}}process.stdout.write('ok')`],{timeout:5000,encoding:'utf8'});
 assert.equal(result,'ok');
 const cyclic:{type:string;nodes:unknown[]}={type:'root',nodes:[]};cyclic.nodes.push(cyclic);
 for(const name of ['compile','expand','stringify'])assert.throws(()=>require('braces/lib/'+name)(cyclic),/safe bounds/);
});

test('RSA verifier rejects extra DigestAlgorithm elements while retaining valid SHA signatures',()=>{
 const forge=require('node-forge'),asn1=forge.asn1;
 const keys=forge.pki.rsa.generateKeyPair({bits:1024,e:0x10001});
 for(const algorithm of ['sha1','sha256','sha384','sha512']){
  const md=forge.md[algorithm].create();md.update('local regression fixture','utf8');
  const digest=md.digest().getBytes();
  assert.equal(keys.publicKey.verify(digest,keys.privateKey.sign(md)),true);
  const node=(type:number,value:unknown,constructed=false)=>asn1.create(asn1.Class.UNIVERSAL,type,constructed,value);
  const oid=node(asn1.Type.OID,asn1.oidToDer(forge.pki.oids[algorithm]).getBytes());
  for(const parameters of [[],[node(asn1.Type.NULL,'')]]){
   const encode=(values:unknown[])=>asn1.toDer(node(asn1.Type.SEQUENCE,[node(asn1.Type.SEQUENCE,values,true),node(asn1.Type.OCTETSTRING,digest)],true)).getBytes();
   const sign=(der:string)=>forge.pki.rsa.encrypt(der,keys.privateKey,1);
   assert.equal(keys.publicKey.verify(digest,sign(encode([oid,...parameters]))),true);
   assert.throws(()=>keys.publicKey.verify(digest,sign(encode([oid,...parameters,node(asn1.Type.OCTETSTRING,'unexpected')]))),/DigestInfo/);
  }
 }
});

test('dependency guards reapply reproducibly, are idempotent, and refuse unknown content',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chaoxi-guards-'));
 try {
  fs.mkdirSync(path.join(dir,'scripts'));fs.mkdirSync(path.join(dir,'patches'));
  fs.copyFileSync('scripts/apply-dependency-guards.cjs',path.join(dir,'scripts/apply-dependency-guards.cjs'));
  fs.copyFileSync('patches/dependency-guards.json',path.join(dir,'patches/dependency-guards.json'));
  const patches=require('../patches/dependency-guards.json');const packages:Record<string,{version:string}>={};
  for(const p of patches){
   const location='node_modules/'+p.package;packages[location]={version:p.version};
   if(p.before===null)continue;
   const original=fs.readFileSync(path.join(location,p.file),'utf8').split(p.replacement).join(p.search);
   assert.equal(crypto.createHash('sha256').update(original).digest('hex'),p.before);
   fs.mkdirSync(path.dirname(path.join(dir,location,p.file)),{recursive:true});fs.writeFileSync(path.join(dir,location,p.file),original);
  }
  fs.writeFileSync(path.join(dir,'package-lock.json'),JSON.stringify({packages}));
  const run=()=>execFileSync(process.execPath,['scripts/apply-dependency-guards.cjs'],{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  assert.match(run(),/applied: 6/);assert.match(run(),/applied: 0/);
  fs.appendFileSync(path.join(dir,'node_modules/braces/lib/parse.js'),'\n// unexpected');
  assert.throws(run,/Unexpected dependency content/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
