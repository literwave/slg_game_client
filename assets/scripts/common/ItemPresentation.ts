import ConfigManager from '../core/ConfigManager';
import { getConfigIconPath } from '../utils/ConfigIcon';

// 客户端独立道具美术，避免覆盖服务端同步的 Item 表。
const ITEM_ICON_IDS = new Set([1, 2, 3, 4, 100, 101, 102, 103, 1001]);

// 已随客户端提供的独立武将碎片图；新增武将未出图时仍沿用配置图标。
const FRAGMENT_ICON_HERO_IDS = new Set([
    1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010,
    1011, 1012, 1013, 1014, 1015, 1016, 1017, 1018, 1019, 1020,
    1021, 1022, 1023, 1024, 1025, 1026,
]);

/** Item.Id 是道具标识；Kind 只表示用途，不能代替道具 ID。 */
export function getItemConfig(itemId: number): any | undefined {
    const rows = ConfigManager.getInstance().getConfig('Item');
    return Array.isArray(rows) ? rows.find(row => Number(row?.Id) === Number(itemId)) : undefined;
}

export function itemName(itemId: number): string {
    return getItemConfig(itemId)?.Name || `道具 ${itemId}`;
}

/** 已制作道具优先使用独立美术；未覆盖的新道具沿用 Item.Icon。 */
export function itemIconPath(itemId: number): string {
    if (ITEM_ICON_IDS.has(Number(itemId))) {
        return `ui/item_icons/items/item_${Number(itemId)}/spriteFrame`;
    }
    const heroId = fragmentHeroId(itemId);
    if (FRAGMENT_ICON_HERO_IDS.has(heroId)) {
        return `ui/item_icons/hero_fragments/fragment_${heroId}/spriteFrame`;
    }
    return getConfigIconPath(getItemConfig(itemId)?.Icon);
}

export function fragmentHeroId(itemId: number): number {
    const cfg = getItemConfig(itemId);
    if (Number(cfg?.Kind) !== 8 || !Array.isArray(cfg.useParams)) return 0;
    const id = Number(cfg.useParams.find(param => param?.hero_id != null)?.hero_id);
    return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

export function itemGlyph(itemId: number): string {
    const cfg = getItemConfig(itemId);
    return ({ 1: '粮', 2: '木', 3: '铁', 4: '石', 5: '时', 6: '迁', 7: '令', 8: '碎', 9: '将' })[Number(cfg?.Kind)] || '物';
}
