import { cityArtAsset, cityArtLayout, cityFootprintRadius, CityArtIdentity } from './CityFootprint';
import { cityArtToSource } from './CityArtFit';
import { SYSTEM_CITY_SILHOUETTES } from './SystemCitySilhouettes';

/** 与城图材质共用逆变换；后侧塔顶可露出地面边线，但不截获相邻格点击。 */
export function systemCityHit(dx: number, dy: number, level: number, tileWidth = 200, city?: CityArtIdentity,
    tileHeight = tileWidth / 2): boolean {
    if (![dx, dy, tileWidth, tileHeight].every(Number.isFinite) || tileWidth <= 0 || tileHeight <= 0) return false;
    const shape = SYSTEM_CITY_SILHOUETTES[cityArtAsset(level, city)];
    if (!shape) return false;
    const layout = cityArtLayout(level, shape.width, shape.height, tileWidth, tileHeight, city);
    const x = dx / layout.width, y = dy / layout.height;
    if (Math.abs(x) + Math.abs(y) > .5) return false;
    const { x: u, y: v } = cityArtToSource(layout.fit, x, y);
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return false;
    const column = Math.floor(u * shape.columns), row = Math.floor(v * shape.rows.length);
    return (parseInt(shape.rows[row][column >> 2], 16) & (1 << (column & 3))) !== 0;
}

/** 城图已收进实际占地：透明角落同属城池，城外不得再扩大隐形阻挡。 */
export function systemCityCoversCell(offsetX: number, offsetY: number, level: number,
    tileWidth = 200, tileHeight = tileWidth / 2, city?: CityArtIdentity): boolean {
    if (!Number.isInteger(offsetX) || !Number.isInteger(offsetY) || !Number.isFinite(level)
        || !Number.isFinite(tileWidth) || !Number.isFinite(tileHeight) || tileWidth <= 0 || tileHeight <= 0) return false;
    const radius = cityFootprintRadius(level);
    return Math.abs(offsetX) <= radius && Math.abs(offsetY) <= radius;
}
