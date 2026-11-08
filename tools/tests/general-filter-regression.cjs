// 执行真实筛选、列表控制器和原生控件布局；协议只记录调用，不修改玩家数据。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ts = require(process.argv[2]), root = path.resolve(__dirname, '../..'), scripts = path.join(root, 'assets/scripts');
let visible = {width: 1280, height: 720}, queries = 0, troopQueries = 0;
class Component { isValid = true; }
class UITransform { width = 0; height = 0; setContentSize(w,h) {this.width=w;this.height=h;} setAnchorPoint() {} }
class Node {
    static EventType = { TOUCH_END: 'touch-end' };
    constructor(name='') {this.name=name;this.children=[];this.components=new Map();this.events=new Map();this.active=true;this.layer=1;this.position={x:0,y:0};this.isValid=true;}
    get activeInHierarchy() {return this.active&&(!this.parent||this.parent.activeInHierarchy);}
    addChild(n) {n.parent=this;this.children.push(n);}
    getChildByName(name) {return this.children.find(n=>n.name===name)||null;}
    getChildByPath(p) {return p.split('/').reduce((n,k)=>n?.getChildByName(k),this);}
    addComponent(Type) {const c=new Type();c.node=this;this.components.set(Type,c);return c;}
    getComponent(Type) {return this.components.get(Type)||null;}
    getComponentInChildren(Type) {return this.getComponent(Type)||this.children.map(n=>n.getComponentInChildren(Type)).find(Boolean)||null;}
    setPosition(x,y) {this.position={x,y};} setScale() {}
    setSiblingIndex(i) {if(!this.parent)return;const a=this.parent.children;a.splice(a.indexOf(this),1);a.splice(i,0,this);}
    on(event,fn,target) {this.events.set(event,{fn,target});} off(event) {this.events.delete(event);}
    emit(event,...args) {const e=this.events.get(event);e?.fn.apply(e.target,args);}
    click() {assert.ok(this.activeInHierarchy);assert.notEqual(this.getComponent(Button)?.interactable,false);this.emit('click');}
}
class Label {static HorizontalAlign={LEFT:0,CENTER:1,RIGHT:2};static VerticalAlign={CENTER:1};static Overflow={CLAMP:1,SHRINK:2};}
class Button {static EventType={CLICK:'click'};static Transition={SCALE:1};interactable=true;}
class Graphics {clear(){} roundRect(){} rect(){} moveTo(){} lineTo(){} fill(){} stroke(){}}
class Sprite {static Type={SIMPLE:1};static SizeMode={CUSTOM:1};}
class Color {constructor(r,g,b,a){Object.assign(this,{r,g,b,a});}}
class ScrollView {stopAutoScroll(){this.stops=(this.stops||0)+1;}}
class List {setData(data,offset,relayout){this.data=data;this.offset=offset;this.relayout=relayout;} refreshLayout(){this.layouts=(this.layouts||0)+1;}}
const cc={Component,Node,UITransform,Label,Button,Graphics,Sprite,Color,ScrollView,Widget:class{},BlockInputEvents:class{},
    Mask:class{static Type={GRAPHICS_RECT:0};},
    view:{getVisibleSize:()=>visible,on(){},off(){}},_decorator:{ccclass:()=>v=>v,property:()=>()=>{}}};
const heroConfig=JSON.parse(fs.readFileSync(path.join(root,'assets/resources/config/Hero.json'),'utf8'));
const heroes=Object.values(heroConfig).map((row,i)=>({hero_type:row.Id,level:20+i%31,config:{name:row.name,campText:row.Camp,
    quality:row.Quality,star:row.Star,heroClass:row.Class,sort:row.Sort}}));
