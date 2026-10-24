import { _decorator, Button, Color, Component, EditBox, Event, instantiate, Label, Node, Prefab, resources, Sprite } from 'cc';
const { ccclass, property } = _decorator;

import { LocalCache } from "../utils/LocalCache";
import LoginCommand from "./LoginCommand";
import { EventMgr } from '../utils/EventMgr';
import { AudioManager } from '../common/AudioManager';
import { LogicEvent } from '../common/LogicEvent';
import { NetManager } from "../network/socket/NetManager";
import { GameConfig } from '../config/GameConfig';
import { MAX_RECONNECT_ATTEMPTS, NetNodeType } from "../network/socket/NetNode";
import { NetEvent } from '../network/socket/NetInterface';
import { Tools } from '../utils/Tools';
import EnterTransitionLogic from './EnterTransitionLogic';

const DEFAULT_SERVER_NAME = "S1 · 推荐服";

@ccclass('LoginLogic')
export default class LoginLogic extends Component {

    @property(EditBox)
    editName: EditBox = null;

    @property(EditBox)
    editPass: EditBox = null;

    @property(Sprite)
    eyeIcon: Sprite | null = null;

    @property(Node)
    agreementMark: Node | null = null;

    @property(Node)
    rememberMark: Node | null = null;

    @property(Node)
    serverPanel: Node | null = null;

    @property(Label)
    serverLabel: Label | null = null;

    private agreementAccepted = false;
    private rememberAccount = true;
    private selectedServerName = DEFAULT_SERVER_NAME;

    private accountName = "";
    private loginPending = false;
    private enterStarted = false;
    private mapReached = false;
    private enterPrefab: Prefab | null = null;
    private enterPrefabLoading = false;
    private enterNode: Node | null = null;
    private enterLogic: EnterTransitionLogic | null = null;
    private overlayShown = false;
    private reconnectAttempt = 0;
    private loginButton: Button | null = null;
    private loginButtonLabel: Label | null = null;

    protected onLoad(): void {
        EventMgr.on(LogicEvent.loginComplete, this.onLoginComplete, this);
        EventMgr.on(LogicEvent.enterMap, this.onEnterMap, this);
        EventMgr.on(LogicEvent.createRole, this.onNeedCreateRole, this);
        EventMgr.on(NetEvent.ServerReconnecting, this.onServerReconnecting, this);
        // 登录页保持空闲，只有用户点击登录才建立连接。
        var data = LocalCache.getLoginValidation();
        console.log("LoginLogic  data:", data)

        this.rememberAccount = LocalCache.getPersonMemory("rememberAccount", true) !== false;
        var rememberedAccount = LocalCache.getPersonMemory("rememberedAccount", "");
        if (this.rememberAccount && rememberedAccount) {
            this.editName.string = String(rememberedAccount);
        } else if (this.rememberAccount && data && typeof data === 'object') {
            this.editName.string = data.account || '';
        }
        // 缓存里保存的是服务端返回的密码摘要，不能直接回填到输入框
        this.editPass.string = '';
        this.setPasswordVisible(false);

        var savedServerName = LocalCache.getPersonMemory("selectedServerName", "");
        if (savedServerName) {
            this.selectedServerName = this.normalizeServerName(String(savedServerName));
        }

        this.refreshAgreement();
        this.refreshRemember();
        this.refreshServer();
        if (this.serverPanel) {
            this.serverPanel.active = false;
        }

        this.loginButton = this.findNode('New Node/dlbtn')?.getComponent(Button) || null;
        this.loginButtonLabel = this.findNode('New Node/dlbtn/Background/Label')?.getComponent(Label) || null;
        this.setLoginButtonState(false, '进入山河');
        this.loadEnterPrefab();
    }

    protected onDestroy(): void {
        this.loginPending = false;
        this.enterStarted = false;
        EventMgr.targetOff(this);
        this.unscheduleAllCallbacks();
    }

    protected onLoginComplete(code?: number): void {
        console.log("LoginLogic  onLoginComplete", code);
        this.unschedule(this.onLoginTimeout);
        if (!this.loginPending) {
            return;
        }
        this.loginPending = false;

        if (typeof code === 'number' && code !== 0 && code !== 9) {
            this.resetLogin(Tools.getCodeStr(code) || '登录失败，请稍后重试');
            return;
        }

        this.beginEnterWorld();
    }

    protected onClickRegister(): void {
        AudioManager.instance.playClick();

        if (!this.editName.string || !this.editPass.string) {
            EventMgr.emit(LogicEvent.showToast, "请输入账号和密码");
            return;
        }
        EventMgr.emit(LogicEvent.showToast, "注册功能暂未开放");
    }

