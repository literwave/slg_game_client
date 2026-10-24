import type { MarchInfo, WorldEntity, WorldPosition } from './WorldCommand';

/** 仅用于显示；AOI 实体没有 troopIdx，不伪造本人的行军数据。 */
export type MarchMotion = Pick<MarchInfo, 'startPos' | 'endPos' | 'startTime' | 'endTime' | 'state' | 'path'>;

export interface MarchPath { points: WorldPosition[]; distances: number[]; length: number; }
const valid = (p: WorldPosition): boolean => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** 使用服务端折线路径的格坐标长度插值，不把浮点拐点取整，也不直线穿越山体。 */
export function buildMarchPath(march: MarchMotion): MarchPath {
    const source = march.path?.length >= 2 && march.path.every(valid) ? march.path : [march.startPos, march.endPos];
    const points = source.filter(valid).map(p => ({ x: p.x, y: p.y }));
    const distances = [0];
    for (let i = 1; i < points.length; i++) {
        distances.push(distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    }
    return { points, distances, length: distances[distances.length - 1] || 0 };
}

export function sampleMarchPath(march: MarchMotion, path: MarchPath, nowMs: number): { position: WorldPosition; towards: WorldPosition; moving: boolean } | null {
    if (!path.points.length) return null;
    const duration = march.endTime - march.startTime;
    const ratio = march.state === 2 ? 1 : duration > 0 ? Math.min(1, Math.max(0, (nowMs / 1000 - march.startTime) / duration)) : 0;
    const distance = path.length * ratio;
    for (let i = 1; i < path.points.length; i++) {
        const segment = path.distances[i] - path.distances[i - 1];
        if (segment <= 0 || distance > path.distances[i]) continue;
        const t = (distance - path.distances[i - 1]) / segment, from = path.points[i - 1], to = path.points[i];
        return { position: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
            towards: to, moving: march.state === 1 && ratio < 1 && duration > 0 };
    }
    const end = path.points[path.points.length - 1];
    return { position: end, towards: end, moving: false };
}

/** 行军用服务器拐点与时间；清空路径的驻留推送以 pos 为准。 */
export function aoiTroopMotion(entity: WorldEntity): MarchMotion | null {
    if (entity.entityType !== 2) return null;
    const path = entity.path;
    if (Array.isArray(path) && path.length >= 2 && path.every(valid)
        && Number.isFinite(entity.startTime) && Number.isFinite(entity.endTime) && entity.endTime > entity.startTime) {
        return { startPos: path[0], endPos: path[path.length - 1], path,
            startTime: entity.startTime, endTime: entity.endTime, state: 1 };
    }
    if (!valid(entity.pos)) return null;
    return { startPos: entity.pos, endPos: entity.pos, path: [], startTime: 0, endTime: 0, state: 2 };
}
