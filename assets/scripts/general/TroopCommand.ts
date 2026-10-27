import { ServerConfig } from "../config/ServerConfig";
import { LogicEvent } from "../common/LogicEvent";
import { NetManager } from "../network/socket/NetManager";
import { ProtoManager } from "../network/pto/ProtoManager";
import { NetEvent } from "../network/socket/NetInterface";
import { EventMgr } from "../utils/EventMgr";
import TroopProxy, { HeroIndexMap, TroopPosition, toTroopProtocolPosition } from "./TroopProxy";
import GeneralCommand from "./GeneralCommand";

const TROOP_REQUEST_TIMEOUT_MS = 8000;

export default class TroopCommand {
    protected static _instance: TroopCommand;

    public static getInstance(): TroopCommand {
        if (this._instance == null) {
            this._instance = new TroopCommand();
        }
        return this._instance;
    }

    public static destory(): boolean {
        if (this._instance) {
            this._instance.onDestory();
            this._instance = null;
            return true;
        }
        return false;
    }

    protected _proxy: TroopProxy = new TroopProxy();
    private _active = false;
    private _serverReady = false;
    private _hasSnapshot = false;
    private _pendingTroopIdx = 0;
    private _listUpdates = new Map<number, any>();
    private _listTimer: ReturnType<typeof setTimeout> | null = null;
    private _editTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        EventMgr.on(ServerConfig.s2c_req_troop, this.onTroopList, this);
        EventMgr.on(ServerConfig.s2c_edit_troop, this.onEditTroop, this);
        EventMgr.on(ServerConfig.s2c_sync_troop, this.onSyncTroop, this);
        EventMgr.on(ServerConfig.s2c_user_login_ok, this.onServerReady, this);
        EventMgr.on(NetEvent.ServerDisconnected, this.onDisconnected, this);
    }

    public onDestory(): void {
        this.clearData();
        EventMgr.targetOff(this);
    }

    public get proxy(): TroopProxy {
        return this._proxy;
    }

    public clearData(): void {
        this._active = false;
        this._serverReady = false;
        this._hasSnapshot = false;
        this.finishListRequest();
        this._proxy.clearData();
        this._listUpdates.clear();
        this.finishEdit();
    }

    public get editingTroopIdx(): number {
        return this._pendingTroopIdx;
    }

    public get listReady(): boolean { return this._serverReady && this._hasSnapshot && this._listTimer === null; }
    public get listLoading(): boolean { return this._listTimer !== null; }

    /** 只在进入地图/打开编队后请求；重复打开面板复用已确认的数据。 */
    public requestTroops(force = false): boolean {
        this._active = true;
        if (!this._serverReady || this._pendingTroopIdx) return false;
        if (this._listTimer !== null || (this._hasSnapshot && !force)) return true;
        this._hasSnapshot = false;
        this._listUpdates.clear();
        this._listTimer = setTimeout(() => {
            this.finishListRequest();
            this._hasSnapshot = false;
            EventMgr.emit(LogicEvent.showToast, '部队数据同步超时，请重新打开编队重试');
        }, TROOP_REQUEST_TIMEOUT_MS);
        EventMgr.emit(LogicEvent.troopListState);
        if (!this.sendMessage(ServerConfig.c2s_req_troop, {})) {
            this.finishListRequest();
            return false;
        }
        return true;
    }

    /** 界面槽位 0～2 在协议边界转为 1～3，兵力始终跟随武将。 */
    public editTroop(troopIdx: number, heroIdxMap: HeroIndexMap, soldierCounts?: { [heroIdx: string]: number }): boolean {
        if (!this._serverReady) return this.rejectEdit('正在连接服务器，请稍后再试');
        if (this._pendingTroopIdx) return this.rejectEdit('编队正在保存，请稍候');
        // 未拿到完整快照时，不能用空阵容覆盖服务器上的其他位置。
        if (!this._hasSnapshot || this._listTimer !== null) {
            this.requestTroops();
            return this.rejectEdit('正在同步部队数据，请稍后再试');
        }
        const index = Number(troopIdx);
        if (!this.isValidId(index) || !heroIdxMap || typeof heroIdxMap !== 'object' || Array.isArray(heroIdxMap)) {
            return this.rejectEdit('编队数据无效，请重新打开编队');
        }
        const posMap: { [position: string]: TroopPosition } = {};
        if (soldierCounts && Object.keys(soldierCounts).some(id => heroIdxMap[id] === undefined)) {
            return this.rejectEdit('只能给当前编队中的武将配兵');
        }
        const heroIds = new Set<number>();
        for (const heroKey of Object.keys(heroIdxMap)) {
            const heroIdx = Number(heroKey);
            const position = Number(heroIdxMap[heroKey]);
            const protocolPosition = toTroopProtocolPosition(position);
            if (!this.isValidId(heroIdx) || !protocolPosition
                || posMap[String(protocolPosition)] !== undefined || heroIds.has(heroIdx)) {
                return this.rejectEdit('武将或上阵位置无效');
            }
            if (!GeneralCommand.getInstance().proxy.getMyGeneral(heroIdx)) {
                return this.rejectEdit('尚未拥有该武将，请刷新武将列表');
            }
            const assignedTroop = this._proxy.getTroopIdxByHero(heroIdx);
            if (assignedTroop && assignedTroop !== index) {
                return this.rejectEdit('该武将已在其他部队中，请先下阵');
            }
            heroIds.add(heroIdx);
            const slot: TroopPosition = { heroIdx, soldier: this._proxy.getTroop(index)?.getSoldier(heroIdx) || { count: 0, hurtCount: 0 } };
            posMap[String(protocolPosition)] = slot;
            if (soldierCounts && soldierCounts[heroKey] !== undefined) {
                const count = soldierCounts[heroKey];
                if (!Number.isInteger(count) || count < 0 || count > 0xffffffff) return this.rejectEdit('配兵数量无效');
                // 伤兵只能由服务器结算，不能被配兵操作转换成可用兵。
                slot.soldier.count = count;
            }
        }
        this._pendingTroopIdx = index;
        this._editTimer = setTimeout(() => {
            this._hasSnapshot = false;
            this.finishEdit();
            this.requestTroops(true);
            EventMgr.emit(LogicEvent.showToast, '编队保存响应超时，正在重新同步部队');
        }, TROOP_REQUEST_TIMEOUT_MS);
        EventMgr.emit(LogicEvent.troopEditState);
        if (!this.sendMessage(ServerConfig.c2s_edit_troop, { troopInfo: { troopIdx: index, posMap } })) {
            this.finishEdit();
            return this.rejectEdit('编队请求发送失败，请重试');
        }
        EventMgr.emit(LogicEvent.troopEditSubmitted, index);
        return true;
    }

    protected onTroopList(data: any): void {
        if (!this._active || !this._serverReady || this._pendingTroopIdx) return;
        this.finishListRequest();
        const payload = this.getPayload(data);
        const list = payload && (payload.troopList || payload.troop_list);
        if (!Array.isArray(list)) {
            this._hasSnapshot = false;
            EventMgr.emit(LogicEvent.showToast, '部队数据同步失败，请重试');
            return;
        }
        this._proxy.updateTroops(list);
        this._listUpdates.forEach(troop => this._proxy.updateTroop(troop));
        this._listUpdates.clear();
        this._hasSnapshot = true;
        EventMgr.emit(LogicEvent.updateTroopList, this._proxy.getTroops());
    }

    protected onEditTroop(data: any): void {
        if (!this._active || !this._serverReady) return;
        const payload = this.getPayload(data);
        const troop = payload && this._proxy.updateTroop(payload.troopInfo || payload.troop_info);
        if (!troop) {
            if (this._pendingTroopIdx) {
                this._hasSnapshot = false;
                this.finishEdit();
                this.requestTroops(true);
                EventMgr.emit(LogicEvent.showToast, '编队保存未确认，正在重新同步部队');
            }
            return;
        }
        const confirmed = troop.troopIdx === this._pendingTroopIdx;
        if (confirmed) this.finishEdit();
        EventMgr.emit(LogicEvent.updateTroopList, this._proxy.getTroops());
        EventMgr.emit(LogicEvent.updateTroop, troop);
    }

    private onSyncTroop(data: any): void {
        if (!this._serverReady) return;
        const troop = this._proxy.updateTroop(this.getPayload(data)?.troopInfo);
        if (!troop) return;
        if (this._listTimer !== null) this._listUpdates.set(troop.troopIdx, this.getPayload(data).troopInfo);
        EventMgr.emit(LogicEvent.updateTroopList, this._proxy.getTroops());
        EventMgr.emit(LogicEvent.updateTroop, troop);
    }

    private onServerReady(): void {
        this._serverReady = true;
        // 重连后重新取服务器阵容，不重发上次未确认的修改。
        if (this._active) this.requestTroops(true);
    }

    private onDisconnected(): void {
        this._serverReady = false;
        this._hasSnapshot = false;
        this.finishListRequest();
        const wasEditing = this._pendingTroopIdx > 0;
        this._listUpdates.clear();
        this.finishEdit();
        if (wasEditing) EventMgr.emit(LogicEvent.showToast, '连接已断开，重连后将重新同步编队');
    }

    private finishListRequest(): void {
        if (this._listTimer !== null) clearTimeout(this._listTimer);
        this._listTimer = null;
        EventMgr.emit(LogicEvent.troopListState);
    }

    private finishEdit(): void {
        if (this._editTimer !== null) clearTimeout(this._editTimer);
        this._editTimer = null;
        const wasEditing = this._pendingTroopIdx > 0;
        this._pendingTroopIdx = 0;
        if (wasEditing) EventMgr.emit(LogicEvent.troopEditState);
    }

    private isValidId(id: number): boolean {
        return Number.isInteger(id) && id > 0 && id <= 0xffffffff;
    }

    private rejectEdit(message: string): false {
        EventMgr.emit(LogicEvent.showToast, message);
        return false;
    }

    private sendMessage(name: string, payload: object): boolean {
        const proto = ProtoManager.getInstance();
        if (!proto.isReady() || !proto.getIdByMsgType(name)) return false;
        const bytes = proto.encode(name, payload);
        if (!bytes) return false;
        try {
            NetManager.getInstance().send({ name, msg: bytes });
            return true;
        } catch (error) {
            console.warn('部队协议发送失败:', name, error);
            return false;
        }
    }

    protected getPayload(data: any): any {
        if (!data) {
            return null;
        }
        const payload = data.msg && typeof data.msg === 'object' ? data.msg : data;
        if ((data.code != null && Number(data.code) !== 0) || (payload.code != null && Number(payload.code) !== 0)) {
            console.warn("Troop request failed:", data.code ?? payload.code);
            return null;
        }
        return payload;
    }
}
