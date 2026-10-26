import { ServerConfig } from "../config/ServerConfig";
import { NetManager } from "../network/socket/NetManager";
import { Tools } from "../utils/Tools";
import LoginProxy, { toProtoInt, toProtoId } from "./LoginProxy";
import { NetEvent } from "../network/socket/NetInterface";
import MapCommand from "../map/MapCommand";
import { LocalCache } from "../utils/LocalCache";
import DateUtil from "../utils/DateUtil";
import { EventMgr } from "../utils/EventMgr";
import { Md5 } from "../libs/crypto/md5";
import { HeadIconFeedback, LogicEvent } from "../common/LogicEvent";
import { ProtoManager } from "../network/pto/ProtoManager";
import HeadIconProxy from './HeadIconProxy';
import SystemOpenCommand from '../systemopen/SystemOpenCommand';

/** 心跳间隔。短于常见 NAT 的 30 秒空闲断开 */
const HEARTBEAT_INTERVAL_MS = 5000;
/** 连续大约 3 次没收到回包就当掉线 */
const HEARTBEAT_TIMEOUT_MS = 15000;

export interface CityPosition { x: number; y: number; }
function validCityPosition(pos: any): pos is CityPosition {
    return !!pos && Number.isInteger(pos.x) && Number.isInteger(pos.y)
        && pos.x >= 0 && pos.y >= 0 && pos.x < 1000 && pos.y < 1000;
}
function sameCityPosition(a: CityPosition | null, b: CityPosition | null): boolean {
    return !!a && !!b && a.x === b.x && a.y === b.y;
}

