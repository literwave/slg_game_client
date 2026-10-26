import ConfigManager from '../core/ConfigManager';
import { TaskInfo } from './ProgressionCommand';
import { itemGlyph, itemIconPath } from '../common/ItemPresentation';
import { normalizeRewardQuality } from '../common/RewardQuality';
import { getConfigIconPath } from '../utils/ConfigIcon';

export interface RewardPreview { rewardType: number; itemId: number; itemCount: number; }
export function configRows(name: string): any[] {
    const rows = ConfigManager.getInstance().getConfig(name);
    return Array.isArray(rows) ? rows : rows && typeof rows === 'object' ? Object.keys(rows).map(key => rows[key]) : [];
}
export function rewardPreview(rows: any[]): RewardPreview[] {
    return (rows || []).map(r => ({ rewardType: Number(r.reward_type ?? r.rewardType ?? 1),
        itemId: Number(r.item_id ?? r.itemId), itemCount: Number(r.item_count ?? r.itemCount) }))
        .filter(r => (r.itemId > 0 || r.rewardType === 4) && r.itemCount > 0);
}
export function rewardName(reward: RewardPreview): string {
    if (reward.rewardType === 4) return '兵力';
    const row = configRows(reward.rewardType === 3 ? 'Hero' : 'Item').find(r => Number(r.Id ?? r.id) === reward.itemId);
    return row?.Name || row?.name || (reward.rewardType === 3 ? '武将' : '道具') + reward.itemId;
}
export function taskRewardPresentation(reward: RewardPreview): { name: string; quality: number; icon: string; glyph: string } {
    const hero = reward.rewardType === 3, soldier = reward.rewardType === 4;
    const row = !soldier && configRows(hero ? 'Hero' : 'Item').find(r => Number(r.Id ?? r.id) === reward.itemId);
    return { name: rewardName(reward), quality: normalizeRewardQuality(row?.Quality),
        icon: soldier ? '' : hero ? getConfigIconPath(row?.Icon) : itemIconPath(reward.itemId),
        glyph: soldier ? '兵' : hero ? '将' : itemGlyph(reward.itemId) };
}
export function taskPresentation(task: TaskInfo): { name: string; detail: string; target: number; rewards: RewardPreview[]; order: number; nextId: number } {
    const table = { 1: 'MainTask', 2: 'DailyTask', 3: 'WeekTask' }[task.taskType];
    const cfg = table && configRows(table).find(row => row.Id === task.taskId);
    return { name: cfg?.Name || `任务 ${task.taskId}`, detail: (cfg?.Desc || '完成目标后领取奖励').replace(/招募武将|招募/g, '点将').replace(/%s/g, String(cfg?.Target ?? '')),
        target: Math.max(1, Number(cfg?.Target) || 1), rewards: rewardPreview(cfg?.Reward), order: cfg?.Order ?? task.taskId,
        nextId: Math.max(0, Math.trunc(Number(cfg?.NextId) || 0)) };
}

/** 主线按配置顺序推进；主线结束后展示日常/周常，均只选服务端已下发的任务。 */
export function trackedTask(tasks: TaskInfo[]): TaskInfo | undefined {
    return tasks.filter(t => [1, 2, 3].indexOf(t.taskType) >= 0 && (t.state === 0 || t.state === 1))
        .sort((a, b) => a.taskType - b.taskType
            || (a.taskType === 1 ? 0 : Number(b.state === 1) - Number(a.state === 1))
            || taskPresentation(a).order - taskPresentation(b).order || a.taskId - b.taskId)[0];
}

