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

/** 屏幕空间的城池名牌，字号不跟着地图缩成细线，也不压在城楼上。 */
export function drawSystemCityNameplate(root: Node, data: ReturnType<typeof systemCityIdentity>): void {
    const owner = data.owner, color = cityOwnerColor(owner);
    const width = Math.min(230, Math.max(156, Array.from(data.name).length * 21 + 54,
        Math.min(10, Array.from(owner.name).length) * 15 + 60));
    root.getComponent(UITransform).setContentSize(width, 86);
    const g = inkSurface(root, 'CityTitlePlate', width, 76, null, null);
    const left = -width / 2, right = width / 2;
    g.fillColor = new Color(19, 26, 22, 245); g.strokeColor = color; g.lineWidth = 1.2;
    g.moveTo(left + 7, 20); g.lineTo(right - 7, 20); g.lineTo(right, 13);
    g.lineTo(right, -15); g.lineTo(left, -15); g.lineTo(left, 13); g.close(); g.fill(); g.stroke();
    g.strokeColor = color;
    g.moveTo(left + 12, 18); g.lineTo(right - 12, 18); g.stroke();
    // 铜色等级牌与城名组合，省去“城池等级”等重复说明。
    const bx = left + 19;
    g.fillColor = new Color(112, 80, 35, 255); g.strokeColor = new Color(212, 178, 109, 230);
    g.moveTo(bx - 15, 22); g.lineTo(bx + 15, 22); g.lineTo(bx + 15, -11);
    g.lineTo(bx, -20); g.lineTo(bx - 15, -11); g.close(); g.fill(); g.stroke();
    const level = caption(root, 'CityLevel', data.level > 0 ? String(data.level) : '城', bx, 2, 28, 17,
        new Color(255, 229, 166), Label.HorizontalAlign.CENTER); level.isBold = true;
    const title = caption(root, 'CityName', data.name, 18, 3, width - 48, 21,
        new Color(248, 233, 198), Label.HorizontalAlign.CENTER);
    title.isBold = true; title.overflow = Label.Overflow.SHRINK;
    // 占领盟名是一条有阵营色的旗带，省去州名和归属说明段落。
    if (owner.occupied) {
        g.fillColor = new Color(Math.round(color.r * .28), Math.round(color.g * .28), Math.round(color.b * .28), 250);
        g.strokeColor = new Color(color.r, color.g, color.b, 230);
        g.moveTo(left + 13, -16); g.lineTo(right - 13, -16); g.lineTo(right - 18, -29);
        g.lineTo(right - 13, -42); g.lineTo(left + 13, -42); g.lineTo(left + 18, -29); g.close(); g.fill(); g.stroke();
    }
    const text = owner.occupied ? (owner.relation === 'mine' && owner.name !== '本盟' ? '本盟 · ' : '') + owner.name : owner.name;
    const subtitle = caption(root, 'CityOwner', text, 0, -29, width - 42, owner.occupied ? 15 : 12,
        owner.occupied ? new Color(247, 235, 202) : new Color(211, 202, 174), Label.HorizontalAlign.CENTER);
    subtitle.isBold = owner.occupied;
    subtitle.enableOutline = true; subtitle.outlineColor = new Color(24, 31, 26, 230); subtitle.outlineWidth = 1;
    subtitle.overflow = Label.Overflow.SHRINK;
}
