// 按材质逆变换采样真实 PNG：四条边必须连续铺满，不能只看四个最远像素。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const ts = require(process.argv[2]), root = path.resolve(__dirname,'../..'), cache = new Map();
function load(name) {
    if (cache.has(name)) return cache.get(name);
    const module = {exports:{}};
    const code = ts.transpileModule(fs.readFileSync(path.join(root,'assets/scripts/map',name+'.ts'),'utf8'),
        {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
    new Function('require','module','exports',code)(id=>load(id.slice(2)),module,module.exports);
    cache.set(name,module.exports); return module.exports;
}
function pixels(file) {
    const png = fs.readFileSync(file), width = png.readUInt32BE(16), height = png.readUInt32BE(20), blocks=[];
    assert.equal(png[24],8); assert.equal(png[25],6,'实际城图为 RGBA8'); assert.equal(png[28],0);
    for (let p=8;p<png.length;) {const n=png.readUInt32BE(p);if(png.toString('ascii',p+4,p+8)==='IDAT')blocks.push(png.subarray(p+8,p+8+n));p+=12+n;}
    const data=zlib.inflateSync(Buffer.concat(blocks)), stride=width*4, rgba=Buffer.alloc(height*stride);
    function paeth(a,b,c) {const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
    for(let y=0;y<height;y++) {
        const input=y*(stride+1), filter=data[input]; assert.ok(filter<=4);
        for(let x=0;x<stride;x++) {
            const i=y*stride+x,a=x>=4?rgba[i-4]:0,b=y?rgba[i-stride]:0,c=y&&x>=4?rgba[i-stride-4]:0;
            const add=filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?paeth(a,b,c):0;
            rgba[i]=(data[input+1+x]+add)&255;
        }
    }
    return {width,height,rgba};
}
const F=load('CityFootprint'), {cityArtToSource,cityArtToFootprint}=load('CityArtFit');
const {systemCityHit,systemCityCoversCell}=load('SystemCityGeometry');
const cities=JSON.parse(fs.readFileSync(path.join(root,'assets/resources/world/campaign-map.json'),'utf8')).cities;
let count=0; const report=[], failures=[];
function sample(image,u,v) {
    const {width,height,rgba}=image, x=u*width-.5,y=v*height-.5,ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
    const a=(x,y)=>x<0||y<0||x>=width||y>=height?0:rgba[(y*width+x)*4+3];
    return (a(ix,iy)*(1-fx)+a(ix+1,iy)*fx)*(1-fy)+(a(ix,iy+1)*(1-fx)+a(ix+1,iy+1)*fx)*fy;
}
for(const city of cities) {
    const art=F.cityArtAsset(city.level,city), near=pixels(path.join(root,'assets/resources/ui/world',art+'.png'));
    const layout=F.cityArtLayout(city.level,near.width,near.height,200,125,city);
    const sources=[{art,image:near}];
    if(F.cityOverviewUsesNearProjection(city)) {const art=F.cityOverviewAsset(city.level,city);sources.push({art,image:pixels(path.join(root,'assets/resources/ui/world',art+'.png'))});}
    for(const {art,image} of sources) {
        if(layout.fit.roof) {
            assert.deepEqual(layout.fit.forward,layout.fit.upperForward,'墙体上下使用同一变换，避免接缝和压扁');
            const roof=layout.fit.roof, top=roof.height/2+roof.y, bottom=-roof.height/2+roof.y;
            assert.ok(Math.abs(bottom+.5)<1e-10,'扩展画布不能移动前墙地面边界');
            assert.ok(top>.5,'后侧塔顶需要额外显示空间');
            const tower=cityArtToFootprint(layout.fit,.5,.035);
            assert.ok(tower.y>.5 && tower.y<top,'后角楼顶部不能被后侧占地线裁掉');
            const uv=cityArtToSource(layout.fit,tower.x,tower.y);
            assert.ok(sample(image,uv.x,uv.y)>224,'近远景真实角楼顶部存在');
            assert.equal(systemCityHit(tower.x*layout.width,tower.y*layout.height,city.level,200,city,125),false,
                '露出的角楼不能截获相邻格点击');
            const radius=city.footprintRadius;
            for(let y=-radius-1;y<=radius+1;y++)for(let x=-radius-1;x<=radius+1;x++)
                assert.equal(systemCityCoversCell(x,y,city.level,200,125,city),Math.abs(x)<=radius&&Math.abs(y)<=radius,'换图保持地图原有占地');
        }
        const alpha=(x,y)=>{if(Math.abs(x)+Math.abs(y)>.5)return 0;const uv=cityArtToSource(layout.fit,x,y);return sample(image,uv.x,uv.y);};
        let opaque=0,total=0;
        for(let y=-.48;y<=.48;y+=.004)for(let x=-.48;x<=.48;x+=.004) {
            if(Math.abs(x)+Math.abs(y)>.48)continue;
            total++;if(alpha(x,y)>=240)opaque++;
        }
        const corners=[[-.5,0],[0,.5],[.5,0],[0,-.5]], edges=[];
        for(let edge=0;edge<4;edge++) {
            const a=corners[edge],b=corners[(edge+1)%4];let covered=0,longest=0,gap=0,maxInset=0;
            for(let n=1;n<100;n++) {
                const t=n/100,x=a[0]*(1-t)+b[0]*t,y=a[1]*(1-t)+b[1]*t;
                if(alpha(x*.97,y*.97)>=224){covered++;gap=0;}else{gap++;longest=Math.max(longest,gap);}
                let inset=0;while(inset<.2&&alpha(x*(1-inset),y*(1-inset))<224)inset+=.002;
                maxInset=Math.max(maxInset,inset);
                assert.equal(alpha(x*1.01,y*1.01),0,'占地外必须透明');
            }
            edges.push({coverage:covered/99,longestGap:longest,maxInset});
        }
        const coverage=opaque/total;count+=total;
        if(coverage<.995||edges.some(e=>e.coverage<.98||e.longestGap>2))failures.push({art,coverage,edges});
        report.push({name:city.name,art,span:city.footprintRadius*2+1,layout,coverage,edges});
    }
}
if(process.argv[3]&&!process.argv[3].startsWith('--'))fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2));
assert.deepEqual(failures,[],'城基内圈和四条边不允许长段透明空白');
console.log(`PASS ${report.length} 张真实近/远景，${count} 次双线性采样，内圈覆盖至少99.5%，四边连续铺满；新图后侧塔顶保留且不扩张点击占地`);
