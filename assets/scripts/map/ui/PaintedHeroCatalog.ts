/** 战场武将外形索引。每名武将使用独立分层原画，只加载本场参战角色。 */
export type PaintedHeroWeapon = 'halberd' | 'spear' | 'sabre' | 'bow' | 'sword' | 'staff' | 'fan' | 'tablet' | 'whisk' | 'baton' | 'scroll';
export type PaintedTroopWeapon = 'spear' | 'sabre' | 'bow' | 'crossbow';
export interface PaintedHeroProfile {
    id: number; name: string; asset: string; weapon: PaintedHeroWeapon; infantry: PaintedTroopWeapon;
    weaponHeight: number; weaponAnchor: [number, number]; weaponRotation: number;
    headHeight: number; headAnchor: [number, number]; breadth: number; caster: boolean;
}
type HeroEntry = [string, PaintedHeroWeapon, PaintedTroopWeapon, number, boolean?, number?];
const HEROES: Record<number, HeroEntry> = {
    1001: ['吕布', 'halberd', 'spear', 143],
    1002: ['刘协', 'tablet', 'sabre', 66, true],
    1003: ['张让', 'whisk', 'sabre', 90, true],
    1004: ['貂蝉', 'fan', 'sabre', 53, true],
    1005: ['何太后', 'tablet', 'bow', 65, true],
    1006: ['黄盖', 'baton', 'sabre', 86, false, 1.09],
    1007: ['董卓', 'sabre', 'spear', 96, false, 1.15],
    1008: ['张角', 'staff', 'crossbow', 133, true],
    1009: ['董卓SP', 'halberd', 'sabre', 135, false, 1.16],
    1010: ['吕布SP', 'halberd', 'spear', 143],
    1011: ['贾诩', 'scroll', 'crossbow', 54, true],
    1012: ['步练师', 'fan', 'bow', 50, true],
    1013: ['赵云', 'spear', 'spear', 143],
    1014: ['吕蒙', 'sword', 'sabre', 70],
    1015: ['甄姬', 'fan', 'bow', 53, true],
    1016: ['刘备SP', 'sword', 'sabre', 91, true],
    1017: ['诸葛亮', 'fan', 'crossbow', 56, true],
    1018: ['陆逊', 'baton', 'bow', 66, true],
    1019: ['马云禄', 'spear', 'spear', 137],
    1020: ['黄月英', 'fan', 'crossbow', 54, true],
    1021: ['马超', 'spear', 'spear', 143],
    1022: ['曹操', 'sword', 'sabre', 94, true],
    1023: ['关羽', 'halberd', 'sabre', 145, false, 1.08],
    1024: ['张飞', 'spear', 'spear', 146, false, 1.15],
    1025: ['周瑜', 'fan', 'bow', 55, true],
    1026: ['孙尚香', 'bow', 'bow', 90],
};
export const PAINTED_HERO_IDS = Object.keys(HEROES).map(Number);
const profiles = new Map<number, PaintedHeroProfile>();
export function paintedHero(id: number): PaintedHeroProfile | null {
    id = Number(id);
    if (profiles.has(id)) return profiles.get(id);
    const entry = HEROES[id]; if (!entry) return null;
    const [name, weapon, infantry, weaponHeight, caster = false, breadth = 1] = entry;
    const result: PaintedHeroProfile = { id, name, weapon, infantry, weaponHeight, caster, breadth,
        asset: id === 1001 ? 'motion_lubu' : `heroes/hero_${id}`,
        headHeight: [1008, 1011, 1017, 1023].indexOf(id)>=0 ? 52 : 46,
        headAnchor: [.70, .20], weaponAnchor: [.5, weapon === 'fan' ? .12 : .25], weaponRotation: 0 };
    // 吕蒙以低位持剑发令，保留剑穗自然下垂的方向，不把整把剑翻到面前。
    if (id === 1001) { result.weaponAnchor = [.40, .30]; result.headAnchor = [.73, .20]; }
    if (id === 1014) result.weaponAnchor = [.70, .84];
    if (weapon === 'bow') result.weaponAnchor = [.48, .50];
    profiles.set(id, result); return result;
}
