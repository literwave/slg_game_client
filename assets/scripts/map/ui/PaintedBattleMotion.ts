/** 每套动作 30 个姿态采样，再按真实时间插值。动作帧数与播放时长分开，倍速不改变战报结算。 */
export type PaintedMotion = 'idle' | 'march' | 'rush' | 'attack' | 'sweep' | 'slash' | 'shoot' | 'guard' | 'hit' | 'fall' | 'command' | 'rally' | 'cast';
export const MOTION_SAMPLES = 30;
export const MOTION_CHANNELS = ['x','y','lean','head','legFar','legNear','liftFar','liftNear',
    'weaponX','weaponY','weaponAngle','freeX','freeY','grip','cloth','plume','fall','flatten'] as const;
export type MotionChannel = typeof MOTION_CHANNELS[number];
export interface PaintedClip { duration: number; loop: boolean; frames: Float32Array[]; impact?: number; }
type Key = [number, Partial<Record<MotionChannel, number>>];
const BASE = [0,0,0,0, -6,6,0,0, 18,43,-9, -18,40,0, 0,0,0,1];
const TAU = Math.PI * 2;
export const easeMotion = (v: number): number => { const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t); };
function keyed(keys: Key[], duration: number, impact?: number): PaintedClip {
    const poses=keys.map(([time,key])=>({time,pose:BASE.map((v,i)=>key[MOTION_CHANNELS[i]]===undefined?v:key[MOTION_CHANNELS[i]])}));
    return {duration,loop:false,impact,frames:Array.from({length:MOTION_SAMPLES},(_,i)=>{
        const t=i/(MOTION_SAMPLES-1);let j=0;while(j<poses.length-2&&t>poses[j+1].time)j++;
        const a=poses[j],b=poses[j+1],u=easeMotion((t-a.time)/(b.time-a.time));
        return Float32Array.from(a.pose.map((v,c)=>v+(b.pose[c]-v)*u));
    })};
}
function cycle(duration: number, fn: (t:number)=>Partial<Record<MotionChannel,number>>): PaintedClip {
    return {duration,loop:true,frames:Array.from({length:MOTION_SAMPLES},(_,i)=>{
        const p=fn(i/MOTION_SAMPLES);return Float32Array.from(BASE.map((v,c)=>p[MOTION_CHANNELS[c]]===undefined?v:p[MOTION_CHANNELS[c]]));
    })};
}
function gait(t:number, fast:boolean): Partial<Record<MotionChannel,number>> {
    const s=Math.sin(t*TAU),c=Math.cos(t*TAU),stride=fast?32:23;
    return {y:Math.abs(s)*(fast?2.8:1.6),lean:fast?-6:-2,head:c*1.5,
        legFar:-6+s*stride,legNear:6-s*stride,liftFar:Math.max(0,s)*5,liftNear:Math.max(0,-s)*5,
        weaponX:fast?20:18,weaponY:45+c*1.5,weaponAngle:(fast?-25:-9)+s*4,
        freeX:-18-s*8,freeY:42+c*3,cloth:s*8,plume:Math.sin(t*TAU-.8)*5};
}
export const PAINTED_CLIPS: Record<PaintedMotion,PaintedClip> = {
    idle:cycle(2.4,t=>({y:Math.sin(t*TAU)*.65,head:Math.sin(t*TAU+.6)*1.3,
        weaponAngle:-9+Math.sin(t*TAU)*1.4,freeY:40+Math.sin(t*TAU)*.6,cloth:Math.sin(t*TAU-.5)*3,plume:Math.sin(t*TAU-1)*4})),
    march:cycle(.84,t=>gait(t,false)),
    rush:cycle(.58,t=>gait(t,true)),
    attack:keyed([
        [0,{}],[.18,{x:-3,y:-2,lean:5,weaponX:7,weaponY:49,weaponAngle:4,grip:1,cloth:-7}],
        [.32,{x:-4,y:-3,lean:7,weaponX:7,weaponY:53,weaponAngle:-34,grip:1,legFar:-15,legNear:16}],
        [.43,{x:6,y:-2,lean:-7,weaponX:29,weaponY:54,weaponAngle:-65,grip:1,legFar:-24,legNear:18,cloth:12}],
        [.55,{x:5,y:-2,lean:-5,weaponX:28,weaponY:53,weaponAngle:-63,grip:1,legFar:-21,legNear:16,cloth:5}],
        [.76,{x:1,weaponX:21,weaponY:48,weaponAngle:-32,grip:.7,cloth:-3}],[1,{}]
    ],1.05,.43),
    sweep:keyed([
        [0,{}],[.22,{x:-3,y:-2,lean:5,weaponX:4,weaponY:57,weaponAngle:30,grip:1,head:6,cloth:-8}],
        [.4,{x:1,y:-1,weaponX:19,weaponY:62,weaponAngle:-13,grip:1,cloth:8}],
        [.49,{x:6,y:-3,lean:-8,weaponX:29,weaponY:48,weaponAngle:-83,grip:1,legFar:-22,legNear:15,head:-5,cloth:14}],
        [.68,{x:3,y:-2,lean:-3,weaponX:24,weaponY:44,weaponAngle:-72,grip:.8,cloth:6}],[1,{}]
    ],1.12,.49),
    slash:keyed([
        [0,{}],[.20,{x:-2,y:-2,lean:5,weaponX:8,weaponY:60,weaponAngle:34,freeX:-20,freeY:53,cloth:-5}],
        [.37,{x:-2,y:-3,lean:7,weaponX:15,weaponY:68,weaponAngle:12,freeX:-21,freeY:54,legFar:-16,legNear:17}],
        [.50,{x:6,y:-3,lean:-8,weaponX:31,weaponY:48,weaponAngle:-91,freeX:-18,freeY:51,legFar:-25,legNear:20,cloth:11}],
        [.65,{x:3,y:-2,lean:-4,weaponX:27,weaponY:42,weaponAngle:-70,freeX:-18,freeY:48,cloth:6}],[1,{}]
    ],1.08,.50),
    shoot:keyed([
        [0,{}],[.20,{y:-2,lean:3,weaponX:25,weaponY:54,weaponAngle:-5,freeX:6,freeY:53,legFar:-13,legNear:15}],
        [.38,{x:-2,y:-2,lean:5,head:-3,weaponX:28,weaponY:56,weaponAngle:-4,freeX:-3,freeY:56,legFar:-14,legNear:16}],
        [.46,{x:1,y:-1,lean:-3,weaponX:29,weaponY:54,weaponAngle:-8,freeX:-13,freeY:59,cloth:5}],
        [.60,{x:0,y:-1,lean:0,weaponX:28,weaponY:54,weaponAngle:-6,freeX:-18,freeY:50}],
        [.76,{weaponX:25,weaponY:51,weaponAngle:-5,freeX:-18,freeY:44}],[1,{}]
    ],1.1,.76),
    guard:keyed([
        [0,{}],[.25,{y:-3,lean:3,weaponX:17,weaponY:55,weaponAngle:-28,grip:1,legFar:-16,legNear:18}],
        [.7,{y:-2,lean:2,weaponX:17,weaponY:54,weaponAngle:-26,grip:1,legFar:-15,legNear:17}],[1,{}]
    ],.85),
    hit:keyed([
        [0,{}],[.18,{x:-6,y:-3,lean:13,head:-8,weaponX:12,weaponY:48,weaponAngle:13,legFar:-18,legNear:20,cloth:-15}],
        [.42,{x:-3,y:-5,lean:7,head:-5,weaponX:13,weaponY:45,weaponAngle:1,legFar:-14,legNear:17,cloth:-8}],
        [.7,{x:1,y:-1,lean:-2,head:2,cloth:5}],[1,{}]
    ],.56),
    fall:keyed([
        [0,{}],[.15,{x:-4,y:-3,lean:12,head:-12,weaponX:12,weaponY:46,weaponAngle:15,cloth:-12}],
        [.34,{x:-5,y:-14,lean:16,head:-10,legFar:-38,legNear:32,weaponX:12,weaponY:37,weaponAngle:10,freeX:-23,freeY:34,cloth:-22,fall:12}],
        [.65,{x:-8,y:1,lean:0,head:-9,legFar:-32,legNear:24,weaponX:20,weaponY:35,weaponAngle:-12,freeX:-26,freeY:32,cloth:9,fall:76,flatten:.72}],
        [.82,{x:-9,y:1,head:-8,legFar:-25,legNear:21,weaponX:20,weaponY:34,weaponAngle:-12,freeX:-27,freeY:32,cloth:3,fall:89,flatten:.64}],
        [1,{x:-9,y:1,head:-8,legFar:-25,legNear:21,weaponX:20,weaponY:34,weaponAngle:-12,freeX:-27,freeY:32,cloth:2,fall:86,flatten:.64}]
    ],1),
    command:keyed([
        [0,{}],[.24,{y:1,lean:3,head:4,weaponX:20,weaponY:62,weaponAngle:12,freeX:-25,freeY:63,cloth:-5}],
        [.46,{y:2,lean:-4,head:-4,weaponX:24,weaponY:71,weaponAngle:-14,freeX:-30,freeY:72,cloth:12,plume:12}],
        [.65,{y:1,lean:-3,head:-2,weaponX:23,weaponY:68,weaponAngle:-12,freeX:-29,freeY:67,cloth:6,plume:5}],
        [1,{}]
    ],1.15),
    cast:keyed([
        [0,{}],[.22,{head:3,lean:2,weaponX:13,weaponY:53,weaponAngle:12,freeX:-16,freeY:53,cloth:-4}],
        [.43,{y:2,head:-3,lean:-3,weaponX:28,weaponY:64,weaponAngle:-24,freeX:-27,freeY:71,cloth:8}],
        [.66,{y:1,head:-2,weaponX:29,weaponY:63,weaponAngle:-20,freeX:-28,freeY:68,cloth:5}],
        [.84,{weaponX:22,weaponY:51,weaponAngle:-11,freeX:-21,freeY:51}],[1,{}]
    ],1.38),
    rally:keyed([
        [0,{}],[.25,{y:1,head:4,weaponX:21,weaponY:69,weaponAngle:7,freeX:-23,freeY:68,cloth:5}],
        [.45,{y:2,lean:-3,weaponX:23,weaponY:74,weaponAngle:-2,freeX:-25,freeY:74,cloth:12,plume:10}],
        [.62,{y:0,weaponX:21,weaponY:66,weaponAngle:6,freeX:-24,freeY:65,cloth:5}],
        [.76,{y:2,weaponX:22,weaponY:71,weaponAngle:1,freeX:-25,freeY:71,cloth:9}],[1,{}]
    ],1.25)
};
/** seconds 可由同一回放时钟驱动；循环在末帧与首帧之间也插值，不会每圈顿一下。 */
export function samplePaintedMotion(name:PaintedMotion,seconds:number,out:Float32Array): void {
    const clip=PAINTED_CLIPS[name],phase=clip.loop?((seconds/clip.duration)%1+1)%1:Math.max(0,Math.min(1,seconds/clip.duration));
    const frame=phase*(clip.loop?MOTION_SAMPLES:MOTION_SAMPLES-1),a=Math.floor(frame),b=clip.loop?(a+1)%MOTION_SAMPLES:Math.min(a+1,MOTION_SAMPLES-1);
    const t=frame-a;for(let c=0;c<BASE.length;c++)out[c]=clip.frames[a][c]+(clip.frames[b][c]-clip.frames[a][c])*t;
}
