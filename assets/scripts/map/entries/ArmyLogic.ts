import { ArmyData } from "../../general/ArmyProxy";
import DateUtil from "../../utils/DateUtil";
import MapUtil from "../MapUtil";
import { Vec2, Node, Animation, Vec3, UITransform, Color, Graphics, Sprite } from "cc";
import type { MarchInfo, WorldEntity } from '../../world/WorldCommand';
import { aoiTroopMotion, MarchMotion, MarchPath } from '../../world/MarchPath';
import MarchPlayback from '../../world/MarchPlayback';
import MarchFormation from './MarchFormation';
import type { TroopData } from '../../general/TroopProxy';

export default class ArmyLogic {
    public data: ArmyData = null;
    public aniNode: Node = null;
    public arrowNode: Node = null;

    protected _parentLayer: Node;

    protected _aniName: string = "";
    protected _startPixelPos: Vec3 = new Vec3(0, 0, 0);
    protected _endPixelPos: Vec3 = new Vec3(0, 0, 0);
    protected _lenX: number = 0;
    protected _lenY: number = 0;
    private march: MarchMotion = null;
    private marchPath: MarchPath = null;
    private routeGraphics: Graphics = null;
    private routePixels: Vec2[] = [];
    private marching = false;
    private playback: MarchPlayback = null;
    private formation: MarchFormation = null;

    public clear() {
        this.formation?.destroy(); this.formation = null; this.playback = null;
        this.data = null;
        this.aniNode = null;
        this.arrowNode = null;
        this._parentLayer = null;
        this.march = null; this.marchPath = null; this._aniName = ''; this.marching = false;
        this.routeGraphics = null; this.routePixels = [];
    }

    public destroy(): void {
        this.aniNode.parent = null;
        this.arrowNode.parent = null;
        this.clear();
    }

    public update(): Vec2 {
        if (this.march) return this.updateMarch();
        if (this.data && this.data.state > 0) {
            let nowTime: number = DateUtil.getServerTime();
            if (nowTime < this.data.endTime) {
                //代表移动中
                let percent: number = Math.max(0, (nowTime - this.data.startTime) / (this.data.endTime - this.data.startTime));
               
                let pos = this.aniNode.position.clone();
                pos.x = this._startPixelPos.x + percent * this._lenX;
                pos.y = this._startPixelPos.y + percent * this._lenY;
                this.aniNode.setPosition(pos);

                let cellPoint: Vec2 = MapUtil.mapPixelToCellPoint(new Vec2(pos.x, pos.y));
                this.data.x = cellPoint.x;
                this.data.y = cellPoint.y;
            } else {
                this.aniNode.setPosition(this._endPixelPos);
                this.data.x = this.data.toX;
                this.data.y = this.data.toY;
            }
            this.updateArrow();
            return new Vec2(this.data.x, this.data.y);
        }
        return null;
    }

    protected updateArrow(): void {
        this.arrowNode.active = this.data && this.data.state > 0;
        if (this.arrowNode.active == true) {
        
            this.arrowNode.setPosition(this.aniNode.getPosition());
            let len: number = Math.sqrt(
                Math.abs((this._endPixelPos.y - this.arrowNode.position.y) * (this._endPixelPos.y - this.arrowNode.position.y))
                + Math.abs((this._endPixelPos.x - this.arrowNode.position.x) * (this._endPixelPos.x - this.arrowNode.position.x)));
            let angle: number = Math.atan2(this._endPixelPos.y - this.arrowNode.position.y, this._endPixelPos.x - this.arrowNode.position.x);
            this.arrowNode.angle = angle * 180 / Math.PI + 90;
            this.arrowNode.getComponent(UITransform).height = len;
        }
    }

    public setArmyData(data: ArmyData, aniNode: Node, arrowNode: Node): void {
        this.formation?.destroy(); this.formation = null; this.playback = null;
        this.march = null; this.marchPath = null;
        this.routeGraphics = null; this.routePixels = [];
        const marker = aniNode.getChildByName('WorldTroopMarker'); if (marker) marker.active = false;
        const route = arrowNode.getChildByName('WorldMarchRoute'); if (route) route.active = false;
        const sprite = arrowNode.getComponent(Sprite); if (sprite) sprite.enabled = true;
        this.data = data;
        this.aniNode = aniNode;
        this.arrowNode = arrowNode;

        let startPos:Vec2 = MapUtil.mapCellToPixelPoint(new Vec2(this.data.fromX, this.data.fromY));
        this._startPixelPos.x = startPos.x;
        this._startPixelPos.y = startPos.y;

        let endPos:Vec2 = MapUtil.mapCellToPixelPoint(new Vec2(this.data.toX, this.data.toY));
        this._endPixelPos.x = endPos.x;
        this._endPixelPos.y = endPos.y;

        this._lenX = this._endPixelPos.x - this._startPixelPos.x;
        this._lenY = this._endPixelPos.y - this._startPixelPos.y;

        let pos = MapUtil.mapCellToPixelPoint(new Vec2(this.data.x, this.data.y));
        this.aniNode.setPosition(new Vec3(pos.x, pos.y, 0));

        this._aniName = "qb_run_r";
        if (this._startPixelPos.y == this._endPixelPos.y) {
            //平行
            if (this._startPixelPos.x < this._endPixelPos.x) {
                this._aniName = "qb_run_r";
            } else {
                this._aniName = "qb_run_l";
            }
        } else if (this._startPixelPos.y < this._endPixelPos.y) {
            //往上走
            if (this._startPixelPos.x < this._endPixelPos.x) {
                this._aniName = "qb_run_ru";
            } else if (this._startPixelPos.x == this._endPixelPos.x) {
                this._aniName = "qb_run_u";
            } else {
                this._aniName = "qb_run_lu";
            }
        } else if (this._startPixelPos.y > this._endPixelPos.y) {
            //往下走
            if (this._startPixelPos.x < this._endPixelPos.x) {
                this._aniName = "qb_run_rd";
            } else if (this._startPixelPos.x == this._endPixelPos.x) {
                this._aniName = "qb_run_d";
            } else {
                this._aniName = "qb_run_ld";
            }
        }

        this.aniNode.getComponent(Animation).play(this._aniName);

        this.updateArrow();
    }

