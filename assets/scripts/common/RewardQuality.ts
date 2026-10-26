/** 品质只读取配置字段；未知值使用中性色，不按数量或价格推断。 */
export const normalizeRewardQuality = (value: unknown): number =>
    Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 5 ? Number(value) : 0;

const QUALITY_STYLES = [
    { name: '', accent: [170, 177, 167], fill: [37, 43, 39] },
    { name: '普通', accent: [174, 186, 177], fill: [37, 43, 39] },
    { name: '精良', accent: [117, 209, 150], fill: [29, 52, 42] },
    { name: '稀有', accent: [112, 184, 255], fill: [29, 45, 68] },
    { name: '史诗', accent: [202, 147, 255], fill: [56, 36, 74] },
    { name: '传说', accent: [255, 209, 113], fill: [76, 53, 27] },
];

export function rewardQualityStyle(quality: number) { return QUALITY_STYLES[normalizeRewardQuality(quality)]; }
