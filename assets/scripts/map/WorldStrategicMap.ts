import { _decorator, Camera, Color, Component, Graphics, Label, Node, Sprite, UITransform, Vec2, view } from 'cc';
import MapCommand from './MapCommand';
import MapUtil from './MapUtil';
import WorldCampaign, { CampaignCity, CampaignGate } from './WorldCampaign';
import WorldMapArt from './WorldMapArt';
import { playerCityAppearance } from './PlayerCityAppearance';
import { BRIDGE_ART, GATE_ART } from './GateGeometry';
import { caption, inkSurface, ManagementColors, place } from './ui/ManagementStyle';
import CityCommand from '../world/CityCommand';
import LoginCommand from '../login/LoginCommand';
import { EventMgr } from '../utils/EventMgr';
import { LogicEvent } from '../common/LogicEvent';
import { resolveCityOwner } from './CityOwnership';
import { cityOwnerColor, drawCityFlag } from './CityMapPresentation';
const { ccclass } = _decorator;
interface GateMarker { node: Node; plate: Graphics; title: Label; gate: CampaignGate; x: number; y: number; ownerKey?: string; }
interface HomeMarker { node: Node; sprite: Sprite; plate: Graphics; city: { x: number; y: number; level: number }; art: string; height: number; }
interface CityMarker { node: Node; title: Node; city: CampaignCity; x: number; y: number; width: number; height: number; ownerKey?: string; }

/** 与地图共用相机的远景，不创建百万格资源节点。 */
@ccclass('WorldStrategicMap')
export default class WorldStrategicMap extends Component {
    private camera: Camera = null;
    private root: Node = null;
    private homeMarker: HomeMarker = null;
    private titles: { node: Node; x: number; y: number; width: number; gate: boolean }[] = [];
    private gateMarkers: GateMarker[] = [];
    private cityMarkers: CityMarker[] = [];
    private lastHeight = 0;
    private lastX = Infinity;
    private lastY = Infinity;
    private lastRefresh = 0;

    protected onEnable(): void {
        EventMgr.on(LogicEvent.updateAllianceCities, this.invalidateOwnership, this);
        EventMgr.on(LogicEvent.updateMyRole, this.invalidateOwnership, this);
        this.invalidateOwnership();
    }

    protected onDisable(): void { EventMgr.targetOff(this); }
    private invalidateOwnership(): void { this.lastRefresh = -Infinity; }

    private refreshCityOwner(marker: CityMarker | GateMarker, cell: { x: number; y: number }, width: number): void {
        const owner = resolveCityOwner(CityCommand.getInstance().at(cell.x, cell.y),
            LoginCommand.getInstance().proxy.getRoleData()?.allianceId);
        const key = JSON.stringify(owner);
        if (key === marker.ownerKey) return;
        marker.ownerKey = key;
        let flag = marker.node.getChildByName('StrategicAllianceFlag');
        if (!flag && owner.occupied) {
            flag = new Node('StrategicAllianceFlag'); flag.layer = marker.node.layer;
            flag.addComponent(UITransform); marker.node.addChild(flag);
        }
        if (flag) {
            flag.active = owner.occupied;
            flag.setPosition(width * .22, 8, 0); flag.setScale(.48, .48, 1);
            drawCityFlag(flag, owner);
        }
        if ('plate' in marker) {
            const color = cityOwnerColor(owner), g = marker.plate; g.clear(); g.lineWidth = owner.occupied ? 1.6 : 1;
            g.fillColor = owner.occupied ? new Color(Math.round(color.r * .22), Math.round(color.g * .22), Math.round(color.b * .22), 248)
                : new Color(29, 35, 28, 244);
            g.strokeColor = color;
            g.moveTo(-43, 12); g.lineTo(43, 12); g.lineTo(47, 8); g.lineTo(47, -8);
            g.lineTo(43, -12); g.lineTo(-43, -12); g.lineTo(-47, -8); g.lineTo(-47, 8); g.close(); g.fill(); g.stroke();
            marker.title.color = owner.occupied ? new Color(247, 237, 208) : new Color(247, 227, 182);
        }
    }

