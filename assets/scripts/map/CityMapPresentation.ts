import { Color, Label, Node, UITransform } from 'cc';
import { caption, inkSurface } from './ui/ManagementStyle';
import WorldCampaign from './WorldCampaign';
import { CityOwner, resolveCityOwner } from './CityOwnership';
import type { AllianceCityInfo } from '../world/CityCommand';

/** 名称与等级可以来自地图配置；占领者只使用已收到的服务端字段。 */
export function systemCityIdentity(data: any, city?: AllianceCityInfo, myAllianceId?: number | string) {
    const owner = resolveCityOwner(city, myAllianceId);
    return {
        name: WorldCampaign.landmark(data.x, data.y) || data.name || '城池',
        level: Math.max(0, Number(data.level) || 0),
        owner,
    };
}

export function cityOwnerColor(owner: CityOwner): Color {
    return owner.relation === 'mine' ? new Color(97, 190, 165)
        : owner.relation === 'other' ? new Color(209, 111, 87) : new Color(180, 162, 120);
}

/** 铜杆、分叉军旗、盟名首字。没有服务端盟徽时使用旗字，不编造徽章。 */
export function drawCityFlag(root: Node, owner: CityOwner): void {
    const color = cityOwnerColor(owner);
    const pole = inkSurface(root, 'FlagPole', 46, 64, null, null);
    pole.lineWidth = 3; pole.strokeColor = new Color(34, 31, 24, 210);
    pole.moveTo(0, 0); pole.lineTo(0, 60); pole.stroke();
    pole.lineWidth = 1.4; pole.strokeColor = new Color(218, 185, 116);
    pole.moveTo(0, 0); pole.lineTo(0, 60); pole.stroke();
    pole.fillColor = new Color(235, 205, 141); pole.moveTo(-3, 59); pole.lineTo(0, 65); pole.lineTo(3, 59); pole.close(); pole.fill();
    let banner = root.getChildByName('FlagBanner');
    if (!banner) { banner = new Node('FlagBanner'); banner.layer = root.layer; banner.addComponent(UITransform); root.addChild(banner); }
    const g = inkSurface(banner, 'FlagCloth', 46, 64, null, null);
    g.fillColor = new Color(Math.round(color.r * .53), Math.round(color.g * .53), Math.round(color.b * .53));
    g.strokeColor = new Color(227, 199, 135); g.lineWidth = 1;
    g.moveTo(2, 55); g.lineTo(37, 52); g.lineTo(33, 36); g.lineTo(38, 20);
    g.lineTo(21, 25); g.lineTo(2, 22); g.close(); g.fill(); g.stroke();
    g.fillColor = new Color(color.r, color.g, color.b, 175);
    g.moveTo(3, 54); g.lineTo(13, 53); g.lineTo(10, 24); g.lineTo(3, 23); g.close(); g.fill();
    const letter = caption(banner, 'FlagMark', owner.mark, 19, 39, 24, 18,
        new Color(255, 235, 187), Label.HorizontalAlign.CENTER);
    letter.isBold = true;
}

/** 单行城名留在占地内；完整归属由选中面板承载，颜色只作快速阵营识别。 */
export function drawSystemCityNameplate(root: Node, data: ReturnType<typeof systemCityIdentity>, troopCount = 0): void {
    const owner = data.owner, color = cityOwnerColor(owner);
    const troopWidth = troopCount > 0 && owner.relation === 'mine' ? 48 : 0;
    const nameWidth = Math.min(152, Math.max(72, Array.from(data.name).length * 17 + 12));
    const width = nameWidth + 32 + troopWidth;
    root.getComponent(UITransform).setContentSize(width, 30);
    const g = inkSurface(root, 'CityTitlePlate', width, 30, new Color(19, 26, 22, 205), null);
    const left = -width / 2;
    g.fillColor = new Color(color.r, color.g, color.b, 210);
    g.roundRect(left + 1, -14, 3, 28, 1.5); g.fill();
    g.fillColor = new Color(112, 80, 35, 235);
    g.roundRect(left + 6, -11, 24, 22, 3); g.fill();
    const level = caption(root, 'CityLevel', data.level > 0 ? String(data.level) : '城', left + 18, 0, 22, 14,
        new Color(255, 229, 166), Label.HorizontalAlign.CENTER);
    level.node.getComponent(UITransform).setContentSize(22, 28); level.isBold = true;
    const title = caption(root, 'CityName', data.name, left + 32 + nameWidth / 2, 0, nameWidth - 8, 16,
        new Color(248, 233, 198), Label.HorizontalAlign.CENTER);
    title.node.getComponent(UITransform).setContentSize(nameWidth - 8, 28);
    title.isBold = true; title.overflow = Label.Overflow.SHRINK;
    const oldOwner = root.getChildByName('CityOwner'); if (oldOwner) oldOwner.active = false;
}

/** 名牌优先靠近占地前沿，让出城楼主体；完整按钮仍限制在投影边界内。 */
export function cityNameplatePlacement(corners: readonly (readonly number[])[], width: number,
    height: number): { x: number; y: number; scale: number; visible: boolean } {
    const hidden = { x: 0, y: 0, scale: 1, visible: false };
    if (corners.length < 3 || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return hidden;
    let x = 0, y = 0, area = 0;
    for (let i = 0; i < corners.length; i++) {
        const a = corners[i], b = corners[(i + 1) % corners.length];
        if (!Number.isFinite(a[0]) || !Number.isFinite(a[1])) return hidden;
        x += a[0]; y += a[1]; area += a[0] * b[1] - b[0] * a[1];
    }
    if (Math.abs(area) < 1) return hidden;
    x /= corners.length; y /= corners.length;
    const sign = Math.sign(area), margin = 3;
    let scale = 1;
    // 城池、斜向关隘共用实际投影多边形，名牌的四个角都不能落到外侧地块。
    for (let i = 0; i < corners.length; i++) {
        const a = corners[i], b = corners[(i + 1) % corners.length], dx = b[0] - a[0], dy = b[1] - a[1];
        const room = sign * (dx * (y - a[1]) - dy * (x - a[0])) - margin * Math.hypot(dx, dy);
        const support = Math.abs(dy) * width / 2 + Math.abs(dx) * height / 2;
        if (support > 0) scale = Math.min(scale, room / support);
    }
    if (scale < .65) return hidden;
    scale = Math.max(.65, Math.min(.88, scale * .86));
    let forwardRoom = Infinity;
    for (let i = 0; i < corners.length; i++) {
        const a = corners[i], b = corners[(i + 1) % corners.length], dx = b[0] - a[0], dy = b[1] - a[1];
        if (sign * dx <= 0) continue;
        const room = sign * (dx * (y - a[1]) - dy * (x - a[0])) - margin * Math.hypot(dx, dy);
        const support = (Math.abs(dy) * width / 2 + Math.abs(dx) * height / 2) * scale;
        forwardRoom = Math.min(forwardRoom, Math.max(0, (room - support) / (sign * dx)));
    }
    const depth = Math.max(...corners.map(p => p[1])) - Math.min(...corners.map(p => p[1]));
    y -= Math.min(depth * .3, forwardRoom);
    return { x, y, scale, visible: true };
}
