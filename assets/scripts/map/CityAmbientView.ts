import { _decorator, Camera, Color, Component, Node, Sprite, UITransform, Vec3, view } from 'cc';
import { EventMgr } from '../utils/EventMgr';
import { LogicEvent as E } from '../common/LogicEvent';
import CityCommand from '../world/CityCommand';
import WorldCommand from '../world/WorldCommand';
import MapCommand from './MapCommand';
import MapUtil from './MapUtil';
import WorldMapArt from './WorldMapArt';
import { cityArtToFootprint } from './CityArtFit';
import { CityArtLayout } from './CityFootprint';
import { CITY_AMBIENT_LAYOUTS, CityAmbientActivity, cityUnderSiege } from './CityAmbientActivity';
import { CityAmbientOcclusion } from './CityAmbientOcclusion';
import { gateAmbientLayout } from './GateAmbientLayout';
import type { GateAppearance } from './GateGeometry';
import PlayerCityGround from './PlayerCityGround';
import { playerCityAppearance } from './PlayerCityAppearance';
import { playerCityAmbientLayout } from './PlayerCityAmbientLayout';
import { loadMarchAnimations, MarchAnimationSet } from './entries/MarchAnimationLibrary';

const { ccclass } = _decorator;
interface Member { node: Node; sprite: Sprite; color: Color; direction: number; gait: number; positioned: boolean; }

/** 每座近景城池 8～16 名装饰士兵，共用图集；远景和屏外暂停。 */
@ccclass('CityAmbientView')
export default class CityAmbientView extends Component {
    private data: { x: number; y: number; level: number } | null = null;
    private activity: CityAmbientActivity | null = null;
    private layout: CityArtLayout | null = null;
    private presentation = '';
    private memberSize = 0;
    private playerState: { owner: string; entityId?: number | string } | null = null;
    private occlusion: CityAmbientOcclusion | null = null;
    private root: Node | null = null;
    private readonly members: Member[] = [];
    private readonly ordered: Member[] = [];
    private animations: MarchAnimationSet | null = null;
    private requested = false;
    private prepared = false;
    private dirty = true;
    private stateCooldown = 0;
    private clock = 0;
    private camera: Camera | null = null;
    private ui: Node | null = null;
    private readonly worldPoint = new Vec3();
    private readonly screenPoint = new Vec3();

    protected onEnable(): void {
        for (const event of [E.updateAllianceCities, E.updateMarches, E.updateWorldEntities]) EventMgr.on(event, this.invalidate, this);
        this.invalidate();
    }
    protected onDisable(): void { EventMgr.targetOff(this); this.clear(); }
    protected onDestroy(): void { EventMgr.targetOff(this); }
    private invalidate(): void { this.dirty = true; }

    setCity(data: { x: number; y: number; level: number }): void {
        if (this.presentation === 'city' && this.data?.x === data.x && this.data?.y === data.y && this.data?.level === data.level) return;
        this.clear();
        const layout = CITY_AMBIENT_LAYOUTS[`${data.x},${data.y}`];
        if (!layout) return;
        this.data = data; this.activity = new CityAmbientActivity(layout);
        this.occlusion = new CityAmbientOcclusion(data.x, data.y);
        this.layout = WorldMapArt.cityLayout(data.level, data, MapUtil.tileSize.width, MapUtil.tileSize.height);
        this.presentation = 'city'; this.memberSize = this.layout.width * .024;
        this.refreshState();
    }

    setGate(data: GateAppearance & { x: number; y: number; level: number }, mirrored: boolean): void {
        const tile = MapUtil.tileSize;
        const key = ['gate', data.x, data.y, data.level, data.crossing, data.bridgeSpan, mirrored, tile.width, tile.height].join(':');
        if (this.presentation === key) return;
        this.clear();
        const layout = gateAmbientLayout(data, mirrored, tile.width, tile.height);
        this.presentation = key; this.data = data;
        this.activity = new CityAmbientActivity(layout.activity);
        this.occlusion = new CityAmbientOcclusion(data.x, data.y, layout.occluders);
        this.layout = layout.art; this.memberSize = layout.memberSize;
        this.refreshState();
    }

    setPlayerCity(data: { x: number; y: number; level: number; rid: number | string;
        parentId?: number; entityId?: number | string }): void {
        const tile = MapUtil.tileSize, appearance = playerCityAppearance(data.level, tile.width, tile.height);
        const key = ['player', appearance.art, data.x, data.y, tile.width, tile.height].join(':');
        const owner = `${data.rid}:${data.parentId || 0}`;
        if (this.presentation === key) {
            if (this.playerState?.owner !== owner || this.playerState?.entityId !== data.entityId) {
                this.playerState = { owner, entityId: data.entityId }; this.invalidate();
            }
            return;
        }
        this.clear();
        const layout = playerCityAmbientLayout(appearance.art, data.x, data.y);
        if (!layout) return;
        this.presentation = key; this.data = data; this.playerState = { owner, entityId: data.entityId };
        this.activity = new CityAmbientActivity(layout.activity);
        this.occlusion = new CityAmbientOcclusion(data.x, data.y, layout.occluders);
        this.layout = PlayerCityGround.ambientLayout(appearance);
        this.memberSize = this.layout.width * .024;
        this.refreshState();
    }

    clear(): void {
        this.data = null; this.activity = null; this.layout = null; this.occlusion = null;
        this.presentation = ''; this.memberSize = 0;
        this.playerState = null;
        this.clock = 0; this.stateCooldown = 0; this.prepared = false;
        if (this.root?.isValid) this.root.active = false;
        this.dirty = true;
    }

