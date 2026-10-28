import { _decorator, Camera, Node, Vec2, Vec3, view } from 'cc';
const { ccclass } = _decorator;

import ResLogic from "./entries/ResLogic";
import MapBaseLayerLogic from "./MapBaseLayerLogic";
import { MapResData, MapResType } from "./MapProxy";
import MapUtil from "./MapUtil";
import WorldCommand, { MarchTargetType } from '../world/WorldCommand';
import LoginCommand from '../login/LoginCommand';
import { hasId, idKey } from '../network/pto/ProtocolCommand';
import { LogicEvent } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';
import DateUtil from '../utils/DateUtil';
import LandClaimView, { LandClaim } from './LandClaimView';

@ccclass('MapResLogic')
export default class MapResLogic extends MapBaseLayerLogic {
    private overview = false;
    private landClaims = new Map<number, LandClaim>();
    private claimViews = new Map<number, LandClaimView>();
    private territoryLayer: Node = null;
    private mapCamera: Camera = null;
    private viewKey = '';
    private expiredTimers = new Set<string>();

    protected onLoad(): void {
        super.onLoad();
        EventMgr.on(LogicEvent.updateWorldEntities, this.refreshOwnership, this);
        EventMgr.on(LogicEvent.updateMarches, this.refreshOwnership, this);
        EventMgr.on(LogicEvent.updateMyRole, this.refreshOwnership, this);
        EventMgr.on(LogicEvent.updatePlayerCityTiles, this.refreshOwnership, this);
        this.refreshOwnership();
    }

    protected onDestroy(): void {
        this.unschedule(this.tickOccupyProgress);
        EventMgr.targetOff(this);
        this.landClaims.clear();
        this.claimViews.clear();
        this.expiredTimers.clear();
        this.territoryLayer?.destroy();
        super.onDestroy();
    }

    public setItemData(item: Node, data: any): void {
        let resData: MapResData = data as MapResData;
        let position: Vec2 = MapUtil.mapCellToPixelPoint(new Vec2(resData.x, resData.y));
        item.setPosition(new Vec3(position.x, position.y, 0));
        item.getComponent(ResLogic).setResourceData(resData);
        item.active = !this.overview || data.type === MapResType.SYS_FORTRESS;
    }

    public addItem(areaIndex: number, data: any): Node {
        if (this.overview && data.type >= MapResType.WOOD && data.type <= MapResType.GRAIN) return null;
        return super.addItem(areaIndex, data);
    }

