import { _decorator, Component, Node, Prefab, NodePool, instantiate, Color, Graphics, UITransform, Vec2 } from 'cc';
const { ccclass, property } = _decorator;

import ArmyCommand from "../general/ArmyCommand";
import { ArmyCmd, ArmyData } from "../general/ArmyProxy";
import ArmyLogic from "./entries/ArmyLogic";
import MapCommand from "./MapCommand";
import MapUtil from "./MapUtil";
import { EventMgr } from '../utils/EventMgr';
import { LogicEvent } from '../common/LogicEvent';
import { CoreEvent } from '../core/CoreEvent';
import WorldCommand from '../world/WorldCommand';
import LoginCommand from '../login/LoginCommand';
import { hasId, idKey } from '../network/pto/ProtocolCommand';
import { aoiTroopMotion, buildMarchPath, sampleMarchPath } from '../world/MarchPath';
import type { MarchPath } from '../world/MarchPath';
import DateUtil from '../utils/DateUtil';
import TroopCommand from '../general/TroopCommand';
import type { WorldEntity, MarchInfo } from '../world/WorldCommand';
import MapDepthLayer from './MapDepthLayer';
import { TroopStateEnum } from '../config/enum/TroopStateEnum';
import OwnMarchRoute from './OwnMarchRoute';
import CityCommand from '../world/CityCommand';
import { deployedEntityCity } from './CityDeployment';

@ccclass('MapArmyLogic')
export default class MapArmyLogic extends Component {
    @property(Node)
    parentLayer: Node = null;
    @property(Prefab)
    armyPrefab: Prefab = null;
    @property(Prefab)
    arrowPrefab: Prefab = null;

    protected _armyLogics: Map<number, ArmyLogic> = new Map<number, ArmyLogic>();
    protected _armyPool: NodePool = new NodePool();
    protected _arrowPool: NodePool = new NodePool();
    private aoiArmies = new Map<string, ArmyLogic>();
    private troopBindings = new Map<string, number>();
    private depthLayer: MapDepthLayer = null;
    private routePreviewNode: Node = null;
    private cameraMarch: MarchInfo = null;
    private cameraPath: MarchPath = null;
    private offscreenRoutes = new Map<number, OwnMarchRoute>();

    protected onLoad(): void {
        EventMgr.on(LogicEvent.updateArmyList, this.onUpdateArmyList, this);
        EventMgr.on(LogicEvent.updateArmy, this.onUpdateArmy, this);
        EventMgr.on(LogicEvent.updateWorldEntities, this.syncWorldEntities, this);
        EventMgr.on(LogicEvent.updateMyRole, this.syncWorldEntities, this);
        EventMgr.on(LogicEvent.updateMarches, this.syncWorldEntities, this);
        EventMgr.on(LogicEvent.updateTroopList, this.syncWorldEntities, this);
        EventMgr.on(LogicEvent.updateMyGenerals, this.syncWorldEntities, this);
        EventMgr.on(LogicEvent.updateAllianceCities, this.syncWorldEntities, this);
        EventMgr.on(CoreEvent.gameReady, this.syncWorldEntities, this);
        EventMgr.on(LogicEvent.updateMarchRoute, this.drawRoutePreview, this);
        EventMgr.on(CoreEvent.gameReady, this.drawRoutePreview, this);
        this.initArmys();
        this.syncWorldEntities();

        this.schedule(this.checkVisible, 0.5);
    }

    protected onDestroy(): void {
        EventMgr.targetOff(this);
        this.routePreviewNode?.destroy(); this.routePreviewNode = null;
        this._armyPool.clear();
        this._arrowPool.clear();
        this._armyLogics.forEach((logic:ArmyLogic) => {
            logic.destroy();
        })
        this.aoiArmies.forEach(logic => logic.destroy());
        this.aoiArmies.clear();
        this.troopBindings.clear();
        this.cameraMarch = null; this.cameraPath = null;
        this.offscreenRoutes.forEach(route => route.destroy()); this.offscreenRoutes.clear();
    }

