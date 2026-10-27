import { _decorator, Button, Color, Component, Graphics, Label, Node, UITransform, UIOpacity } from 'cc';
import ReportReplay from '../../battle/ReportReplay';
import { ReportInfo } from '../../battle/BattleCommand';
import { replayLines, reportResult, reportUnitName } from '../../battle/ReportPresentation';
import { caption, inkSurface, ManagementColors as C, panelButton, place } from './ManagementStyle';
import { reportUnitArt } from './ReportUnitArt';
const { ccclass } = _decorator;
const ATK = new Color(191, 164, 104), DEF = new Color(167, 102, 87), GREEN = new Color(132, 191, 140);
interface UnitView { node: Node; homeX: number; homeY: number; bar: Graphics; count: Label; hit: Label; max: number; width: number; }

@ccclass('BattleReplayView')
export default class BattleReplayView extends Component {
    private replay: ReportReplay;
    private views = new Map<string, UnitView>();
    private speed = 1;
    private playing = false;
    private elapsed = 0;
    private phase = 1;
    private action: any = null;
    private impactApplied = false;
    private trail: Graphics;
    private status: Label;
    private narration: Label;
    private progress: Graphics;
    private toggle: Node;
    private restartButton: Node;
    private speedButton: Node;
    private controlsCenterX = 0;
    private width = 600;
    private fieldHeight = 292;