    private refreshOwnership(): void {
        // MapResLogic.onLoad 可能早于 TiledMap 初始化，待首个区域准备好再定位。
        if (!this.parentLayer?.parent || !MapUtil.areaCellSize) return;
        this.landClaims.clear();
        const world = WorldCommand.getInstance();
        const now = DateUtil.getServerTime() / 1000;
        const mine = LoginCommand.getInstance().proxy.getRoleData()?.userId;
        const valid = (x: number, y: number) => Number.isInteger(x) && Number.isInteger(y)
            && x >= 0 && y >= 0 && x < MapUtil.mapSize.width && y < MapUtil.mapSize.height;
        for (const entity of world.entities.values()) {
            if (entity.entityType !== 4 || !entity.pos || !valid(entity.pos.x, entity.pos.y)) continue;
            const x = entity.pos.x, y = entity.pos.y;
            const timer = world.occupyCountdownAt(x, y, now);
            if (!timer && !hasId(entity.ownerId)) continue;
            const id = MapUtil.getIdByCellPoint(x, y);
            this.landClaims.set(id, { x, y, timer, owner: timer ? 'pending'
                : hasId(mine) && idKey(entity.ownerId) === idKey(mine) ? 'mine' : 'other' });
        }
        for (const march of world.marches.values()) {
            if (march.targetType !== MarchTargetType.OccupyResource || march.state !== 2 || !march.endPos) continue;
            const x = Math.round(march.endPos.x), y = Math.round(march.endPos.y);
            if (!valid(x, y)) continue;
            const timer = world.occupyCountdownAt(x, y, now);
            if (!timer) continue;
            const id = MapUtil.getIdByCellPoint(x, y);
            this.landClaims.set(id, { x, y, timer, owner: 'pending' });
        }
        if (!this.territoryLayer) {
            this.territoryLayer = new Node('LandTerritories');
            this.territoryLayer.layer = this.parentLayer.layer;
            this.parentLayer.parent.addChild(this.territoryLayer);
            this.territoryLayer.setPosition(this.parentLayer.position);
            this.territoryLayer.setRotation(this.parentLayer.rotation);
            this.territoryLayer.setScale(this.parentLayer.scale);
            this.territoryLayer.setSiblingIndex(this.parentLayer.getSiblingIndex() + 1);
        }
        // 只依据当前 AOI，离开视野、失去归属、断线时都清掉旧标记。
        for (const [id, marker] of this.claimViews) if (!this.landClaims.has(id)) {
            marker.node.active = false; marker.node.destroy(); this.claimViews.delete(id);
        }
        for (const [id, claim] of this.landClaims) {
            if (!this.claimViews.has(id)) {
                const node = new Node(`LandClaim_${id}`); node.layer = this.territoryLayer.layer;
                this.territoryLayer.addChild(node);
                const p = MapUtil.mapCellToPixelPoint(new Vec2(claim.x, claim.y)); node.setPosition(p.x, p.y, 0);
                this.claimViews.set(id, new LandClaimView(node));
            }
        }
        this.viewKey = ''; this.lateUpdate();
        const timers = new Set(Array.from(this.landClaims.values()).filter(c => !!c.timer)
            .map(c => `${c.x}:${c.y}:${c.timer.endTime}`));
        for (const key of this.expiredTimers) if (!timers.has(key)) this.expiredTimers.delete(key);
        this.unschedule(this.tickOccupyProgress);
        if (Array.from(this.landClaims.values()).some(claim => !!claim.timer)) this.schedule(this.tickOccupyProgress, .1);
    }

    private tickOccupyProgress = (): void => {
        const now = DateUtil.getServerTime() / 1000;
        for (const [id, claim] of this.landClaims) {
            if (!claim.timer) continue;
            if (claim.timer.endTime <= now) {
                const key = `${claim.x}:${claim.y}:${claim.timer.endTime}`;
                if (!this.expiredTimers.has(key)) {
                    this.expiredTimers.add(key);
                    WorldCommand.getInstance().refreshView();
                }
            }
            const marker = this.claimViews.get(id);
            if (marker?.node.active) marker.setProgress(claim.timer, now);
        }
    };

    protected lateUpdate(): void {
        if (!this.territoryLayer) return;
        if (!this.mapCamera) this.mapCamera = this.node.parent?.getChildByName('Map Camera')?.getComponent(Camera);
        if (!this.mapCamera) return;
        const camera = this.mapCamera, center = camera.node.worldPosition, size = view.getVisibleSize();
        const zoom = camera.orthoHeight * 2 / Math.max(1, size.height);
        const key = `${center.x}:${center.y}:${zoom}:${size.width}:${size.height}`;
        if (key === this.viewKey) return;
        this.viewKey = key;
        const halfWidth = camera.orthoHeight * size.width / Math.max(1, size.height);
        const now = DateUtil.getServerTime() / 1000;
        for (const [id, marker] of this.claimViews) {
            const position = marker.node.worldPosition;
            marker.node.active = Math.abs(position.x - center.x) < halfWidth + MapUtil.tileSize.width
                && Math.abs(position.y - center.y) < camera.orthoHeight + MapUtil.tileSize.height;
            if (!marker.node.active) continue;
            const claim = this.landClaims.get(id);
            marker.setStyle(claim.owner, MapUtil.tileSize.width, MapUtil.tileSize.height, zoom);
            marker.setProgress(claim.timer, now);
        }
    }

    /** 远景合并为一层资源色标，不为每一格新建高细节 Sprite；城池、要塞和领地保留。 */
    public refreshOverview(enabled: boolean): void {
        this.overview = enabled;
        for (const items of this._itemMap.values()) for (const [id, node] of items) {
            node.active = !enabled || this._cmd.proxy.getResData(id)?.type === MapResType.SYS_FORTRESS;
        }
        this.refreshOwnership();
    }
}
