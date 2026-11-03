import { _decorator, Camera, Color, Component, Label, Node, UIOpacity, UITransform, Vec2, Vec3 } from 'cc';
import CampaignFeedback, { CampaignCue } from '../../world/CampaignFeedback';
import WorldCommand, { WorldPosition } from '../../world/WorldCommand';
import LoginCommand from '../../login/LoginCommand';
import BattleCommand from '../../battle/BattleCommand';
import DateUtil from '../../utils/DateUtil';
import { EventMgr } from '../../utils/EventMgr';
import { LogicEvent as E } from '../../common/LogicEvent';
import { NetEvent } from '../../network/socket/NetInterface';
import MapArmyLogic from '../MapArmyLogic';
import MapUtil from '../MapUtil';
import { caption, ManagementColors as C } from './ManagementStyle';
const { ccclass } = _decorator;
const TONES = { gold: C.gold, green: new Color(231, 224, 159), red: new Color(239, 166, 148) };
interface FloatingCue {
    node: Node; opacity: UIOpacity; pos: WorldPosition; elapsed: number; offset: number;
}

/** 战况仅在战场位置飘字；占领倒计时留在地块上，所有表现均不接收输入。 */
@ccclass('MapCampaignFeedback')
export default class MapCampaignFeedback extends Component {
    readonly state = new CampaignFeedback();
    private flights: FloatingCue[] = [];
    private played = new Set<string>();
    private army: MapArmyLogic = null;
    private camera: Camera = null;
    private worldPoint = new Vec3();
    private uiPoint = new Vec3();

    onLoad(): void {
        if (!this.node.getComponent(UITransform)) this.node.addComponent(UITransform);
        EventMgr.on(E.battleStarted, this.battleStart, this);
        EventMgr.on(E.battleFinished, this.battleResult, this);
        EventMgr.on(E.updateWorldEntities, this.sync, this);
        EventMgr.on(E.updateMarches, this.sync, this);
        EventMgr.on(E.updateMyRole, this.sync, this);
        EventMgr.on(E.enterLogin, this.clear, this);
        EventMgr.on(NetEvent.ServerDisconnected, this.clear, this);
        this.sync();
    }
    onDestroy(): void { EventMgr.targetOff(this); this.clear(); }
    private clear(): void {
        this.state.clear(); this.played.clear();
        this.flights.forEach(cue => cue.node.destroy()); this.flights = [];
        this.army = null; this.camera = null;
    }
    private sync(): void {
        const world = WorldCommand.getInstance();
        this.state.sync(Array.from(world.entities.values()), world.marches.values(),
            LoginCommand.getInstance().proxy.getRoleData()?.userId, DateUtil.getServerTime() / 1000);
        this.render();
    }
    private battleStart(data: any): void { this.state.battleStart(data, DateUtil.getServerTime() / 1000); this.render(); }
    private battleResult(data: any): void {
        this.state.battleResult(data, BattleCommand.getInstance().battles.get(String(data.battleId))?.start,
            DateUtil.getServerTime() / 1000);
        this.render();
    }
    private render(): void {
        for (const cue of this.state.notices(DateUtil.getServerTime() / 1000)) {
            // 同一场战斗的开始和结果分别播一次；重复包或地图刷新不重播。
            const key = `${cue.id}:${cue.title}`;
            if (this.played.has(key)) continue;
            this.played.add(key);
            if (this.played.size > 200) this.played.delete(this.played.values().next().value);
            if (cue.pos && Number.isFinite(cue.pos.x) && Number.isFinite(cue.pos.y)) this.float(cue);
        }
    }
    private float(cue: CampaignCue): void {
        // 结果到达时，撤掉同一地点尚未消失的“交锋中”，不让旧状态盖住结果。
        if (cue.title !== '两军交锋') {
            this.flights = this.flights.filter(flight => {
                if (flight.node.name !== '两军交锋' || flight.pos.x !== cue.pos.x || flight.pos.y !== cue.pos.y) return true;
                flight.node.destroy(); return false;
            });
        }
        if (this.flights.length >= 4) this.flights.shift().node.destroy();
        const offset = this.flights.filter(flight => flight.pos.x === cue.pos.x && flight.pos.y === cue.pos.y).length * 23;
        const label = caption(this.node, cue.id, cue.title, 0, 0, 148, 19, TONES[cue.tone], Label.HorizontalAlign.CENTER);
        label.node.name = cue.title; label.isBold = true;
        label.enableOutline = true; label.outlineWidth = 2; label.outlineColor = new Color(36, 38, 29, 230);
        const opacity = label.node.addComponent(UIOpacity); opacity.opacity = 0;
        this.flights.push({ node: label.node, opacity, pos: { ...cue.pos }, elapsed: 0, offset });
    }
    update(dt: number): void {
        if (!this.flights.length) return;
        if (!this.army?.isValid) this.army = this.node.scene?.getComponentInChildren(MapArmyLogic);
        if (!this.camera?.isValid) this.camera = this.army?.node.parent?.getChildByName('Map Camera')?.getComponent(Camera);
        const layer = this.army?.parentLayer?.getComponent(UITransform);
        const parent = this.node.parent?.getComponent(UITransform);
        for (let i = this.flights.length - 1; i >= 0; i--) {
            const cue = this.flights[i]; cue.elapsed += Math.max(0, dt);
            if (cue.elapsed >= 1.9) { cue.node.destroy(); this.flights.splice(i, 1); continue; }
            if (!layer || !this.camera || !parent || !MapUtil.areaCellSize) { cue.node.active = false; continue; }
            const p = MapUtil.mapCellToPixelPoint(new Vec2(cue.pos.x, cue.pos.y));
            // 落脚点加上主将高度，再转成 UI 坐标；平移/缩放地图时始终跟随战场。
            this.worldPoint.set(p.x, p.y + 78, 0);
            layer.convertToWorldSpaceAR(this.worldPoint, this.worldPoint);
            this.camera.convertToUINode(this.worldPoint, this.node, this.uiPoint);
            const rise = 20 * (1 - Math.pow(1 - cue.elapsed / 1.9, 2));
            const x = this.uiPoint.x, y = this.uiPoint.y + 10 + rise + cue.offset;
            cue.node.active = Math.abs(x) < parent.width / 2 + 74 && Math.abs(y) < parent.height / 2 + 24;
            cue.node.setPosition(x, y, 0);
            cue.opacity.opacity = Math.round(255 * Math.min(1, cue.elapsed / .12, (1.9 - cue.elapsed) / .65));
        }
    }
}
