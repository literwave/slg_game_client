/** 与 campaign-map 的 footprintRadius、后端导出占地保持一致。 */
export function cityFootprintRadius(level: number): number {
    return level >= 10 ? 4 : level >= 8 ? 3 : level >= 5 ? 2 : 1;
}
