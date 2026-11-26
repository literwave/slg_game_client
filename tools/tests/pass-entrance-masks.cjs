const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require(process.argv[2]);
const root=path.resolve(__dirname,'../..'),cache=new Map();
const campaign=JSON.parse(fs.readFileSync(path.join(root,'assets/resources/world/campaign-map.json'),'utf8'));
const terrain=JSON.parse(fs.readFileSync(path.join(root,'assets/resources/world/original-landscape.json'),'utf8'));
const world={config:null},before=JSON.stringify(campaign);
function load(name){if(name==='WorldCampaign')return {default:world};if(cache.has(name))return cache.get(name);const m={exports:{}};cache.set(name,m.exports);const file=path.join(root,'assets/scripts/map',name+'.ts');const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});assert.equal(js.diagnostics.length,0);new Function('require','module','exports',js.outputText)(id=>load(id.replace('./','')),m,m.exports);return m.exports;}
const ground=load('CityGround');
assert.equal(ground.passMountainClearMasks(new Set()).size,0);
world.config=campaign;
const blocked=new Set([...terrain.riverCells,...terrain.mountainCells]);
const flags=ground.passMountainClearMasks(blocked),counts=new Map();
for(const gate of campaign.gates)for(const p of gate.attackEntrances||[]){
 const id=p.y*campaign.width+p.x;
 if(gate.crossing!=='pass'){assert.equal(flags.has(id),false,'桥头不能清成山口通道');continue;}
 assert.ok(!blocked.has(id),'现有山口入口必须可走');
 const along=gate.axis==='x'?p.x-gate.x:p.y-gate.y;
 const across=gate.axis==='x'?p.y-gate.y:p.x-gate.x;
 assert.equal(across,0);assert.equal(Math.abs(along),(gate.footprintRadius ?? 2) + 1);
 for(const across of [-1,0,1]){
  const cx=p.x+(gate.axis==='x'?0:across),cy=p.y+(gate.axis==='x'?across:0),cid=cy*campaign.width+cx;
  assert.ok(!blocked.has(cid),gate.name+' 门前 3 格宽平地必须可走');
  assert.equal(flags.get(cid),(gate.axis==='x'?64:128)+(along<0?32:0),gate.name+' 入口朝向');
  counts.set(flags.get(cid),(counts.get(flags.get(cid))||0)+1);
 }
}
assert.equal(flags.size,72);assert.equal(counts.size,4);
assert.deepEqual([...ground.passMountainClearCells(blocked)].sort(),[...flags.keys()].sort(),'点击范围不变');
const first=flags.keys().next().value;blocked.add(first);
assert.equal(ground.passMountainClearMasks(blocked).has(first),false,'不能改动已有阻挡');
assert.equal(JSON.stringify(campaign),before,'不写地图、入口或服务端配置');
console.log('PASS 12 座山口、24 个入口、四个朝向、桥头排除及真实地形/点击范围保持');