    initialize(camera: Camera): void {
        this.camera = camera;
        this.root = new Node('StrategicWorld'); this.root.layer = this.node.layer;
        this.root.active = false;
        this.node.addChild(this.root); this.root.addComponent(UITransform).setContentSize(MapUtil.mapPixcelSize);
        const terrain = new Node('ProvinceColors'); terrain.layer = this.node.layer; this.root.addChild(terrain);
        const g = terrain.addComponent(Graphics), config = WorldCampaign.config;
        const point = (x: number, y: number) => MapUtil.mapCellToPixelPoint(new Vec2(x, y));
        if (config.landShapes?.length) {
            // 轮廓由同一份地形生成，远景也保留弯曲州界、河流和支流。
            const polygon = (points: number[][]) => {
                points.forEach(([x, y], i) => { const p = point(x, y); if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); });
                g.close();
            };
            g.fillColor = new Color(72, 105, 105, 255);
            polygon([[-.5,-.5],[config.width-.5,-.5],[config.width-.5,config.height-.5],[-.5,config.height-.5]]);
            g.fill();
            g.strokeColor = new Color(66, 77, 60, 255); g.lineWidth = 120;
            for (const shape of config.landShapes) {
                g.fillColor = new Color().fromHEX(config.regions[shape.region].color);
                polygon(shape.points); g.fill(); g.stroke();
            }
        } else for (let y = 0; y < config.height; y += 20) for (let x = 0; x < config.width; x += 20) {
            const color = new Color().fromHEX(config.regions[WorldCampaign.regionAt(x, y)].color);
            color.a = 225; g.fillColor = color;
            const points = [[x, y], [Math.min(999, x + 20), y], [Math.min(999, x + 20), Math.min(999, y + 20)], [x, Math.min(999, y + 20)]];
            points.forEach(([cx, cy], i) => { const p = point(cx, cy); if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); });
            g.close(); g.fill();
        }
        for (const region of config.regions) {
            const p = point(region.x, region.y);
            this.title('Region' + region.id, region.name, p.x, p.y, 100, 21, false);
        }
        for (const city of config.cities) this.createCityMarker(city, point(city.x, city.y));
        for (const gate of config.gates) {
            const p = point(gate.x, gate.y);
            this.createGateMarker(gate, p);
        }
        this.root.active = false;
    }

    private createCityMarker(city: CampaignCity, point: Vec2): void {
        const node = new Node('CityMarker' + city.region); node.layer = this.root.layer; this.root.addChild(node);
        node.addComponent(UITransform).setAnchorPoint(.5, .5);
        const sprite = node.addComponent(Sprite); sprite.trim = false;
        const width = city.level >= 8 ? 64 : city.level >= 5 ? 52 : 42;
        WorldMapArt.apply(sprite, WorldMapArt.cityOverviewSprite(city.level, city), width);
        const title = this.titles.find(t => t.node.name === 'Region' + city.region)?.node;
        this.cityMarkers.push({ node, title, city, x: point.x, y: point.y, width,
            height: node.getComponent(UITransform).height });
    }

    /** 总览图标按屏幕尺寸显示，命中范围也跟随图标，而不是缩小后的占地格。 */
    public pickCity(point: Vec2): CampaignCity | null {
        this.lateUpdate();
        if (!this.root?.active || !this.camera) return null;
        let nearest: CampaignCity = null, distance = Infinity;
        for (const marker of this.cityMarkers) {
            if (!marker.node.active) continue;
            const scale = marker.node.scale.x;
            const x = (point.x - marker.x) / scale, y = (point.y - marker.y) / scale;
            const iconHit = Math.abs(x) <= marker.width / 2 + 3 && Math.abs(y) <= marker.height / 2 + 3;
            const title = marker.title, ui = title?.getComponent(UITransform);
            const titleHit = title?.active && ui
                && Math.abs(point.x - title.position.x) <= ui.width * title.scale.x / 2
                && Math.abs(point.y - title.position.y) <= ui.height * title.scale.y / 2;
            const score = x * x + y * y;
            if ((iconHit || titleHit) && score < distance) { nearest = marker.city; distance = score; }
        }
        return nearest;
    }

    private createGateMarker(gate: CampaignGate, point: Vec2): void {
        const root = new Node(gate.id); root.layer = this.root.layer; this.root.addChild(root);
        root.addComponent(UITransform).setContentSize(94, 66);
        const art = new Node('GateArt'); art.layer = root.layer; root.addChild(art);
        art.addComponent(UITransform).setAnchorPoint(.5, .5);
        const sprite = art.addComponent(Sprite); sprite.trim = false;
        WorldMapArt.apply(sprite, gate.crossing === 'bridge' ? BRIDGE_ART : GATE_ART, 50);
        art.setPosition(0, 8);
        const plate = inkSurface(root, 'Nameplate', 94, 24, null, null); plate.node.setPosition(0, -22);
        const title = caption(plate.node, 'Name', gate.name, 0, 0, 86, 14, ManagementColors.text, Label.HorizontalAlign.CENTER);
        place(title.node, 0, 0, 86, 22); title.isBold = true; title.overflow = Label.Overflow.SHRINK;
        const badge = inkSurface(root, 'LevelSeal', 18, 18, new Color(37, 37, 27), ManagementColors.gold);
        badge.node.setPosition(32, 7);
        const level = caption(badge.node, 'Level', String(gate.level), 0, 0, 16, 11, ManagementColors.gold, Label.HorizontalAlign.CENTER);
        place(level.node, 0, 0, 16, 18);
        this.gateMarkers.push({ node: root, plate, title, gate, x: point.x, y: point.y });
    }

    /** 命中实际显示的关城图和名称牌，点击名称也定位到关城中心。 */
    public pickGate(point: Vec2): CampaignGate | null {
        this.lateUpdate();
        if (!this.root?.active || !this.camera) return null;
        const scale = this.camera.orthoHeight * 2 / Math.max(1, view.getVisibleSize().height);
        let nearest: CampaignGate = null, distance = Infinity;
        for (const marker of this.gateMarkers) {
            if (!marker.node.active) continue;
            const x = (point.x - marker.x) / scale, y = (point.y - marker.y) / scale;
            const iconHit = Math.abs(x) <= 28 && y >= -10 && y <= 32;
            const titleHit = marker.plate.node.active && Math.abs(x) <= 47 && y >= -36 && y <= -10;
            const score = x * x + y * y;
            if ((iconHit || titleHit) && score < distance) { nearest = marker.gate; distance = score; }
        }
        return nearest;
    }

    private title(name: string, text: string, x: number, y: number, width: number, size: number, gate: boolean): void {
        const label = caption(this.root, name, text, x, y, width, size,
            gate ? ManagementColors.gold : ManagementColors.text, Label.HorizontalAlign.CENTER);
        label.enableOutline = true; label.outlineWidth = 2; label.outlineColor = new Color(31, 42, 36, 255);
        this.titles.push({ node: label.node, x, y, width, gate });
    }


    /** 主城使用本人的城池外观，避免无语义的定位圆点。 */
    private updateHomeMarker(home: { x: number; y: number; level: number }, scale: number): void {
        if (!home) {
            if (this.homeMarker) this.homeMarker.node.active = false;
            return;
        }
        if (!this.homeMarker) {
            const node = new Node('MyMainCity'); node.layer = this.root.layer; this.root.addChild(node);
            node.addComponent(UITransform).setContentSize(66, 58);
            const art = new Node('HomeCityArt'); art.layer = node.layer; node.addChild(art);
            art.addComponent(UITransform).setAnchorPoint(.5, .5);
            const sprite = art.addComponent(Sprite); sprite.trim = false;
            const plate = inkSurface(node, 'HomeNameplate', 66, 20, ManagementColors.ink, ManagementColors.gold);
            const name = caption(plate.node, 'HomeName', '我的主城', 0, 0, 60, 12,
                ManagementColors.gold, Label.HorizontalAlign.CENTER);
            place(name.node, 0, 0, 60, 20); name.isBold = true;
            this.homeMarker = { node, sprite, plate, city: home, art: '', height: 0 };
        }
        const marker = this.homeMarker, art = playerCityAppearance(home.level).art;
        if (marker.art !== art) {
            WorldMapArt.apply(marker.sprite, art, 40);
            marker.art = art;
            marker.height = marker.sprite.node.getComponent(UITransform).height;
            marker.plate.node.setPosition(0, -marker.height / 2 - 12, 0);
        }
        marker.city = home;
        const point = MapUtil.mapCellToPixelPoint(new Vec2(home.x, home.y));
        const viewport = view.getVisibleSize(), camera = this.camera.node.position;
        marker.node.active = Math.abs((point.x - camera.x) / scale) < viewport.width / 2 + 36
            && Math.abs((point.y - camera.y) / scale) < viewport.height / 2 + 50;
        marker.node.setPosition(point.x, point.y, 0);
        marker.node.setScale(scale, scale, 1);
    }

    /** 图标与名称共用主城定位，不扩大周围空地的命中范围。 */
    public pickHome(point: Vec2): { x: number; y: number; level: number } | null {
        this.lateUpdate();
        const marker = this.homeMarker;
        if (!this.root?.active || !marker?.node.active) return null;
        const scale = marker.node.scale.x;
        const x = (point.x - marker.node.position.x) / scale;
        const y = (point.y - marker.node.position.y) / scale;
        const iconHit = Math.abs(x) <= 23 && Math.abs(y) <= marker.height / 2 + 3;
        const nameHit = marker.plate.node.active && Math.abs(x) <= 33
            && Math.abs(y - marker.plate.node.position.y) <= 10;
        return iconHit || nameHit ? marker.city : null;
    }

    protected lateUpdate(): void {
        if (!this.root || !this.camera) return;
        const cmd = MapCommand.getInstance(); this.root.active = cmd.proxy.strategic;
        if (!this.root.active) return;
        const height = this.camera.orthoHeight, p = this.camera.node.position, viewport = view.getVisibleSize();
        if (height === this.lastHeight && p.x === this.lastX && p.y === this.lastY && Date.now() - this.lastRefresh < 1000) return;
        this.lastHeight = height; this.lastX = p.x; this.lastY = p.y; this.lastRefresh = Date.now();
        const scale = height * 2 / Math.max(1, viewport.height), placed: { x: number; y: number; width: number; height: number }[] = [];
        this.updateHomeMarker(cmd.cityProxy.getMyMainCity(), scale);
        if (this.homeMarker?.node.active) {
            const marker = this.homeMarker, position = marker.node.position;
            placed.push({ x: (position.x - p.x) / scale, y: (position.y - p.y) / scale - 12,
                width: 66, height: marker.height + 24 });
        }
        const density = scale > 80 ? .86 : 1;
        const iconBoxes = this.gateMarkers.map(marker => ({
            x: (marker.x - p.x) / scale + 8 * density, y: (marker.y - p.y) / scale + 8 * density,
            width: 78 * density, height: Math.max(22, marker.node.getChildByName('GateArt').getComponent(UITransform).height) * density,
        })).concat(this.cityMarkers.map(marker => ({ x: (marker.x - p.x) / scale, y: (marker.y - p.y) / scale,
            width: marker.width * density, height: marker.height * density })));
        // 州名提供全图定位；关城始终保留图标，密集时仅隐藏重叠名称牌。
        for (const title of this.titles) {
            const baseX = (title.x - p.x) / scale, baseY = (title.y - p.y) / scale;
            // 总览缩远后，优先围绕本城换一个空位，避免把州名画到关楼和等级牌上。
            let offset = [0, 38], bestScore = Infinity;
            for (const candidate of [[0, 38], [0, -38], [-80, 0], [80, 0], [0, 56], [0, -56], [-80, 25], [80, 25]]) {
                const x = baseX + candidate[0], y = baseY + candidate[1];
                let score = Math.abs(x) + title.width / 2 > viewport.width / 2
                    || Math.abs(y) + 13 > viewport.height / 2 ? 10000 : 0;
                for (const box of iconBoxes.concat(placed)) {
                    const dx = Math.max(0, (title.width + box.width) / 2 + 3 - Math.abs(x - box.x));
                    const dy = Math.max(0, (26 + box.height) / 2 + 3 - Math.abs(y - box.y));
                    score += dx * dy;
                }
                if (score < bestScore) { bestScore = score; offset = candidate; }
                if (score === 0) break;
            }
            const x = baseX + offset[0], y = baseY + offset[1];
            title.node.active = Math.abs(x) < viewport.width / 2 + 80 && Math.abs(y) < viewport.height / 2 + 30;
            title.node.setScale(scale, scale, 1);
            title.node.setPosition(title.x + offset[0] * scale, title.y + offset[1] * scale, 0);
            title.node.setSiblingIndex(this.root.children.length - 1);
            if (title.node.active) placed.push({ x, y, width: title.width, height: 26 });
        }
        for (const marker of this.cityMarkers) {
            const x = (marker.x - p.x) / scale, y = (marker.y - p.y) / scale;
            marker.node.active = Math.abs(x) < viewport.width / 2 + 40 && Math.abs(y) < viewport.height / 2 + 30;
            if (!marker.node.active) continue;
            marker.node.setPosition(marker.x, marker.y); marker.node.setScale(scale * density, scale * density, 1);
            this.refreshCityOwner(marker, marker.city, marker.width);
            placed.push({ x, y, width: marker.width * density, height: marker.height * density });
        }
        for (const marker of this.gateMarkers) {
            const x = (marker.x - p.x) / scale, y = (marker.y - p.y) / scale;
            marker.node.active = Math.abs(x) < viewport.width / 2 + 50 && Math.abs(y) < viewport.height / 2 + 36;
            if (!marker.node.active) continue;
            marker.node.setPosition(marker.x, marker.y); marker.node.setScale(scale * density, scale * density, 1);
            const labelY = y - 22 * density;
            marker.plate.node.active = !placed.some(other => Math.abs(x - other.x) < (94 * density + other.width) / 2 + 6
                && Math.abs(labelY - other.y) < other.height / 2 + 12 * density + 4);
            if (marker.plate.node.active) placed.push({ x, y: labelY, width: 94 * density, height: 24 * density });
            this.refreshCityOwner(marker, marker.gate, 50);
        }
        if (this.homeMarker?.node.active) this.homeMarker.node.setSiblingIndex(this.root.children.length - 1);
    }
}
