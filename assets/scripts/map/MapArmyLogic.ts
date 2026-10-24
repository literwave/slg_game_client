import { _decorator, Component, Node, Prefab, NodePool, instantiate } from 'cc';
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
import { aoiTroopMotion } from '../world/MarchPath';
import TroopCommand from '../general/TroopCommand';
import type { WorldEntity, MarchInfo } from '../world/WorldCommand';

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

    protected onLoad(): void {
        EventMgr.on(LogicEvent.updateArmyList, this.onUpdateArmyList, this);
        EventMgr.on(LogicEvent.updateArmy, this.onUpdateArmy, this);
        EventMgr.on(LogicEvent.updateWorldEntities, this.syncWorldEntities, this);
        EventMgr.on(LogicEvent.updateMyRole, this.syncWorldEntities, this);
        EventMgr.on(LogicEvent.updateMarches, this.syncWorldEntities, this);
        EventMgr.on(LogicEvent.updateTroopList, this.syncWorldEntities, this);
        EventMgr.on(LogicEvent.updateMyGenerals, this.syncWorldEntities, this);
        EventMgr.on(CoreEvent.gameReady, this.syncWorldEntities, this);
        this.initArmys();
        this.syncWorldEntities();

        this.schedule(this.checkVisible, 0.5);
    }

    protected onDestroy(): void {
        EventMgr.targetOff(this);
        this._armyPool.clear();
        this._arrowPool.clear();
        this._armyLogics.forEach((logic:ArmyLogic) => {
            logic.destroy();
        })
        this.aoiArmies.forEach(logic => logic.destroy());
        this.aoiArmies.clear();
        this.troopBindings.clear();
    }

    protected update():void {
        this._armyLogics.forEach((logic:ArmyLogic) => {
            logic.update();
        });
        if (MapUtil.areaCellSize) this.aoiArmies.forEach(logic => logic.update());
    }

    private syncWorldEntities(): void {
        // 地图加载完成前可能已经收到列表，gameReady 会再次使用缓存进行同步。
        if (!MapUtil.areaCellSize || !this.parentLayer) return;
        // 地图实体全部以 AOI 为准，march_list 仅用于本人部队面板与操作状态。
        // AOI 没有 troopIdx；仅在完整路径和时间戳唯一匹配本人 march 时关联编队。
        // 不拆 entityId，不按列表顺序/同一驻留坐标猜身份，也不重复生成地图实体。
        const entities = Array.from(WorldCommand.getInstance().entities.values())
            .filter(e => hasId(e.entityId) && !!aoiTroopMotion(e));
        const ownerId = LoginCommand.getInstance().proxy.getRoleData()?.userId;
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
                logic.aniNode.parent = this.parentLayer; logic.arrowNode.parent = this.parentLayer;
                this.aoiArmies.set(id, logic);
            }
            const own = hasId(ownerId) && idKey(ownerId) === idKey(entity.ownerId);
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
            logic.setWorldEntity(entity, own, logic.aniNode, logic.arrowNode, troop);
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