export default class LoginCommand {
    //单例
    protected static _instance: LoginCommand;
    public static getInstance(): LoginCommand {
        if (this._instance == null) {
            this._instance = new LoginCommand();
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

    //数据model
    protected _proxy: LoginProxy = new LoginProxy();
    public readonly headIcons = new HeadIconProxy();
    private _serverReady = false;
    private _baseInfoReady = false;
    private _mapDataRequested = false;
    private _clientLoaded = false;
    private _loadOkSent = false;
    private _loadOkAcknowledged = false;
    private _pendingHeadIcon = 0;
    private _headChangeTimer: ReturnType<typeof setTimeout> | null = null;
    private _moveCityTimer: ReturnType<typeof setTimeout> | null = null;
    private _pendingMoveCity: CityPosition | null = null;
    // 超时后保留目标以接收迟到的确认；新请求或断线会替换/清除它。
    private _lastMoveCityTarget: CityPosition | null = null;
    private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    /** 最近一次收到 s2c_heart_beat 的单调钟 */
    private _lastHeartbeatMono: number = 0;
    /** 本次断线是否正在自动重连，登录验证完成后恢复主界面 */
    private _reconnecting: boolean = false;

    constructor() {
        SystemOpenCommand.getInstance();
        EventMgr.on(NetEvent.ServerCheckLogin, this.onServerConneted, this);
        EventMgr.on(NetEvent.ServerDisconnected, this.onDisconnected, this);
        EventMgr.on(NetEvent.ServerReconnecting, this.onServerReconnecting, this);
        EventMgr.on(NetEvent.ServerReconnectFailed, this.onReconnectFailed, this);
        EventMgr.on(LogicEvent.enterLogin, this.onEnterLogin, this);
        EventMgr.on(ServerConfig.s2c_user_login, this.onAccountLogin, this);
        EventMgr.on(ServerConfig.s2c_heart_beat, this.setServerTime, this);
        EventMgr.on(ServerConfig.s2c_user_login_ok, this.onEnterServer, this);
        EventMgr.on(ServerConfig.s2c_user_base_info, this.onGetUserBaseInfo, this);
        EventMgr.on(ServerConfig.s2c_req_user_res, this.onGetUserRes, this);
        EventMgr.on(ServerConfig.s2c_user_create, this.onUserCreate, this);
        EventMgr.on(ServerConfig.s2c_change_head_icon, this.onHeadIconChanged, this);
        EventMgr.on(ServerConfig.s2c_client_load_ok, this.onClientLoadOk, this);
        EventMgr.on(ServerConfig.s2c_sync_soldier, this.onSyncSoldier, this);
        EventMgr.on(ServerConfig.s2c_sync_city_pos, this.onSyncCityPos, this);
        EventMgr.on(ServerConfig.s2c_move_city, this.onMoveCity, this);
        EventMgr.on(ServerConfig.s2c_sync_item_data, this.onSyncItemData, this);
        EventMgr.on(ServerConfig.s2c_sync_user_res_list, this.onSyncUserResList, this);

        EventMgr.on(ServerConfig.account_reLogin, this.onAccountRelogin, this);
        EventMgr.on(ServerConfig.account_logout, this.onAccountLogout, this);
        EventMgr.on(ServerConfig.account_robLogin, this.onAccountRobLogin, this)

    }

    public onDestory(): void {
        this.stopHeartbeat();
        this.resetClientState();
        EventMgr.targetOff(this);
    }

    public resetClientState(): void {
        this._serverReady = false;
        this._baseInfoReady = false;
        this._mapDataRequested = false;
        this._clientLoaded = false;
        this._loadOkSent = false;
        this._loadOkAcknowledged = false;
        this.finishHeadChange();
        this.clearMoveCity();
        this.headIcons.clear();
        SystemOpenCommand.getInstance().clearData();
    }

    public get changingHeadIcon(): boolean { return this._pendingHeadIcon > 0; }
    public get clientLoadAcknowledged(): boolean { return this._loadOkAcknowledged; }

    public get movingCity(): boolean { return this._pendingMoveCity !== null; }

    public cityMoveIssue(pos: CityPosition): string {
        if (!this._serverReady || !this._baseInfoReady || !this._clientLoaded) return '主城信息尚未同步，请稍后重试';
        if (!validCityPosition(pos)) return '迁城坐标无效';
        if (this.movingCity) return '正在迁城，请等待服务器确认';
        if (sameCityPosition(this._proxy.getRoleData()?.cityPos, pos)) return '主城已在此处';
        // 尚未收到物品快照时不把未知数量当作零，最终消耗由服务端判断。
        if (this._proxy.hasItemCount(1001) && this._proxy.getItemCount(1001) < 1) return '迁城令不足';
        return '';
    }

    public moveCity(pos: CityPosition): boolean {
        const issue = this.cityMoveIssue(pos);
        if (issue) { EventMgr.emit(LogicEvent.showToast, issue); return false; }
        const target = { x: pos.x, y: pos.y };
        this._pendingMoveCity = target;
        this._lastMoveCityTarget = target;
        this._moveCityTimer = setTimeout(() => {
            this.finishMoveCity();
            EventMgr.emit(LogicEvent.showToast, '迁城响应超时，请确认主城位置后重试');
        }, 8000);
        EventMgr.emit(LogicEvent.cityMoveState);
        if (!this.sendUserMessage(ServerConfig.c2s_move_city, { pos: target })) {
            this.clearMoveCity();
            EventMgr.emit(LogicEvent.showToast, '迁城请求发送失败，请重试');
            return false;
        }
        return true;
    }

    private finishMoveCity(): void {
        if (this._moveCityTimer !== null) clearTimeout(this._moveCityTimer);
        this._moveCityTimer = null;
        const pending = this.movingCity;
        this._pendingMoveCity = null;
        if (pending) EventMgr.emit(LogicEvent.cityMoveState);
    }

    private clearMoveCity(): void {
        this._lastMoveCityTarget = null;
        this.finishMoveCity();
    }

    private applyCityPosition(pos: CityPosition): boolean {
        if (!this._serverReady || !this._baseInfoReady || !validCityPosition(pos)) return false;
        const role = this._proxy.getRoleData();
        if (!role) return false;
        if (!sameCityPosition(role.cityPos, pos)) {
            this._proxy.setCityPos(pos);
            // 既有地图城池缓存移除旧占地，WorldCommand 同步更新 AOI 焦点。
            EventMgr.emit(LogicEvent.updateCityPosition, role.cityPos);
        }
        return true;
    }

    private confirmCityPosition(pos: CityPosition): void {
        if (!sameCityPosition(this._lastMoveCityTarget, pos)) return;
        this.clearMoveCity();
        EventMgr.emit(LogicEvent.scrollToMap, pos.x, pos.y);
        EventMgr.emit(LogicEvent.showToast, `主城已迁至（${pos.x}，${pos.y}）`);
    }

    private onMoveCity(data: any): void {
        // ACK 不带请求序号，不能让上次请求的迟到确认解锁或覆盖新的目标。
        if (!validCityPosition(data?.cityPos) || !sameCityPosition(this._lastMoveCityTarget, data.cityPos)) return;
        if (this.applyCityPosition(data.cityPos)) this.confirmCityPosition(data.cityPos);
    }

    public isHeadIconOpen(): boolean {
        const systems = SystemOpenCommand.getInstance();
        const config = systems.proxy.getConfigByEnum('HEAD_ICON');
        return !!config && systems.isSystemOpen(config.Id);
    }

    public changeHeadIcon(id: number): boolean {
        if (this.changingHeadIcon || id === this._proxy.getRoleData()?.headIcon) return false;
        if (!this.headIcons.getConfig(id)) {
            this.showHeadIconFeedback('该头像未配置');
            return false;
        }
        if (!this.isHeadIconOpen()) {
            this.showHeadIconFeedback('更换头像尚未开放');
            return false;
        }
        if (!this._serverReady || !this._baseInfoReady || !this._clientLoaded) {
            this.showHeadIconFeedback('正在连接服务器，请稍后再试');
            return false;
        }
        this._pendingHeadIcon = id;
        this._headChangeTimer = setTimeout(() => {
            this.finishHeadChange();
            this.showHeadIconFeedback('更换头像响应超时，请重试');
        }, 8000);
        EventMgr.emit(LogicEvent.headIconChangeState);
        if (!this.sendUserMessage(ServerConfig.c2s_change_head_icon, { headIcon: id })) {
            this.finishHeadChange();
            this.showHeadIconFeedback('头像请求发送失败，请重试');
            return false;
        }
        return true;
    }

    private showHeadIconFeedback(message: string): void {
        const feedback: HeadIconFeedback = { message, handled: false };
        EventMgr.emit(LogicEvent.headIconFeedback, feedback);
        if (!feedback.handled) EventMgr.emit(LogicEvent.showToast, message);
    }

    private finishHeadChange(): void {
        if (this._headChangeTimer !== null) clearTimeout(this._headChangeTimer);
        this._headChangeTimer = null;
        const wasPending = this.changingHeadIcon;
        this._pendingHeadIcon = 0;
        if (wasPending) EventMgr.emit(LogicEvent.headIconChangeState);
    }

    private onHeadIconChanged(data: any): void {
        if (!this._serverReady || !this._baseInfoReady) return;
        const requested = this._pendingHeadIcon;
        this.finishHeadChange();
        const id = toProtoInt(data?.headIcon);
        if (!Number.isInteger(id) || id <= 0) {
            if (requested) this.showHeadIconFeedback('更换头像未成功');
            return;
        }
        this._proxy.setHeadIcon(id);
        EventMgr.emit(LogicEvent.updateMyRole);
        if (requested) this.showHeadIconFeedback(id === requested ? '头像已更换' : '已同步服务器头像');
    }

    /** 仅在地图、界面和必要资源全部就绪后调用；每次连接只通知一次。 */
    public notifyClientLoaded(): void {
        this._clientLoaded = true;
        this.trySendClientLoadOk();
    }

    private trySendClientLoadOk(): void {
        if (!this._clientLoaded || !this._serverReady || !this._baseInfoReady || this._loadOkSent) return;
        this._loadOkSent = this.sendUserMessage(ServerConfig.c2s_client_load_ok, {});
    }

    private onClientLoadOk(): void {
        if (!this._serverReady || !this._loadOkSent) return;
        // 该协议为空消息，只确认加载状态，不携带玩家头像。
        this._loadOkAcknowledged = true;
    }

    private sendUserMessage(name: string, data: object): boolean {
        const proto = ProtoManager.getInstance();
        if (!proto.isReady() || !proto.getIdByMsgType(name)) return false;
        const bytes = proto.encode(name, data);
        if (!bytes) return false;
        try {
            NetManager.getInstance().send({ name, msg: bytes });
            return true;
        } catch (error) {
            console.warn(`发送失败: ${name}`, error);
            return false;
        }
    }

    private onSyncSoldier(data: any): void {
        if (!this._serverReady || !data?.soldierInfo) return;
        this._proxy.setSoldierInfo(data.soldierInfo);
        EventMgr.emit(LogicEvent.updateSoldier, this._proxy.getRoleData()?.soldierInfo);
        EventMgr.emit(LogicEvent.updateMyRole);
    }

    private onSyncCityPos(data: any): void {
        if (this.applyCityPosition(data?.cityPos)) this.confirmCityPosition(data.cityPos);
    }

    private onDisconnected(): void {
        this.stopHeartbeat();
        this._serverReady = false;
        this._baseInfoReady = false;
        this._mapDataRequested = false;
        this._loadOkSent = false;
        this._loadOkAcknowledged = false;
        this.finishHeadChange();
        this.clearMoveCity();
    }

    //抢登录
    private onAccountRobLogin(): void {
        console.log("onAccountRobLogin")
        EventMgr.emit(LogicEvent.robLoginUI);
    }

    /**玩家基础信息*/
    private onGetUserBaseInfo(data: any): void {
        if (!data || !this._serverReady) return;
        EventMgr.emit(NetEvent.ServerSessionReady);
        if (this._reconnecting) {
            this._reconnecting = false;
            EventMgr.emit(NetEvent.ServerReconnectSuccess);
        }
        if (!data.name) {
            this._baseInfoReady = false;
            EventMgr.emit(LogicEvent.createRole);
            return;
        }
        else {
            data.userId = this._proxy.getLoginData().userId;
            this._proxy.saveEnterData(data);
            this._baseInfoReady = true;
            EventMgr.emit(LogicEvent.updateMyRole);
            EventMgr.emit(LogicEvent.enterMap);
            // 重连时保留已加载地图，基础信息同步后重新通知服务端。
            if (this._clientLoaded) this.beginMapLoading();
            this.trySendClientLoadOk();
        }
    }

    /** 首次进入由 Main 在加载页首帧之后调用；重连则在基础信息恢复后补发。 */
    public beginMapLoading(): void {
        if (!this._serverReady || !this._baseInfoReady || this._mapDataRequested) return;
        this._mapDataRequested = this.sendUserMessage(ServerConfig.c2s_req_user_res, {});
        SystemOpenCommand.getInstance().requestSystemOpen();
    }

    /**玩家资源*/
    private onGetUserRes(data: any): void {
        if (!data) return;
        this._proxy.setRoleResData(data);
        // 资源回包只同步数据；不能用它决定是否进入加载页。
        EventMgr.emit(LogicEvent.upateMyRoleRes);
    }

    /**物品数量同步，主界面资源栏跟着刷新*/
    private onSyncItemData(data: any): void {
        if (!data) {
            return;
        }
        if (!this._proxy.updateItemData(data.itemUid, data.itemId, data.itemCnt)) return;
        EventMgr.emit(LogicEvent.itemSynced, data);
        EventMgr.emit(LogicEvent.upateMyRoleRes);
    }

    /**资源列表增量同步*/
    private onSyncUserResList(data: any): void {
        if (!data || !Array.isArray(data.resList)) {
            return;
        }
        const roleRes = this._proxy.getRoleResData();
        if (!roleRes || !Array.isArray(roleRes.resList)) {
            this._proxy.setRoleResData({ resList: data.resList.slice() });
        } else {
            const merged: Map<number, number> = new Map();
            for (const item of roleRes.resList) {
                if (item && item.k !== undefined) {
                    merged.set(Number(item.k), Number(item.v) || 0);
                }
            }
            for (const item of data.resList) {
                if (item && item.k !== undefined) {
                    merged.set(Number(item.k), Number(item.v) || 0);
                }
            }
            roleRes.resList = Array.from(merged.entries()).map(([k, v]) => ({ k, v }));
        }
        EventMgr.emit(LogicEvent.upateMyRoleRes);
    }

    /**创建玩家*/
    private onUserCreate(data: any): void {
        if (!this._serverReady || !data || !data.name) return;
        this._proxy.saveEnterData(data);
        this._baseInfoReady = true;
        console.info('[RoleCreate] 创建成功，切换加载页');
        // 与已有角色保持一致：创建成功立即显示进度页，其它资源在加载阶段就绪。
        EventMgr.emit(LogicEvent.enterMap);
    }

    /**登录回调*/
    private onAccountLogin(data: any): void {
        console.log("LoginProxy  login:", data);

        this._proxy.saveLoginData(data);
        LocalCache.setLoginValidation(data);

        EventMgr.emit(LogicEvent.loginComplete, data.code);
    }

    /** 心跳回包。heartBeatTime 是服务器 unix 秒，倒计时在这之上加单调钟 */
    private setServerTime(data: any): void {
        if (!data) {
            return;
        }
        DateUtil.setServerTime(data.heartBeatTime);
        this._lastHeartbeatMono = DateUtil.monotonicNow();
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this._lastHeartbeatMono = DateUtil.monotonicNow();
        this.sendHeartbeat();
        this._heartbeatTimer = setInterval(() => this.tickHeartbeat(), HEARTBEAT_INTERVAL_MS);
    }

    private stopHeartbeat(): void {
        if (this._heartbeatTimer !== null) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
    }

    private tickHeartbeat(): void {
        const silent = DateUtil.monotonicNow() - this._lastHeartbeatMono;
        if (silent >= HEARTBEAT_TIMEOUT_MS) {
            console.log("heartbeat timeout", silent);
            this.stopHeartbeat();
            NetManager.getInstance().dropConnection();
            return;
        }
        this.sendHeartbeat();
    }

    private sendHeartbeat(): void {
        const msgName = ServerConfig.c2s_heart_beat;
        const protoData = ProtoManager.getInstance().encode(msgName, {});
        if (!protoData) {
            return;
        }
        NetManager.getInstance().send({
            name: msgName,
            msg: protoData,
        });
    }

    /**进入服务器回调*/
    private onEnterServer(data: any): void {
        console.log("LoginProxy  enter:", data);
        // MapCommand.getInstance()
        // EventMgr.emit(LogicEvent.enterMap);
        this._proxy.setLoginDataUserAndServerId(data);
        this._serverReady = true;
        this._baseInfoReady = false;
        this._mapDataRequested = false;

        var msgName = ServerConfig.c2s_user_base_info;

        // 使用 ProtoManager 编码
        // 注意：这里需要根据你的 .proto 文件里的定义来写
        // 假设 login.proto 里定义的请求消息是 c2s_user_login，并且在 Login 包下
        var protoData = ProtoManager.getInstance().encode(msgName, {
        });

        if (!protoData) {
            console.error("Failed to encode login request");
            return;
        }

        var sendData = {
            name: msgName,
            msg: protoData, // 这里直接传 Uint8Array
        };
        NetManager.getInstance().send(sendData);
        this.startHeartbeat();
    }

    /** 网关重连成功后重新验证，不走旧的 account.reLogin */
    private onServerConneted(): void {
        const loginData = this._proxy.getLoginData();
        console.log("LoginProxy  conneted:", loginData);

        if (loginData && loginData.token) {
            this.role_enterServer(loginData);
            return;
        }
        this._reconnecting = false;
        EventMgr.emit(NetEvent.ServerHandShake);
    }

    private onReconnectFailed(): void {
        this.stopHeartbeat();
        this._reconnecting = false;
    }

    private onServerReconnecting(): void {
        this._reconnecting = true;
    }

    private onEnterLogin(): void {
        this.stopHeartbeat();
        this._reconnecting = false;
        this.resetClientState();
    }

    /**重新登录回调回调*/
    private onAccountRelogin(data: any): void {
        //断线重新登录
        console.log("LoginProxy  relogin:", data);
        if (data.code == 0) {
            // EventMgr.emit(NetEvent.ServerHandShake);
            // this.role_enterServer(this._proxy.getSession());
        }
    }

    /**登出回调*/
    private onAccountLogout(data: any): void {
        //重换成功再次调用
        this._proxy.clear();
        EventMgr.emit(LogicEvent.enterLogin);

    }




    //聊天登录
    private onChatLogin(data: any): void {
        console.log("onChatLogin:", data);
    }

    public get proxy(): LoginProxy {
        return this._proxy;
    }

    /**
     * login
     * @param data 
     */
    public accountLogin(name: string, password: string) {

        var msgName = ServerConfig.c2s_user_login;
        var pwd = Md5.encrypt(password);

        // 使用 ProtoManager 编码
        // 注意：这里需要根据你的 .proto 文件里的定义来写
        // 假设 login.proto 里定义的请求消息是 c2s_user_login，并且在 Login 包下
        var protoData = ProtoManager.getInstance().encode(msgName, {
            account: name,
            passwd: pwd,
            accountType: 1, // 根据 proto 定义补充字段
            appId: "",
            cchid: "",
            serverId: 120,
            userId: 0
        });

        if (!protoData) {
            console.error("Failed to encode login request");
            return;
        }

        var send_data = {
            name: msgName,
            msg: protoData, // 这里直接传 Uint8Array
        };

        console.log("accountLogin:", send_data);
        NetManager.getInstance().send(send_data);
    }


    /**
     * create
     * @param uid 
     * @param nickName 
     * @param sex 
     * @param sid 
     * @param headId 
     */
    public role_create(uid: number, nickName: string, sex: number = 0, sid: number = 0, headId: number = 0): boolean {
        var msgName = ServerConfig.c2s_user_create;
        var protoData = ProtoManager.getInstance().encode(msgName, {
            sex: sex,
            name: nickName,
        });
        if (!protoData) return false;
        var send_data = {
            name: msgName,
            msg: protoData, // 这里直接传 Uint8Array
        };
        NetManager.getInstance().send(send_data);
        return true;
    }


    public role_enterServer(loginData) {
        var msgName = ServerConfig.c2s_verify_login;

        // 使用 ProtoManager 编码
        // 注意：这里需要根据你的 .proto 文件里的定义来写
        // 假设 login.proto 里定义的请求消息是 c2s_user_login，并且在 Login 包下
        var protoData = ProtoManager.getInstance().encode(msgName, {
            userId: toProtoId(loginData.userId),
            passwd: loginData.passwd,
            token: loginData.token, // 根据 proto 定义补充字段
        });
        var send_data = {
            name: msgName,
            msg: protoData, // 这里直接传 Uint8Array
        };
        NetManager.getInstance().send(send_data);
    }

    /**
     * 重新登录
     * @param session 
     */
    public account_reLogin(session: string) {
        var api_name = ServerConfig.account_reLogin;
        var send_data = {
            name: api_name,
            msg: {
                session: session,
                hardware: Tools.getUUID()
            }
        };
        NetManager.getInstance().send(send_data);
    }


    /**
     * logout
     */
    public account_logout(): void {
        // 主动退出必须在断网或服务器未回包时也能完成；关闭连接同时取消自动重连。
        NetManager.getInstance().close();
        this._proxy.clear();
        EventMgr.emit(LogicEvent.enterLogin);
    }



}
