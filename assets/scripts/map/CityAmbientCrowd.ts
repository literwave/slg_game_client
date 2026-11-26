import type { AmbientPoint } from './CityAmbientRoutes';

export const AMBIENT_BODY_GAP = .0105;
export const AMBIENT_ROAD_MARGIN = .0125;
export const AMBIENT_LANE_OFFSET = .0064;
const METRIC_Y = .625;
interface Body { u: number; v: number; du: number; dv: number; walking: boolean; }
type Floor = (index: number, u: number, v: number) => boolean;
const ANGLES = [0, .35, -.35, .7, -.7, 1.05, -1.05, 1.4, -1.4, 1.75, -1.75, 2.1, -2.1, 2.5, -2.5, Math.PI];
const TURNS = ANGLES.map(angle => [Math.cos(angle), Math.sin(angle)]);

/** 少量城内装饰角色的局部避让。连续圆形扫掠防穿透，路面约束防止侧移进建筑。 */
export class CityAmbientCrowd {
    private readonly blocked: number[];
    private readonly side: number[];
    private readonly detours: AmbientPoint[][];
    private readonly destinations: (AmbientPoint | undefined)[];
    private readonly retry: number[];
    private readonly yields: ({ point: AmbientPoint; hold: number; remaining: number } | undefined)[];
    constructor(private readonly bodies: Body[], private readonly standing: readonly AmbientPoint[], private readonly floor: Floor) {
        this.blocked = bodies.map(() => 0);
        this.side = bodies.map(() => 0);
        this.detours = bodies.map(() => []);
        this.destinations = bodies.map(() => undefined);
        this.retry = bodies.map(() => 0);
        this.yields = bodies.map(() => undefined);
    }

    stop(index: number): void {
        this.yields[index] = undefined; this.detours[index].length = 0;
        this.destinations[index] = undefined; this.blocked[index] = 0; this.retry[index] = 0; this.side[index] = 0;
    }

    private free(index: number, u: number, v: number, count: number, dynamic: boolean, reserved: readonly AmbientPoint[]): boolean {
        if (!this.floor(index, u, v)) return false;
        const gap2 = AMBIENT_BODY_GAP * AMBIENT_BODY_GAP;
        if (dynamic) for (let j = 0; j < count; j++) {
            if (j === index) continue;
            const other = this.bodies[j], dx = u - other.u, dy = (v - other.v) * METRIC_Y;
            if (dx * dx + dy * dy < gap2) return false;
        }
        for (const p of this.standing) {
            const dx = u - p[0], dy = (v - p[1]) * METRIC_Y;
            if (dx * dx + dy * dy < gap2) return false;
        }
        for (const p of reserved) {
            const dx = u - p[0], dy = (v - p[1]) * METRIC_Y;
            if (dx * dx + dy * dy < gap2 * 1.1) return false;
        }
        return true;
    }

    /** 仅用于初次放置和静态路标校正；运行中绝不以位置纠正把人物推开。 */
    placement(index: number, u: number, v: number, count = 0, dynamic = false, reserved: readonly AmbientPoint[] = [], reachable = false): AmbientPoint {
        const valid = (x: number, y: number): boolean => {
            if (!this.free(index, x, y, count, dynamic, reserved)) return false;
            const s = this.bodies[index], dx = x - s.u, dy = (y - s.v) * METRIC_Y;
            return !reachable || Math.hypot(dx, dy) < 1e-8 || this.limit(index, dx, dy) > .999;
        };
        if (valid(u, v)) return [u, v];
        for (let ring = 1; ring <= 20; ring++) for (let a = 0; a < 24; a++) {
            const angle = a * Math.PI / 12, radius = ring * .0015;
            const x = u + Math.cos(angle) * radius, y = v + Math.sin(angle) * radius / METRIC_Y;
            if (valid(x, y)) return [x, y];
        }
        // 拥挤时就地警戒，不能为了选岗位穿人、瞬移或让整个装饰组件报错。
        if (reachable) return [this.bodies[index].u, this.bodies[index].v];
        throw new Error('城内人物站位没有足够的通行空间');
    }

