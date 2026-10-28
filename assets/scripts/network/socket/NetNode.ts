
import { RequestObject, NetEvent } from "./NetInterface";
import { NetTimer } from "./NetTimer";
import { WebSock } from "./WebSock";
import { EventMgr } from "../../utils/EventMgr";


export enum NetTipsType {
    Connecting,
    ReConnecting,
    Requesting,
}

export enum NetNodeState {
    Closed,                     // 已关闭
    Connecting,                 // 连接中
    Checking,                   // 验证中
    Working,                    // 可传输数据
}


export enum NetNodeType {
    GateServer,                     //网关服务器
    ChatServer,                     //聊天服务器
    LoginServer,                    //登录服务器
}

export const MAX_RECONNECT_ATTEMPTS = 3;
export const CONNECTION_TIMEOUT_MS = 10 * 1000;
export const RECONNECT_DELAYS_MS: readonly number[] = [3000, 6000, 12000];


export interface NetConnectOptions {
    host?: string,              // 地址
    port?: number,              // 端口
    url?: string,               // url，与地址+端口二选一
    autoReconnect?: number,     // 0 不自动重连；最多 MAX_RECONNECT_ATTEMPTS 次
    type?: NetNodeType,          //服务器类型
}

export class NetNode {
    protected _connectOptions: NetConnectOptions = null;
    protected _autoReconnect: number = 0;
    protected _autoReconnectMax: number = MAX_RECONNECT_ATTEMPTS;
    protected _state: NetNodeState = NetNodeState.Closed;                   // 节点当前状态
    protected _socket: WebSock = null;                                      // Socket对象（可能是原生socket、websocket、wx.socket...)
    protected _timer: NetTimer = null;


    protected _keepAliveTimer: any = null;                                  // 心跳定时器
    protected _reconnectTimer: any = null;                                  // 重连定时器
    protected _connectTimer: ReturnType<typeof setTimeout> | null = null;   // 连接及登录验证共用的单次超时
    protected _reconnectAttempt: number = 0;                                // 当前第几次重连
    /** 这次断开后要重新走网关登录 */
    protected _relogin: boolean = false;
    /** 主动关掉，不要接着重连。回到登录页走这条 */
    protected _manualClose: boolean = false;
    protected _heartTime: number = 10 * 1000;                                 // 心跳间隔
    protected _receiveTime: number = 10 * 1000;                               // 多久没收到数据断开
    protected _requests: RequestObject[] = Array<RequestObject>();          // 请求列表
    protected _maxSeqId: number = 1000000;
    protected _seqId: number = 1;
    protected _invokePool: any = [];

    /********************** 网络相关处理 *********************/
    public init() {
        console.log(`NetNode init socket`);
        this._socket = new WebSock();
        this.initSocket();
        this._timer = new NetTimer();
        this.initTimer();
        this._invokePool = [];

    }

    public connect(options: NetConnectOptions): boolean {
        if (!options) return false;
        // 只有显式登录/切服才开启新一轮预算；自动重连不能调用此入口。
        this.closeSocket();
        this._connectOptions = { ...options };
        this._manualClose = false;
        const limit = options.autoReconnect;
        this._autoReconnectMax = Number.isFinite(limit) && limit >= 0
            ? Math.min(MAX_RECONNECT_ATTEMPTS, Math.floor(limit)) : MAX_RECONNECT_ATTEMPTS;
        this._autoReconnect = this._autoReconnectMax;
        this._reconnectAttempt = 0;
        return this.openSocket(options);
    }

    protected openSocket(options: NetConnectOptions): boolean {
        if (!this._manualClose && this._socket && this._state == NetNodeState.Closed) {
            this._state = NetNodeState.Connecting;
            this._connectTimer = setTimeout(() => {
                this._connectTimer = null;
                this.dropConnection();
            }, CONNECTION_TIMEOUT_MS);
            try {
                if (!this._socket.connect(options)) {
                    this.onClosed(null);
                    return false;
                }
            } catch (error) {
                this.onError(error);
                return false;
            }

            this.updateNetTips(NetTipsType.Connecting, true);
            return true;
        }
        return false;
    }


    /**
     * 更换线路
     * @param options 
     */
    public changeConect(options: NetConnectOptions) {
        if (options == this._connectOptions) {
            return;
        }

        if (this._state != NetNodeState.Closed) {
            this.closeSocket();
        }
        this.connect(options);
    }

