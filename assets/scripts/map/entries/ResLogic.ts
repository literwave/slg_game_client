import { _decorator, Color, Component, Graphics, Node, Sprite, UITransform } from 'cc';
import { MapResData, MapResType } from '../MapProxy';
import WorldMapArt from '../WorldMapArt';
import WorldCampaign from '../WorldCampaign';
import { gateWidth, gateMirrored, GATE_ANCHOR_Y, GATE_ART } from '../GateGeometry';
import MapUtil from '../MapUtil';
import { resourceFootprint } from '../ResourceFootprint';
import { caption, ManagementColors } from '../ui/ManagementStyle';
import { Label } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('ResLogic')
export default class ResLogic extends Component {
    @property(Sprite)
    spr: Sprite = null;
    protected _data: MapResData = null;

    public setResourceData(data: MapResData): void {
        this._data = data;
        const gate = data.type === MapResType.SYS_FORTRESS && WorldCampaign.gateAt(data.x, data.y);
        const art = gate ? GATE_ART : { [MapResType.WOOD]: 'forest', [MapResType.IRON]: 'iron',
            [MapResType.STONE]: 'quarry', [MapResType.GRAIN]: 'grain', [MapResType.SYS_FORTRESS]: 'fort' }[data.type];
        if (!art) { this.spr.spriteFrame = null; return; }
        const level = Math.min(10, Math.max(1, Math.floor(data.level) || 1));
        const resource = data.type >= MapResType.WOOD && data.type <= MapResType.GRAIN;
        const width = gate ? gateWidth(gate.level) : data.type === MapResType.SYS_FORTRESS ? 138 : 100;
        WorldMapArt.apply(this.spr, resource ? `${art}_lv${level}` : art, width);
        this.spr.color = Color.WHITE;
        if (data.type >= MapResType.WOOD && data.type <= MapResType.GRAIN) {
            const frame = this.spr.spriteFrame;
            const size = resourceFootprint(frame.originalSize.width, frame.originalSize.height,
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
            this.spr.node.getComponent(UITransform).setAnchorPoint(.5, gate ? GATE_ANCHOR_Y : .25);
            this.spr.node.setPosition(0, gate ? 0 : -3, 0);
            const config = WorldCampaign.config;
            const mirror = gate && config && gateMirrored(gate.x, gate.y, config.width, config.height);
            this.spr.node.setScale(mirror ? -1 : 1, 1, 1);
            if (gate) this.spr.color = Color.WHITE;
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