const assigned=new Set([heroes.find(h=>h.config.campText==='魏').hero_type,heroes.find(h=>h.config.campText==='蜀').hero_type]);
const stubs={
    'general/GeneralCommand':{default:{getInstance:()=>({isProtocolAvailable:()=>false,qryMyGenerals(){queries++;},
        proxy:{getMyActiveGeneralCnt:()=>heroes.length,getUseGenerals:()=>heroes.slice()}})}},
    'general/TroopCommand':{default:{getInstance:()=>({requestTroops(){troopQueries++;},
        proxy:{getAssignedHeroIds:()=>assigned,isHeroInTroop:id=>assigned.has(id)}})}},
    'utils/ListLogic':{default:List},'common/AudioManager':{AudioManager:{instance:{playClick(){}}}},
    'common/BgLogic':{default:class{}},
};
const cache=new Map();
function load(name){
    name=name.replace(/\\/g,'/');if(stubs[name])return stubs[name];if(cache.has(name))return cache.get(name);
    const file=path.join(scripts,name+'.ts'),mod={exports:{}};cache.set(name,mod.exports);
    const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,experimentalDecorators:true},reportDiagnostics:true});
    assert.equal(compiled.diagnostics.length,0);
    new Function('require','module','exports',compiled.outputText)(id=>id==='cc'?cc:load(path.relative(scripts,path.resolve(path.dirname(file),id))),mod,mod.exports);
    cache.set(name,mod.exports);return mod.exports;
}
const F=load('general/GeneralRosterFilter');
{
    const original=JSON.stringify(heroes),state={...F.defaultGeneralFilters(),camp:'魏',quality:5,role:'战士'};
    const got=F.filterGenerals(heroes,state,id=>assigned.has(id));
    assert.ok(got.length>0);assert.deepEqual(got.map(h=>h.hero_type).sort(),heroes.filter(h=>h.config.campText==='魏'&&h.config.quality===5&&h.config.heroClass==='战士').map(h=>h.hero_type).sort());
    assert.equal(JSON.stringify(heroes),original,'筛选排序不能原地修改共享武将快照');
    assert.equal(F.filterGenerals(heroes,{...state,quality:2},()=>false).length,0);
    console.log('PASS 真实武将配置交叉筛选、空结果及源数据不可变');
}
{
    const sample=[{hero_type:9,level:20,config:{quality:3,sort:1,name:'乙'}},{hero_type:8,level:1,config:{quality:5,sort:2,name:'甲'}},
        {hero_type:7,level:50,config:{quality:3,sort:3,name:'丙'}}];
    const selected=new Set([9]),filter=sort=>F.filterGenerals(sample,{...F.defaultGeneralFilters(),sort},id=>selected.has(id));
    assert.deepEqual(filter('default').map(h=>h.hero_type),[9,8,7]);
    assert.deepEqual(filter('quality').map(h=>h.hero_type),[8,7,9]);
    assert.deepEqual(filter('level').map(h=>h.hero_type),[7,9,8]);
    assert.deepEqual(F.filterGenerals(sample,{...F.defaultGeneralFilters(),assigned:'assigned'},id=>selected.has(id)).map(h=>h.hero_type),[9]);
    assert.deepEqual(F.filterGenerals(sample,{...F.defaultGeneralFilters(),assigned:'idle'},id=>selected.has(id)).map(h=>h.hero_type),[8,7]);
    console.log('PASS 默认保留上阵优先，品质/等级排序按选择生效，上阵状态来自部队');
}
function node(parent,name,w=1,h=1){const n=new Node(name);n.addComponent(UITransform).setContentSize(w,h);parent?.addChild(n);return n;}
const page=node(null,'GeneralList'),content=node(page,'New Node');
for(const name of ['titleLab','cntLab','New Label'])node(content,name).addComponent(Label);
for(const name of ['New Button','tujianBtn','convertBtn']){const b=node(content,name);b.addComponent(Button);const bg=node(b,'Background');bg.addComponent(Sprite);node(bg,'Label').addComponent(Label);}
const scrollNode=node(content,'New ScrollView'),viewport=node(scrollNode,'view');node(viewport,'content');
const scroll=scrollNode.addComponent(ScrollView),list=scrollNode.addComponent(List);
list.itemPrefab={data:node(null,'Card',350,480)};
const logic=page.addComponent(load('map/ui/GeneralListLogic').default);logic.scrollView=scroll;logic.cntLab=content.getChildByName('cntLab').getComponent(Label);
logic.onLoad();logic.setData([],0);
const entry=()=>content.getChildByName('GeneralFilterButton');
const popup=()=>content.getChildByName('GeneralFilterPopup');
const panel=()=>popup().getChildByName('FilterPanel');
const groups=()=>panel().getChildByPath('Body/Viewport/Content');
const open=()=>{if(!popup().active)entry().click();assert.equal(popup().active,true);};
const choose=(key,label)=>{open();const group=groups().getChildByName('Group_'+key);
    const row=group.children.find(n=>n.active&&n.name.startsWith('Option')&&n.getChildByName('Text')?.getComponent(Label).string===label);
    assert.ok(row,label);row.click();assert.equal(popup().active,true,'修改条件时保持筛选框打开');};
