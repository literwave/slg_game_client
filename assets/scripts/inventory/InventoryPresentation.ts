import { getItemConfig } from '../common/ItemPresentation';

export type InventoryCategory = 'all' | 'resource' | 'item' | 'fragment';
export type InventoryDestination = 'lottery' | 'heroes' | 'alliance' | 'city' | 'map';
export const INVENTORY_CATEGORIES: Array<[InventoryCategory, string]> = [
    ['all', '全部'], ['resource', '资源'], ['item', '道具'], ['fragment', '武将碎片'],
];

export function inventoryCategory(itemId: number): InventoryCategory {
    const kind = Number(getItemConfig(itemId)?.Kind);
    return kind >= 1 && kind <= 4 ? 'resource' : kind === 8 ? 'fragment' : 'item';
}

/** 只提供已经接通的功能入口；加速/合成没有使用协议时不伪造扣除。 */
export function inventoryAction(itemId: number): { label: string; destination?: InventoryDestination } {
    if (itemId === 103) return { label: '前往点将', destination: 'lottery' };
    if (itemId === 1001) return { label: '前往地图', destination: 'map' };
    if (itemId === 100) return { label: '前往联盟', destination: 'alliance' };
    const category = inventoryCategory(itemId);
    if (category === 'resource') return { label: '前往内城', destination: 'city' };
    if (category === 'fragment') return { label: '查看武将', destination: 'heroes' };
    return { label: '暂不可使用' };
}

export function inventoryLayout(width: number, height: number) {
    const availableWidth = Math.max(1, width - 32), availableHeight = Math.max(1, height - 32);
    const scale = Math.min(1, availableWidth / 320, availableHeight / 440);
    const w = Math.min(1000, availableWidth / scale), h = Math.min(650, availableHeight / scale);
    const narrow = w < 720, bodyHeight = h - 154;
    const detailWidth = narrow ? w - 40 : Math.min(310, w * .34);
    const detailHeight = narrow ? 186 : bodyHeight;
    const gridWidth = narrow ? w - 40 : w - 56 - detailWidth;
    const gridHeight = narrow ? bodyHeight - detailHeight - 12 : bodyHeight;
    const columns = Math.max(2, Math.min(5, Math.floor((gridWidth + 8) / 112)));
    return { width: w, height: h, scale, narrow, bodyHeight, detailWidth, detailHeight, gridWidth, gridHeight, columns };
}
