/** protobuf int64 / int32 在脚本里用数字。Long 对象转成 number。 */
export function toProtoInt(value: any): number {
    if (value == null || value === "") {
        return 0;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === "object" && typeof value.toNumber === "function") {
        return value.toNumber();
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

export function toProtoId(value: any): number | string {
    const text = value == null ? '0' : String(value);
    const number = Number(text);
    return Number.isSafeInteger(number) ? number : text;
}

export interface ItemStack { itemUid: string; itemId: number; itemCnt: number; }
export interface InventoryItem { itemId: number; count: number; stacks: number; }

/** 保留 int64 实例 ID；拒绝已失真的 JS 大整数及无效数量。 */
export function normalizeItemStack(row: any): ItemStack | null {
    if (!row || (typeof row.itemUid === 'number' && !Number.isSafeInteger(row.itemUid))) return null;
    const uid = String(row.itemUid ?? '').replace(/^0+(?=\d)/, '');
    if (!/^[1-9]\d*$/.test(uid) || uid.length > 19 || (uid.length === 19 && uid > '9223372036854775807')) return null;
    const id = row.itemId, count = row.itemCnt;
    if (!Number.isInteger(count) || count < 0 || count > 0x7fffffff
        || !Number.isInteger(id) || id < (count === 0 ? 0 : 1) || id > 0x7fffffff) return null;
    return { itemUid: uid, itemId: id, itemCnt: count };
}

export class Role {
    userId: number | string = 0;
    name: string = "";
    sex: number = 0;
    serverId: number = 0;
    balance: number = 0;
    headIcon: number = 0;
    birthTime: number = 0;
    level = 0;
    exp = 0;
    allianceId: number | string = 0;
    soldierInfo = { count: 0, hurtCount: 0 };
    cityPos: { x: number; y: number } | null = null;
}



export default class LoginProxy {
    //登录数据
    private _loginData: any = null;
    public serverId: number = 0;


    //角色数据
    private _roleData: Role = null;

    //角色资源
    private _roleResData: any = null;

    //物品堆叠：itemUid -> { itemId, count }；itemCnt 是该堆叠当前数量
    private _itemStacks: Map<string, { itemId: number; count: number }> = new Map();
    private _itemTotals: Map<number, number> = new Map();
    private _itemsLoaded = false;

    private _token: string = null;

    public clear() {
        console.log("clear");
        this._loginData = null;
        this._roleData = null;
        this._roleResData = null;
        this.clearItemData();
        this._token = ""
    }


    public saveEnterData(data: any): void {
        this.setRoleData(data);
    }

    public setRoleResData(data: any): void {
        this._roleResData = data;
    }


    public setRoleData(data: any): void {
        if (!this._roleData) {
            this._roleData = new Role();
        }
        this._roleData.userId = toProtoId(this._loginData?.userId);
        if (data.name !== undefined) this._roleData.name = data.name;
        if (data.sex !== undefined) this._roleData.sex = data.sex;
        this._roleData.serverId = toProtoInt(this._loginData?.serverId);
        // 头像来自 User 基础信息，Login 登录回包没有这个字段。
        if (data.headIcon !== undefined) this.setHeadIcon(toProtoInt(data.headIcon));
        if (data.birthTime !== undefined) this._roleData.birthTime = toProtoInt(data.birthTime);
        if (data.level !== undefined) this._roleData.level = toProtoInt(data.level);
        if (data.exp !== undefined) this._roleData.exp = toProtoInt(data.exp);
        if (data.allianceId !== undefined) this.setAllianceId(data.allianceId);
        if (data.soldierInfo) this.setSoldierInfo(data.soldierInfo);
        if (data.cityPos) this.setCityPos(data.cityPos);
    }

    public setAllianceId(id: number | string): void {
        if (this._roleData) this._roleData.allianceId = id;
    }

    public setSoldierInfo(info: any): void {
        if (this._roleData && info) this._roleData.soldierInfo = { count: toProtoInt(info.count), hurtCount: toProtoInt(info.hurtCount) };
    }

    public setCityPos(pos: any): void {
        if (this._roleData && pos) this._roleData.cityPos = { x: toProtoInt(pos.x), y: toProtoInt(pos.y) };
    }

    public setHeadIcon(id: number): void {
        if (this._roleData && Number.isInteger(id) && id >= 0) this._roleData.headIcon = id;
    }


    public getRoleData(): Role {
        return this._roleData;
    }


    public getRoleResData(): any {
        return this._roleResData;
    }

    public get itemsLoaded(): boolean { return this._itemsLoaded; }

    public clearItemData(): void {
        this._itemStacks.clear(); this._itemTotals.clear(); this._itemsLoaded = false;
    }

    public updateItemData(itemUid: any, itemId: number, itemCnt: number): boolean {
        const row = normalizeItemStack({ itemUid, itemId, itemCnt });
        if (!row) return false;
        // 删除后保留该道具已知为零的语义，避免回退到旧资源快照。
        const previous = this._itemStacks.get(row.itemUid);
        if (previous) this._itemTotals.set(previous.itemId, 0);
        if (row.itemId > 0) this._itemTotals.set(row.itemId, 0);
        if (row.itemCnt === 0) this._itemStacks.delete(row.itemUid);
        else this._itemStacks.set(row.itemUid, { itemId: row.itemId, count: row.itemCnt });
        this.rebuildItemTotals();
        return true;
    }

    /** 全量包是替换而非累加；全部校验成功后才切换快照。 */
    public replaceItemData(rows: any[]): boolean {
        if (!Array.isArray(rows)) return false;
        const next = new Map<string, { itemId: number; count: number }>(), seen = new Set<string>();
        for (const value of rows) {
            const row = normalizeItemStack(value);
            if (!row || seen.has(row.itemUid)) return false;
            seen.add(row.itemUid);
            if (row.itemCnt > 0) next.set(row.itemUid, { itemId: row.itemId, count: row.itemCnt });
        }
        this._itemStacks = next;
        this._itemTotals.clear(); this.rebuildItemTotals(); this._itemsLoaded = true;
        return true;
    }

    public getInventoryItems(): InventoryItem[] {
        const rows = new Map<number, InventoryItem>();
        this._itemStacks.forEach(stack => {
            const row = rows.get(stack.itemId) || { itemId: stack.itemId, count: 0, stacks: 0 };
            row.count += stack.count; row.stacks++; rows.set(stack.itemId, row);
        });
        return Array.from(rows.values()).sort((a, b) => a.itemId - b.itemId);
    }

    private rebuildItemTotals(): void {
        this._itemTotals.forEach((_, id) => this._itemTotals.set(id, 0));
        this._itemStacks.forEach(stack => this._itemTotals.set(stack.itemId, (this._itemTotals.get(stack.itemId) || 0) + stack.count));
    }

    public hasItemCount(itemId: number): boolean {
        return this._itemsLoaded || this._itemTotals.has(itemId) || this.resourceItem(itemId) !== undefined;
    }

    public getItemCount(itemId: number): number {
        // 推送为 0 也表示明确的余额，不能退回到旧的资源快照。
        return this._itemTotals.has(itemId) ? this._itemTotals.get(itemId)!
            : this._itemsLoaded ? 0 : Math.max(0, toProtoInt(this.resourceItem(itemId)?.v));
    }

    private resourceItem(itemId: number): any | undefined {
        return this._roleResData?.resList?.find(row => Number(row?.k) === itemId);
    }


    public saveLoginData(data: any): void {
        this._loginData = data;
        if (this._loginData) {
            this._loginData.userId = toProtoId(this._loginData.userId);
            this._loginData.serverId = toProtoInt(this._loginData.serverId);
        }
    }

    public getLoginData(): any {
        return this._loginData;
    }

    public getToken(): string {
        return this._token;
    }

    public getSession(): string {
        return this._loginData.session;
    }

    public setLoginDataUserAndServerId(data): void {
        this._loginData.userId = toProtoId(data.userId);
        this._loginData.serverId = toProtoInt(data.serverId);
        this.serverId = this._loginData.serverId;
    }
}