    public setMarchData(march: MarchInfo, aniNode: Node, arrowNode: Node): void {
        const marker = aniNode.getChildByName('WorldTroopMarker'); if (marker) marker.active = false;
        this.setMotion(march, aniNode, arrowNode, new Color(230, 202, 126, 185));
    }

    public setWorldEntity(entity: WorldEntity, own: boolean, aniNode: Node, arrowNode: Node, troop: TroopData | null = null): void {
        const motion = aoiTroopMotion(entity);
        if (!motion) { aniNode.active = arrowNode.active = false; return; }
        // 其他玩家不一定是敌方，只用不同颜色区别于本人，不推断同盟/敌对关系。
        const color = own ? new Color(111, 190, 233, 230) : new Color(237, 188, 98, 230);
        if (!this.formation) this.formation = new MarchFormation(aniNode);
        this.formation.configure(troop, own);
        this.setMotion(motion, aniNode, arrowNode, color);
        let marker = aniNode.getChildByName('WorldTroopMarker');
        if (!marker) {
            marker = new Node('WorldTroopMarker'); marker.layer = aniNode.layer;
            aniNode.addChild(marker); marker.addComponent(UITransform); marker.addComponent(Graphics);
        }
        marker.active = true; marker.setSiblingIndex(0);
        const g = marker.getComponent(Graphics); g.clear();
        g.strokeColor = color; g.lineWidth = 2;
        g.fillColor = new Color(color.r, color.g, color.b, 45);
        g.ellipse(0, 0, 20, 9); g.fill(); g.stroke();
    }

    private setMotion(march: MarchMotion, aniNode: Node, arrowNode: Node, routeColor: Color): void {
        this.data = null; this.march = march;
        if (!this.playback) this.playback = new MarchPlayback();
        const changed = this.playback.setMotion(march, DateUtil.getServerTime(), DateUtil.monotonicNow());
        this.marchPath = this.playback.path;
        this.aniNode = aniNode; this.arrowNode = arrowNode;
        if (!changed) return;
        arrowNode.angle = 0; arrowNode.setPosition(0, 0, 0); arrowNode.setScale(1, 1, 1);
        arrowNode.setSiblingIndex(0);
        const sprite = arrowNode.getComponent(Sprite); if (sprite) sprite.enabled = false;
        let route = arrowNode.getChildByName('WorldMarchRoute');
        if (!route) {
            route = new Node('WorldMarchRoute'); route.layer = arrowNode.layer;
            arrowNode.addChild(route); route.addComponent(UITransform); route.addComponent(Graphics);
        }
        route.active = true;
        const g = route.getComponent(Graphics); g.clear(); g.lineWidth = 3;
        g.strokeColor = routeColor;
        this.routeGraphics = g;
        this.routePixels = this.marchPath.points.map(point => MapUtil.mapCellToPixelPoint(new Vec2(point.x, point.y)));
        this.updateMarch();
    }

    /** 只画当前位置前方的剩余折线；按播放弧长裁切，折返/交叉路径也不会留下身后的旧线。 */
    private drawRemainingMarchRoute(pixel: Vec2): void {
        const g = this.routeGraphics;
        if (!g) return;
        g.clear();
        if (!this.arrowNode.active) return;
        g.moveTo(pixel.x, pixel.y);
        let segments = 0;
        for (let i = 1; i < this.routePixels.length; i++) {
            if (this.marchPath.distances[i] <= this.playback.distance + .00001) continue;
            const next = this.routePixels[i];
            g.lineTo(next.x, next.y); segments++;
        }
        if (segments) g.stroke();
    }

    private updateMarch(): Vec2 {
        const sample = this.playback?.sample(DateUtil.monotonicNow());
        if (!sample) { this.aniNode.active = this.arrowNode.active = false; return null; }
        const point = new Vec2(sample.position.x, sample.position.y), pixel = MapUtil.mapCellToPixelPoint(point);
        this.aniNode.active = true; this.aniNode.setPosition(pixel.x, pixel.y, 0);
        this.arrowNode.active = sample.moving;
        this.drawRemainingMarchRoute(pixel);
        if (this.formation) {
            this.formation.update(this.playback, sample);
            this.marching = sample.moving;
            return point;
        }
        const animation = this.aniNode.getComponent(Animation);
        if (animation && sample.moving) {
            const next = MapUtil.mapCellToPixelPoint(new Vec2(sample.towards.x, sample.towards.y));
            const direction = (Math.round(Math.atan2(next.y - pixel.y, next.x - pixel.x) / (Math.PI / 4)) + 8) % 8;
            const name = ['qb_run_r', 'qb_run_ru', 'qb_run_u', 'qb_run_lu', 'qb_run_l', 'qb_run_ld', 'qb_run_d', 'qb_run_rd'][direction];
            if (name !== this._aniName || !this.marching) { animation.play(name); this._aniName = name; }
        } else if (animation) {
            if (!this._aniName) { animation.play('qb_run_rd'); this._aniName = 'qb_run_rd'; }
            animation.pause();
        }
        this.marching = sample.moving;
        // 只改变显示位置，业务上的到达/战斗/占领仍由服务端推送确定。
        return point;
    }
}