    protected initSocket() {
        this._socket.onConnected = (event) => { this.onConnected(event) };
        this._socket.onUnpackMessage = (typeName, msg) => { this.onMessage(typeName, msg) };
        this._socket.onError = (event) => { this.onError(event) };
        this._socket.onClosed = (event) => { this.onClosed(event) };
        this._socket.onGetKey = () => { this.onGetKey() };

        EventMgr.on(NetEvent.ServerHandShake, this.onChecked, this);
        EventMgr.on(NetEvent.ServerSessionReady, this.onSessionReady, this);
    }


    protected onGetKey() {
        this._state = NetNodeState.Working;

        // if(this._connectOptions.type == NetNodeType.BaseServer){

        // }else{
        //     this.onChecked();
        // }

        // EventMgr.emit(NetEvent.ServerCheckLogin);

    }


    protected initTimer() {
        this._timer.init();
    }

    protected updateNetTips(tipsType: NetTipsType, isShow: boolean) {
        if (tipsType == NetTipsType.Requesting) {
            // EventMgr.emit(NetEvent.ServerRequesting, isShow);

        } else if (tipsType == NetTipsType.Connecting) {

        } else if (tipsType == NetTipsType.ReConnecting) {

        }
    }

    // 网络连接成功
    protected onConnected(event) {
        if (this._manualClose || this._state !== NetNodeState.Connecting) return;

        // 链路已可发送验证包；业务会话仍需等待 ServerSessionReady。
        this._state = NetNodeState.Working;

        // 网关必须等身份验证和基础信息完成，不能仅因 WebSocket 打开就重置重试次数。
        if (this._connectOptions?.type !== NetNodeType.GateServer) this.clearConnectTimer();
        console.log("websocket onConnected:", event);
        this.onGetKey()

        // 直接调用 onChecked 处理队列中的请求
        this.onChecked();

        if (this._relogin) {
            this._relogin = false;
            EventMgr.emit(NetEvent.ServerCheckLogin);
        }
    }

    // 连接验证成功，进入工作状态
    protected onChecked() {
        if (this._manualClose || this._state !== NetNodeState.Working) return;
        console.log("NetNode onChecked!")

        // 关闭连接或重连中的状态显示
        this.updateNetTips(NetTipsType.Connecting, false);
        this.updateNetTips(NetTipsType.ReConnecting, false);

        if (this._requests.length > 0) {
            const requests = this._requests.splice(0);
            for (let req of requests) {
                if (req.sended == false) {
                    this.socketSend(req);
                }

            }
            // 如果还有等待返回的请求，启动网络请求层
        }
    }

    protected onSessionReady(): void {
        if (this._manualClose || this._state !== NetNodeState.Working
            || this._connectOptions?.type !== NetNodeType.GateServer) return;
        this.clearConnectTimer();
        this._autoReconnect = this._autoReconnectMax;
        this._reconnectAttempt = 0;
    }

    // 接收到一个完整的消息包
    protected onMessage(typeName: string, msg): void {
        if (!this._manualClose && this._state === NetNodeState.Working && msg) {
            EventMgr.emit(typeName, msg);
        }
    }

    protected isHeartbeat(name: string): boolean {
        return !!name && name.indexOf("heart_beat") >= 0;
    }

    protected onError(event) {
        console.log("onError:", event);
        this.onClosed(event);
    }

    protected onClosed(event) {
        if (this._manualClose || this._state === NetNodeState.Closed) return;
        this.clearTimer();
        this._state = NetNodeState.Closed;
        this._requests.length = 0;
        this._socket?.close();
        EventMgr.emit(NetEvent.ServerDisconnected);
        this.tryConnet();
    }

    /**
     * 重连
     */
    public tryConnet() {
        if (this._manualClose || !this._connectOptions || this._reconnectTimer !== null
            || this._state !== NetNodeState.Closed) return;
        if (this.isAutoReconnect()) {
            // 快速拒绝连接也要留出恢复网络的时间，后续重试逐步延长等待。
            const retryDelayMs = RECONNECT_DELAYS_MS[this._reconnectAttempt];
            this._autoReconnect -= 1;
            this._reconnectAttempt += 1;
            this.updateNetTips(NetTipsType.ReConnecting, true);
            this._relogin = this._connectOptions.type === NetNodeType.GateServer;
            this._reconnectTimer = setTimeout(() => {
                this._reconnectTimer = null;
                if (!this._manualClose && this._connectOptions) this.openSocket(this._connectOptions);
            }, retryDelayMs);
            EventMgr.emit(NetEvent.ServerReconnecting, {
                attempt: this._reconnectAttempt,
                maxAttempts: this._autoReconnectMax,
                retryDelayMs,
            });
        } else {
            const state = { attempt: this._reconnectAttempt, maxAttempts: this._autoReconnectMax };
            this.closeSocket();
            EventMgr.emit(NetEvent.ServerReconnectFailed, state);
        }

    }

