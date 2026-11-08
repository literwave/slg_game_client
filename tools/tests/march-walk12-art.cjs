// Read the actual imported pixels: catch blank/duplicated frames, bleed and lost registration.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Jimp } = require('../../extensions/cocos-ai-copilot/lib/asset-preview/image-core');
const root = path.resolve(__dirname, '../..');

async function inspectCavalry() {
    for (const [part,rows] of [['primary',6],['axial',8]]) {
        const file=`commander_walk_grounded_${part}_v6.png`;
        const {bitmap:{data,width,height}}=await Jimp.read(path.join(root,'assets/resources/ui/march',file));
        assert.equal(width%6,0);assert.equal(height%rows,0);
        assert.ok(width<=2048&&height<=2048);
        const w=width/6,h=height/rows,frames=[];
        for(let i=0;i<rows*6;i++) {
            const hash=createHash('sha256'),feetHash=createHash('sha256');
            let minY=h,maxY=-1,count=0,edge=0,luma=0;
            for(let y=0;y<h;y++) {
                const start=((Math.floor(i/6)*h+y)*width+i%6*w)*4;
                hash.update(data.subarray(start,start+w*4));
                if(y>h*.68)feetHash.update(data.subarray(start,start+w*4));
                for(let x=0;x<w;x++) {
                    const p=start+x*4;if(data[p+3]<=160)continue;
                    minY=Math.min(minY,y);maxY=Math.max(maxY,y);count++;
                    if(x<1||y<1||x>=w-1||y>=h-1)edge++;
                    luma+=data[p]*.2126+data[p+1]*.7152+data[p+2]*.0722;
                }
            }
            assert.ok(count>5000&&count<w*h*.6,'full transparent horse cutouts');
            assert.equal(edge,0,'spear, tail and hooves must stay inside their own cell');
            frames.push({hash:hash.digest('hex'),feet:feetHash.digest('hex'),minY,maxY,luma:luma/count});
        }
        for(let start=0;start<frames.length;start+=12) {
            const cycle=frames.slice(start,start+12);
            assert.equal(new Set(cycle.map(f=>f.hash)).size,12);
            assert.equal(new Set(cycle.map(f=>f.feet)).size,12,'lower legs must change, not just head or cape');
            const range=k=>Math.max(...cycle.map(f=>f[k]))-Math.min(...cycle.map(f=>f[k]));
            assert.ok(range('minY')<=4,'no full-body registration jumps');
            assert.ok(range('luma')<6,'no alternating exposure');
            if(part==='primary'&&start===0)assert.ok(range('maxY')<=6,'side-view walk keeps a supporting hoof near the ground');
        }
        console.log(`PASS ${file}: ${frames.length} distinct whole/hoof poses, gutters, registration and exposure`);
    }
}

async function main() {
    await inspectCavalry();
    for (const kind of ['guard']) {
        const mounted = kind === 'commander';
        const filename = mounted ? 'commander_march_walk12_v4.png' : 'guard_march_walk12.png';
        const image = await Jimp.read(path.join(root, 'assets/resources/ui/march', filename));
        const { width, height, data } = image.bitmap;
        assert.equal(width, 1920); assert.equal(height, mounted ? 1728 : 1344);
        assert.ok(width <= 2048 && height <= 2048, 'Atlas must fit a 2048 texture limit');
        const hashes = [], bounds = [];
        for (let slot = 0; slot < (mounted ? 90 : 70); slot++) {
            const ox = slot % 10 * 192, oy = Math.floor(slot / 10) * 192;
            const hash = createHash('sha256');
            let visible = 0, minY = 192, maxY = -1, edge = 0;
            for (let y = 0; y < 192; y++) {
                const start = ((oy + y) * width + ox) * 4;
                hash.update(data.subarray(start, start + 192 * 4));
                for (let x = 0; x < 192; x++) {
                    if (data[start + x * 4 + 3] < 32) continue;
                    visible++; minY = Math.min(minY, y); maxY = y;
                    if (x < 2 || x > 189 || y < 2 || y > 189) edge++;
                }
            }
            if (slot >= (mounted ? 89 : 65)) {
                assert.equal(visible, 0, `${filename} unused cell ${slot}`);
                continue;
            }
            assert.ok(visible > 800 && visible < 25000, `${filename} cell ${slot} must contain a cutout, not a blank/background`);
            assert.equal(edge, 0, `${filename} cell ${slot}: spear/boots/tail cross cell boundary`);
            if (slot < 60 || (mounted && slot >= 65)) {
                // 马腾空时蹄子必须自然离地，不能逐帧拉伸/平移整个身体把蹄底强行对齐。
                assert.ok(maxY >= (kind === 'commander' ? 164 : 176) && maxY <= 182,
                    `${filename} cell ${slot}: hoof/boot height ${maxY}`);
                bounds.push({ minY, maxY });
                hashes.push(hash.digest('hex'));
            }
        }
        for (let direction = 0; direction < (mounted ? 7 : 5); direction++) {
            assert.equal(new Set(hashes.slice(direction * 12, direction * 12 + 12)).size, 12,
                `${filename} direction ${direction}: real distinct pixels, not copied frames`);
            if (kind === 'commander') {
                const cycle = bounds.slice(direction * 12, direction * 12 + 12);
                assert.ok(cycle.filter(b => b.maxY >= 176).length >= 2,
                    `${filename} direction ${direction}: must return to ground contact during the cycle`);
                assert.ok(Math.max(...cycle.map(b => b.minY)) - Math.min(...cycle.map(b => b.minY)) <= 3,
                    `${filename} direction ${direction}: stable upper-body registration while hooves lift`);
            }
        }
        console.log(`PASS ${filename}: ${mounted ? 84 : 60} distinct walk frames, 5 standing poses, transparent gutters, registered contacts`);
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
