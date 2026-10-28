const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ts = require(process.argv[2]), scripts = path.resolve(__dirname, '../../assets/scripts');
const protocol = { hasId: x => /^[1-9]\d*$/.test(String(x)), idKey: x => x == null ? '0' : String(x) };
function load(name) {
    const code = ts.transpileModule(fs.readFileSync(path.join(scripts, name + '.ts'), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const m = { exports: {} }; new Function('require','module','exports',code)(() => protocol,m,m.exports); return m.exports;
}
// 执行 WorldCommand 的实际查询，避免用 UI stub 掩盖行军时间与占领时间混用。
const file = path.join(scripts, 'world/WorldCommand.ts'), text = fs.readFileSync(file, 'utf8');
const ast = ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
const method = ast.statements.find(ts.isClassDeclaration).members.find(m => m.name?.getText(ast) === 'occupyCountdownAt');
const timer = ts.transpileModule('module.exports=class Timer {' + method.getText(ast) + '}',
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleTimer = { exports: {} }; new Function('module',timer)(moduleTimer);
const query = new moduleTimer.exports(); let land = null;
query.resourceLandAt = () => land;
query.marches = { values: () => [{ state: 2, targetType: 3, startTime: 90, endTime: 130 }] };
assert.equal(query.occupyCountdownAt(10,20,100),null,'已到达的行军时间不能冒充占领倒计时');
land = { startTime: 101, endTime: 121 };
assert.deepEqual(query.occupyCountdownAt(10,20,110),land);
assert.deepEqual(query.occupyCountdownAt(10,20,122),land,'0秒须等待 AOI 时间清零确认');
land = { startTime: 0, endTime: 0 }; assert.equal(query.occupyCountdownAt(10,20,122),null);
land = { startTime: NaN, endTime: Infinity }; assert.equal(query.occupyCountdownAt(10,20,122),null);

const Model = load('world/CampaignFeedback').default, model = new Model();
const mine = '9007199254740993', other = '9007199254740994', pos = { x: 10, y: 20 };
const march = { troopIdx: 2, state: 2, targetType: 3, endPos: pos, startTime: 90, endTime: 100 };
const entity = { entityType: 4, pos, ownerId: 0, startTime: 100, endTime: 120 };
model.sync([entity],[{ ...march,state:1 }],mine,105); assert.equal(model.captures.size,0,'路上不能认领占领任务');
model.sync([entity],[march],mine,105); assert.equal(model.captures.size,1);
assert.equal(model.captures.get('10:20').endTime,120,'用 AOI 占领时间，不能用已经过期的行军时间');
model.sync([], [march],mine,110); assert.equal(model.captures.size,1,'离开视野仍保留自己已知倒计时');
assert.equal(model.notices(121).length,0,'客户端计时走完不会宣告成功');
model.sync([{ ...entity,ownerId:mine,startTime:0,endTime:0 }],[march],mine,122);
assert.equal(model.captures.size,0); assert.equal(model.notices(122)[0].title,'占领完成');
model.sync([{ ...entity,ownerId:mine,startTime:0,endTime:0 }],[march],mine,123);
assert.equal(model.notices(123).length,1,'重复 AOI 不重复提示');
model.clear(); model.sync([{ ...entity,ownerId:other }],[],mine,105); assert.equal(model.captures.size,0);
model.sync([entity],[march],mine,105); model.sync([],[],mine,106); assert.equal(model.captures.size,0,'撤回/改道清理占领提示');
model.sync([entity],[march],mine,105); model.sync([{ ...entity,ownerId:other,startTime:0,endTime:0 }],[march],mine,122);
assert.notEqual(model.notices(122)[0].title,'占领完成','被其他人占领不得显示自己成功');
model.clear();
model.battleStart({ battleId: '9007199254740996', pos },100);
assert.equal(model.notices(100)[0].title,'两军交锋');
model.battleResult({battleId:'9007199254740996',result:1,reportId:'9007199254740997'},null,101);
assert.equal(model.notices(101).length,1); assert.equal(model.notices(101)[0].title,'战斗胜利');
assert.deepEqual(model.notices(101)[0].pos,pos); assert.equal(model.notices(101)[0].reportId,'9007199254740997');
model.battleResult({battleId:'9007199254740996',result:1,reportId:7},null,102);
model.battleStart({battleId:'9007199254740996',pos},102);
assert.equal(model.notices(102).length,1,'旧开始包、重复结果不覆盖已完成状态');
assert.equal(model.notices(114).length,0);
model.battleResult({battleId:8,result:2,reportId:9},null,115);
assert.equal(model.notices(115)[0].title,'战斗失利');
model.clear(); assert.equal(model.notices(116).length,0); assert.equal(model.captures.size,0);
console.log('PASS 占领权威计时、确认后成功、离屏跟踪、撤回清理、战斗提示和去重、断线清理');

const motion = load('map/entries/MarchPose'), out = {};
for (const kind of ['cavalry','infantry']) {
    const unique = new Set();
    for(let i=0;i<30;i++) { motion.sampleMarchPose(kind,i/30*.75,1,out); unique.add(JSON.stringify(out)); }
    assert.equal(unique.size,30,'每循环有30个不同的连续姿态');
    const a = {}; motion.sampleMarchPose(kind,.75-.000001,1,a); motion.sampleMarchPose(kind,.75+.000001,1,out);
    for(const key of Object.keys(a)) assert.ok(Math.abs(a[key]-out[key])<.0001,'循环接缝连续');
    motion.sampleMarchPose(kind,.39,0,out); assert.deepEqual(out,{x:0,y:0,angle:0,stretch:1});
}
console.log('PASS 行军30姿态、循环连续、收步权重归零');
