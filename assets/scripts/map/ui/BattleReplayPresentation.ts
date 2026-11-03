import { Color, Graphics, Label, Node, UIOpacity, UITransform } from 'cc';
import { ReportInfo } from '../../battle/BattleCommand';
import { reportResult, reportUnitName } from '../../battle/ReportPresentation';
import { caption, inkSurface, ManagementColors as C, place } from './ManagementStyle';
import { gameCloseButton } from './TaskBoardView';
import { reportUnitArt } from './ReportUnitArt';

const JADE = new Color(143, 186, 140), RED = new Color(209, 126, 100);
function child(parent: Node, name: string, x: number, y: number, width: number, height: number): Node {
    const node = new Node(name); node.layer = parent.layer; parent.addChild(node); place(node, x, y, width, height); return node;
}
function bevel(g: Graphics, width: number, height: number, cut = 7): void {
    g.moveTo(-width / 2 + cut, height / 2); g.lineTo(width / 2 - cut, height / 2);
    g.lineTo(width / 2, height / 2 - cut); g.lineTo(width / 2, -height / 2 + cut);
    g.lineTo(width / 2 - cut, -height / 2); g.lineTo(-width / 2 + cut, -height / 2);
    g.lineTo(-width / 2, -height / 2 + cut); g.lineTo(-width / 2, height / 2 - cut); g.close();
}

/** 有上限的兵力示意，不用数万节点模拟服务器的真实兵数。 */
export function replayVisualCount(count: number): number {
    if (!(count > 0) || !Number.isFinite(count)) return 0;
    return Math.min(16, Math.max(4, 4 + Math.floor(Math.log2(Math.max(1, count / 40))) * 2));
}

/** 同一目标的多条服务器效果只产生一次表现；命中记录优先于闪避记录。 */
export function replayImpactGroups(effects: any[]): Array<{ key: string; flags: number }> {
    const groups = new Map<string, { key: string; flags: number; hit: boolean }>();
    for (const effect of effects || []) {
        const key = String(effect.targetSide) + ':' + String(effect.targetPos);
        const flags = Number(effect.flags) || 0, hit = !(flags & 6), old = groups.get(key);
        if (!old) groups.set(key, { key, flags, hit });
        else if (hit) { old.flags = (old.hit ? old.flags : 0) | (flags & ~6); old.hit = true; }
        else if (!old.hit) old.flags |= flags;
    }
    return [...groups.values()].map(({ key, flags }) => ({ key, flags }));
}

/** 四列纵深军阵；每队独立占据一条战线，前后排均有地面落脚点。 */
export function replayFormation(count: number, side: number, scale: number) {
    const columns = count > 9 ? 4 : 3, sign = side === 1 ? 1 : -1;
    return Array.from({ length: count }, (_, index) => {
        const row = Math.floor(index / columns), inRow = Math.min(columns, count - row * columns);
        const across = (index % columns - (inRow - 1) / 2) * 31, behind = 26 + row * 25;
        return { x: sign * (across - behind) * scale, y: sign * (-across - behind) * .42 * scale };
    });
}
export function replayArmyHome(index: number, total: number, side: number, scale: number) {
    const lane = index - (total - 1) / 2;
    return { x: ((side === 1 ? -250 : 205) + lane * 136) * scale,
        y: ((side === 1 ? -52 : 14) - lane * 84) * scale };
}

