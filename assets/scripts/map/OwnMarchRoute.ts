import { Color, Graphics, Node, UITransform, Vec2 } from 'cc';
import DateUtil from '../utils/DateUtil';
import type { MarchInfo } from '../world/WorldCommand';
import MarchPlayback from '../world/MarchPlayback';
import MapUtil from './MapUtil';

/** 本人已知路线独立于 AOI 部队；只画地面行军线，不创建视野外的部队。 */
export default class OwnMarchRoute {
    readonly node: Node;
    private readonly graphics: Graphics;
    private readonly playback = new MarchPlayback();
    private pixels: Vec2[] = [];

    constructor(parent: Node, troopIdx: number) {
        this.node = new Node('OwnMarchRoute' + troopIdx); this.node.layer = parent.layer;
        parent.addChild(this.node); this.node.addComponent(UITransform);
        this.graphics = this.node.addComponent(Graphics);
    }

    setMarch(march: MarchInfo): void {
        if (this.playback.setMotion(march, DateUtil.getServerTime(), DateUtil.monotonicNow())) {
            this.pixels = this.playback.path.points.map(p => MapUtil.mapCellToPixelPoint(new Vec2(p.x, p.y)));
        }
        this.update();
    }

    update(): void {
        const sample = this.playback.sample(DateUtil.monotonicNow()), g = this.graphics;
        this.node.active = !!sample?.moving;
        g.clear();
        if (!sample?.moving) return;
        const start = MapUtil.mapCellToPixelPoint(new Vec2(sample.position.x, sample.position.y));
        // 保留服务端拐点，仅画剩余路段；抵达城外接敌点后自动收线。
        g.lineWidth = 3; g.strokeColor = new Color(111, 190, 233, 230);
        g.moveTo(start.x, start.y);
        let segments = 0;
        for (let i = 1; i < this.pixels.length; i++) {
            if (this.playback.path.distances[i] <= this.playback.distance + .00001) continue;
            g.lineTo(this.pixels[i].x, this.pixels[i].y); segments++;
        }
        if (segments) g.stroke();
    }

    destroy(): void { this.node.destroy(); }
}
