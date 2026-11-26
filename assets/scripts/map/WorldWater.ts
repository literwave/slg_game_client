/** 水域行军与水战表现用的纯数据查询；只影响客户端表现，不改变逻辑寻路或阻挡。 */
export interface WaterLandscapeConfig {
    width: number;
    height: number;
    riverCells?: readonly number[];
    bridgeWaterCells?: readonly number[];
}

let waterWidth = 0;
let waterHeight = 0;
let waterMask: Uint8Array | null = null;

export function setWorldWaterData(config: WaterLandscapeConfig | null | undefined): void {
    if (!config || !Number.isInteger(config.width) || !Number.isInteger(config.height)
        || config.width <= 0 || config.height <= 0) {
        waterWidth = 0; waterHeight = 0; waterMask = null;
        return;
    }
    const mask = new Uint8Array(config.width * config.height);
    for (const id of config.riverCells || []) if (id >= 0 && id < mask.length) mask[id] = 1;
    for (const id of config.bridgeWaterCells || []) if (id >= 0 && id < mask.length) mask[id] = 1;
    waterWidth = config.width;
    waterHeight = config.height;
    waterMask = mask;
}

export function isWaterCell(x: number, y: number): boolean {
    if (!waterMask || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const cx = Math.round(x), cy = Math.round(y);
    if (cx < 0 || cy < 0 || cx >= waterWidth || cy >= waterHeight) return false;
    return waterMask[cy * waterWidth + cx] === 1;
}

/** 浮点行军坐标是否已踏入河面；在岸边做 0.2 格容差以贴合视觉水岸线。 */
export function isWaterPosition(x: number, y: number): boolean {
    if (!waterMask || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    return isWaterCell(x, y);
}

/**
 * 攻打河心水寨时，若服务端落脚格在贴岸浅滩，将战船视觉锚点前移至前方河面，
 * 确保战船列阵漂浮于水面发起火箭齐射；不修改任何逻辑/服务端坐标。
 */
export function navalSiegeAnchor(position: { x: number; y: number }, target: { x: number; y: number }): { x: number; y: number } {
    if (isWaterCell(position.x, position.y)) return { x: position.x, y: position.y };
    const dx = target.x - position.x, dy = target.y - position.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 2.2) return { x: position.x, y: position.y };
    const ux = dx / distance, uy = dy / distance;
    const maxShift = Math.min(2.6, Math.max(0, distance - 2.2));
    for (let step = .25; step <= maxShift + .001; step += .25) {
        const sx = position.x + ux * step, sy = position.y + uy * step;
        if (isWaterCell(sx, sy)) {
            const settle = Math.min(maxShift, step + .55);
            return { x: position.x + ux * settle, y: position.y + uy * settle };
        }
    }
    return { x: position.x, y: position.y };
}
