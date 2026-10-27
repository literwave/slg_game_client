const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const ts=require(process.argv[2]),root=path.resolve(__dirname,'../..'),cache=new Map();
function load(name){
    if(cache.has(name))return cache.get(name);
    const mod={exports:{}};cache.set(name,mod.exports);
    const source=fs.readFileSync(path.join(root,'assets/scripts/map/ui',name+'.ts'),'utf8');
    vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS}}).outputText,
        {exports:mod.exports,module:mod,require:n=>load(n.replace('./',''))});return mod.exports;
}
const heroes=Object.values(JSON.parse(fs.readFileSync(path.join(root,'assets/resources/config/Hero.json'),'utf8')));
const skills=JSON.parse(fs.readFileSync(path.join(root,'assets/resources/config/Skill.json'),'utf8'));
const {paintedHero,PAINTED_HERO_IDS}=load('PaintedHeroCatalog'),{PAINTED_HERO_REGIONS}=load('PaintedHeroRegions');
const {paintedSkillStyle,PAINTED_SKILL_IDS}=load('PaintedSkillCatalog');
assert.deepEqual(Array.from(PAINTED_HERO_IDS).sort((a,b)=>a-b),heroes.map(h=>h.Id).sort((a,b)=>a-b));
assert.deepEqual(Array.from(PAINTED_SKILL_IDS).sort((a,b)=>a-b),skills.map(s=>s.Id).sort((a,b)=>a-b));
const assetPaths=new Set();
for(const row of heroes){
    const hero=paintedHero(row.Id);assert.ok(hero,`missing hero ${row.Id}`);
    assetPaths.add(hero.asset);
    const file=path.join(root,'assets/resources/ui/battle_replay/painted',hero.asset+'.png');
    assert.ok(fs.existsSync(file),`missing sprite ${hero.name}`);
    const png=fs.readFileSync(file),width=png.readUInt32BE(16),height=png.readUInt32BE(20);
    if(row.Id!==1001){
        const parts=PAINTED_HERO_REGIONS[row.Id];assert.equal(parts.length,10);
        for(const [x,y,w,h]of parts){assert.ok(x>=0&&y>=0&&w>0&&h>0&&x+w<=width&&y+h<=height,`invalid cut ${hero.name}`);}
        // A merged alpha component must not silently become a giant head/hand.
        assert.ok(parts[1][2]<width*.4&&parts[1][3]<height*.43,`merged head ${hero.name}`);
        assert.ok(parts[5][3]<height*.34,`merged hand ${hero.name}`);
    }
}
assert.equal(assetPaths.size,heroes.length,'every hero has an independent drawing');
const families=new Set();
for(const row of skills){
    const style=paintedSkillStyle(row.Id);assert.ok(style,`missing skill ${row.Id}`);
    assert.ok(style.element>=0&&style.element<12);assert.ok(style.tint.every(n=>n>=0&&n<=255));families.add(style.family);
}
assert.equal(families.size,12);
assert.equal(paintedSkillStyle(1018).family,'fire');assert.equal(paintedSkillStyle(1008).family,'lightning');
assert.equal(paintedSkillStyle(1017).family,'wisdom');assert.equal(paintedSkillStyle(1011).intent,'debuff');
assert.equal(paintedHero(999999),null);assert.equal(paintedSkillStyle(999999),null);
console.log(`PASS ${heroes.length} independent hero atlases, bounded cuts and ${skills.length} skills across ${families.size} visual families`);
