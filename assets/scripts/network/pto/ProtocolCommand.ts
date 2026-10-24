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

/** 统一连接生命周期：断线后丢弃请求锁，不自动重放任何写操作。 */
export default abstract class ProtocolCommand {
    protected ready = false;
    private pending = new Map<string, ReturnType<typeof setTimeout>>();

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

    protected send(name: string, data: object): boolean {
        const proto = ProtoManager.getInstance();
        if (!this.ready || !proto.isReady() || !proto.getIdByMsgType(name)) return false;
        const bytes = proto.encode(name, data);
        if (!bytes) return false;
        try {
            NetManager.getInstance().send({ name, msg: bytes });
            return true;
        } catch (error) {
            console.warn('协议发送失败', name, error);
            return false;
        }
    }

    protected isPending(key: string): boolean { return this.pending.has(key); }
    public requestInFlight(key: string): boolean { return this.pending.has(key); }
    public get sessionReady(): boolean { return this.ready; }
    protected finish(key: string): void {
        const wasPending = this.pending.has(key);
        if (wasPending) clearTimeout(this.pending.get(key));
        this.pending.delete(key);
        if (wasPending) EventMgr.emit(LogicEvent.protocolRequestChanged);
    }

    /** 无请求序号的列表/写操作同一时刻只发一次；超时允许用户重试。 */
    protected request(name: string, data: object, key = name, onTimeout?: () => void): boolean {
        if (this.isPending(key) || !this.ready) return false;
        this.pending.set(key, setTimeout(() => {
            this.finish(key);
            if (onTimeout) onTimeout();
            EventMgr.emit(LogicEvent.showToast, '服务器响应超时，请重试');
        }, 8000));
        if (this.send(name, data)) { EventMgr.emit(LogicEvent.protocolRequestChanged); return true; }
        this.finish(key);
        return false;
    }
}
