// Real project textures and Creator-imported shaders, composed offline; no game/server state.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../..'), stage = path.resolve(process.argv[2] || path.join(root, 'temp/mountain-natural-review'));
const afterTitle = process.argv[3] || '修改后：错落山脊、统一光照、山脚融合';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const before = read(path.join(stage, 'before-landscape.json'));
const after = read(path.join(stage, 'after-landscape.json'));
const campaign = read(path.join(root, 'assets/resources/world/campaign-map.json'));
const sizes = read(path.join(root, 'assets/resources/world/art-sizes.json'));
const meta = read(path.join(root, 'assets/resources/effects/world-landscape.effect.meta'));
const effects = [read(path.join(stage, 'before-effect.json')), read(path.join(root, 'library', meta.uuid.slice(0,2), meta.uuid+'.json'))];

async function renderReview(config, effects) {
    const W=800,H=560,halfHeight=config.halfHeight,halfWidth=halfHeight*W/H;
    const images={}, names=[...new Set(['plains','water','mountain-pass-revamp-v7',...config.versions.flatMap(v=>v.patches.map(p=>p.art))])];
    await Promise.all(names.map(name=>new Promise((resolve,reject)=>{
        const image=new Image();image.onload=()=>{images[name]=image;resolve()};image.onerror=()=>reject(Error('Missing '+name));
        image.src='../../assets/resources/ui/world/'+name+'.png';
    })));
    const assert=(value,message)=>{if(!value)throw Error(message)};
    const vertex='#version 300 es\nprecision highp float;in vec2 position;in vec2 texcoord;in vec2 world;out vec2 uv0;out vec2 mapPoint;out vec4 color;void main(){uv0=texcoord;mapPoint=world;color=vec4(1.);gl_Position=vec4(position,0.,1.);}';
    for(let version=0;version<2;version++) {
        const section=document.createElement('section'),title=document.createElement('h2');
        title.textContent=version?config.afterTitle:'修改前';section.appendChild(title);
        const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;section.appendChild(canvas);document.getElementById('views').appendChild(section);
        const gl=canvas.getContext('webgl2',{antialias:false,alpha:false,preserveDrawingBuffer:true});assert(gl,'WebGL2 unavailable');
        const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);assert(gl.getShaderParameter(s,gl.COMPILE_STATUS),gl.getShaderInfoLog(s));return s};
        const surfaceW=(config.width+config.height)*config.tw/2+8000,surfaceH=(config.width+config.height)*config.th/2+8000;
        const programs={};
        function program(name,fragment,block) {
            const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(p);assert(gl.getProgramParameter(p,gl.LINK_STATUS),gl.getProgramInfoLog(p));gl.useProgram(p);
            for(const [sampler,unit] of [['riverTexture',0],['cc_spriteTexture',1],['waterTexture',2],['groundTexture',3]])gl.uniform1i(gl.getUniformLocation(p,sampler),unit);
            let ubo=null;if(block){ubo=gl.createBuffer();gl.bindBuffer(gl.UNIFORM_BUFFER,ubo);gl.bufferData(gl.UNIFORM_BUFFER,new Float32Array(block==='Landscape'?[config.width,config.height,config.tw,config.th,surfaceW,surfaceH,0,0]:[config.width,config.height,config.tw,config.th]),gl.STATIC_DRAW);gl.uniformBlockBinding(p,gl.getUniformBlockIndex(p,block),0);}
            programs[name]={p,ubo,locations:['position','texcoord','world'].map(k=>gl.getAttribLocation(p,k))};
        }
        const prefix='#version 300 es\n#define CC_USE_EMBEDDED_ALPHA 0\n';
        program('ground',prefix+effects[version].shaders[0].glsl3.frag,'Landscape');
        program('mountain',prefix+effects[version].shaders[1].glsl3.frag,'MapMetrics');
        program('sprite','#version 300 es\nprecision highp float;in vec2 uv0;uniform sampler2D cc_spriteTexture;out vec4 outputColor;void main(){outputColor=texture(cc_spriteTexture,uv0);}');
        function texture(unit,image,w,h,bytes) {
            gl.activeTexture(gl.TEXTURE0+unit);const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
            if(image)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return t;
        }
        const bytes=new Uint8Array(config.width*config.height*4);
        for(const id of [...config.riverCells,...config.bridgeWaterCells])bytes[id*4]=255;
        for(const id of config.mountainCells)bytes[id*4+1]=255;
        if(config.gate)for(const entry of config.gate.attackEntrances){const along=config.gate.axis==='x'?entry.x-config.gate.x:entry.y-config.gate.y;bytes[(entry.y*config.width+entry.x)*4+2]=(config.gate.axis==='x'?64:128)+(along<0?32:0);}
        const terrain=texture(0,null,config.width,config.height,bytes),textures={};for(const name of names)textures[name]=texture(1,images[name]);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,terrain);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,textures.water);gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,textures.plains);
        const buffer=gl.createBuffer();
        function quad(programName,name,left,bottom,right,top,flip=false,ground=false) {
            const info=programs[programName];gl.useProgram(info.p);if(info.ubo)gl.bindBufferBase(gl.UNIFORM_BUFFER,0,info.ubo);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,textures[name]);
            const points=[[left,bottom,flip?1:0,1],[right,bottom,flip?0:1,1],[left,top,flip?1:0,0],[left,top,flip?1:0,0],[right,bottom,flip?0:1,1],[right,top,flip?0:1,0]];
            const floats=points.flatMap(([x,y,u,v])=>[(x-config.cx)/halfWidth,(y-config.cy)/halfHeight,ground?x/surfaceW+.5:u,ground?.5-y/surfaceH:v,x,y]);
            gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(floats),gl.STREAM_DRAW);
            for(let i=0;i<3;i++){const a=info.locations[i];if(a>=0){gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,24,i*8)}}gl.drawArrays(gl.TRIANGLES,0,6);
        }
        gl.viewport(0,0,W,H);gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);
        quad('ground','plains',config.cx-halfWidth,config.cy-halfHeight,config.cx+halfWidth,config.cy+halfHeight,false,true);
        for(const p of config.versions[version].patches){const bottom=p.py-p.drawHeight*(p.anchorY??.22);quad('mountain',p.art,p.px-p.width/2,bottom,p.px+p.width/2,bottom+p.drawHeight,!!p.flipX);}
        if(config.gate){const w=600,h=w*853/1280*.89*1.25,bottom=config.cy-h*.466;quad('sprite','mountain-pass-revamp-v7',config.cx-w/2,bottom,config.cx+w/2,bottom+h,config.gate.axis==='x');}
        assert(gl.getError()===gl.NO_ERROR,'GPU composition error');
    }
    document.getElementById('status').textContent='DONE · '+config.label+' · 项目素材与导入材质的离线对比（非游戏截图）';
}

