import { _decorator, Button, Camera, Color, Component, Graphics, Node, UITransform, Vec2, Vec3, view } from 'cc';
import { EventMgr } from '../utils/EventMgr';
import { LogicEvent } from '../common/LogicEvent';
import CityCommand, { AllianceCityInfo } from '../world/CityCommand';
import LoginCommand from '../login/LoginCommand';
import MapCommand from './MapCommand';
import MapUtil from './MapUtil';
import { CityCaptureCue, CityOwner, resolveCityOwner } from './CityOwnership';
import { cityOwnerColor, drawCityFlag, drawSystemCityNameplate, systemCityIdentity } from './CityMapPresentation';
import { cityDeploymentCount } from './CityDeployment';
import { caption, inkSurface, ManagementColors as C } from './ui/ManagementStyle';
import { Label } from 'cc';
const { ccclass } = _decorator;

/** 可见城池和关隘共用归属表现；随地图对象池回收，不改占地与拾取轮廓。 */
@ccclass('CityOwnershipView')
export default class CityOwnershipView extends Component {
    private data: { x: number; y: number; level: number; name?: string } | null = null;
    private corners: number[][] = [];
    private top = 0;
    private owner: CityOwner = resolveCityOwner(undefined, 0);
    private styleKey = '';
    private camera: Camera | null = null;
    private plate: Node | null = null;
    private ground: Graphics | null = null;
    private pulse: Graphics | null = null;
    private flags: Node[] = [];
    private unit = 0;
    private captureTime = 0;
    private readonly cue = new CityCaptureCue();
    private readonly worldPoint = new Vec3();
    private readonly uiPoint = new Vec3();

    protected onEnable(): void {
        EventMgr.on(LogicEvent.updateAllianceCities, this.refreshOwner, this);
        EventMgr.on(LogicEvent.updateMyRole, this.refreshOwner, this);
        EventMgr.on(LogicEvent.allianceCityOccupied, this.onOccupied, this);
        this.refreshOwner();
    }

    protected onDisable(): void { EventMgr.targetOff(this); this.clear(); }
    protected onDestroy(): void { EventMgr.targetOff(this); this.plate?.destroy(); this.plate = null; }

    setCity(data: { x: number; y: number; level: number; name?: string }, top: number, corners: number[][]): void {
        if (this.data?.x !== data.x || this.data?.y !== data.y) this.clear();
        this.data = data; this.top = top; this.corners = corners;
        this.styleKey = ''; this.unit = 0;
        this.refreshOwner();
    }

    clear(): void {
        this.data = null; this.styleKey = ''; this.unit = 0; this.captureTime = 0; this.cue.clear();
        if (this.plate?.isValid) this.plate.active = false;
        if (this.ground?.isValid) this.ground.node.active = false;
        if (this.pulse?.isValid) this.pulse.node.active = false;
        for (const flag of this.flags) {
            flag.active = false;
            flag.getChildByName('FlagBanner')?.setPosition(0, 0, 0);
        }
    }

    private refreshOwner(): void {
        if (!this.data) return;
        const city = CityCommand.getInstance().at(this.data.x, this.data.y);
        const mine = LoginCommand.getInstance().proxy.getRoleData()?.allianceId;
        const identity = systemCityIdentity(this.data, city, mine), count = cityDeploymentCount(city);
        const key = JSON.stringify([identity, count]);
        if (key === this.styleKey) return;
        const previousId = this.owner.allianceId;
        this.owner = identity.owner; this.cue.sync(this.owner); this.styleKey = key;
        if (previousId !== this.owner.allianceId) this.captureTime = 0;
        if (!this.plate?.isValid) this.createNameplate();
        if (this.plate) drawSystemCityNameplate(this.plate, identity);
        if (this.plate) this.drawTroopEntry(count);
        if (!this.ground) this.ground = this.createGraphic('CityTerritory', true);
        this.ground.node.active = this.owner.occupied;
        if (this.owner.occupied && !this.flags.length) for (let i = 0; i < 2; i++) {
            const flag = new Node('AllianceFlag' + i); flag.layer = this.node.layer;
            flag.addComponent(UITransform); this.node.addChild(flag); this.flags.push(flag);
        }
        for (const flag of this.flags) {
            flag.active = this.owner.occupied;
            drawCityFlag(flag, this.owner);
            flag.getChildByName('FlagBanner')?.setPosition(0, 0, 0);
        }
        this.unit = 0;
    }

