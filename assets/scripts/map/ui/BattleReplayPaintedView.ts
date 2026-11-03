import { _decorator, BlockInputEvents, Button, Camera, Canvas, Color, Component, director, EventTouch, Graphics,
    isValid, Label, Mask, Node, Rect, Size, Sprite, SpriteFrame, UIOpacity, UITransform, Vec2, Vec3 } from 'cc';
import { ReportInfo } from '../../battle/BattleCommand';
import ReportReplay from '../../battle/ReportReplay';
import { replayLines, reportConfig, reportResult, reportUnitName } from '../../battle/ReportPresentation';
import ConfigManager from '../../core/ConfigManager';
import { caption, inkSurface, ManagementColors as C, panelButton, place } from './ManagementStyle';
import { PaintedEquipmentAtlas, paintedInfantryWeapon, PaintedWeapon } from './PaintedBattlePuppet';
import { PAINTED_CLIPS, PaintedMotion } from './PaintedBattleMotion';
import PaintedBattleSkillEffects from './PaintedBattleSkillEffects';
import { paintedSkillCue } from './PaintedSkillCue';
import { paintedHero, PaintedHeroProfile } from './PaintedHeroCatalog';
import { BattleReplayHud, replayArmyHome, replayFormation, replayVisualCount, replayImpactGroups, replayControlIcon, replayCommanderBadge } from './BattleReplayPresentation';
import { BattleReplayActor, REPLAY_DEFEAT_DURATION, replayDefeatOpacity, replayActionPoseTime, replayReturnHeading, loadReplayActors, ReplayActorAssets, ReplayActorKind } from './BattleReplayActor';
import { BattleSkillAccents, BattleSkillAnnouncement } from './BattleReplaySkillView';

import { BattleReplayStage, loadReplayStage } from './BattleReplayStage';

const { ccclass } = _decorator;
const LAYER = 1 << 19, APPROACH = .85, RETURN = 2.02, END = 2.85;
type Motion = 'idle' | 'rush' | 'attack' | 'march';
interface Figure {
    node: Node; rig: BattleReplayActor; opacity: UIOpacity; hero: boolean;
    alive: boolean; deadTime: number; deathDelay: number; phase: number; offset: number; depth: number;
    foot: Vec3; fallFoot: Vec3;
}
interface Army {
    key: string; side: number; home: Vec3; position: Vec3; max: number; count: number;
    members: Figure[]; leader: Figure; leaderHome: Vec3; title: Node; strength: Graphics; order: number; hit: number; guard: number; motion: Motion;
    attack: 'attack' | 'sweep' | 'slash' | 'shoot'; command: 'command' | 'rally' | 'cast'; weapon:PaintedWeapon; hero?:PaintedHeroProfile;
}
interface Burst { x: number; y: number; age: number; heal: boolean; critical: boolean; }

