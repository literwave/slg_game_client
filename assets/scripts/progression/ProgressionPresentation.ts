import ConfigManager from '../core/ConfigManager';
import { TaskInfo } from './ProgressionCommand';
import { itemGlyph, itemIconPath } from '../common/ItemPresentation';
import { normalizeRewardQuality } from '../common/RewardQuality';
import { getConfigIconPath } from '../utils/ConfigIcon';

export interface RewardPreview { rewardType: number; itemId: number; itemCount: number; }
export interface TaskCondInfo { type: number; bid?: number; item_id?: number; }
export interface GuideStepConfig {
    Id: number;
    TaskId: number;
    CondType: number;
    Order: number;
    PreCheck: string;
    Speaker: string;
    Portrait: string;
    Dialog: string;
    Jump: number;
    TargetUI: string;
    Force: number;
}

/**
 * 与 game_common/tsv/Guide.tsv 完全一致的内置回退配置。
 * 当 ConfigManager 中已加载 Guide.json 时优先使用配置表数据；尚未同步子模块时自动回退。
 */
export const DEFAULT_GUIDE_STEPS: GuideStepConfig[] = [
    {
        Id: 1, TaskId: 1001, CondType: 1, Order: 1, PreCheck: 'claim_ready:panel_closed',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '主公，这是第一道军令。轻触此处，领取初入乱世的军资。',
        Jump: 0, TargetUI: 'HudRoot/TaskTracker/TaskAction', Force: 1,
    },
    {
        Id: 2, TaskId: 1002, CondType: 2, Order: 2, PreCheck: 'panel_closed',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '根基未稳，请先入【内城】，修筑主城以固城防。',
        Jump: 1, TargetUI: 'HudRoot/BottomNav/InnerCityButton', Force: 1,
    },
    {
        Id: 3, TaskId: 1002, CondType: 2, Order: 3, PreCheck: 'panel_city_build',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '点击【升级】，将主城提升至 2 级。',
        Jump: 0, TargetUI: 'content/CityBuildingPanel/SafeContent/CityBuildingWindow/BuildingDetail/BuildAction', Force: 1,
    },
    {
        Id: 4, TaskId: 1002, CondType: 2, Order: 4, PreCheck: 'claim_ready:panel_city_build',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '主城已成！点击此处关闭内城，回大地图领取军令赏赐。',
        Jump: 0, TargetUI: 'content/CityBuildingPanel/SafeContent/CityBuildingWindow/Close', Force: 1,
    },
    {
        Id: 5, TaskId: 1002, CondType: 2, Order: 5, PreCheck: 'claim_ready:panel_closed',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '营建根基已成，轻触军令领取赏赐。',
        Jump: 0, TargetUI: 'HudRoot/TaskTracker/TaskAction', Force: 1,
    },
    {
        Id: 6, TaskId: 1003, CondType: 4, Order: 6, PreCheck: 'panel_closed',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '千军易得，一将难求。请往【点将】招揽良将。',
        Jump: 2, TargetUI: 'HudRoot/BottomNav/DrawButton', Force: 1,
    },
    {
        Id: 7, TaskId: 1003, CondType: 4, Order: 7, PreCheck: 'panel_draw',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '轻触【点将一次】，看看哪位良将应召而来。',
        Jump: 0, TargetUI: 'content/Draw/SafeContent/DianJiangWindow/Draw_1', Force: 1,
    },
    {
        Id: 8, TaskId: 1003, CondType: 4, Order: 8, PreCheck: 'claim_ready:panel_draw',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '点将已完成！点击关闭返回大地图，领取军令与随军良将。',
        Jump: 0, TargetUI: 'content/Draw/SafeContent/DianJiangWindow/Close', Force: 1,
    },
    {
        Id: 9, TaskId: 1003, CondType: 4, Order: 9, PreCheck: 'claim_ready:panel_closed',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '轻触军令，领取点将赏赐与新投效的良将。',
        Jump: 0, TargetUI: 'HudRoot/TaskTracker/TaskAction', Force: 1,
    },
    {
        Id: 10, TaskId: 1004, CondType: 3, Order: 10, PreCheck: 'claim_ready:panel_closed',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '良将已投效！轻触军令，招降无双猛将【吕布】入帐！',
        Jump: 0, TargetUI: 'HudRoot/TaskTracker/TaskAction', Force: 1,
    },
    {
        Id: 11, TaskId: 1004, CondType: 3, Order: 11, PreCheck: 'panel_closed',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '还差一位良将，请往【点将】继续招纳贤才。',
        Jump: 2, TargetUI: 'HudRoot/BottomNav/DrawButton', Force: 1,
    },
    {
        Id: 12, TaskId: 1004, CondType: 3, Order: 12, PreCheck: 'panel_draw',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '点击【点将一次】，扩充麾下武将阵容。',
        Jump: 0, TargetUI: 'content/Draw/SafeContent/DianJiangWindow/Draw_1', Force: 1,
    },
    {
        Id: 13, TaskId: 1004, CondType: 3, Order: 13, PreCheck: 'claim_ready:panel_draw',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '良将已齐！点击关闭返回大地图领取赏赐。',
        Jump: 0, TargetUI: 'content/Draw/SafeContent/DianJiangWindow/Close', Force: 1,
    },
    {
        Id: 14, TaskId: 1005, CondType: 7, Order: 14, PreCheck: 'need_troop_hero:panel_closed',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '兵马出征前需先委任主将。轻触军令，进入部队编成。',
        Jump: 6, TargetUI: 'HudRoot/TaskTracker/TaskAction', Force: 1,
    },
    {
        Id: 15, TaskId: 1005, CondType: 7, Order: 15, PreCheck: 'need_troop_hero:panel_army_setting',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '轻触【主将】空位，委任猛将【吕布】上阵统军！',
        Jump: 0, TargetUI: 'content/CityArmySetting/generalLayer/0', Force: 1,
    },
    {
        Id: 16, TaskId: 1005, CondType: 7, Order: 16, PreCheck: 'need_troop_soldier:panel_closed',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '将领已就位，尚缺兵马。轻触军令前往补兵。',
        Jump: 7, TargetUI: 'HudRoot/TaskTracker/TaskAction', Force: 1,
    },
    {
        Id: 17, TaskId: 1005, CondType: 7, Order: 17, PreCheck: 'need_troop_soldier:panel_army_setting:unallocated',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '点击【快速分兵】，将城中预备兵配给上阵将领。',
        Jump: 0, TargetUI: 'content/CityArmySetting/conscriptNode/btnQuick', Force: 1,
    },
    {
        Id: 18, TaskId: 1005, CondType: 7, Order: 18, PreCheck: 'need_troop_soldier:panel_army_setting:allocated',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '兵力已配妥，点击【确认】完成补兵。',
        Jump: 0, TargetUI: 'content/CityArmySetting/conscriptNode/btnSure', Force: 1,
    },
    {
        Id: 19, TaskId: 1005, CondType: 7, Order: 19, PreCheck: 'troop_ready:panel_army_setting',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '将士已备！点击关闭返回大地图，准备出征。',
        Jump: 0, TargetUI: 'content/CityArmySetting/btnClose', Force: 1,
    },
    {
        Id: 20, TaskId: 1005, CondType: 7, Order: 20, PreCheck: 'troop_ready:panel_closed',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '轻触军令，定位城外低级资源地，派出首支大军！',
        Jump: 3, TargetUI: 'HudRoot/TaskTracker/TaskAction', Force: 1,
    },
    {
        Id: 21, TaskId: 1005, CondType: 7, Order: 21, PreCheck: 'troop_ready:panel_army_select',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '点击【确认出征】，首战告捷就在眼前！',
        Jump: 0, TargetUI: 'content/ArmySelectNode/bottomNode/PrimaryAction', Force: 1,
    },
    {
        Id: 22, TaskId: 1005, CondType: 7, Order: 22, PreCheck: 'claim_ready:panel_closed',
        Speaker: '军师', Portrait: 'ui/onboarding/guide-advisor',
        Dialog: '大军已发！轻触军令领取赏赐，此后山河便由主公自由征伐。',
        Jump: 0, TargetUI: 'HudRoot/TaskTracker/TaskAction', Force: 1,
    },
];

