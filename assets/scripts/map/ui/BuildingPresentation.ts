import type { FacilityConfig } from './MapUIProxy';

export function buildingPresentation(cfg: FacilityConfig, levels: ReadonlyMap<number, number>,
    configs: FacilityConfig[], resources: Array<{ k: number; v: number }>) {
    const level = levels.get(cfg.type) || 0;
    const next = cfg.upLevels[level];
    const maxed = level > 0 && !next;
    const conditions = (level > 0 ? next?.conditions || [] : cfg.conditions).map(condition => ({
        type: condition.type,
        name: configs.find(item => item.type === condition.type)?.name || '前置建筑',
        level: condition.level,
        currentLevel: levels.get(condition.type) || 0,
        met: (levels.get(condition.type) || 0) >= condition.level,
    }));
    const costs = [
        { id: 1, name: '粮食', icon: 'grain', need: next?.grain || 0 },
        { id: 2, name: '木材', icon: 'wood', need: next?.wood || 0 },
        { id: 3, name: '铁矿', icon: 'iron', need: next?.iron || 0 },
        { id: 4, name: '石料', icon: 'stone', need: next?.stone || 0 },
    ].map(cost => ({ ...cost, have: Number(resources.find(row => Number(row.k) === cost.id)?.v || 0) }));
    const unlocked = conditions.every(condition => condition.met);
    const enough = costs.every(cost => cost.have >= cost.need);
    return { level, maxed, conditions, costs, unlocked, enough,
        canAct: !!next && unlocked && enough,
        status: maxed ? '已达上限' : !unlocked ? '条件未满足' : level > 0 ? '可升级' : '可建造',
        action: maxed ? '已达上限' : !unlocked ? '条件未满足' : !enough ? '资源不足' : level > 0 ? '升级建筑' : '建造建筑' };
}

/** 按真实建造条件分阶段；依赖其他建筑时，追溯其所需的主城等级。 */
export function buildingStages(configs: FacilityConfig[]) {
    const byType = new Map(configs.map(cfg => [cfg.type, cfg]));
    const mainLevel = (type: number, level: number, visiting: Set<string>): number => {
        if (type === 1) return level;
        const key = `${type}:${level}`, cfg = byType.get(type);
        if (!cfg || visiting.has(key)) return 1;
        const path = new Set(visiting); path.add(key);
        const conditions = cfg.conditions.slice();
        for (const up of cfg.upLevels.slice(0, level)) conditions.push(...(up?.conditions || []));
        return Math.max(1, ...conditions.map(c => mainLevel(c.type, c.level, path)));
    };
    const groups = new Map<number, FacilityConfig[]>();
    for (const cfg of configs) {
        const level = cfg.type === 1 ? 1 : mainLevel(cfg.type, 1, new Set());
        if (!groups.has(level)) groups.set(level, []);
        groups.get(level).push(cfg);
    }
    return Array.from(groups, ([level, buildings]) => ({ level, buildings: buildings.sort((a, b) => a.type - b.type) }))
        .sort((a, b) => a.level - b.level);
}

/** 当前建筑继续提升后，哪些建筑的下一步建设会用到它。其他前置仍需单独满足。 */
export function buildingNextUnlocks(type: number, levels: ReadonlyMap<number, number>, configs: FacilityConfig[]) {
    const current = levels.get(type) || 0;
    const result: Array<{ type: number; name: string; targetLevel: number; requiredLevel: number }> = [];
    for (const cfg of configs) {
        const level = levels.get(cfg.type) || 0;
        if (cfg.type === type || !cfg.upLevels[level]) continue;
        const conditions = level > 0 ? cfg.upLevels[level].conditions || [] : cfg.conditions;
        const needed = conditions.find(c => c.type === type && c.level > current);
        if (needed) result.push({ type: cfg.type, name: cfg.name, targetLevel: level + 1, requiredLevel: needed.level });
    }
    return result.sort((a, b) => a.requiredLevel - b.requiredLevel || a.type - b.type);
}

/** Icon 配置优先；未配置时使用项目现有的同类建筑/资源插画。 */
export function buildingArt(cfg: FacilityConfig, level: number): string {
    if (cfg.icon) return cfg.icon.replace(/\.(png|jpg|jpeg)$/i, '').replace(/\/spriteFrame$/, '');
    if (cfg.type === 1) return `ui/world/player_city_lv${Math.max(1, Math.min(30, level || 1))}`;
    const resources: { [key: number]: string } = { 10: 'grain', 11: 'forest', 12: 'iron', 16: 'quarry' };
    if (resources[cfg.type]) return `ui/world/${resources[cfg.type]}_lv${Math.max(1, Math.min(10, level || 1))}`;
    if (cfg.type === 9) return 'ui/world/mountain_pass';
    if (cfg.category === 2 || cfg.type === 14) return 'ui/world/fort';
    return 'ui/world/town';
}
