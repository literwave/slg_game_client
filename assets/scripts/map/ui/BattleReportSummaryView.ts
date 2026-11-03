import { Color, Graphics, Label, Node } from 'cc';
import { ReportInfo } from '../../battle/BattleCommand';
import { reportKind, reportResult, reportUnitName, soldierTotals } from '../../battle/ReportPresentation';
import { caption, inkSurface, ManagementColors as C, place } from './ManagementStyle';
import { reportUnitArt } from './ReportUnitArt';

const ALIVE = new Color(143, 184, 137), HURT = new Color(213, 180, 105), LOST = new Color(189, 108, 91);
const number = (value: number) => Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('en-US');

function node(parent: Node, name: string, x: number, y: number, width: number, height: number): Node {
    const result = new Node(name); result.layer = parent.layer; parent.addChild(result);
    place(result, x, y, width, height); return result;
}
function label(parent: Node, name: string, text: string, x: number, y: number, width: number, height: number,
    size: number, color = C.text, align = Label.HorizontalAlign.CENTER): Label {
    const result = caption(parent, name, text, x, y, width, size, color, align);
    place(result.node, x, y, width, height); result.overflow = Label.Overflow.SHRINK; return result;
}
function bevel(g: Graphics, width: number, height: number, cut = 6): void {
    g.moveTo(-width / 2 + cut, height / 2); g.lineTo(width / 2 - cut, height / 2);
    g.lineTo(width / 2, height / 2 - cut); g.lineTo(width / 2, -height / 2 + cut);
    g.lineTo(width / 2 - cut, -height / 2); g.lineTo(-width / 2 + cut, -height / 2);
    g.lineTo(-width / 2, -height / 2 + cut); g.lineTo(-width / 2, height / 2 - cut); g.close();
}

function outcome(parent: Node, info: ReportInfo, width: number): void {
    const won = info.brief.result === 1, tone = won ? new Color(230, 196, 121) : info.brief.result === 2 ? LOST : C.muted;
    const g = inkSurface(parent, 'OutcomeSeal', width, 52, null, null);
    g.fillColor = won ? new Color(88, 67, 33, 190) : info.brief.result === 2
        ? new Color(75, 43, 35, 170) : new Color(48, 47, 37, 190);
    g.strokeColor = tone; g.lineWidth = 1;
    bevel(g, 134, 38, 16); g.fill(); g.stroke();
    for (const sign of [-1, 1]) {
        g.strokeColor = C.line; g.moveTo(sign * 81, 0); g.lineTo(sign * (width / 2 - 12), 0); g.stroke();
        g.strokeColor = tone; g.moveTo(sign * 82, 5); g.lineTo(sign * 113, 5); g.stroke();
        g.fillColor = tone;
        g.moveTo(sign * 76, 0); g.lineTo(sign * 81, 4); g.lineTo(sign * 86, 0); g.lineTo(sign * 81, -4); g.close(); g.fill();
    }
    const result = label(parent, 'BattleResult', reportResult(info.brief.result), 0, 1, 112, 36, 29, tone);
    result.isBold = true; result.outlineColor = new Color(24, 19, 12); result.outlineWidth = 1;
    label(parent, 'BattleKind', reportKind(info.brief), 0, -27, width - 24, 18, 12, C.muted);
}

