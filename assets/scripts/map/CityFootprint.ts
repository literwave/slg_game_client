/** 固定城池按地图坐标绑定原创美术；等级只控制尺寸和未知城池的缺省外观。 */
export interface CityArtIdentity { x?: number; y?: number; name?: string; }
export const SYSTEM_CITY_ARTS = [
    { name: '益州州府', x: 166, y: 307, near: 'city-yizhou-v1', far: 'city-overview-yizhou-v1' },
    { name: '青州州府', x: 833, y: 692, near: 'city-qingzhou-v1', far: 'city-overview-qingzhou-v1' },
    { name: '徐州州府', x: 500, y: 884, near: 'city-xuzhou-v1', far: 'city-overview-xuzhou-v1' },
    { name: '荆州州府', x: 166, y: 692, near: 'city-jingzhou-v1', far: 'city-overview-jingzhou-v1' },
    { name: '凉州州府', x: 499, y: 114, near: 'city-liangzhou-v1', far: 'city-overview-liangzhou-v1' },
    { name: '幽州州府', x: 833, y: 307, near: 'city-youzhou-v1', far: 'city-overview-youzhou-v1' },
    { name: '河东都城', x: 594, y: 664, near: 'city-hedong-v1', far: 'city-overview-hedong-v1' },
    { name: '关中都城', x: 310, y: 500, near: 'city-guanzhong-v1', far: 'city-overview-guanzhong-v1' },
    { name: '河内都城', x: 594, y: 335, near: 'city-henei-v1', far: 'city-overview-henei-v1' },
    { name: '洛阳', x: 500, y: 500, near: 'capital-imperial-v2', far: 'city-overview-capital-v4' },
];
const cityArtByPosition = new Map(SYSTEM_CITY_ARTS.map(city => [city.x + ',' + city.y, city]));
const cityArtByName = new Map(SYSTEM_CITY_ARTS.map(city => [city.name, city]));
function cityAppearance(city?: CityArtIdentity): typeof SYSTEM_CITY_ARTS[number] | undefined {
    if (!city) return undefined;
    // 服务端占领数据可能不带名称，坐标优先，名称仅用于缺少坐标的展示数据。
    if (city.x != null && city.y != null) return cityArtByPosition.get(Number(city.x) + ',' + Number(city.y));
    return cityArtByName.get(city.name);
}

/** 与 campaign-map 的 footprintRadius、后端导出占地保持一致。 */
export function cityFootprintRadius(level: number): number {
    return level >= 10 ? 4 : level >= 8 ? 3 : level >= 5 ? 2 : 1;
}

/** 外墙填满占地；按各档原画给城门道路和透明边缘留余量，不改变实际占地。 */
export function cityArtWidth(level: number, tileWidth = 200): number {
    return (cityFootprintRadius(level) * 2 + 1) * tileWidth * (level >= 8 ? 1.12 : 1.08);
}

/** 对齐城墙四角所在的地面中心，不能沿用旧堡垒素材的下部锚点。 */
export function cityArtAnchorY(level: number): number {
    return level >= 8 ? .52 : .5;
}

/** 近景绘制和 Alpha 拾取共用同一城池贴图，避免换图后沿用旧轮廓。 */
export function cityArtAsset(level: number, city?: CityArtIdentity): string {
    const appearance = cityAppearance(city);
    if (appearance) return appearance.near;
    return level >= 8 ? 'capital-imperial-v2' : level >= 5 ? 'county-commandery-v4' : 'town-prefecture-v2';
}

/** 总览只展示城墙、府衙与宫城的大轮廓，不缩放近景的密集街坊细节。 */
export function cityOverviewAsset(level: number, city?: CityArtIdentity): string {
    const appearance = cityAppearance(city);
    if (appearance) return appearance.far;
    return level >= 8 ? 'city-overview-capital-v4' : level >= 5 ? 'city-overview-county-v4' : 'city-overview-town-v4';
}
