// Creator main process: run(typescript, electron.nativeImage). Uses actual source PNGs.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
exports.run=function(ts,nativeImage){
 const cache=new Map(),profiles=JSON.parse(fs.readFileSync(path.join(root,'assets/resources/world/player-city-ground.json'),'utf8'));
 class SpriteFrame {refs=0;addRef(){this.refs++;}decRef(){this.refs--;}}
 class Material {props={};initialize(options){this.options=options;}setProperty(k,v){this.props[k]=v;}destroy(){this.destroyed=true;}}
 class Vec4 {constructor(x,y,z,w){Object.assign(this,{x,y,z,w});}}
 const cc={SpriteFrame,Material,Vec4};
 function load(name){
  if(cache.has(name))return cache.get(name);
  const m={exports:{}},file=path.join(root,'assets/scripts',name+'.ts');
  const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
  assert.equal(compiled.diagnostics.length,0,name);
  new Function('require','module','exports',compiled.outputText)(id=>id==='cc'?cc:load(path.relative(path.join(root,'assets/scripts'),path.resolve(path.dirname(file),id)).replaceAll('\\','/')),m,m.exports);
  cache.set(name,m.exports);return m.exports;
 }
 const Model=load('map/PlayerCityAppearance'),Ground=load('map/PlayerCityGround').default;
 const {fitPlayerCityArt}=load('map/PlayerCityArtFit'),{cityArtPoint}=load('map/CityArtFit');
 assert.equal(Model.playerCityArt(10),'player-city-grid-10-wall-v2','十级主城使用校正围墙后的阶段外观');
 Ground.profiles=profiles;Ground.effect={name:'test-effect'};
 assert.equal(profiles.length,31);assert.equal(Model.PLAYER_CITY_ANCHOR_Y,.5);
 let opaque=0,clipped=0,vertices=0;const report=[];
 for(let level=0;level<=30;level++){
  const art=Model.playerCityAppearance(level),p=profiles.find(profile=>profile.art===art.art);
  assert.ok(p,'每个等级都需要找到对应阶段的占格标定');const fit=fitPlayerCityArt(p);
  const visible=q=>fit.roof
   ? Math.abs(q.x)<=.5 && q.y>=Math.abs(q.x)-.5 && q.y<=fit.roof.y+fit.roof.height/2
   : Math.abs(q.x)+Math.abs(q.y)<=.5;
  if(p.tileBounds?.canvasAligned){
   assert.equal(p.width,2*p.height,'城图画布与 2:1 地图格保持相同投影比例');
   assert.equal(fit.forward[0],-fit.forward[4],'城图不得沿某一轴单独拉伸');
   if(p.tileBounds.groundAligned){
    const left=cityArtPoint(fit.forward,p.tileBounds.left/p.width,0);
    const right=cityArtPoint(fit.forward,p.tileBounds.right/p.width,0);
    assert.ok(Math.abs(left.x+.496)<1e-10&&Math.abs(right.x-.496)<1e-10,'左右地基应接近格线，不能因塔楼再次缩小');
    assert.ok(fit.roof.height>1,'高于占地的屋顶必须有独立画布空间');
   }
  }
  const image=nativeImage.createFromPath(path.join(root,'assets/resources/ui/world',p.art+'.png'));
  assert.ok(!image.isEmpty());assert.deepEqual(image.getSize(),{width:p.width,height:p.height});
  const pixels=image.toBitmap();let total=0,lost=0;
  // The visible body must fit before clipping: the shader must not achieve this by amputating roofs.
  for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){
   if(pixels[(y*p.width+x)*4+3]<192)continue;
   const q=cityArtPoint(fit.forward,(x+.5)/p.width,(y+.5)/p.height);
   total++;if(!visible(q))lost++;
  }
  opaque+=total;clipped+=lost;
  assert.ok(lost/total<.001,p.art+' 不得通过裁掉城墙屋顶来凑占地');
  const m=fit.forward, coverage=2*total*Math.abs(m[0]*m[4]-m[1]*m[3])/(p.width*p.height);
  if(p.art==='player-city-lv10-courtyard-v6')assert.ok(coverage>.88,'重绘主城自身须覆盖至少88%的九格菱形，不能靠宽铺地掩盖缩小的城图：'+coverage);
  for(let x=p.left;x<=p.right;x++){
   for(const y of [p.ground[x],p.ceiling[x]]){
    const source={x:x/p.width,y:1-y/p.height},q=cityArtPoint(fit.forward,source.x,source.y),back=cityArtPoint(fit.inverse,q.x,q.y);
    assert.ok(visible(q),p.art+' 地脚不能越过前方格线，屋顶必须在绘制范围内');
    assert.ok(Math.hypot(back.x-source.x,back.y-source.y)<1e-10,'正反投影一致');vertices++;
   }
   const top=cityArtPoint(fit.forward,x/p.width,.2),middle=cityArtPoint(fit.forward,x/p.width,.5),bottom=cityArtPoint(fit.forward,x/p.width,.8);
   assert.equal(top.x,bottom.x,'门柱保持竖直');
   assert.ok(Math.abs((top.y+bottom.y)/2-middle.y)<1e-10,'墙柱上下采用同一比例，无局部压缩');
  }
  for(const [tw,th] of [[200,100],[200,125],[256,128],[240,90]]){
   const a=Model.playerCityAppearance(level,tw,th),layout=Ground.layout(a,3*th);
   assert.deepEqual(Model.playerCityFootprint(tw,th),{width:3*tw,height:3*th});
   assert.equal(layout.width,3*tw);
   assert.equal(layout.height,3*th*(fit.roof?.height??1));
   assert.equal(layout.x,0);assert.equal(layout.y,3*th*(fit.roof?.y??0));
   assert.ok(Math.abs(layout.y-layout.height/2+1.5*th)<1e-10,'扩展画布仅向上增加，前方地脚不下移');
   assert.equal(layout.top,layout.y+layout.height/2);
   const ambient=Ground.ambientLayout(a);
   assert.equal(ambient.width,3*tw);assert.equal(ambient.height,3*th,'人物坐标仍以真实占格换算');
   // 完整绘制矩形上的采样位置，必须与人物使用的占格投影重合。
   for(const [u,v] of [[.2,.3],[.5,.5],[.7,.7]]){
    const q=cityArtPoint(fit.forward,u,v);
    const renderU=q.x+.5,renderV=.5-(q.y-(fit.roof?.y??0))/(fit.roof?.height??1);
    const wx=(renderU-.5)*layout.width+layout.x,wy=(.5-renderV)*layout.height+layout.y;
    assert.ok(Math.abs(wx-q.x*ambient.width)<1e-9&&Math.abs(wy-q.y*ambient.height)<1e-9,'屋顶画布扩展不能使小人脱离道路');
   }
  }
  const entrance=Ground.entrance(level);
  assert.ok(Number.isFinite(entrance.x)&&Number.isFinite(entrance.y));
  assert.ok(Math.abs(Math.max(Math.abs(entrance.x),Math.abs(entrance.y))-1.52)<1e-8,'出兵点不能落进九格内部');
  const texture={name:p.art},sprite={spriteFrame:{texture,trimmed:true}};
  Ground.apply(sprite,p.art);
  assert.deepEqual(sprite.customMaterial.props.cityRender,new Vec4(1,fit.roof?.height??1,0,fit.roof?.y??0));
  assert.equal(sprite.customMaterial.props.cityUvX.w,fit.roof?1:0,'只对地基标定的新图开放上方屋顶');
  if(p.art.startsWith('player-city-grid-'))assert.deepEqual(sprite.customMaterial.props.cityTone,new Vec4(.94,.66,.16,1),'六阶段统一降低饱和度和高光，透明处继续透出地图地面');
  assert.equal(sprite.spriteFrame.texture,texture,'投影帧共用纹理');
  assert.equal(sprite.spriteFrame.packable,false);assert.equal(sprite.trim,false);
  const other={spriteFrame:{texture}};Ground.apply(other,p.art);
  assert.equal(sprite.customMaterial,other.customMaterial,'同等级共享材质');
  assert.equal(sprite.spriteFrame,other.spriteFrame,'同等级共享完整画布帧');
  const oldFrame=sprite.spriteFrame,oldMaterial=sprite.customMaterial;
  Ground.releaseArt(p.art);assert.equal(oldFrame.refs,0);assert.equal(oldMaterial.destroyed,true);
  const reloaded={spriteFrame:{texture:{name:p.art+'-reloaded'}}};Ground.apply(reloaded,p.art);
  assert.notEqual(reloaded.spriteFrame,oldFrame,'流式重载不能引用已经释放的纹理');
  Ground.releaseArt(p.art);
  report.push({level,art:p.art,m:fit.forward,retained:1-lost/total,coverage,roof:fit.roof});
 }
 // 相邻主城的地面占格不能重叠，屋顶绘制高度不参与地面占格。
 for(const [dx,dy] of [[3,0],[-3,0],[0,3],[0,-3],[3,3]])for(let y=-.49;y<.5;y+=.01)for(let x=-.49;x<.5;x+=.01){
  if(Math.abs(x)+Math.abs(y)>=.5)continue;
  const nx=x-(dx-dy)/6,ny=y+(dx+dy)/6;
  assert.ok(Math.abs(nx)+Math.abs(ny)>=.5-1e-9,'邻城渲染区不得叠压');
 }
 if(process.env.CITY_FIT_REPORT)fs.writeFileSync(path.join(root,'temp/player-city-fit-draft.json'),JSON.stringify(report,null,2));
 return {images:31,tileSizes:4,opaquePixels:opaque,clippedPixels:clipped,footprintVertices:vertices,retained:1-clipped/opaque};
};
