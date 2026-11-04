import { ServerConfig } from '../../config/ServerConfig';
import { LogicEvent } from '../../common/LogicEvent';
import { EventMgr } from '../../utils/EventMgr';
import { NetEvent } from '../socket/NetInterface';
import { NetManager } from '../socket/NetManager';
import { ProtoManager } from './ProtoManager';

/** 新协议直接返回 protobuf 对象；只有旧 code/msg 信封才需要解包。 */
export function protocolPayload(data: any): any {
    if (!data || typeof data !== 'object') return null;
    if (data.code !== undefined) return Number(data.code) === 0 ? (data.msg || {}) : null;
    return data;
}

export function idKey(id: any): string { return id == null ? '0' : String(id); }
export function hasId(id: any): boolean { return /^[1-9]\d*$/.test(idKey(id)); }
export function uint(value: number, allowZero = false): boolean {
    return Number.isInteger(value) && value >= (allowZero ? 0 : 1) && value <= 0xffffffff;
}

interface PendingQuery {
    send: () => boolean;
    failures: number;
    timer: ReturnType<typeof setTimeout> | null;
}

/** 统一连接生命周期：断线后丢弃请求锁，不自动重放任何写操作。 */
export default abstract class ProtocolCommand {
    protected ready = false;
    private pending = new Map<string, ReturnType<typeof setTimeout>>();
    private queries = new Map<string, PendingQuery>();
    private reconciliations: { prefix: string; refresh: () => boolean; requested: boolean }[] = [];

    constructor() {
        EventMgr.on(ServerConfig.s2c_user_login_ok, this.onLogin, this);
        EventMgr.on(ServerConfig.s2c_client_load_ok, this.onLoaded, this);
        EventMgr.on(NetEvent.ServerDisconnected, this.clearData, this);
        EventMgr.on(LogicEvent.enterLogin, this.clearData, this);
    }

    private onLogin(): void { this.ready = true; }
    private onLoaded(): void { if (this.ready) this.onSessionReady(); }
    protected onSessionReady(): void {}
    protected abstract reset(): void;

    public clearData(): void {
        this.ready = false;
        this.pending.forEach(timer => clearTimeout(timer));
        this.pending.clear();
        this.queries.forEach(query => { if (query.timer !== null) clearTimeout(query.timer); });
        this.queries.clear();
        this.reconciliations.forEach(entry => entry.requested = false);
        this.reset();
        EventMgr.emit(LogicEvent.protocolRequestChanged);
    }

    public onDestory(): void { this.clearData(); EventMgr.targetOff(this); }

    protected listen(name: string, handler: (data: any) => void): void {
        EventMgr.on(name, (data: any) => {
            const payload = protocolPayload(data);
            if (this.ready && payload) handler.call(this, payload);
        }, this);
    }

    /** 旧服务端的业务拒绝只有文字；先查权威快照，不能把通用提示当成所有请求的失败回包。 */
    protected reconcileOnNotice(messages: readonly string[], prefix: string, refresh: () => boolean): void {
        const entry = { prefix, refresh, requested: false };
        this.reconciliations.push(entry);
        this.listen(ServerConfig.s2c_tell_me, data => {
            if (messages.indexOf(String(data.msg || '').trim()) < 0
                || !Array.from(this.pending.keys()).some(key => key.startsWith(prefix))) return;
            entry.requested = true;
            entry.refresh();
        });
    }

    /** 服务端按玩家串行处理：后发的快照只确认此前请求，不能释放快照之后新发的同名请求。 */
    protected capturePending(prefix: string): () => void {
        const pending = Array.from(this.pending).filter(([key]) => key.startsWith(prefix));
        const entry = this.reconciliations.find(item => item.prefix === prefix);
        if (entry) entry.requested = false;
        return () => {
            for (const [key, timer] of pending) if (this.pending.get(key) === timer) this.finish(key);
            // 拦截发生时若已有旧查询在途，等它结束后再查一次，不能用旧快照结束新操作。
            if (entry?.requested) entry.refresh();
        };
    }

    protected send(name: string, data: object): boolean {
        const proto = ProtoManager.getInstance();
        if (!this.ready || !proto.isReady() || !proto.getIdByMsgType(name)) return false;
        const bytes = proto.encode(name, data);
        if (!bytes) return false;
        try {
            return NetManager.getInstance().send({ name, msg: bytes }) !== false;
        } catch (error) {
            console.warn('协议发送失败', name, error);
            return false;
        }
    }

    protected isPending(key: string): boolean { return this.pending.has(key); }
    public requestInFlight(key: string): boolean { return this.pending.has(key); }
    public get sessionReady(): boolean { return this.ready; }
    protected finish(key: string): void {
        const query = this.queries.get(key);
        if (query && query.timer !== null) clearTimeout(query.timer);
        this.queries.delete(key);
        this.releasePending(key);
    }

    private releasePending(key: string): void {
        const wasPending = this.pending.has(key);
        if (wasPending) clearTimeout(this.pending.get(key));
        this.pending.delete(key);
        if (wasPending) EventMgr.emit(LogicEvent.protocolRequestChanged);
    }

    /** 仅查询可自动恢复；每次重新建立快照，失败后退避，不重放领奖、升级等写操作。 */
    protected query(key: string, send: () => boolean): boolean {
        if (!this.ready || this.isPending(key)) return false;
        this.finish(key);
        const query: PendingQuery = { send, failures: 0, timer: null };
        this.queries.set(key, query);
        return this.runQuery(key, query);
    }

    private runQuery(key: string, query: PendingQuery): boolean {
        if (!this.ready || this.queries.get(key) !== query) return false;
        query.timer = null;
        const sent = query.send();
        if (!sent) this.retryQuery(key);
        return sent;
    }

    protected retryQuery(key: string): void {
        this.releasePending(key);
        const query = this.queries.get(key);
        if (!this.ready || !query || query.timer !== null) return;
        const delay = Math.min(30000, 2000 * Math.pow(2, Math.min(query.failures++, 4)));
        query.timer = setTimeout(() => this.runQuery(key, query), delay);
    }

    /** 无请求序号的列表/写操作同一时刻只发一次；超时允许用户重试。 */
    protected request(name: string, data: object, key = name, onTimeout?: () => void, silentTimeout = false): boolean {
        if (this.isPending(key) || !this.ready) return false;
        const timer = setTimeout(() => {
            if (!this.ready || this.pending.get(key) !== timer) return;
            const query = this.queries.get(key);
            this.releasePending(key);
            if (!this.ready || this.pending.has(key)) return;
            if (onTimeout) onTimeout();
            if (!this.ready || this.pending.has(key)) return;
            if (query) {
                if (this.queries.get(key) === query) this.retryQuery(key);
            }
            else if (!silentTimeout) EventMgr.emit(LogicEvent.showToast, '服务器响应超时，请重试');
        }, 8000);
        this.pending.set(key, timer);
        if (this.send(name, data)) { EventMgr.emit(LogicEvent.protocolRequestChanged); return true; }
        this.releasePending(key);
        return false;
    }
}
