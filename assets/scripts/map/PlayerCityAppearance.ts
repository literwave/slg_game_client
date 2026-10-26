/** 主城外观；服务端占地固定为 3×3，贴地投影由 PlayerCityGround 统一校准。 */
export const PLAYER_CITY_MAX_LEVEL = 30;
export const PLAYER_CITY_ANCHOR_Y = 0;
export const PLAYER_CITY_FOOTPRINT_RADIUS = 1;
/** AOI 的角色 ID 可能以十进制字符串传递，不能丢失 int64 精度。 */
export function isOwnPlayerCity(city: { rid: number | string; isMain: number }, playerId: number | string): boolean {
    return !!city && Number(city.isMain) === 1 && /^[1-9]\d*$/.test(String(playerId))
        && String(city.rid) === String(playerId);
}
const IMAGE_SIZES = [[512,437],[640,362],[640,385],[640,422],[640,403],[640,423],[640,404],[640,412],[640,412],[640,409],[1546,1017],[640,420],[640,400],[640,418],[640,411],[640,319],[640,418],[640,418],[640,402],[640,414],[640,415],[640,406],[640,406],[640,405],[640,408],[640,429],[640,413],[640,411],[640,420],[640,405],[640,419]];

/** 占地、选框与服务器的九格查询使用同一尺寸，不随等级变化。 */
export function playerCityFootprint(tileWidth: number, tileHeight: number): { width: number; height: number } {
    const span = PLAYER_CITY_FOOTPRINT_RADIUS * 2 + 1;
    return { width: tileWidth * span, height: tileHeight * span };
}

export function playerCityAppearance(level: number, tileWidth = 200, tileHeight = tileWidth / 2) {
    // 兼容未携带建筑等级的旧回包；新 AOI 按真实主城等级选择对应城图。
    const value = Number.isFinite(level) && level > 0
        ? Math.min(PLAYER_CITY_MAX_LEVEL, Math.max(1, Math.floor(level))) : 0;
    const [rawWidth, rawHeight] = IMAGE_SIZES[value];
    const footprint = playerCityFootprint(tileWidth, tileHeight);
    const width = footprint.width;
    const height = Math.max(rawHeight * width / rawWidth * .9, footprint.height * 1.15);
    const x = 0, y = -footprint.height / 2;
    return { art: value ? `player_city_lv${value}` : 'county', level: value,
        width, height, x, y, top: y + height, halfWidth: footprint.width / 2,
        nameY: -footprint.height / 2 - 18 };
}
