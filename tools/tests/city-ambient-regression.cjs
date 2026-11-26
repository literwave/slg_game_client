const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require(process.argv[2]);
const root=path.resolve(__dirname,'../..'),cache=new Map();
function load(file) {
 file=path.resolve(root,'assets/scripts',file.endsWith('.ts')?file:file+'.ts');
 if(cache.has(file))return cache.get(file);
 const m={exports:{}};cache.set(file,m.exports);
 const result=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
 assert.equal(result.diagnostics.length,0);
 new Function('require','module','exports',result.outputText)(id=>load(path.resolve(path.dirname(file),id)),m,m.exports);return m.exports;
}
const {CityAmbientActivity,CITY_AMBIENT_LAYOUTS,cityUnderSiege}=load('map/CityAmbientActivity');
const {AMBIENT_BODY_GAP,AMBIENT_ROAD_MARGIN}=load('map/CityAmbientCrowd');
const {cityArtLayout}=load('map/CityFootprint'),{cityArtToFootprint}=load('map/CityArtFit');
const cities=JSON.parse(fs.readFileSync(path.join(root,'assets/resources/world/campaign-map.json'),'utf8')).cities;
assert.equal(Object.keys(CITY_AMBIENT_LAYOUTS).length,cities.length);
const target='9007199254740993',other='9007199254740994';
assert.equal(cityUnderSiege(target,1,2,[{targetId:target,troopState:1}],[]),false,'去攻城的行军不等于已经开战');
assert.equal(cityUnderSiege(target,1,2,[{targetId:other,troopState:4}],[]),false,'64位城池ID不能串城');
assert.equal(cityUnderSiege(target,1,2,[{targetId:target,troopState:4}],[]),true);
assert.equal(cityUnderSiege(undefined,1,2,[],[{targetPos:{x:1,y:2},troopState:4}]),true,'AOI他人攻城也进入警戒');
assert.equal(cityUnderSiege(target,1,2,[],[{targetPos:{x:1,y:3},troopState:4}]),false);
let samples=0;
const report=[];
for(const city of cities) {
 const model=new CityAmbientActivity(CITY_AMBIENT_LAYOUTS[city.x+','+city.y]);
 const layout=cityArtLayout(city.level,1040,650,200,125,city);
 assert.ok(model.soldiers.length>=8&&model.soldiers.length<=16);
 if(city.level===7)assert.equal(model.soldiers.length,12);
 if(city.level===10)assert.equal(model.soldiers.length,16);
 model.sync('0',false);assert.equal(model.mode,'peace','首次快照不能播放败退');
 const check=()=>{for(const s of model.soldiers){const p=cityArtToFootprint(layout.fit,s.u,s.v);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));assert.ok(Math.abs(p.x)+Math.abs(p.y)<.45,city.name+' 小兵不能走出城基');assert.ok(s.alpha>=0&&s.alpha<=1);samples++;}};
 const advance=(seconds)=>{for(let t=0;t<seconds;t+=.05){model.tick(.05);check();}};
 const before=JSON.stringify(model.soldiers);advance(3);
 assert.notEqual(JSON.stringify(model.soldiers),before,'巡逻和操练必须实际变化');
 assert.ok(model.soldiers.some(s=>s.guard),'操练阶段有持盾姿势');
 const peace=model.soldiers.map(s=>[s.u,s.v]);
 model.sync('0',true);assert.equal(model.mode,'alert');
 model.tick(.001);for(let i=0;i<peace.length;i++)assert.ok(Math.hypot(model.soldiers[i].u-peace[i][0],model.soldiers[i].v-peace[i][1])<.001,'警戒从当前位置收拢，不瞬移');
 advance(1);const elapsed=model.elapsed;model.sync('0',true);assert.equal(model.elapsed,elapsed,'重复快照不重入警戒');
 advance(40);assert.ok(model.soldiers.every(s=>s.guard&&!s.walking),'沿路回到分散岗位后转入守备');
 model.sync('0',false);assert.equal(model.mode,'return');advance(4.2);assert.equal(model.mode,'peace','守城结束恢复日常');
 model.sync(target,true);assert.equal(model.mode,'withdraw','城池易主旧守军撤离');
 assert.ok(model.soldiers.every(s=>s.alpha===1),'不能瞬间消失');
 advance(3.7);assert.ok(model.soldiers.every(s=>s.alpha===0),'撤离后淡出');
 model.sync(target,false);advance(1);assert.equal(model.mode,'return');assert.ok(model.soldiers.every(s=>s.alpha<1),'新归属守卫渐入');
 advance(40);assert.equal(model.mode,'peace');assert.ok(model.soldiers.every(s=>s.alpha===1));
 model.tick(NaN);check();
 report.push({name:city.name,key:city.x+','+city.y,layout: model.layout,artLayout:layout});
}
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2));
console.log('PASS 十城8～16人、'+samples+'次占地检查、分散守备/守城恢复/易主撤离、重复包防重入及64位目标匹配');

