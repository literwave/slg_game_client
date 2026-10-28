/** 界面的英雄位置映射：英雄 ID -> 0～2 号槽位；World 协议站位为 1～3。 */
export type HeroIndexMap = { [heroIdx: string]: number };

export const TROOP_SLOT_COUNT = 3;

export function toTroopProtocolPosition(slot: number): number {
    return Number.isInteger(slot) && slot >= 0 && slot < TROOP_SLOT_COUNT ? slot + 1 : 0;
}

export function fromTroopProtocolPosition(position: number): number {
    return Number.isInteger(position) && position >= 1 && position <= TROOP_SLOT_COUNT ? position - 1 : -1;
}

export interface SoldierInfo { count: number; hurtCount: number; }
export interface TroopPosition { heroIdx: number; soldier: SoldierInfo; }

function unwrapTroop(serverData: any): any {
    if (!serverData) {
        return serverData;
    }
    return serverData.troopInfo || serverData.troop_info || serverData;
}

/** 部队数据 */
export class TroopData {
    troopIdx: number = 0;
    heroPositions: Map<number, number> = new Map<number, number>();
    private soldiers = new Map<number, SoldierInfo>();

    public static createFromServer(serverData: any, troopData: TroopData = null): TroopData {
        const data = troopData || new TroopData();
        if (!serverData) {
            return data;
        }

        const troop = unwrapTroop(serverData);
        data.troopIdx = Number(troop.troopIdx != null ? troop.troopIdx : (troop.troop_idx != null ? troop.troop_idx : data.troopIdx));
        data.heroPositions.clear();

        data.soldiers.clear();
        const posMap = troop.posMap || {};
        Object.keys(posMap).forEach(key => {
            const position = fromTroopProtocolPosition(Number(key));
            const slot = posMap[key];
            const heroIdx = Number(slot?.heroIdx);
            if (!Number.isInteger(heroIdx) || heroIdx <= 0 || position < 0) return;
            data.removePosition(position);
            data.heroPositions.set(heroIdx, position);
            data.soldiers.set(heroIdx, {
                count: Number(slot.soldier?.count) || 0,
                hurtCount: Number(slot.soldier?.hurtCount) || 0,
            });
        });
        return data;
    }

    public getSoldier(heroIdx: number): SoldierInfo {
        return { ...(this.soldiers.get(heroIdx) || { count: 0, hurtCount: 0 }) };
    }

    /** 导出 World 协议用的 1～3 号站位。 */
    public getPosMap(): { [position: string]: TroopPosition } {
        const result: { [position: string]: TroopPosition } = {};
        this.heroPositions.forEach((position, heroIdx) => {
            const protocolPosition = toTroopProtocolPosition(position);
            if (protocolPosition) result[protocolPosition] = { heroIdx, soldier: this.getSoldier(heroIdx) };
        });
        return result;
    }

    public getHeroMap(): HeroIndexMap {
        const result: HeroIndexMap = {};
        this.heroPositions.forEach((position, heroIdx) => {
            result[String(heroIdx)] = position;
        });
        return result;
    }

    /** 拖到有人的位置交换，拖到空位移动；只返回待提交阵容，不改动服务器快照。 */
    public getRepositionedHeroMap(from: number, to: number): HeroIndexMap | null {
        if (!toTroopProtocolPosition(from) || !toTroopProtocolPosition(to) || from === to) return null;
        const source = this.getHeroIdxAt(from), target = this.getHeroIdxAt(to);
        if (!source) return null;
        const next = this.getHeroMap();
        next[String(source)] = to;
        if (target) next[String(target)] = from;
        return next;
    }

    public getHeroIdxAt(position: number): number {
        let result = 0;
        this.heroPositions.forEach((heroPosition, heroIdx) => {
            if (result == 0 && heroPosition == position) {
                result = heroIdx;
            }
        });
        return result;
    }

    public getHeroPosition(heroIdx: number): number {
        return this.heroPositions.has(heroIdx) ? this.heroPositions.get(heroIdx) : -1;
    }

    public hasHero(heroIdx: number): boolean {
        return this.heroPositions.has(heroIdx);
    }

    public setHero(heroIdx: number, position: number): void {
        if (!Number.isInteger(heroIdx) || heroIdx <= 0 || !toTroopProtocolPosition(position)) {
            return;
        }
        this.removeHero(heroIdx);
        this.removePosition(position);
        this.heroPositions.set(heroIdx, position);
    }

    public removeHero(heroIdx: number): void {
        this.heroPositions.delete(heroIdx);
        this.soldiers.delete(heroIdx);
    }

    public removePosition(position: number): void {
        let occupant = 0;
        this.heroPositions.forEach((heroPosition, heroIdx) => {
            if (occupant == 0 && heroPosition == position) {
                occupant = heroIdx;
            }
        });
        if (occupant > 0) {
            this.heroPositions.delete(occupant);
            this.soldiers.delete(occupant);
        }
    }

    public getSortedHeroes(): Array<{ heroIdx: number, position: number }> {
        const list: Array<{ heroIdx: number, position: number }> = [];
        this.heroPositions.forEach((position, heroIdx) => {
            list.push({ heroIdx, position });
        });
        list.sort((left, right) => left.position - right.position);
        return list;
    }

    public getHeroCount(): number {
        return this.heroPositions.size;
    }
}

export default class TroopProxy {
    protected _troops: Map<number, TroopData> = new Map<number, TroopData>();

    public clearData(): void {
        this._troops.clear();
    }

    public updateTroops(datas: any[]): void {
        this._troops.clear();
        if (!Array.isArray(datas)) {
            return;
        }
        datas.forEach((serverData) => {
            const troop = TroopData.createFromServer(serverData);
            if (troop.troopIdx > 0) {
                this._troops.set(troop.troopIdx, troop);
            }
        });
    }

    public updateTroop(serverData: any): TroopData {
        if (!serverData) {
            return null;
        }
        const troop = unwrapTroop(serverData);
        const troopIdx = Number(troop.troopIdx != null ? troop.troopIdx : troop.troop_idx);
        if (!Number.isInteger(troopIdx) || troopIdx <= 0 || troopIdx > 0xffffffff) {
            return null;
        }
        const troopData = TroopData.createFromServer(troop, this._troops.get(troopIdx) || null);
        this._troops.set(troopIdx, troopData);
        return troopData;
    }

    public getTroop(troopIdx: number): TroopData {
        return this._troops.get(Number(troopIdx)) || null;
    }

    public getTroops(): TroopData[] {
        const list = Array.from(this._troops.values());
        list.sort((left, right) => left.troopIdx - right.troopIdx);
        return list;
    }

    public getTroopIdxByHero(heroIdx: number): number {
        let result = 0;
        this._troops.forEach((troop) => {
            if (result == 0 && troop.hasHero(Number(heroIdx))) {
                result = troop.troopIdx;
            }
        });
        return result;
    }

    public isHeroInTroop(heroIdx: number): boolean {
        return this.getTroopIdxByHero(heroIdx) > 0;
    }

    public getAssignedHeroIds(): Set<number> {
        const result = new Set<number>();
        this._troops.forEach((troop) => {
            troop.heroPositions.forEach((position, heroIdx) => result.add(heroIdx));
        });
        return result;
    }
}
