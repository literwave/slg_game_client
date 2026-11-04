import { SystemOpenEnum } from '../config/enum/SystemOpenEnum';

export interface SystemOpenCondition {
    level?: number;
    [key: string]: any;
}

export interface SystemOpenConfig {
    Id: number;
    Name: string;
    Enum?: string;
    Desc?: string;
    Cond?: SystemOpenCondition[];
}

export default class SystemOpenProxy {
    private _configs: Map<number, SystemOpenConfig> = new Map();
    private _openedIds: Set<number> = new Set();

    public setConfigs(list: any[]): void {
        this._configs.clear();
        if (!Array.isArray(list)) {
            return;
        }
        for (const item of list) {
            const id = Number(item && item.Id);
            if (!id) {
                continue;
            }
            this._configs.set(id, {
                Id: id,
                Name: String(item.Name || `系统 ${id}`),
                Enum: SystemOpenEnum[id] || "",
                Desc: item.Desc ? String(item.Desc) : "",
                Cond: Array.isArray(item.Cond) ? item.Cond.slice() : [],
            });
        }
    }

    public getConfig(id: number): SystemOpenConfig | null {
        return this._configs.get(Number(id)) || null;
    }

    public getConfigByEnum(name: string): SystemOpenConfig | null {
        return Array.from(this._configs.values()).find(config => config.Enum === name) || null;
    }

    public setOpenedIds(ids: number[]): void {
        this._openedIds.clear();
        if (!Array.isArray(ids)) {
            return;
        }
        for (const id of ids) {
            const value = Number(id);
            if (value > 0) {
                this._openedIds.add(value);
            }
        }
    }

    public markOpened(id: number): void {
        const value = Number(id);
        if (value > 0) {
            this._openedIds.add(value);
        }
    }

    public isOpened(id: number): boolean {
        return this._openedIds.has(Number(id));
    }

    public getOpenedIds(): number[] {
        return Array.from(this._openedIds.values()).sort((left, right) => left - right);
    }

    public clear(): void {
        this._openedIds.clear();
    }
}