    protected onClickLogin(): void {
        AudioManager.instance.playClick();

        if (this.loginPending || this.enterStarted) {
            return;
        }

        if (!this.agreementAccepted) {
            EventMgr.emit(LogicEvent.showToast, "请先阅读并同意用户协议");
            return;
        }

        if (!this.editName.string || !this.editPass.string) {
            EventMgr.emit(LogicEvent.showToast, "请输入账号和密码");
            return;
        }

        if (this.rememberAccount) {
            LocalCache.setPersonMemory("rememberedAccount", this.editName.string);
        } else {
            LocalCache.setPersonMemory("rememberedAccount", "");
        }

        this.accountName = this.editName.string;
        this.loginPending = true;
        this.setLoginButtonState(true, '正在登录…');
        this.scheduleOnce(this.onLoginTimeout, 12);
        NetManager.getInstance().connect({ url: GameConfig.loginUrl, type: NetNodeType.LoginServer, autoReconnect: 0 });
        LoginCommand.getInstance().accountLogin(this.editName.string, this.editPass.string);
    }

    protected onClickTogglePassword(): void {
        if (!this.editPass) {
            return;
        }
        this.setPasswordVisible(this.editPass.inputFlag === EditBox.InputFlag.PASSWORD);
    }

    protected onClickAgreement(): void {
        AudioManager.instance.playClick();
        this.agreementAccepted = !this.agreementAccepted;
        this.refreshAgreement();
    }

    protected onClickRemember(): void {
        AudioManager.instance.playClick();
        this.rememberAccount = !this.rememberAccount;
        LocalCache.setPersonMemory("rememberAccount", this.rememberAccount);
        if (!this.rememberAccount) {
            LocalCache.setPersonMemory("rememberedAccount", "");
        }
        this.refreshRemember();
    }

    protected onClickForgotPassword(): void {
        AudioManager.instance.playClick();
        EventMgr.emit(LogicEvent.showToast, "请联系客服重置密码");
    }

    protected onClickServer(): void {
        AudioManager.instance.playClick();
        if (this.serverPanel) {
            this.serverPanel.active = !this.serverPanel.active;
        }
    }

    protected onClickServerOption(_event: Event, customEventData: string): void {
        AudioManager.instance.playClick();
        if (!customEventData) {
            return;
        }
        this.selectedServerName = customEventData;
        LocalCache.setPersonMemory("selectedServerName", customEventData);
        this.refreshServer();
        if (this.serverPanel) {
            this.serverPanel.active = false;
        }
    }

    protected onClickUnavailableServer(): void {
        AudioManager.instance.playClick();
        EventMgr.emit(LogicEvent.showToast, "该服务器暂未开放");
    }

    protected onClickClose(): void {
        AudioManager.instance.playClick();
        EventMgr.emit(LogicEvent.enterLogin);
    }

    private onLoginTimeout(): void {
        if (!this.loginPending) {
            return;
        }
        this.loginPending = false;
        this.resetLogin("登录超时，请检查网络后重试");
    }

    private beginEnterWorld(): void {
        const loginData = LoginCommand.getInstance().proxy.getLoginData();
        if (!loginData) {
            this.resetLogin("登录信息已失效，请重新登录");
            return;
        }

        this.enterStarted = true;
        this.mapReached = false;
        this.reconnectAttempt = 0;
        this.setLoginButtonState(true, '正在进入山河…');
        NetManager.getInstance().close();

        // 在下一帧之后切换网关，旧连接的回调已在 close 中解除。
        this.scheduleOnce(() => this.connectGateAndEnter(loginData), 0.5);
        // 连接通常很快，先让登录卡保持“正在进入”状态；超过 1 秒再展示过渡页
        this.scheduleOnce(() => {
            if (this.enterStarted && !this.mapReached) {
                this.setLoginContentVisible(false);
                this.showEnterOverlay(loginData);
            }
        }, 1.0);
    }

    private connectGateAndEnter(loginData: any): void {
        if (!this.enterStarted || this.mapReached) {
            return;
        }

        NetManager.getInstance().connect({
            url: this.resolveGateUrl(loginData.gateAddr),
            type: NetNodeType.GateServer,
            autoReconnect: MAX_RECONNECT_ATTEMPTS
        });
        LoginCommand.getInstance().role_enterServer(loginData);

        if (this.enterLogic) {
            this.enterLogic.setStage(0.35, '正在验证身份');
        }
    }

    private onServerReconnecting(state: { attempt?: number }): void {
        if (!this.enterStarted || this.mapReached) return;
        this.reconnectAttempt = state.attempt || 1;
        this.enterLogic?.setStage(0.35, `连接中断，正在重连（${this.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS}）`);
    }

    private backToLogin(): void {
        this.loginPending = false;
        this.enterStarted = false;
        this.mapReached = false;
        this.overlayShown = false;
        this.reconnectAttempt = 0;
        this.unscheduleAllCallbacks();
        NetManager.getInstance().close();
        LoginCommand.getInstance().resetClientState();
        if (this.enterLogic) {
            this.enterLogic.hide();
        }
        this.setLoginContentVisible(true);
        this.setLoginButtonState(false, '进入山河');
    }

