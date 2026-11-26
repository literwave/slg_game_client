/** 主城外观；服务端占地固定为 3×3，贴地投影由 PlayerCityGround 统一校准。 */
export const PLAYER_CITY_MAX_LEVEL = 30;
export const PLAYER_CITY_ANCHOR_Y = .5;
export const PLAYER_CITY_FOOTPRINT_RADIUS = 1;
// 同一阶段保持建筑布局，跨越五级时再更换整体外观。
const PLAYER_CITY_STAGE_ARTS: readonly string[] = ['player-city-grid-01', 'player-city-grid-10-wall-v2',
    'player-city-grid-15', 'player-city-grid-20', 'player-city-grid-25', 'player-city-grid-30'];
/** 按真实建筑等级选择外观阶段，未知等级仍显示县城占位图。 */
export function playerCityArt(level: number): string {
    if (!Number.isFinite(level) || level < 1) return 'county';
    const stage = Math.floor((Math.min(PLAYER_CITY_MAX_LEVEL, level) - 1) / 5);
    return PLAYER_CITY_STAGE_ARTS[stage];
}
/** AOI 的角色 ID 可能以十进制字符串传递，不能丢失 int64 精度。 */
export function isOwnPlayerCity(city: { rid: number | string; isMain: number }, playerId: number | string): boolean {
    return !!city && Number(city.isMain) === 1 && /^[1-9]\d*$/.test(String(playerId))
        && String(city.rid) === String(playerId);
}

/** 占地、选框与服务器的九格查询使用同一尺寸，不随等级变化。 */
export function playerCityFootprint(tileWidth: number, tileHeight: number): { width: number; height: number } {
    const span = PLAYER_CITY_FOOTPRINT_RADIUS * 2 + 1;
    return { width: tileWidth * span, height: tileHeight * span };
}

export function playerCityAppearance(level: number, tileWidth = 200, tileHeight = tileWidth / 2) {
    // 兼容未携带建筑等级的旧回包；新 AOI 按真实主城等级选择对应城图。
    const value = Number.isFinite(level) && level > 0
        ? Math.min(PLAYER_CITY_MAX_LEVEL, Math.max(1, Math.floor(level))) : 0;
    const footprint = playerCityFootprint(tileWidth, tileHeight);
    const width = footprint.width;
    const height = footprint.height;
    const x = 0, y = 0;
    return { art: playerCityArt(value), level: value,
        width, height, x, y, top: height / 2, halfWidth: footprint.width / 2,
        nameY: 0 };
}
