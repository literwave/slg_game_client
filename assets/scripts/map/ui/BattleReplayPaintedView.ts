import { _decorator, BlockInputEvents, Button, Camera, Canvas, Color, Component, director, EventTouch, Graphics,
    isValid, Label, LabelOutline, Node, resources, Sprite, SpriteFrame, UIOpacity, UITransform, Vec3 } from 'cc';
import { ReportInfo } from '../../battle/BattleCommand';
import ReportReplay from '../../battle/ReportReplay';
import { replayLines, reportConfig, reportResult, reportUnitName } from '../../battle/ReportPresentation';
import ConfigManager from '../../core/ConfigManager';
import { caption, inkSurface, ManagementColors as C, panelButton, place } from './ManagementStyle';
import { PaintedBattlePuppet, PaintedEquipmentAtlas, paintedInfantryWeapon, PaintedKind, PaintedPuppetAtlas, PaintedWeapon } from './PaintedBattlePuppet';
import { PAINTED_CLIPS, PaintedMotion } from './PaintedBattleMotion';
import PaintedBattleSkillEffects from './PaintedBattleSkillEffects';
import { paintedSkillCue } from './PaintedSkillCue';
import { paintedHero, PaintedHeroProfile } from './PaintedHeroCatalog';

const { ccclass } = _decorator;
const LAYER = 1 << 19, APPROACH = .64, RETURN = 1.82, END = 2.55;
const ASSETS = 'ui/battle_replay/painted/';
type Motion = 'idle' | 'rush' | 'attack' | 'march';
interface Figure {
    node: Node; rig: PaintedBattlePuppet; opacity: UIOpacity; hero: boolean;
    alive: boolean; deadTime: number; deathDelay: number; phase: number; offset: number;
    foot: Vec3; fallFoot: Vec3;
}
interface Army {
    key: string; side: number; home: Vec3; position: Vec3; max: number; count: number;
    members: Figure[]; leader: Figure; title: Node; order: number; hit: number; guard: number; motion: Motion;
    attack: 'attack' | 'sweep' | 'slash' | 'shoot'; command: 'command' | 'rally' | 'cast'; weapon:PaintedWeapon; hero?:PaintedHeroProfile;
}
interface Burst { x: number; y: number; age: number; heal: boolean; critical: boolean; }

/** 手绘角色在有纵深的战场中运动；兵力变化完全来自战报，不重新结算战斗。 */
@ccclass('BattleReplayPaintedView')
export default class BattleReplayPaintedView extends Component {
    static supports(info: ReportInfo): boolean {
        return !!info?.atkSide?.units?.length&&!!info?.defSide?.units?.length
            &&[info.atkSide,info.defSide].every(side=>side.units.length<=3&&side.units.every(unit=>
                !!paintedHero(Number(unit.cfgId))||(String(side.ownerId||0)==='0'&&Number(unit.cfgId)>0&&Number(unit.cfgId)<1000)));
    }
    static open(parent: Node, info: ReportInfo, data: any): BattleReplayPaintedView {
        const scene = director.getScene();
        for (const old of scene.getComponentsInChildren(BattleReplayPaintedView)) {
            old.node.active = false; old.node.destroy();
        }
        const size = parent.getComponent(UITransform);
        const root = new Node('PaintedBattleReplay'); root.layer = LAYER; root.active = false;
        root.addComponent(UITransform).setContentSize(size.width, size.height);
        root.addComponent(BlockInputEvents); scene.addChild(root);
        const cameraNode = new Node('Replay UI Camera'); root.addChild(cameraNode); cameraNode.setPosition(0, 0, 1000);
        const camera = cameraNode.addComponent(Camera); camera.visibility = LAYER; camera.priority = 100;
        camera.projection = Camera.ProjectionType.ORTHO; camera.orthoHeight = size.height / 2;
        camera.near = 0; camera.far = 2000; camera.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
        const canvas = root.addComponent(Canvas); canvas.alignCanvasWithScreen = false; canvas.cameraComponent = camera;
        const view = root.addComponent(BattleReplayPaintedView); view.initialize(info, data); root.active = true;
        return view;
    }
    private replay: ReportReplay;
    private armies = new Map<string, Army>();
    private figures: Figure[] = [];
    private owned: SpriteFrame[] = [];
    private atlases: PaintedPuppetAtlas[] = [];
    private equipment: PaintedEquipmentAtlas;
    private arrows: Node[] = [];
    private world: Node;
    private bodies: Node;
    private tags: Node;
    private fx: Graphics;
    private progress: Graphics;
    private loading: Label;
    private narration: Label;
    private status: Label;
    private toggle: Node;
    private restartButton: Node;
    private speedButton: Node;
    private cameraButton: Node;
    private width = 1280;
    private height = 720;
    private scale = 1;
    private ready = false;
    private playing = false;
    private speed = 1;
    private follow = false;
    private zoom = 1;
    private cameraOffset = new Vec3();
    private clock = 0;
    private elapsed = 0;
    private action: any = null;
    private impacted = false;
    private source: Army = null;
    private target: Army = null;
    private contact = new Vec3();
    private bursts: Burst[] = [];
    private skillEffects: PaintedBattleSkillEffects;
    private hasSkillEffect = false;
    private spellAction = false;
    private seeking = false;
    private scrubbing = false;
    private resumeAfterScrub = false;
    private progressRatio = -1;

