import { _decorator, Color, Component, Sprite, UITransform } from 'cc';
import { MapResData, MapResType } from '../MapProxy';
import WorldMapArt from '../WorldMapArt';
import WorldCampaign from '../WorldCampaign';
import { gateWidth, gateMirrored, gateGroundCorners, GATE_ANCHOR_X, GATE_ANCHOR_Y, GATE_ART, BRIDGE_ART, BRIDGE_ANCHOR_X, BRIDGE_ANCHOR_Y, BRIDGE_HEIGHT_SCALE } from '../GateGeometry';
import CityOwnershipView from '../CityOwnershipView';
import MapUtil from '../MapUtil';
import { resourceFootprint } from '../ResourceFootprint';
const { ccclass, property } = _decorator;

@ccclass('ResLogic')
export default class ResLogic extends Component {
    @property(Sprite)
    spr: Sprite = null;
    protected _data: MapResData = null;

    public setResourceData(data: MapResData): void {
        this._data = data;
        const gate = data.type === MapResType.SYS_FORTRESS && WorldCampaign.gateAt(data.x, data.y);
        const bridge = gate && gate.crossing === 'bridge';
        if (!gate) this.node.getComponent(CityOwnershipView)?.clear();
        const art = gate ? (bridge ? BRIDGE_ART : GATE_ART) : { [MapResType.WOOD]: 'forest', [MapResType.IRON]: 'iron',
            [MapResType.STONE]: 'quarry', [MapResType.GRAIN]: 'grain', [MapResType.SYS_FORTRESS]: 'fort' }[data.type];
        if (!art) { this.spr.spriteFrame = null; return; }
        const level = Math.min(10, Math.max(1, Math.floor(data.level) || 1));
        const resource = data.type >= MapResType.WOOD && data.type <= MapResType.GRAIN;
        const width = gate ? gateWidth(gate.level, gate) : data.type === MapResType.SYS_FORTRESS ? 138 : 100;
        WorldMapArt.apply(this.spr, resource ? `${art}_lv${level}` : art, width);
        this.spr.color = Color.WHITE;
        if (data.type >= MapResType.WOOD && data.type <= MapResType.GRAIN) {
            const imageSize = WorldMapArt.size(`${art}_lv${level}`);
            const size = resourceFootprint(imageSize.width, imageSize.height,
                MapUtil.tileSize.width, MapUtil.tileSize.height, level);
            // 资源图片完整收进单格，不让树冠/矿堆穿出选中边界；不裁切原图。
            this.spr.trim = false;
            this.spr.node.getComponent(UITransform).setContentSize(size.width, size.height);
            this.spr.node.getComponent(UITransform).setAnchorPoint(.5, .5);
            this.spr.node.setPosition(0, 0, 0);
            this.spr.node.setScale(1, 1, 1);
            this.hideLegacyDecorations();
        } else {
            for (const name of ['ResourceRank', 'ResourceGrade', 'ResourceCluster0', 'ResourceCluster1', 'ResourceCluster2']) {
                const old = this.node.getChildByName(name); if (old) old.active = false;
            }
            this.spr.trim = !gate;
            this.spr.node.getComponent(UITransform).setAnchorPoint(bridge ? BRIDGE_ANCHOR_X : gate ? GATE_ANCHOR_X : .5,
                bridge ? BRIDGE_ANCHOR_Y : gate ? GATE_ANCHOR_Y : .25);
            this.spr.node.setPosition(0, gate ? 0 : -3, 0);
            const config = WorldCampaign.config;
            const mirror = gate && config && gateMirrored(gate.x, gate.y, config.width, config.height, gate);
            this.spr.node.setScale(mirror ? -1 : 1, bridge ? BRIDGE_HEIGHT_SCALE : 1, 1);
            if (gate) this.spr.color = Color.WHITE;
            if (gate) {
                const ownership = this.node.getComponent(CityOwnershipView) || this.node.addComponent(CityOwnershipView);
                const height = this.spr.node.getComponent(UITransform).height * (bridge ? BRIDGE_HEIGHT_SCALE : 1);
                ownership.setCity(gate, height * (bridge ? .52 : 1 - GATE_ANCHOR_Y),
                    gateGroundCorners(gate.level, !!mirror, gate));
            }
        }
        const title = this.node.getChildByName('CampaignGateName');
        if (title) title.active = !!gate;
        if (title) title.active = false;
    }

    private hideLegacyDecorations(): void {
        for (const name of ['ResourceRank', 'ResourceGrade', 'ResourceCluster0', 'ResourceCluster1', 'ResourceCluster2']) {
            const node = this.node.getChildByName(name); if (node) node.active = false;
        }
    }

}
