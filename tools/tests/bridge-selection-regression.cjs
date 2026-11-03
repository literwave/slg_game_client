// 执行真实桥关选框与图层逻辑，不连接服务器、不发送行军指令。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ts = require(process.argv[2]), root = path.resolve(__dirname, '../..');
class Component { unscheduleAllCallbacks() {} unschedule() {} scheduleOnce(cb) {this.scheduled=cb;} }
class UITransform { width = 200; height = 100; setContentSize(w,h) { this.width=w; this.height=h; } }
class Node {
    constructor(name='') { this.name=name; this.children=[]; this.components=new Map(); this.active=true; this.isValid=true; this.layer=4; this.worldPosition={x:37,y:91,z:0}; this.worldScale={x:1,y:1,z:1}; }
    get parent() {return this._parent;}
    set parent(value) { if(this._parent) this._parent.children.splice(this.getSiblingIndex(),1); this._parent=value; if(value) value.children.push(this); }
    get activeInHierarchy() {return this.active && (!this.parent || this.parent.activeInHierarchy);}
    setParent(p) {this.parent=p;} addChild(n) {n.parent=this;} removeFromParent() {this.parent=null;}
    setPosition(x,y,z=0) {this.worldPosition={x,y,z};} setScale(x,y,z=1) {this.worldScale={x,y,z};}
    getChildByName(name) {return this.children.find(n=>n.name===name);}
    addComponent(Type) {const c=new Type();c.node=this;this.components.set(Type,c);return c;}
    getComponent(Type) {return this.components.get(Type);}
    getSiblingIndex() {return this.parent?.children.indexOf(this) ?? -1;}
    setSiblingIndex(i) {const p=this.parent;p.children.splice(this.getSiblingIndex(),1);p.children.splice(i,0,this);}
    setWorldPosition(v) {this.worldPosition={...v};} setWorldScale(v) {this.worldScale={...v};}
    destroy() {this.isValid=false;this.parent=null;}
}
class Graphics { points=[]; strokes=[]; clear() {this.points=[];this.strokes=[];} moveTo(x,y) {this.points.push([x,y]);} lineTo(x,y) {this.points.push([x,y]);} stroke() {this.strokes.push({width:this.lineWidth,points:[...this.points]});this.points=[];} close() {} fill() {} }
class Color { constructor(r,g,b,a) {Object.assign(this,{r,g,b,a});} }
const cc={_decorator:{ccclass:()=>v=>v,property:()=>()=>{}},Component,Node,UITransform,Graphics,Color,UIOpacity:class {}};
const config=JSON.parse(fs.readFileSync(path.join(root,'assets/resources/world/campaign-map.json'),'utf8'));
let selectedGate=null, released=0;
cc.Label=class {};cc.Label.HorizontalAlign={CENTER:1};cc.Camera=class {};cc.view={getVisibleSize:()=>({height:720})};
const cache={};
function load(name) {
    if(cache[name]) return cache[name];
    const mod={exports:{}}, file=path.join(root,'assets/scripts/map',name+'.ts');
    const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,experimentalDecorators:true},reportDiagnostics:true});
    assert.equal(code.diagnostics.length,0,name);
    const imports={
        cc, './WorldCampaign':{default:{config,gateAt:()=>selectedGate}},
        './MapProxy':{MapResType:{SYS_CITY:51}}, './MapCityProxy':{MapCityData:class {}},
        '../utils/EventMgr':{EventMgr:{emit(){},on(){},targetOff(){}}},
        '../common/LogicEvent':{LogicEvent:{}},
        './ui/ManagementStyle':{inkSurface:(parent,name,w,h)=>load('TileHighlight').tileInk(parent,name,w,h),
            caption(parent,name) {const node=new Node(name);parent.addChild(node);return{node};}},
        './MapUtil':{default:{tileSize:{width:200,height:100},mapCellToPixelPoint:p=>({x:p.x*100,y:p.y*50})}},
    };
    new Function('require','module','exports',code.outputText)(key=>{
        if(key in imports) return imports[key];
        if(['./BridgeSilhouette','./GateGeometry','./TileHighlight'].includes(key)) return load(key.slice(2));
        return {};
    },mod,mod.exports);
    return cache[name]=mod.exports;
}
const Popup=load('MapClickUILogic').default, popup=new Popup();
const world=new Node('World'), touch=new Node('touch'), army=new Node('armyNode');
for(const name of ['mapNode','resNode','LandTerritories','MountainRanges','WorldGateLandmarks','WorldMarchGround','resBuildNode','sysCityNode','roleCityNode','WorldDepthActors']) world.addChild(new Node(name));
world.addChild(army);world.addChild(touch);world.components.set('MapArmyLogic',{parentLayer:army});
popup.node=new Node('SelectionRoot');touch.addChild(popup.node);
popup.bgSelect=new Node('bgSelect');popup.node.addChild(popup.bgSelect);popup.bgSelect.addComponent(UITransform);
popup.attachDock=()=>true;popup._panel=new Node('Panel');popup._sidebar={isValid:true,releaseTilePanel(){released++;}};
popup.bgMain={active:false};popup.labelMian={string:''};
for(const gate of [null,config.gates.find(g=>g.crossing==='bridge'),config.gates.find(g=>g.crossing==='pass'),null]) {
    selectedGate=gate; popup._data={x:1,y:2,type:gate?50:0};popup.selectionKey='';
    for(const zoom of [.533,1.25,4.444]) {
        popup.placeGroundSelection();popup.refreshSelection(zoom);
        assert.equal(popup.bgSelect.parent,world);
        assert.ok(popup.bgSelect.getSiblingIndex()>world.getChildByName('resNode').getSiblingIndex(),'资源仍可辨识');
        for(const name of ['MountainRanges','WorldGateLandmarks','resBuildNode','WorldDepthActors']) assert.ok(popup.bgSelect.getSiblingIndex()<world.getChildByName(name).getSiblingIndex(),name+'遮住地面选框');
        assert.deepEqual(popup.bgSelect.worldPosition,popup.node.worldPosition);
        const index=popup.bgSelect.getSiblingIndex();popup.placeGroundSelection();assert.equal(popup.bgSelect.getSiblingIndex(),index,'重复更新不能改变层序');
        if(gate) {
            const ink=popup.bgSelect.getChildByName('GateSelection').getComponent(Graphics);
            assert.equal(ink.strokes.length,2);
            assert.equal(ink.strokes[0].points.length,gate.crossing==='bridge'?15:9);
            for(const stroke of ink.strokes) for(let i=0;i<stroke.points.length;i+=3) {
                const [a,b,c]=stroke.points.slice(i,i+3);
                for(const p of [a,c]) assert.ok(Math.hypot(p[0]-b[0],p[1]-b[1])/zoom<=18.001,'放大后角标不能占满桥面');
            }
        } else {
            assert.equal(popup.bgSelect.getChildByName('SelectionOutline').active,true);
            assert.equal(popup.bgSelect.getChildByName('GateSelection')?.active ?? false,false,'切回空地不残留桥关角标');
        }
    }
}
popup.onDisable();assert.equal(popup.bgSelect.active,false);assert.equal(popup._panel.active,false);assert.ok(released>0);
popup._data={type:0};popup.node.active=true;popup.onEnable();assert.equal(popup.bgSelect.active,true);
popup.onDestroy();assert.equal(popup.bgSelect.isValid,false,'销毁选框不能遗留在独立地面层');
console.log('PASS 桥关/陆关/空地切换、3 档缩放、地面遮挡、重复层序更新、关闭/复用/销毁');