export function configRows(name: string): any[] {
    const rows = ConfigManager.getInstance().getConfig(name);
    return Array.isArray(rows) ? rows : rows && typeof rows === 'object' ? Object.keys(rows).map(key => rows[key]) : [];
}

export function guideConfigRows(): GuideStepConfig[] {
    const rows = configRows('Guide');
    if (!rows.length) return DEFAULT_GUIDE_STEPS;
    return rows.map(r => ({
        Id: Number(r.Id) || 0,
        TaskId: Number(r.TaskId) || 0,
        CondType: Number(r.CondType) || 0,
        Order: Number(r.Order) || Number(r.Id) || 0,
        PreCheck: String(r.PreCheck || ''),
        Speaker: String(r.Speaker || '郭嘉'),
        Portrait: String(r.Portrait || 'ui/hero/card_1027'),
        Dialog: String(r.Dialog || ''),
        Jump: Number(r.Jump) || 0,
        TargetUI: String(r.TargetUI || ''),
        Force: r.Force === undefined ? 1 : Number(r.Force) || 0,
    })).sort((a, b) => a.Order - b.Order || a.Id - b.Id);
}

/**
 * 按配置 Jump 字段优先；若尚未同步 Jump 字段，则仅当存在 Guide 表或明确请求时才由 resolveTaskJump 推导。
 */