    private createGraphic(name: string, behind = false): Graphics {
        const n = new Node(name); n.layer = this.node.layer; this.node.addChild(n);
        n.addComponent(UITransform);
        if (behind) n.setSiblingIndex(0);
        return n.addComponent(Graphics);
    }

    private drawTroopEntry(count: number): void {
        let entry = this.plate.getChildByName('CityTroops');
        if (!entry) {
            entry = new Node('CityTroops'); entry.layer = this.plate.layer; this.plate.addChild(entry);
            entry.addComponent(UITransform);
            const button = entry.addComponent(Button); button.target = entry;
            button.transition = Button.Transition.SCALE; button.zoomScale = .96; button.duration = .08;
            entry.on(Button.EventType.CLICK, this.openTroops, this);
        }
        entry.active = count > 0 && this.owner.relation === 'mine';
        if (!entry.active) return;
        entry.getComponent(UITransform).setContentSize(124, 30); entry.setPosition(0, -62, 0);
        inkSurface(entry, 'Plate', 124, 30, new Color(27, 42, 34, 245), C.gold);
        const label = caption(entry, 'Count', `队伍 × ${count}  ›`, 0, 0, 116, 15, C.text, Label.HorizontalAlign.CENTER);
        label.isBold = true;
    }

    private openTroops(): void {
        if (!this.data) return;
        const city = CityCommand.getInstance().at(this.data.x, this.data.y);
        if (city && this.owner.relation === 'mine') EventMgr.emit(LogicEvent.openCityTroops, city.entityId);
    }

    private createNameplate(): void {
        this.plate = null;
        const ui = this.node.scene?.getChildByPath('Canvas/MapUIScene');
        if (!ui) return;
        let layer = ui.getChildByName('CityNameplates');
        if (!layer) {
            layer = new Node('CityNameplates'); layer.layer = ui.layer; layer.addComponent(UITransform);
            ui.addChild(layer); layer.setSiblingIndex(0);
        }
        this.plate = new Node('CityOwnershipNameplate'); this.plate.layer = layer.layer;
        this.plate.addComponent(UITransform); layer.addChild(this.plate);
        const button = this.plate.addComponent(Button); button.target = this.plate;
        button.transition = Button.Transition.SCALE; button.zoomScale = .97; button.duration = .08;
        this.plate.on(Button.EventType.CLICK, () => {
            if (!this.data) return;
            const cell = new Vec2(this.data.x, this.data.y), point = MapUtil.mapCellToPixelPoint(cell);
            EventMgr.emit(LogicEvent.touchMap, cell, point, point);
        }, this);
    }

    private onOccupied(message: { cityInfo?: AllianceCityInfo }): void {
        const city = message?.cityInfo;
        if (!this.data || city?.pos?.x !== this.data.x || city.pos.y !== this.data.y) return;
        this.refreshOwner();
        if (!this.cue.take(this.owner, city.allianceId)) return;
        this.captureTime = 1.8;
        if (!this.pulse) this.pulse = this.createGraphic('CityCaptureRing', true);
    }

    private outline(g: Graphics, expansion = 1): void {
        for (let i = 0; i < this.corners.length; i++) {
            const [x, y] = this.corners[i];
            if (i) g.lineTo(x * expansion, y * expansion); else g.moveTo(x * expansion, y * expansion);
        }
        g.close();
    }

