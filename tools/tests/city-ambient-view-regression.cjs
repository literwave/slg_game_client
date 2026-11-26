// Exercise the actual component lifecycle, lazy loading, viewport LOD and pooled nodes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require(process.argv[2]);
const root=path.resolve(__dirname,'../..'),cache=new Map();
function load(file,imports={}) {
 const absolute=path.resolve(root,'assets/scripts',file.endsWith('.ts')?file:file+'.ts');
 if(cache.has(absolute))return cache.get(absolute);
 const result=ts.transpileModule(fs.readFileSync(absolute,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,experimentalDecorators:true},reportDiagnostics:true});
 assert.equal(result.diagnostics.length,0);
 const m={exports:{}};cache.set(absolute,m.exports);
 new Function('require','module','exports',result.outputText)(id=>id in imports?imports[id]:load(path.resolve(path.dirname(absolute),id)),m,m.exports);
 return m.exports;
}
class Component {isValid=true;}
class Vec3 {constructor(x=0,y=0,z=0){this.set(x,y,z);}set(x,y,z=0){Object.assign(this,{x,y,z});return this;}}
class Node {
 constructor(name){Object.assign(this,{name,children:[],components:new Map(),isValid:true,active:true,layer:2,position:new Vec3(),scale:new Vec3(1,1,1)});}
 get scene(){return this.parent?.scene||this;}
 addChild(n){n.parent=this;this.children.push(n);}
 getChildByPath(p){return p.split('/').reduce((n,k)=>n?.children.find(c=>c.name===k),this);}
 addComponent(T){const c=new T();c.node=this;this.components.set(T,c);return c;}
 getComponent(T){return this.components.get(T);}
 setPosition(x,y,z=0){this.position.set(x,y,z);}setScale(x,y,z=1){this.scale.set(x,y,z);}
 getSiblingIndex(){return this.parent.children.indexOf(this);}
 setSiblingIndex(i){const a=this.parent.children;a.splice(a.indexOf(this),1);a.splice(i,0,this);}
}
class UITransform {setContentSize(width,height){Object.assign(this,{width,height});}setAnchorPoint(x,y){this.anchor={x,y};}
 convertToWorldSpaceAR(p,out){return out.set(p.x+this.node.position.x,p.y+this.node.position.y);}}
class Camera extends Component {orthoHeight=360;convertToUINode(p,ui,out){out.set(p.x*360/this.orthoHeight,p.y*360/this.orthoHeight);}}
class Sprite {static SizeMode={CUSTOM:1};}
class Color {constructor(r,g,b,a){Object.assign(this,{r,g,b,a});}}
const cc={Component,Node,UITransform,Camera,Sprite,Color,Vec3,view:{getVisibleSize:()=>({width:1280,height:720})},_decorator:{ccclass:()=>C=>C}};
const listeners=[],E={updateAllianceCities:'cities',updateMarches:'marches',updateWorldEntities:'entities'};
const events={on:(event,handler,target)=>listeners.push({event,handler,target}),targetOff:target=>{for(let i=listeners.length-1;i>=0;i--)if(listeners[i].target===target)listeners.splice(i,1);},
 emit:event=>{for(const l of [...listeners])if(l.event===event)l.handler.call(l.target);}};
const {cityArtLayout}=load('map/CityFootprint');
const PlayerGround=load('map/PlayerCityGround',{cc}).default;
PlayerGround.profiles=JSON.parse(fs.readFileSync(path.join(root,'assets/resources/world/player-city-ground.json'),'utf8'));
let owner='0',stateReads=0,loads=0;const deferred=[],world={marches:new Map(),entities:new Map()},proxy={strategic:false};
const View=load('map/CityAmbientView',{
 cc,'../utils/EventMgr':{EventMgr:events},'../common/LogicEvent':{LogicEvent:E},
 '../world/CityCommand':{default:{getInstance:()=>({at:(x,y)=>{stateReads++;return {entityId:'9007199254740993',allianceId:owner,pos:{x,y}};}})}},
 '../world/WorldCommand':{default:{getInstance:()=>world}},'./MapCommand':{default:{getInstance:()=>({proxy})}},
 './MapUtil':{default:{tileSize:{width:200,height:125}}},'./WorldMapArt':{default:{cityLayout:(level,data,w,h)=>cityArtLayout(level,1040,650,w,h,data)}},
 './PlayerCityGround':{default:PlayerGround},
 './entries/MarchAnimationLibrary':{loadMarchAnimations:()=>{loads++;return new Promise(resolve=>deferred.push(resolve));}},
 }).default;
