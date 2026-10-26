import ProtocolCommand from '../network/pto/ProtocolCommand';
import { ServerConfig as S } from '../config/ServerConfig';
import { LogicEvent as E } from '../common/LogicEvent';
import LoginCommand from '../login/LoginCommand';
import { ItemStack, normalizeItemStack } from '../login/LoginProxy';
import { EventMgr } from '../utils/EventMgr';

/** 背包与资源栏共用 LoginProxy 的服务器物品数据，不在 UI 中发奖或扣除。 */
export default class InventoryCommand extends ProtocolCommand {
    private static instance: InventoryCommand;
    static getInstance(): InventoryCommand { return this.instance || (this.instance = new InventoryCommand()); }
    loadError = '';
    private changes: Map<string, ItemStack> | null = null;
    get loaded(): boolean { return LoginCommand.getInstance().proxy.itemsLoaded; }
    get loading(): boolean { return this.requestInFlight(S.c2s_req_all_item_data); }
    get items() { return LoginCommand.getInstance().proxy.getInventoryItems(); }

    constructor() {
        super();
        this.listen(S.s2c_req_all_item_data, this.onSnapshot);
        // LoginCommand 已应用单条增量；这里记录查询期间的变化并通知背包。
        EventMgr.on(E.itemSynced, this.onItemSynced, this);
    }
    protected onSessionReady(): void { this.requestItems(); }
    protected reset(): void {
        this.changes = null; this.loadError = '';
        LoginCommand.getInstance().proxy.clearItemData();
        this.changed();
    }
    requestItems(): boolean {
        if (!this.sessionReady || this.loading) return false;
        this.changes = new Map(); this.loadError = '';
        const sent = this.request(S.c2s_req_all_item_data, {}, S.c2s_req_all_item_data, () => {
            this.changes = null; this.loadError = '背包读取超时，请重试'; this.changed();
        });
        if (!sent) { this.changes = null; this.loadError = '背包请求未发送，请重试'; }
        this.changed(); return sent;
    }
    private onItemSynced(data: any): void {
        if (!this.sessionReady) return;
        const row = normalizeItemStack(data);
        if (!row) return;
        this.changes?.set(row.itemUid, row);
        this.changed();
    }
    private onSnapshot(data: any): void {
        if (!this.loading) return;
        const next = new Map<string, ItemStack>();
        const valid = Array.isArray(data.itemList) && data.itemList.every(value => {
            const row = normalizeItemStack(value);
            if (!row || next.has(row.itemUid)) return false;
            next.set(row.itemUid, row); return true;
        });
        if (valid) {
            // 查询过程中收到的增加/更新/删除不会被稍晚到达的旧快照覆盖。
            this.changes?.forEach(row => next.set(row.itemUid, row));
            LoginCommand.getInstance().proxy.replaceItemData(Array.from(next.values()));
            this.loadError = '';
        } else this.loadError = '背包数据读取失败，请重试';
        this.changes = null;
        this.finish(S.c2s_req_all_item_data);
        this.changed();
        if (valid) EventMgr.emit(E.upateMyRoleRes);
    }
    private changed(): void { EventMgr.emit(E.updateInventory); }
}
