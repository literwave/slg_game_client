import { _decorator } from 'cc';
import { NetNode, NetConnectOptions } from "./NetNode";

export class NetManager {
    private static _instance: NetManager = null;
    protected _netNode: NetNode = null;
    public static getInstance(): NetManager {
        if (this._instance == null) {
            this._instance = new NetManager();
        }
        return this._instance;
    }
    constructor() {
        this._netNode = new NetNode();
        this._netNode.init();
    }

    public connect(options: NetConnectOptions): void {
        this._netNode.connect(options);
    }

    public send(send_data: any, force: boolean = false): boolean {
        return this._netNode.send(send_data, force);
    }

    public close(code?: number, reason?: string): void {
        this._netNode.closeSocket(code, reason);
    }

    public changeConnect(options: NetConnectOptions): void {
        this._netNode.changeConect(options);
    }
    public tryConnet(): void {
        this._netNode.tryConnet();
    }

    /** 丢掉当前连接并走重连。不会把自动重连次数清掉 */
    public dropConnection(): void {
        this._netNode.dropConnection();
    }
}