    private refreshState(): void {
        if (!this.data || !this.activity) return;
        const city = CityCommand.getInstance().at(this.data.x, this.data.y), world = WorldCommand.getInstance();
        this.activity.sync(this.playerState?.owner ?? (city ? String(city.allianceId) : undefined),
            cityUnderSiege(this.playerState?.entityId ?? city?.entityId, this.data.x, this.data.y, world.marches.values(), world.entities.values()));
        this.dirty = false; this.stateCooldown = .25;
    }

    private prepare(): void {
        if (!this.animations) {
            if (!this.requested) {
                this.requested = true;
                void loadMarchAnimations('infantry').then(animations => {
                    if (this.isValid && this.node?.isValid) this.animations = animations;
                }, () => { /* 共享动画库已报告失败；不在每帧重试。 */ });
            }
            return;
        }
        if (!this.root) {
            this.root = new Node('CityAmbientSoldiers'); this.root.layer = this.node.layer;
            this.root.addComponent(UITransform); this.node.addChild(this.root);
        }
        while (this.members.length < this.activity.soldiers.length) {
            const node = new Node('AmbientGuard' + this.members.length); node.layer = this.node.layer;
            this.root.addChild(node);
            node.addComponent(UITransform).setAnchorPoint(.5, 18 / 256);
            const sprite = node.addComponent(Sprite); sprite.trim = false; sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            this.members.push({ node, sprite, color: new Color(255, 255, 255, 255), direction: 7, gait: 0, positioned: false });
        }
        for (let i = 0; i < this.members.length; i++) {
            const member = this.members[i]; member.node.active = i < this.activity.soldiers.length;
            member.positioned = false; member.gait = i * .237;
            member.node.getComponent(UITransform).setContentSize(this.memberSize, this.memberSize);
        }
        this.ordered.length = this.activity.soldiers.length;
        for (let i = 0; i < this.ordered.length; i++) this.ordered[i] = this.members[i];
        this.prepared = true;
    }

    protected update(dt: number): void {
        if (!this.data || !this.layout || !this.activity) return;
        if (!this.camera?.isValid) this.camera = this.node.scene?.getChildByPath('Canvas/Map Camera')?.getComponent(Camera);
        if (!this.ui?.isValid) this.ui = this.node.scene?.getChildByPath('Canvas/MapUIScene');
        if (!this.camera || !this.ui) return;
        const size = view.getVisibleSize(), zoom = 2 * this.camera.orthoHeight / Math.max(1, size.height);
        const width = this.layout.width / zoom, height = this.layout.height / zoom;
        const strategic = MapCommand.getInstance().proxy.strategic;
        this.node.getComponent(UITransform).convertToWorldSpaceAR(this.worldPoint.set(0, 0, 0), this.worldPoint);
        this.camera.convertToUINode(this.worldPoint, this.ui, this.screenPoint);
        const visible = !strategic && width >= 220 && this.screenPoint.x + width / 2 > -size.width / 2
            && this.screenPoint.x - width / 2 < size.width / 2 && this.screenPoint.y + height / 2 > -size.height / 2
            && this.screenPoint.y - height / 2 < size.height / 2;
        if (!visible) { if (this.root) this.root.active = false; return; }
        this.stateCooldown -= Math.max(0, dt);
        if (this.dirty && this.stateCooldown <= 0) this.refreshState();
        if (!this.prepared) this.prepare();
        if (!this.root || !this.animations) return;
        this.root.active = true;
        this.clock += Math.max(0, Math.min(.25, dt)); this.activity.tick(dt);
        for (let i = 0; i < this.activity.soldiers.length; i++) {
            const pose = this.activity.soldiers[i], member = this.members[i];
            const p = cityArtToFootprint(this.layout.fit, pose.u, pose.v);
            const x = p.x * this.layout.width, y = p.y * this.layout.height;
            const alignFacing = pose.walking || !member.positioned || pose.duty === 'sentry';
            if (pose.walking && member.positioned) {
                member.gait += Math.hypot(x - member.node.position.x, y - member.node.position.y) / (this.memberSize * .5);
            }
            member.node.setPosition(x, y, 0); member.positioned = true;
            // 城图是整幅 Sprite，不能用人物之间的 Y 排序遮住房屋；经过建筑背后时隐藏整个人物。
            // 模拟和步态仍照常推进，走出屋檐后恢复，不会在遮挡处停住或重新出生。
            member.node.active = !this.occlusion.hides(pose.u, pose.v, !member.node.active);
            if (alignFacing) {
                const ahead = cityArtToFootprint(this.layout.fit, pose.u + pose.du * .01, pose.v + pose.dv * .01);
                const angle = Math.atan2((ahead.y - p.y) * this.layout.height, (ahead.x - p.x) * this.layout.width);
                member.direction = (Math.round(angle / (Math.PI / 4)) + 8) % 8;
            }
            const direction = member.direction;
            const frames = this.animations.walkFrames[direction];
            const frame = pose.walking ? frames[Math.floor(member.gait * frames.length) % frames.length]
                : pose.guard ? this.animations.guardFrames?.[direction] || this.animations.idleFrames[direction]
                    : this.animations.idleFrames[direction];
            if (member.sprite.spriteFrame !== frame) member.sprite.spriteFrame = frame;
            member.node.setScale(this.animations.mirrored[direction] ? -1 : 1, 1, 1);
            const alpha = Math.round(pose.alpha * 240);
            if (member.color.a !== alpha) { member.color.a = alpha; member.sprite.color = member.color; }
        }
        // 近距离交会时立即更新脚底遮挡顺序；最多16人，避免四分之一秒的错层。
        this.ordered.sort((a, b) => b.node.position.y - a.node.position.y);
        this.ordered.forEach((member, index) => { if (member.node.getSiblingIndex() !== index) member.node.setSiblingIndex(index); });
    }
}
