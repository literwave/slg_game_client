import { paintedSkillStyle, PaintedSkillStyle } from './PaintedSkillCatalog';
/** 战报决定释放者、战法和命中目标；这里仅决定表现，不产生伤害或新的战斗事件。 */
export interface PaintedSkillTarget { key: string; hit: boolean; critical: boolean; }
export interface PaintedSkillCue {
    skillId: number; name: string; kind: 'cleave' | 'restore' | 'ward'; major: boolean;
    source: string; targets: PaintedSkillTarget[]; style:PaintedSkillStyle|null;
}
export function paintedSkillCue(action: any, config?: any): PaintedSkillCue | null {
    const type=Number(action?.actType),id=Number(action?.skillId)||0;
    if(!Number.isFinite(type)||type<2||type>7||(!id&&type!==2&&type!==6))return null;
    const targets=new Map<string,PaintedSkillTarget>();
    for(const effect of action.effects||[]){
        const side=Number(effect.targetSide),pos=Number(effect.targetPos);
        if((side!==1&&side!==2)||!Number.isFinite(pos))continue;
        const key=`${side}:${pos}`,flags=Number(effect.flags)||0,hit=!(flags&6),old=targets.get(key);
        targets.set(key,{key,hit:hit||!!old?.hit,critical:!!old?.critical||(hit&&!!(flags&1))});
    }
    const kind=type===6?'restore':type===3||type===5||type===7?'ward':'cleave';
    return {skillId:id,name:String(config?.Name||config?.name||(type===6?'治疗':type===4?'追击':'战法发动')),
        kind,major:kind==='cleave'&&type===2,source:`${Number(action.fromSide)}:${Number(action.fromPos)}`,targets:[...targets.values()],style:paintedSkillStyle(id)};
}
export function skillProgress(time:number,start:number,duration:number):number {
    return Math.max(0,Math.min(1,(time-start)/Math.max(.001,duration)));
}
export function skillEnvelope(time:number,start:number,attack:number,hold:number,release:number):number {
    if(time<start)return 0;
    const age=time-start;
    if(age<attack){const t=age/attack;return t*t*(3-2*t);}
    if(age<attack+hold)return 1;
    const t=skillProgress(age,attack+hold,release);return 1-t*t*(3-2*t);
}

/** 飞行贴图与粒子共用轨迹，结束点与同一次命中严格对齐。 */
export function skillFlight(time:number,impactAt:number,source:{leaderX:number;leaderY:number},
    target:{x:number;y:number},scale:number) {
    const progress=skillProgress(time,impactAt-.48,.48);
    const x0=source.leaderX,y0=source.leaderY+52*scale,x1=target.x,y1=target.y+28*scale;
    const arc=Math.min(68*scale,Math.hypot(x1-x0,y1-y0)*.17);
    return {x:x0+(x1-x0)*progress,y:y0+(y1-y0)*progress+Math.sin(progress*Math.PI)*arc,
        angle:Math.atan2(y1-y0+Math.cos(progress*Math.PI)*Math.PI*arc,x1-x0)*180/Math.PI,
        alpha:skillEnvelope(time,impactAt-.48,.06,.32,.10),progress};
}
export function skillTargetFamily(cue:PaintedSkillCue,target:PaintedSkillTarget):string {
    if(cue.kind==='restore')return 'restore';
    if(target.key.split(':')[0]===cue.source.split(':')[0]&&(!cue.style||cue.style.intent==='attack'))return 'rally';
    return cue.style?.family||(cue.kind==='ward'?'shield':'cleave');
}
export function skillTargetSupport(cue:PaintedSkillCue,target:PaintedSkillTarget):boolean {
    return cue.kind==='restore'||cue.style?.intent==='buff'||target.key.split(':')[0]===cue.source.split(':')[0];
}
