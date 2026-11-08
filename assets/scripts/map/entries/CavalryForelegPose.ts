/** Pixel coordinates throughout: x points right and y points down. */
export interface ForelegPoint { x: number; y: number; }

export interface CavalryForelegRig {
    shoulder: ForelegPoint;
    restHoof: ForelegPoint;
    upperLength: number;
    lowerLength: number;
    /** Total backward foot travel during stance, projected into screen space. */
    strideVector: ForelegPoint;
    lift: number;
    /** Fixed IK branch. For a downward leg, -1 bends right and +1 bends left. */
    bendSign?: 1 | -1;
    /** Visible lower limb articulation; its upper attachment slides behind the torso. */
    supportFlexDegrees?: number;
    swingFlexDegrees?: number;
}

export interface CavalryForelegPose {
    shoulder: ForelegPoint;
    knee: ForelegPoint;
    hoof: ForelegPoint;
    grounded: boolean;
    /** The hoof sprite does not inherit the lower leg's rotation. */
    hoofAngle: 0;
}

export const CAVALRY_FORELEG_STANCE = .64;

/**
 * Sample one leg; sample its partner at phase + .5 so at least one is grounded.
 * Drive phase from travelled distance. For a planted foot, the body travels
 * strideVector / CAVALRY_FORELEG_STANCE per complete cycle.
 * Stopping restores restHoof. Unreachable targets are clamped, never stretched.
 */
export function solveCavalryForelegPose(
    phase: number, rig: CavalryForelegRig, moving = true,
): CavalryForelegPose {
    const { restHoof, strideVector, upperLength, lowerLength } = rig;
    let shoulder = rig.shoulder;
    if (![phase, shoulder.x, shoulder.y, restHoof.x, restHoof.y,
        strideVector.x, strideVector.y, upperLength, lowerLength, rig.lift].every(Number.isFinite)
        || upperLength <= 0 || lowerLength <= 0 || rig.lift < 0
        || (rig.bendSign !== undefined && rig.bendSign !== 1 && rig.bendSign !== -1)
        || [rig.supportFlexDegrees, rig.swingFlexDegrees].some(value => value !== undefined
            && (!Number.isFinite(value) || value <= 0 || value >= 90))) {
        throw new RangeError('Foreleg rig requires finite coordinates, positive lengths and non-negative lift');
    }

    const p = ((phase % 1) + 1) % 1;
    let travel = 0, lift = 0, swingWeight = 0;
    const grounded = !moving || p < CAVALRY_FORELEG_STANCE;
    if (moving) {
        if (grounded) {
            travel = .5 - p / CAVALRY_FORELEG_STANCE;
        } else {
            const swing = 1 - CAVALRY_FORELEG_STANCE;
            const t = (p - CAVALRY_FORELEG_STANCE) / swing;
            const t2 = t * t, t3 = t2 * t;
            // Hermite endpoint velocities match stance: no velocity snap on wrap/contact.
            travel = 3 * t2 - 2 * t3 - .5
                - swing / CAVALRY_FORELEG_STANCE * (2 * t3 - 3 * t2 + t);
            swingWeight = 16 * t2 * (1 - t) * (1 - t);
            lift = rig.lift * swingWeight;
        }
    }
    const targetX = restHoof.x + strideVector.x * travel;
    const targetY = restHoof.y + strideVector.y * travel - lift;
    if (rig.supportFlexDegrees !== undefined) {
        const flex = (rig.supportFlexDegrees + ((rig.swingFlexDegrees ?? rig.supportFlexDegrees)
            - rig.supportFlexDegrees) * swingWeight) * Math.PI / 180;
        const reachSquared = upperLength * upperLength + lowerLength * lowerLength
            + 2 * upperLength * lowerLength * Math.cos(flex);
        const horizontal = targetX - shoulder.x;
        // The hidden upper arm/haunch absorbs perspective shortening. The visible
        // knee stays nearly straight while supporting, with no stretching or foot slide.
        shoulder = { x: shoulder.x, y: targetY - Math.sqrt(Math.max(0, reachSquared - horizontal * horizontal)) };
    }
    let dx = targetX - shoulder.x, dy = targetY - shoulder.y;
    const requestedDistance = Math.hypot(dx, dy);
    if (requestedDistance > 0) {
        dx /= requestedDistance;
        dy /= requestedDistance;
    } else {
        // A collapsed target retains the rig's rest direction instead of flipping its knee.
        dx = restHoof.x - shoulder.x;
        dy = restHoof.y - shoulder.y;
        const restDistance = Math.hypot(dx, dy);
        if (restDistance > 0) { dx /= restDistance; dy /= restDistance; }
        else { dx = 0; dy = 1; }
    }
    const margin = Math.min(upperLength, lowerLength) * .000001;
    const distance = Math.max(Math.abs(upperLength - lowerLength) + margin,
        Math.min(upperLength + lowerLength - margin, requestedDistance));
    const along = (upperLength * upperLength - lowerLength * lowerLength
        + distance * distance) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, upperLength * upperLength - along * along))
        * (rig.bendSign ?? -1);
    return {
        shoulder: { x: shoulder.x, y: shoulder.y },
        knee: { x: shoulder.x + dx * along - dy * bend,
            y: shoulder.y + dy * along + dx * bend },
        hoof: { x: shoulder.x + dx * distance, y: shoulder.y + dy * distance },
        grounded,
        hoofAngle: 0,
    };
}