export function resolveTaskJump(jump: number | undefined, cond: TaskCondInfo | undefined, fallbackByCond = false): number {
    const explicit = Number(jump);
    if (Number.isInteger(explicit) && explicit > 0) return explicit;
    if (!fallbackByCond) return 0;
    const type = Number(cond?.type) || 0;
    switch (type) {
        case 2: return 1; // 内城营造
        case 3:
        case 4: return 2; // 点将招募
        case 6: return 4; // 资源地定位
        case 7: return 3; // 出征定位
        case 8: return 5; // 势力战力提升
        default: return 0;
    }
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
export function taskPresentation(task: TaskInfo): {
    name: string; detail: string; target: number; rewards: RewardPreview[];
    order: number; nextId: number; jump: number; cond: TaskCondInfo;
} {
    const table = { 1: 'MainTask', 2: 'DailyTask', 3: 'WeekTask' }[task.taskType];
    const cfg = table && configRows(table).find(row => row.Id === task.taskId);
    const cond: TaskCondInfo = {
        type: Number(cfg?.Cond?.type) || 0,
        bid: cfg?.Cond?.bid !== undefined ? Number(cfg.Cond.bid) : undefined,
        item_id: cfg?.Cond?.item_id !== undefined ? Number(cfg.Cond.item_id) : undefined,
    };
    return {
        name: cfg?.Name || `任务 ${task.taskId}`,
        detail: (cfg?.Desc || '完成目标后领取奖励').replace(/招募武将|招募/g, '点将').replace(/%s/g, String(cfg?.Target ?? '')),
        target: Math.max(1, Number(cfg?.Target) || 1),
        rewards: rewardPreview(cfg?.Reward),
        order: cfg?.Order ?? task.taskId,
        nextId: Math.max(0, Math.trunc(Number(cfg?.NextId) || 0)),
        jump: resolveTaskJump(cfg?.Jump, cond),
        cond,
    };
}

/** 主线按配置顺序推进；主线结束后展示日常/周常，均只选服务端已下发的任务。 */
export function trackedTask(tasks: TaskInfo[]): TaskInfo | undefined {
    return tasks.filter(t => [1, 2, 3].indexOf(t.taskType) >= 0 && (t.state === 0 || t.state === 1))
        .sort((a, b) => a.taskType - b.taskType
            || (a.taskType === 1 ? 0 : Number(b.state === 1) - Number(a.state === 1))
            || taskPresentation(a).order - taskPresentation(b).order || a.taskId - b.taskId)[0];
}