    private limit(index: number, dx: number, dy: number, u = this.bodies[index].u, v = this.bodies[index].v): number {
        const length2 = dx * dx + dy * dy;
        if (length2 < 1e-16) return 0;
        let limit = 1;
        const constrain = (otherU: number, otherV: number): void => {
            const x = u - otherU, y = (v - otherV) * METRIC_Y;
            const dot = x * dx + y * dy, c = x * x + y * y - AMBIENT_BODY_GAP * AMBIENT_BODY_GAP;
            if (dot >= 0) return; // 已在分离的方向上，不能反过来把两人锁死。
            if (c < -1e-9) { limit = 0; return; }
            const discriminant = dot * dot - length2 * c;
            if (discriminant < 0) return;
            const hit = (-dot - Math.sqrt(discriminant)) / length2;
            if (hit >= 0 && hit <= limit) limit = Math.max(0, hit - .001);
        };
        for (let j = 0; j < this.bodies.length; j++) if (j !== index) constrain(this.bodies[j].u, this.bodies[j].v);
        for (const point of this.standing) constrain(point[0], point[1]);
        // 检查整段移动，避免跨过弯路之间的空隙再落回另一条路。
        for (let t = limit; t > 0; t -= .2) {
            if (!this.floor(index, u + dx * t, v + dy * t / METRIC_Y)) limit = Math.max(0, t - .2);
        }
        return limit;
    }

