// 验证回放使用地图角色、固定落脚点，以及特效命中边界；不发网络请求。
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ts=require(process.argv[2]),root=path.resolve(__dirname,'../..'),cache=new Map(),loads=[];
class Point{constructor(x=0,y=0){this.x=x;this.y=y;}}
class UITransform{setContentSize(w,h){this.width=w;this.height=h;}setAnchorPoint(x,y){this.anchorX=x;this.anchorY=y;}}
class Sprite{static SizeMode={CUSTOM:0};}
class EffectAsset{addRef(){}}
class Material{static created=0;constructor(){Material.created++;this.passes=[];}initialize(){}copy(){}setProperty(){}destroy(){}}
class SpriteFrame{reset(v){Object.assign(this,v);}addRef(){}}
class Graphics{
 constructor(){this.ops=[];}clear(){this.ops=[];}
 ellipse(...a){this.ops.push(['ellipse',...a]);}circle(...a){this.ops.push(['circle',...a]);}
 moveTo(...a){this.ops.push(['move',...a]);}lineTo(...a){this.ops.push(['line',...a]);}
 quadraticCurveTo(...a){this.ops.push(['curve',...a]);}
 fill(){this.ops.push(['fill',this.fillColor]);}stroke(){this.ops.push(['stroke',this.strokeColor,this.lineWidth]);}
}
class Node{
 constructor(name=''){this.name=name;this.children=[];this.components=new Map();this.position=new Point();this.scale=new Point(1,1);}
 addChild(c){c.parent=this;this.children.push(c);}addComponent(T){const c=new T();c.node=this;this.components.set(T,c);return c;}
 getComponent(T){return this.components.get(T);}setSiblingIndex(i){const a=this.parent.children;a.splice(a.indexOf(this),1);a.splice(i,0,this);}
 setPosition(x,y){this.position=new Point(x,y);}setScale(x,y){this.scale=new Point(x,y);}setRotationFromEuler(x,y,z){this.angle=z;}
}
class AnimationClip{static WrapMode={Loop:2};static createWithSpriteFrames(frames,fps){return Object.assign(new AnimationClip(),{frames,duration:frames.length/fps});}addRef(){}}
const cc={Node,UITransform,Sprite,SpriteFrame,Graphics,AnimationClip,EffectAsset,Material,Vec2:Point,
 Vec4:class{constructor(x=0,y=0,z=0,w=0){this.set(x,y,z,w);}set(x,y,z,w){Object.assign(this,{x,y,z,w});}},
 Rect:class{constructor(x,y,width,height){Object.assign(this,{x,y,width,height});}},Size:class{constructor(width,height){Object.assign(this,{width,height});}},
 Color:class{constructor(r,g,b,a=255){Object.assign(this,{r,g,b,a});}},resources:{load(name,T,done){loads.push(name);
 if(T===EffectAsset){queueMicrotask(()=>done(null,new EffectAsset()));return;}
 const png=fs.readFileSync(path.join(root,'assets/resources',name.replace('/spriteFrame','.png'))),sheet=new SpriteFrame();
 sheet.texture={width:png.readUInt32BE(16),height:png.readUInt32BE(20)};queueMicrotask(()=>done(null,sheet));}}};
const stubs={'map/ui/ManagementStyle':{},'map/ui/TaskBoardView':{},'map/ui/ReportUnitArt':{},'battle/ReportPresentation':{}};
function load(name){if(stubs[name])return stubs[name];if(cache.has(name))return cache.get(name);
 const file=path.join(root,'assets/scripts',name+'.ts'),mod={exports:{}};cache.set(name,mod.exports);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 new Function('require','module','exports',code)(key=>key==='cc'?cc:load(path.relative(path.join(root,'assets/scripts'),path.resolve(path.dirname(file),key)).replace(/\\/g,'/')),mod,mod.exports);return mod.exports;}