    private resetLogin(message: string): void {
        this.backToLogin();
        EventMgr.emit(LogicEvent.showToast, message);
    }

    private onEnterMap(): void {
        this.mapReached = true;
        this.unscheduleAllCallbacks();
        if (this.enterLogic) {
            this.enterLogic.complete();
        }
    }

    private onNeedCreateRole(): void {
        this.mapReached = true;
        this.unscheduleAllCallbacks();
        this.setLoginContentVisible(false);
        if (this.enterLogic) {
            this.enterLogic.hide();
        }
    }

    private showEnterOverlay(loginData: any): void {
        if (!this.enterPrefab) {
            this.loadEnterPrefab((prefab) => {
                if (prefab && this.enterStarted) {
                    this.showEnterOverlay(loginData);
                }
            });
            return;
        }

        if (!this.enterNode) {
            this.enterNode = instantiate(this.enterPrefab);
            this.enterNode.parent = this.node;
            this.enterNode.setSiblingIndex(this.node.children.length - 1);
            this.enterLogic = this.enterNode.getComponent(EnterTransitionLogic);
        }

        if (!this.enterLogic) {
            return;
        }

        this.enterLogic.onRetry = null;
        this.enterLogic.onBack = () => this.backToLogin();
        this.enterLogic.play(loginData.account || this.accountName, this.selectedServerName);
        this.enterLogic.setStage(0.35, this.reconnectAttempt
            ? `连接中断，正在重连（${this.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS}）` : '正在连接服务器并验证身份');
        this.overlayShown = true;
    }

    private loadEnterPrefab(onReady?: (prefab: Prefab | null) => void): void {
        if (this.enterPrefab) {
            if (onReady) {
                onReady(this.enterPrefab);
            }
            return;
        }
        if (this.enterPrefabLoading) {
            return;
        }
        this.enterPrefabLoading = true;
        resources.load('prefab/EnterTransition', Prefab, (error: Error, prefab: Prefab) => {
            this.enterPrefabLoading = false;
            if (error || !prefab) {
                console.warn('EnterTransition prefab load failed:', error);
                if (onReady) {
                    onReady(null);
                }
                return;
            }
            this.enterPrefab = prefab;
            if (onReady) {
                onReady(prefab);
            }
        });
    }

    private setLoginContentVisible(visible: boolean): void {
        this.setNodeActive('New Node', visible);
        this.setNodeActive('ServerSelect', visible);
        this.setNodeActive('ServerPanel', false);
        if (!visible && this.serverPanel) {
            this.serverPanel.active = false;
        }
    }

    private setNodeActive(name: string, active: boolean): void {
        const node = this.node.getChildByName(name);
        if (node) {
            node.active = active;
        }
    }

    private setLoginButtonState(busy: boolean, text: string): void {
        if (this.loginButton) {
            this.loginButton.interactable = !busy;
        }
        if (this.loginButtonLabel) {
            this.loginButtonLabel.string = text;
        }
    }

    private resolveGateUrl(gateAddr: string): string {
        if (!gateAddr || typeof gateAddr !== 'string') {
            return GameConfig.serverUrl;
        }
        const address = gateAddr.trim();
        if (!address) {
            return GameConfig.serverUrl;
        }
        const withProtocol = /^wss?:\/\//i.test(address) ? address : `ws://${address}`;
        return /:\d+/.test(withProtocol.replace(/^wss?:\/\//i, ''))
            ? withProtocol
            : GameConfig.serverUrl;
    }

    private normalizeServerName(name: string): string {
        if (!name || name.indexOf('S1') >= 0 || name.indexOf('\u63a8\u8350') >= 0) {
            return DEFAULT_SERVER_NAME;
        }
        return name;
    }

    private refreshAgreement(): void {
        if (this.agreementMark) {
            this.agreementMark.active = this.agreementAccepted;
        }
    }

    private refreshRemember(): void {
        if (this.rememberMark) {
            this.rememberMark.active = this.rememberAccount;
        }
    }

    private refreshServer(): void {
        if (this.serverLabel) {
            this.serverLabel.string = this.selectedServerName;
        }
    }

    private setPasswordVisible(visible: boolean): void {
        if (!this.editPass) {
            return;
        }
        this.editPass.inputFlag = visible ? EditBox.InputFlag.DEFAULT : EditBox.InputFlag.PASSWORD;
        if (this.eyeIcon) {
            this.eyeIcon.color = visible
                ? new Color(255, 236, 196, 255)
                : new Color(148, 130, 100, 255);
        }
    }

    private findNode(path: string): Node | null {
        let node: Node = this.node;
        for (const name of path.split('/')) {
            if (!name) {
                continue;
            }
            node = node.getChildByName(name);
            if (!node) {
                return null;
            }
        }
        return node;
    }
}
