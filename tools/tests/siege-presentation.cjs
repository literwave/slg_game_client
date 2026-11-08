const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const ts=require(process.argv[2]), root=path.resolve(__dirname,'../../assets/scripts'), cache=new Map();
class Node {
    constructor(name){this.name=name;this.children=[];this.components=new Map();this.active=true;}
    addChild(n){n.parent=this;this.children.push(n);}
    addComponent(T){const c=new T();c.node=this;this.components.set(T,c);return c;}
    setPosition(x,y){this.position={x,y};} setScale(){}
    removeFromParent(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;}
    destroy(){this.dead=true;this.children.forEach(n=>n.destroy());}
    set active(value){if(this._active===true&&value===false)this.disableCount=(this.disableCount||0)+1;this._active=value;}
    get active(){return this._active;}
}
class Sprite {static SizeMode={CUSTOM:0};}
class SpriteFrame {addRef(){} reset(s){Object.assign(this,s);}}
class UITransform {setContentSize(){} setAnchorPoint(){}}
class Graphics { clear(){} moveTo(){} lineTo(){} stroke(){} fill(){} circle(){} close(){} rect(){} }
const cc={Node,Sprite,SpriteFrame,UITransform,Graphics,Color:class{constructor(r,g,b,a){Object.assign(this,{r,g,b,a});}},UIOpacity:class{},Vec2:class{},Rect:class{},Size:class{},isValid:n=>!n.dead,
    resources:{load(name,Type,callback){const frame=new SpriteFrame();
        const png=fs.readFileSync(path.join(root,'../resources',name.replace('/spriteFrame','.png')));
        frame.texture={width:png.readUInt32BE(16),height:png.readUInt32BE(20)};queueMicrotask(()=>callback(null,frame));}}};
