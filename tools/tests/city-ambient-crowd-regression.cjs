// Exercise crossing crowds and all city layouts without the renderer or network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require(process.argv[2]);
const root=path.resolve(__dirname,'../..'),cache=new Map();
function load(file){
 file=path.resolve(root,'assets/scripts',file.endsWith('.ts')?file:file+'.ts');
 if(cache.has(file))return cache.get(file);
 const m={exports:{}};cache.set(file,m.exports);
 const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
 assert.equal(compiled.diagnostics.length,0);
 new Function('require','module','exports',compiled.outputText)(id=>load(path.resolve(path.dirname(file),id)),m,m.exports);return m.exports;
}
const {CityAmbientCrowd,AMBIENT_BODY_GAP:GAP,AMBIENT_ROAD_MARGIN}=load('map/CityAmbientCrowd');
const {CityAmbientActivity,CITY_AMBIENT_LAYOUTS}=load('map/CityAmbientActivity');
const distance=(a,b)=>Math.hypot(a.u-b.u,(a.v-b.v)*.625);
const body=([u,v])=>({u,v,du:0,dv:0,walking:false});
let pairChecks=0,staticChecks=0,yieldFrames=0;
function check(bodies,standing,tag){
 for(let i=0;i<bodies.length;i++){
  for(let j=i+1;j<bodies.length;j++){assert.ok(distance(bodies[i],bodies[j])>=GAP-1e-8,tag+' 两人必须保持身体间距');pairChecks++;}
  for(const p of standing){assert.ok(distance(bodies[i],body(p))>=GAP-1e-8,tag+' 固定士兵同样不可穿透');staticChecks++;}
 }
}
const road=(_i,u,v)=>Math.abs((v-.5)*.625)<=AMBIENT_ROAD_MARGIN&&u>=.3&&u<=.7;
const junction=(_i,u,v)=>(Math.abs((v-.5)*.625)<=AMBIENT_ROAD_MARGIN||Math.abs(u-.5)<=AMBIENT_ROAD_MARGIN)&&u>=.3&&u<=.7&&v>=.3&&v<=.7;
function scenario(tag,starts,targets,floor,standing=[],speeds=[]){
 const bodies=starts.map(body),crowd=new CityAmbientCrowd(bodies,standing,floor);
 let slowed=0;
 for(let frame=0;frame<900;frame++){
  const dt=frame%19===0?.25:1/30;
  for(let i=0;i<bodies.length;i++){
   const s=bodies[i],before={...s},speed=speeds[i]??.02;s.walking=false;
   if(crowd.yield(i,speed*dt,dt))yieldFrames++;
   else if(targets[i])crowd.move(i,targets[i],speed*dt,dt);
   const moved=distance(s,before);assert.ok(moved<=speed*dt+1e-9,tag+' 让路不能推开或瞬移');
   assert.ok(floor(i,s.u,s.v),tag+' 避让不可离开路面');
   if(targets[i]&&distance(s,body(targets[i]))>.01&&moved<speed*dt*.8)slowed++;
   check(bodies,standing,tag);
  }
 }
 for(let i=0;i<bodies.length;i++)if(targets[i])assert.ok(distance(bodies[i],body(targets[i]))<.002,tag+' 人物不能互相卡死: '+i);
 return slowed;
}
scenario('迎面同一中心线',[[.43,.5],[.57,.5]],[[.57,.5],[.43,.5]],road);
scenario('四向交叉',[[.44,.5],[.56,.5],[.5,.404],[.5,.596]],[[.56,.5],[.44,.5],[.5,.596],[.5,.404]],junction);
assert.ok(scenario('快兵追上慢兵',[[.48,.5],[.44,.5]],[[.57,.5],[.55,.5]],road,[],[.012,.024])>0,'跟随者应有减速');
scenario('原画小兵绕行',[[.44,.5]],[[.56,.5]],road,[[.5,.5]]);
scenario('停岗者让路',[[.48,.5],[.5,.5]],[[.56,.5],null],road);
// Large elapsed frames cannot leap through a body even when the goal is behind it.
{
 const bodies=[[.4,.5],[.5,.5]].map(body),crowd=new CityAmbientCrowd(bodies,[],(_i,_u,v)=>Math.abs(v-.5)<1e-6);
 for(let i=0;i<10;i++){crowd.move(0,[.6,.5],.2,.25);check(bodies,[],'单行窄道等候');}
 assert.ok(bodies[0].u<.5-GAP+1e-7,'完全无处避让时应等候，不能从对方身体中穿过去');
}
let worstTick=0,totalMs=0,ticks=0,distributionChecks=0;
for(const [key,spec] of Object.entries(CITY_AMBIENT_LAYOUTS))for(const salt of [0,0x12345678,0x7f4a7c15]){
 const model=new CityAmbientActivity({...spec,seed:spec.seed^salt});model.sync('0',false);
 const roadPoints=spec.roads.flat().map(body);
 const districtExtent=Math.max(...roadPoints.flatMap(a=>roadPoints.map(b=>distance(a,b))));
 assert.ok(model.districts.length>=3,key+' 城内至少有三个独立活动街区');
 const assigned=model.districts.map((_,d)=>model.walkers.filter(w=>w.district===d).length);
 assert.ok(assigned.every(n=>n>0&&n<=Math.ceil(spec.patrollers/3)),key+' 每区均有人且主街不能吸走大半巡逻兵');
 if(spec.patrolDistrictCounts)assert.deepEqual(assigned,spec.patrolDistrictCounts);
 for(let a=0;a<spec.trainees;a+=2)for(let b=a+2;b<spec.trainees;b+=2){
  assert.ok(distance(body(model.drillBases[a]),body(model.drillBases[b]))>.045,key+' 多组操练不能仍在同一小块空地');
 }
 const checkDistribution=()=>{
  let spread=0;
  for(let i=0;i<model.walkers.length;i++){
   const w=model.walkers[i],s=model.soldiers[spec.trainees+i];
   assert.ok(model.districts[w.district].includes(w.edge),key+' 警戒/易主恢复也保持街区分工');
   const p=model.point(model.nearest([s.u,s.v],w.district));
   assert.ok(distance(s,body(p))<=AMBIENT_ROAD_MARGIN+1e-9,key+' 人物实际位置仍在负责街区的道路上');
   for(const other of model.soldiers)spread=Math.max(spread,distance(s,other));
  }
  assert.ok(spread>districtExtent*.5,key+' 持续活动范围须覆盖新城图路网跨度的一半，不能只改出生分布');
  for(const s of model.soldiers){
   const nearby=model.soldiers.filter(other=>distance(s,other)<.045).length;
   assert.ok(nearby<=Math.ceil(model.soldiers.length*.6),key+' 不得长时间挤在同一个小路口');
  }
  distributionChecks++;
 };
 const visited=model.walkers.map(()=>new Set());
 const run=seconds=>{
  for(let n=0;n<seconds*4;n++){
   const before=model.soldiers.map(s=>({...s})),start=performance.now();model.tick(.25);
   const ms=performance.now()-start;totalMs+=ms;ticks++;worstTick=Math.max(worstTick,ms);
   check(model.soldiers,spec.standing||[],key);
   if(n%4===0)checkDistribution();
   if(model.mode==='peace')model.walkers.forEach((w,i)=>visited[i].add(w.edge));
   for(let i=0;i<before.length;i++)assert.ok(distance(before[i],model.soldiers[i])<=.007000001,key+' 慢帧也不得瞬移');
  }
 };
 check(model.soldiers,spec.standing||[],key+'初始分布');
 checkDistribution();
 run(85);assert.ok(visited.every((edges,i)=>model.walkers[i].duty==='sentry'||edges.size>=3),key+' seed='+salt+' 巡逻兵避让后仍要能走过多个路段');
 model.sync('0',true);run(3);assert.ok(model.soldiers.every(s=>s.guard&&!s.walking),key+' 警戒两秒内就地整备，不长时间争抢站位');run(42);
 model.sync('0',false);run(15);assert.equal(model.mode,'peace',key+' 解除警戒后恢复');
 model.sync('new',true);run(6);model.sync('new',false);run(45);assert.equal(model.mode,'peace',key+' seed='+salt+' 易主后恢复');
}
console.log(`PASS 迎面/交叉/追赶/停岗让路/原画人物/慢帧，${pairChecks} 次人物间距及 ${staticChecks} 次固定站位检查`);
console.log(`PASS 十城三组随机种子与警戒/易主恢复；纯逻辑 ${ticks} tick，平均 ${(totalMs/ticks).toFixed(3)} ms，最长 ${worstTick.toFixed(3)} ms，测试让路 ${yieldFrames} 帧`);
console.log(`PASS ${distributionChecks} 次持续分布检查：街区人数、实际路面位置、操练分组和活动覆盖范围`);
