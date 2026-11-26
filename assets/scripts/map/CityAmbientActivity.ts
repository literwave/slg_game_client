import { TroopStateEnum } from '../config/enum/TroopStateEnum';
import type { AmbientPoint as Point, CityAmbientLayout } from './CityAmbientRoutes';
import { AMBIENT_LANE_OFFSET, AMBIENT_ROAD_MARGIN, CityAmbientCrowd } from './CityAmbientCrowd';
export { CITY_AMBIENT_LAYOUTS } from './CityAmbientRoutes';
export type { CityAmbientLayout } from './CityAmbientRoutes';

export type AmbientMode = 'peace' | 'alert' | 'withdraw' | 'return';
export type AmbientDuty = 'drill' | 'sentry' | 'patrol' | 'roam';
export interface AmbientSoldier { duty: AmbientDuty; u: number; v: number; du: number; dv: number; walking: boolean; guard: boolean; alpha: number; }
interface Source { troopState?: number; targetId?: number | string; targetPos?: { x: number; y: number }; }
interface Anchor { edge: number; t: number; }
interface PatrolRoute { nodes: number[]; edges: number[]; }
interface Walker {
    edge: number; from: number; to: number; district: number; wait: number; speed: number; random: number;
    duty: Exclude<AmbientDuty, 'drill'>; home: Point; facing: Point;
    route?: PatrolRoute; routeCursor: number; routeStep: number;
}
interface Journey { points: Point[]; cursor: number; }
interface Road { a: number; b: number; length: number; }
const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], (a[1] - b[1]) * .625);
const at = (s: AmbientSoldier): Point => [s.u, s.v];

/** 只响应已到达的攻城状态，不以行军目标或倒计时猜测开战。 */
export function cityUnderSiege(cityId: number | string | undefined, x: number, y: number,
    marches: Iterable<Source>, entities: Iterable<Source>): boolean {
    const matches = (source: Source): boolean => source.troopState === TroopStateEnum.SIEGE
        && ((cityId != null && String(cityId) !== '0' && String(source.targetId) === String(cityId))
            || (source.targetPos?.x === x && source.targetPos?.y === y));
    for (const source of marches) if (matches(source)) return true;
    for (const source of entities) if (matches(source)) return true;
    return false;
}

/** 本地路网只决定装饰人物的表现，不发命令、不参与真实寻路或战斗。 */
export class CityAmbientActivity {
    readonly soldiers: AmbientSoldier[];
    mode: AmbientMode = 'peace';
    private owner: string | undefined;
    private sieging = false;
    private elapsed = 0;
    private peaceTime = 0;
    private fadeIn = false;
    private readonly nodes: Point[] = [];
    private readonly roads: Road[] = [];
    private readonly adjacent: number[][] = [];
    private readonly districts: number[][] = [];
    private readonly fixedRoutes: PatrolRoute[] = [];
    private readonly walkers: Walker[] = [];
    private readonly journeys: Journey[] = [];
    private readonly drillPhase: number[] = [];
    private readonly drillBases: Point[] = [];
    private readonly drillEnds: Point[] = [];
    private readonly laneTargets: Point[][] = [];
    private readonly crowd: CityAmbientCrowd;

