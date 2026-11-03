import { Color, Label, Node, UITransform } from 'cc';
import { caption, inkSurface } from './ui/ManagementStyle';
import WorldCampaign from './WorldCampaign';

/** 名称与等级可以来自地图配置；占领者只使用已收到的服务端字段。 */
export function systemCityIdentity(data: any): { name: string; level: number; subtitle: string; owned: boolean } {
    const region = WorldCampaign.config?.regions[WorldCampaign.regionAt(data.x, data.y)];
    const hasOwner = data.rid != null && String(data.rid) !== '0';
    const ownership = hasOwner ? data.unionName || data.nickName || '已占领'
        : data.rid != null ? '未占领' : '';
    return {
        name: WorldCampaign.landmark(data.x, data.y) || data.name || '城池',
        level: Math.max(0, Number(data.level) || 0),
        subtitle: [region?.name, ownership].filter(Boolean).join(' · '),
        owned: hasOwner,
    };
}

/** 屏幕空间的城池名牌，字号不跟着地图缩成细线，也不压在城楼上。 */
export function drawSystemCityNameplate(root: Node, data: ReturnType<typeof systemCityIdentity>): void {
    const width = Math.min(210, Math.max(142, Array.from(data.name).length * 21 + 66));
    root.getComponent(UITransform).setContentSize(width, 60);
    const g = inkSurface(root, 'CityTitlePlate', width, 60, null, null);
    const left = -width / 2, right = width / 2;
    g.fillColor = new Color(19, 26, 22, 240); g.strokeColor = new Color(190, 158, 91, 220); g.lineWidth = 1;
    g.moveTo(left + 7, 20); g.lineTo(right - 7, 20); g.lineTo(right, 13);
    g.lineTo(right, -15); g.lineTo(left, -15); g.lineTo(left, 13); g.close(); g.fill(); g.stroke();
    g.strokeColor = new Color(232, 204, 143, 150);
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
    // 归属未回包时只显示已知州名，不编造“未占领”或守军数。
    const subtitle = caption(root, 'CityOwner', data.subtitle, 0, -29, width, 11,
        data.owned ? new Color(176, 211, 171) : new Color(230, 223, 197), Label.HorizontalAlign.CENTER);
    subtitle.enableOutline = true; subtitle.outlineColor = new Color(24, 31, 26, 240); subtitle.outlineWidth = 1.5;
    subtitle.overflow = Label.Overflow.SHRINK;
    g.fillColor = new Color(221, 190, 124, 225);
    g.moveTo(-3, -42); g.lineTo(0, -46); g.lineTo(3, -42); g.close(); g.fill();
}