    public initialize(info: ReportInfo, replay: any, width: number, availableHeight = 450, openBattlefield?: () => void): number {
        this.width = width; this.replay = new ReportReplay(info, replay.actions || []);
        const n = Math.max(info.atkSide?.units?.length || 0, info.defSide?.units?.length || 0, 3);
        const extraRow = openBattlefield && width < 520 ? 44 : 0;
        const height = Math.max(availableHeight, 174 + n * 44 + extraRow);
        this.fieldHeight = height - 134 - extraRow;
        this.controlsCenterX = openBattlefield && !extraRow ? -105 : 0;
        const rowHeight = (this.fieldHeight - 40) / n, cardHeight = Math.min(72, rowHeight - 6);
        place(this.node, 0, 0, width, height);
        inkSurface(this.node, 'Battlefield', width, height, new Color(26, 34, 29), C.line);
        const field = this.make('Terrain'), g = field.addComponent(Graphics);
        g.strokeColor = new Color(166, 153, 108, 23); g.lineWidth = 1;
        for (let i = -4; i <= 4; i++) { g.moveTo(-width / 2, i * 48); g.lineTo(width / 2, i * 48 + 64); g.stroke(); }
        field.setPosition(0, height / 2 - this.fieldHeight / 2);
        caption(this.node, 'Attack', '攻方', -width / 4, height / 2 - 23, width / 2 - 24, 14, ATK, Label.HorizontalAlign.CENTER);
        caption(this.node, 'Defend', '守方', width / 4, height / 2 - 23, width / 2 - 24, 14, DEF, Label.HorizontalAlign.CENTER);
        [info.atkSide, info.defSide].forEach((side, sideIndex) => {
            const units = (side?.units || []).slice().sort((a, b) => a.pos - b.pos);
            units.forEach((unit, i) => {
                const cell = this.make(`Unit${sideIndex + 1}_${unit.pos}`), cellW = Math.min(234, (width - 54) / 2);
                const x = (sideIndex ? 1 : -1) * (width / 4), y = height / 2 - 40 - rowHeight * (i + .5);
                place(cell, x, y, cellW, cardHeight); inkSurface(cell, 'Card', cellW, cardHeight, new Color(42, 47, 37), sideIndex ? DEF : ATK);
                const imageSize = Math.min(width < 380 ? 34 : 48, cardHeight - 10);
                reportUnitArt(cell, side, unit, -cellW / 2 + imageSize / 2 + 7, 2, imageSize);
                const textW = cellW - imageSize - 22, tx = (imageSize + 8) / 2;
                const compact = cardHeight < 48;
                const name = caption(cell, 'Name', reportUnitName(side, unit), tx, cardHeight / 2 - (compact ? 10 : 12), textW, compact ? 13 : 14); name.overflow = Label.Overflow.SHRINK;
                const count = caption(cell, 'Soldiers', String(unit.beforeSoldier?.count || 0), tx, cardHeight / 2 - (compact ? 24 : 29), textW, compact ? 11 : 12, C.muted);
                const barNode = new Node('Health'); barNode.layer = cell.layer; cell.addChild(barNode); place(barNode, tx, -cardHeight / 2 + (compact ? 4 : 6), textW, 4);
                const bar = barNode.addComponent(Graphics);
                const hit = caption(cell, 'Hit', '', 0, 4, cellW, 23, DEF, Label.HorizontalAlign.CENTER); hit.isBold = true;
                this.views.set(`${sideIndex + 1}:${unit.pos}`, { node: cell, homeX: x, homeY: y, bar, count, hit,
                    max: Math.max(1, unit.beforeSoldier?.count || 0), width: textW });
            });
        });
        this.trail = this.make('AttackTrail').addComponent(Graphics);
        const bottom = -height / 2;
        this.status = caption(this.node, 'Round', '', 0, bottom + 118 + extraRow, width - 28, 13, C.gold, Label.HorizontalAlign.CENTER);
        this.narration = caption(this.node, 'Narration', this.replay.actions.length ? '双方列阵，准备交锋' : '本次战斗暂无回放记录', 0, bottom + 83 + extraRow, width - 28, 13, C.text, Label.HorizontalAlign.CENTER);
        this.narration.enableWrapText = true; this.narration.overflow = Label.Overflow.SHRINK; this.narration.node.getComponent(UITransform).height = 40;
        this.progress = this.make('Progress').addComponent(Graphics); this.progress.node.setPosition(0, bottom + 58 + extraRow);
        this.toggle = this.button('Play', () => { if (this.replay.finished&&!this.action) this.restart(); else { this.playing = !this.playing; this.controls(); } });
        this.speedButton = this.button('Speed', () => { this.speed = this.speed === 4 ? 1 : this.speed * 2; this.controls(); });
        this.restartButton = this.button('Restart', () => this.restart());
        panelButton(this.toggle, '播放', -92, bottom + 27 + extraRow, 92, 34, true);
        panelButton(this.speedButton, '1×', 4, bottom + 27 + extraRow, 72, 34);
        panelButton(this.restartButton, '重播', 92 + this.controlsCenterX, bottom + 27 + extraRow, 92, 34);
        if (openBattlefield) {
            const launch = this.button('OpenPaintedReplay', openBattlefield);
            panelButton(launch, '观看战场回放', extraRow ? 0 : width / 2 - 102, bottom + 27, 174, 34, true);
            launch.getComponent(Button).interactable = this.replay.actions.length > 0;
            launch.getComponentInChildren(Label).node.setPosition(10, 0);
            const icon = new Node('PlayIcon'); icon.layer = launch.layer; launch.addChild(icon); icon.addComponent(UITransform);
            const g = icon.addComponent(Graphics); g.fillColor = C.text;
            g.moveTo(-65, -5); g.lineTo(-65, 5); g.lineTo(-57, 0); g.close(); g.fill();
        }
        this.paint(); this.controls();
        return height;
    }
    private make(name: string): Node { const node = new Node(name); node.layer = this.node.layer; node.addComponent(UITransform); this.node.addChild(node); return node; }
    private button(name: string, callback: () => void): Node { const node = this.make(name); node.addComponent(Button); node.on(Button.EventType.CLICK, callback, this); return node; }
    public pause():void { this.playing=false;if(this.toggle)this.controls(); }
    private restart(): void { this.replay.reset(); this.action = null; this.phase = 1; this.elapsed = 0; this.playing = true; this.resetAnimation(); this.paint(); this.controls(); }
    private controls(): void {
        const finished=this.replay.finished&&!this.action;
        this.restartButton.active=!finished;
        this.toggle.setPosition(this.controlsCenterX+(finished?-42:-92),this.toggle.position.y);
        this.speedButton.setPosition(this.controlsCenterX+(finished?52:4),this.speedButton.position.y);
        this.toggle.getComponentInChildren(Label).string = finished ? '重播' : this.playing ? '暂停' : '播放';
        this.toggle.getComponent(Button).interactable = this.replay.actions.length > 0;
        this.speedButton.getComponentInChildren(Label).string = `${this.speed}×`;
    }
    private resetAnimation(): void {
        this.trail.clear(); this.views.forEach(view => { view.node.setPosition(view.homeX, view.homeY); view.hit.string = ''; });
    }
    update(dt: number): void {
        if (!this.playing || !this.replay || !this.node.activeInHierarchy) return;
        const step = Math.min(dt, .1) * this.speed; this.elapsed += step;
        if (!this.action || this.elapsed >= .86) {
            this.resetAnimation();
            if (this.replay.finished) { this.playing = false;this.action=null; this.narration.string = `${reportResult(this.replay.info.brief.result)} · 战斗结束`; this.controls(); return; }
            this.elapsed = 0; this.phase = 0; this.impactApplied = false; this.action = this.replay.step();
            this.narration.string = replayLines(this.action, this.replay.info).join('  ');
        }
        this.phase = Math.min(1, this.elapsed / .65); this.animate();
    }
    private animate(): void {
        if (!this.impactApplied && this.phase >= .2) { this.impactApplied = true; this.paint(); }
        const a = this.action, source = this.views.get(`${a.fromSide}:${a.fromPos}`);
        const lunge = Math.sin(this.phase * Math.PI) * (a.fromSide === 1 ? 18 : -18);
        if (source) source.node.setPosition(source.homeX + lunge, source.homeY);
        this.trail.clear();
        for (const e of a.effects || []) {
            const target = this.views.get(`${e.targetSide}:${e.targetPos}`); if (!target) continue;
            if (source && this.phase < .75) {
                const t = Math.min(1, this.phase * 2.5), x = source.homeX + (target.homeX - source.homeX) * t, y = source.homeY + (target.homeY - source.homeY) * t;
                this.trail.strokeColor = a.actType === 6 ? GREEN : C.gold; this.trail.lineWidth = 3;
                this.trail.moveTo(source.homeX, source.homeY); this.trail.lineTo(x, y); this.trail.stroke();
                this.trail.fillColor = C.gold; this.trail.circle(x, y, 4); this.trail.fill();
            }
            target.hit.color = a.actType === 6 ? GREEN : new Color(250, 183, 131);
            target.hit.string = this.phase < .16 ? '' : e.flags & 2 ? '闪避' : e.flags & 4 ? '未命中'
                : a.actType === 7 ? '状态变化' : `${a.actType === 6 ? '+' : '-'}${Math.abs(e.value || 0)}${e.flags & 1 ? ' 暴击' : ''}`;
            target.hit.node.setPosition(0, 6 + this.phase * 25);
        }
    }
    private paint(): void {
        this.views.forEach((view, key) => {
            const count = this.replay.soldiers.get(key) || 0, ratio = Math.min(1, count / view.max);
            view.count.string = `${count} / ${view.max}`;
            view.bar.clear(); view.bar.fillColor = new Color(15, 22, 18); view.bar.rect(-view.width / 2, -2.5, view.width, 5); view.bar.fill();
            view.bar.fillColor = ratio > .3 ? GREEN : DEF; view.bar.rect(-view.width / 2, -2.5, view.width * ratio, 5); view.bar.fill();
            (view.node.getComponent(UIOpacity) || view.node.addComponent(UIOpacity)).opacity = count ? 255 : 105;
        });
        this.status.string = `第 ${this.replay.round || 1} 回合  ·  ${this.replay.cursor} / ${this.replay.actions.length} 次行动`;
        const w = this.width - 28;
        this.progress.clear(); this.progress.fillColor = new Color(61, 66, 49); this.progress.rect(-w / 2, -1, w, 2); this.progress.fill();
        this.progress.fillColor = C.gold; this.progress.rect(-w / 2, -1, w * this.replay.cursor / Math.max(1, this.replay.actions.length), 2); this.progress.fill();
    }
    onDisable(): void { this.playing = false; if (this.toggle) this.controls(); }
}
