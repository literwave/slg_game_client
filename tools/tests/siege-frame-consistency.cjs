// Inspect real pixels: feet, brightness and crop safety across all throw directions.
const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const {Jimp}=require('../../extensions/cocos-ai-copilot/lib/asset-preview/image-core');
async function main(){
    const {bitmap:{data,width,height}}=await Jimp.read(path.resolve(__dirname,'../../assets/resources/ui/march/siege-assault-infantry-v2.png'));
    assert.equal(width,1280);assert.equal(height,1280);
    for(let row=0;row<8;row++){
        const frames=[];
        for(let col=0;col<8;col++){
            let count=0,luma=0,minX=160,maxX=-1,minY=160,maxY=-1,footX=0,footCount=0;
            const hash=crypto.createHash('sha256');
            for(let y=0;y<160;y++){
                const offset=((row*160+y)*width+col*160)*4;hash.update(data.subarray(offset,offset+640));
                for(let x=0;x<160;x++){
                    const p=offset+x*4;if(data[p+3]<=190)continue;
                    count++;luma+=data[p]*.2126+data[p+1]*.7152+data[p+2]*.0722;
                    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
                }
            }
            for(let y=maxY-10;y<=maxY;y++)for(let x=0;x<160;x++){
                const p=((row*160+y)*width+col*160+x)*4;
                if(data[p+3]>190){footX+=x;footCount++;}
            }
            assert.ok(count>4500,'no empty or partial unit frames');
            assert.ok(minX>=2&&maxX<158&&minY>=2&&maxY<158,'solid pixels do not bleed between cells');
            frames.push({foot:footX/footCount,bottom:maxY,luma:luma/count,hash:hash.digest('hex')});
        }
        const range=key=>Math.max(...frames.map(f=>f[key]))-Math.min(...frames.map(f=>f[key]));
        assert.equal(new Set(frames.map(f=>f.hash)).size,8,'keep the complete throw and recovery');
        assert.ok(range('bottom')<=2,'feet cannot hop vertically between frames');
        assert.ok(range('foot')<=4,'planted feet must not slide');
        assert.ok(range('luma')<8,'no alternating bright/dark character sheets');
    }
    console.log('PASS 64 unique frames, alpha gutters, fixed feet and consistent exposure');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
