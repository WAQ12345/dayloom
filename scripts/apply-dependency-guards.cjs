const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const patches=require('../patches/dependency-guards.json');
const lock=require('../package-lock.json');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
let count=0;
for(const patch of patches){
 const locations=Object.entries(lock.packages).filter(([p])=>p.endsWith('node_modules/'+patch.package));
 if(locations.some(([,v])=>v.version!==patch.version))throw new Error('Review guard for changed version: '+patch.package);
 if(!locations.length)throw new Error('Review dependency guard after package update: '+patch.package);
 for(const [location] of locations){
  const target=path.join(root,location,patch.file);
  const current=fs.existsSync(target)?hash(fs.readFileSync(target)):null;
  if(current===patch.after)continue;
  if(current!==patch.before)throw new Error('Unexpected dependency content; refusing to patch '+target);
  const content=patch.before===null?patch.content:fs.readFileSync(target,'utf8').split(patch.search).join(patch.replacement);
  if(hash(content)!==patch.after)throw new Error('Invalid guard manifest');
  fs.writeFileSync(target,content);count++;
 }
}
console.log('Dependency guards verified; files applied: '+count);