    initialize(info: ReportInfo, data: any): void {
        this.replay = new ReportReplay(info, data.actions || []);
        const size = this.node.getComponent(UITransform);
        this.width = size.width; this.height = size.height; this.scale = Math.min(this.width / 1280, this.height / 720);
        const top = this.height / 2, bottom = -top;
        inkSurface(this.node, 'Loading backdrop', this.width, this.height, new Color(14, 31, 46), null);
        this.world = this.ui(this.node, 'Battlefield');
        this.bodies = this.ui(this.world, 'Characters'); this.tags = this.ui(this.world, 'Names');
        this.fx = this.ui(this.world, 'Brushstroke effects').addComponent(Graphics);
        const header = this.ui(this.node, 'Header'); place(header, 0, top - 30, this.width, 60);
        inkSurface(header, 'Shade', this.width, 60, new Color(10, 23, 34, 220), null);
        caption(header, 'Title', '战阵 · 回放', -this.width / 2 + 106, 0, 180, 22, C.text);
        caption(header, 'Sides', `${info.atkSide?.name || '攻方'}  对阵  ${info.defSide?.name || '守方'}`,
            0, 0, Math.max(120, this.width - 460), 15, new Color(211, 213, 195), Label.HorizontalAlign.CENTER);
        this.button(header, 'Close', '返回战报', this.width / 2 - 79, 0, 116, () => { this.node.active = false; this.node.destroy(); });
        const footer = this.ui(this.node, 'Controls'); place(footer, 0, bottom + 49, this.width, 98);
        inkSurface(footer, 'Shade', this.width, 98, new Color(10, 23, 34, 225), null);
        this.narration = caption(footer, 'Narration', '两军列阵，静候军令', 0, 28, this.width - 36, 15,
            new Color(230, 222, 199), Label.HorizontalAlign.CENTER);
        this.status = caption(footer, 'State', '正在准备战场', -this.width / 2 + 115, -17, 190, 13, C.muted);
        this.toggle = this.button(footer, 'Play', '播放', -106, -17, 104, () => this.togglePlay(), true);
        this.speedButton = this.button(footer, 'Speed', '1×', 0, -17, 80, () => {
            this.speed = this.speed === 4 ? 1 : this.speed * 2; this.controls();
        });
        this.restartButton=this.button(footer, 'Restart', '重播', 106, -17, 104, () => this.restart());
        this.cameraButton = this.button(footer, 'Camera', '全景', this.width / 2 - 77, -17, 112, () => {
            this.follow = !this.follow; this.controls();
        });
        this.progress = this.ui(footer, 'Progress').addComponent(Graphics); this.progress.node.setPosition(0, 11);
        this.progress.node.getComponent(UITransform).setContentSize(this.width-36,20);
        this.progress.node.on(Node.EventType.TOUCH_START,this.beginScrub,this);
        this.progress.node.on(Node.EventType.TOUCH_MOVE,this.moveScrub,this);
        this.progress.node.on(Node.EventType.TOUCH_END,this.endScrub,this);
        this.progress.node.on(Node.EventType.TOUCH_CANCEL,this.cancelScrub,this);
        this.loading = caption(this.node, 'Loading', '正在铺展战场…', 0, 0, this.width - 30, 17, C.gold, Label.HorizontalAlign.CENTER);
        this.controls(); void this.load(info);
    }
    private ui(parent: Node, name: string): Node {
        const node = new Node(name); node.layer = LAYER; node.addComponent(UITransform); parent.addChild(node); return node;
    }
    private button(parent: Node, name: string, text: string, x: number, y: number, width: number, action: () => void, primary = false): Node {
        const node = this.ui(parent, name); node.addComponent(Button); node.on(Button.EventType.CLICK, action, this);
        panelButton(node, text, x, y, width, 36, primary); return node;
    }
    private async load(info: ReportInfo): Promise<void> {
        const heroes=[...new Set([...(info.atkSide?.units||[]),...(info.defSide?.units||[])]
            .map(unit=>Number(unit.cfgId)).filter(id=>id!==1001&&!!paintedHero(id)))];
        const names = ['forest_battlefield','motion_red','motion_blue','motion_lubu','motion_lubu_cloth','skill_effects','infantry_equipment','skill_elements',
            ...heroes.map(id=>paintedHero(id).asset)];
        try {
            const [frames] = await Promise.all([
                Promise.all(names.map(name => new Promise<SpriteFrame>((resolve, reject) => {
                    resources.load(ASSETS + name + '/spriteFrame', SpriteFrame, (error, frame) => error ? reject(error) : resolve(frame));
                }))), ConfigManager.getInstance().ensureConfigs(['Hero', 'Monster', 'Skill'])
            ]);
            if (!isValid(this, true) || !isValid(this.node, true)) return;
            frames.forEach(frame => { frame.addRef(); this.owned.push(frame); });
            const background = this.ui(this.world, 'Painted forest'); background.setSiblingIndex(0);
            const backdrop = background.addComponent(Sprite); backdrop.sizeMode = Sprite.SizeMode.CUSTOM; backdrop.spriteFrame = frames[0];
            const cover = Math.max(this.width / 1672, this.height / 941);
            background.getComponent(UITransform).setContentSize(1672 * cover, 941 * cover);
            const [red,blue,lubu]=(['red','blue','lubu'] as PaintedKind[]).map((kind,i)=>new PaintedPuppetAtlas(kind,frames[i+1],frames[4],kind==='lubu'?paintedHero(1001):undefined));
            const heroAtlases=new Map<number,PaintedPuppetAtlas>([[1001,lubu]]);
            heroes.forEach((id,index)=>heroAtlases.set(id,new PaintedPuppetAtlas('hero',frames[index+8],undefined,paintedHero(id))));
            this.atlases.push(red,blue,...heroAtlases.values());
            this.equipment=new PaintedEquipmentAtlas(frames[6]);
            [info.atkSide, info.defSide].forEach((side, sideIndex) => {
                const units = [...(side?.units || [])].sort((a,b) => a.pos - b.pos);
                const counts = units.map(unit => Math.max(6, Math.min(12, Math.round((Number(unit.beforeSoldier?.count) || 0) / 50))));
                const total = counts.reduce((sum,n) => sum+n,0);
                const spacing = Math.min(34*this.scale, this.width*.80/(total+units.length));
                const gap = spacing*.7, span = total*spacing + Math.max(0,units.length-1)*gap;
                let offset = -span/2;
                units.forEach((unit,index) => {
                    const x = offset + counts[index]*spacing/2; offset += counts[index]*spacing+gap;
                    const sideNumber = sideIndex+1, key = `${sideNumber}:${unit.pos}`, count = Number(unit.beforeSoldier?.count)||0;
                    const profile=paintedHero(Number(unit.cfgId));
                    const weapon:PaintedWeapon=profile?.infantry||paintedInfantryWeapon(reportUnitName(side,unit));
                    const home = new Vec3(x, (sideIndex ? 65 : -48)*this.scale, 0);
                    const members: Figure[] = [];
                    for (let n=0;n<counts[index];n++) {
                        const figure = this.figure(sideIndex ? blue : red, (sideIndex ? 117 : 124)*this.scale,weapon);
                        figure.offset = (n-(counts[index]-1)/2)*spacing;
                        figure.phase = n*.71 + index*1.3; figure.alive = count>0; figure.deadTime=count>0?0:3; figure.node.active = figure.alive; members.push(figure);
                    }
                    // 稳定打散伤亡顺序，让阵线各处按兵力比例倒下，不从单侧整段消失。
                    members.sort((a,b)=>Math.sin(a.offset*1.73+unit.pos)-Math.sin(b.offset*1.73+unit.pos));
                    const leaderAtlas=profile?heroAtlases.get(profile.id):(sideIndex?blue:red);
                    const leader = this.figure(leaderAtlas, (profile?(sideIndex?172:units.length===1?218:204):148)*this.scale,profile?.weapon||weapon,sideNumber as 1|2);
                    leader.foot.set(x, (sideIndex ? 172 : -232)*this.scale,0);
                    leader.alive=count>0;
                    const title = this.ui(this.tags, `Leader ${key}`);
                    const name = caption(title,'Name',reportUnitName(side,unit),0,0,170*this.scale,14*this.scale,C.text,Label.HorizontalAlign.CENTER);
                    name.overflow = Label.Overflow.SHRINK;
                    const outline = name.node.addComponent(LabelOutline); outline.color = new Color(10,22,31); outline.width=2;
                    this.armies.set(key, { key, side:sideNumber, home, position:home.clone(), max:Math.max(1,count), count,
                        members, leader, title, order:0, hit:0, guard:0, motion:'idle',attack:'attack',command:'command',weapon,hero:profile });
                });
            });
            const flight=this.ui(this.world,'Arrow flight');
            for(let i=0;i<12;i++){
                const node=this.ui(flight,`Flying arrow ${i}`),sprite=node.addComponent(Sprite);
                sprite.sizeMode=Sprite.SizeMode.CUSTOM;sprite.spriteFrame=this.equipment.parts[5];
                node.getComponent(UITransform).setContentSize(6.6*this.scale,38*this.scale);
                node.active=false;this.arrows.push(node);
            }
            this.skillEffects=new PaintedBattleSkillEffects(this.world,frames[5],this.scale,this.width,this.height,key=>{
                const army=this.armies.get(key);if(!army)return null;
                let left=0,right=0;
                for(const member of army.members){left=Math.min(left,member.offset);right=Math.max(right,member.offset);}
                return {x:army.position.x,y:army.position.y,width:right-left+28*this.scale,
                    leaderX:army.leader.foot.x,leaderY:army.leader.foot.y};
            },frames[7]);
            this.ready=true; this.loading.node.active=false; this.controls(); this.render(0);
        } catch (error) {
            if (!isValid(this,true)) return;
            this.loading.string='战场资源暂未就绪，请返回后重试'; console.error('[PaintedBattleReplay]',error);
        }
    }
    private figure(atlas: PaintedPuppetAtlas, size: number,weapon:PaintedWeapon,facing:1|2=1): Figure {
        const hero=atlas.kind==='lubu'||atlas.kind==='hero',node=this.ui(this.bodies,hero?atlas.profile.name:'Infantry');
        const figure:Figure={node,rig:new PaintedBattlePuppet(node,atlas,size,weapon,this.equipment,facing),opacity:node.addComponent(UIOpacity),hero,
            alive:true,deadTime:0,deathDelay:0,phase:0,offset:0,foot:new Vec3(),fallFoot:new Vec3()};
        this.figures.push(figure);return figure;
    }
    private togglePlay(): void {
        if (!this.ready||this.scrubbing) return;
        if (this.replay.finished&&!this.action) this.restart();
        else { this.playing=!this.playing;this.controls(); }
    }
    private restart(): void {
        if (!this.ready) return;
        this.replay.reset();this.action=null;this.source=null;this.target=null;this.clock=0;this.elapsed=0;
        this.bursts.length=0;this.fx.clear();this.skillEffects?.reset();this.hasSkillEffect=false;this.impacted=false;
        this.arrows.forEach(node=>node.active=false);
        for(const army of this.armies.values()) {
            army.count=this.replay.soldiers.get(army.key)||0;army.position.set(army.home);army.motion='idle';army.order=0;army.hit=0;army.guard=0;
            army.leader.foot.set(army.home.x,(army.side===1?-232:172)*this.scale,0);army.leader.node.active=true;
            for(const f of [...army.members,army.leader]){f.alive=army.count>0;f.deadTime=army.count>0?0:3;f.deathDelay=0;
                if(!this.seeking){f.opacity.opacity=255;f.node.active=f.alive;f.rig.animate('idle',0,0,true);}}
        }
        this.playing=true;this.narration.string='两军列阵，静候军令';this.controls();this.render(0,!this.seeking);
    }
    private beginScrub(event:EventTouch):void {
        if(!this.ready||!this.replay.actions.length)return;
        event.propagationStopped=true;this.resumeAfterScrub=this.playing;this.scrubbing=true;this.playing=false;
        this.moveScrub(event);
    }
    private moveScrub(event:EventTouch):void {
        if(!this.scrubbing)return;event.propagationStopped=true;
        const at=event.getLocation();
        const world=this.node.getComponent(Canvas).cameraComponent.screenToWorld(new Vec3(at.x,at.y,0));
        const local=this.progress.node.getComponent(UITransform).convertToNodeSpaceAR(world);
        this.seekTo((local.x+this.width/2-18)/(this.width-36));
    }
    private endScrub(event:EventTouch):void { if(!this.scrubbing)return;this.moveScrub(event);this.finishScrub(); }
    private cancelScrub():void { if(this.scrubbing)this.finishScrub(); }
    private finishScrub():void {
        this.scrubbing=false;this.playing=this.resumeAfterScrub&&!(this.replay.finished&&!this.action);this.controls();
    }
    /** 从已记录的行动重建到目标时间；只推进状态，最后一次性刷新角色和特效。 */
    private seekTo(ratio:number):void {
        if(!this.ready||!Number.isFinite(ratio))return;
        const time=Math.max(0,Math.min(1,ratio))*END*this.replay.actions.length,wasPlaying=this.playing;
        this.seeking=true;
        try{
            this.restart();
            let left=time;
            while(left>1e-7){const step=Math.min(1/30,left);this.advance(step);left-=step;}
        }finally{this.seeking=false;}
        this.playing=wasPlaying&&!this.scrubbing&&!(this.replay.finished&&!this.action);
        this.render(0,true,0,true);this.camera(1);this.controls();
    }
    private startAction(): void {
        if(this.replay.finished){this.playing=false;this.narration.string=`${reportResult(this.replay.info.brief.result)} · 战斗结束`;this.controls();return;}
        this.action=this.replay.actions[this.replay.cursor];this.elapsed=0;this.impacted=false;
        this.source=this.armies.get(`${this.action.fromSide}:${this.action.fromPos}`)||null;
        const effect=(this.action.effects||[]).find((e:any)=>e.targetSide!==this.action.fromSide)||this.action.effects?.[0];
        this.target=effect?this.armies.get(`${effect.targetSide}:${effect.targetPos}`)||null:null;
        this.narration.string=replayLines(this.action,this.replay.info)[0]||'两军交锋';
        const cue=this.source?.count>0?paintedSkillCue(this.action,reportConfig('Skill',this.action.skillId)):null;
        this.spellAction=!!cue?.style&&cue.style.family!=='cleave'&&cue.style.family!=='thrust';
        if(this.source&&this.source.count>0){
            this.source.attack=this.isRanged(this.source)?'shoot':this.source.weapon==='sabre'?'slash':
                Number(this.action.actType)===2||Number(this.action.actType)===4?'sweep':'attack';
            this.source.command=this.source.hero?.caster&&Number(this.action.skillId)>0?'cast':this.source.attack==='sweep'?'rally':'command';
            this.source.order=PAINTED_CLIPS[this.source.command].duration;
        }
        if(this.target&&this.target!==this.source&&this.target.count>0)this.target.guard=1.25;
        if(this.canCharge()) this.contact.set(this.target.position.x,this.target.position.y+(this.source.side===1?-42:42)*this.scale,0);
        this.hasSkillEffect=!!cue;this.skillEffects?.begin(cue,this.actionImpactTime());
    }
    private actionImpactTime(): number {
        const clip=PAINTED_CLIPS[this.source?.attack||'attack'];return APPROACH+clip.duration*clip.impact;
    }
    private canCharge(): boolean {
        return !this.spellAction&&!!this.source&&this.source.count>0&&!this.isRanged(this.source)&&!!this.target&&this.source.side!==this.target.side&&[1,2,4].indexOf(Number(this.action?.actType))>=0;
    }
    private isRanged(army:Army):boolean { return army?.weapon==='bow'||army?.weapon==='crossbow'; }
    private canShoot():boolean {
        return !this.spellAction&&!!this.source&&this.source.count>0&&this.isRanged(this.source)&&!!this.target&&this.source.side!==this.target.side
            &&[1,2,4].indexOf(Number(this.action?.actType))>=0;
    }
    private impact(): void {
        this.impacted=true;this.replay.step();
        for(const effect of this.action.effects||[]) {
            const army=this.armies.get(`${effect.targetSide}:${effect.targetPos}`);if(!army)continue;
            const before=army.count;army.count=this.replay.soldiers.get(army.key)||0;
            const survivors=army.count>0?Math.max(1,Math.round(army.members.length*army.count/army.max)):0;
            let loss=0;
            army.members.forEach((f,index)=>{
                if(index<survivors){if(!f.alive){f.alive=true;f.deadTime=0;
                    if(!this.seeking){f.node.active=true;f.opacity.opacity=255;f.rig.animate('idle',0,0,true);}}return;}
                if(!f.alive)return;f.alive=false;f.deadTime=0;f.deathDelay=(loss++%5)*.045;
                f.fallFoot.set(army.position.x+f.offset,army.position.y,0);
            });
            if(army.count<before)army.hit=PAINTED_CLIPS.hit.duration;
            if(!this.hasSkillEffect&&!(effect.flags&6)) this.bursts.push({x:army.position.x,y:army.position.y+34*this.scale,age:0,
                heal:army.count>before,critical:!!(effect.flags&1)});
        }
        this.controls();
    }
    update(dt: number): void {
        if(!this.ready||!this.node.activeInHierarchy)return;
        const step=this.playing?Math.min(dt,.1)*this.speed:0;
        if(step>0)this.advance(step);
        this.render(0,true,step);this.camera(dt);this.drawProgress();
    }
    private advance(step:number):void {
        let remaining=step;
        while(remaining>1e-7&&(!this.replay.finished||this.action)){
            if(!this.action)this.startAction();
            if(this.action){
                // 精确切在命中与行动结束点，倍速和拖动都使用同一条时间线。
                const impactAt=this.actionImpactTime();
                const segment=Math.min(remaining,END-this.elapsed,this.impacted?Infinity:Math.max(0,impactAt-this.elapsed));
                this.elapsed+=segment;this.clock+=segment;remaining-=segment;
                if(this.canCharge()){
                    if(this.elapsed<APPROACH){const t=this.elapsed/APPROACH;Vec3.lerp(this.source.position,this.source.home,this.contact,t*t*(3-2*t));this.source.motion='rush';}
                    else if(this.elapsed<RETURN){this.source.position.set(this.contact);this.source.motion='attack';}
                    else{const t=Math.min(1,(this.elapsed-RETURN)/(END-RETURN));Vec3.lerp(this.source.position,this.contact,this.source.home,t*t*(3-2*t));this.source.motion='march';}
                }else if(this.canShoot())this.source.motion=this.elapsed>=APPROACH&&this.elapsed<RETURN?'attack':'idle';
                this.render(segment,false);
                if(!this.impacted&&this.elapsed>=impactAt-1e-7)this.impact();
                if(this.elapsed>=END-1e-7){
                    if(this.source&&this.source.count>0){this.source.position.set(this.source.home);this.source.motion='idle';}
                    this.action=null;this.skillEffects?.reset();this.hasSkillEffect=false;
                    if(this.replay.finished){this.playing=false;this.narration.string=`${reportResult(this.replay.info.brief.result)} · 战斗结束`;this.controls();}
                }
            }
        }
    }
    private render(step: number,paint=true,poseStep=step,snap=false): void {
        for(const army of this.armies.values()){
            army.order=Math.max(0,army.order-step);army.hit=Math.max(0,army.hit-step);army.guard=Math.max(0,army.guard-step);
            army.members.forEach(f=>{
                let motion:PaintedMotion='idle',time=this.clock+f.phase*.16;
                if(!f.alive){
                    f.deadTime+=step;const t=f.deadTime-f.deathDelay;
                    motion='fall';time=Math.max(0,t);f.foot.set(f.fallFoot);
                    if(paint){f.opacity.opacity=t>2?Math.max(0,Math.round(255*(1-(t-2)/.9))):255;f.node.active=t<2.9;}
                }else{
                    if(paint){f.opacity.opacity=255;f.node.active=true;}f.foot.set(army.position.x+f.offset,army.position.y,0);
                    if(army.hit>0){motion='hit';time=PAINTED_CLIPS.hit.duration-army.hit;}
                    else if(army.motion==='attack'){motion=army.attack;time=Math.max(0,this.elapsed-APPROACH-Math.sin(f.phase)*.02);}
                    else if(army.motion==='rush'||army.motion==='march'){motion=army.motion;time=this.clock+f.phase*.055;}
                    else if(army.guard>0){motion='guard';time=PAINTED_CLIPS.guard.duration*(1-army.guard/1.25);}
                }
                if(paint){if(f.node.active)f.rig.animate(motion,time,poseStep,snap);f.node.setPosition(f.foot);}
            });
            const leader=army.leader;
            let motion:PaintedMotion='idle',time=this.clock;
            if(army.order>0){motion=army.command;time=PAINTED_CLIPS[motion].duration-army.order;}
            if(army.count>0)leader.alive=true;
            if(army.count<=0&&leader.alive){leader.foot.y+=(army.side===1?-1:1)*step*18*this.scale;motion='march';time=this.clock;}
            if(paint){
                leader.node.active=army.count>0||(leader.alive&&Math.abs(leader.foot.y)<=this.height/2-70);
                if(leader.node.active)leader.rig.animate(motion,time,poseStep,snap);leader.node.setPosition(leader.foot);
                army.title.active=leader.node.active;army.title.setPosition(leader.foot.x,leader.foot.y-18*this.scale);
            }
        }
        if(!paint){this.bursts.forEach(b=>b.age+=step);this.bursts=this.bursts.filter(b=>b.age<.42);return;}
        // 低处角色后绘制；尸体处于活兵身后，避免遮住尚在战斗的单位。
        const order=[...this.figures].sort((a,b)=>Number(a.alive)-Number(b.alive)||b.foot.y-a.foot.y);
        order.forEach((f,index)=>f.node.setSiblingIndex(index));
        this.paintEffects(step);
        this.paintArrows();
        this.skillEffects?.frame(this.elapsed,this.impacted);
    }
    private paintArrows():void {
        const source=this.source,target=this.target;
        const active=this.canShoot();
        const release=APPROACH+PAINTED_CLIPS.shoot.duration*.46;
        const t=active?(this.elapsed-release)/(this.actionImpactTime()-release):-1;
        const members=active?source.members.filter(f=>f.alive):[];
        this.arrows.forEach((node,i)=>{
            const f=members[i];node.active=!!f&&t>=0&&t<1;if(!node.active)return;
            const sx=source.position.x+f.offset,sy=source.position.y+52*this.scale;
            const ex=target.position.x+f.offset*.42,ey=target.position.y+36*this.scale;
            node.setPosition(sx+(ex-sx)*t,sy+(ey-sy)*t+Math.sin(Math.PI*t)*28*this.scale);
            const dy=ey-sy+Math.cos(Math.PI*t)*Math.PI*28*this.scale;
            node.setRotationFromEuler(0,0,Math.atan2(dy,ex-sx)*180/Math.PI-90);
        });
    }
    private camera(dt: number): void {
        const active=this.follow&&this.action&&this.source&&this.target;
        const aim=active?new Vec3(-(this.source.position.x+this.target.position.x)*.15,-(this.source.position.y+this.target.position.y)*.12,0):new Vec3();
        const blend=Math.min(1,Math.max(0,dt)*4);
        this.zoom+=((active?1.12:1)-this.zoom)*blend;Vec3.lerp(this.cameraOffset,this.cameraOffset,aim,blend);
        this.world.setScale(this.zoom,this.zoom,1);
        this.world.setPosition(this.cameraOffset.x+(this.skillEffects?.shakeX||0),this.cameraOffset.y+(this.skillEffects?.shakeY||0),0);
    }
    private paintEffects(step: number): void {
        const g=this.fx;g.clear();
        for(const b of this.bursts){
            b.age+=step;const t=b.age/.42;if(t>=1)continue;
            const r=(b.critical?42:30)*this.scale,alpha=Math.round(230*(1-t));
            const colour=b.heal?new Color(129,238,187,alpha):new Color(255,221,143,alpha);
            g.strokeColor=colour;g.lineWidth=(6*(1-t)+1)*this.scale;
            // 短促笔触刀光与火星，落点随战报目标；无数字、血条和阵营底盘。
            g.moveTo(b.x-r,b.y-r*.35);g.quadraticCurveTo(b.x+r*.15,b.y+r*1.15,b.x+r,b.y+r*.3);g.stroke();
            if(t<.48){g.fillColor=new Color(255,250,218,alpha);const radius=r*(1-t)*.65;
                for(let i=0;i<8;i++){const a=i*Math.PI/4,d=i%2?radius*.25:radius;
                    if(i===0)g.moveTo(b.x+Math.cos(a)*d,b.y+Math.sin(a)*d);else g.lineTo(b.x+Math.cos(a)*d,b.y+Math.sin(a)*d);}
                g.close();g.fill();}
            g.strokeColor=colour;g.lineWidth=2*this.scale;
            for(let i=0;i<6;i++){const a=i*2.4,d=r*(.8+t*1.5),dx=Math.cos(a),dy=Math.sin(a);
                g.moveTo(b.x+dx*d,b.y+dy*d*.6);g.lineTo(b.x+dx*(d+8*this.scale),b.y+dy*(d+8*this.scale)*.6);g.stroke();}
        }
        this.bursts=this.bursts.filter(b=>b.age<.42);
    }
    private controls(): void {
        if(this.seeking)return;
        const finished=this.replay.finished&&!this.action;
        this.restartButton.active=!finished;
        this.toggle.setPosition(finished?-46:-106,-17);
        this.speedButton.setPosition(finished?58:0,-17);
        this.toggle.getComponentInChildren(Label).string=finished?'重播':this.playing?'暂停':'播放';
        this.toggle.getComponent(Button).interactable=this.ready&&this.replay.actions.length>0;
        this.speedButton.getComponentInChildren(Label).string=`${this.speed}×`;
        this.cameraButton.getComponentInChildren(Label).string=this.follow?'跟随':'全景';
        this.status.string=!this.ready?'正在准备战场':this.scrubbing?`定位中 · ${this.timeLabel(this.clock)}`:
            finished?'战斗结束':this.playing?'两军交锋':this.action||this.replay.cursor?'已暂停':'列阵待命';
        this.drawProgress();
    }
    private timeLabel(time:number):string { const pad=(n:number)=>n<10?'0'+n:String(n);return `${pad(Math.floor(time/60))}:${pad(Math.floor(time%60))}`; }
    private drawProgress():void {
        if(!this.progress)return;
        const ratio=Math.max(0,Math.min(1,this.clock/(END*Math.max(1,this.replay.actions.length))));
        if(Math.abs(ratio-this.progressRatio)<1e-7)return;this.progressRatio=ratio;
        const w=this.width-36,g=this.progress,x=-w/2+w*ratio;g.clear();
        g.fillColor=new Color(58,77,86);g.roundRect(-w/2,-1.5,w,3,1.5);g.fill();
        g.fillColor=C.gold;if(ratio>0){g.roundRect(-w/2,-1.5,w*ratio,3,1.5);g.fill();}
        g.fillColor=new Color(240,217,158);g.circle(x,0,4);g.fill();
    }
    onDisable(): void { this.playing=false; }
    onDestroy(): void { this.skillEffects?.destroy();this.equipment?.destroy();this.atlases.forEach(atlas=>atlas.destroy());this.owned.forEach(frame=>frame.decRef()); }
}
