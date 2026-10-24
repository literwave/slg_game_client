import WorldMapArt from './WorldMapArt';

export interface CampaignRegion { id: number; name: string; tier: number; color: string; x: number; y: number; }
export interface CampaignGate { id: string; name: string; x: number; y: number; regions: number[]; level: number; }
export interface CampaignCity { name: string; x: number; y: number; level: number; region: number; footprintRadius: number; art: string; }
export interface CampaignMap { width: number; height: number; regions: CampaignRegion[]; gates: CampaignGate[]; cities: CampaignCity[]; stages: string[]; }

/** 客户端通关提示和可达性；关隘归属始终读取服务器的占领数据。 */
export default class WorldCampaign {
    static get config(): CampaignMap { return WorldMapArt.campaign; }

    static regionAt(x: number, y: number): number {
        const config = this.config;
        if (!config || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= config.width || y >= config.height) return -1;
        const dx = x - (config.width - 1) / 2, dy = y - (config.height - 1) / 2;
        const r = Math.hypot(dx, dy), angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
        return r < 100 ? 9 : r < 285 ? 6 + Math.floor(angle / (Math.PI * 2 / 3)) : Math.floor(angle / (Math.PI / 3));
    }

    static gateAt(x: number, y: number): CampaignGate {
        return this.config?.gates.find(gate => gate.x === x && gate.y === y) || null;
    }

    static landmark(x: number, y: number): string {
        return this.gateAt(x, y)?.name || this.config?.cities.find(city => city.x === x && city.y === y)?.name || '';
    }

    static reachable(home: number, ownsGate: (gate: CampaignGate) => boolean): Set<number> {
        const reachable = new Set<number>();
        if (home < 0 || !this.config) return reachable;
        reachable.add(home);
        let changed = true;
        while (changed) {
            changed = false;
            for (const gate of this.config.gates) {
                if (!gate.regions.some(id => reachable.has(id)) || !ownsGate(gate)) continue;
                for (const id of gate.regions) if (!reachable.has(id)) { reachable.add(id); changed = true; }
            }
        }
        return reachable;
    }

    static canTarget(x: number, y: number, reachable: Set<number>, attackGate = true): boolean {
        const region = this.regionAt(x, y);
        if (region < 0) return false;
        const gate = this.gateAt(x, y);
        // 只有进攻允许以尚未占领的边界关口为目标；驻军、调动不能借此越关。
        return gate ? attackGate && gate.regions.some(id => reachable.has(id))
            || gate.regions.every(id => reachable.has(id)) : reachable.has(region);
    }
}