/** 主将头像保留在各自军阵上方，战斗中可以直接辨认部队归属。 */
export function replayCommanderBadge(parent: Node, side: any, unit: any, scale: number): Graphics {
    const s = scale, w = 146 * s, h = 44 * s;
    parent.getComponent(UITransform).setContentSize(w, h);
    const g = inkSurface(parent, 'CommanderPlate', w, h, null, null);
    g.fillColor = new Color(23, 29, 24, 235); g.strokeColor = new Color(165, 141, 88, 190); g.lineWidth = s;
    bevel(g, w, h, 6 * s); g.fill(); g.stroke();
    // 头像沿用真实主将画像；未配置的守军使用各兵种对应画像。
    reportUnitArt(parent, side, unit, -51 * s, 0, 36 * s);
    const name = caption(parent, 'Name', reportUnitName(side, unit), 19 * s, 7 * s, 96 * s, 13 * s,
        C.text, Label.HorizontalAlign.CENTER);
    name.overflow = Label.Overflow.SHRINK; name.isBold = true;
    const strength = child(parent, 'Strength', 19 * s, -9 * s, 82 * s, 6 * s).addComponent(Graphics);
    g.fillColor = C.gold; g.moveTo(-3 * s, -h / 2); g.lineTo(3 * s, -h / 2);
    g.lineTo(0, -h / 2 - 4 * s); g.close(); g.fill();
    return strength;
}

/** 装饰不截获输入，播放状态用图形和短标签共同表达。 */
export function replayControlIcon(control: Node, kind: string, playing = false): void {
    let glyph = control.getChildByName('ControlGlyph');
    if (!glyph) glyph = child(control, 'ControlGlyph', -27, 0, 22, 22);
    const g = glyph.getComponent(Graphics) || glyph.addComponent(Graphics);
    g.clear(); g.strokeColor = C.text; g.fillColor = C.text; g.lineWidth = 1.6;
    if (kind === 'Play') {
        if (playing) { g.rect(-6, -7, 4, 14); g.rect(2, -7, 4, 14); g.fill(); }
        else { g.moveTo(-5, -8); g.lineTo(7, 0); g.lineTo(-5, 8); g.close(); g.fill(); }
    } else if (kind === 'Restart') {
        g.arc(0, 0, 7, .25, Math.PI * 1.75, false); g.stroke();
        g.moveTo(7, 4); g.lineTo(7, -2); g.lineTo(1, 0); g.stroke();
    } else if (kind === 'Camera') {
        for (const x of [-1, 1]) for (const y of [-1, 1]) {
            g.moveTo(x * 3, y * 8); g.lineTo(x * 8, y * 8); g.lineTo(x * 8, y * 3); g.stroke();
        }
        g.circle(0, 0, 2); g.stroke();
    }
}

interface RosterItem { key: string; root: Node; count: Label; bar: Graphics; max: number; side: number; width: number; last: number; }

