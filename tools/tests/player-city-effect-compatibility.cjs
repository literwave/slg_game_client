// Run in Creator main process after AssetDB imports the effect; exercises its compiled shader output.
const assert=require('node:assert/strict'),fs=require('node:fs');
exports.run=async function(importedEffectFile){
 const effect=JSON.parse(fs.readFileSync(importedEffectFile,'utf8'));
 assert.equal(effect.__type__,'cc.EffectAsset');assert.equal(effect.techniques.length,1);
 const shader=effect.shaders[0];assert.ok(shader.glsl1?.frag&&shader.glsl3?.frag,'必须有两种 WebGL 编译产物');
 const {BrowserWindow}=require('electron'),window=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
 try{
  await window.loadURL('about:blank');
  return await window.webContents.executeJavaScript(`(()=>{
   const shader=${JSON.stringify(shader)},results=[];
   for(const mode of ['webgl1-derivatives','webgl1-basic','webgl2']){
    const canvas=document.createElement('canvas'),gl=canvas.getContext(mode==='webgl2'?'webgl2':'webgl');
    if(!gl)throw Error(mode+' context unavailable');
    if(mode==='webgl1-derivatives'&&!gl.getExtension('OES_standard_derivatives'))throw Error('Derivative test requires extension');
    let source=(mode==='webgl2'?'#version 300 es\\n':'#version 100\\n')+(mode==='webgl2'?shader.glsl3.frag:shader.glsl1.frag);
    // Simulate a device without the extension macro, even when this GPU supports it.
    if(mode==='webgl1-basic')source=source.replaceAll('GL_OES_standard_derivatives','CITY_TEST_NO_DERIVATIVES');
    const fragment=gl.createShader(gl.FRAGMENT_SHADER);gl.shaderSource(fragment,source);gl.compileShader(fragment);
    if(!gl.getShaderParameter(fragment,gl.COMPILE_STATUS))throw Error(mode+': '+gl.getShaderInfoLog(fragment));
    results.push({mode,compiled:true});gl.deleteShader(fragment);gl.getExtension('WEBGL_lose_context')?.loseContext();
   }
   return results;
  })()`);
 }finally{window.destroy();}
};