    constructor(readonly layout: CityAmbientLayout) {
        this.buildRoads();
        this.soldiers = Array.from({ length: layout.trainees + layout.patrollers }, () =>
            ({ duty: 'drill', u: 0, v: 0, du: 1, dv: 1, walking: false, guard: false, alpha: 1 }));
        for (let i = 0; i < layout.trainees; i++) {
            this.drillPhase.push(-Math.floor(i / 2) * 1.7 - (layout.seed % 7) * .08);
            const base = this.formation(i);
            this.drillBases.push(base); this.drillEnds.push([base[0] + .009, base[1] - .009]);
            this.soldiers[i].u = base[0]; this.soldiers[i].v = base[1];
        }
        const districtCounts = layout.patrolDistrictCounts || this.districts.map((_, i) =>
            Math.floor(layout.patrollers / this.districts.length) + (i < layout.patrollers % this.districts.length ? 1 : 0));
        if (districtCounts.length !== this.districts.length || districtCounts.some(n => !Number.isInteger(n) || n < 1)
            || districtCounts.reduce((sum, n) => sum + n, 0) !== layout.patrollers) throw new Error('城内巡逻街区人数配置无效');
        const assignments: { district: number; slot: number; count: number }[] = [];
        districtCounts.forEach((count, district) => {
            for (let slot = 0; slot < count; slot++) assignments.push({ district, slot, count });
        });
        for (let i = 0; i < layout.patrollers; i++) {
            // 先给每个独立街区分配人数，再沿区内道路铺开；长主街不能吸走所有巡逻兵。
            const { district, slot, count } = assignments[i];
            // 主街保留随机巡逻；侧街分别安排守门岗与往返哨兵，人数更多时再增加随机巡逻。
            const duty: Walker['duty'] = district === 0
                ? slot < 2 ? 'roam' : slot === 2 ? 'patrol' : 'sentry'
                : slot === 0 ? 'sentry' : slot === 1 ? 'patrol' : 'roam';
            const route = duty === 'patrol' ? this.fixedRoutes[district] : undefined;
            const edges = route ? route.edges : this.districts[district];
            const total = edges.reduce((sum, edge) => sum + this.roads[edge].length, 0);
            let along = total * (slot + .35) / count, cursor = 0;
            while (cursor < edges.length - 1 && along > this.roads[edges[cursor]].length) along -= this.roads[edges[cursor++]].length;
            const edge = edges[cursor];
            const t = Math.max(.1, Math.min(.9, along / this.roads[edge].length)), road = this.roads[edge];
            const walker: Walker = { edge, from: road.a, to: road.b, district, duty, route,
                home: [0, 0], facing: [1, 0], routeCursor: 0, routeStep: i % 2 ? -1 : 1, wait: 0, speed: 0,
                random: (layout.seed ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0 || 1 };
            walker.speed = .011 + this.random(walker) * .005;
            walker.wait = this.random(walker) * 3;
            this.walkers.push(walker);
            if (i % 2) { walker.from = road.b; walker.to = road.a; }
            if (route) this.resumeRoute(walker, edge);
            const point = this.lanePoint(this.nodes[walker.from], this.nodes[walker.to], this.point({ edge, t }));
            const s = this.soldiers[layout.trainees + i]; s.u = point[0]; s.v = point[1]; s.duty = duty;
            const a = this.nodes[walker.from], b = this.nodes[walker.to];
            walker.facing = [b[0] - a[0], b[1] - a[1]];
            s.du = walker.facing[0]; s.dv = walker.facing[1];
        }
        this.crowd = new CityAmbientCrowd(this.soldiers, layout.standing || [], (i, u, v) => this.onFloor(i, u, v));
        const reserved: Point[] = [];
        for (let i = 0; i < this.soldiers.length; i++) {
            const s = this.soldiers[i], p = this.crowd.placement(i, s.u, s.v, i, true, reserved);
            if (i < layout.trainees) {
                const base = this.drillBases[i], end = this.drillEnds[i];
                this.drillBases[i] = [base[0] + p[0] - s.u, base[1] + p[1] - s.v];
                this.drillEnds[i] = this.crowd.placement(i, end[0] + p[0] - s.u, end[1] + p[1] - s.v);
                // 留出整个操练往返区，巡逻兵的常驻岗位不能占住队友的动作终点。
                for (let t = 0; t <= 1; t += .125) reserved.push([
                    this.drillBases[i][0] * (1 - t) + this.drillEnds[i][0] * t,
                    this.drillBases[i][1] * (1 - t) + this.drillEnds[i][1] * t]);
            }
            s.u = p[0]; s.v = p[1];
            if (i >= layout.trainees) {
                const w = this.walkers[i - layout.trainees], anchor = this.nearest(p, w.district, w.route?.edges), road = this.roads[anchor.edge];
                w.edge = anchor.edge;
                w.from = i % 2 ? road.b : road.a; w.to = i % 2 ? road.a : road.b;
                if (w.route) this.resumeRoute(w, anchor.edge);
                w.home = p;
                reserved.push(p);
            }
        }
        for (const road of this.roads) {
            this.laneTargets.push([[road.a, road.b], [road.b, road.a]].map(([from, to]) => {
                const p = this.lanePoint(this.nodes[from], this.nodes[to], this.nodes[to]);
                return this.crowd.placement(layout.trainees, p[0], p[1]);
            }));
        }
        this.tick(0);
    }

    private buildRoads(): void {
        const ids = new Map<string, number>(), edges = new Set<string>();
        for (const street of this.layout.roads) {
            let previous = -1;
            for (const p of street) {
                const key = p[0] + ',' + p[1];
                if (!ids.has(key)) { ids.set(key, this.nodes.length); this.nodes.push(p); this.adjacent.push([]); }
                const index = ids.get(key)!;
                if (previous >= 0 && previous !== index) {
                    const pair = Math.min(previous, index) + ',' + Math.max(previous, index);
                    if (!edges.has(pair)) {
                        edges.add(pair); const edge = this.roads.length;
                        this.roads.push({ a: previous, b: index, length: distance(this.nodes[previous], p) });
                        this.adjacent[previous].push(edge); this.adjacent[index].push(edge);
                    }
                }
                previous = index;
            }
        }
        if (!this.roads.length) throw new Error('城内氛围路网不能为空');
        const visited = new Set<number>();
        for (let edge = 0; edge < this.roads.length; edge++) {
            if (visited.has(edge)) continue;
            const district: number[] = [], pending = [edge]; visited.add(edge);
            for (let cursor = 0; cursor < pending.length; cursor++) {
                const current = pending[cursor], road = this.roads[current]; district.push(current);
                for (const node of [road.a, road.b]) for (const next of this.adjacent[node]) {
                    if (!visited.has(next)) { visited.add(next); pending.push(next); }
                }
            }
            district.sort((a, b) => a - b); this.districts.push(district);
        }
        // 固定巡逻直接使用美术标定的完整街道，只在初始化时选定，不会到路口重新随机选路。
        for (const district of this.districts) {
            let best: PatrolRoute | undefined, longest = -1;
            for (const street of this.layout.roads) {
                const nodes = street.map(p => ids.get(p[0] + ',' + p[1])!);
                const route: PatrolRoute = { nodes: [nodes[0]], edges: [] }; let length = 0;
                for (let i = 1; i < nodes.length; i++) {
                    if (nodes[i] === nodes[i - 1]) continue;
                    const edge = this.adjacent[nodes[i - 1]].find(e => {
                        const r = this.roads[e]; return r.a === nodes[i] || r.b === nodes[i];
                    });
                    if (edge == null || district.indexOf(edge) < 0) { route.edges.length = 0; break; }
                    route.nodes.push(nodes[i]); route.edges.push(edge); length += this.roads[edge].length;
                }
                if (route.edges.length && length > longest) { longest = length; best = route; }
            }
            if (!best) throw new Error('城内固定巡逻路线缺失');
            this.fixedRoutes.push(best);
        }
    }

    private random(w: Walker): number {
        let x = w.random; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; w.random = x >>> 0;
        return w.random / 4294967296;
    }
    private point(anchor: Anchor): Point {
        const road = this.roads[anchor.edge], a = this.nodes[road.a], b = this.nodes[road.b];
        return [a[0] + (b[0] - a[0]) * anchor.t, a[1] + (b[1] - a[1]) * anchor.t];
    }
    private lanePoint(from: Point, to: Point, point: Point): Point {
        const dx = to[0] - from[0], dy = (to[1] - from[1]) * .625, length = Math.hypot(dx, dy);
        return length < 1e-8 ? point : [point[0] - dy / length * AMBIENT_LANE_OFFSET,
            point[1] + dx / length * AMBIENT_LANE_OFFSET / .625];
    }
    private onFloor(index: number, u: number, v: number): boolean {
        const contains = (a: Point, b: Point): boolean => {
            const dx = b[0] - a[0], dy = (b[1] - a[1]) * .625, length2 = dx * dx + dy * dy;
            const t = length2 > 0 ? Math.max(0, Math.min(1, ((u - a[0]) * dx + (v - a[1]) * .625 * dy) / length2)) : 0;
            const x = u - a[0] - dx * t, y = (v - a[1]) * .625 - dy * t;
            return x * x + y * y <= AMBIENT_ROAD_MARGIN * AMBIENT_ROAD_MARGIN;
        };
        if (index < this.layout.trainees) return contains(this.drillBases[index], this.drillEnds[index]);
        return this.roads.some(r => contains(this.nodes[r.a], this.nodes[r.b]));
    }
    private nearest(p: Point, district = -1, allowedEdges?: readonly number[]): Anchor {
        let best = Infinity, result: Anchor = { edge: 0, t: 0 };
        const edges = allowedEdges || (district >= 0 ? this.districts[district] : this.roads.map((_, i) => i));
        for (const edge of edges) {
            const road = this.roads[edge], a = this.nodes[road.a], b = this.nodes[road.b];
            const dx = b[0] - a[0], dy = (b[1] - a[1]) * .625;
            const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * .625 * dy) / (dx * dx + dy * dy)));
            const d = distance(p, [a[0] + dx * t, a[1] + (b[1] - a[1]) * t]);
            if (d < best) { best = d; result = { edge, t }; }
        }
        return result;
    }
    private formation(index: number): Point {
        if (this.drillBases[index]) return this.drillBases[index];
        const yards = this.layout.drillYards || [this.layout.drill], group = Math.floor(index / 2);
        const yard = yards[group % yards.length];
        return [yard[0] + (index % 2 ? .009 : -.009),
            yard[1] + (index % 2 ? .009 : -.009) + Math.floor(group / yards.length) * .022];
    }

    sync(owner: string | undefined, sieging: boolean): void {
        const changed = owner != null && this.owner != null && owner !== this.owner;
        if (owner != null) this.owner = owner;
        this.sieging = sieging;
        if (changed && this.mode !== 'withdraw') { this.begin('withdraw'); return; }
        if (this.mode === 'withdraw' || this.mode === 'return') return;
        if (sieging && this.mode === 'peace') this.begin('alert');
        if (!sieging && this.mode === 'alert') this.begin('return');
    }
    private begin(mode: AmbientMode): void {
        this.mode = mode; this.elapsed = 0;
        this.journeys.length = 0;
        for (let i = 0; i < this.soldiers.length; i++) this.crowd.stop(i);
        const posts: Point[] = [];
        for (let i = 0; i < this.layout.trainees; i++) for (let t = 0; t <= 1; t += .125) posts.push([
            this.drillBases[i][0] * (1 - t) + this.drillEnds[i][0] * t,
            this.drillBases[i][1] * (1 - t) + this.drillEnds[i][1] * t]);
        for (let i = 0; i < this.soldiers.length; i++) {
            const s = this.soldiers[i];
            if (i < this.layout.trainees) {
                const target = mode === 'peace' || mode === 'return' ? this.drillBases[i] : this.drillEnds[i];
                this.journeys.push({ points: [target], cursor: 0 });
                if (mode === 'peace') this.drillPhase[i] = -Math.floor(i / 2) * 1.7;
            } else {
                const walker = this.walkers[i - this.layout.trainees], source = this.nearest(at(s), walker.district, walker.route?.edges);
                if (mode === 'peace' || mode === 'return') {
                    const road = this.roads[source.edge];
                    if (walker.duty === 'patrol') this.resumeRoute(walker, source.edge);
                    else if (walker.duty === 'roam') Object.assign(walker, { edge: source.edge, from: road.a, to: road.b });
                    walker.wait = .3 + this.random(walker) * 2.5;
                }
                // 警戒时就近退到路肩站岗，不让全城巡逻兵逆向穿过路口抢原来的固定岗位。
                if (mode === 'alert') {
                    const road = this.roads[source.edge], center = this.point(source);
                    const lane = this.lanePoint(this.nodes[road.a], this.nodes[road.b], center);
                    const side = (s.u - center[0]) * (lane[0] - center[0]) + (s.v - center[1]) * (lane[1] - center[1]) * .625 * .625 >= 0 ? 1 : -1;
                    const point = this.crowd.placement(i, center[0] + (lane[0] - center[0]) * side * 1.7,
                        center[1] + (lane[1] - center[1]) * side * 1.7, this.soldiers.length, true, posts, true);
                    posts.push(point); this.journeys.push({ points: [point], cursor: 0 }); continue;
                }
                // 解除警戒后从当前街区继续巡逻，避免为恢复日常再横穿整座城。
                if (mode !== 'withdraw') { this.journeys.push({ points: [], cursor: 0 }); continue; }
                const target = { edge: source.edge, t: source.t < .5 ? 0 : 1 };
                const lane = this.lanePoint(this.point(source), this.point(target), this.point(target));
                this.journeys.push({ points: [this.crowd.placement(i, lane[0], lane[1])], cursor: 0 });
            }
        }
    }

    private step(index: number, target: Point, budget: number, dt: number): number {
        return Math.max(0, budget - this.crowd.move(index, target, budget, dt));
    }
    private resumeRoute(w: Walker, edge: number): void {
        const route = w.route!, leg = route.edges.indexOf(edge);
        if (leg < 0) throw new Error('巡逻兵离开指定路线');
        w.edge = edge;
        w.routeCursor = leg + (w.routeStep > 0 ? 1 : 0);
        w.from = route.nodes[leg + (w.routeStep > 0 ? 0 : 1)]; w.to = route.nodes[w.routeCursor];
    }
    private sentry(s: AmbientSoldier, w: Walker, dt: number, index: number): void {
        // 给同伴侧让或解除警戒后走回原岗，绝不靠瞬移复位；平常站立持枪，不切成蹲伏操练。
        if (distance(at(s), w.home) > .0004) this.step(index, w.home, .014 * dt, dt);
        if (!s.walking) { s.du = w.facing[0]; s.dv = w.facing[1]; }
    }
    private patrol(s: AmbientSoldier, w: Walker, dt: number, index: number): void {
        if (w.duty === 'sentry') { this.sentry(s, w, dt, index); return; }
        if (w.wait > 0) { w.wait = Math.max(0, w.wait - dt); return; }
        const road = this.roads[w.edge], target = this.laneTargets[w.edge][w.from === road.a ? 0 : 1];
        this.step(index, target, w.speed * dt, dt);
        if (distance(at(s), target) > .008) return;
        if (w.duty === 'patrol') {
            const route = w.route!, atEnd = w.routeCursor === 0 || w.routeCursor === route.nodes.length - 1;
            if (atEnd) w.routeStep = -w.routeStep;
            w.from = w.to; w.routeCursor += w.routeStep; w.to = route.nodes[w.routeCursor];
            w.edge = route.edges[Math.min(w.routeCursor, w.routeCursor - w.routeStep)];
            w.wait = atEnd ? 2.2 : 0;
            return;
        }
        const junction = w.to, options = this.adjacent[junction];
        // 有分岔时避免立即原路折返；路端允许转身，所有行走仍沿着真实道路。
        const alternatives = options.length > 1 ? options.filter(edge => edge !== w.edge) : options;
        // 分岔优先走较空的路，保留随机变化；只在到达路口时计算，不逐帧全城寻路。
        const weights = alternatives.map(edge => {
            const mid = this.point({ edge, t: .5 }); let traffic = 0;
            for (let i = 0; i < this.soldiers.length; i++) if (i !== index) {
                if (distance(at(this.soldiers[i]), mid) < .045) traffic++;
            }
            for (const other of this.walkers) if (other !== w && other.edge === edge) traffic += 2;
            return 1 / (1 + traffic * 3);
        });
        let choice = this.random(w) * weights.reduce((sum, value) => sum + value, 0), selected = 0;
        while (selected < weights.length - 1 && choice >= weights[selected]) choice -= weights[selected++];
        const edge = alternatives[selected], next = this.roads[edge];
        w.edge = edge; w.from = junction; w.to = next.a === junction ? next.b : next.a;
        // 路端短暂停岗，经过普通拐点继续走；不能每个路点都停几秒堵成一团。
        w.wait = options.length === 1 ? 1.2 + this.random(w) * 2.5 : this.random(w) < .12 ? .4 + this.random(w) * .8 : 0;
    }
    private drill(s: AmbientSoldier, index: number, dt: number): void {
        const nextPhase = this.drillPhase[index] + dt;
        const t = Math.max(0, nextPhase) % 11.5, base = this.drillBases[index], end = this.drillEnds[index];
        const progress = t < 2 ? t / 2 : t < 5.5 ? 1 : t < 7.5 ? 1 - (t - 5.5) / 2 : 0;
        const target: Point = [base[0] + progress * (end[0] - base[0]), base[1] + progress * (end[1] - base[1])];
        this.step(index, target, .012 * dt, dt);
        if (distance(at(s), target) < .0004) this.drillPhase[index] = nextPhase;
        s.guard = !s.walking && t >= 2 && t < 5.5;
    }
    tick(dt: number): void {
        const delta = Number.isFinite(dt) ? Math.max(0, Math.min(.25, dt)) : 0;
        // 慢帧拆成小步，避免一帧的侧让距离比身体半径还大，导致方向来回跳。
        const steps = Math.max(1, Math.ceil(delta / .05));
        for (let i = 0; i < steps; i++) this.advance(delta / steps);
    }
    private advance(delta: number): void {
        this.elapsed += delta;
        if (this.mode === 'withdraw' && this.elapsed >= 4.4) { this.fadeIn = true; this.begin('return'); }
        if (this.mode === 'peace') this.peaceTime += delta;
        // 警戒是就近整备：最多调整两秒，拥挤处直接在安全的当前位置持枪，不能一直找岗位转圈。
        if (this.mode === 'alert' && this.elapsed >= 2) {
            for (let i = 0; i < this.soldiers.length; i++) {
                this.crowd.stop(i); const s = this.soldiers[i]; s.walking = false; s.guard = true; s.alpha = 1;
            }
            return;
        }
        let settled = true;
        for (let i = 0; i < this.soldiers.length; i++) {
            const s = this.soldiers[i]; s.guard = false; s.alpha = 1; s.walking = false;
            const yielding = this.crowd.yield(i, (this.mode === 'peace' ? .012 : .028) * delta, delta);
            if (this.mode === 'peace') {
                if (!yielding) {
                    if (i < this.layout.trainees) this.drill(s, i, delta);
                    else this.patrol(s, this.walkers[i - this.layout.trainees], delta, i);
                }
                continue;
            }
            if (this.mode === 'return' && i >= this.layout.trainees) {
                if (!yielding) this.patrol(s, this.walkers[i - this.layout.trainees], delta, i);
                if (this.fadeIn) s.alpha = Math.min(1, this.elapsed / 1.2);
                continue;
            }
            const journey = this.journeys[i]; let budget = yielding ? 0 : .028 * delta;
            // 给同伴让过路后回到自己的岗位，不能永久占住别人后续要到达的操练点。
            if (!yielding && this.mode === 'alert' && journey.points.length && journey.cursor >= journey.points.length
                && distance(at(s), journey.points[journey.points.length - 1]) > .001) journey.cursor = journey.points.length - 1;
            for (let hops = 0; budget > 0 && journey.cursor < journey.points.length && hops < 32; hops++) {
                const target = journey.points[journey.cursor]; budget = this.step(i, target, budget, delta);
                // 路口是转向区域，不要求所有人踩同一个点；最终岗位仍需精确到达。
                if (distance(at(s), target) < (journey.cursor < journey.points.length - 1 ? .012 : .001)) journey.cursor++; else break;
            }
            const arrived = journey.cursor >= journey.points.length;
            settled = settled && arrived && !yielding;
            s.guard = this.mode === 'alert' && arrived && !s.walking;
            if (this.mode === 'withdraw') s.alpha = Math.max(0, Math.min(1, (3.6 - this.elapsed) / .8));
            else if (this.mode === 'return' && this.fadeIn) s.alpha = Math.min(1, this.elapsed / 1.2);
        }
        if (this.mode === 'return' && settled && this.elapsed >= 1.2) {
            this.fadeIn = false; this.begin(this.sieging ? 'alert' : 'peace');
        }
    }
}
