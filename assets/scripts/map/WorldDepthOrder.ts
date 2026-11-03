/** 等距地图的落脚点；建筑用实际占地菱形，小兵用单独的落脚点。 */
export interface WorldDepthItem<T> {
    value: T;
    x: number;
    y: number;
    halfWidth?: number;
    halfHeight?: number;
}

function frontEdge<T>(building: WorldDepthItem<T>, x: number): number {
    return building.y - building.halfHeight
        + Math.min(Math.abs(x - building.x), building.halfWidth) * building.halfHeight / building.halfWidth;
}

/** 建筑与人物建立遮挡约束，人物之间仍按脚底高度排序。不能只按城心排序：
 * 站在城墙前侧斜边的士兵，脚底可能仍高于整座城的最前角。 */
export function orderWorldDepth<T>(items: WorldDepthItem<T>[]): T[] {
    const count = items.length;
    const next = Array.from({ length: count }, () => [] as number[]);
    const incoming = new Array<number>(count).fill(0);
    const buildings: number[] = [];
    items.forEach((item, i) => { if (item.halfWidth > 0 && item.halfHeight > 0) buildings.push(i); });
    const before = (a: number, b: number) => { next[a].push(b); incoming[b]++; };
    for (const i of buildings) {
        const building = items[i];
        for (let j = 0; j < count; j++) {
            if (j === i) continue;
            const other = items[j], isBuilding = other.halfWidth > 0 && other.halfHeight > 0;
            if (isBuilding && j < i) continue;
            const dx = Math.abs(other.x - building.x);
            // 城外两侧没有投影交叠，不产生不必要的排序约束。
            if (dx > building.halfWidth + (isBuilding ? other.halfWidth : 38)) continue;
            if (isBuilding) {
                // 同一地面投影上的城池按地基中心从远到近绘制。
                if (building.y > other.y || (building.y === other.y && i < j)) before(i, j);
                else before(j, i);
            } else {
                const front = frontEdge(building, other.x);
                if (other.y > front + .01) before(j, i);
                else before(i, j);
            }
        }
    }
    // 按脚底高度组织候选队列。稳定的同高顺序避免静止时抖动。
    const priority = items.map((_, i) => i).sort((a, b) => items[b].y - items[a].y || a - b);
    const rank = new Array<number>(count); priority.forEach((i, order) => rank[i] = order);
    const ready: number[] = [], emitted = new Set<number>(), result: T[] = [];
    const push = (value: number) => {
        let i = ready.length; ready.push(value);
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (rank[ready[parent]] <= rank[value]) break;
            ready[i] = ready[parent]; i = parent;
        }
        ready[i] = value;
    };
    const pop = () => {
        const first = ready[0], last = ready.pop();
        if (ready.length) {
            let i = 0;
            while (i * 2 + 1 < ready.length) {
                let child = i * 2 + 1;
                if (child + 1 < ready.length && rank[ready[child + 1]] < rank[ready[child]]) child++;
                if (rank[last] <= rank[ready[child]]) break;
                ready[i] = ready[child]; i = child;
            }
            ready[i] = last;
        }
        return first;
    };
    incoming.forEach((degree, i) => { if (degree === 0) push(i); });
    let fallback = 0;
    while (result.length < count) {
        // 异常重叠建筑的循环约束也不能丢失渲染节点。
        while (emitted.has(priority[fallback])) fallback++;
        const index = ready.length ? pop() : priority[fallback];
        if (emitted.has(index)) continue;
        emitted.add(index); result.push(items[index].value);
        for (const child of next[index]) if (--incoming[child] === 0 && !emitted.has(child)) push(child);
    }
    return result;
}
