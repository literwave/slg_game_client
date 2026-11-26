// Offline composition of real map assets and Creator-compiled shaders; does not run the game.
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const terrain=read('assets/resources/world/original-landscape.json'),campaign=read('assets/resources/world/campaign-map.json'),sizes=read('assets/resources/world/art-sizes.json');
const gate=campaign.gates.find(g=>g.name==='潼关');if(!gate)throw Error('潼关 missing');
const effectMeta=read('assets/resources/effects/world-landscape.effect.meta');
const after=read('library/'+effectMeta.uuid.slice(0,2)+'/'+effectMeta.uuid+'.json'),before=read('temp/pass-before-directional.effect.json');
const tw=200,th=125,cx=(gate.x-gate.y)*tw/2,cy=(terrain.height-1-gate.x-gate.y)*th/2;
const nearCell=id=>Math.abs(id%terrain.width-gate.x)<24&&Math.abs(Math.floor(id/terrain.width)-gate.y)<24;
const patches=terrain.patches.map(p=>({...p,px:(p.x-p.y)*tw/2,py:(terrain.height-1-p.x-p.y)*th/2,drawHeight:p.width*sizes[p.art][1]/sizes[p.art][0]*(p.heightScale||1)*1.25}))
 .filter(p=>Math.abs(p.px-cx)<700+p.width/2&&Math.abs(p.py-cy)<450+p.drawHeight).sort((a,b)=>b.py-a.py);
