import { _decorator, AnimationClip, BlockInputEvents, Button, Camera, Canvas, Color, Component, director,
    Graphics, instantiate, isValid, Label, LabelOutline, Material, Mesh, MeshRenderer, Node, Prefab, RenderTexture,
    resources, SkeletalAnimation, SkinnedMeshRenderer, Sprite, SpriteFrame, Texture2D, UITransform, Vec3, utils } from 'cc';
import { ReportInfo } from '../../battle/BattleCommand';
import ReportReplay from '../../battle/ReportReplay';
import ConfigManager from '../../core/ConfigManager';
import { replayLines, reportResult, reportUnitName } from '../../battle/ReportPresentation';
import { caption, inkSurface, ManagementColors as C, panelButton, place } from './ManagementStyle';

const { ccclass } = _decorator;
const LAYER = 1 << 20, UI_LAYER = 1 << 19, ORIGIN = 5000, APPROACH = .60, IMPACT = 1.2, RETURN = 2.05, END = 2.7;
const GREEN = new Color(136, 193, 151), RED = new Color(217, 127, 105);
interface HitBurst { actor: Actor; age: number; critical: boolean; heal: boolean; }
interface Soldier { node: Node; animation: SkeletalAnimation; alive: boolean; deadTime: number; }
interface Actor {
    key: string; side: number; node: Node; home: Vec3; animation: SkeletalAnimation;
    clip: string; clipTime: number; dead: boolean; max: number; count: number;
    plate: Node; commander: Soldier; commandTime: number; commandClip: string;
    members: Soldier[];
}

/** A report is the authority. The 3D stage only presents its recorded actions. */
@ccclass('BattleReplay3DView')
export default class BattleReplay3DView extends Component {
    static supports(info: ReportInfo): boolean {
        // The first art sample covers Lu Bu against NPC infantry. Other heroes keep their existing replay.
        return info?.atkSide?.units?.length === 1 && Number(info.atkSide.units[0].cfgId) === 1001
            && String(info.defSide?.ownerId || 0) === '0';
    }
    static open(parent: Node, info: ReportInfo, replay: any): BattleReplay3DView {
        for (const previous of director.getScene().getComponentsInChildren(BattleReplay3DView)) {
            previous.node.active = false; previous.node.destroy();
        }
        const root = new Node('BattleReplay3D'); root.layer = UI_LAYER; root.active = false;
        const size=parent.getComponent(UITransform);
        root.addComponent(UITransform).setContentSize(size.width,size.height);
        root.addComponent(BlockInputEvents); director.getScene().addChild(root);
        // 独立 UI 相机覆盖主界面，避免地图 HUD 在异步加载后跑到回放上方。
        const uiCameraNode=new Node('Replay UI Camera');root.addChild(uiCameraNode);uiCameraNode.setPosition(0,0,1000);
        const uiCamera=uiCameraNode.addComponent(Camera);uiCamera.visibility=UI_LAYER;uiCamera.priority=100;
        uiCamera.projection=Camera.ProjectionType.ORTHO;uiCamera.orthoHeight=size.height/2;
        uiCamera.near=0;uiCamera.far=2000;uiCamera.clearFlags=Camera.ClearFlag.DEPTH_ONLY;
        const canvas=root.addComponent(Canvas);canvas.alignCanvasWithScreen=false;canvas.cameraComponent=uiCamera;
        const player = root.addComponent(BattleReplay3DView); player.initialize(info, replay);
        root.active = true;
        return player;
    }
    private replay: ReportReplay;
    private stage: Node;
    private camera: Camera;
    private texture: RenderTexture;
    private frame: SpriteFrame;
    private viewport: Node;
    private window: Node;
    private overlay: Node;
    private status: Label;
    private narration: Label;
    private loading: Label;
    private progress: Graphics;
    private toggle: Node;
    private speedButton: Node;
    private cameraButton: Node;
    private actors = new Map<string, Actor>();
    private owned: (Material | Mesh)[] = [];
    private loadedPrefabs: Prefab[] = [];
    private groundTexture: Texture2D;
    private ready = false;
    private playing = false;
    private speed = 1;
    private action: any = null;
    private elapsed = 0;
    private impacted = false;
    private cinematic = false;
    private source: Actor = null;
    private target: Actor = null;
    private attackPoint = new Vec3();
    private width = 1060;
    private height = 650;
    private fieldW = 1028;
    private fieldH = 442;
    private cameraPos = new Vec3(0, 13, 11);
    private cameraAim = new Vec3(0, .1, 0);
    private spark: Node;
    private effects: Graphics;
    private bursts: HitBurst[] = [];
    private paintedMaterial: Material;
    private outlineMaterial: Material;

