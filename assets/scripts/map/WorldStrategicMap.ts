import { _decorator, Camera, Color, Component, Graphics, Label, Node, UITransform, Vec2, view } from 'cc';
import MapCommand from './MapCommand';
import MapUtil from './MapUtil';
import WorldCampaign from './WorldCampaign';
import { caption, ManagementColors } from './ui/ManagementStyle';
const { ccclass } = _decorator;

/** 与地图共用相机的远景，不创建百万格资源节点。 */
@ccclass('WorldStrategicMap')
export default class WorldStrategicMap extends Component {
    private camera: Camera = null;
    private root: Node = null;
    private symbols: Graphics = null;
    private titles: { node: Node; x: number; y: number; width: number; gate: boolean }[] = [];
    private lastHeight = 0;
    private lastX = Infinity;
    private lastY = Infinity;
    private lastRefresh = 0;

    initialize(camera: Camera): void {
        this.camera = camera;
        this.root = new Node('StrategicWorld'); this.root.layer = this.node.layer;
        this.node.addChild(this.root); this.root.addComponent(UITransform).setContentSize(MapUtil.mapPixcelSize);
        const terrain = new Node('ProvinceColors'); terrain.layer = this.node.layer; this.root.addChild(terrain);
        const g = terrain.addComponent(Graphics), config = WorldCampaign.config;
        const point = (x: number, y: number) => MapUtil.mapCellToPixelPoint(new Vec2(x, y));
        // 固定2500个色面，开销与缩放范围无关。
        for (let y = 0; y < config.height; y += 20) for (let x = 0; x < config.width; x += 20) {
            const color = new Color().fromHEX(config.regions[WorldCampaign.regionAt(x, y)].color);
            color.a = 225; g.fillColor = color;
            const points = [[x, y], [Math.min(999, x + 20), y], [Math.min(999, x + 20), Math.min(999, y + 20)], [x, Math.min(999, y + 20)]];
            points.forEach(([cx, cy], i) => { const p = point(cx, cy); if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); });
            g.close(); g.fill();
        }
        // 真实州界：两道环形防线与放射山脉，不用资源小点淹没战略信息。
        g.strokeColor = new Color(44, 56, 49, 255); g.lineWidth = 380;
        for (const radius of [100, 285]) {
            for (let i = 0; i <= 180; i++) {
                const a = i * Math.PI * 2 / 180, p = point(499.5 + Math.cos(a) * radius, 499.5 + Math.sin(a) * radius);
                if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y);
            }
            g.close(); g.stroke();
        }
        for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3, start = i % 2 === 0 ? 100 : 285;
            const end = Math.min(499.5 / Math.max(.001, Math.abs(Math.cos(a))), 499.5 / Math.max(.001, Math.abs(Math.sin(a))));
            const p = point(499.5 + Math.cos(a) * start, 499.5 + Math.sin(a) * start);
            const q = point(499.5 + Math.cos(a) * end, 499.5 + Math.sin(a) * end);
            g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
        }
        const symbols = new Node('StrategicLandmarks'); symbols.layer = this.node.layer; this.root.addChild(symbols);
        this.symbols = symbols.addComponent(Graphics);
        for (const region of config.regions) {
            const p = point(region.x, region.y);
            this.title('Region' + region.id, region.name, p.x, p.y + 900, 100, 21, false);
        }
        for (const gate of config.gates) {
            const p = point(gate.x, gate.y);
            this.title(gate.id, gate.name, p.x, p.y, 90, 13, true);
        }
        this.root.active = false;
    }

    private title(name: string, text: string, x: number, y: number, width: number, size: number, gate: boolean): void {
        const label = caption(this.root, name, text, x, y, width, size,
            gate ? ManagementColors.gold : ManagementColors.text, Label.HorizontalAlign.CENTER);
        label.enableOutline = true; label.outlineWidth = 2; label.outlineColor = new Color(31, 42, 36, 255);
        this.titles.push({ node: label.node, x, y, width, gate });
    }

    protected lateUpdate(): void {
        if (!this.root || !this.camera) return;
        const cmd = MapCommand.getInstance(); this.root.active = cmd.proxy.strategic;
        if (!this.root.active) return;
        const height = this.camera.orthoHeight, p = this.camera.node.position, viewport = view.getVisibleSize();
        if (height === this.lastHeight && p.x === this.lastX && p.y === this.lastY && Date.now() - this.lastRefresh < 1000) return;
        this.lastHeight = height; this.lastX = p.x; this.lastY = p.y; this.lastRefresh = Date.now();
        const scale = height * 2 / Math.max(1, viewport.height), placed: { x: number; y: number; width: number }[] = [];
        for (const title of this.titles) {
            const x = (title.x - p.x) / scale, y = (title.y - p.y) / scale + (title.gate ? -18 : 16);
            const visible = Math.abs(x) < viewport.width / 2 + 80 && Math.abs(y) < viewport.height / 2 + 30;
            title.node.active = visible && !placed.some(other => Math.abs(x - other.x) < (title.width + other.width) / 2 && Math.abs(y - other.y) < 30);
            title.node.setScale(scale, scale, 1);
            title.node.setPosition(title.x, title.y + (title.gate ? -18 : 16) * scale, 0);
            if (title.node.active) placed.push({ x, y, width: title.width });
        }
        const g = this.symbols; g.clear(); const radius = scale * 6;
        for (const gate of WorldCampaign.config.gates) {
            const p = MapUtil.mapCellToPixelPoint(new Vec2(gate.x, gate.y));
            const build = cmd.buildProxy.getBuild(gate.x + gate.y * 1000);
            const own = !!build && (build.rid > 0 && String(build.rid) === String(cmd.cityProxy.myId)
                || Number(cmd.cityProxy.myUnionId) > 0 && String(build.unionId) === String(cmd.cityProxy.myUnionId));
            g.fillColor = own ? new Color(235, 201, 112, 255) : new Color(61, 66, 55, 255);
            g.strokeColor = ManagementColors.gold; g.lineWidth = scale * 1.5;
            g.moveTo(p.x, p.y + radius); g.lineTo(p.x + radius, p.y); g.lineTo(p.x, p.y - radius); g.lineTo(p.x - radius, p.y); g.close(); g.fill(); g.stroke();
        }
        for (const city of WorldCampaign.config.cities) {
            const p = MapUtil.mapCellToPixelPoint(new Vec2(city.x, city.y));
            g.fillColor = city.level >= 10 ? ManagementColors.gold : ManagementColors.text;
            g.rect(p.x - radius, p.y - radius, radius * 2, radius * 2); g.fill();
        }
        const home = cmd.cityProxy.getMyMainCity();
        if (home) { const p = MapUtil.mapCellToPixelPoint(new Vec2(home.x, home.y)); g.fillColor = new Color(113, 201, 240, 255); g.circle(p.x, p.y, radius * 1.4); g.fill(); }
    }
}
