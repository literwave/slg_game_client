import type { GeneralData } from './GeneralProxy';

export interface GeneralRosterFilters {
    camp: string;
    quality: number;
    role: string;
    assigned: 'all' | 'assigned' | 'idle';
    sort: 'default' | 'quality' | 'level' | 'name';
}

export function defaultGeneralFilters(): GeneralRosterFilters {
    return { camp: '', quality: 0, role: '', assigned: 'all', sort: 'default' };
}

export function hasGeneralFilters(filters: GeneralRosterFilters): boolean {
    return !!(filters.camp || filters.quality || filters.role || filters.assigned !== 'all');
}

/** 组合条件只作用于已通过选将资格校验的列表，不改变武将数据或服务器状态。 */
export function filterGenerals(source: readonly GeneralData[], filters: GeneralRosterFilters,
    inTroop: (heroId: number) => boolean): GeneralData[] {
    const result = source.filter(hero => (!filters.camp || hero.config?.campText === filters.camp)
        && (!filters.quality || hero.config?.quality === filters.quality)
        && (!filters.role || hero.config?.heroClass === filters.role)
        && (filters.assigned === 'all' || inTroop(hero.hero_type) === (filters.assigned === 'assigned')));
    // 默认排序保留仓库既有顺序，只将已上阵武将置前；其它排序以用户选择的数值为第一优先级。
    return result.sort((a, b) => {
        if (filters.sort === 'default') return Number(inTroop(b.hero_type)) - Number(inTroop(a.hero_type));
        const quality = (b.config?.quality || 0) - (a.config?.quality || 0);
        const level = (b.level || 0) - (a.level || 0);
        const primary = filters.sort === 'quality' ? quality : filters.sort === 'level' ? level
            : (a.config?.name || '').localeCompare(b.config?.name || '', 'zh-CN');
        return primary || quality || level || (a.config?.sort || 0) - (b.config?.sort || 0) || a.hero_type - b.hero_type;
    });
}

export interface GeneralFilterOption { value: string | number; label: string; }
export type GeneralFilterKey = keyof GeneralRosterFilters;
export type GeneralFilterChoices = Record<GeneralFilterKey, GeneralFilterOption[]>;

export function generalFilterChoices(heroes: readonly GeneralData[]): GeneralFilterChoices {
    const strings = (values: string[], preferred: string[]) => Array.from(new Set(values.filter(Boolean)))
        .sort((a, b) => {
            const ai = preferred.indexOf(a), bi = preferred.indexOf(b);
            return (ai < 0 ? preferred.length : ai) - (bi < 0 ? preferred.length : bi) || a.localeCompare(b, 'zh-CN');
        }).map(value => ({ value, label: value }));
    return {
        camp: [{ value: '', label: '全部阵营' }, ...strings(heroes.map(h => h.config?.campText), ['魏', '蜀', '吴', '群', '汉'])],
        quality: [{ value: 0, label: '全部品质' }, ...Array.from(new Set(heroes.map(h => h.config?.quality).filter(q => q > 0)))
            .sort((a, b) => b - a).map(value => ({ value, label: `${value}品` }))],
        role: [{ value: '', label: '全部定位' }, ...strings(heroes.map(h => h.config?.heroClass), ['坦克', '战士', '刺客', '法师', '辅助'])],
        assigned: [{ value: 'all', label: '全部状态' }, { value: 'assigned', label: '已上阵' }, { value: 'idle', label: '未上阵' }],
        sort: [{ value: 'default', label: '默认排序' }, { value: 'quality', label: '品质优先' },
            { value: 'level', label: '等级优先' }, { value: 'name', label: '名称排序' }],
    };
}

/** 筛选入口只占底栏，卡片区从标题下方开始。 */
export function generalRosterLayout(width: number, height: number, hasConvert = false) {
    const margin = width >= 1000 ? 72 : width >= 640 ? 32 : 16;
    const bodyWidth = Math.max(1, width - margin * 2), controls = hasConvert ? 3 : 2;
    const headerBottom = height / 2 - (width < 640 ? 112 : 94);
    const listTop = headerBottom - 20, listBottom = -height / 2 + 78;
    const buttonWidth = Math.min(144, (bodyWidth - (controls - 1) * 12) / controls);
    return { margin, bodyWidth, headerBottom, listTop, listBottom, buttonWidth, footerY: -height / 2 + 44,
        filterX: -bodyWidth / 2 + buttonWidth / 2,
        listY: (listTop + listBottom) / 2, listHeight: Math.max(1, listTop - listBottom),
    };
}
