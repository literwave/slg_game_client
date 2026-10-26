import type { LotteryReward } from '../general/LotteryCommand';
import { normalizeRewardQuality as validQuality } from '../common/RewardQuality';
export { rewardQualityStyle as lotteryQualityStyle } from '../common/RewardQuality';

export interface LotteryRewardEntry {
    reward: LotteryReward;
    hero: any | null;
    stars: number;
    fiveStar: boolean;
    quality: number;
    category: string;
}

/** 保留服务端顺序和数量；碎片、资源及转化道具不能冒充整位武将。 */
export function lotteryRewardEntries(rewards: LotteryReward[], heroes: any, items: any = []): LotteryRewardEntry[] {
    const rows: any[] = Array.isArray(heroes) ? heroes : Object.keys(heroes || {}).map(key => heroes[key]);
    const itemRows: any[] = Array.isArray(items) ? items : Object.keys(items || {}).map(key => items[key]);
    return rewards.map(reward => {
        const hero = reward.rewardType === 3 ? rows.find(row => Number(row?.Id) === reward.itemId) || null : null;
        const stars = Math.max(0, Math.min(5, Math.floor(Number(hero?.Star) || 0)));
        const item = reward.rewardType !== 3 && reward.rewardType !== 4 ? itemRows.find(row => Number(row?.Id) === reward.itemId) : null;
        const quality = reward.rewardType === 3 ? validQuality(hero?.Quality) || stars : validQuality(item?.Quality);
        const kind = Number(item?.Kind);
        const category = reward.rewardType === 3 ? stars ? `${stars}星武将` : '武将' : reward.rewardType === 4 ? '兵力'
            : kind === 8 ? '碎片' : kind >= 1 && kind <= 4 ? '资源' : '道具';
        return { reward: { ...reward }, hero, stars, quality, category,
            fiveStar: !!hero && Number(hero.Star) === 5 && reward.itemCount > 0 };
    });
}

export function lotteryResultLayout(viewWidth: number, viewHeight: number) {
    const width = Math.max(280, Math.min(920, viewWidth - 32));
    const height = Math.max(360, Math.min(640, viewHeight - 32));
    const scale = Math.min(1, (viewWidth - 20) / width, (viewHeight - 20) / height);
    const columns = width >= 700 ? 5 : width >= 500 ? 4 : width >= 400 ? 3 : 2;
    // 顶部预留翻页、底部预留继续点将及消耗说明；十连结果仍可同屏展示。
    const areaHeight = height - 246;
    const rows = Math.max(1, Math.min(3, Math.floor((areaHeight + 12) / 116)));
    return { width, height, scale, columns, rows, pageSize: columns * rows, areaHeight, gridY: 3 };
}
