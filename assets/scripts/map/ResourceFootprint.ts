/** 矩形图片四角均位于菱形内：w/tileW + h/tileH <= padding。 */
export function resourceFootprint(imageWidth: number, imageHeight: number,
    tileWidth: number, tileHeight: number, level: number): { width: number; height: number } {
    const ratio = Math.max(1, imageHeight) / Math.max(1, imageWidth);
    const padding = .4 + Math.min(10, Math.max(1, level)) * .05;
    const width = padding / (1 / Math.max(1, tileWidth) + ratio / Math.max(1, tileHeight));
    return { width, height: width * ratio };
}