const frames=Array.from({length:8},(_,d)=>Array.from({length:12},(_,f)=>({d,f})));
const animation={walkFrames:frames,idleFrames:frames.map(f=>f[0]),guardFrames:frames.map(f=>f[1]),mirrored:[false,false,false,true,true,true,false,false]};
const scene=new Node('Scene'),canvas=new Node('Canvas'),ui=new Node('MapUIScene'),cameraNode=new Node('Map Camera');
scene.addChild(canvas);canvas.addChild(ui);canvas.addChild(cameraNode);const camera=cameraNode.addComponent(Camera);
function makeView(){const node=new Node('City');canvas.addChild(node);node.addComponent(UITransform);const c=node.addComponent(View);c.onEnable();return c;}
async function main(){
 const c=makeView();c.setCity({x:310,y:500,level:7});camera.orthoHeight=20000;
 c.update(.2);assert.equal(loads,0,'远景不触发图集加载');assert.equal(c.activity.peaceTime,0);
 camera.orthoHeight=360;c.update(.1);c.update(.1);assert.equal(loads,1,'异步加载期间不逐帧重复发起');
 c.clear();c.setCity({x:166,y:307,level:4});deferred.shift()(animation);await Promise.resolve();c.update(.1);
 assert.equal(c.members.length,8,'旧城加载回调不可为复用后的新城创建旧人数');assert.equal(c.root.active,true);
 assert.ok(c.members.every(m=>m.sprite.spriteFrame&&m.node.components.size===2),'士兵只有渲染和变换组件，不拦截地图点击');
 const poolRoot=c.root;c.setCity({x:310,y:500,level:7});c.update(.1);assert.equal(c.members.length,12);
 c.setCity({x:166,y:307,level:4});c.update(.1);assert.equal(c.root,poolRoot);assert.ok(c.members.slice(8).every(m=>!m.node.active),'都城复用为州府后隐藏多余节点');
 for(let step=0;step<80;step++){
  c.update(.05);const active=c.root.children.filter(n=>n.active);
  for(let i=1;i<active.length;i++)assert.ok(active[i-1].position.y>=active[i].position.y,'交会时每帧按脚底更新前后遮挡');
 }
 const count=stateReads;for(let i=0;i<10;i++){events.emit(E.updateWorldEntities);c.update(.01);}assert.ok(stateReads-count<=1,'连续推送合并到低频状态读取');
 world.marches.set('a',{troopState:4,targetId:'9007199254740993'});events.emit(E.updateMarches);c.update(.25);assert.equal(c.activity.mode,'alert');
 for(let i=0;i<160;i++)c.update(.25);assert.ok(c.activity.soldiers.every(s=>s.guard));
 const gait=c.members.map(m=>m.gait);c.update(.2);assert.deepEqual(c.members.map(m=>m.gait),gait,'站岗时不原地踏步');
 const time=c.clock;c.node.setPosition(20000,0);c.update(.2);assert.equal(c.root.active,false);assert.equal(c.clock,time,'屏外停止推进动画');
 world.marches.clear();owner='9007199254740994';events.emit(E.updateAllianceCities);c.node.setPosition(0,0);c.update(.25);
 assert.equal(c.activity.mode,'withdraw','屏外归属变化在重新可见时读取');
 proxy.strategic=true;c.update(.2);assert.equal(c.root.active,false);proxy.strategic=false;c.update(.2);assert.equal(c.root.active,true);
 c.onDisable();assert.equal(c.root.active,false);assert.equal(listeners.length,0);assert.equal(c.activity,null);
 c.onEnable();c.setCity({x:500,y:500,level:10});c.update(.1);assert.equal(c.activity.soldiers.length,16);assert.ok(c.members.filter(m=>m.node.active).length>=12,'多数宫城守卫应位于开阔道路');assert.equal(loads,1,'复用共享图集');
 // At fixed art-space locations, camera zoom cannot change building depth.
 c.setCity({x:499,y:114,level:4});c.update(.1);c.activity.tick=()=>{};
 const actor=c.activity.soldiers[0],member=c.members[0],identity=member.node,duty=actor.duty;
 for(const zoom of [180,360,500]){
  camera.orthoHeight=zoom;
  Object.assign(actor,{u:300/1040,v:160/520});c.update(0);assert.equal(member.node.active,false,'隐藏整个屋顶后的模型');
  Object.assign(actor,{u:600/1040,v:280/520});c.update(0);assert.equal(member.node.active,true,'回到敞开院心恢复可见');
  Object.assign(actor,{u:480/1040,v:285/520});c.update(0);assert.equal(member.node.active,true,'前景人物保持可见');
  assert.equal(member.node,identity);assert.equal(actor.duty,duty,'隐藏只影响显示，不更换角色或职责');
 }
 camera.orthoHeight=360;c.setCity({x:166,y:307,level:4});c.update(.1);c.activity.tick=()=>{};
 Object.assign(c.activity.soldiers[0],{u:450/1040,v:269/520});c.update(0);assert.equal(c.members[0].node.active,true,'节点复用不能保留上一个城的遮挡');
 c.setCity({x:500,y:884,level:4});c.update(.1);
 let tracked=-1,before=null,moved=false,reappeared=false;
 for(let step=0;step<2400&&!reappeared;step++){
  c.update(.1);
  if(tracked<0){tracked=c.activity.soldiers.findIndex((s,i)=>s.walking&&!c.members[i].node.active);if(tracked>=0){const s=c.activity.soldiers[tracked];before={u:s.u,v:s.v,duty:s.duty,node:c.members[tracked].node};}}
  else{
   const s=c.activity.soldiers[tracked],m=c.members[tracked];assert.equal(s.duty,before.duty);assert.equal(m.node,before.node);
   if(!m.node.active&&Math.hypot(s.u-before.u,s.v-before.v)>.001)moved=true;
   if(m.node.active)reappeared=true;
  }
 }
 assert.ok(tracked>=0&&moved&&reappeared,'实际巡逻经过屋顶：隐藏时继续行走，走出建筑后原节点重新出现');
 // Pass and bridge share the actual city activity/rendering lifecycle, without scaling people to bridge length.
 const geometry=load('map/GateGeometry');
 for(const crossing of ['pass','bridge'])for(const mirrored of [false,true]){
  const gate={x:407,y:504,level:8,crossing,axis:mirrored?'x':'y',bridgeSpan:12};
  c.setGate(gate,mirrored);c.update(.1);
  const activity=c.activity;c.setGate(gate,mirrored);assert.equal(c.activity,activity,'重刷同一关隘不让巡逻重生');
  assert.equal(activity.soldiers.length,6);assert.equal(c.members.slice(6).filter(m=>m.node.active).length,0);
  assert.deepEqual(activity.soldiers.map(s=>s.duty),['roam','roam','sentry','patrol','sentry','patrol']);
  assert.ok(c.memberSize<=17,'桥长增加不能放大装饰士兵');
  const posts=activity.soldiers.filter(s=>s.duty==='sentry').map(s=>[s.u,s.v]);
  const start=activity.soldiers.map(s=>[s.u,s.v]);let visibleSamples=0,moving=0;
  for(let step=0;step<1200;step++){
   c.update(.1);
   if(step%10===0)for(let i=0;i<6;i++){
    const s=activity.soldiers[i],m=c.members[i];
    assert.ok(geometry.gateHit(m.node.position.x,m.node.position.y,gate.level,mirrored,gate,200,125),'脚底始终位于关城地面或石桥面');
    if(m.node.active)visibleSamples++;
    if(s.walking)moving++;
   }
  }
  assert.ok(visibleSamples>120*4,'分散岗哨不能大半藏在城楼后面');assert.ok(moving>120,'巡逻在不同通道持续移动');
  assert.deepEqual(activity.soldiers.filter(s=>s.duty==='sentry').map(s=>[s.u,s.v]),posts,'岗哨保持固定站位');
  assert.ok(activity.soldiers.some((s,i)=>s.duty!=='sentry'&&Math.hypot(s.u-start[i][0],s.v-start[i][1])>.02));
  world.marches.set('gate',{troopState:4,targetPos:{x:gate.x,y:gate.y}});events.emit(E.updateMarches);c.update(.25);
  assert.equal(c.activity.mode,'alert','攻城时关隘小兵转入警戒');world.marches.clear();
 }
 const home={x:376,y:141,level:10,rid:'9007199254740999',entityId:'9007199254740997',parentId:0};
 c.setPlayerCity(home);c.update(.1);const homeActivity=c.activity;
 c.setPlayerCity({...home});assert.equal(c.activity,homeActivity,'主城刷新不让哨兵重新出生');
 c.setPlayerCity({...home,level:9});assert.equal(c.activity,homeActivity,'同一外观阶段升级不重置城内人物');
 assert.equal(c.activity.soldiers.length,6);assert.ok(c.members.slice(6).every(m=>!m.node.active));
 let shown=0;const homePosts=c.activity.soldiers.filter(s=>s.duty==='sentry').map(s=>[s.u,s.v]);
 for(let step=0;step<1200;step++){
  c.update(.1);
  for(let i=0;i<6;i++){
   const member=c.members[i];if(member.node.active)shown++;
   assert.ok(Math.abs(member.node.position.x)/c.layout.width+Math.abs(member.node.position.y)/c.layout.height<.495,'装饰士兵不能走出主城九格');
  }
 }
 assert.ok(shown>1200*4,'主城人物应分散在可见的院落内');
 assert.deepEqual(c.activity.soldiers.filter(s=>s.duty==='sentry').map(s=>[s.u,s.v]),homePosts,'主城岗哨保持站位');
 world.marches.set('home',{troopState:4,targetId:home.entityId});events.emit(E.updateMarches);c.update(.25);
 assert.equal(c.activity.mode,'alert','使用玩家主城实体 ID 响应攻城');world.marches.clear();
 c.setPlayerCity({...home,parentId:12});c.update(.25);assert.equal(c.activity.mode,'withdraw','主城沦陷切换驻军状态');
 c.setPlayerCity({...home,level:11});assert.notEqual(c.activity,homeActivity,'进入新外观阶段应切换到其专属院落路网');
 for(const level of [1,6,11,16,21,26]){
  c.setPlayerCity({...home,level,parentId:0});c.update(.1);
  assert.equal(c.activity.soldiers.length,6,'各外观阶段都应保留城内人物');
  for(let step=0;step<120;step++){
   c.update(.1);
   for(const member of c.members.slice(0,6))assert.ok(
    Math.abs(member.node.position.x)/c.layout.width+Math.abs(member.node.position.y)/c.layout.height<.495,
    '各阶段的人物路线必须位于主城占地内');
  }
 }
 c.clear();assert.equal(c.root.active,false);assert.equal(c.activity,null);
 c.setCity({x:166,y:307,level:4});c.update(.1);assert.equal(c.activity.soldiers.length,8,'关隘复用为城池恢复城市人数');
 c.onDisable();c.onDestroy();assert.equal(listeners.length,0);
 const destroyed=makeView();destroyed.setCity({x:310,y:500,level:7});destroyed.update(.1);destroyed.onDisable();destroyed.onDestroy();destroyed.isValid=false;destroyed.node.isValid=false;
 deferred.shift()(animation);await Promise.resolve();assert.equal(destroyed.animations,null,'销毁后异步回调不能回写组件');assert.equal(listeners.length,0);
 console.log('PASS 装饰士兵组件：建筑遮挡及出檐恢复、缩放一致性、远景/屏外暂停、延迟图集、攻城与易主、节点复用及监听释放');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
