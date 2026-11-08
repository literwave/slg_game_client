// 只读取图集，生成显示校准数据；不重绘、压缩或覆盖图片。
const fs = require('node:fs'), path = require('node:path');
const { Jimp } = require('../../extensions/cocos-ai-copilot/lib/asset-preview/image-core');
const root = path.resolve(__dirname, '../..');
const round = n => Math.round(n * 10000) / 10000;
const median = a => { const b = [...a].sort((x,y)=>x-y); return (b[3]+b[4])/2; };
async function read(name) {
    const { bitmap: {width, height, data} } = await Jimp.read(path.join(root, 'assets/resources/ui/march', name+'.png'));
    if (width!==1280||height!==1280) throw Error(`Unexpected siege atlas dimensions: ${name}`);
    const frames=[];
    for(let row=0;row<8;row++) for(let col=0;col<8;col++) {
        const pixels=Buffer.alloc(160*160*4), rgb=[0,0,0];let count=0,top=160,bottom=0;
        for(let y=0;y<160;y++)for(let x=0;x<160;x++){
            const src=((row*160+y)*width+col*160+x)*4, dst=(y*160+x)*4;
            data.copy(pixels,dst,src,src+4);
            if(data[src+3]>200){count++;for(let k=0;k<3;k++)rgb[k]+=data[src+k];
                if(x>40&&x<120){top=Math.min(top,y);bottom=Math.max(bottom,y);}}
        }
        frames.push({pixels,rgb:rgb.map(v=>v/count),height:bottom-top});
    }
    return frames;
}
function footPivot(frame) {
    let bottom=0;
    for(let y=104;y<160;y++)for(let x=37;x<123;x++)if(frame.pixels[(y*160+x)*4+3]>200)bottom=Math.max(bottom,y);
    let sum=0,count=0;
    for(let y=Math.max(0,bottom-7);y<=bottom;y++)for(let x=37;x<123;x++)if(frame.pixels[(y*160+x)*4+3]>200){sum+=x;count++;}
    return [(count?sum/count:80)/160,1-(bottom+1)/160];
}
function footError(reference,frame,scale,tx,ty,tint) {
    let error=0,count=0;
    for(let y=116;y<158;y+=2)for(let x=24;x<136;x+=2){
        const sx=Math.round((x-tx)/scale),sy=Math.round((y-ty)/scale);
        const a=(y*160+x)*4,b=(sy*160+sx)*4,inside=sx>=0&&sx<160&&sy>=0&&sy<160;
        const aa=reference.pixels[a+3]/255,ba=inside?frame.pixels[b+3]/255:0;
        if(aa<.2&&ba<.2)continue;
        error+=Math.abs(aa-ba)*.8;
        if(inside)for(let k=0;k<3;k++)error+=Math.min(aa,ba)*Math.abs(reference.pixels[a+k]-frame.pixels[b+k]*tint[k]/255)/255*.2/3;
        count++;
    }
    return count?error/count:1;
}
async function main(){
    const styles={}, report=[];
    for(const unit of ['infantry','commander']){
        const names=[`siege-${unit}-v1`,`siege-${unit}-between-v1`];
        const sheets=await Promise.all(names.map(read)); names.forEach(n=>styles[n]=[]);
        for(let row=0;row<8;row++){
            const base=sheets[0].slice(row*8,row*8+8),between=sheets[1].slice(row*8,row*8+8);
            const reference=base[0],anchor=footPivot(reference);
            const betweenScale=Math.max(.92,Math.min(1.02,median(base.map(f=>f.height))/median(between.map(f=>f.height))));
            let oldError=0,newError=0,rawGap=0,correctedGap=0;
            for(let sheet=0;sheet<2;sheet++)for(let col=0;col<8;col++){
                const frame=sheets[sheet][row*8+col],scale=sheet?betweenScale:1;
                const tint=sheet?frame.rgb.map((v,k)=>Math.min(255,Math.round((base[col].rgb[k]+base[(col+1)%8].rgb[k])*.5/v*255))):[255,255,255];
                const pivot=footPivot(frame),tx0=anchor[0]*160-pivot[0]*160*scale,ty0=(1-anchor[1])*160-(1-pivot[1])*160*scale;
                let best={tx:tx0,ty:ty0,error:footError(reference,frame,scale,tx0,ty0,tint)};
                oldError+=best.error;
                // 固定下腿/马蹄作为配准区域，不能把挥枪和披风动作当成角色根位移。
                if(sheet||col){
                    for(let dy=-6;dy<=6;dy+=2)for(let dx=-14;dx<=14;dx+=2){
                        const error=footError(reference,frame,scale,tx0+dx,ty0+dy,tint)+.00004*(dx*dx+dy*dy);
                        if(error<best.error)best={tx:tx0+dx,ty:ty0+dy,error};
                    }
                    const seed=best;
                    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
                        const tx=seed.tx+dx,ty=seed.ty+dy;
                        const error=footError(reference,frame,scale,tx,ty,tint)+.00004*((tx-tx0)**2+(ty-ty0)**2);
                        if(error<best.error)best={tx,ty,error};
                    }
                }
                newError+=footError(reference,frame,scale,best.tx,best.ty,tint);
                styles[names[sheet]].push({pivot:[round((anchor[0]*160-best.tx)/(160*scale)),round(1-((1-anchor[1])*160-best.ty)/(160*scale))],scale:round(scale),tint});
                if(sheet){const luma=c=>c[0]*.2126+c[1]*.7152+c[2]*.0722;
                    const target=base[col].rgb.map((v,k)=>(v+base[(col+1)%8].rgb[k])*.5);
                    rawGap+=Math.abs(luma(frame.rgb)-luma(target));
                    correctedGap+=Math.abs(luma(frame.rgb.map((v,k)=>v*tint[k]/255))-luma(target));}
            }
            report.push({unit,direction:row,rawLumaGap:round(rawGap/8),correctedLumaGap:round(correctedGap/8),footErrorBefore:round(oldError/16),footErrorAfter:round(newError/16),betweenScale:round(betweenScale)});
        }
    }
    const output='/** 由 tools/art/calibrate-siege-frames.cjs 读取原图生成：统一关键帧/中间帧亮度，按下腿和马蹄对齐；保持等比缩放和透明度。 */\n'
        +'export const SIEGE_FRAME_STYLE: Record<string, readonly { pivot: readonly number[]; scale: number; tint: readonly number[] }[]> = '+JSON.stringify(styles)+';\n';
    fs.writeFileSync(path.join(root,'assets/scripts/map/entries/SiegeFramePivots.ts'),output);
    fs.mkdirSync(path.join(root,'temp/troop-flicker'),{recursive:true});
    fs.writeFileSync(path.join(root,'temp/troop-flicker/calibration.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
