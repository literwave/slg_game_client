import { fitCityArt, CityArtFit } from './CityArtFit';

/** 固定城池按地图坐标绑定原创美术；等级只控制尺寸和未知城池的缺省外观。 */
export interface CityArtIdentity { x?: number; y?: number; name?: string; }
export interface CityGroundCalibration {
    canvasWidth: number; canvasHeight: number;
    left: readonly [number, number]; right: readonly [number, number]; front: readonly [number, number];
    /** 完整贴格城基的后角；有此值时按四角铺满，不再按塔楼 Alpha 整体缩小。 */
    back?: readonly [number, number];
    /** 沿用主城整图投影：墙脚贴地，塔顶保留在后侧占地线上方。 */
    canvasProjection?: { scale: number; centerX: number; centerY: number };
}
interface SystemCityArt extends CityArtIdentity {
    near: string; far: string; anchorY?: number; ground?: CityGroundCalibration; overviewUsesNearProjection?: boolean;
}
export interface CityArtLayout { width: number; height: number; anchorX: number; anchorY: number; fit: CityArtFit; }

// 标定生成原图的完整城基四角，近景和缩略图按归一化坐标复用。
function tileGround(w: number, h: number, lx: number, ly: number, rx: number, ry: number,
    fx: number, fy: number, bx: number, by: number): CityGroundCalibration {
    return { canvasWidth: w, canvasHeight: h, left: [lx, ly], right: [rx, ry], front: [fx, fy], back: [bx, by] };
}
/** 同批原画共用地面注册点；单独保留后侧屋顶高度。 */
function revampedGround(): CityGroundCalibration {
    return { ...tileGround(1040,520,65,299,975,299,520,519,520,79),
        canvasProjection: { scale: 1.152, centerX: .5, centerY: .545 } };
}
export const SYSTEM_CITY_ARTS: SystemCityArt[] = [
    { name: '益州州府', x: 166, y: 307, near: 'city-yizhou-revamp-v7', far: 'city-overview-yizhou-revamp-v7', ground: revampedGround() },
    { name: '青州州府', x: 833, y: 692, near: 'city-qingzhou-revamp-v7', far: 'city-overview-qingzhou-revamp-v7', ground: revampedGround() },
    { name: '徐州州府', x: 500, y: 884, near: 'city-xuzhou-revamp-v7', far: 'city-overview-xuzhou-revamp-v7', ground: revampedGround() },
    { name: '荆州州府', x: 166, y: 692, near: 'city-jingzhou-revamp-v7', far: 'city-overview-jingzhou-revamp-v7', ground: revampedGround() },
    { name: '凉州州府', x: 499, y: 114, near: 'city-liangzhou-revamp-v7', far: 'city-overview-liangzhou-revamp-v7', ground: revampedGround() },
    { name: '幽州州府', x: 833, y: 307, near: 'city-youzhou-revamp-v7', far: 'city-overview-youzhou-revamp-v7', ground: revampedGround() },
    { name: '河东都城', x: 594, y: 664, near: 'city-hedong-revamp-v7', far: 'city-overview-hedong-revamp-v7', ground: revampedGround() },
    { name: '关中都城', x: 310, y: 500, near: 'city-guanzhong-revamp-v7', far: 'city-overview-guanzhong-revamp-v7', ground: revampedGround() },
    { name: '河内都城', x: 594, y: 335, near: 'city-henei-revamp-v7', far: 'city-overview-henei-revamp-v7', ground: revampedGround() },
    { name: '洛阳', x: 500, y: 500, near: 'city-luoyang-revamp-v7', far: 'city-overview-luoyang-revamp-v7', ground: revampedGround() },
];
const cityArtByPosition = new Map(SYSTEM_CITY_ARTS.map(city => [city.x + ',' + city.y, city]));
const cityArtByName = new Map(SYSTEM_CITY_ARTS.map(city => [city.name, city]));
function cityAppearance(city?: CityArtIdentity): typeof SYSTEM_CITY_ARTS[number] | undefined {
    if (!city) return undefined;
    // 服务端占领数据可能不带名称，坐标优先，名称仅用于缺少坐标的展示数据。
    if (city.x != null && city.y != null) return cityArtByPosition.get(Number(city.x) + ',' + Number(city.y));
    return cityArtByName.get(city.name);
}

export function cityArtGround(city?: CityArtIdentity): CityGroundCalibration | undefined {
    return cityAppearance(city)?.ground;
}

export function cityOverviewUsesNearProjection(city?: CityArtIdentity): boolean {
    const appearance = cityAppearance(city);
    return !!appearance?.ground && appearance.overviewUsesNearProjection !== false;
}

/** 与 campaign-map 的 footprintRadius、后端导出占地保持一致。 */
export function cityFootprintRadius(level: number): number {
    return level >= 10 ? 4 : level >= 8 ? 3 : level >= 5 ? 2 : 1;
}

/** 未单独标定的旧城图与视口预加载使用的缺省宽度；有身份的近景以 cityArtLayout 为准。 */
export function cityArtWidth(level: number, tileWidth = 200): number {
    return (cityFootprintRadius(level) * 2 + 1) * tileWidth * (level >= 8 ? 1.12 : 1.08);
}

/** 对齐城墙四角所在的地面中心，不能沿用旧堡垒素材的下部锚点。 */
export function cityArtAnchorY(level: number, city?: CityArtIdentity): number {
    const appearance = cityAppearance(city), basis = appearance?.ground;
    return basis ? 1 - (basis.left[1] + basis.right[1]) / 2 / basis.canvasHeight
        : appearance?.anchorY ?? (level >= 8 ? .52 : .5);
}

/** 画布就是实际占地，完整原画经共享变换收进菱形。 */
export function cityArtLayout(level: number, imageWidth: number, imageHeight: number,
    tileWidth = 200, tileHeight = tileWidth / 2, city?: CityArtIdentity): CityArtLayout {
    const basis = cityAppearance(city)?.ground ?? revampedGround();
    const span = cityFootprintRadius(level) * 2 + 1;
    return { width: span * tileWidth, height: span * tileHeight, anchorX: .5, anchorY: .5,
        fit: fitCityArt(cityArtAsset(level, city), basis, cityArtAnchorY(level, city)) };
}

/** 近景绘制和 Alpha 拾取共用同一城池贴图，避免换图后沿用旧轮廓。 */
export function cityArtAsset(level: number, city?: CityArtIdentity): string {
    const appearance = cityAppearance(city);
    if (appearance) return appearance.near;
    return level >= 8 ? 'city-luoyang-revamp-v7' : level >= 5 ? 'city-guanzhong-revamp-v7' : 'city-qingzhou-revamp-v7';
}

/** 总览只展示城墙、府衙与宫城的大轮廓，不缩放近景的密集街坊细节。 */
export function cityOverviewAsset(level: number, city?: CityArtIdentity): string {
    const appearance = cityAppearance(city);
    if (appearance) return appearance.far;
    return level >= 8 ? 'city-overview-luoyang-revamp-v7' : level >= 5 ? 'city-overview-guanzhong-revamp-v7' : 'city-overview-qingzhou-revamp-v7';
}
