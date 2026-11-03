// 战场密集阵型、合并受击、暂停零重绘及资源失败重试。
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ts=require(process.argv[2]),root=path.resolve(__dirname,'../..');
const read=n=>fs.readFileSync(path.join(root,'assets/scripts/map/ui',n+'.ts'),'utf8');
const transpile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
class Color {constructor(r,g,b,a=255){Object.assign(this,{r,g,b,a});}}
class SpriteFrame {constructor(){this.texture={width:64,height:64};this.refs=0;}addRef(){this.refs++;}}
const files=new Map(),loads=[];
let fail=true;
const cc={Color,SpriteFrame,resources:{load(name,T,cb){loads.push(name);queueMicrotask(()=>{
 if(fail&&name.includes('skill-elements')){fail=false;cb(new Error('transient'));return;}
 const frame=files.get(name)||new SpriteFrame();files.set(name,frame);cb(null,frame);
});}}};
function load(name){const m={exports:{}};new Function('require','module','exports',transpile(read(name)))(
 p=>p==='cc'?cc:{},m,m.exports);return m.exports;}
function method(name,deps={}){
 const src=ts.createSourceFile('v.ts',read('BattleReplayPaintedView'),ts.ScriptTarget.Latest,true);
 const cls=src.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='BattleReplayPaintedView');
 const m=cls.members.find(n=>n.name?.getText(src)===name),code=transpile('class Method {'+m.getText(src)+'}\nexports.Method=Method;'),out={exports:{}};
 new Function('exports',...Object.keys(deps),code)(out.exports,...Object.values(deps));return out.exports.Method.prototype[name];
}
(async()=>{
 const p=load('BattleReplayPresentation');
 assert.equal(p.replayVisualCount(0),0);assert.equal(p.replayVisualCount(Infinity),0);
 for(let n=1;n<100000;n=n*3+1)assert.ok(p.replayVisualCount(n)>=4&&p.replayVisualCount(n)<=16);
 for(const count of [4,6,9,12,16])for(const side of [1,2])for(let index=0;index<3;index++){
  const home=p.replayArmyHome(index,3,side,1),points=p.replayFormation(count,side,1);
  assert.equal(new Set(points.map(v=>v.x+':'+v.y)).size,count);
  for(const at of points){assert.ok(Math.abs(home.x+at.x)<590);assert.ok(home.y+at.y>-235);assert.ok(home.y+at.y+90<270);}
 }
 console.log('PASS 密集军阵边界、唯一落脚点和最多 102 个人物节点');
 const effects=[{targetSide:2,targetPos:1,flags:2},{targetSide:2,targetPos:1,flags:1},
 {targetSide:2,targetPos:1,flags:4},{targetSide:2,targetPos:2,flags:4}];
 const before=JSON.stringify(effects),groups=p.replayImpactGroups(effects);
 assert.deepEqual(groups,[{key:'2:1',flags:1},{key:'2:2',flags:4}]);assert.equal(JSON.stringify(effects),before);
 const notices=[],army={key:'2:1',count:100,max:100,position:{x:0,y:0},members:Array.from({length:4},()=>({
 alive:true,fallFoot:{set(){}},node:{active:true},rig:{animate(){}},opacity:{opacity:255}
 }))};
 const v={action:{effects:[{targetSide:2,targetPos:1,flags:0},{targetSide:2,targetPos:1,flags:0}]},
 replay:{soldiers:new Map([['2:1',0]]),step(){}},armies:new Map([['2:1',army]]),
 seeking:false,scale:1,hasSkillEffect:false,bursts:[],showHitNumber:(...a)=>notices.push(a),controls(){}};
 method('impact',{replayImpactGroups:p.replayImpactGroups,PAINTED_CLIPS:{hit:{duration:.56}}}).call(v);
 assert.equal(notices.length,1);assert.equal(notices[0][1],-100);assert.equal(v.bursts.length,1);
 assert.equal(army.members.filter(x=>x.alive).length,0);
 console.log('PASS 同一目标多效果只飘一次兵损、只受击一次，保留真实最终兵力');
 const idle={ready:true,node:{activeInHierarchy:true},playing:false,clock:3,impactHold:.05,
 advance(){throw Error('paused advance');},render(){throw Error('paused render');},
 camera(){throw Error('paused camera');},drawProgress(){throw Error('paused UI');}};
 const update=method('update');for(let i=0;i<120;i++)update.call(idle,1/60);
 assert.equal(idle.clock,3);assert.equal(idle.impactHold,.05);
 console.log('PASS 暂停不推进、不重画军阵、不排序、不消耗停顿计时');
 const stage=load('BattleReplayStage');assert.ok(stage.REPLAY_STAGE_ASSETS.every(n=>!n.includes('standard')),'不再预加载军旗');const a=stage.loadReplayStage(),b=stage.loadReplayStage();assert.equal(a,b);
 await assert.rejects(a,/transient/);const frames=await stage.loadReplayStage();
 assert.equal(frames.length,4);assert.equal(loads.length,5,'只重试失败的资源');
 assert.ok(frames.every(f=>f.refs===1&&!f.packable));
 await stage.loadReplayStage();assert.equal(loads.length,5,'重复打开不重复加载');
 console.log('PASS 战场图片并发去重、失败可重试、成功图片不重复加载或持有');
})().catch(e=>{console.error(e);process.exitCode=1;});