let roadSamples=0,branches=0;
const separation=(a,b)=>Math.hypot(a.u-b.u,(a.v-b.v)*.625);
for(const city of cities){
 const spec=CITY_AMBIENT_LAYOUTS[city.x+','+city.y],model=new CityAmbientActivity(spec),visited=model.walkers.map(()=>new Set()),turns=new Map();
 model.sync('0',false);
 const twin=new CityAmbientActivity(spec);assert.deepEqual(twin.soldiers,model.soldiers,'每城有可复现且不同于其他城的随机种子');
 let mixed=0,walkFrames=0;
 for(let step=0;step<1800;step++){
  const before=model.soldiers.map(s=>({...s})),edges=model.walkers.map(w=>[w.edge,w.to]);
  if(step===650)model.sync('0',true);
  if(step===900)model.sync('0',false);
  if(step===1200)model.sync(target,false);
  model.tick(.1);
  for(let i=0;i<model.soldiers.length;i++){
   const s=model.soldiers[i];assert.ok(separation(s,before[i])<=.00280001,city.name+' 状态切换和路口不得瞬移');
   if(i<spec.trainees)continue;
   const point=model.point(model.nearest([s.u,s.v]));
   assert.ok(Math.hypot(s.u-point[0],(s.v-point[1])*.625)<=AMBIENT_ROAD_MARGIN+1e-9,city.name+' 侧身避让也必须留在标定路面内');roadSamples++;
   const j=i-spec.trainees,w=model.walkers[j];
   if(step<650){
    visited[j].add(w.edge);
    if(w.duty==='roam'&&edges[j][0]!==w.edge){const key=edges[j][1];if(!turns.has(key))turns.set(key,new Set());turns.get(key).add(w.edge);}
   }
  }
  for(let i=0;i<model.soldiers.length;i++){
   for(let j=i+1;j<model.soldiers.length;j++)assert.ok(separation(model.soldiers[i],model.soldiers[j])>=AMBIENT_BODY_GAP-1e-8,city.name+' 动态士兵不得穿身');
   for(const [u,v] of spec.standing||[])assert.ok(separation(model.soldiers[i],{u,v})>=AMBIENT_BODY_GAP-1e-8,city.name+' 不得穿过原画固定士兵');
  }
  if(model.mode==='peace'){
   const n=model.soldiers.slice(spec.trainees).filter(s=>s.walking).length;
   if(n>0)walkFrames++;if(n>0&&n<spec.patrollers)mixed++;
  }
 }
 assert.ok(visited.every((v,i)=>model.walkers[i].duty==='sentry'||v.size>=3),city.name+' 巡逻兵实际经过多个路段，固定岗哨不参与选路');
 assert.ok([...turns.values()].some(v=>v.size>1),city.name+' 分岔须能走向不同道路');branches++;
 assert.ok(mixed>walkFrames*.2,city.name+' 停留与起步应错开');
 const stable=JSON.stringify(model.soldiers.map(s=>[s.u,s.v]));model.tick(NaN);model.tick(-1);assert.equal(JSON.stringify(model.soldiers.map(s=>[s.u,s.v])),stable);
}
console.log('PASS '+branches+'城多路线分岔、独立起停、'+roadSamples+'次路面约束、攻城打断与撤离无瞬移');