/** 对阵画面只读取战报快照；兵力条的三段分别是战后存活、伤兵和阵亡。 */
export function battleReportOverview(root: Node, info: ReportInfo, y: number, width: number): number {
    const seal = node(root, 'BattleOutcome', 0, y - 20, width - 32, 52);
    outcome(seal, info, width - 32);
    const bannerHeight = 60, stacked = width < 480;
    const cardWidth = stacked ? width - 32 : (width - 48) / 2;
    const sides = [info.atkSide, info.defSide];
    const columns = Math.max(1, Math.min(3, Math.floor((cardWidth - 20) / 76)));
    const rows = Math.max(1, Math.ceil(Math.max(...sides.map(side => side?.units?.length || 0)) / columns));
    const height = 108 + rows * 108;
    sides.forEach((side, index) => {
        const card = node(root, `SideCard${index}`, stacked ? 0 : (index - .5) * (cardWidth + 16),
            y - bannerHeight - height / 2 - (stacked ? index * (height + 12) : 0), cardWidth, height);
        const top = height / 2, tone = index ? new Color(179, 132, 115) : C.gold;
        const g = inkSurface(card, 'Surface', cardWidth, height, null, null);
        g.fillColor = index ? new Color(43, 39, 33) : new Color(46, 44, 32);
        g.strokeColor = new Color(tone.r, tone.g, tone.b, 130); g.lineWidth = 1;
        bevel(g, cardWidth, height); g.fill(); g.stroke();
        g.fillColor = index ? new Color(81, 50, 40, 145) : new Color(94, 73, 35, 145);
        g.rect(-cardWidth / 2 + 7, top - 38, cardWidth - 14, 31); g.fill();
        g.strokeColor = C.line; g.moveTo(-cardWidth / 2 + 12, top - 40); g.lineTo(cardWidth / 2 - 12, top - 40); g.stroke();
        const pennant = node(card, 'SidePennant', -cardWidth / 2 + 29, top - 23, 28, 31);
        const flag = inkSurface(pennant, 'Flag', 28, 31, null, null);
        flag.fillColor = tone; flag.moveTo(-13, 15); flag.lineTo(13, 15); flag.lineTo(13, -9);
        flag.lineTo(0, -15); flag.lineTo(-13, -9); flag.close(); flag.fill();
        label(pennant, 'Role', index ? '守' : '攻', 0, 2, 26, 24, 15, new Color(36, 30, 22)).isBold = true;
        label(card, 'Commander', side?.name || (index ? '守军' : '出征部队'), 19, top - 23,
            cardWidth - 66, 28, 18, C.text).isBold = true;

        const units = [...(side?.units || [])].sort((a, b) => Number(a.pos) - Number(b.pos));
        const unitWidth = (cardWidth - 20) / columns, portraitSize = Math.min(64, unitWidth - 14);
        units.forEach((unit, i) => {
            const row = Math.floor(i / columns), count = Math.min(columns, units.length - row * columns);
            const x = (i % columns - (count - 1) / 2) * unitWidth, unitY = top - 79 - row * 108;
            const alive = Math.max(0, Number(unit.afterSoldier?.count) || 0);
            const portrait = reportUnitArt(card, side, unit, x, unitY, portraitSize, { depleted: alive === 0 });
            const levelPlate = inkSurface(portrait, 'LevelPlate', 30, 15, new Color(21, 24, 19, 225), null);
            levelPlate.node.setPosition(portraitSize / 2 - 16, portraitSize / 2 - 9);
            levelPlate.node.setSiblingIndex(portrait.children.length - 1);
            label(portrait, 'Level', String(unit.level || 1), portraitSize / 2 - 16, portraitSize / 2 - 9, 28, 15, 10, C.text);
            label(card, `UnitName${i}`, reportUnitName(side, unit), x, unitY - portraitSize / 2 - 12,
                unitWidth - 6, 20, 13, alive ? C.text : C.muted);
            label(card, `UnitCount${i}`, `${number(unit.beforeSoldier?.count)} → ${number(alive)}`, x,
                unitY - portraitSize / 2 - 31, unitWidth - 6, 17, 11, alive ? ALIVE : LOST);
        });
        if (!units.length) label(card, 'MissingUnits', '阵容未记录', 0, top - 93, cardWidth - 28, 30, 14, C.muted);

        const stats = soldierTotals(side), barY = -height / 2 + 59, barWidth = cardWidth - 28;
        g.fillColor = new Color(19, 24, 19); g.rect(-barWidth / 2, barY, barWidth, 7); g.fill();
        if (stats) {
            const total = stats.after + stats.hurt + stats.lost;
            let x = -barWidth / 2;
            [stats.after, stats.hurt, stats.lost].forEach((value, i) => {
                const segment = total > 0 ? barWidth * Math.max(0, value) / total : 0;
                if (segment <= 0) return;
                g.fillColor = [ALIVE, HURT, LOST][i]; g.rect(x, barY + 1, segment, 5); g.fill(); x += segment;
            });
        }
        const values = stats ? [stats.after, stats.hurt, stats.lost].map(number) : ['—', '—', '—'];
        ['存活', '伤兵', '阵亡'].forEach((title, i) => {
            const x = (i - 1) * (cardWidth - 20) / 3, color = [ALIVE, HURT, LOST][i];
            label(card, `Value${i}`, values[i], x, -height / 2 + 40, (cardWidth - 20) / 3, 27, 21, color).isBold = true;
            label(card, `Stat${i}`, title, x, -height / 2 + 17, (cardWidth - 20) / 3, 19, 11, C.muted);
        });
    });
    return bannerHeight + height * (stacked ? 2 : 1) + (stacked ? 12 : 0) + 12;
}