    initialize(info: ReportInfo, data: any): void {
        this.replay = new ReportReplay(info, data.actions || []);
        const available = this.node.getComponent(UITransform);
        this.width = available.width;
        this.height = available.height;
        this.fieldW = this.width; this.fieldH = this.height;
        place(this.node, 0, 0, available.width, available.height);
        inkSurface(this.node, 'Scrim', available.width, available.height, new Color(6, 10, 12, 252), null);
        this.window = this.ui(this.node, 'Window'); place(this.window, 0, 0, this.width, this.height);
        const top = this.height / 2, bottom = -top;
        this.viewport = this.ui(this.window, 'Viewport');
        place(this.viewport, 0, 0, this.fieldW, this.fieldH);
        const sprite = this.viewport.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.texture = new RenderTexture();
        const renderScale = Math.min(1.4, 1920 / this.fieldW);
        this.texture.initialize({ width: Math.round(this.fieldW * renderScale), height: Math.round(this.fieldH * renderScale) });
        this.frame = new SpriteFrame(); this.frame.texture = this.texture; this.frame.packable = false;
        sprite.spriteFrame = this.frame;
        this.overlay = this.ui(this.viewport, 'Overlay');
        this.loading = caption(this.viewport, 'Loading', '正在准备战场…', 0, 0, this.fieldW - 20, 17, C.gold, Label.HorizontalAlign.CENTER);
        const header = this.ui(this.window, 'HeaderShade');
        place(header, 0, top - 31, this.width, 62);
        inkSurface(header, 'Shade', this.width, 62, new Color(10, 21, 28, 185), null);
        const footer = this.ui(this.window, 'ControlsShade');
        place(footer, 0, bottom + 51, this.width, 102);
        inkSurface(footer, 'Shade', this.width, 102, new Color(10, 21, 28, 202), null);
        caption(this.window, 'Title', '三国 · 战阵', -this.width / 2 + 94, top - 28, 160, 23, C.text);
        this.button(this.window, 'Close', '返回战报', this.width / 2 - 76, top - 29, 112, () => {
            this.node.active = false; this.node.destroy();
        });
        const headline = `${info.atkSide?.name || '攻方'}   对阵   ${info.defSide?.name || '守方'}`;
        caption(this.window, 'Sides', headline, 0, top - 28, Math.max(160,this.fieldW - 420), 14, C.gold, Label.HorizontalAlign.CENTER);
        this.status = caption(this.window, 'Round', '', -this.width / 2 + 170, bottom + 28, 300, 12, C.gold);
        this.cameraButton = this.button(this.window, 'Camera', '镜头：全景', this.width / 2 - 81, bottom + 28, 124, () => {
            this.cinematic = !this.cinematic; this.controls();
        }, 28);
        this.narration = caption(this.window, 'Narration', '双方列阵，准备交锋', 0, bottom + 77, this.fieldW - 40, 14, C.text, Label.HorizontalAlign.CENTER);
        this.narration.enableWrapText = true; this.narration.overflow = Label.Overflow.SHRINK;
        this.narration.node.getComponent(UITransform).height = 38;
        this.progress = this.ui(this.window, 'Progress').addComponent(Graphics); this.progress.node.setPosition(0, bottom + 52);
        this.toggle = this.button(this.window, 'Play', '播放', -105, bottom + 31, 104, () => this.togglePlay(), 38, true);
        this.speedButton = this.button(this.window, 'Speed', '1×', 0, bottom + 31, 80, () => {
            this.speed = this.speed === 4 ? 1 : this.speed * 2; this.controls();
        }, 38);
        this.button(this.window, 'Restart', '重播', 105, bottom + 31, 104, () => this.restart(), 38);
        this.effects = this.ui(this.overlay, 'CombatEffects').addComponent(Graphics);
        this.createStage(); this.paint(); this.controls();
        void this.loadActors(info);
    }
    private ui(parent: Node, name: string): Node {
        const n = new Node(name); n.layer = this.node.layer; n.addComponent(UITransform); parent.addChild(n); return n;
    }
    private button(parent: Node, name: string, text: string, x: number, y: number, w: number, fn: () => void, h = 34, primary = false): Node {
        const n = this.ui(parent, name); n.addComponent(Button); n.on(Button.EventType.CLICK, fn, this);
        panelButton(n, text, x, y, w, h, primary); return n;
    }
    private material(color: Color, unlit = false): Material {
        const m = new Material(); m.initialize({ effectName: unlit ? 'builtin-unlit' : 'builtin-standard' });
        m.setProperty(unlit ? 'mainColor' : 'albedo', color);
        if (!unlit) { m.setProperty('roughness', .84); m.setProperty('metallic', .05); }
        this.owned.push(m); return m;
    }
    private object(name: string, mesh: Mesh, material: Material, parent = this.stage): Node {
        const n = new Node(name); n.layer = LAYER; parent.addChild(n);
        const r = n.addComponent(MeshRenderer); r.mesh = mesh; r.setMaterial(material, 0); return n;
    }
    private mesh(positions: number[], normals: number[], indices: number[]): Mesh {
        const mesh = utils.createMesh({ positions, normals, indices }); this.owned.push(mesh); return mesh;
    }
    private disk(radius: number, inner = 0, sides = 64): Mesh {
        const p: number[] = [], n: number[] = [], ix: number[] = [];
        for (let i = 0; i <= sides; i++) {
            const a = i / sides * Math.PI * 2;
            for (const r of [inner, radius]) { p.push(Math.cos(a) * r, 0, Math.sin(a) * r); n.push(0, 1, 0); }
            if (i < sides) { const j = i * 2; ix.push(j, j + 3, j + 1, j, j + 2, j + 3); }
        }
        return this.mesh(p, n, ix);
    }
    private createStage(): void {
        this.stage = new Node('Report3DStage'); this.stage.layer = LAYER; director.getScene().addChild(this.stage);
        this.stage.setPosition(ORIGIN, 0, 0);
        const cameraNode = new Node('ReplayCamera'); this.stage.addChild(cameraNode);
        this.camera = cameraNode.addComponent(Camera); this.camera.visibility = LAYER;
        this.camera.projection = Camera.ProjectionType.ORTHO; this.camera.orthoHeight = 5.6;
        this.camera.near = .05; this.camera.far = 70; this.camera.priority = -10;
        this.camera.clearFlags = Camera.ClearFlag.SOLID_COLOR; this.camera.clearColor = new Color(20, 39, 49, 255);
        this.camera.targetTexture = this.texture;
        this.paintedMaterial = new Material();
        this.paintedMaterial.initialize({effectName:'builtin-unlit', defines:{USE_VERTEX_COLOR:true,USE_INSTANCING:true}});
        this.owned.push(this.paintedMaterial);
        this.outlineMaterial = this.material(new Color(14, 22, 30), true);
        const ground = utils.createMesh({
            positions:[-13,-.03,-12, -13,-.03,12, 13,-.03,12, 13,-.03,-12],
            normals:[0,1,0,0,1,0,0,1,0,0,1,0], uvs:[0,0,0,1,1,1,1,0], indices:[0,1,2,0,2,3] });
        this.owned.push(ground);
        const earth = new Material(); earth.initialize({effectName:'builtin-unlit',defines:{USE_TEXTURE:true}});
        this.owned.push(earth); this.object('Painted clearing', ground, earth);
        resources.load('battle3d/sandbox/forest-clearing/texture', Texture2D, (error, texture) => {
            if (!isValid(this,true)) return;
            if (error) { console.error('[BattleReplay3D] 地表加载失败',error); return; }
            texture.addRef(); this.groundTexture=texture; earth.setProperty('mainTexture',texture);
        });
        this.spark=this.object('Strike ring',this.disk(.75,.70,36),this.material(new Color(232,203,134),true));
        this.spark.active=false; this.updateCamera(1);
    }
    private async loadActors(info: ReportInfo): Promise<void> {
        try {
            const load = (path: string) => new Promise<Prefab>((resolve, reject) => resources.load(path, Prefab,
                (err, asset) => err ? reject(err) : resolve(asset)));
            const [assets] = await Promise.all([
                Promise.all([load('battle3d/sandbox/commander/commander'), load('battle3d/sandbox/infantry/infantry'),
                    load('battle3d/sandbox/infantry-red/infantry-red')]),
                ConfigManager.getInstance().ensureConfigs(['Hero', 'Monster', 'Skill'])
            ]);
            if (!isValid(this, true) || !isValid(this.node, true)) return;
            assets.forEach(a => { a.addRef(); this.loadedPrefabs.push(a); });
            [info.atkSide, info.defSide].forEach((side, s) => {
                const units = [...(side?.units || [])].sort((a, b) => a.pos - b.pos);
                // 一兵约代表五十兵力；整侧横向排列，各部之间留出空隙。
                const counts = units.map(unit => Math.max(6, Math.min(12, Math.round((Number(unit.beforeSoldier?.count) || 0) / 50))));
                const spacing = .50, gap = .55;
                const lineWidth = counts.reduce((sum, n) => sum + n * spacing, 0) + Math.max(0, units.length - 1) * gap;
                let offset = -lineWidth / 2;
                units.forEach((unit, i) => {
                    const root = new Node(`Actor${s + 1}_${unit.pos}`); root.layer = LAYER; this.stage.addChild(root);
                    const members: Soldier[] = [];
                    const key = `${s + 1}:${unit.pos}`, count = Number(unit.beforeSoldier?.count) || 0;
                    const visualCount = counts[i];
                    const makeSoldier = (prefab: Prefab, parent: Node, size: number): Soldier => {
                        const model=instantiate(prefab);parent.addChild(model);model.setScale(size,size,size);
                        const layer=(node:Node)=>{node.layer=LAYER;node.children.forEach(layer);};layer(model);
                        const animation=model.getComponent(SkeletalAnimation)||model.getComponentInChildren(SkeletalAnimation);
                        if(!animation)throw new Error('角色骨骼动画未导入');
                        animation.playOnLoad=false;animation.stop();
                        for(const renderer of model.getComponentsInChildren(SkinnedMeshRenderer))
                            renderer.setMaterial(renderer.node.name.includes('InkOutline')?this.outlineMaterial:this.paintedMaterial,0);
                        return {node:model,animation,alive:true,deadTime:0};
                    };
                    for(let index=0;index<visualCount;index++) {
                        const member=makeSoldier(assets[s===0?2:1],root,.40);
                        member.node.setPosition((index-(visualCount-1)/2)*spacing,0,(index%3-1)*.035);
                        members.push(member);
                    }
                    // 伤亡分布在阵线各处，避免每次只从同一端消失。
                    members.sort((a,b)=> Math.sin(a.node.position.x*19+unit.pos)*.5-Math.sin(b.node.position.x*19+unit.pos)*.5);
                    const home=new Vec3(offset+visualCount*spacing/2,0,s?-1.05:1.15);
                    offset+=visualCount*spacing+gap;
                    root.setPosition(home);root.setRotationFromEuler(0,s?0:180,0);
                    const commander=makeSoldier(assets[s===0?0:1],this.stage,s===0?.72:.59);
                    commander.node.setPosition(home.x,0,s?-3.65:3.65);
                    commander.node.setRotationFromEuler(0,s?0:180,0);
                    const idle=commander.animation.getState('Idle');commander.animation.play('Idle');idle.pause();idle.time=0;idle.sample();
                    const plate=this.ui(this.overlay,`Plate${s+1}_${unit.pos}`);place(plate,0,0,150,24);
                    const title=caption(plate,'Name',reportUnitName(side,unit),0,0,150,14,C.text,Label.HorizontalAlign.CENTER);
                    title.overflow=Label.Overflow.SHRINK;
                    const outline=title.node.addComponent(LabelOutline);outline.color=new Color(13,26,35);outline.width=2;
                    const actor:Actor={key,side:s+1,node:root,home,animation:members[0].animation,clip:'',clipTime:0,
                        dead:count<=0,count,max:Math.max(1,count),plate,members,commander,commandTime:0,commandClip:'Idle'};
                    this.actors.set(key, actor); this.clip(actor, actor.dead ? 'Death' : 'Idle');
                    if(actor.dead) members.forEach(m=>{m.alive=false;m.node.active=false;});
                });
            });
            this.ready = true; this.loading.node.active = false; this.paint(); this.controls(); this.sampleAnimations(0);
            this.effects.node.setSiblingIndex(this.overlay.children.length-1);
        } catch (error) {
            if (!isValid(this, true)) return;
            this.loading.string = '战场资源暂未就绪，请返回后重试'; console.error('[BattleReplay3D]', error);
        }
    }
    private clip(actor: Actor, clip: string, force = false): void {
        if (actor.clip === clip && !force) return;
        actor.clip = clip; actor.clipTime = 0;
        for (const soldier of actor.members) {
            if (!soldier.alive && clip !== 'Death') continue;
            const state = soldier.animation.getState(clip); if (!state) continue;
            state.wrapMode = clip === 'Idle' || clip === 'Walk' ? AnimationClip.WrapMode.Loop : AnimationClip.WrapMode.Normal;
            soldier.animation.play(clip); state.pause(); state.time = 0; state.sample();
        }
    }
    private sampleAnimations(dt: number): void {
        this.actors.forEach(a => {
            a.commandTime+=dt;
            if(a.dead){
                if(a.commandClip!=='Walk')this.command(a,'Walk');
                const p=a.commander.node.position, direction=a.side===1?1:-1;
                a.commander.node.setRotationFromEuler(0,a.side===1?0:180,0);
                a.commander.node.setPosition(p.x,0,p.z+direction*dt*.75);
                if(Math.abs(p.z)>6.2)a.commander.node.active=false;
            }
            let order=a.commander.animation.getState(a.commandClip);
            if(order&&a.commandClip==='Salute'&&a.commandTime>=order.duration){this.command(a,'Idle');order=a.commander.animation.getState('Idle');}
            if(order){order.time=a.commandTime%Math.max(.01,order.duration);order.sample();}
            a.clipTime += dt;
            let state = a.animation.getState(a.clip); if (!state) return;
            if (a.clip === 'Hit' && a.clipTime > state.duration) { this.clip(a, 'Idle'); state = a.animation.getState('Idle'); }
            const loop = a.clip === 'Idle' || a.clip === 'Walk';
            a.members.forEach((m, i) => {
                if (!m.alive) {
                    m.deadTime += dt; const death = m.animation.getState('Death');
                    if (death) { death.time = Math.min(m.deadTime, death.duration - .001); death.sample(); if(m.deadTime >= death.duration) m.node.active = false; }
                    return;
                }
                const pose = m.animation.getState(a.clip); if (!pose) return;
                pose.time = loop ? (a.clipTime + i * .071) % Math.max(.01, pose.duration) : Math.min(Math.max(0,a.clipTime-(i%5)*.023), pose.duration - .001);
                pose.sample();
            });
        });
    }
    private command(actor:Actor,clip:string): void {
        actor.commandClip=clip;actor.commandTime=0;
        const state=actor.commander.animation.getState(clip);if(!state)return;
        actor.commander.animation.play(clip);state.pause();state.time=0;state.sample();
    }
    private togglePlay(): void {
        if (!this.ready) return;
        if (this.replay.finished && !this.action) this.restart();
        else { this.playing = !this.playing; this.controls(); }
    }
    private restart(): void {
        if (!this.ready) return;
        this.replay.reset(); this.action = null; this.source = null; this.target = null; this.elapsed = 0;
        this.bursts.length=0; this.effects.clear();
        this.actors.forEach(a => {
            a.count = this.replay.soldiers.get(a.key) || 0; a.dead = a.count <= 0;
            a.node.setPosition(a.home); a.node.setRotationFromEuler(0, a.side === 1 ? 180 : 0, 0);
            this.command(a,'Idle');
            a.commander.node.active=true;a.commander.node.setPosition(a.home.x,0,a.side===1?3.65:-3.65);
            a.commander.node.setRotationFromEuler(0,a.side===1?180:0,0);
            a.members.forEach(m=>{m.node.active=!a.dead;m.alive=!a.dead;m.deadTime=0;}); this.clip(a,a.dead?'Death':'Idle',true);
        });
        this.spark.active = false; this.playing = true; this.paint(); this.controls();
    }
    private beginAction(): void {
        if (this.replay.finished) {
            this.playing = false; this.narration.string = `${reportResult(this.replay.info.brief.result)} · 战斗结束`;
            this.source = null; this.target = null; this.controls(); return;
        }
        // Advance the record at impact so labels and health never jump ahead of the visible strike.
        this.action = this.replay.actions[this.replay.cursor]; this.elapsed = 0; this.impacted = false;
        this.source = this.actors.get(`${this.action.fromSide}:${this.action.fromPos}`) || null;
        const effect = (this.action.effects || []).find((e: any) => e.targetSide !== this.action.fromSide) || this.action.effects?.[0];
        this.target = effect ? this.actors.get(`${effect.targetSide}:${effect.targetPos}`) || null : null;
        this.narration.string = replayLines(this.action, this.replay.info)[0] || '两军交锋';
        if(this.source&&!this.source.dead)this.command(this.source,'Salute');
        if (this.canApproach()) {
            const dir = new Vec3(); Vec3.subtract(dir, this.source.home, this.target.home); dir.y = 0; dir.normalize();
            Vec3.scaleAndAdd(this.attackPoint, this.target.home, dir, 1.75);
            this.face(this.source, this.target.home); this.face(this.target, this.attackPoint); this.clip(this.source, 'Walk', true);
        } else if (this.source && !this.source.dead) this.clip(this.source, 'Salute', true);
        this.paint();
    }
    private canApproach(): boolean {
        return !!this.source && !this.source.dead && !!this.target && this.source.side !== this.target.side
            && [1, 2, 4].indexOf(Number(this.action?.actType)) >= 0;
    }
    private face(actor: Actor, at: Vec3): void {
        const p = actor.node.position; actor.node.setRotationFromEuler(0, Math.atan2(at.x - p.x, at.z - p.z) * 180 / Math.PI, 0);
    }
    private impact(): void {
        this.impacted = true; this.replay.step();
        for (const e of this.action.effects || []) {
            const target = this.actors.get(`${e.targetSide}:${e.targetPos}`); if (!target) continue;
            const before = target.count; target.count = this.replay.soldiers.get(target.key) || 0;
            target.dead = target.count <= 0;
            if (target.dead) { this.clip(target, 'Death', true); }
            else if (target.count < before) this.clip(target, 'Hit', true);
            const survivors = target.count > 0 ? Math.max(1,Math.ceil(target.members.length * target.count / target.max)) : 0;
            target.members.forEach((member,index)=>{
                if (index < survivors) {
                    if (!member.alive) { member.alive=true;member.node.active=true;member.deadTime=0; }
                    return;
                }
                if (!member.alive) return;
                member.alive=false;member.deadTime=0;
                const state=member.animation.getState('Death');if(!state)return;state.wrapMode=AnimationClip.WrapMode.Normal;
                member.animation.play('Death');state.pause();state.time=0;state.sample();
            });
            if (!(e.flags & 6)) this.bursts.push({actor:target,age:0,critical:!!(e.flags&1),heal:target.count>before});
        }
        if (this.target) {
            this.spark.active = true; const p = this.target.node.position; this.spark.setPosition(p.x, .025, p.z);
        }
        this.paint();
    }
    update(dt: number): void {
        if (!this.ready || !this.node.activeInHierarchy) return;
        const step = this.playing ? Math.min(dt, .1) * this.speed : 0;
        if (this.playing) {
            if (!this.action) this.beginAction();
            if (this.action) {
                this.elapsed += step;
                if (this.canApproach()) {
                    const p = new Vec3();
                    if (this.elapsed < APPROACH) Vec3.lerp(p, this.source.home, this.attackPoint, this.elapsed / APPROACH);
                    else if (this.elapsed < RETURN) { p.set(this.attackPoint); this.clip(this.source, 'Attack'); }
                    else {
                        Vec3.lerp(p, this.attackPoint, this.source.home, Math.min(1, (this.elapsed - RETURN) / (END - RETURN)));
                        this.clip(this.source, 'Walk'); this.face(this.source, this.source.home);
                    }
                    this.source.node.setPosition(p);
                }
                if (!this.impacted && this.elapsed >= IMPACT) this.impact();
                if (this.spark.active) { const t = Math.max(0, this.elapsed - IMPACT); this.spark.setScale(1 + t * 2, 1, 1 + t * 2); if (t > .24) this.spark.active = false; }
                if (this.elapsed >= END) {
                    if (this.source && !this.source.dead) {
                        this.source.node.setPosition(this.source.home); this.source.node.setRotationFromEuler(0, this.source.side === 1 ? 180 : 0, 0);
                        this.clip(this.source, 'Idle');
                    }
                    this.action = null;
                }
            }
        }
        this.sampleAnimations(step); this.updateCamera(Math.min(dt, .1)); this.projectLabels(); this.paintEffects(step);
    }
    private updateCamera(dt: number): void {
        if (!this.camera) return;
        // The embedded editor Preview can rebind a newly-created camera to its main window.
        // Keep this isolated camera attached to its own render target; the game camera is untouched.
        if (this.camera.camera.window !== this.texture.window) {
            this.camera.camera.changeTargetWindow(this.texture.window);
            this.camera.camera.setFixedSize(this.texture.width, this.texture.height);
        }
        let at = new Vec3(0, .1, 0), pos = new Vec3(0, 13, 11), zoom = Math.max(5.3, 8.5 * this.fieldH / this.fieldW);
        if (this.cinematic && this.source && this.target && this.action) {
            Vec3.lerp(at, this.source.node.position, this.target.node.position, .5); at.y = .25;
            pos.set(at.x, 13, at.z + 11); zoom *= .78;
        }
        const blend = Math.min(1, dt * 4.5); Vec3.lerp(this.cameraPos, this.cameraPos, pos, blend); Vec3.lerp(this.cameraAim, this.cameraAim, at, blend);
        this.camera.orthoHeight += (zoom-this.camera.orthoHeight)*blend;
        this.camera.node.setPosition(this.cameraPos);
        this.camera.node.lookAt(new Vec3(this.cameraAim.x + ORIGIN, this.cameraAim.y, this.cameraAim.z));
    }
    private projectLabels(): void {
        const screen=new Vec3();
        this.actors.forEach(a=>{
            const p=a.commander.node.worldPosition;
            this.camera.worldToScreen(new Vec3(p.x,a.side===1?2.50:1.65,p.z),screen);
            const x=(screen.x/this.texture.width-.5)*this.fieldW,y=(screen.y/this.texture.height-.5)*this.fieldH;
            a.plate.active=a.commander.node.active&&Math.abs(x)<this.fieldW/2-75&&Math.abs(y)<this.fieldH/2-65;
            a.plate.setPosition(x,y);
        });
    }
    private paintEffects(dt: number): void {
        const g=this.effects;g.clear();
        for (const burst of this.bursts) {
            burst.age+=dt;const t=burst.age/.46;if(t>=1)continue;
            const p=burst.actor.node.worldPosition,screen=new Vec3();
            this.camera.worldToScreen(new Vec3(p.x,.75,p.z),screen);
            const x=(screen.x/this.texture.width-.5)*this.fieldW,y=(screen.y/this.texture.height-.5)*this.fieldH;
            const r=(burst.critical?44:32)*(1+t*.55), alpha=Math.round((1-t)*235);
            const color=burst.heal?new Color(99,226,167,alpha):burst.critical?new Color(255,201,76,alpha):new Color(105,222,235,alpha);
            g.strokeColor=color;g.lineWidth=3*(1-t)+1;
            g.ellipse(x,y-24,r*1.25,r*.42);g.stroke();
            if(t<.65){
                g.fillColor=new Color(240,254,246,Math.round(alpha*.94));
                const size=r*(1-t*.9);
                for(let i=0;i<16;i++) {const a=i*Math.PI/8,rr=i%2?size*.30:size;
                    if(i===0)g.moveTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);else g.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);}
                g.close();g.fill();
            }
            g.strokeColor=color;g.lineWidth=4*(1-t)+1;
            // 刀光、散开的火星与落地波纹均跟随目标投影。
            g.moveTo(x-r*1.15,y-r*.45);g.quadraticCurveTo(x+r*.12,y+r*1.25,x+r*1.10,y+r*.35);g.stroke();
            for(let i=0;i<7;i++) {const a=i*2.4,dx=Math.cos(a),dy=Math.sin(a),d=r*(.8+t*1.8);
                g.moveTo(x+dx*d,y+dy*d*.65);g.lineTo(x+dx*(d+7*(1-t)),y+dy*(d+7*(1-t))*.65);g.stroke();}
        }
        this.bursts=this.bursts.filter(b=>b.age<.46);
    }
    private paint(): void {
        this.status.string = this.replay.finished ? '战斗结束' : this.playing ? '两军交锋' : '列阵待命';
        const w = this.fieldW - 16; this.progress.clear();
        this.progress.fillColor = new Color(55, 62, 56); this.progress.rect(-w / 2, -1, w, 2); this.progress.fill();
        this.progress.fillColor = C.gold; this.progress.rect(-w / 2, -1, w * this.replay.cursor / Math.max(1, this.replay.actions.length), 2); this.progress.fill();
    }
    private controls(): void {
        this.toggle.getComponentInChildren(Label).string = this.replay.finished && !this.action ? '重播' : this.playing ? '暂停' : '播放';
        this.toggle.getComponent(Button).interactable = this.ready && this.replay.actions.length > 0;
        this.speedButton.getComponentInChildren(Label).string = `${this.speed}×`;
        this.cameraButton.getComponentInChildren(Label).string = this.cinematic ? '镜头：跟随' : '镜头：全景';
    }
    onDisable(): void { this.playing = false; if (this.stage) this.stage.active = false; }
    onEnable(): void { if (this.stage) { this.stage.active = true; this.controls(); } }
    onDestroy(): void {
        if (this.camera) this.camera.targetTexture = null;
        if (isValid(this.stage)) { this.stage.active = false; this.stage.destroy(); }
        this.frame?.destroy(); this.texture?.destroy(); this.owned.forEach(a => a.destroy());this.groundTexture?.decRef();
        this.loadedPrefabs.forEach(a => a.decRef());
    }
}
