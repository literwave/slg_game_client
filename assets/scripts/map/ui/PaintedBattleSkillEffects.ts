import { Color, Graphics, Label, LabelOutline, Node, Rect, Size, Sprite, SpriteFrame, UIOpacity, UITransform } from 'cc';
import { PaintedSkillCue, PaintedSkillTarget, skillEnvelope, skillProgress } from './PaintedSkillCue';

export interface SkillAnchor { x:number; y:number; width:number; leaderX:number; leaderY:number; }
interface EffectSprite { node:Node; transform:UITransform; opacity:UIOpacity; sprite:Sprite; }
interface TargetEffects { slash:EffectSprite; arc:EffectSprite; echo:EffectSprite; star:EffectSprite; embers:EffectSprite; core:EffectSprite; left:EffectSprite; right:EffectSprite; }
const WHITE=new Color(255,255,255),JADE=new Color(150,255,197),AMBER=new Color(255,218,171);
const RECTS=[[78,128,486,259],[706,76,435,341],[1343,81,355,341],
    [100,484,401,357],[659,592,525,151],[1354,513,343,305]];

/** 共用图集和预建节点；所有阶段使用战报回放的绝对时间，暂停/倍速/重播无需额外计时器。 */
export default class PaintedBattleSkillEffects {
    readonly root:Node;
    private dim:Node;
    private shade:Graphics;
    private dimAlpha=-1;
    private frames:SpriteFrame[];
    private elements:SpriteFrame[]=[];
    private charge:EffectSprite;
    private motes:EffectSprite;
    private banner:EffectSprite;
    private title:Label;
    private titleOpacity:UIOpacity;
    private targetFx:TargetEffects[]=[];
    private cue:PaintedSkillCue=null;
    private impactAt=1;
    shakeX=0;
    shakeY=0;
    constructor(private world:Node,atlas:SpriteFrame,private scale:number,private width:number,private height:number,
        private locate:(key:string)=>SkillAnchor|null,elements:SpriteFrame) {
        this.frames=RECTS.map(([x,y,w,h])=>{const f=new SpriteFrame();f.texture=atlas.texture;f.rect=new Rect(x,y,w,h);
            f.originalSize=new Size(w,h);f.packable=false;return f;});
        const ew=elements.originalSize.width/4,eh=elements.originalSize.height/3;
        this.elements=Array.from({length:12},(_,i)=>{const f=new SpriteFrame();f.texture=elements.texture;
            f.rect=new Rect(i%4*ew,Math.floor(i/4)*eh,ew,eh);f.originalSize=new Size(ew,eh);f.packable=false;return f;});
        this.dim=this.node(world,'Skill atmosphere');this.dim.setSiblingIndex(1);this.shade=this.dim.addComponent(Graphics);
        this.root=this.node(world,'Skill effects');
        this.charge=this.part('Caster charge',3);this.motes=this.part('Charge motes',5);
        for(let i=0;i<6;i++)this.targetFx.push({slash:this.part(`Skill cleave ${i}`,1),arc:this.part(`Skill arc ${i}`,0),
            echo:this.part(`Skill echo ${i}`,0),star:this.part(`Skill impact ${i}`,2),embers:this.part(`Skill embers ${i}`,5),
            core:this.part(`Element core ${i}`,3),left:this.part(`Element left ${i}`,3),right:this.part(`Element right ${i}`,3)});
        this.banner=this.part('Skill name brush',4);
        const title=this.node(this.root,'Skill name');this.title=title.addComponent(Label);this.title.fontSize=25*scale;
        this.title.lineHeight=32*scale;this.title.isBold=true;this.title.color=new Color(255,245,208);
        this.title.horizontalAlign=Label.HorizontalAlign.CENTER;this.title.verticalAlign=Label.VerticalAlign.CENTER;
        this.title.overflow=Label.Overflow.SHRINK;this.title.enableWrapText=false;
        title.getComponent(UITransform).setContentSize(220*scale,34*scale);
        const outline=title.addComponent(LabelOutline);outline.width=1.5;outline.color=new Color(31,17,7);
        this.titleOpacity=title.addComponent(UIOpacity);this.reset();
    }
    private node(parent:Node,name:string):Node {
        const n=new Node(name);n.layer=parent.layer;n.addComponent(UITransform);parent.addChild(n);return n;
    }
    private part(name:string,index:number):EffectSprite {
        const node=this.node(this.root,name),sprite=node.addComponent(Sprite);sprite.sizeMode=Sprite.SizeMode.CUSTOM;
        sprite.trim=false;sprite.spriteFrame=this.frames[index];
        return{node,sprite,transform:node.getComponent(UITransform),opacity:node.addComponent(UIOpacity)};
    }
    begin(cue:PaintedSkillCue|null,impactAt:number):void {
        this.reset();if(!cue)return;this.cue=cue;this.impactAt=impactAt;this.title.string=cue.name;
        const tint=cue.kind==='restore'?JADE:cue.style?new Color(...cue.style.tint):WHITE;this.charge.sprite.color=tint;
        this.motes.sprite.color=tint;this.title.color=tint;
        const element=this.elements[cue.kind==='restore'?10:cue.style?.element??7];
        this.targetFx.forEach(f=>{for(const key of Object.keys(f))f[key].sprite.color=tint;
            f.slash.sprite.spriteFrame=this.frames[1];f.arc.sprite.spriteFrame=this.frames[0];f.echo.sprite.spriteFrame=this.frames[0];
            f.core.sprite.spriteFrame=element;f.left.sprite.spriteFrame=element;f.right.sprite.spriteFrame=element;});
    }
    reset():void {
        this.cue=null;this.shakeX=0;this.shakeY=0;this.setDim(0);this.root.active=false;
        this.root.children.forEach(n=>n.active=false);
    }
    private show(f:EffectSprite,x:number,y:number,w:number,h:number,angle:number,alpha:number,mirror=false):void {
        f.node.active=alpha>.002;if(!f.node.active)return;
        f.node.setPosition(x,y);f.transform.setContentSize(w,h);f.node.setRotationFromEuler(0,0,angle);
        f.node.setScale(mirror?-1:1,1,1);f.opacity.opacity=Math.round(255*Math.max(0,Math.min(1,alpha)));
    }
    private setDim(alpha:number):void {
        alpha=Math.round(alpha);if(alpha===this.dimAlpha)return;this.dimAlpha=alpha;
        this.dim.active=alpha>0;this.shade.clear();if(!alpha)return;
        // Graphics 的顶点颜色在绘制时写入；直接使用填充透明度，避免全屏遮罩变成实色。
        this.shade.fillColor=new Color(6,12,23,alpha);
        this.shade.rect(-this.width/2,-this.height/2,this.width,this.height);this.shade.fill();
    }
    frame(time:number,impacted:boolean):void {
        this.shakeX=0;this.shakeY=0;
        const cue=this.cue,source=cue&&this.locate(cue.source);
        if(!cue||!source||time>this.impactAt+1.02){this.root.active=false;this.setDim(0);return;}
        this.root.active=true;
        const s=this.scale,major=cue.major,side=cue.source.startsWith('1:')?1:-1;
        const charge=skillEnvelope(time,.04,.24,Math.max(0,this.impactAt-.59),.27);
        const pulse=1+Math.sin(time*14)*.025;
        const cx=source.leaderX+side*20*s,cy=source.leaderY+87*s;
        this.show(this.charge,cx,cy+time*8*s,(major?120:84)*s*pulse,(major?157:112)*s*pulse,0,charge*(major?.70:.45));
        this.show(this.motes,cx,cy+14*s,145*s,133*s,14+time*18,charge*.7);
        const banner=skillEnvelope(time,.04,.16,.94,.32);
        const bx=Math.max(-this.width/2+144*s,Math.min(this.width/2-144*s,source.leaderX-side*163*s));
        const by=Math.max(-this.height/2+150*s,Math.min(this.height/2-106*s,source.leaderY+106*s));
        const entrance=skillProgress(time,.04,.16),slide=(1-entrance)*18*s*side;
        this.show(this.banner,bx+slide,by,275*s,65*s,0,banner);
        this.title.node.active=banner>.002;this.title.node.setPosition(bx+slide,by+1*s);this.titleOpacity.opacity=Math.round(banner*255);
        const hitAge=time-this.impactAt;
        this.setDim(charge*(major?32:14)+(impacted?skillEnvelope(hitAge,0,.025,.04,.20)*12:0));
        for(let i=0;i<this.targetFx.length;i++){
            const fx=this.targetFx[i],target=cue.targets[i],at=target&&this.locate(target.key);
            if(!target||!at){Object.keys(fx).forEach(key=>fx[key].node.active=false);continue;}
            this.target(fx,target,at,source,time,impacted);
        }
        if(major&&impacted&&cue.targets.some(t=>t.hit)&&hitAge>=0&&hitAge<.23){
            const decay=1-hitAge/.23;this.shakeX=Math.sin(hitAge*76)*2.2*s*decay;this.shakeY=Math.sin(hitAge*103)*1.1*s*decay;
        }
    }
    private target(f:TargetEffects,target:PaintedSkillTarget,at:SkillAnchor,source:SkillAnchor,time:number,impacted:boolean):void {
        const style=this.cue.style;
        if(style&&(style.family!=='cleave'||style.intent!=='attack')||this.cue.kind==='restore'||
            target.key.slice(0,2)===this.cue.source.slice(0,2)){
            this.elementTarget(f,target,at,source,time,impacted);return;
        }
        const s=this.scale,cue=this.cue,major=cue.major,attack=cue.kind==='cleave',age=time-this.impactAt;
        const x=at.x,y=at.y+42*s,travel=skillProgress(time,this.impactAt-.34,.34);
        const flight=attack?skillEnvelope(time,this.impactAt-.34,.08,.20,.15):0;
        const startX=source.leaderX,startY=source.leaderY+102*s;
        const angle=Math.atan2(y-startY,x-startX)*180/Math.PI-38;
        this.show(f.slash,startX+(x-startX)*travel,startY+(y-startY)*travel,
            (major?210:134)*s,(major?110:72)*s,angle,flight*.92);
        const sweep=target.hit?skillEnvelope(time,this.impactAt-.10,.08,.09,.48):0;
        const width=Math.min(380*s,Math.max(190*s,at.width+44*s)),expand=1+skillProgress(age,-.1,.6)*.22;
        this.show(f.arc,x,y-10*s,width*expand,width*.43*expand,-16+skillProgress(age,-.1,.6)*37,attack?sweep*.82:0);
        const second=major&&target.hit?skillEnvelope(time,this.impactAt+.09,.07,.02,.39):0;
        this.show(f.echo,x,y-4*s,width*.94*expand,width*.33*expand,18-skillProgress(age,.09,.5)*39,second*.68,true);
        // 闪避/未命中仍有释放刀光，但不生成命中爆点，不添加新的受击事件。
        const hit=impacted&&target.hit?skillEnvelope(age,0,.025,.035,.25):0;
        const size=(target.critical?133:100)*s*(.55+skillProgress(age,0,.10)*.6);
        this.show(f.star,x,y+8*s,size,size,age*24,hit*(attack?1:.6));
        const embers=impacted&&target.hit?skillEnvelope(age,.07,.08,.08,.63):0;
        const spread=(80+skillProgress(age,.07,.8)*122)*s;
        this.show(f.embers,x,y+age*20*s,spread,spread*.76,age*37,embers*.82);
        if(!attack){
            const aura=impacted&&target.hit?skillEnvelope(age,0,.16,.24,.51):0;
            f.arc.sprite.color=cue.kind==='restore'?JADE:AMBER;
            this.show(f.arc,x,y-22*s,172*s,60*s,age*12,aura*.65);
            this.show(f.slash,x,y+5*s,68*s,150*s,12,aura*.4);
        }
    }
    private elementTarget(f:TargetEffects,target:PaintedSkillTarget,at:SkillAnchor,source:SkillAnchor,time:number,impacted:boolean):void {
        const cue=this.cue,style=cue.style,s=this.scale,age=time-this.impactAt;
        const friendly=target.key.slice(0,2)===cue.source.slice(0,2);
        const support=cue.kind==='restore'||style?.intent==='buff'||friendly;
        const family=cue.kind==='restore'?'restore':friendly&&style?.intent==='attack'?'rally':style?.family||'shield';
        const variant=style?.variant||0,weight=style?.weight||1;
        const x=at.x,y=at.y+40*s,w=Math.min(310*s,Math.max(180*s,at.width+25*s))*weight;
        const landed=impacted&&target.hit;
        const aura=landed?skillEnvelope(age,0,.10,.22,.65):0;
        const hit=landed&&!support?skillEnvelope(age,0,.018,.04,.22):0;
        const linger=landed?skillEnvelope(age,.03,.09,.11,.72):0;
        const expand=.66+.5*skillProgress(age,0,.65),turn=age*(variant%2?-65:65);
        let element=cue.kind==='restore'?10:style?.element??5;
        if(friendly&&style?.intent==='attack')element=7;
        for(const part of [f.core,f.left,f.right])part.sprite.spriteFrame=this.elements[element];
        f.slash.node.active=false;f.echo.node.active=false;f.left.node.active=false;f.right.node.active=false;
        // 飞行阶段保留释放表现；未命中的目标只看见掠过轨迹，不出现爆点或受击光环。
        if(!support&&['thrust','water','fire','petals'].indexOf(family)>=0){
            const t=skillProgress(time,this.impactAt-.36,.36),alpha=skillEnvelope(time,this.impactAt-.36,.07,.19,.12);
            f.slash.sprite.spriteFrame=this.elements[family==='thrust'?11:family==='fire'?0:style.element];
            const sx=source.leaderX,sy=source.leaderY+92*s,angle=Math.atan2(y-sy,x-sx)*180/Math.PI-42;
            this.show(f.slash,sx+(x-sx)*t,sy+(y-sy)*t,115*s,74*s,angle,alpha*.82);
        }
        this.show(f.star,x,y,100*s*(.7+skillProgress(age,0,.1)*.5),100*s,variant*30,hit*.9);
        this.show(f.embers,x,y+Math.max(0,age)*25*s,w*.8,w*.6,age*23,linger*.52);
        this.show(f.arc,x,y-24*s,w*expand,w*.30*expand,0,landed?skillEnvelope(age,0,.06,.06,.45)*.45:0);
        if(family==='fire'){
            this.show(f.core,x,y+26*s,w*.65,170*s*(.75+expand*.35),-4,aura*.88);
            this.show(f.left,x-w*.27,y+14*s,w*.48,135*s,12,landed?skillEnvelope(age,.07,.07,.19,.60)*.76:0);
            this.show(f.right,x+w*.27,y+19*s,w*.48,145*s,-11,landed?skillEnvelope(age,.13,.07,.15,.57)*.78:0,true);
        }else if(family==='lightning'){
            const bolt=landed?skillEnvelope(age,0,.012,.06,.21):0;
            this.show(f.core,x,y+92*s,116*s,275*s,0,bolt);
            this.show(f.left,x-w*.27,y+68*s,85*s,226*s,9,landed?skillEnvelope(age,.10,.012,.03,.22):0);
            this.show(f.right,x+w*.26,y+73*s,93*s,236*s,-7,landed?skillEnvelope(age,.19,.012,.03,.20):0,true);
        }else if(family==='thrust'){
            const streak=landed?skillEnvelope(age,0,.018,.045,.30):0;
            this.show(f.core,x,y+5*s,w,87*s,-20+variant*13,streak*.9);
            this.show(f.left,x-w*.16,y-4*s,w*.75,51*s,-15+variant*13,landed?skillEnvelope(age,.09,.02,.03,.28)*.7:0);
        }else if(family==='water'||family==='petals'){
            this.show(f.core,x,y,w*expand,w*.72*expand,turn,aura*.84);
            this.show(f.left,x-w*.25,y-6*s,w*.42,w*.42,-turn,linger*.65,true);
            this.show(f.right,x+w*.28,y+age*26*s,w*.35,w*.35,turn+60,linger*.58);
        }else if(family==='poison'){
            this.show(f.core,x,y-6*s+age*23*s,w,w*.65,-turn*.2,aura*.72);
            this.show(f.left,x-w*.2,y+age*37*s,w*.6,w*.50,turn*.3,linger*.45,true);
        }else if(family==='wisdom'||family==='seal'){
            this.show(f.core,x,y-24*s,w*expand,w*.48*expand,turn*.25,aura*.78);
            this.show(f.left,x,y+30*s,106*s,106*s,-turn*.4,aura*.55);
        }else if(family==='shield'){
            this.show(f.core,x,y+26*s,151*s,168*s,0,aura*.75);
            this.show(f.left,x-w*.31,y+7*s,89*s,108*s,0,aura*.37);
            this.show(f.right,x+w*.31,y+7*s,89*s,108*s,0,aura*.37);
        }else if(family==='haste'){
            this.show(f.core,x,y,w,92*s,-22,aura*.68);
            this.show(f.left,x-w*.2,y-17*s,w*.7,57*s,-22,linger*.52);
            this.show(f.right,x+w*.22,y+13*s,w*.6,50*s,-22,linger*.48);
        }else{
            this.show(f.core,x,y+24*s,w*.75,150*s,0,aura*.67);
            this.show(f.left,x-w*.3,y+age*28*s,68*s,116*s,-8,linger*.5);
            this.show(f.right,x+w*.3,y+age*23*s,68*s,116*s,8,linger*.5);
        }
    }
    destroy():void { [...this.frames,...this.elements].forEach(frame=>frame.destroy()); }
}
