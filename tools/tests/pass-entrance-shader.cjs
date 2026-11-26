// Generate an offline GPU check from the actual Creator-imported effect, without starting Preview.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const meta=JSON.parse(fs.readFileSync(path.join(root,'assets/resources/effects/world-landscape.effect.meta'),'utf8'));
const effect=JSON.parse(fs.readFileSync(path.join(root,'library',meta.uuid.slice(0,2),meta.uuid+'.json'),'utf8'));
if(!effect.shaders[1].glsl3.frag.includes('mountainAlpha'))throw Error('Effect import has not completed');
function gpuCheck(shaders){
 const assert=(v,msg)=>{if(!v)throw Error(msg)},results=[];
 const compile=(gl,type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);assert(gl.getShaderParameter(s,gl.COMPILE_STATUS),gl.getShaderInfoLog(s));return s};
 for(const mode of ['webgl','webgl2']){
  const gl=document.createElement('canvas').getContext(mode);assert(gl,mode+' unavailable');
  for(const shader of shaders)compile(gl,gl.FRAGMENT_SHADER,(mode==='webgl2'?'#version 300 es\n':'#version 100\n')+'#define CC_USE_EMBEDDED_ALPHA 0\n'+shader[mode==='webgl2'?'glsl3':'glsl1'].frag);
  results.push(mode+' '+shaders.length+' effect passes compile');
 }
 const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
 const gl=canvas.getContext('webgl2',{premultipliedAlpha:false,antialias:false});
 document.body.appendChild(canvas);
 const data=new Uint8Array(8*8*4);
 for(let i=0;i<64;i++){data[i*4+1]=255;data[i*4+3]=255;}
 function tex(unit,w,h,bytes){
  gl.activeTexture(gl.TEXTURE0+unit);const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return t;
 }
 const terrain=tex(0,8,8,data);tex(1,1,1,new Uint8Array([150,165,110,255]));tex(2,1,1,new Uint8Array([65,92,88,255]));tex(3,1,1,new Uint8Array([150,165,110,255]));
 const vertex='#version 300 es\nprecision highp float;in vec2 position;out vec2 uv0;out vec2 mapPoint;out vec4 color;uniform float tileHeight;void main(){uv0=position*.5+.5;vec2 grid=vec2(4.)+position*.75;mapPoint=vec2((grid.x-grid.y)*100.,(7.-grid.x-grid.y)*tileHeight*.5);color=vec4(1.);gl_Position=vec4(position,0.,1.);}';
 function program(shader,block,tileHeight){
  const p=gl.createProgram();gl.attachShader(p,compile(gl,gl.VERTEX_SHADER,vertex));gl.attachShader(p,compile(gl,gl.FRAGMENT_SHADER,'#version 300 es\n#define CC_USE_EMBEDDED_ALPHA 0\n'+shader.glsl3.frag));gl.linkProgram(p);assert(gl.getProgramParameter(p,gl.LINK_STATUS),gl.getProgramInfoLog(p));gl.useProgram(p);
  const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const a=gl.getAttribLocation(p,'position');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
  gl.uniform1f(gl.getUniformLocation(p,'tileHeight'),tileHeight);
  for(const [name,unit]of [['riverTexture',0],['cc_spriteTexture',1],['waterTexture',2],['groundTexture',3]])gl.uniform1i(gl.getUniformLocation(p,name),unit);
  const ubo=gl.createBuffer();gl.bindBuffer(gl.UNIFORM_BUFFER,ubo);
  gl.bufferData(gl.UNIFORM_BUFFER,new Float32Array(block==='MapMetrics'?[8,8,200,tileHeight]:[8,8,200,tileHeight,1600,8*tileHeight,0,0]),gl.STATIC_DRAW);
  gl.uniformBlockBinding(p,gl.getUniformBlockIndex(p,block),0);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,ubo);return p;
 }
 function render(flag){
  data[(4*8+4)*4+2]=flag;gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,terrain);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,8,8,gl.RGBA,gl.UNSIGNED_BYTE,data);
  gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,6);
  const pixels=new Uint8Array(256*256*4);gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,pixels);assert(gl.getError()===gl.NO_ERROR,'GPU draw error');return pixels;
 }
 for(const height of [100,125])for(const flag of [64,96,128,160]){
  program(shaders[1],'MapMetrics',height);
  const intact=render(0),hard=render(255),soft=render(flag);let gradients=0,maxStep=0;
  const alpha=(pixels,x,y)=>pixels[(y*256+x)*4+3],xAxis=flag<112,sign=flag===96||flag===160?-1:1;
  const coords=(x,y)=>{const dx=((x+.5)/256*2-1)*.75,dy=((y+.5)/256*2-1)*.75;return {along:(xAxis?dx:dy)*sign,across:xAxis?dy:dx}};
  assert(alpha(soft,128,128)===0,'pass centre must remain open');
  assert(alpha(intact,128,128)===255&&alpha(hard,128,128)===0,'control flags');
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
   const {along,across}=coords(x,y),a=alpha(soft,x,y);
   if(Math.abs(along)>=.5||Math.abs(across)>=.3)assert(a===255,'outer terrain and both shoulders must stay intact');
   if(along>-.49&&along<.1&&Math.abs(across)<.08)assert(a===0,'corridor must connect all the way to the gate');
   if(a>0&&a<255)gradients++;
   // The inner edge joins ground already covered by the gate image; check all exposed edges.
   if(x&&along>-.48&&coords(x-1,y).along>-.48)maxStep=Math.max(maxStep,Math.abs(a-alpha(soft,x-1,y)));
   if(y&&along>-.48&&coords(x,y-1).along>-.48)maxStep=Math.max(maxStep,Math.abs(a-alpha(soft,x,y-1)));
  }
  assert(gradients>4000&&maxStep<30,'exposed corridor edges must blend smoothly');
  program(shaders[0],'Landscape',height);
  const natural=render(0),pass=render(flag),city=render(255);let trailPixels=0;
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
   const px=((x+.5)/256-.5)*1600,row=3.5+((y+.5)/256-.5)*8;
   const dx=row+px/200-4,dy=row-px/200-4,across=xAxis?dy:dx;
   const i=(y*256+x)*4,changed=natural[i]!==pass[i]||natural[i+1]!==pass[i+1]||natural[i+2]!==pass[i+2];
   if(changed)trailPixels++;
   if(dx<-.5||dx>=.5||dy<-.5||dy>=.5||Math.abs(across)>=.3)assert(!changed,'trail cannot tint the surrounding mountain or grass');
  }
  assert(trailPixels>20&&trailPixels<800,'earth-colour transition must remain a narrow path');
  assert(natural.some((n,i)=>n!==city[i]),'urban ground still has a separate hard-fill mode');
  results.push({tileHeight:height,direction:flag,gradientPixels:gradients,maxAdjacentAlphaStep:maxStep,trailPixels});
 }
 const fringe=new Uint8Array(256*4);
 for(let x=0;x<256;x++)fringe.set([200,190,70,x],x*4);
 tex(1,256,1,fringe);program(shaders[3],'MapMetrics',125);
 const blended=render(0),at=x=>Array.from(blended.slice((128*256+x)*4,(128*256+x)*4+4));
 assert(at(0)[3]===0&&at(255)[3]===255,'feather must preserve transparent and solid endpoints');
 assert(at(255).slice(0,3).join() === '200,190,70','solid peaks must preserve original lighting');
 assert(at(100)[0]<190&&at(100)[2]>80,'semi-transparent yellow fringe must blend toward map grass');
 for(let x=1;x<256;x++)assert(at(x)[3]>=at(x-1)[3],'no alpha seams in the edge transition');
 program(shaders[1],'MapMetrics',125);const clipped=render(0);
 assert(clipped.every((v,i)=>v===blended[i]),'normal and city-edge mountain materials must match outside clear cells');
 results.push('mountain edge: solid lighting retained, ground tone blended, alpha continuous, shared clipping consistent');
 return results;
}
const html='<!doctype html><meta charset="utf-8"><pre id="result">RUNNING</pre><script>try{const result=('+gpuCheck.toString()+')('+JSON.stringify(effect.shaders)+');document.getElementById("result").textContent="PASS "+JSON.stringify(result);}catch(e){document.getElementById("result").textContent="FAIL "+e.stack;}</script>';
fs.writeFileSync(path.resolve(process.argv[2]||path.join(root,'temp/pass-entrance-shader.html')),html);
console.log('Offline GPU regression page ready');
