// 验证真实动画加载器的异步顺序，不启动 Preview。
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ts=require(process.argv[2]),requests=[];
class Frame { addRef(){} reset(v){Object.assign(this,v);} }
class Vec { constructor(...args){this.args=args;} }
const cc={SpriteFrame:Frame,Rect:Vec,Size:Vec,Vec2:Vec,
 AnimationClip:{WrapMode:{Loop:1},createWithSpriteFrames:()=>({addRef(){}})},
 resources:{load(url,type,callback){requests.push({url,callback});}}};
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../assets/scripts/map/entries/MarchAnimationLibrary.ts'),'utf8'),
 {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};new Function('require','module','exports',code)(key=>key==='cc'?cc:{CAVALRY_WALK_CYCLE:1,MARCH_CYCLE:1},mod,mod.exports);
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function finish(part,width,height,error){const index=requests.findIndex(r=>r.url.includes(part));assert.ok(index>=0,part);const r=requests.splice(index,1)[0];
 const frame=new Frame();frame.texture={width,height};r.callback(error,error?null:frame);}
(async()=>{
 let ready=false;const p=mod.exports.loadMarchAnimations('infantry').then(s=>{ready=true;return s;});
 finish('guard_march_walk12',1920,1344);await flush();assert.equal(ready,true,'行走图集就绪即可显示小兵，不能等待警戒图');
 const set=await p;assert.equal(set.guardFrames,set.idleFrames);assert.equal(requests.length,1);
 finish('guard-kneel',576,384);await flush();assert.notEqual(set.guardFrames,set.idleFrames);assert.equal(set.guardFrames.length,8);
 const fail=mod.exports.loadMarchAnimations('cavalry');const rejected=assert.rejects(fail,/temporary/);
 finish('primary',0,0,new Error('temporary'));finish('axial',888,1776);finish('idle',960,192);await rejected;await flush();
 const retry=mod.exports.loadMarchAnimations('cavalry');assert.equal(requests.length,1,'成功图集复用，只重新加载失败图集');
 finish('primary',1254,1254);const cavalry=await retry;assert.equal(cavalry.walkFrames.length,8);
 console.log('PASS 小兵先显示、警戒后台补齐、图集失败后按需重试且复用成功缓存');
})().catch(e=>{console.error(e);process.exitCode=1;});