/** 固定 HUD 与地面角色分层。兵数、出手高亮和结算全部来自当前回放状态。 */
export class BattleReplayHud {
    private round: Label;
    private phase: Label;
    private wings: Array<{ count: Label; bar: Graphics; width: number; last: number }> = [];
    private roster: RosterItem[] = [];
    private outcome: Node;
    private resultCounts: Label[] = [];
    private total: number[];
    private signature = '';
    constructor(root: Node, info: ReportInfo, width: number, height: number) {
        this.total = [info.atkSide, info.defSide].map(side => (side?.units || [])
            .reduce((sum: number, unit: any) => sum + Math.max(0, Number(unit.beforeSoldier?.count) || 0), 0));
        const compact = width < 760, header = root.getChildByName('Header');
        place(header, 0, height / 2 - 52, width, 104);
        const shade = inkSurface(header, 'Shade', width, 104, new Color(22, 28, 24, 248), null);
        shade.strokeColor = C.line; shade.lineWidth = 1;
        shade.moveTo(-width / 2, -51); shade.lineTo(width / 2, -51); shade.stroke();
        header.getChildByName('Title').active = false; header.getChildByName('Sides').active = false;
        gameCloseButton(header.getChildByName('Close'), width / 2 - 25, 24);
        const wingWidth = Math.max(70, Math.min(438, (width - (compact ? 184 : 234)) / 2));
        [info.atkSide, info.defSide].forEach((side, i) => {
            const x = i ? width / 2 - 52 - wingWidth / 2 : -width / 2 + 18 + wingWidth / 2;
            const wing = child(header, 'Army' + (i + 1), x, 0, wingWidth, 98);
            const badge = child(wing, 'SideBadge', -wingWidth / 2 + 13, 24, 26, 30);
            const g = inkSurface(badge, 'Seal', 26, 30, i ? new Color(94, 45, 34) : new Color(47, 72, 51), C.line);
            g.strokeColor = C.gold; g.moveTo(-9, 11); g.lineTo(9, 11); g.stroke();
            caption(badge, 'Side', i ? '守' : '攻', 0, 1, 23, 15, C.text, Label.HorizontalAlign.CENTER);
            const nameW = Math.max(48, wingWidth - (compact ? 36 : 145));
            const title = caption(wing, 'Name', side?.name || (i ? '守军' : '出征部队'),
                -wingWidth / 2 + 36 + nameW / 2, 25, nameW, compact ? 13 : 18, C.text);
            title.isBold = true; title.overflow = Label.Overflow.SHRINK;
            const count = caption(wing, 'Count', '', wingWidth / 2 - 48, 25, 96, 20, i ? RED : JADE, Label.HorizontalAlign.RIGHT);
            count.isBold = true; count.node.active = !compact;
            const rail = child(wing, 'Strength', 0, 5, wingWidth, 3).addComponent(Graphics);
            this.wings.push({ count, bar: rail, width: wingWidth, last: -1 });
            const units = [...(side?.units || [])].sort((a, b) => a.pos - b.pos), slot = wingWidth / Math.max(1, units.length);
            units.forEach((unit, index) => {
                const card = child(wing, 'Roster' + unit.pos, -wingWidth / 2 + slot * (index + .5), -24, slot - 6, 43);
                const portraitSize = width < 520 ? 22 : compact ? 24 : 34;
                reportUnitArt(card, side, unit, -slot / 2 + portraitSize / 2 + 4, 0, portraitSize);
                const textX = portraitSize / 2 + 1, textW = Math.max(28, slot - portraitSize - 12);
                const unitName = caption(card, 'Name', reportUnitName(side, unit), textX, 9, textW, compact ? 10 : 12, C.text);
                unitName.overflow = Label.Overflow.SHRINK;
                const number = caption(card, 'Soldiers', '', textX, -8, textW, compact ? 10 : 12, i ? RED : JADE);
                if(width<520){unitName.node.active=false;const portrait=card.getChildByName('Portrait');portrait.setPosition(0,5);place(number.node,0,-15,slot-4,16);number.fontSize=9;number.overflow=Label.Overflow.SHRINK;}
                const bar = child(card, 'State', 0, -21, slot - 8, 2).addComponent(Graphics);
                card.addComponent(UIOpacity);
                this.roster.push({ key: (i + 1) + ':' + unit.pos, root: card, count: number, bar,
                    max: Math.max(1, Number(unit.beforeSoldier?.count) || 0), side: i, width: slot - 8, last: -1 });
            });
        });
        const crest = child(header, 'RoundCrest', -15, 5, compact ? 80 : 132, 64);
        const trim = inkSurface(crest, 'Trim', compact ? 80 : 132, 64, null, null);
        trim.fillColor = new Color(39, 43, 32); trim.strokeColor = C.line; trim.lineWidth = 1;
        bevel(trim, compact ? 80 : 132, 64, 14); trim.fill(); trim.stroke();
        this.round = caption(crest, 'Round', '列阵', 0, 10, compact ? 76 : 124, compact ? 14 : 20, C.gold, Label.HorizontalAlign.CENTER);
        this.round.isBold = true; this.round.overflow = Label.Overflow.SHRINK;
        this.phase = caption(crest, 'Phase', '静候军令', 0, -15, compact ? 76 : 124, 11, C.muted, Label.HorizontalAlign.CENTER);
        const footer = root.getChildByName('Controls');
        place(footer, 0, -height / 2 + 57, width, 114);
        inkSurface(footer, 'Shade', width, 114, new Color(22, 28, 24, 248), C.line);
        footer.getChildByName('Narration').setPosition(0, 37);
        footer.getChildByName('Progress').setPosition(0, 15);
        for (const name of ['Play', 'Speed', 'Restart', 'Camera']) {
            const control = footer.getChildByName(name), primary = name === 'Play';
            const w = width < 700 ? name === 'Speed' ? 52 : 72 : name === 'Speed' ? 80 : name === 'Camera' ? 112 : 104;
            place(control, control.position.x, -20, w, 40);
            const g = inkSurface(control, 'ManagementButton', w, 40, null, null);
            g.fillColor = primary ? new Color(119, 86, 39) : new Color(39, 45, 36);
            g.strokeColor = primary ? C.gold : C.line; g.lineWidth = 1;
            bevel(g, w, 40); g.fill(); g.stroke();
            const label = control.getComponentInChildren(Label);
            if (name !== 'Speed' && width >= 700) {
                place(label.node, 12, 0, w - 36, 28); label.fontSize = 14; replayControlIcon(control, name);
            }
        }
        this.outcome = child(root, 'BattleOutcome', 0, 0, 372, 184);
        this.outcome.setScale(Math.min(1, (width - 24) / 372), Math.min(1, (width - 24) / 372), 1);
        const g = inkSurface(this.outcome, 'Seal', 372, 184, null, null);
        g.fillColor = new Color(20, 27, 23, 248); g.strokeColor = info.brief.result === 2 ? RED : C.gold; g.lineWidth = 2;
        bevel(g, 372, 184, 22); g.fill(); g.stroke();
        g.strokeColor = C.line; g.lineWidth = 1; bevel(g, 354, 166, 18); g.stroke();
        g.moveTo(-152, 0); g.lineTo(152, 0); g.stroke();
        const result = caption(this.outcome, 'Result', reportResult(info.brief.result), 0, 47, 300, 39,
            info.brief.result === 2 ? RED : new Color(239, 205, 131), Label.HorizontalAlign.CENTER);
        result.isBold = true;
        caption(this.outcome, 'Finished', '战 局 已 定', 0, 14, 220, 11, C.muted, Label.HorizontalAlign.CENTER);
        ['攻方余部', '守方余部'].forEach((title, i) => {
            caption(this.outcome, 'Side' + i, title, i ? 86 : -86, -23, 150, 12, C.muted, Label.HorizontalAlign.CENTER);
            this.resultCounts.push(caption(this.outcome, 'Remaining' + i, '', i ? 86 : -86, -49, 150, 25,
                i ? RED : JADE, Label.HorizontalAlign.CENTER));
        });
        this.outcome.active = false;
    }
    setPhase(value: string): void { if (this.phase.string !== value) this.phase.string = value; }
    update(soldiers: number[], round: number, finished: boolean, units?: Map<string, number>, activeKey = ''): void {
        const signature = [soldiers.join(','), round, finished, activeKey, units && [...units.values()].join(',')].join('|');
        if (signature === this.signature) return; this.signature = signature;
        this.round.string = finished ? '终局' : round ? '第 ' + round + ' 回合' : '列阵';
        this.outcome.active = finished;
        this.wings.forEach((wing, i) => {
            const current = soldiers[i] || 0; this.resultCounts[i].string = current.toLocaleString('en-US');
            if (current === wing.last) return; wing.last = current;
            const ratio = Math.min(1, current / Math.max(1, this.total[i]));
            wing.count.string = current.toLocaleString('en-US');
            const g = wing.bar, w = wing.width; g.clear();
            g.fillColor = new Color(9, 15, 11); g.rect(-w / 2, -2, w, 4); g.fill();
            g.fillColor = i ? RED : JADE;
            if (ratio > 0) { g.rect(i ? w / 2 - w * ratio : -w / 2, -1, w * ratio, 2); g.fill(); }
        });
        for (const item of this.roster) {
            const current = units?.get(item.key) ?? item.max;
            item.root.getComponent(UIOpacity).opacity = current > 0 ? 255 : 95;
            item.count.string = current > 0 ? current.toLocaleString('en-US') : '溃散';
            const g = item.bar; g.clear();
            g.fillColor = item.key === activeKey ? C.gold : item.side ? RED : JADE;
            g.rect(-item.width / 2, -1, item.width * Math.max(0, Math.min(1, current / item.max)), item.key === activeKey ? 3 : 1);
            g.fill();
        }
    }
}