const config={width:terrain.width,height:terrain.height,gate,cx,cy,tw,th,patches,riverCells:terrain.riverCells.filter(nearCell),mountainCells:terrain.mountainCells.filter(nearCell),bridgeWaterCells:(terrain.bridgeWaterCells||[]).filter(nearCell)};
async function review(config,before,after){
 const fail=s=>{throw Error(s)},W=800,H=560,halfHeight=400,halfWidth=halfHeight*W/H;
 const names=[...new Set(['plains','water','mountain-pass-revamp-v7',...config.patches.map(p=>p.art)])],images={};
 await Promise.all(names.map(n=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>{images[n]=im;resolve()};im.onerror=()=>reject(Error('Image missing '+n));im.src='../assets/resources/ui/world/'+n+'.png'})));
 const vertex='#version 300 es\nprecision highp float;in vec2 position;in vec2 texcoord;in vec2 world;out vec2 uv0;out vec2 mapPoint;out vec4 color;void main(){uv0=texcoord;mapPoint=world;color=vec4(1.);gl_Position=vec4(position,0.,1.);}';
 for(const [label,effect,modern]of [['修改前：圆形渐变草斑',before,false],['修改后：沿门方向衔接',after,true]]){
  const box=document.createElement('section'),title=document.createElement('h2');title.textContent=label;box.appendChild(title);
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;box.appendChild(canvas);document.getElementById('views').appendChild(box);
  const gl=canvas.getContext('webgl2',{antialias:false,alpha:false,preserveDrawingBuffer:true});if(!gl)fail('No WebGL2');
  const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))fail(gl.getShaderInfoLog(s));return s};
  const programs={};
  const surfaceW=(config.width+config.height)*config.tw/2+8000,surfaceH=(config.width+config.height)*config.th/2+8000;
  function program(name,fragment,block){
   const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))fail(gl.getProgramInfoLog(p));gl.useProgram(p);
   gl.uniform1i(gl.getUniformLocation(p,'riverTexture'),0);gl.uniform1i(gl.getUniformLocation(p,'cc_spriteTexture'),1);gl.uniform1i(gl.getUniformLocation(p,'waterTexture'),2);
   let ubo=null;if(block){ubo=gl.createBuffer();gl.bindBuffer(gl.UNIFORM_BUFFER,ubo);gl.bufferData(gl.UNIFORM_BUFFER,new Float32Array(block==='Landscape'?[config.width,config.height,config.tw,config.th,surfaceW,surfaceH,0,0]:[config.width,config.height,config.tw,config.th]),gl.STATIC_DRAW);gl.uniformBlockBinding(p,gl.getUniformBlockIndex(p,block),0);}
   return programs[name]={p,ubo,locations:['position','texcoord','world'].map(k=>gl.getAttribLocation(p,k))};
  }
  const prefix='#version 300 es\n#define CC_USE_EMBEDDED_ALPHA 0\n';
  program('ground',prefix+effect.shaders[0].glsl3.frag,'Landscape');program('mountain',prefix+effect.shaders[1].glsl3.frag,'MapMetrics');
  program('sprite','#version 300 es\nprecision highp float;in vec2 uv0;uniform sampler2D cc_spriteTexture;out vec4 outputColor;void main(){outputColor=texture(cc_spriteTexture,uv0);}');
  function texture(unit,image,w,h,bytes){gl.activeTexture(gl.TEXTURE0+unit);const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);if(image)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return t;}
  const mask=new Uint8Array(config.width*config.height*4);
  for(const id of [...config.riverCells,...config.bridgeWaterCells])mask[id*4]=255;
  for(const id of config.mountainCells)mask[id*4+1]=255;
  for(const entry of config.gate.attackEntrances){const along=config.gate.axis==='x'?entry.x-config.gate.x:entry.y-config.gate.y;mask[(entry.y*config.width+entry.x)*4+2]=modern?(config.gate.axis==='x'?64:128)+(along<0?32:0):128;}
  const terrainTexture=texture(0,null,config.width,config.height,mask),textures={};
  for(const n of names)textures[n]=texture(1,images[n]);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,terrainTexture);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,textures.water);
  const buffer=gl.createBuffer();
  function quad(programName,textureName,left,bottom,right,top,flip=false,ground=false){
   const info=programs[programName];gl.useProgram(info.p);if(info.ubo)gl.bindBufferBase(gl.UNIFORM_BUFFER,0,info.ubo);
   gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,textures[textureName]);
   const points=[[left,bottom,flip?1:0,1],[right,bottom,flip?0:1,1],[left,top,flip?1:0,0],[left,top,flip?1:0,0],[right,bottom,flip?0:1,1],[right,top,flip?0:1,0]];
   const floats=points.flatMap(([x,y,u,v])=>[(x-config.cx)/halfWidth,(y-config.cy)/halfHeight,ground?x/surfaceW+.5:u,ground?.5-y/surfaceH:v,x,y]);
   gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(floats),gl.STREAM_DRAW);
   for(let i=0;i<3;i++){const a=info.locations[i];if(a>=0){gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,24,i*8)}}
   gl.drawArrays(gl.TRIANGLES,0,6);
  }
  gl.viewport(0,0,W,H);gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);
  quad('ground','plains',config.cx-halfWidth,config.cy-halfHeight,config.cx+halfWidth,config.cy+halfHeight,false,true);
  for(const p of config.patches){const bottom=p.py-p.drawHeight*(p.anchorY??.22);quad('mountain',p.art,p.px-p.width/2,bottom,p.px+p.width/2,bottom+p.drawHeight,!!p.flipX);}
  const gateW=600,gateH=gateW*853/1280*.89*1.25,bottom=config.cy-gateH*.466;
  quad('sprite','mountain-pass-revamp-v7',config.cx-gateW/2,bottom,config.cx+gateW/2,bottom+gateH,config.gate.axis==='x');
  if(gl.getError()!==gl.NO_ERROR)fail('Composition GL error');
 }
 document.getElementById('status').textContent='DONE · 实际素材与导入材质的离线对比（非游戏截图）';
}
const html='<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#252922;color:#ded8c7;font:16px sans-serif}h2{margin:12px;font-size:18px}#status{padding:10px}#views{display:flex;gap:8px}canvas{display:block}</style><div id="status">Loading</div><div id="views"></div><script>('+review.toString()+')('+[config,before,after].map(v=>JSON.stringify(v)).join(',')+').catch(e=>document.getElementById("status").textContent="FAIL "+e.stack)</script>';
fs.writeFileSync(path.join(root,'temp/pass-entrance-review.html'),html);
console.log('Prepared '+patches.length+' actual mountain patches for offline visual comparison');
