import { _decorator, Color, Component, Graphics, Node, Sprite, UITransform } from 'cc';
import { MapResData, MapResType } from '../MapProxy';
import WorldMapArt from '../WorldMapArt';
import WorldCampaign from '../WorldCampaign';
import { gateWidth, gateMirrored, GATE_ANCHOR_Y, GATE_ART } from '../GateGeometry';
import MapUtil from '../MapUtil';
import { resourceFootprint } from '../ResourceFootprint';
import { caption, ManagementColors } from '../ui/ManagementStyle';
import { Label } from 'cc';
import DateUtil from '../../utils/DateUtil';
const { ccclass, property } = _decorator;

@ccclass('ResLogic')
export default class ResLogic extends Component {
    @property(Sprite)
    spr: Sprite = null;
    protected _data: MapResData = null;
    private ownership = '';
    private progressKey = '';

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

    public setOwnership(owner: 'mine' | 'other' | 'pending' | 'none'): void {
        const resource = this._data && this._data.type >= MapResType.WOOD && this._data.type <= MapResType.GRAIN;
        if (!resource) owner = 'none';
        const key = `${owner}:${MapUtil.tileSize.width}:${MapUtil.tileSize.height}`;
        if (key === this.ownership) return;
        this.ownership = key;
        let node = this.node.getChildByName('LandOwnership');
        const pending = this.node.getChildByName('OccupyPending');
        const bar = this.node.getChildByName('OccupyBar');
        if (pending) pending.active = owner === 'pending';
        if (bar) bar.active = owner === 'pending';
        if (owner !== 'pending') this.progressKey = '';
        if (owner === 'none') { if (node) node.active = false; return; }
        if (!node) {
            node = new Node('LandOwnership'); node.layer = this.node.layer;
            this.node.addChild(node); node.addComponent(UITransform); node.addComponent(Graphics);
        }
        node.active = true; node.setSiblingIndex(0);
        node.getComponent(UITransform).setContentSize(MapUtil.tileSize.width, MapUtil.tileSize.height);
        const g = node.getComponent(Graphics); g.clear();
        const color = owner === 'pending' ? new Color(214, 176, 92, 220)
            : owner === 'mine' ? new Color(105, 169, 183, 140) : new Color(194, 161, 101, 130);
        g.strokeColor = color; g.lineWidth = owner === 'pending' ? 2.5 : 1.5;
        g.fillColor = new Color(color.r, color.g, color.b, owner === 'pending' ? 18 : 28);
        const x = MapUtil.tileSize.width / 2 - 2, y = MapUtil.tileSize.height / 2 - 1;
        g.moveTo(0, y); g.lineTo(x, 0); g.lineTo(0, -y); g.lineTo(-x, 0); g.close();
        g.fill(); g.stroke();
        if (owner === 'pending') {
            caption(this.node, 'OccupyPending', '占领中', 0, 28, 88, 14, ManagementColors.gold, Label.HorizontalAlign.CENTER);
        }
    }

    /** 占领倒计时读条；ratio 为已完成比例，leftSec 为剩余秒。 */
    public setOccupyProgress(ratio: number, leftSec: number): void {
        if (!this.ownership.startsWith('pending:')) return;
        const clamped = Math.min(1, Math.max(0, ratio));
        const key = `${clamped.toFixed(3)}:${Math.ceil(leftSec)}`;
        if (key === this.progressKey) return;
        this.progressKey = key;
        let bar = this.node.getChildByName('OccupyBar');
        if (!bar) {
            bar = new Node('OccupyBar'); bar.layer = this.node.layer;
            this.node.addChild(bar); bar.addComponent(UITransform); bar.addComponent(Graphics);
        }
        bar.active = true;
        bar.setPosition(0, 14, 0);
        const width = Math.min(96, MapUtil.tileSize.width - 16), height = 6;
        bar.getComponent(UITransform).setContentSize(width, height);
        const g = bar.getComponent(Graphics); g.clear();
        g.fillColor = new Color(32, 34, 26, 200);
        g.rect(-width / 2, -height / 2, width, height); g.fill();
        g.fillColor = new Color(214, 176, 92, 230);
        g.rect(-width / 2, -height / 2, width * clamped, height); g.fill();
        g.strokeColor = new Color(214, 176, 92, 160); g.lineWidth = 1;
        g.rect(-width / 2, -height / 2, width, height); g.stroke();
        caption(this.node, 'OccupyPending',
            `占领中 ${DateUtil.converSecondStr(Math.max(0, leftSec) * 1000)}`,
            0, 28, 100, 14, ManagementColors.gold, Label.HorizontalAlign.CENTER);
    }

}
