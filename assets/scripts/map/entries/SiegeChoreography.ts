export const SIEGE_CYCLE = 3.2;
export const SIEGE_RELEASE = .76;
export const SIEGE_IMPACT_DURATION = .48;
const FRAME_STARTS = [0, .25, .48, .76, .92, 1.18, 1.48, 2.05];
const COMMAND_FRAME_STARTS = [0, .16, .32, .52, .72, 2.16, 2.52, 2.88];

export interface SiegeLaunch { x: number; y: number; index: number; }
export interface SiegeVolley { seconds: number; sources: SiegeLaunch[]; }
export interface SiegeBeat { frame: number; flight: number; impactAge: number; }

/** 主将先举枪下令，保持指向直到两排出手，再收势；与投掷共用攻城时钟。 */
export function siegeCommandFrameAt(seconds: number): number {
    const age = (Number.isFinite(seconds) ? Math.max(0, seconds) : 0) % SIEGE_CYCLE;
    let frame = 0;
    for (let i = 1; i < COMMAND_FRAME_STARTS.length; i++) if (age >= COMMAND_FRAME_STARTS[i]) frame = i;
    return frame;
}

/** 两排错峰投掷；新到达的部队先站稳，再从准备姿势开始。 */
export function siegeBeat(seconds: number, index = 0, distance = 0): SiegeBeat {
    const soldier = Math.max(0, Math.floor(index));
    const delay = soldier % 3 * .24 + Math.floor(soldier / 3) * .9;
    const elapsed = (Number.isFinite(seconds) ? Math.max(0, seconds) : 0) - delay;
    if (elapsed < 0) return { frame: 0, flight: -1, impactAge: -1 };
    const age = elapsed % SIEGE_CYCLE;
    const travel = Math.max(.36, Math.min(.78, .32 + Math.max(0, distance) * .0012));
    let frame = 0;
    for (let i = 1; i < FRAME_STARTS.length; i++) if (age >= FRAME_STARTS[i]) frame = i;
    const flight = (age - SIEGE_RELEASE) / travel;
    const impactAge = age - SIEGE_RELEASE - travel;
    return { frame, flight: flight >= 0 && flight < 1 ? flight : -1,
        impactAge: impactAge >= 0 && impactAge < SIEGE_IMPACT_DURATION ? impactAge : -1 };
}

/** 弹体与命中共用同一个落点，不用独立循环伪造墙面受击。 */
export function siegeProjectile(from: { x: number; y: number }, to: { x: number; y: number }, t: number) {
    const progress = Math.max(0, Math.min(1, t));
    const dx = to.x - from.x, dy = to.y - from.y;
    const height = Math.max(18, Math.min(58, Math.hypot(dx, dy) * .19));
    return { x: from.x + dx * progress,
        y: from.y + dy * progress + 4 * height * progress * (1 - progress),
        angle: Math.atan2(dy + 4 * height * (1 - 2 * progress), dx) * 180 / Math.PI };
}