    /** 心跳超时或链路已死时关掉当前连接，交给重连。主动关闭请用 closeSocket */
    public dropConnection() {
        if (this._manualClose) return;
        if (this._state == NetNodeState.Closed) {
            this.tryConnet();
            return;
        }
        this.onClosed(null);
    }

    // 主动关闭。取消正在进行的重连，不再自动重连网关
    public closeSocket(code?: number, reason?: string) {
        const connected = this._state !== NetNodeState.Closed;
        this._manualClose = true;
        this._relogin = false;
        this._autoReconnect = 0;
        this._reconnectAttempt = 0;
        this.clearTimer();
        this._requests.length = 0;
        this._seqId = 1;
        this._state = NetNodeState.Closed;
        this._connectOptions = null;
        this._socket?.close(code, reason);
        if (connected) EventMgr.emit(NetEvent.ServerDisconnected);
    }




    public send(send_data: any, force: boolean = false): void {

        let requestIns = this.createInvoke();
        requestIns.dat = send_data;
        requestIns.name = send_data.name;
        // 回包由 onMessage 按协议名分发给 Command；没有通用的请求应答匹配事件。
        this.sendPack(requestIns, force);
    }

    // 正在建连时暂存请求；连接失败即丢弃，重连只重新发起登录验证。
    public sendPack(obj: RequestObject, force: boolean = false): boolean {
        // 登录页、重连间隔和已耗尽重试时，旧请求不能偷偷重新打开连接。
        if (this._manualClose || this._state === NetNodeState.Closed) return false;
        if (!this.isHeartbeat(obj && obj.name)) {
            console.log("this._state", this._state);
        }
        if (this._state == NetNodeState.Working || force) {
            this.socketSend(obj);
        }

        else if (this._state == NetNodeState.Checking ||
            this._state == NetNodeState.Connecting) {
            this._requests.push(obj);
        }

        else {
            console.error("NetNode request error! current state is " + this._state);
        }
        return false;
    }


    /**
     * 打包发送
     * @param obj 
     */
    public socketSend(obj: RequestObject) {
        obj.startTime = new Date().getTime()
        this._socket.packAndSend(obj.dat);
        this._seqId += 1;
        obj.sended = true;
    }


    /**
     * 心跳
     */
    public getHearbeat() {
        var obj = this.createInvoke();//new RequestObject();
        obj.dat = { name: "heartbeat", msg: { ctime: new Date().getTime() }, seq: 0 };
        obj.rspName = "heartbeat";
        obj.seq = 0;
        return obj;

    }


    /********************** 心跳、超时相关处理 *********************/
    protected cannelMsgTimer(data: any = null) {
        this._timer.cancel(data);
    }

    protected resetHearbeatTimer() {
        if (this._keepAliveTimer !== null) {
            clearInterval(this._keepAliveTimer);
        }

        this._keepAliveTimer = setInterval(() => {
            this.sendPack(this.getHearbeat());
        }, this._heartTime);
    }

    protected clearTimer() {
        this.clearConnectTimer();
        if (this._keepAliveTimer !== null) {
            clearTimeout(this._keepAliveTimer);
            this._keepAliveTimer = null;
        }
        if (this._reconnectTimer !== null) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        this._timer?.destroy();
    }

    private clearConnectTimer(): void {
        if (this._connectTimer !== null) {
            clearTimeout(this._connectTimer);
            this._connectTimer = null;
        }
    }

    public isAutoReconnect() {
        return !this._manualClose && this._autoReconnect > 0;
    }

    public rejectReconnect() {
        this.closeSocket();
    }






    protected createInvoke(): RequestObject {
        // console.log("createInvoke_invokePool :",this._invokePool.length)
        if (this._invokePool.length > 0) {
            return this._invokePool.shift();
        }
        return new RequestObject();
    }

    protected destroyInvoke(invoke: RequestObject): void {
        invoke.destroy();
        this._invokePool.push(invoke);
        // console.log("destroyInvoke_invokePool :",this._invokePool.length)
    }
}