    private drawGround(): void {
        if (!this.ground || !this.owner.occupied) return;
        const g = this.ground, color = cityOwnerColor(this.owner);
        g.clear(); g.fillColor = new Color(color.r, color.g, color.b, 13);
        this.outline(g); g.fill();
        g.lineWidth = 4 * this.unit; g.strokeColor = new Color(28, 35, 28, 170); this.outline(g); g.stroke();
        g.lineWidth = 2 * this.unit; g.strokeColor = new Color(color.r, color.g, color.b, 240); this.outline(g); g.stroke();
        // 转角加粗，远一点仍能辨认；城池图片保持原色，不周期闪亮。
        g.lineWidth = 4 * this.unit; g.strokeColor = new Color(color.r, color.g, color.b, 255);
        for (let i = 0; i < this.corners.length; i++) {
            const p = this.corners[i], a = this.corners[(i + this.corners.length - 1) % this.corners.length];
            const b = this.corners[(i + 1) % this.corners.length];
            g.moveTo(p[0] + (a[0] - p[0]) * .10, p[1] + (a[1] - p[1]) * .10); g.lineTo(p[0], p[1]);
            g.lineTo(p[0] + (b[0] - p[0]) * .10, p[1] + (b[1] - p[1]) * .10); g.stroke();
        }
    }

    protected lateUpdate(dt = 0): void {
        if (!this.data || !this.node.activeInHierarchy) return;
        if (!this.camera?.isValid) this.camera = this.node.scene?.getChildByPath('Canvas/Map Camera')?.getComponent(Camera);
        if (!this.camera) return;
        if (!this.plate?.isValid) { this.styleKey = ''; this.refreshOwner(); if (!this.plate?.isValid) return; }
        const strategic = MapCommand.getInstance().proxy.strategic;
        if (this.ground) this.ground.node.active = this.owner.occupied && !strategic;
        for (const flag of this.flags) flag.active = this.owner.occupied && !strategic;
        if (strategic) {
            this.plate.active = false; this.captureTime = 0;
            if (this.pulse) this.pulse.node.active = false;
            for (const flag of this.flags) flag.getChildByName('FlagBanner')?.setPosition(0, 0, 0);
            return;
        }
        const size = view.getVisibleSize(), zoom = this.camera.orthoHeight * 2 / Math.max(1, size.height);
        const span = Math.max(1, ...this.corners.map(p => Math.abs(p[0]) * 2));
        const unit = Math.round(Math.max(.5, Math.min(zoom, span / 220)) * 20) / 20;
        if (unit !== this.unit) {
            this.unit = unit; this.drawGround();
            const front = [...this.corners].sort((a, b) => a[1] - b[1]);
            for (let i = 0; i < this.flags.length; i++) {
                const p = front[i]; if (!p) continue;
                this.flags[i].setPosition(p[0] - 15 * unit, p[1] + 5 * unit, 0);
                this.flags[i].setScale(unit * .9, unit * .9, 1);
            }
        }
        this.node.getComponent(UITransform).convertToWorldSpaceAR(this.worldPoint.set(0, this.top, 0), this.worldPoint);
        this.camera.camera?.update(); this.camera.convertToUINode(this.worldPoint, this.plate.parent, this.uiPoint);
        const x = this.uiPoint.x, y = this.uiPoint.y + 50, half = this.plate.getComponent(UITransform).width / 2;
        this.plate.active = x + half > -size.width / 2 && x - half < size.width / 2
            && y + 24 > -size.height / 2 && y - 78 < size.height / 2;
        if (this.plate.active) this.plate.setPosition(x, y, 0);
        this.animateCapture(dt);
    }

    private animateCapture(dt: number): void {
        if (this.captureTime <= 0) { if (this.pulse) this.pulse.node.active = false; return; }
        this.captureTime = Math.max(0, this.captureTime - Math.max(0, dt));
        const progress = 1 - this.captureTime / 1.8, rise = Math.min(1, progress / .5);
        for (const flag of this.flags) flag.getChildByName('FlagBanner')?.setPosition(0, -22 * Math.pow(1 - rise, 3), 0);
        const g = this.pulse;
        if (!g) return;
        g.node.active = this.captureTime > 0; g.clear();
        g.lineWidth = 3 * this.unit; g.strokeColor = new Color(255, 222, 145, Math.round(210 * (1 - progress)));
        this.outline(g, 1 + .08 * progress); g.stroke();
    }
}
