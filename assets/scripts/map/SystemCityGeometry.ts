import { cityArtAnchorY, cityArtAsset, cityArtWidth, CityArtIdentity } from './CityFootprint';
import { SYSTEM_CITY_SILHOUETTES } from './SystemCitySilhouettes';

/** 仅用于画面拾取；实际占地、行军和建设仍使用 cityFootprintRadius。 */
export function systemCityHit(dx: number, dy: number, level: number, tileWidth = 200, city?: CityArtIdentity): boolean {
    const art = cityArtAsset(level, city);
    const shape = SYSTEM_CITY_SILHOUETTES[art], width = cityArtWidth(level, tileWidth);
    const u = dx / width + .5, v = 1 - cityArtAnchorY(level) - dy / (width * shape.height / shape.width);
    if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || v < 0 || u >= 1 || v >= 1) return false;
    const x = Math.floor(u * shape.columns), y = Math.floor(v * shape.rows.length);
    return (parseInt(shape.rows[y].charAt(x >> 2), 16) & (1 << (x & 3))) !== 0;
}

/**
 * 空地选框是整块菱形，不能只检查手指落点。
 * 仅对空地拾取使用此投影相交检测，不扩大城池实际占地或行军阻挡范围。
 */
export function systemCityOverlapsTile(dx: number, dy: number, level: number,
    tileWidth = 200, tileHeight = 100, city?: CityArtIdentity): boolean {
    if (![dx, dy, tileWidth, tileHeight].every(Number.isFinite) || tileWidth <= 0 || tileHeight <= 0) return false;
    const shape = SYSTEM_CITY_SILHOUETTES[cityArtAsset(level, city)];
    const width = cityArtWidth(level, tileWidth), height = width * shape.height / shape.width;
    const halfWidth = tileWidth / 2, halfHeight = tileHeight / 2;
    const left = -width / 2, top = (1 - cityArtAnchorY(level)) * height;
    const cellWidth = width / shape.columns, cellHeight = height / shape.rows.length;
    const minX = Math.max(0, Math.floor((dx - halfWidth - left) / cellWidth));
    const maxX = Math.min(shape.columns - 1, Math.floor((dx + halfWidth - left) / cellWidth));
    const minY = Math.max(0, Math.floor((top - dy - halfHeight) / cellHeight));
    const maxY = Math.min(shape.rows.length - 1, Math.floor((top - dy + halfHeight) / cellHeight));
    for (let y = minY; y <= maxY; y++) {
        const cellTop = top - y * cellHeight;
        for (let x = minX; x <= maxX; x++) {
            if (!(parseInt(shape.rows[y].charAt(x >> 2), 16) & (1 << (x & 3)))) continue;
            const cellLeft = left + x * cellWidth;
            // 矩形轮廓采样格到菱形中心的最短曼哈顿距离，剔除四个透明角。
            const gapX = Math.max(cellLeft - dx, dx - cellLeft - cellWidth, 0);
            const gapY = Math.max(cellTop - cellHeight - dy, dy - cellTop, 0);
            if (gapX / halfWidth + gapY / halfHeight < 1) return true;
        }
    }
    return false;
}