/** 沿用大地图人物的军阵回放；兵力变化完全来自战报，不重新结算战斗。 */
@ccclass('BattleReplayPaintedView')
export default class BattleReplayPaintedView extends Component {
    static async prepare(): Promise<{ frames: SpriteFrame[]; actorAssets: ReplayActorAssets }> {
        const [frames, actorAssets] = await Promise.all([loadReplayStage(), loadReplayActors(),
            ConfigManager.getInstance().ensureConfigs(['Hero', 'Monster', 'Skill'])]);
        return { frames, actorAssets };
    }
    static supports(info: ReportInfo): boolean {
        return !!info?.atkSide?.units?.length&&!!info?.defSide?.units?.length
            &&[info.atkSide,info.defSide].every(side=>side.units.length<=3&&side.units.every(unit=>Number(unit.cfgId)>0));
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
    private actorAssets: ReplayActorAssets;
    private equipment: PaintedEquipmentAtlas;
    private arrows: Node[] = [];
    private world: Node;
    private bodies: Node;
    private tags: Node;
    private fx: Graphics;
    private groundFx: Graphics;
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
    private hud: BattleReplayHud;
    private hitNumbers: Array<{ node: Node; x: number; y: number; age: number }> = [];
    private impactHold = 0;
    private staging: BattleReplayStage;
    private timeCaption: Label;
    private lastTimeLabel = '';
    private lastDepthOrder = '';
    private skillAccents: BattleSkillAccents;
    private skillAnnouncement: BattleSkillAnnouncement;

    initialize(info: ReportInfo, data: any): void {
        this.replay = new ReportReplay(info, data.actions || []);
        this.hitNumbers = []; this.follow = true; this.impactHold = 0;
        const size = this.node.getComponent(UITransform);
        this.width = size.width; this.height = size.height;
        this.scale = Math.min(this.width / 1280, Math.max(1, this.height - 218) / 520);
        const top = this.height / 2, bottom = -top;
        inkSurface(this.node, 'Loading backdrop', this.width, this.height, new Color(37, 40, 28), null);
        const viewport = this.ui(this.node, 'Battlefield viewport');
        place(viewport, 0, -7, this.width, Math.max(1, this.height - 218));
        viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        this.world = this.ui(viewport, 'Battlefield');
        this.groundFx = this.ui(this.world, 'Ground battle feedback').addComponent(Graphics);
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
        this.narration.overflow = Label.Overflow.SHRINK;
        this.status = caption(footer, 'State', '正在准备战场', -this.width / 2 + 115, -17, 190, 13, C.muted);
        this.toggle = this.button(footer, 'Play', '播放', -106, -17, 104, () => this.togglePlay(), true);
        this.speedButton = this.button(footer, 'Speed', '1×', 0, -17, 80, () => {
            this.speed = this.speed === 4 ? 1 : this.speed * 2; this.controls();
        });
        this.restartButton=this.button(footer, 'Restart', '重播', 106, -17, 104, () => this.restart());
        this.cameraButton = this.button(footer, 'Camera', '全景', this.width / 2 - 77, -17, 112, () => {
            this.follow = !this.follow; this.camera(0); this.controls();
        });
        this.progress = this.ui(footer, 'Progress').addComponent(Graphics); this.progress.node.setPosition(0, 11);
        this.progress.node.getComponent(UITransform).setContentSize(this.width-36,28);
        this.progress.node.on(Node.EventType.TOUCH_START,this.beginScrub,this);
        this.progress.node.on(Node.EventType.TOUCH_MOVE,this.moveScrub,this);
        this.progress.node.on(Node.EventType.TOUCH_END,this.endScrub,this);
        this.progress.node.on(Node.EventType.TOUCH_CANCEL,this.cancelScrub,this);
        this.loading = caption(this.node, 'Loading', '正在铺展战场…', 0, 0, this.width - 30, 17, C.gold, Label.HorizontalAlign.CENTER);
        this.hud = new BattleReplayHud(this.node, info, this.width, this.height);
        this.timeCaption = caption(footer, 'Elapsed', '00:00 / ' + this.timeLabel(END * this.replay.actions.length),
            -this.width / 2 + 115, -36, 190, 11, C.muted);
        this.timeCaption.node.active = this.width >= 700;
        this.status.node.setPosition(-this.width / 2 + 115, -15);
        this.skillAnnouncement = new BattleSkillAnnouncement(this.node, this.width, this.height);
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
        try {
            const { frames, actorAssets } = await BattleReplayPaintedView.prepare();
            if (!isValid(this, true) || !isValid(this.node, true)) return;
            frames.forEach(frame => { frame.addRef(); this.owned.push(frame); });
            this.actorAssets = actorAssets;
            const background = this.ui(this.world, 'Battlefield ground'); background.setSiblingIndex(0);
            const backdrop = background.addComponent(Sprite); backdrop.sizeMode = Sprite.SizeMode.CUSTOM;
            // 取景保留上缘营寨与远山；战场窗口很宽，直接 cover 整张图会把地平线裁掉。
            const sourceSize = frames[0].originalSize, stageHeight = Math.floor(sourceSize.height * .66);
            const stageFrame = new SpriteFrame(); stageFrame.name = 'Battlefield panorama';
            stageFrame.reset({ texture: frames[0].texture, rect: new Rect(0, 0, sourceSize.width, stageHeight),
                originalSize: new Size(sourceSize.width, stageHeight), offset: new Vec2() });
            stageFrame.packable = false; stageFrame.addRef(); this.owned.push(stageFrame); backdrop.spriteFrame = stageFrame;
            const imageSize = stageFrame.originalSize;
            const cover = Math.max(this.width / imageSize.width, (this.height - 218) / imageSize.height);
            background.getComponent(UITransform).setContentSize(imageSize.width * cover, imageSize.height * cover);
            this.equipment=new PaintedEquipmentAtlas(frames[2]);
            const standards = this.ui(this.world, 'Battle atmosphere'); standards.setSiblingIndex(2);
            this.staging = new BattleReplayStage(standards, this.scale, this.width, this.height);
            [info.atkSide, info.defSide].forEach((side, sideIndex) => {
                const units = [...(side?.units || [])].sort((a,b) => a.pos - b.pos);
                const counts = units.map(unit => replayVisualCount(Number(unit.beforeSoldier?.count) || 0));
                units.forEach((unit,index) => {
                    const sideNumber = sideIndex+1, key = `${sideNumber}:${unit.pos}`, count = Number(unit.beforeSoldier?.count)||0;
                    const profile=paintedHero(Number(unit.cfgId));
                    const unitName = reportUnitName(side, unit);
                    const weapon:PaintedWeapon=profile?.infantry||paintedInfantryWeapon(unitName);
                    const kind: ReplayActorKind = /骑/.test(unitName) ? 'cavalry' : weapon === 'bow' || weapon === 'crossbow' ? 'archer' : 'infantry';
                    const point = replayArmyHome(index, units.length, sideNumber, this.scale);
                    const home = new Vec3(point.x, point.y, 0);
                    const formation = replayFormation(counts[index], sideNumber, this.scale);
                    const members: Figure[] = [];
                    for (let n=0;n<counts[index];n++) {
                        const figure = this.figure(kind, (kind === 'cavalry' ? 90 : 82)*this.scale, sideNumber);
                        figure.offset = formation[n].x; figure.depth = formation[n].y;
                        figure.phase = n*.71 + index*1.3; figure.alive = count>0; figure.deadTime=count>0?0:3; figure.node.active = figure.alive; members.push(figure);
                    }
                    // 稳定打散伤亡顺序，让阵线各处按兵力比例倒下，不从单侧整段消失。
                    members.sort((a,b)=>Math.sin(a.offset*1.73+unit.pos)-Math.sin(b.offset*1.73+unit.pos));
                    const leaderKind: ReplayActorKind = profile ? 'cavalry' : kind;
                    const leader = this.figure(leaderKind, (leaderKind === 'cavalry' ? 100 : 84)*this.scale, sideNumber, true);
                    const leaderHome = new Vec3(home.x + (sideIndex ? -20 : 20)*this.scale, home.y + (sideIndex ? -10 : 10)*this.scale, 0);
                    leader.foot.set(leaderHome);
                    leader.alive=count>0; leader.deadTime=count>0?0:3;
                    const title = this.ui(this.tags, `Leader ${key}`);
                    const strength = replayCommanderBadge(title, side, unit, this.scale);
                    this.armies.set(key, { key, side:sideNumber, home, position:home.clone(), max:Math.max(1,count), count,
                        members, leader, leaderHome, title, strength, order:0, hit:0, guard:0, motion:'idle',attack:'attack',command:'command',weapon,hero:profile });
                });
            });
            const flight=this.ui(this.world,'Arrow flight');
            for(let i=0;i<16;i++){
                const node=this.ui(flight,`Flying arrow ${i}`),sprite=node.addComponent(Sprite);
                sprite.sizeMode=Sprite.SizeMode.CUSTOM;sprite.spriteFrame=this.equipment.parts[5];
                node.getComponent(UITransform).setContentSize(6.6*this.scale,38*this.scale);
                node.active=false;this.arrows.push(node);
            }
            const locate = (key:string) => {
                const army=this.armies.get(key);if(!army)return null;
                let left=0,right=0;
                for(const member of army.members){left=Math.min(left,member.offset);right=Math.max(right,member.offset);}
                return {x:army.position.x,y:army.position.y,width:right-left+28*this.scale,
                    leaderX:army.leader.foot.x,leaderY:army.leader.foot.y};
            };
            this.skillEffects=new PaintedBattleSkillEffects(this.world,frames[1],this.scale*.85,this.width,this.height,locate,frames[3]);
            this.skillEffects.captionEnabled = false;
            this.skillAccents=new BattleSkillAccents(this.world,this.scale,locate);
            this.ready=true; this.loading.node.active=false; this.controls(); this.render(0); this.camera(0);
        } catch (error) {
            if (!isValid(this,true)) return;
            this.loading.string='战场资源暂未就绪，请返回后重试'; console.error('[PaintedBattleReplay]',error);
        }
    }
    private figure(kind: ReplayActorKind, size: number, side: number, hero = false): Figure {
        const node=this.ui(this.bodies,hero?'Commander':kind);
        const figure:Figure={node,rig:new BattleReplayActor(node,this.actorAssets,kind,size,side),opacity:node.addComponent(UIOpacity),hero,
            alive:true,deadTime:0,deathDelay:0,phase:0,offset:0,depth:0,foot:new Vec3(),fallFoot:new Vec3()};
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
        this.skillAccents?.reset();this.skillAnnouncement?.reset();
        this.clearHitNumbers(); this.impactHold = 0;
        this.arrows.forEach(node=>node.active=false);
        for(const army of this.armies.values()) {
            army.count=this.replay.soldiers.get(army.key)||0;army.position.set(army.home);army.motion='idle';army.order=0;army.hit=0;army.guard=0;
            army.leader.foot.set(army.leaderHome);army.leader.node.active=true;
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
            // advance 已在每次命中和行动结束处精确切分；跳转只访问这些关键点。
            // 不为滑杆的每次移动重跑全部 30fps 中间姿态。
            this.advance(time);
        }finally{this.seeking=false;this.impactHold=0;}
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
        if(this.target&&this.target!==this.source&&this.target.count>0)this.target.guard=this.actionImpactTime()+.12;
        if(this.canCharge()) {
            const dx = this.target.position.x - this.source.home.x, dy = this.target.position.y - this.source.home.y;
            const distance = Math.max(1, Math.hypot(dx, dy));
            this.contact.set(this.target.position.x - dx / distance * 70*this.scale,
                this.target.position.y - dy / distance * 70*this.scale, 0);
        }
        this.hasSkillEffect=!!cue;this.skillEffects?.begin(cue,this.actionImpactTime());
        this.skillAccents?.begin(cue,this.actionImpactTime());this.skillAnnouncement?.begin(cue,this.replay.info);
        this.controls();
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
        for(const effect of replayImpactGroups(this.action.effects)) {
            const army=this.armies.get(effect.key);if(!army)continue;
            const before=army.count;army.count=this.replay.soldiers.get(army.key)||0;
            const survivors=army.count>0?Math.max(1,Math.round(army.members.length*army.count/army.max)):0;
            let loss=0;
            army.members.forEach((f,index)=>{
                if(index<survivors){if(!f.alive){f.alive=true;f.deadTime=0;
                    if(!this.seeking){f.node.active=true;f.opacity.opacity=255;f.rig.animate('idle',0,0,true);}}return;}
                if(!f.alive)return;f.alive=false;f.deadTime=0;f.deathDelay=(loss++%5)*.045;
                f.fallFoot.set(army.position.x+f.offset,army.position.y+f.depth,0);
            });
            if (!this.seeking) this.showHitNumber(army, army.count - before, effect.flags || 0);
            if(army.count<before){army.hit=PAINTED_CLIPS.hit.duration;if(!this.seeking)this.impactHold=.055;}
            if(!this.hasSkillEffect&&!(effect.flags&6)) this.bursts.push({x:army.position.x,y:army.position.y+34*this.scale,age:0,
                heal:army.count>before,critical:!!(effect.flags&1)});
        }
        this.controls();
    }
    update(dt: number): void {
        if(!this.ready||!this.node.activeInHierarchy||!this.playing)return;
        const frameTime = Math.min(dt, .1), hold = this.playing ? Math.min(frameTime, this.impactHold) : 0;
        this.impactHold -= hold;
        const step=this.playing?(frameTime-hold)*this.speed:0;
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
                    this.action=null;this.skillEffects?.reset();this.skillAccents?.reset();this.skillAnnouncement?.reset();this.hasSkillEffect=false;
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
                    if(paint){f.opacity.opacity=replayDefeatOpacity(t);f.node.active=t<REPLAY_DEFEAT_DURATION&&(!this.replay.finished||!!this.action);}
                }else{
                    if(paint){f.opacity.opacity=255;f.node.active=true;}f.foot.set(army.position.x+f.offset,army.position.y+f.depth,0);
                    if(army.hit>0){motion='hit';time=PAINTED_CLIPS.hit.duration-army.hit;}
                    else if(army.motion==='attack'){motion=army.attack;time=replayActionPoseTime(motion,this.elapsed-APPROACH,f.phase);}
                    else if(army.motion==='rush'||army.motion==='march'){motion=army.motion;time=this.clock+f.phase*.055;}
                    else if(army.guard>0 || army===this.source&&this.action&&this.spellAction&&this.elapsed<RETURN){
                        motion='guard';time=PAINTED_CLIPS.guard.duration*Math.min(1,this.elapsed/this.actionImpactTime());
                    }
                }
                if(paint){if(f.node.active){
                    const facing = this.armyFacing(army);
                    if (f.alive) f.rig.face(facing.x, facing.y);
                    f.rig.animate(motion,time,poseStep,snap);
                }f.node.setPosition(f.foot);}
            });
            const leader=army.leader;
            let motion:PaintedMotion='idle',time=this.clock;
            if(army.order>0){motion=army.command;time=PAINTED_CLIPS[motion].duration-army.order;}
            if(army.motion==='attack'&&(!this.isRanged(army)||leader.rig.kind==='archer')){
                motion=army.attack;time=Math.max(0,this.elapsed-APPROACH);
            }
            if(army.count>0){
                leader.alive=true;leader.deadTime=0;
                leader.foot.set(army.position.x + army.leaderHome.x - army.home.x,
                    army.position.y + army.leaderHome.y - army.home.y, 0);
                if (army.motion === 'rush' || army.motion === 'march') motion = army.motion;
            } else {
                if (leader.alive) { leader.alive=false;leader.deadTime=0; }
                leader.deadTime+=step;motion='fall';time=leader.deadTime;
            }
            if(paint){
                leader.node.active=army.count>0||leader.deadTime<REPLAY_DEFEAT_DURATION;
                leader.opacity.opacity=army.count>0?255:replayDefeatOpacity(leader.deadTime);
                if(leader.node.active){
                    const facing = this.armyFacing(army);leader.rig.face(facing.x,facing.y);
                    leader.rig.animate(motion,time,poseStep,snap);
                }leader.node.setPosition(leader.foot);
                army.title.active=army.count>0;army.title.setPosition(army.position.x+(army.side===1?-38:38)*this.scale,army.position.y+91*this.scale);
            }
        }
        this.paintHitNumbers(step, paint);
        if(!paint){this.bursts.forEach(b=>b.age+=step);this.bursts=this.bursts.filter(b=>b.age<.42);return;}
        // 低处角色后绘制；尸体处于活兵身后，避免遮住尚在战斗的单位。
        const order=[...this.figures].sort((a,b)=>Number(a.alive)-Number(b.alive)||b.foot.y-a.foot.y);
        const depthOrder = order.map(f=>f.node.uuid).join('|');
        if(depthOrder!==this.lastDepthOrder){this.lastDepthOrder=depthOrder;order.forEach((f,index)=>f.node.setSiblingIndex(index));}
        this.staging?.frame(this.clock);
        this.hud?.setPhase(this.replay.finished&&!this.action?'战斗结束':!this.action?'静候军令':
            this.elapsed<APPROACH?'蓄势':!this.impacted?'出手':this.elapsed<RETURN?'交锋':'收阵');
        this.paintGroundFeedback();
        this.paintEffects(step);
        this.paintArrows();
        this.skillEffects?.frame(this.elapsed,this.impacted);
        this.skillAccents?.frame(this.elapsed,this.impacted);this.skillAnnouncement?.frame(this.elapsed);
    }
    private armyFacing(army: Army): { x: number; y: number } {
        const towards = army.motion === 'march' ? army.home : army === this.source && this.target ? this.target.position
            : (army.hit > 0 || army.guard > 0) && this.source && this.source !== army ? this.source.position : null;
        const x = towards ? towards.x - army.position.x : army.side === 1 ? 1 : -1;
        const y = towards ? towards.y - army.position.y : army.side === 1 ? .5 : -.5;
        return army.motion === 'march' ? replayReturnHeading(x, y, this.elapsed - RETURN) : { x, y };
    }
    private paintArrows():void {
        const source=this.source,target=this.target;
        const active=this.canShoot();
        const release=APPROACH+PAINTED_CLIPS.shoot.duration*.46;
        const t=active?(this.elapsed-release)/(this.actionImpactTime()-release):-1;
        const members=active?source.members.filter(f=>f.alive):[];
        this.arrows.forEach((node,i)=>{
            const f=members[i];node.active=!!f&&t>=0&&t<1;if(!node.active)return;
            const sx=source.position.x+f.offset,sy=source.position.y+f.depth+44*this.scale;
            const ex=target.position.x+f.offset*.42,ey=target.position.y+36*this.scale;
            node.setPosition(sx+(ex-sx)*t,sy+(ey-sy)*t+Math.sin(Math.PI*t)*28*this.scale);
            const dy=ey-sy+Math.cos(Math.PI*t)*Math.PI*28*this.scale;
            node.setRotationFromEuler(0,0,Math.atan2(dy,ex-sx)*180/Math.PI-90);
        });
    }
    private camera(_dt: number): void {
        const active=this.follow&&this.action&&this.source&&this.target;
        const ease=(v:number)=>{const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t);};
        const focus=active?ease(this.elapsed/.65)*(1-ease((this.elapsed-(END-.55))/.55)):0;
        this.zoom=1+.065*focus;
        const mx=(this.zoom-1)*this.width*.45,my=(this.zoom-1)*this.height*.45;
        const x=active?-(this.source.position.x+this.target.position.x)*.12*focus:0;
        const y=active?-(this.source.position.y+this.target.position.y)*.12*focus:0;
        this.cameraOffset.set(Math.max(-mx,Math.min(mx,x)),Math.max(-my,Math.min(my,y)),0);
        this.world.setScale(this.zoom,this.zoom,1);
        this.world.setPosition(this.cameraOffset.x+(this.skillEffects?.shakeX||0),this.cameraOffset.y+(this.skillEffects?.shakeY||0),0);
    }
    private paintGroundFeedback(): void {
        const g=this.groundFx,s=this.scale;g.clear();
        for(const army of this.armies.values()){
            const live=army.members.filter(f=>f.alive);if(!live.length)continue;
            // 接敌与退回时，尘土沿各自落脚点向后散开，站定后立即停尘。
            if(army.motion==='rush'||army.motion==='march'){
                const target=army.motion==='march'?army.home:this.target?.position;
                const dx=target?target.x-army.position.x:1,dy=target?target.y-army.position.y:.5;
                const length=Math.max(1,Math.hypot(dx,dy));
                live.forEach((f,index)=>{if(index%2)return;
                    const age=(this.clock*2.3+f.phase*.21)%1,spread=(4+age*14)*s;
                    const x=f.foot.x-dx/length*age*18*s,y=f.foot.y-dy/length*age*18*s;
                    g.fillColor=new Color(193,167,109,Math.round(46*(1-age)));
                    g.ellipse(x,y,spread,spread*.3);g.fill();
                });
            }
            if(!this.action||(army!==this.source&&army!==this.target))continue;
            const x=live.reduce((sum,f)=>sum+f.foot.x,0)/live.length,y=live.reduce((sum,f)=>sum+f.foot.y,0)/live.length;
            g.strokeColor=army===this.source?new Color(237,208,130,135):new Color(202,111,81,115);g.lineWidth=1.5*s;
            // 四角只标出当前交战的阵位，不给人物添加悬空底盘。
            for(const sign of [-1,1]){
                g.moveTo(x+sign*75*s,y);g.lineTo(x+sign*62*s,y+7*s);g.stroke();
                g.moveTo(x+sign*75*s,y);g.lineTo(x+sign*62*s,y-7*s);g.stroke();
                g.moveTo(x,y+sign*38*s);g.lineTo(x-13*s,y+sign*31*s);g.stroke();
                g.moveTo(x,y+sign*38*s);g.lineTo(x+13*s,y+sign*31*s);g.stroke();
            }
        }
    }
    private paintEffects(step: number): void {
        const g=this.fx;g.clear();
        for(const b of this.bursts){
            b.age+=step;const t=b.age/.42;if(t>=1)continue;
            const r=(b.critical?42:30)*this.scale,alpha=Math.round(230*(1-t));
            const colour=b.heal?new Color(129,238,187,alpha):new Color(255,221,143,alpha);
            g.strokeColor=colour;g.lineWidth=(6*(1-t)+1)*this.scale;
            // 刀光与火星紧贴实际命中位置，伤害数字由兵力变化单独显示。
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
        if (this.width < 700) {
            this.toggle.setPosition(finished ? -82 : -118, -17);
            this.speedButton.setPosition(finished ? -2 : -48, -17);
            this.restartButton.setPosition(22, -17); this.cameraButton.setPosition(finished ? 78 : 102, -17);
        }
        this.status.node.active = this.width >= 700;
        this.toggle.getComponentInChildren(Label).string=finished?'重播':this.playing?'暂停':'播放';
        this.toggle.getComponent(Button).interactable=this.ready&&this.replay.actions.length>0;
        this.speedButton.getComponentInChildren(Label).string=`${this.speed}×`;
        this.cameraButton.getComponentInChildren(Label).string=this.follow?'跟随':'全景';
        this.status.string=!this.ready?'正在准备战场':this.scrubbing?`定位中 · ${this.timeLabel(this.clock)}`:
            finished?'战斗结束':this.playing?'两军交锋':this.action||this.replay.cursor?'已暂停':'列阵待命';
        const soldiers = [0, 0];
        for (const army of this.armies.values()) {
            soldiers[army.side - 1] += army.count;
            const g = army.strength, w = 76*this.scale, ratio = Math.min(1, army.count / army.max);
            g.clear(); g.fillColor = new Color(22, 24, 16, 225); g.rect(-w/2, -2*this.scale, w, 4*this.scale); g.fill();
            g.fillColor = army.side === 1 ? new Color(148, 192, 135) : new Color(210, 132, 106);
            if (ratio > 0) { g.rect(-w/2, -this.scale, w*ratio, 2*this.scale); g.fill(); }
        }
        this.hud?.update(soldiers, Number(this.action?.round) || this.replay.round,
            this.ready && finished && this.replay.actions.length > 0, this.replay.soldiers, this.action ? this.source?.key || '' : '');
        if(this.width>=700)replayControlIcon(this.toggle, 'Play', this.playing);
        [this.toggle,this.speedButton,this.restartButton,this.cameraButton].forEach(n=>n.setPosition(n.position.x,-20));
        if (finished) this.clearHitNumbers();
        this.drawProgress();
    }
    private showHitNumber(army: Army, change: number, flags: number): void {
        const text = flags & 2 ? '闪避' : flags & 4 ? '未命中' : change ? `${change > 0 ? '+' : ''}${change}` : '';
        if (!text) return;
        const node = this.ui(this.tags, 'DamageNumber');
        const color = change > 0 ? new Color(166, 224, 145) : flags & 1 ? new Color(255, 210, 114) : new Color(249, 227, 180);
        const value = caption(node, 'Value', text, 0, 0, 160*this.scale, Math.max(18, (flags & 1 ? 30 : 25)*this.scale), color, Label.HorizontalAlign.CENTER);
        value.isBold = true; value.outlineColor = new Color(39, 25, 17); value.outlineWidth = 2;
        node.addComponent(UIOpacity);
        this.hitNumbers.push({ node, x: army.position.x + (army.side === 1 ? 100 : -90)*this.scale, y: army.position.y + 50*this.scale, age: 0 });
    }
    private paintHitNumbers(step: number, paint: boolean): void {
        this.hitNumbers = this.hitNumbers.filter(hit => {
            hit.age += step;
            if (hit.age >= .85) { hit.node.removeFromParent(); hit.node.destroy(); return false; }
            if (paint) {
                hit.node.setPosition(hit.x, hit.y + hit.age*42*this.scale);
                const pop=1+.12*Math.max(0,1-hit.age/.16);hit.node.setScale(pop,pop,1);
                hit.node.getComponent(UIOpacity).opacity = Math.round(255*Math.min(1, (1-hit.age/.85)*2));
            }
            return true;
        });
    }
    private clearHitNumbers(): void {
        for (const hit of this.hitNumbers) { hit.node.removeFromParent(); hit.node.destroy(); }
        this.hitNumbers.length = 0;
    }
    private timeLabel(time:number):string { const pad=(n:number)=>n<10?'0'+n:String(n);return `${pad(Math.floor(time/60))}:${pad(Math.floor(time%60))}`; }
    private drawProgress():void {
        if(!this.progress)return;
        const timeText = this.timeLabel(this.clock) + ' / ' + this.timeLabel(END * this.replay.actions.length);
        if(this.timeCaption&&timeText!==this.lastTimeLabel){this.lastTimeLabel=timeText;this.timeCaption.string=timeText;}
        const ratio=Math.max(0,Math.min(1,this.clock/(END*Math.max(1,this.replay.actions.length))));
        if(Math.abs(ratio-this.progressRatio)<1e-7)return;this.progressRatio=ratio;
        const w=this.width-36,g=this.progress,x=-w/2+w*ratio;g.clear();
        g.fillColor=new Color(75,80,59);g.roundRect(-w/2,-2,w,4,2);g.fill();
        const actions=this.replay.actions.length;
        g.strokeColor=new Color(175,153,99,115);g.lineWidth=1;
        const stride=Math.max(1,Math.ceil(actions/60));
        for(let i=stride;i<actions;i+=stride){const mark=-w/2+w*i/actions;g.moveTo(mark,-4);g.lineTo(mark,4);}g.stroke();
        g.fillColor=C.gold;if(ratio>0){g.roundRect(-w/2,-1.5,w*ratio,3,1.5);g.fill();}
        g.fillColor=new Color(240,217,158);g.circle(x,0,4);g.fill();
    }
    onDisable(): void { this.playing=false; }
    onDestroy(): void { this.figures.forEach(f=>f.rig.destroy?.());this.skillEffects?.destroy();this.equipment?.destroy();this.owned.forEach(frame=>frame.decRef()); }
}
