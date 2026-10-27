// Verify motion continuity and actual pose variety independently of Cocos rendering.
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const ts=require(process.argv[2]),mod={exports:{}};
const source=fs.readFileSync(path.resolve(__dirname,'../../assets/scripts/map/ui/PaintedBattleMotion.ts'),'utf8');
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS}}).outputText,
    {exports:mod.exports,module:mod,Float32Array});
const {PAINTED_CLIPS,MOTION_SAMPLES,MOTION_CHANNELS,samplePaintedMotion}=mod.exports;
const n=MOTION_CHANNELS.length,a=new Float32Array(n),b=new Float32Array(n);
assert.equal(Object.keys(PAINTED_CLIPS).length,13);
for(const [name,clip]of Object.entries(PAINTED_CLIPS)){
    assert.equal(clip.frames.length,30,name+' has 30 poses');
    const distinct=new Set(clip.frames.map(f=>Array.from(f).map(v=>v.toFixed(4)).join(','))).size;
    assert.ok(distinct>=(clip.loop?30:29),name+' only permits matching rest poses at the two endpoints');
    assert.ok(clip.frames.every(f=>f.length===n&&Array.from(f).every(Number.isFinite)));
    for(let i=0;i<120;i++){
        samplePaintedMotion(name,clip.duration*i/119,a);
        assert.ok(Array.from(a).every(Number.isFinite));
        const distance=Math.hypot(a[8]-12,a[9]-65);
        assert.ok(distance<33.5,name+' weapon grip stays within arm reach');
    }
    if(clip.loop){
        samplePaintedMotion(name,clip.duration-.00001,a);samplePaintedMotion(name,clip.duration+.00001,b);
        assert.ok(a.every((v,i)=>Math.abs(v-b[i])<.02),name+' loop seam is continuous');
    }else{
        samplePaintedMotion(name,clip.duration,a);samplePaintedMotion(name,clip.duration*3,b);
        assert.deepEqual(a,b,name+' holds its final pose');
    }
    if(clip.impact){
        samplePaintedMotion(name,clip.duration*clip.impact,a);
        if(name==='shoot')assert.ok(a[8]>24&&a[13]===0,'ranged impact follows release with the bow still aimed');
        else if(name==='slash')assert.ok(a[8]>28&&a[13]===0,'dao strike uses one hand, leaving the other on the shield');
        else assert.ok(a[8]>26&&a[13]>.9,name+' impact occurs at extended two-handed strike');
    }
}
samplePaintedMotion('fall',PAINTED_CLIPS.fall.duration,a);
assert.ok(a[16]>80&&a[17]<.7,'fall settles on the ground');
// Sampling twice at the same clock must be deterministic (pause/replay and speed controls).
samplePaintedMotion('attack',.385,a);samplePaintedMotion('attack',.385,b);assert.deepEqual(a,b);
console.log('PASS 13 motions × 30 samples, no padded poses, interpolation, grip reach, spear/dao/bow timing and fall');
