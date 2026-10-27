// Skill presentation consumes recorded outcomes; it must not manufacture hits.
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const ts=require(process.argv[2]),mod={exports:{}};
const source=fs.readFileSync(path.resolve(__dirname,'../../assets/scripts/map/ui/PaintedSkillCue.ts'),'utf8');
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS}}).outputText,
    {exports:mod.exports,module:mod,require(name){
        assert.equal(name,'./PaintedSkillCatalog');const catalog={exports:{}};
        const source=fs.readFileSync(path.resolve(__dirname,'../../assets/scripts/map/ui/PaintedSkillCatalog.ts'),'utf8');
        vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS}}).outputText,
            {exports:catalog.exports,module:catalog});return catalog.exports;
    }});
const {paintedSkillCue,skillEnvelope,skillProgress}=mod.exports;
assert.equal(paintedSkillCue(null),null);
assert.equal(paintedSkillCue({actType:1,skillId:1001}),null,'normal attack has no skill banner');
const action={actType:2,skillId:1001,fromSide:1,fromPos:1,effects:[
    {targetSide:2,targetPos:3,flags:1},{targetSide:2,targetPos:1,flags:0},
    {targetSide:2,targetPos:2,flags:2},{targetSide:2,targetPos:2,flags:4},
    {targetSide:9,targetPos:1,flags:0}]};
const before=JSON.stringify(action),cue=paintedSkillCue(action,{Name:'无双乱舞'});
assert.equal(cue.name,'无双乱舞');assert.equal(cue.source,'1:1');assert.equal(cue.major,true);
assert.equal(cue.style.family,'cleave');
assert.equal(paintedSkillCue({...action,skillId:1018}).style.family,'fire');
assert.equal(paintedSkillCue({...action,skillId:1017,actType:5}).style.intent,'buff');
assert.equal(cue.targets.length,3);assert.equal(cue.targets[0].critical,true);
assert.equal(cue.targets[1].hit,true);assert.equal(cue.targets[2].hit,false);
assert.equal(cue.targets[2].critical,false);assert.equal(JSON.stringify(action),before,'presentation never edits combat data');
assert.equal(paintedSkillCue({...action,actType:6}).kind,'restore');
assert.equal(paintedSkillCue({...action,actType:5}).kind,'ward');
assert.equal(skillProgress(-1,0,1),0);assert.equal(skillProgress(3,0,1),1);
assert.equal(skillEnvelope(.5,1,.2,.3,.4),0);
assert.equal(skillEnvelope(1.3,1,.2,.3,.4),1);
assert.equal(skillEnvelope(2,1,.2,.3,.4),0);
for(let time=0;time<3;time+=.01){
    const value=skillEnvelope(time,.3,.2,.4,.5);
    assert.ok(value>=0&&value<=1);assert.equal(value,skillEnvelope(time,.3,.2,.4,.5),'pause and seek are deterministic');
}
console.log('PASS skill targets, misses, criticals, read-only report and deterministic effect timing');
