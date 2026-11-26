import { cityFootprintRadius } from './CityFootprint';
import WorldCampaign from './WorldCampaign';

let cachedCampaign: typeof WorldCampaign.config = null;
let cachedCells: ReadonlySet<number> = new Set();
let cachedTerrainCells: ReadonlySet<number> = new Set();

/** 只清理真实占地；屋顶、角楼伸到城外时由绘制顺序遮挡，不能清空整片邻地。 */
export function systemCityGroundCells(includePasses = true): ReadonlySet<number> {
    const campaign = WorldCampaign.config;
    if (campaign === cachedCampaign) return includePasses ? cachedCells : cachedTerrainCells;
    const cells = new Set<number>(), terrainCells = new Set<number>();
    const cities = new Set(campaign?.cities || []);
    for (const city of [...(campaign?.cities || []), ...(campaign?.gates || []).filter(g => g.crossing === 'pass')]) {
        const radius = Number.isInteger(city.footprintRadius) && city.footprintRadius >= 0
            ? city.footprintRadius : cityFootprintRadius(city.level);
        const isPass = (city as any).crossing === 'pass';
        const widthRadius = isPass && Number.isInteger((city as any).footprintWidthRadius)
            ? (city as any).footprintWidthRadius : isPass ? 3 : radius;
        const rx = isPass ? ((city as any).axis === 'x' ? radius : widthRadius) : radius;
        const ry = isPass ? ((city as any).axis === 'x' ? widthRadius : radius) : radius;
        for (let dx = -rx; dx <= rx; dx++) for (let dy = -ry; dy <= ry; dy++) {
            const x = city.x + dx, y = city.y + dy;
            if (x < 0 || y < 0 || x >= campaign.width || y >= campaign.height) continue;
            cells.add(y * campaign.width + x);
            if (cities.has(city as any)) terrainCells.add(y * campaign.width + x);
        }
    }
    cachedCampaign = campaign; cachedCells = cells; cachedTerrainCells = terrainCells;
    return includePasses ? cells : terrainCells;
}

export function isSystemCityGroundCell(x: number, y: number): boolean {
    const config = WorldCampaign.config;
    return !!config && Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0
        && x < config.width && y < config.height && systemCityGroundCells().has(y * config.width + x);
}

/** 入口标记保留通道轴与朝外方向：X+/X-/Y+/Y-，覆盖前后各 3 格宽（门前中心与左右各 1 格）避免山石压门。 */
export function passMountainClearMasks(blocked: ReadonlySet<number>): ReadonlyMap<number, number> {
    const config = WorldCampaign.config, result = new Map<number, number>();
    if (!config) return result;
    for (const gate of config.gates || []) {
        if (gate.crossing !== 'pass') continue;
        for (const { x, y } of gate.attackEntrances || []) {
            const along = gate.axis === 'x' ? x - gate.x : y - gate.y;
            if (along === 0) continue;
            const flag = (gate.axis === 'x' ? 64 : 128) + (along < 0 ? 32 : 0);
            for (const across of [-1, 0, 1]) {
                const cx = x + (gate.axis === 'x' ? 0 : across);
                const cy = y + (gate.axis === 'x' ? across : 0);
                const id = cy * config.width + cx;
                if (cx >= 0 && cy >= 0 && cx < config.width && cy < config.height && !blocked.has(id)) {
                    result.set(id, flag);
                }
            }
        }
    }
    return result;
}

/** 点击范围仍为原来两侧的完整入口格。 */
export function passMountainClearCells(blocked: ReadonlySet<number>): ReadonlySet<number> {
    return new Set(passMountainClearMasks(blocked).keys());
}