function load(name){
    if(cache.has(name))return cache.get(name).exports;
    const file=path.join(root,name+'.ts'), mod={exports:{}};cache.set(name,mod);
    const text=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
    new Function('require','module','exports',text)(id=>id==='cc'?cc:load(path.relative(root,path.resolve(path.dirname(file),id))),mod,mod.exports);
    return mod.exports;
}
async function main(){
    const {siegePhase,siegeWallContact}=load('map/entries/SiegeContact');
    for(const radius of [1,2,3,4])for(const [x,y]of [[10,0],[-10,0],[0,10],[0,-10],[10,10],[-10,10],[10,-10],[-10,-10]]){
        const p=siegeWallContact({x,y},{x:0,y:0},radius);
        assert.ok(Math.abs(Math.max(Math.abs(p.x),Math.abs(p.y))-(radius+.42))<1e-9);
        assert.ok(Math.abs(p.x*y-p.y*x)<1e-9,'射线命中同一侧墙，不能偏到城心');
    }
    assert.deepEqual(siegeWallContact({x:0,y:0},{x:0,y:0},1),{x:0,y:0});
    assert.equal(siegePhase(), 'guards');assert.equal(siegePhase({teamLeft:1}),'guards');assert.equal(siegePhase({teamLeft:0}),'wall');
    const {siegeFrameAt,loadSiegeUnit,loadSiegeCommander}=load('map/entries/SiegeAnimationLibrary');
    const {siegeBeat,siegeProjectile,siegeCommandFrameAt}=load('map/entries/SiegeChoreography');
    assert.equal(new Set(Array.from({length:320},(_,i)=>siegeFrameAt(i/100))).size,8);
    assert.equal(siegeFrameAt(3.2),0);assert.equal(siegeFrameAt(-1),0);assert.equal(siegeFrameAt(NaN),0);
    assert.equal(new Set(Array.from({length:320},(_,i)=>siegeCommandFrameAt(i/100))).size,8);
    assert.equal(siegeCommandFrameAt(.52),3,'order gesture precedes the first throw');
    assert.equal(siegeCommandFrameAt(2.14),4,'commander holds through the second rank release');
    assert.equal(siegeCommandFrameAt(2.17),5,'recover after both ranks have thrown');
    assert.equal(siegeCommandFrameAt(3.2),0);assert.equal(siegeCommandFrameAt(-1),0);assert.equal(siegeCommandFrameAt(NaN),0);
    assert.equal(siegeBeat(.75,0,300).flight,-1);
    assert.equal(siegeBeat(.76,0,300).flight,0);
    assert.equal(siegeBeat(.76,1,300).flight,-1,'ranks must release at different times');
    assert.equal(siegeBeat(1.43,0,300).impactAge,-1,'no impact before projectile arrival');
    assert.ok(siegeBeat(1.45,0,300).impactAge>=0);
    const a={x:20,y:40},b={x:-300,y:70};
    assert.deepEqual(Object.fromEntries(Object.entries(siegeProjectile(a,b,0)).filter(([k])=>k!=='angle')),a);
    assert.deepEqual(Object.fromEntries(Object.entries(siegeProjectile(a,b,1)).filter(([k])=>k!=='angle')),b);
    assert.ok(siegeProjectile(a,b,.5).y>(a.y+b.y)/2,'readable ballistic arc');
    const unit=await loadSiegeUnit();
    assert.equal(unit.length,8);assert.ok(unit.every(row=>row.length===8));
    assert.equal(new Set(unit.flat().map(f=>JSON.stringify([f.scale,f.pivot,f.tint]))).size,1,'no per-frame resize or tint flashing');
    const commander=await loadSiegeCommander();
    assert.equal(commander.length,8);assert.ok(commander.every(row=>row.length===8));
    assert.equal(new Set(commander.flat().map(f=>f.image.name)).size,40,'five authored views, mirrored to eight directions');
    assert.equal(new Set(commander.flat().map(f=>JSON.stringify([f.scale,f.pivot,f.tint]))).size,1,'commander keeps a fixed scale, anchor and color');
    assert.deepEqual(commander.map(row=>row[0].mirrored),[false,false,false,true,true,true,false,false]);
    const Effect=load('map/entries/SiegeEffect').default,host=new Node('host'),fx=new Effect(host);
    await new Promise(r=>setImmediate(r));
    const target={x:300,y:0},sources=[{x:0,y:0,index:0}];
    fx.update(target,0,'guards',1,sources);
    assert.ok(fx.shots.every(s=>!s.projectile.active&&!s.impact.node.active));
    fx.update(target,.9,'guards',1,sources);
    assert.equal(fx.shots[0].projectile.active,true);
    assert.ok(fx.shots[0].projectile.position.x>0&&fx.shots[0].projectile.position.x<300);
    assert.ok(fx.shots.every(s=>!s.impact.node.active),'no idle-loop wall explosions');
    const disables=fx.shots[0].projectile.disableCount||0;
    fx.update(target,.92,'guards',1,sources);
    assert.equal(fx.shots[0].projectile.disableCount||0,disables,'flying Graphics must not disable/re-enable between frames');
    fx.update(target,1.46,'guards',1,sources);
    assert.equal(fx.shots[0].projectile.active,false);
    assert.ok(fx.shots[0].impact.sprite.spriteFrame.name.startsWith('siege-impact-v2_3_'));
    assert.ok(fx.smoke.every(s=>!s.node.active)&&!fx.flame.node.active);
    assert.equal(fx.shots[0].impact.node.position.x,300,'impact remains on the real wall');
    fx.update(target,1.46,'wall',.6,sources);
    assert.ok(fx.shots[0].impact.sprite.spriteFrame.name.startsWith('siege-impact-v2_0_'));
    fx.update(target,2,'wall',.6,sources);
    assert.ok(fx.smoke.every(s=>s.node.active));assert.equal(fx.flame.node.active,false);
    fx.update(target,2,'wall',.2,sources);assert.equal(fx.flame.node.active,true);
    fx.update(target,2,'guards',.2,sources);assert.equal(fx.flame.node.active,false);
    fx.update(target,2,'wall',1,sources);assert.ok(fx.smoke.every(s=>!s.node.active));
    fx.update(null,2);assert.equal(fx.node.active,false);
    assert.ok(fx.shots.every(s=>!s.projectile.active&&!s.impact.node.active));
    fx.update(target,2,'wall',.2,[]);assert.equal(fx.node.active,false,'unready formation cannot emit');
    fx.destroy();assert.equal(host.children.length,0);
    const late=new Effect(host);late.destroy();await new Promise(r=>setImmediate(r));assert.equal(late.frames,null);
    console.log('PASS 32 wall contacts, staggered release/flight/impact, guard and damaged-wall phases, retreat and delayed asset cleanup');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