for(const [name,label,x,y,halfHeight] of [['coast','河岸山带',748,473,900],['diagonal','斜向山带',721,839,850],['pass','潼关入口',446,331,500]]) {
    const cx=(x-y)*100,cy=(999-x-y)*62.5;
    const local=id=>Math.abs(id%1000-x)<45&&Math.abs(Math.floor(id/1000)-y)<45;
    const versions=[before,after].map(v=>({patches:v.patches.map(p=>({...p,px:(p.x-p.y)*100+(p.offsetX||0),py:(999-p.x-p.y)*62.5+(p.offsetY||0)*1.25,drawHeight:p.width*sizes[p.art][1]/sizes[p.art][0]*(p.heightScale||1)*1.25}))
        .filter(p=>Math.abs(p.px-cx)<halfHeight*1.5+p.width/2&&Math.abs(p.py-cy)<halfHeight+p.drawHeight).sort((a,b)=>b.py-a.py)}));
    if(versions.some(v=>v.patches.length<3))throw Error('Review target is not in the current mountain layout: '+name);
    const config={label,afterTitle,cx,cy,halfHeight,width:1000,height:1000,tw:200,th:125,versions,gate:campaign.gates.find(g=>g.x===x&&g.y===y),riverCells:after.riverCells.filter(local),bridgeWaterCells:(after.bridgeWaterCells||[]).filter(local),mountainCells:after.mountainCells.filter(local)};
    const html='<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#252922;color:#ded8c7;font:16px sans-serif}h2{margin:12px;font-size:18px}#status{padding:10px}#views{display:flex;gap:8px}canvas{display:block}</style><div id="status">Loading</div><div id="views"></div><script>('+renderReview.toString()+')('+JSON.stringify(config)+','+JSON.stringify(effects)+').catch(e=>document.getElementById("status").textContent="FAIL "+e.stack)</script>';
    fs.writeFileSync(path.join(stage,name+'.html'),html);
}
console.log('Prepared coast, diagonal, pass comparisons.');
