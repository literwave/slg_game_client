import type { FacilityConfig } from './MapUIProxy';

export interface BuildingGoal { type: number; level: number; }
export interface BuildingGraphNode extends BuildingGoal {
    key: string; cfg: FacilityConfig; complete: boolean; goal: boolean;
    rank: number; x: number; y: number;
}
export interface BuildingGraphEdge {
    from: string; to: string; requiredLevel: number; met: boolean;
}
export const buildingGoalKey = (type: number, level: number) => `${type}:${level}`;

/** 每个等级单独作为节点，避免“主城 → 仓库 → 主城”被错误画成循环。 */
export function buildingGoalConditions(cfg: FacilityConfig, target: number): BuildingGoal[] {
    const requirements = target === 1 ? [...cfg.conditions, ...(cfg.upLevels[0]?.conditions || [])]
        : [{ type: cfg.type, level: target - 1 }, ...(cfg.upLevels[target - 1]?.conditions || [])];
    const unique = new Map<number, number>();
    requirements.forEach(c => {
        if (c.type > 0 && c.level > 0) unique.set(c.type, Math.max(unique.get(c.type) || 0, c.level));
    });
    return Array.from(unique, ([type, level]) => ({ type, level }));
}

export function buildingProgressionGraph(configs: FacilityConfig[], levels: ReadonlyMap<number, number>,
    category = 0, selected?: BuildingGoal) {
    const byType = new Map(configs.map(cfg => [cfg.type, cfg]));
    const nodes = new Map<string, BuildingGraphNode>(), edges: BuildingGraphEdge[] = [];
    const visiting = new Set<string>(), expanded = new Set<string>();
    const categoryMatches = (cfg: FacilityConfig) => category === 0 ||
        (category === 1 ? cfg.category === 2 : category === 2 ? cfg.category === 3 : cfg.category !== 2 && cfg.category !== 3);
    const add = (type: number, target: number, goal = false): string | null => {
        const cfg = byType.get(type);
        if (!cfg || target < 1 || !cfg.upLevels[target - 1]) return null;
        const current = levels.get(type) || 0;
        // 已满足的同一建筑前置共用当前等级节点，避免满级主城重复出现十几次。
        const level = current >= target ? current : target, key = buildingGoalKey(type, level);
        if (!nodes.has(key)) nodes.set(key, { key, cfg, type, level, complete: current >= target, goal, rank: 0, x: 0, y: 0 });
        const node = nodes.get(key); node.goal ||= goal;
        if (node.complete || expanded.has(key) || visiting.has(key)) return key;
        visiting.add(key);
        for (const condition of buildingGoalConditions(cfg, level)) {
            // 实际下一等级的自身前一级已体现在卡片内，不再复制一张已完成卡片。
            if (condition.type === type && current >= condition.level) continue;
            const from = add(condition.type, condition.level);
            if (!from || from === key || visiting.has(from)) continue;
            edges.push({ from, to: key, requiredLevel: condition.level, met: (levels.get(condition.type) || 0) >= condition.level });
        }
        visiting.delete(key); expanded.add(key);
        return key;
    };
    for (const cfg of configs.filter(categoryMatches)) {
        const current = levels.get(cfg.type) || 0;
        add(cfg.type, cfg.upLevels[current] ? current + 1 : Math.max(1, current), true);
    }
    if (selected) add(selected.type, selected.level, true);
    const incoming = new Map<string, string[]>();
    edges.forEach(edge => { if (!incoming.has(edge.to)) incoming.set(edge.to, []); incoming.get(edge.to).push(edge.from); });
    const ranked = new Set<string>();
    const rank = (key: string): number => {
        if (ranked.has(key)) return nodes.get(key).rank;
        ranked.add(key);
        nodes.get(key).rank = Math.max(0, ...(incoming.get(key) || []).map(from => rank(from) + 1));
        return nodes.get(key).rank;
    };
    nodes.forEach(node => rank(node.key));
    const linked = new Set<string>();
    edges.forEach(edge => { linked.add(edge.from); linked.add(edge.to); });
    const archiveRank = Math.max(0, ...Array.from(nodes.values(), node => node.rank)) + 1;
    nodes.forEach(node => { if (node.complete && !linked.has(node.key)) node.rank = archiveRank; });
    return { nodes: Array.from(nodes.values()), edges };
}

/** 同层多列、窄屏换行；连接线从列间空隙绕行，不穿过建筑卡片。 */
export function layoutBuildingGraph(nodes: BuildingGraphNode[], viewportWidth: number) {
    const width = Math.max(240, viewportWidth), gap = 36, padding = 28;
    const columns = Math.max(1, Math.min(3, Math.floor((width - padding * 2 + gap) / (160 + gap))));
    const cardWidth = Math.min(208, (width - padding * 2 - (columns - 1) * gap) / columns);
    const cardHeight = 100, rowGap = 50, rows: Array<{ rank: number; y: number; label: string }> = [];
    const ranks = Array.from(new Set(nodes.map(node => node.rank))).sort((a, b) => a - b);
    let top = 12;
    for (const rank of ranks) {
        const group = nodes.filter(node => node.rank === rank).sort((a, b) => a.type - b.type || a.level - b.level);
        rows.push({ rank, y: -top - 8, label: group.every(node => node.complete) ? '已完成建设'
            : rank === 0 ? '建设起点' : `第 ${rank} 层` });
        top += 32;
        group.forEach((node, i) => {
            const row = Math.floor(i / columns), inRow = Math.min(columns, group.length - row * columns);
            node.x = (i % columns - (inRow - 1) / 2) * (cardWidth + gap);
            node.y = -top - cardHeight / 2 - row * (cardHeight + rowGap);
        });
        top += Math.ceil(group.length / columns) * (cardHeight + rowGap);
    }
    return { width, height: Math.max(160, top - rowGap + 24), cardWidth, cardHeight, gap, columns, rows };
}

/** 只高亮选中目标的真实上游依赖和直接后续，筛选不丢失跨类别前置。 */
export function buildingGraphFocus(selectedKey: string, edges: BuildingGraphEdge[]) {
    const ancestors = new Set<string>([selectedKey]), links = new Set<BuildingGraphEdge>();
    const visit = (key: string) => edges.filter(edge => edge.to === key).forEach(edge => {
        links.add(edge);
        if (!ancestors.has(edge.from)) { ancestors.add(edge.from); visit(edge.from); }
    });
    visit(selectedKey);
    const descendants = new Set<string>();
    edges.filter(edge => edge.from === selectedKey).forEach(edge => { links.add(edge); descendants.add(edge.to); });
    return { ancestors, descendants, links };
}