(async()=>{
 const {loadReplayActors,BattleReplayActor,replayActionPoseTime,replayDefeatOpacity,REPLAY_DEFEAT_DURATION,replayReturnHeading}=load('map/ui/BattleReplayActor');
 const a=loadReplayActors(),b=loadReplayActors();assert.equal(a,b,'并发打开共用加载');const assets=await a;
 for(const [frames,count,w,h] of [[assets.archer,8,256,256],[assets.archerAttack,16,256,256],
 [assets.infantryAttack,16,400,320],[assets.cavalryAttack,16,400,320]]){
 assert.equal(frames.length,count);for(const f of frames){assert.equal(f.rect.width,w);assert.equal(f.rect.height,h);}}
 assert.equal(new Set(loads).size,loads.length,'每张图集只加载一次');
 const snapshot=actor=>JSON.stringify({frame:actor.root.getComponent(Sprite).spriteFrame.name,position:actor.root.position,scale:actor.root.scale,angle:actor.root.angle});
 for(const kind of ['infantry','cavalry','archer']){const actor=new BattleReplayActor(new Node(),assets,kind,82,1),tr=actor.root.getComponent(UITransform);
 assert.equal(tr.anchorY,18/256);assert.equal(tr.width,tr.height);actor.face(1,.5);actor.animate('rush',.1,0,true);const walking=snapshot(actor);
 actor.animate('rush',.55,0,true);assert.notEqual(snapshot(actor),walking,'推进必须换步态');actor.animate('idle',0,0,true);assert.equal(actor.root.position.y,0,'站立脚底固定');
 actor.face(-1,-.5);actor.animate(kind==='archer'?'shoot':'attack',.5,0,true);assert.equal(actor.root.scale.x,-1);
 const paused=snapshot(actor);actor.animate(kind==='archer'?'shoot':'attack',.5,1,true);assert.equal(snapshot(actor),paused,'同一时刻姿态不漂移');
 if(kind==='infantry')assert.ok(actor.root.getComponent(Sprite).spriteFrame.name.startsWith('infantry_battle_cycle'));
 assert.equal(tr.height*tr.anchorY,82*18/256,'切换图集后脚底留白保持一致');
 const poses=new Set();for(let i=0;i<40;i++){actor.animate(kind==='archer'?'shoot':'attack',i*.04,0,true);poses.add(actor.root.getComponent(Sprite).spriteFrame.name);}
 assert.equal(poses.size,8,'每个朝向必须播放完整八帧');}
 const clips=load('map/ui/PaintedBattleMotion').PAINTED_CLIPS;
 for(const motion of ['attack','sweep','slash','shoot'])for(const phase of [0,.7,2.1,4.5]){
  const clip=clips[motion],strike=clip.duration*(motion==='shoot'?.46:clip.impact);
  assert.equal(replayActionPoseTime(motion,strike,phase),strike,'错落动作必须保留共同出手时刻');
  let previous=-1;
  for(let i=0;i<=100;i++){const at=replayActionPoseTime(motion,clip.duration*i/100,phase);
   assert.ok(at>=previous&&at>=0&&at<=clip.duration+1e-9,'姿态时间单调且不越界');previous=at;}
 }
 assert.equal(replayDefeatOpacity(-.1),255);assert.equal(replayDefeatOpacity(0),255);
 assert.equal(replayDefeatOpacity(REPLAY_DEFEAT_DURATION),0);
 for(let i=0;i<100;i++)assert.ok(replayDefeatOpacity(i/100)>=replayDefeatOpacity((i+1)/100),'退场透明度单调');
 for(const side of [1,2]){const actor=new BattleReplayActor(new Node(),assets,'infantry',82,side);
  actor.animate('attack',0,0,true);assert.ok(Math.abs(actor.root.position.x)<1e-8);
  actor.animate('attack',clips.attack.duration*.68*clips.attack.impact,0,true);
  const windup=actor.root.position.x;actor.animate('attack',clips.attack.duration*clips.attack.impact,0,true);
  assert.ok(windup*actor.root.position.x<0,'蓄力与出手方向相反');
  actor.animate('attack',clips.attack.duration,0,true);assert.ok(Math.abs(actor.root.position.x)<1e-8,'收招回到原位');
  actor.animate('fall',.8,0,true);assert.ok(Math.abs(actor.root.angle)<=14,'退场不再横倒整张人物');
  const fixed=snapshot(actor);actor.animate('fall',.8,1,true);assert.equal(snapshot(actor),fixed,'暂停退场姿态固定');
 }
 const returning=replayReturnHeading(-1,0,0),returned=replayReturnHeading(-1,0,.18);
 assert.ok(returning.x>.99&&returned.x<-.99,'撤回先面向敌方再完成转身');
 for(const motion of ['command','rally','cast','guard']){
  const actor=new BattleReplayActor(new Node(),assets,'cavalry',100,1),poses=new Set();
  for(let i=0;i<12;i++){actor.animate(motion,clips[motion].duration*i/12,0,true);poses.add(actor.root.getComponent(Sprite).spriteFrame.name);}
  assert.ok(poses.size>=2,'发令和戒备必须有实际肢体姿态变化');
 }
 const {sampleReplayFrames}=load('map/ui/BattleReplayFrameBlend');
 const keys=[0,1,2,3,4,5,6,7],strike=.43,times=[0,strike*.22,strike*.48,strike*.75,strike,strike+(1-strike)*.33,strike+(1-strike)*.67,1];
 const beforeHit=sampleReplayFrames(strike-.015,1,keys,times),atHit=sampleReplayFrames(strike,1,keys,times);
 assert.ok(beforeHit.mix>0&&beforeHit.mix<1,'出手前存在帧间交接');
 assert.equal(beforeHit.to,4);assert.equal(atHit.from,4,'命中关键帧仍准时到达');
 for(const t of [0,.1,.43,.6,.99,1]){const a=sampleReplayFrames(t,1,keys,times);
  assert.ok(a.mix>=0&&a.mix<=1);assert.deepEqual(sampleReplayFrames(t,1,keys,times),a,'相同时刻换帧采样固定');}
 const last=sampleReplayFrames(.749,.75,[0,1,2,3,4,5],undefined,true);
 assert.equal(last.to,0);assert.ok(last.mix>.99,'循环末尾平滑交给首帧');
 const actor=new BattleReplayActor(new Node(),assets,'infantry',82,1);
 actor.animate('attack',.12,.016,false);actor.animate('attack',.13,.016,false);
 const frozen=snapshot(actor);actor.animate('attack',.13,.016,false);assert.equal(snapshot(actor),frozen,'重复采样不积累动作交接');
 actor.animate('idle',0,0,true);assert.equal(actor.root.getComponent(Sprite).customMaterial,null,'静止时恢复普通材质');
 const allocated=Material.created;
 for(let i=0;i<90;i++)actor.animate('rush',i/60,1/60,false);
 assert.equal(Material.created,allocated,'战斗中不再创建新材质');
 actor.destroy();
 console.log('PASS 帧间过渡、命中边界、循环接缝、重复采样与静止材质恢复');
 console.log('PASS 出手时刻一致、动作时间单调、蓄力收招、退场淡出和暂停确定性');
 console.log('PASS 地图人物复用、共享加载、八帧图集、落脚点、朝向和暂停姿态');
 const {replayFormation,replayArmyHome}=load('map/ui/BattleReplayPresentation');
 for(const side of [1,2])for(const count of [1,4,6,9]){const ps=replayFormation(count,side,1);assert.equal(new Set(ps.map(p=>`${p.x}:${p.y}`)).size,count);
 if(count>3)assert.ok(new Set(ps.map(p=>p.y)).size>2);for(let i=0;i<3;i++){const home=replayArmyHome(i,3,side,1);for(const p of ps){assert.ok(home.y+p.y>-250);assert.ok(home.y+p.y+65<280);}}}
 console.log('PASS 双方阵位、前后排不重合、角色落脚点与头部位于战场内');
 const {BattleSkillAccents}=load('map/ui/BattleReplaySkillView'),{paintedSkillCue}=load('map/ui/PaintedSkillCue');
 const at={'1:1':{x:-180,y:-50,width:110,leaderX:-160,leaderY:-40},'2:1':{x:180,y:50,width:110,leaderX:160,leaderY:40}},world=new Node();
 const fx=new BattleSkillAccents(world,1,key=>at[key]),g=world.children[0].getComponent(Graphics),signatures=new Set();
 for(const id of [1001,1002,1003,1004,1007,1008,1011,1013,1014,1017,1018,2016]){
 const action={actType:2,skillId:id,fromSide:1,fromPos:1,effects:[{targetSide:2,targetPos:1,flags:0}]},cue=paintedSkillCue(action,{Name:'测试战法'}),saved=JSON.stringify(action);
 fx.begin(cue,1);fx.frame(1.12,true);const sample=JSON.stringify(g.ops);signatures.add(sample);fx.frame(1.12,true);assert.equal(JSON.stringify(g.ops),sample);
 for(const op of g.ops)for(const v of op)if(typeof v==='number')assert.ok(Number.isFinite(v));assert.equal(JSON.stringify(action),saved);fx.reset();assert.equal(g.ops.length,0);}
 assert.ok(signatures.size>=9,'战法表现需要有实际差异');
 const miss=paintedSkillCue({actType:2,skillId:1008,fromSide:1,fromPos:1,effects:[{targetSide:2,targetPos:1,flags:2}]});
 fx.begin(miss,1);fx.frame(1.12,true);assert.equal(g.ops.filter(op=>['ellipse','line','curve'].includes(op[0])).length,0,'闪避不能出现落雷或命中冲击波');
 fx.begin({...miss,targets:[{key:'2:99',hit:true,critical:false}]},1);fx.frame(1.12,true);assert.equal(g.ops.filter(op=>op[0]==='ellipse').length,0,'未知目标不能生成落点');
 fx.frame(3,true);assert.equal(g.ops.length,0,'结束后不残留特效');console.log('PASS 战法差异、命中约束、未知目标、确定性采样和清理');
})().catch(e=>{console.error(e);process.exitCode=1;});
