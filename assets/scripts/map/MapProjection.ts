/** 大地图唯一的显示投影。只改变像素，不改变服务器格坐标、占地或入口。 */
export const MAP_TILE_WIDTH = 200;
export const MAP_TILE_HEIGHT = 125;
/** 常用地图视角的正交相机半高；近景的标签显隐与相机共用此值。 */
export const DEFAULT_MAP_HEIGHT = 450;

/** 现有地面美术以 2:1 格子制作，按运行中的格子比例一起投影。 */
export function groundArtScaleY(tileWidth: number, tileHeight: number): number {
    return tileHeight / (tileWidth * .5);
}

/** 保留 TMX 的逻辑尺寸，只生成供坐标系统使用的无瓦片层几何。 */
export function mapGeometryXml(source: string): string {
    const header = source?.match(/<map\b[^>]*>/)?.[0];
    if (!header || !/\borientation=["']isometric["']/.test(header)) throw new Error('等距地图坐标定义缺失');
    for (const name of ['width', 'height', 'tilewidth', 'tileheight']) {
        const value = Number(header.match(new RegExp(`\\b${name}=["'](\\d+)["']`))?.[1]);
        if (!Number.isInteger(value) || value <= 0) throw new Error(`地图尺寸无效：${name}`);
    }
    return header.replace(/\btilewidth=["']\d+["']/, `tilewidth="${MAP_TILE_WIDTH}"`)
        .replace(/\btileheight=["']\d+["']/, `tileheight="${MAP_TILE_HEIGHT}"`) + '</map>';
}
