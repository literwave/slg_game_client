import { cityArtAnchorY, cityArtAsset, cityArtWidth, CityArtIdentity } from './CityFootprint';
import { SYSTEM_CITY_SILHOUETTES } from './SystemCitySilhouettes';

/** 仅用于画面拾取；实际占地、行军和建设仍使用 cityFootprintRadius。 */
export function systemCityHit(dx: number, dy: number, level: number, tileWidth = 200, city?: CityArtIdentity): boolean {
    const art = cityArtAsset(level, city);
    const shape = SYSTEM_CITY_SILHOUETTES[art], width = cityArtWidth(level, tileWidth);
    const u = dx / width + .5, v = 1 - cityArtAnchorY(level, city) - dy / (width * shape.height / shape.width);
    if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || v < 0 || u >= 1 || v >= 1) return false;
    const x = Math.floor(u * shape.columns), y = Math.floor(v * shape.rows.length);
    return (parseInt(shape.rows[y].charAt(x >> 2), 16) & (1 << (x & 3))) !== 0;
}