    /** 只在持续受阻时搜索附近路面；有界搜索为临时让路，不是整城逐帧寻路。 */
    private detour(index: number, target: AmbientPoint): AmbientPoint[] {
        const body = this.bodies[index], step = .0035, radius = 16, width = radius * 2 + 1;
        const total = width * width, start = radius * width + radius;
        const costs = new Float64Array(total).fill(Infinity), parents = new Int32Array(total).fill(-1);
        const closed = new Uint8Array(total), open = [start]; costs[start] = 0;
        const point = (id: number): AmbientPoint => [body.u + (id % width - radius) * step,
            body.v + (Math.floor(id / width) - radius) * step / METRIC_Y];
        const heuristic = (p: AmbientPoint): number => Math.hypot(p[0] - target[0], (p[1] - target[1]) * METRIC_Y);
        let end = -1, bestDistance = heuristic([body.u, body.v]) - .004, reached = false;
        while (open.length) {
            let best = 0, score = Infinity;
            for (let i = 0; i < open.length; i++) {
                const value = costs[open[i]] + heuristic(point(open[i]));
                if (value < score) { score = value; best = i; }
            }
            const id = open[best]; open[best] = open[open.length - 1]; open.pop();
            if (closed[id]) continue; closed[id] = 1;
            const p = point(id), distance = heuristic(p);
            if (distance < bestDistance) { bestDistance = distance; end = id; }
            if (distance < step * 1.5 && this.limit(index, target[0] - p[0], (target[1] - p[1]) * METRIC_Y, p[0], p[1]) > .999) {
                end = id; reached = true; break;
            }
            const x = id % width, y = Math.floor(id / width);
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= width) continue;
                const next = id + dx + dy * width;
                if (closed[next]) continue;
                const cost = costs[id] + Math.hypot(dx, dy) * step;
                if (cost >= costs[next] || this.limit(index, dx * step, dy * step, p[0], p[1]) < .999) continue;
                costs[next] = cost; parents[next] = id; open.push(next);
            }
        }
        if (end < 0 || end === start) return [];
        const result: AmbientPoint[] = reached ? [target] : [];
        for (let id = end; id !== start && id >= 0; id = parents[id]) result.push(point(id));
        return result.reverse();
    }

    /** 停岗者也能主动走开半步，走完后短暂停留，给对方完整通过的时间。 */
    yield(index: number, budget: number, dt: number): boolean {
        const request = this.yields[index];
        if (!request) return false;
        request.remaining -= dt;
        const s = this.bodies[index];
        if (Math.hypot(s.u - request.point[0], (s.v - request.point[1]) * METRIC_Y) > .0006) {
            this.move(index, request.point, budget, dt, false);
        } else request.hold -= dt;
        if (request.hold <= 0 || request.remaining <= 0) this.yields[index] = undefined;
        return true;
    }

    private askToYield(index: number, target: AmbientPoint): void {
        const s = this.bodies[index], dx = target[0] - s.u, dy = (target[1] - s.v) * METRIC_Y;
        const length = Math.hypot(dx, dy);
        if (length < .001) return;
        const nx = dx / length, ny = dy / length;
        for (let j = 0; j < this.bodies.length; j++) {
            if (j === index || this.yields[j]) continue;
            const other = this.bodies[j], x = other.u - s.u, y = (other.v - s.v) * METRIC_Y;
            if (other.walking || x * nx + y * ny < 0 || Math.hypot(x, y) > AMBIENT_BODY_GAP * 1.8) continue;
            let best = Math.abs(x * ny - y * nx) + .003, point: AmbientPoint | undefined;
            for (const side of [1, -1]) for (const stride of [.004, .008, .012]) {
                const u = other.u - ny * stride * side, v = other.v + nx * stride * side / METRIC_Y;
                const clearance = Math.abs((u - s.u) * ny - (v - s.v) * METRIC_Y * nx);
                if (clearance <= best || !this.free(j, u, v, this.bodies.length, true, [])) continue;
                if (this.limit(j, u - other.u, (v - other.v) * METRIC_Y) < .999) continue;
                best = clearance; point = [u, v];
            }
            if (point) this.yields[j] = { point, hold: 1.3, remaining: 3 };
        }
    }

    move(index: number, target: AmbientPoint, budget: number, dt: number, requestYield = true): number {
        if (budget <= 0 || dt <= 0) return 0;
        if (requestYield && this.blocked[index] > .35) this.askToYield(index, target);
        this.retry[index] -= dt;
        const previous = this.destinations[index];
        if (!previous || Math.hypot(target[0] - previous[0], (target[1] - previous[1]) * METRIC_Y) > .004) {
            this.detours[index].length = 0; this.destinations[index] = target;
        }
        if (this.blocked[index] > .65 && this.retry[index] <= 0) {
            this.detours[index] = this.detour(index, target); this.retry[index] = 1.5;
        }
        const route = this.detours[index], body = this.bodies[index];
        while (route.length && Math.hypot(route[0][0] - body.u, (route[0][1] - body.v) * METRIC_Y) < .0006) route.shift();
        if (route.length) target = route[0];
        const s = this.bodies[index], x = target[0] - s.u, y = (target[1] - s.v) * METRIC_Y, distance = Math.hypot(x, y);
        if (distance < 1e-8 || budget <= 0) return 0;
        const length = Math.min(budget, distance), nx = x / distance, ny = y / distance;
        let best = -Infinity, bestX = 0, bestY = 0, moved = 0, chosenSide = 0;
        const direct = this.limit(index, nx * length, ny * length);
        if (direct > .99) this.side[index] = 0;
        for (let k = 0; k < TURNS.length; k++) {
            const [cos, sin] = TURNS[k];
            // 平常优先前进/侧让，持续受阻后才允许短暂后退给路口腾位置。
            if (cos < -.1 && this.blocked[index] < .65) continue;
            const dx = (nx * cos - ny * sin) * length, dy = (ny * cos + nx * sin) * length;
            const fraction = this.limit(index, dx, dy);
            if (fraction < .02) continue;
            let score = fraction * (cos + .22) - Math.abs(ANGLES[k]) * .025 + sin * .015;
            if (this.blocked[index] > .65) score += fraction * .55;
            if (sin * this.side[index] < 0) score -= .3;
            if (score <= best) continue;
            best = score; bestX = dx * fraction; bestY = dy * fraction; moved = length * fraction;
            chosenSide = Math.sign(sin);
        }
        if (moved > 1e-8) {
            s.u += bestX; s.v += bestY / METRIC_Y;
            s.du = bestX; s.dv = bestY / METRIC_Y; s.walking = true;
            if (direct < .99 && !this.side[index]) this.side[index] = chosenSide;
        }
        const forward = bestX * nx + bestY * ny;
        this.blocked[index] = forward < budget * .2 ? this.blocked[index] + dt : Math.max(0, this.blocked[index] - dt * 2);
        return moved;
    }
}
