/** 主城建筑（BuildingDetail.Id=1）的外观；不改变服务端规定的 3×3 占地。 */
export const PLAYER_CITY_MAX_LEVEL = 30;
// 所有等级以图片地基前沿落地，不能把整张含屋顶的图片中心当作地块中心。
export const PLAYER_CITY_ANCHOR_Y = 0;
export const PLAYER_CITY_FOOTPRINT_RADIUS = 1;

/** 占地属于地图网格，不能随主城等级或图片宽高变化。 */
export function playerCityFootprint(tileWidth: number, tileHeight: number): { width: number; height: number } {
    const span = PLAYER_CITY_FOOTPRINT_RADIUS * 2 + 1;
    return { width: tileWidth * span, height: tileHeight * span };
}

export function playerCityGroundFront(tileHeight: number): number {
    return -playerCityFootprint(0, tileHeight).height / 2 + tileHeight * .08;
}

export function playerCityAppearance(level: number, tileWidth = 200): { art: string; width: number; level: number } {
    // 同一座主城始终占 3×3 格；升级改变建筑形态，地基不在固定占地里忽大忽小。
    const width = playerCityFootprint(tileWidth, 0).width * .92;
    // AOI 目前没有其他玩家的主城建筑等级；未知等级使用中性城池，不推断等级。
    if (!Number.isFinite(level) || level <= 0) return { art: 'county', width, level: 0 };
    const value = Math.min(PLAYER_CITY_MAX_LEVEL, Math.max(1, Math.floor(level)));
    return { art: `player_city_lv${value}`, width, level: value };
}