    protected update():void {
        this._armyLogics.forEach((logic:ArmyLogic) => {
            logic.update();
        });
        if (MapUtil.areaCellSize) this.aoiArmies.forEach(logic => logic.update());
        if (MapUtil.areaCellSize) this.offscreenRoutes.forEach(route => route.update());
    }

    protected lateUpdate(): void { this.depthLayer?.update(); }

    /** 优先跟随已绘制的本人部队；视野外用行军快照定位以便拉取该处 AOI。 */
    public troopMapPosition(troopIdx: number): Vec2 | null {
        const world = WorldCommand.getInstance(), march = world.marches.get(troopIdx);
        if (!march || world.isTroopAtHome(troopIdx)) return null;
        for (const [id, index] of this.troopBindings) {
            if (index !== troopIdx) continue;
            const node = this.aoiArmies.get(id)?.aniNode;
            if (node?.isValid && node.activeInHierarchy) return new Vec2(node.position.x, node.position.y);
        }
        if (march !== this.cameraMarch) {
            this.cameraMarch = march; this.cameraPath = buildMarchPath(march);
        }
        const point = sampleMarchPath(march, this.cameraPath, DateUtil.getServerTime())?.position;
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0
            || point.x >= MapUtil.mapSize.width || point.y >= MapUtil.mapSize.height) return null;
        return MapUtil.mapCellToPixelPoint(new Vec2(point.x, point.y));
    }

    public pickTroop(point: Vec2): number | null {
        let selected: number | null = null, nearest = Infinity;
        for (const [id, idx] of this.troopBindings) {
            const node = this.aoiArmies.get(id)?.aniNode;
            if (!node?.isValid || !node.activeInHierarchy) continue;
            const dx = point.x - node.position.x, dy = point.y - node.position.y - 20;
            const distance = dx * dx + dy * dy;
            if (Math.abs(dx) <= 45 && Math.abs(dy) <= 55 && distance < nearest) {
                nearest = distance; selected = idx;
            }
        }
        return selected;
    }

    private attachMarch(logic: ArmyLogic): void {
        if (!this.depthLayer) this.depthLayer = MapDepthLayer.forLayer(this.parentLayer);
        logic.aniNode.parent = this.depthLayer?.troops || this.parentLayer;
        logic.arrowNode.parent = this.depthLayer?.routes || this.parentLayer;
        logic.setFormationLayer(this.depthLayer?.troops || null);
    }

    private drawRoutePreview(): void {
        const route = WorldCommand.getInstance().marchRoute;
        if (!route || route.status !== 'ready' || !MapUtil.areaCellSize || !this.parentLayer) {
            if (this.routePreviewNode) this.routePreviewNode.active = false;
            return;
        }
        if (!this.depthLayer) this.depthLayer = MapDepthLayer.forLayer(this.parentLayer);
        if (!this.routePreviewNode) {
            const node = this.routePreviewNode = new Node('MarchRoutePreview'); node.layer = this.parentLayer.layer;
            node.parent = this.depthLayer?.routes || this.parentLayer;
            node.addComponent(UITransform); node.addComponent(Graphics);
        }
        this.routePreviewNode.active = true;
        const g = this.routePreviewNode.getComponent(Graphics); g.clear();
        const points = route.path.map(p => MapUtil.mapCellToPixelPoint(new Vec2(p.x, p.y)));
        if (points.length < 2) return;
        // 路线位于地面层，保留服务端拐点；不移动镜头，不代替真实部队行军线。
        for (const [width, color] of [[6, new Color(42, 35, 22, 150)], [3, new Color(243, 205, 118, 235)]] as const) {
            g.lineWidth = width; g.strokeColor = color;
            g.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
            g.stroke();
        }
        g.lineWidth = 2;
        const first = points[0], last = points[points.length - 1];
        g.ellipse(first.x, first.y, 7, 4); g.stroke();
        g.moveTo(last.x, last.y + 7); g.lineTo(last.x + 12, last.y);
        g.lineTo(last.x, last.y - 7); g.lineTo(last.x - 12, last.y); g.lineTo(last.x, last.y + 7); g.stroke();
    }

    private syncWorldEntities(): void {
        // 地图加载完成前可能已经收到列表，gameReady 会再次使用缓存进行同步。
        if (!MapUtil.areaCellSize || !this.parentLayer) return;
        // 地图实体全部以 AOI 为准；本人 march_list 还用于视野外的路线，不据此生成部队。
        // AOI 没有 troopIdx；仅在完整路径和时间戳唯一匹配本人 march 时关联编队。
        // 不拆 entityId，不按列表顺序/同一驻留坐标猜身份，也不重复生成地图实体。
        const world = WorldCommand.getInstance(), cities = CityCommand.getInstance().cities;
        const ownerId = LoginCommand.getInstance().proxy.getRoleData()?.userId;
        const entities = Array.from(world.entities.values()).filter(e => {
            if (!hasId(e.entityId) || !aoiTroopMotion(e)) return false;
            const own = hasId(ownerId) && idKey(ownerId) === idKey(e.ownerId);
            const idx = e.troopIdx || this.troopBindings.get(idKey(e.entityId));
            // 城内驻留由城池队伍入口承载；回收整个队形，独立深度层的小兵也不能残留。
            return !deployedEntityCity(e, cities, own && idx ? world.marches.get(idx) : undefined);
        });
        const current = new Set(entities.map(e => idKey(e.entityId)));
        for (const [id, logic] of this.aoiArmies) {
            if (current.has(id)) continue;
            this._armyPool.put(logic.aniNode); this._arrowPool.put(logic.arrowNode); logic.clear();
            this.aoiArmies.delete(id);
            this.troopBindings.delete(id);
        }
        for (const entity of entities) {
            const id = idKey(entity.entityId);
            let logic = this.aoiArmies.get(id);
            if (!logic) {
                logic = new ArmyLogic(); logic.aniNode = this.createArmy(); logic.arrowNode = this.createArrow();
                this.attachMarch(logic);
                this.aoiArmies.set(id, logic);
            }
            const own = hasId(ownerId) && idKey(ownerId) === idKey(entity.ownerId);
            // 新协议明确带部队编号；重登时从攻城/驻留快照也能绑定本人编队。
            if (own && Number.isInteger(entity.troopIdx) && entity.troopIdx > 0) this.troopBindings.set(id, entity.troopIdx);
            if (own && !this.troopBindings.has(id)) {
                const candidates = WorldCommand.getInstance().marches.values().filter(m => this.matchesMarch(entity, m));
                if (candidates.length === 1 && entities.filter(e => idKey(e.ownerId) === idKey(ownerId)
                    && this.matchesMarch(e, candidates[0])).length === 1) {
                    this.troopBindings.set(id, candidates[0].troopIdx);
                }
            }
            if (!own) this.troopBindings.delete(id);
            const troopIdx = own ? this.troopBindings.get(id) : 0;
            const troop = troopIdx ? TroopCommand.getInstance().proxy.getTroop(troopIdx) : null;
            // 本人行军优先用 s2c_march 折线；AOI 更新偶发丢 path 时不要退成起终点直线
            const march = troopIdx ? WorldCommand.getInstance().marches.get(troopIdx) : null;
            const view = own && march?.state === 1 && entity.troopState !== TroopStateEnum.SIEGE && Array.isArray(march.path) && march.path.length >= 2
                ? { ...entity, path: march.path, startTime: march.startTime, endTime: march.endTime }
                : entity;
            logic.setWorldEntity(view, own, logic.aniNode, logic.arrowNode, troop);
        }
        this.syncOffscreenRoutes();
    }

    private syncOffscreenRoutes(): void {
        // 镜头在目的城池时，赶来的部队可能尚未进入 AOI，但本人完整行军路线已知。
        // 进入 AOI 后交还 ArmyLogic 绘制，避免同一路线叠画；到达/攻城/回城结束即清理。
        const represented = new Set(this.troopBindings.values());
        const wanted = new Map(WorldCommand.getInstance().marches.values()
            .filter(march => march.state === 1 && march.troopState !== TroopStateEnum.SIEGE
                && !represented.has(march.troopIdx) && Array.isArray(march.path) && march.path.length >= 2
                && march.path.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y)
                    && p.x >= 0 && p.y >= 0 && p.x < MapUtil.mapSize.width && p.y < MapUtil.mapSize.height))
            .map(march => [march.troopIdx, march] as const));
        for (const [idx, route] of this.offscreenRoutes) if (!wanted.has(idx)) {
            route.destroy(); this.offscreenRoutes.delete(idx);
        }
        if (wanted.size && !this.depthLayer) this.depthLayer = MapDepthLayer.forLayer(this.parentLayer);
        for (const [idx, march] of wanted) {
            let route = this.offscreenRoutes.get(idx);
            if (!route) {
                route = new OwnMarchRoute(this.depthLayer?.routes || this.parentLayer, idx);
                this.offscreenRoutes.set(idx, route);
            }
            route.setMarch(march);
        }
    }

    private matchesMarch(entity: WorldEntity, march: MarchInfo): boolean {
        return march.state === 1 && entity.path?.length >= 2 && march.path?.length === entity.path.length
            && Math.abs(entity.startTime - march.startTime) < .001 && Math.abs(entity.endTime - march.endTime) < .001
            && entity.path.every((p, i) => Math.abs(p.x - march.path[i].x) < .00001 && Math.abs(p.y - march.path[i].y) < .00001);
    }

    protected initArmys(): void {
        let datas: ArmyData[] = ArmyCommand.getInstance().proxy.getAllArmys();
        if (datas && datas.length > 0) {
            this.onUpdateArmyList(datas);
        }
    }

    protected onUpdateArmyList(datas: ArmyData[]): void {
        for (let i:number = 0; i < datas.length; i++) {
            if (datas[i] && datas[i].cmd > 0) {
                this.onUpdateArmy(datas[i]);
            }
        }
    }

    protected onUpdateArmy(data: ArmyData): void {
        console.log("onUpdateArmy", data);
        let aniNode: Node = null;
        let arrowNode: Node = null;
        if (data.cmd == ArmyCmd.Idle || data.cmd == ArmyCmd.Conscript) {
            //代表不在地图上
            this.removeArmyById(data.id);
            return;
        }
        let logic:ArmyLogic = this._armyLogics.get(data.id);
        console.log("onUpdateArmy 1111:", logic);

        if (logic == null) {
            logic = new ArmyLogic();
            aniNode = this.createArmy();
            aniNode.parent = this.parentLayer;
            arrowNode = this.createArrow();
            arrowNode.parent = this.parentLayer;
            this._armyLogics.set(data.id, logic);

            console.log("onUpdateArmy 2222:", logic);
        } else {
            aniNode = logic.aniNode;
            arrowNode = logic.arrowNode;
            logic = this._armyLogics.get(data.id);
        }
        console.log("onUpdateArmy 3333:", logic);
        logic.setArmyData(data, aniNode, arrowNode);
        this.attachMarch(logic);
    }

    protected createArmy(): Node {
        if (this._armyPool.size() > 0) {
            return this._armyPool.get();
        } else {
            return instantiate(this.armyPrefab);
        }
    }

    protected createArrow():Node {
        if (this._arrowPool.size() > 0) {
            return this._arrowPool.get();
        } else {
            return instantiate(this.arrowPrefab);
        }
    }

    protected removeArmyById(id: number): void {
        if (this._armyLogics.has(id)) {
            let logic:ArmyLogic = this._armyLogics.get(id);
            this._armyPool.put(logic.aniNode);
            this._arrowPool.put(logic.arrowNode);
            logic.clear();
            this._armyLogics.delete(id);
            console.log("removeArmyById", id);
        }
    }


    protected checkVisible(): void {

        this._armyLogics.forEach((logic:ArmyLogic) => {
            let city = MapCommand.getInstance().cityProxy.getMyCityById(logic.data.cityId);
            if(!city || city.rid != MapCommand.getInstance().buildProxy.myId){
            
                var visible1 = MapUtil.armyIsInView(logic.data.x, logic.data.y);
                var visible2 = MapUtil.armyIsInView(logic.data.toX, logic.data.toY);
                var visible3 = MapUtil.armyIsInView(logic.data.fromX, logic.data.fromY);
                if(!visible1 && !visible2 && !visible3){
                    this.removeArmyById(logic.data.id);
                }
            }
            
        });
    }
}
