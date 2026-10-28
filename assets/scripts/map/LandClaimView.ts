import { Color, Graphics, Label, Node, UITransform } from 'cc';
import { caption, ManagementColors } from './ui/ManagementStyle';
import { diamond, tileInk } from './TileHighlight';
import DateUtil from '../utils/DateUtil';

export type LandOwner = 'mine' | 'other' | 'pending';
export interface LandClaim {
    x: number;
    y: number;
    owner: LandOwner;
    timer?: { startTime: number; endTime: number };
}

/** 归属与资源立绘分离：空地、资源隐藏的概览档都保留领地边界。 */
export default class LandClaimView {
    private styleKey = '';
    private progressKey = '';
    private width = 0;
    private height = 0;
    private unit = 1;
    private owner: LandOwner;
    private showProgress = true;

    constructor(readonly node: Node) { node.addComponent(UITransform); }

    setStyle(owner: LandOwner, width: number, height: number, zoom: number): void {
        const unit = Math.round(Math.max(.55, Math.min(zoom, height / 32)) * 20) / 20;
        const showProgress = height / Math.max(.01, zoom) >= 22;
        const key = `${owner}:${width}:${height}:${unit}:${showProgress}`;
        if (key === this.styleKey) return;
        this.styleKey = key; this.progressKey = ''; this.owner = owner;
        this.width = width; this.height = height; this.unit = unit; this.showProgress = showProgress;
        this.node.getComponent(UITransform).setContentSize(width, height);
        // 他人领地用朱红实线配浅色衬边，与草地和底图灰线隔开；地面仍只浅染。
        const other = owner === 'other';
        const color = owner === 'mine' ? new Color(105, 187, 171, 215)
            : other ? new Color(209, 94, 79, 235) : new Color(221, 190, 122, 220);
        const g = tileInk(this.node, 'TerritoryBoundary', width, height);
        const x = width / 2 - 3 * unit, y = height / 2 - 1.5 * unit;
        g.fillColor = new Color(color.r, color.g, color.b, 14);
        diamond(g, x, y); g.fill();
        g.lineWidth = (other ? 4 : 3.2) * unit;
        g.strokeColor = other ? new Color(244, 219, 188, 135) : new Color(38, 45, 35, 105);
        diamond(g, x, y); g.stroke();
        g.lineWidth = (other ? 2.15 : 1.45) * unit; g.strokeColor = color;
        diamond(g, x, y); g.stroke();

        for (const name of ['OccupyPending', 'OccupyBar']) {
            const node = this.node.getChildByName(name);
            if (node) node.active = owner === 'pending' && showProgress;
        }
    }

    setProgress(timer: LandClaim['timer'], now: number): void {
        if (this.owner !== 'pending' || !timer) return;
        const ratio = Math.min(1, Math.max(0, (now - timer.startTime) / Math.max(.001, timer.endTime - timer.startTime)));
        const left = Math.max(0, timer.endTime - now);
        const key = `${ratio.toFixed(3)}:${Math.ceil(left)}`;
        if (key === this.progressKey) return;
        this.progressKey = key;
        const width = Math.min(this.width * .6 / this.unit, 92), height = 5;
        const bar = tileInk(this.node, 'OccupyBar', width, height);
        bar.node.setScale(this.unit, this.unit, 1);
        bar.node.setPosition(0, -this.height * .18, 0);
        bar.fillColor = new Color(30, 33, 26, 230); bar.roundRect(-width / 2, -height / 2, width, height, 2); bar.fill();
        bar.fillColor = ManagementColors.gold; bar.rect(-width / 2, -height / 2, width * ratio, height); bar.fill();
        const text = caption(this.node, 'OccupyPending', left > 0 ? `占领中 ${DateUtil.converSecondStr(Math.ceil(left) * 1000)}` : '等待占领确认',
            0, -this.height * .18 + 14 * this.unit, width + 16, 12, ManagementColors.text, Label.HorizontalAlign.CENTER);
        text.node.setScale(this.unit, this.unit, 1);
        text.outlineWidth = 2; text.outlineColor = new Color(30, 33, 26, 240);
        bar.node.active = text.node.active = this.showProgress;
    }
}
