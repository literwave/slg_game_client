export type SiegePhase = 'guards' | 'wall';
interface Point { x: number; y: number; }

/** 部队到城心的射线与占地外沿相交，输入始终是地面格坐标。 */
export function siegeWallContact(troop: Point, city: Point, radius: number): Point {
    const dx = troop.x - city.x, dy = troop.y - city.y;
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    const edge = Math.max(.5, (Number.isFinite(radius) ? radius : 1) + .42);
    if (distance < .001) return { x: city.x, y: city.y };
    const scale = Math.min(1, edge / distance);
    return { x: city.x + dx * scale, y: city.y + dy * scale };
}

export function siegePhase(city?: { teamLeft: number }): SiegePhase {
    // 未收到城池状态时不凭本地倒计时宣告守军清空。
    return city && city.teamLeft === 0 ? 'wall' : 'guards';
}
