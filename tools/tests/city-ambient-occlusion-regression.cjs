// Building depth and open-road fixtures in original city-art coordinates.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require(process.argv[2]);
const root=path.resolve(__dirname,'../..'),cache=new Map();
function load(file){file=path.resolve(root,'assets/scripts',file.endsWith('.ts')?file:file+'.ts');if(cache.has(file))return cache.get(file);const m={exports:{}};cache.set(file,m.exports);const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});assert.equal(compiled.diagnostics.length,0);new Function('require','module','exports',compiled.outputText)(id=>load(path.resolve(path.dirname(file),id)),m,m.exports);return m.exports;}
const {CityAmbientOcclusion,CITY_AMBIENT_OCCLUDERS}=load('map/CityAmbientOcclusion');
const {CITY_AMBIENT_LAYOUTS}=load('map/CityAmbientRoutes');
assert.deepEqual(Object.keys(CITY_AMBIENT_OCCLUDERS).sort(),Object.keys(CITY_AMBIENT_LAYOUTS).sort(),'每种有动态人物的城图都配置遮挡');
for(const [key,polygons] of Object.entries(CITY_AMBIENT_OCCLUDERS))for(const p of polygons){
 assert.ok(p.length>=3,key);
 assert.ok(p.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&x<=1040&&y>=0&&y<=650),key+' 轮廓坐标必须属于原画');
}
const liang=new CityAmbientOcclusion(499,114),yizhou=new CityAmbientOcclusion(166,307);
const hidden=(map,x,y,previous=false)=>map.hides(x/1040,y/520,previous);
assert.equal(hidden(liang,300,160),true,'新版议事堂屋顶遮住人物');
assert.equal(hidden(liang,600,280),false,'新版围栏操练场是开放地面');
assert.equal(hidden(liang,480,285),false,'主街正常显示');
assert.equal(hidden(yizhou,400,100),true,'益州重檐主殿遮挡');
for(const [x,y] of [[420,238],[450,269],[504,299],[590,354]])assert.equal(hidden(yizhou,x,y),false,'台阶及街道不被旧图轮廓遮住');
// 用固定方形独立验证算法边缘滞回，不把旧图的屋檐坐标当作通用规则。
const edge=new CityAmbientOcclusion(0,0,[[[100,100],[200,100],[200,200],[100,200]]]);
assert.equal(edge.hides(150/1040,98/650),false,'屋檐外侧不提前隐藏');
assert.equal(edge.hides(150/1040,98/650,true),true,'已隐藏的人物保留少量出檐缓冲');
assert.equal(edge.hides(150/1040,95/650,true),false,'离开缓冲区及时显示');
assert.equal(liang.hides(NaN,.5),true,'无效位置不渲染');
assert.equal(new CityAmbientOcclusion(0,0).hides(.5,.5),false,'未知城图不套用其他城的轮廓');
console.log('PASS 十城新版遮挡配置、屋顶、开放操练场、街道台阶及屋檐边缘滞回');

