// 执行真实重连显示组件；验证状态切换、遮罩和安全区，网络逻辑另由 reconnect-regression 覆盖。
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), ts=require(process.argv[2]);
let clock=1000, visible={width:1280,height:720}, safe={x:0,y:0,width:1280,height:720};
const listeners=new Set(), emitted=[];
class Component {}
class Node {
    static EventType={SIZE_CHANGED:'size'};
    constructor(name=''){this.name=name;this.children=[];this.components=new Map();this.active=true;this.layer=1;this.position={x:0,y:0};}
    get activeInHierarchy(){return this.active&&(!this.parent||this.parent.activeInHierarchy);}
    addChild(node){node.parent=this;this.children.push(node);}
    addComponent(Type){const c=new Type();c.node=this;this.components.set(Type,c);return c;}
    getComponent(Type){return this.components.get(Type)||null;}
    setPosition(x,y){this.position={x,y};} setScale(x,y){this.scale={x,y};}
    on(event,fn){listeners.add(fn);} off(event,fn){listeners.delete(fn);}
}
class UITransform {setContentSize(width,height){this.width=width;this.height=height;}setAnchorPoint(){}}
class Graphics {commands=[];clear(){this.commands=[];}}
for(const name of ['moveTo','lineTo','close','fill','stroke','rect','roundRect','circle','bezierCurveTo'])
    Graphics.prototype[name]=function(...args){this.commands.push([name,...args]);};
class Label {static HorizontalAlign={CENTER:1};static VerticalAlign={CENTER:1};static Overflow={CLAMP:1};}
class Button {static EventType={CLICK:'click'};static Transition={SCALE:1};interactable=true;}
class BlockInputEvents {enabled=true;}
class UIOpacity {opacity=255;}
class Color {constructor(r,g,b,a){Object.assign(this,{r,g,b,a});}}
const cc={Component,Node,UITransform,Graphics,Label,Button,BlockInputEvents,UIOpacity,Color,
    sys:{getSafeAreaRect:()=>safe},view:{getVisibleSize:()=>visible,on:(e,f)=>listeners.add(f),off:(e,f)=>listeners.delete(f)},
    _decorator:{ccclass:()=>C=>C,property:()=>{}}};
const source=fs.readFileSync(path.resolve(__dirname,'../../assets/scripts/common/ReconnectLogic.ts'),'utf8');
const mod={exports:{}};
new Function('require','module','exports','performance',ts.transpileModule(source,{compilerOptions:{
    target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,experimentalDecorators:true}}).outputText)(
    id=>id==='cc'?cc:id.endsWith('EventMgr')?{EventMgr:{emit:(...args)=>emitted.push(args)}}:{LogicEvent:{enterLogin:'login'}},mod,mod.exports,{now:()=>clock});
function fixture(){const root=new Node('Canvas'),n=new Node('Reconnect');root.addChild(n);const c=n.addComponent(mod.exports.default);c.onLoad();return c;}
function advance(c,ms){clock+=ms;c.update(0);}
const c=fixture();
c.showReconnecting({attempt:1,maxAttempts:3,retryDelayMs:3000});advance(c,200);
assert.equal(c.status.string,'重连中');assert.equal(c.opacity.opacity,255);
assert.equal(c.mask.getComponent(BlockInputEvents).enabled,true);
assert.equal(c.retryButton.active,false);
const before=JSON.stringify(c.motion.commands);advance(c,150);assert.notEqual(JSON.stringify(c.motion.commands),before,'UI 实时时钟驱动动效，即便游戏 dt=0');
const elapsed=c.elapsed;c.showReconnecting({attempt:2,maxAttempts:3});
assert.equal(c.elapsed,elapsed);assert.equal(c.opacity.opacity,255,'下一次重试不闪黑重新入场');
console.log('PASS 等待态只留一行状态，动效持续且重试不重复淡入');
c.showSuccess();advance(c,200);c.showReconnecting();advance(c,800);
assert.equal(c.node.active,true);assert.equal(c.status.string,'重连中','旧成功淡出不能关闭新重连');
c.showSuccess();advance(c,700);assert.equal(c.node.active,false);
console.log('PASS 恢复后自动淡出，快速再次断线不被旧动画关闭');
c.showFailed();advance(c,200);assert.equal(c.retryButton.active,true);
c.onReturnLogin();c.onReturnLogin();assert.equal(emitted.length,1,'重复点击只返回登录一次');
c.showReconnecting();assert.equal(c.retryButton.active,false);c.hideNow();assert.equal(c.node.active,false);
console.log('PASS 失败态与关闭清理，隐藏遮罩不留在界面上');
for(const profile of [{w:1280,h:720},{w:2560,h:1080},{w:1024,h:768},{w:390,h:844,top:47,bottom:34},
    {w:844,h:390,left:44,right:44},{w:320,h:280}]){
    visible={width:profile.w,height:profile.h};safe={x:profile.left||0,y:profile.bottom||0,
        width:profile.w-(profile.left||0)-(profile.right||0),height:profile.h-(profile.top||0)-(profile.bottom||0)};
    c.showFailed();
    assert.equal(c.mask.getComponent(UITransform).width,profile.w);
    for(const node of [c.emblem,c.status.node,c.retryButton]){
        const ui=node.getComponent(UITransform),x=c.visual.position.x+node.position.x+visible.width/2,
            y=c.visual.position.y+node.position.y+visible.height/2;
        assert.ok(x-ui.width/2>=safe.x&&x+ui.width/2<=safe.x+safe.width,'horizontal safe bounds');
        assert.ok(y-ui.height/2>=safe.y&&y+ui.height/2<=safe.y+safe.height,'vertical safe bounds');
    }
    assert.equal(c.retryButton.getComponent(UITransform).height,44);
}
c.hideNow();c.onDestroy();assert.equal(listeners.has(c.layout),false);
console.log('PASS 横竖屏、超宽屏和安全区布局；销毁清理尺寸监听');
