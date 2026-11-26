// Verify distinct duties over time and across siege interruption, without input or network commands.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require(process.argv[2]);
const root=path.resolve(__dirname,'../..'),cache=new Map();
function load(file){file=path.resolve(root,'assets/scripts',file.endsWith('.ts')?file:file+'.ts');if(cache.has(file))return cache.get(file);const m={exports:{}};cache.set(file,m.exports);const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});assert.equal(compiled.diagnostics.length,0);new Function('require','module','exports',compiled.outputText)(id=>load(path.resolve(path.dirname(file),id)),m,m.exports);return m.exports;}
const {CityAmbientActivity,CITY_AMBIENT_LAYOUTS}=load('map/CityAmbientActivity');
const distance=(s,p)=>Math.hypot(s.u-p[0],(s.v-p[1])*.625);
let frames=0,homeSamples=0,reverseCount=0,branches=0;
for(const [key,spec] of Object.entries(CITY_AMBIENT_LAYOUTS))for(const salt of [0,0x12345678]){
 const model=new CityAmbientActivity({...spec,seed:spec.seed^salt});model.sync('owner',false);
 const duties=model.soldiers.map(s=>s.duty),homes=model.walkers.map(w=>w.home.slice()),routes=model.walkers.map(w=>w.route?.edges.slice());
 for(const duty of ['sentry','patrol','roam'])assert.ok(duties.includes(duty),key+' 每城都必须有 '+duty);
 assert.equal(duties.filter(d=>d==='drill').length,spec.trainees);
 const rests=model.walkers.map(()=>0),turns=model.walkers.map(()=>new Map()),directions=model.walkers.map(()=>new Set());
 const advance=(seconds,peace=false)=>{for(let n=0;n<seconds*10;n++){
  const before=model.walkers.map(w=>({edge:w.edge,to:w.to,cursor:w.routeCursor,step:w.routeStep}));
  const positions=model.soldiers.map(s=>[s.u,s.v]);model.tick(.1);frames++;
  assert.deepEqual(model.soldiers.map(s=>s.duty),duties,key+' 攻城和易主不能改掉既定职责');
  for(let i=0;i<model.soldiers.length;i++)assert.ok(distance(model.soldiers[i],positions[i])<=.00280001,key+' 不得用瞬移恢复岗位');
  for(let i=0;i<model.walkers.length;i++){
   const w=model.walkers[i],s=model.soldiers[spec.trainees+i];assert.deepEqual(w.home,homes[i]);
   if(w.duty==='patrol'){
    assert.deepEqual(w.route.edges,routes[i],key+' 固定巡逻路线不可重新随机生成');
    assert.ok(w.route.edges.includes(w.edge));
    const leg=Math.min(w.routeCursor,w.routeCursor-w.routeStep);
    assert.equal(w.edge,w.route.edges[leg]);assert.equal(w.to,w.route.nodes[w.routeCursor]);
    assert.equal(w.from,w.route.nodes[w.routeCursor-w.routeStep]);
    if(peace){directions[i].add(w.routeStep);if(before[i].step!==w.routeStep){assert.ok(before[i].cursor===0||before[i].cursor===w.route.nodes.length-1,key+' 固定巡逻只在路线端点折返');reverseCount++;}}
   }
   if(!peace)continue;
   if(w.duty==='sentry'){
    assert.equal(s.guard,false,'正常岗哨站立，不能混用操练的半跪姿势');
    assert.ok(distance(s,w.home)<.045,key+' 岗哨只允许局部让路，不可游走');
    if(distance(s,w.home)<.001&&!s.walking){rests[i]++;homeSamples++;}
   }else if(w.duty==='roam'&&before[i].edge!==w.edge){
    if(!turns[i].has(before[i].to))turns[i].set(before[i].to,new Set());turns[i].get(before[i].to).add(w.edge);
   }
  }
 }};
 advance(110,true);
 for(let i=0;i<model.walkers.length;i++){
  const w=model.walkers[i];
  if(w.duty==='sentry')assert.ok(rests[i]>550,key+' 固定岗哨应大部分时间原地站岗: '+rests[i]);
  if(w.duty==='patrol')assert.equal(directions[i].size,2,key+' 固定路线应实际往返，而不是单向走一次');
 }
 assert.ok(turns.some(points=>[...points.values()].some(options=>options.size>1)),key+' 随机巡逻应能走不同分支');branches++;
 model.sync('owner',true);advance(3);assert.ok(model.soldiers.every(s=>s.guard&&!s.walking));advance(2);
 model.sync('owner',false);advance(20);assert.equal(model.mode,'peace');
 model.sync('new-owner',true);advance(5);model.sync('new-owner',false);advance(35);assert.equal(model.mode,'peace');
 for(let i=0;i<model.walkers.length;i++)if(model.walkers[i].duty==='sentry')assert.ok(distance(model.soldiers[spec.trainees+i],homes[i])<.045,'易主后仍回原岗');
}
console.log(`PASS 十城两组种子三类职责，${frames} 帧岗位/路线持久性、${homeSamples} 次原岗站立、${reverseCount} 次端点折返、${branches} 组随机分岔及攻城/易主恢复`);