const apply=()=>{panel().getChildByName('Apply').click();assert.equal(popup().active,false);};
const q=queries,tq=troopQueries;
choose('camp','魏');choose('quality','2品');
assert.equal(list.data.length,50,'未点确定不改变列表');
logic.initGeneralCfg();assert.equal(popup().active,true,'服务器同步不能关闭筛选框或清除草稿');
apply();
assert.equal(list.data.length,0);assert.equal(content.getChildByName('RosterHint').getComponent(Label).string,'暂无符合条件的武将');
assert.equal(logic.cntLab.string,'(50/100)','筛选结果不能冒充拥有数量或容量');
assert.equal(content.getChildByName('FilterResult').getChildByName('Text').getComponent(Label).string,'筛选结果  0 / 50');
open();panel().getChildByName('Reset').click();assert.equal(list.data.length,0);apply();assert.equal(list.data.length,50);
assert.equal(entry().getChildByName('Text').getComponent(Label).string,'筛选');
assert.equal(content.getChildByName('RosterHint').active,false);
assert.equal(queries,q);assert.equal(troopQueries,tq);assert.equal(list.offset,undefined,'改筛选从顶部重新显示');
console.log('PASS 左下角筛选框多条件确定、重置、空态、后台同步保留草稿，不额外请求协议');
choose('camp','魏');choose('assigned','已上阵');apply();
assert.ok(list.data.every(h=>assigned.has(h.hero_type)&&h.config.campText==='魏'));
logic.initGeneralCfg();assert.equal(list.offset,0,'协议更新保持滚动位置');
logic.onDisable();logic.setData([],0);assert.equal(logic._filters.camp,'魏','重开同一界面保留筛选');
logic.setData([],1,2);
assert.equal(logic._filters.camp,'');assert.ok(list.data.every(h=>!assigned.has(h.hero_type)&&h.listType===1&&h.listPosition===2));
open();assert.equal(groups().getChildByName('Group_assigned').active,false,'上阵选择不展示无法满足的已上阵筛选');
choose('quality','5品');apply();assert.ok(list.data.every(h=>h.config.quality===5&&!assigned.has(h.hero_type)));
console.log('PASS 编队选将保持排除规则和槽位，切换上下文不沿用无效状态');
logic.setData([],0);
for(const [width,height] of [[1280,720],[812,375],[375,812],[320,568]]){
    visible={width,height};logic.onCanvasResize();const layout=F.generalRosterLayout(width,height);
    const viewUI=scrollNode.getComponent(UITransform);
    assert.ok(scrollNode.position.y+viewUI.height/2<=layout.headerBottom-19,'标题下方直接显示卡片，不占用顶部筛选栏');
    assert.ok(scrollNode.position.y-viewUI.height/2>=-height/2+78-.01);
    const b=entry(),bu=b.getComponent(UITransform);assert.ok(b.position.x<0&&b.position.y<0);
    assert.ok(Math.abs(b.position.x)+bu.width/2<=layout.bodyWidth/2+.01);assert.ok(bu.height>=44);
    assert.ok(!content.getChildByName('GeneralFilters'),'不得保留顶部展开的筛选栏');
    open();const menu=panel(),ui=menu.getComponent(UITransform);
    assert.ok(Math.abs(menu.position.x)+ui.width/2<=width/2);assert.ok(Math.abs(menu.position.y)+ui.height/2<=height/2);
    const body=menu.getChildByName('Body'),bodyUI=body.getComponent(UITransform);
    assert.ok(bodyUI.height>0);assert.ok(menu.getChildByName('Apply').position.y+22<=body.position.y-bodyUI.height/2);
    for(const group of groups().children.filter(n=>n.active))for(const option of group.children.filter(n=>n.active&&n.name.startsWith('Option'))){
        const ou=option.getComponent(UITransform);assert.ok(ou.height>=44);assert.ok(Math.abs(option.position.x)+ou.width/2<=bodyUI.width/2+.01);
    }
    if(width===812||width===320)assert.equal(body.getComponent(ScrollView).enabled,true,'短屏/小屏筛选内容可以滚动');
    choose('camp','吴');const saved=JSON.stringify(logic._filters);
    popup().emit(Node.EventType.TOUCH_END,{target:popup()});assert.equal(popup().active,false);
    assert.equal(JSON.stringify(logic._filters),saved,'点空白取消草稿');
    open();assert.equal(logic._filterBar.draft.camp,logic._filters.camp);panel().getChildByName('Close').click();
}
console.log('PASS 横竖屏左下角入口、筛选面板边界、内容滚动和确定按钮，点空白取消草稿');
console.log('All 5 general filter groups passed.');
