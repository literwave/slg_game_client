// 技能贴图与粒子共用轨迹；未命中和未结算时不能生成爆点。
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ts=require(process.argv[2]),root=path.resolve(__dirname,'../..'),cache=new Map();
let nodes=0;
class UITransform{setContentSize(w,h){this.width=w;this.height=h;}setAnchorPoint(x,y){this.anchorX=x;this.anchorY=y;}}
class Node{
 constructor(name=''){nodes++;this.name=name;this.children=[];this.components=new Map();this.active=true;this.position={x:0,y:0};this.scale={x:1,y:1};}
 addChild(n){this.children.push(n);n.parent=this;}addComponent(T){const c=new T();c.node=this;this.components.set(T,c);return c;}
 getComponent(T){return this.components.get(T);}setSiblingIndex(){}setPosition(x,y){this.position={x,y};}
 setRotationFromEuler(x,y,z){this.angle=z;}setScale(x,y){this.scale={x,y};}
}
class Sprite{static SizeMode={CUSTOM:0};}
class SpriteFrame{destroy(){this.destroyed=true;}}
class Label{static HorizontalAlign={CENTER:1};static VerticalAlign={CENTER:1};static Overflow={SHRINK:1};}
class Graphics{clear(){}rect(){}fill(){}}
class UIOpacity{constructor(){this.opacity=255;}}
class Color{constructor(r,g,b,a=255){Object.assign(this,{r,g,b,a});}}
const cc={Node,Sprite,SpriteFrame,Label,Graphics,UIOpacity,UITransform,Color,LabelOutline:class{},
 Rect:class{constructor(x,y,width,height){Object.assign(this,{x,y,width,height});}},
 Size:class{constructor(width,height){Object.assign(this,{width,height});}}};
function load(name){if(cache.has(name))return cache.get(name);const m={exports:{}};cache.set(name,m.exports);
 const file=path.join(root,'assets/scripts/map/ui',name+'.ts'),code=ts.transpileModule(fs.readFileSync(file,'utf8'),
 {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 new Function('require','module','exports',code)(p=>p==='cc'?cc:load(p.split('/').pop()),m,m.exports);return m.exports;}
function atlas(name){const png=fs.readFileSync(path.join(root,'assets/resources/ui/battle_replay/painted',name+'.png'));
 const frame=new SpriteFrame(),width=png.readUInt32BE(16),height=png.readUInt32BE(20);frame.texture={width,height};frame.originalSize={width,height};return frame;}
const Effects=load('PaintedBattleSkillEffects').default,{paintedSkillCue,skillFlight,skillTargetFamily}=load('PaintedSkillCue');
const at={'1:1':{x:-180,y:-50,width:110,leaderX:-160,leaderY:-40},
 '1:2':{x:-40,y:-120,width:110,leaderX:-20,leaderY:-110},
 '2:1':{x:180,y:50,width:110,leaderX:160,leaderY:40}};
const fx=new Effects(new Node(),atlas('skill-effects-refined-v1'),1,1280,720,k=>at[k]||null,atlas('skill-elements-refined-v1'));
assert.equal(fx.frames.length,6);assert.equal(fx.elements.length,12);
for(const f of [...fx.frames,...fx.elements])assert.equal(f.rect.width,256);
const initialNodes=nodes;
const snapshot=()=>JSON.stringify(fx.targetFx.map(parts=>Object.fromEntries(Object.entries(parts).map(([k,f])=>
 [k,{active:f.node.active,p:f.node.position,scale:f.node.scale,angle:f.node.angle,alpha:f.opacity.opacity,w:f.transform.width,h:f.transform.height}]))));
for(const [id,type,friendly] of [[1001,2,false],[1004,2,false],[1008,2,false],[1018,2,false],[1014,2,false],[1011,2,false],
 [1002,5,true],[1017,5,true],[1007,5,true],[2016,5,true],[1003,2,false],[1013,2,false],[1012,6,true]]){
 const action={actType:type,skillId:id,fromSide:1,fromPos:1,effects:[{targetSide:friendly?1:2,targetPos:friendly?2:1,flags:0}]};
 const original=JSON.stringify(action),cue=paintedSkillCue(action,{Name:'测试战法'});
 fx.begin(cue,1);fx.frame(.98,false);
 for(const key of ['arc','echo','star','embers','core','left','right'])assert.equal(fx.targetFx[0][key].node.active,false,'命中结算前不出现目标爆点：'+id+'/'+key);
 fx.frame(1.08,true);const frozen=snapshot();fx.frame(1.08,true);assert.equal(snapshot(),frozen,'暂停采样固定');
 for(const f of Object.values(fx.targetFx[0]))if(f.node.active)for(const n of [f.node.position.x,f.node.position.y,f.transform.width,f.transform.height,f.opacity.opacity])assert.ok(Number.isFinite(n));
 const missed=paintedSkillCue({...action,effects:[{...action.effects[0],flags:2}]});
 fx.begin(missed,1);fx.frame(1.12,true);for(const f of Object.values(fx.targetFx[0]))assert.equal(f.node.active,false,'闪避后无命中残留');
 fx.begin({...cue,targets:[{key:'2:99',hit:true,critical:false}]},1);fx.frame(1.1,true);
 for(const f of Object.values(fx.targetFx[0]))assert.equal(f.node.active,false,'缺失目标不生成命中特效');
 fx.begin(cue,1);fx.frame(2.3,true);assert.equal(fx.root.active,false);assert.equal(fx.dim.active,false);
 assert.equal(JSON.stringify(action),original,'不改写战报');
}
assert.equal(nodes,initialNodes,'多种技能重播复用预建节点');
const start=skillFlight(.52,1,at['1:1'],at['2:1'],1),end=skillFlight(1,1,at['1:1'],at['2:1'],1);
assert.equal(start.x,at['1:1'].leaderX);assert.equal(end.x,at['2:1'].x);assert.ok(Math.abs(end.y-at['2:1'].y-28)<1e-8);
const cue=paintedSkillCue({actType:2,skillId:1004,fromSide:1,fromPos:1,effects:[{targetSide:2,targetPos:1,flags:0}]});
fx.begin(cue,1);fx.frame(.8,false);const flight=skillFlight(.8,1,at['1:1'],at['2:1'],1);
assert.equal(fx.targetFx[0].slash.node.position.x,flight.x);assert.equal(fx.targetFx[0].slash.node.position.y,flight.y);
assert.equal(skillTargetFamily({...cue,style:null},{key:'1:2',hit:true,critical:false}),'rally','无配置友军效果不画劈砍');
fx.reset();assert.equal(fx.root.active,false);assert.equal(fx.root.children.filter(n=>n.active).length,0);
fx.destroy();assert.ok([...fx.frames,...fx.elements].every(f=>f.destroyed));
console.log('PASS 13 类技能、透明留边图集、轨迹一致、命中边界、闪避、缺失目标、暂停重播、节点复用与清理');
