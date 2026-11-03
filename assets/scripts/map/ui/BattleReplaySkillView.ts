import { Color, Graphics, Label, Node, UIOpacity, UITransform } from 'cc';
import type { ReportInfo } from '../../battle/BattleCommand';
import { reportUnitName } from '../../battle/ReportPresentation';
import { caption, place } from './ManagementStyle';
import type { SkillAnchor } from './PaintedBattleSkillEffects';
import { PaintedSkillCue, skillEnvelope, skillProgress, skillFlight, skillTargetFamily, skillTargetSupport } from './PaintedSkillCue';
import { reportUnitArt } from './ReportUnitArt';

function node(parent: Node, name: string): Node {
    const result = new Node(name); result.layer = parent.layer; parent.addChild(result); result.addComponent(UITransform); return result;
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** 战法特写固定在留白角落；只用本次战报中的武将和战法名，不遮住命中目标。 */
export class BattleSkillAnnouncement {
    private root: Node;
    private opacity: UIOpacity;
    private portrait: Node;
    private title: Label;
    private name: Label;
    private trim: Graphics;
    private key = '';
    private cue: PaintedSkillCue;
    private x: number;
    private y: number;
    private scale: number;
    constructor(parent: Node, width: number, height: number) {
        this.scale = Math.min(1, width / 960, height / 600);
        this.root = node(parent, 'Skill announcement'); place(this.root, 0, 0, 280, 72);
        this.root.setScale(this.scale, this.scale, 1); this.opacity = this.root.addComponent(UIOpacity);
        this.trim = this.root.addComponent(Graphics);
        this.portrait = node(this.root, 'Caster portrait');
        this.name = caption(this.root, 'Caster', '', 32, 17, 182, 11, new Color(212, 204, 174));
        this.title = caption(this.root, 'Skill', '', 32, -7, 182, 24, new Color(255, 229, 167));
        this.title.isBold = true; this.title.overflow = Label.Overflow.SHRINK;
        this.title.outlineColor = new Color(28, 23, 17); this.title.outlineWidth = 1;
        this.x = -width / 2 + 154*this.scale; this.y = height / 2 - 104 - 44*this.scale;
        this.reset();
    }
    begin(cue: PaintedSkillCue, info: ReportInfo): void {
        this.cue = cue;
        if (!cue || !cue.skillId) { this.reset(); return; }
        const [sideNumber, position] = cue.source.split(':').map(Number), side = sideNumber === 1 ? info.atkSide : info.defSide;
        const unit = side?.units?.find(entry => Number(entry.pos) === position);
        const key = `${sideNumber}:${unit?.cfgId || 0}`;
        if (key !== this.key) {
            this.key = key;
            for (const child of this.portrait.children.slice()) { child.removeFromParent(); child.destroy(); }
            if (unit) reportUnitArt(this.portrait, side, unit, -104, 0, 52);
        }
        const rgb = cue.style?.tint || [242, 211, 139], g = this.trim;
        g.clear(); g.fillColor = new Color(20, 25, 24, 222);
        g.moveTo(-140, 36); g.lineTo(127, 36); g.lineTo(140, 23); g.lineTo(127, -36); g.lineTo(-140, -36); g.close(); g.fill();
        g.strokeColor = new Color(rgb[0], rgb[1], rgb[2], 210); g.lineWidth = 1.2;
        g.moveTo(-138, 35); g.lineTo(102, 35); g.stroke();
        g.moveTo(-138, -35); g.lineTo(126, -35); g.stroke();
        this.name.string = `${sideNumber === 1 ? '攻' : '守'} · ${unit ? reportUnitName(side, unit) : side?.name || ''}`;
        this.title.string = cue.name; this.title.color = new Color(rgb[0], rgb[1], rgb[2]);
    }
    frame(time: number): void {
        if (!this.cue?.skillId) { this.root.active = false; return; }
        const alpha = skillEnvelope(time, .02, .13, .68, .22);
        this.root.active = alpha > .001; this.opacity.opacity = Math.round(alpha * 255);
        this.root.setPosition(this.x - (1-skillProgress(time, .02, .13))*20*this.scale, this.y);
    }
    reset(): void { this.cue = null; this.root.active = false; }
}

/** 图集之外的光迹、落雷分叉与粒子；完全按回放时间采样，拖动后不会残留上一个战法。 */
export class BattleSkillAccents {
    private graphics: Graphics;
    private cue: PaintedSkillCue;
    private impactAt = 1;
    constructor(parent: Node, private scale: number, private locate: (key: string) => SkillAnchor | null) {
        this.graphics = node(parent, 'Skill trails and impact').addComponent(Graphics);
    }
    begin(cue: PaintedSkillCue, impactAt: number): void { this.cue = cue; this.impactAt = impactAt; this.graphics.clear(); }
    reset(): void { this.cue = null; this.graphics.clear(); }
    private dot(x: number, y: number, radius: number, tint: number[], alpha: number): void {
        if (alpha < 1) return;
        const g = this.graphics;
        g.fillColor = new Color(tint[0], tint[1], tint[2], Math.round(alpha*.10));
        g.circle(x, y, radius*2.5); g.fill();
        g.fillColor = new Color(tint[0], tint[1], tint[2], Math.round(alpha)); g.circle(x, y, radius); g.fill();
    }
    private bolt(x: number, y: number, seed: number, alpha: number, tint: number[]): void {
        const g = this.graphics, s = this.scale, points = Array.from({length:8}, (_, i) => ({
            x: x + (i === 7 ? 0 : Math.sin(i*2.4+seed)*15*s), y: y+(7-i)*17*s }));
        for (const [width, opacity] of [[7,.12],[3,.28],[1.2,1]]) {
            g.strokeColor = new Color(tint[0], tint[1], tint[2], Math.round(alpha*opacity)); g.lineWidth = width*s;
            points.forEach((p,i) => i ? g.lineTo(p.x,p.y) : g.moveTo(p.x,p.y)); g.stroke();
        }
        g.strokeColor = new Color(255,248,225,Math.round(alpha)); g.lineWidth = 1.2*s;
        for (const i of [2,4]) {
            const p = points[i], direction = i === 2 ? -1 : 1;
            g.moveTo(p.x,p.y);g.lineTo(p.x+direction*19*s,p.y-14*s);g.lineTo(p.x+direction*12*s,p.y-28*s);g.stroke();
        }
    }
    frame(time: number, impacted: boolean): void {
        const cue=this.cue,g=this.graphics,s=this.scale;g.clear();
        const source=cue&&this.locate(cue.source);if(!cue||!source)return;
        const age=time-this.impactAt;if(age>1.12)return;
        const tint=cue.kind==='restore'?[175,233,186]:cue.style?.tint||[255,220,161];
        const charge=skillEnvelope(time,.04,.18,Math.max(0,this.impactAt-.57),.25);
        for(let i=0;i<7;i++){
            const angle=i*2.399+time*.65,radius=(1-skillProgress(time,.05,this.impactAt))*38*s;
            this.dot(source.leaderX+Math.cos(angle)*radius,source.leaderY+44*s+Math.sin(angle)*radius*.55,
                (i%3===0?1.5:1)*s,tint,charge*130);
        }
        for(const [index,target] of cue.targets.entries()){
            const at=this.locate(target.key);if(!at)continue;
            const family=skillTargetFamily(cue,target),support=skillTargetSupport(cue,target);
            const x=at.x,y=at.y+25*s,landed=impacted&&target.hit;
            if(!support&&['petals','fire','water','poison','thrust'].indexOf(family)>=0&&age<.1){
                for(let i=0;i<8;i++){
                    const flight=skillFlight(time-i*.018,this.impactAt,source,at,s);
                    this.dot(flight.x,flight.y,(i===0?2.1:1.1)*s,tint,flight.alpha*(1-i/10)*155);
                }
            }
            if(!landed||age<0)continue;
            const burst=skillEnvelope(age,0,.025,.04,.32),linger=skillEnvelope(age,.05,.09,.15,.72);
            if(support||family==='water'||family==='seal'){
                const radius=(27+skillProgress(age,0,.62)*62)*s;
                g.strokeColor=new Color(tint[0],tint[1],tint[2],Math.round(burst*105));g.lineWidth=1.4*s;
                g.ellipse(x,y-24*s,radius,radius*.30);g.stroke();
            }
            if(family==='lightning'){
                for(let i=0;i<2;i++){
                    const flash=skillEnvelope(age,i*.10,.012,.025,.15);
                    if(flash>.001)this.bolt(x+(i?22:-13)*s,y-6*s,index*3+i,flash*200,tint);
                }
            }
            if(family==='cleave'||family==='thrust'){
                for(let i=0;i<(cue.major?2:1);i++){
                    const flash=skillEnvelope(age,i*.075,.018,.035,.22),direction=i%2?-1:1;
                    for(const [width,alpha] of [[5,.18],[1.6,.92]]){
                        g.strokeColor=new Color(255,240,202,Math.round(flash*220*alpha));g.lineWidth=width*s;
                        g.moveTo(x-53*s,y-direction*18*s);g.quadraticCurveTo(x+5*s,y+direction*45*s,x+65*s,y+direction*4*s);g.stroke();
                    }
                }
            }
            const count=family==='petals'?12:support?8:10;
            for(let i=0;i<count;i++){
                const angle=i*2.399+index,speed=20+(i%4)*12;
                let px=x+Math.cos(angle)*age*speed*s,py=y+Math.sin(angle)*age*speed*.5*s;
                let alpha=linger*138,r=(i%4===0?1.8:1.05)*s;
                if(support){px=x+Math.cos(angle)*37*s;py=y-16*s+(i%4)*13*s+age*(28+i%3*9)*s;alpha*=.72;}
                else if(family==='fire'){py+=age*(32+i%4*13)*s;r*=.75;}
                else if(family==='petals'){
                    const wind=source.leaderX<x?1:-1,turn=angle+age*2;
                    px=x+Math.cos(angle)*39*s+wind*age*(23+i%4*7)*s;
                    py=y+Math.sin(angle)*20*s+age*(20+i%3*9)*s;
                    const dx=Math.cos(turn)*3.6*s,dy=Math.sin(turn)*3.6*s;
                    g.fillColor=new Color(255,197+i%3*15,219+i%2*14,Math.round(alpha));
                    g.moveTo(px-dx,py-dy);
                    g.quadraticCurveTo(px-dy*.55,py+dx*.55,px+dx,py+dy);
                    g.quadraticCurveTo(px+dy*.55,py-dx*.55,px-dx,py-dy);g.fill();continue;
                }else if(family==='water'){py-=age*24*s;r*=.7;}
                this.dot(px,py,r,tint,alpha);
            }
        }
    }
}
