/** 武将列表、编队、奖励和配置工具共用的画像资源目录。 */
export const GENERAL_PORTRAIT_DIRECTORY = 'ui/hero';

/** 美术换版统一在画像入口解析，配置表仍保留稳定的武将资源标识。 */
const PORTRAIT_REVISIONS: Record<string, string> = {
    'ui/hero/card_1009': 'ui/hero/card_1009_guard_v2',
    'ui/hero/card_1015': 'ui/hero/card_1015_noble_v2',
    'ui/hero/card_1016': 'ui/hero/card_1016_lord_v2',
    'ui/hero/card_1020': 'ui/hero/card_1020_scholar_v2',
    'ui/hero/card_1027': 'ui/hero/card_1027_strategist_v4',
    'ui/hero/card_1035': 'ui/hero/card_1035_spear_v2',
    'ui/hero/card_1046': 'ui/hero/card_1046_distinct_v2',
    'ui/hero/card_1047': 'ui/hero/card_1047_distinct_v2',
    'ui/hero/card_1048': 'ui/hero/card_1048_distinct_v2',
};

/** Icon 是相对于 resources 的资源路径。 */
export function getGeneralPortraitPath(icon?: string): string {
    if (!icon || !icon.trim()) return '';
    const path = icon.trim().replace(/\/spriteFrame$/i, '').replace(/\.(png|jpe?g|webp)$/i, '');
    return `${PORTRAIT_REVISIONS[path] || path}/spriteFrame`;
}
