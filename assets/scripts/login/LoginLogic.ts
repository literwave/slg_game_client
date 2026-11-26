import { _decorator, Button, Color, Component, EditBox, Event, instantiate, Label, Node, Prefab, resources, Sprite, UITransform } from 'cc';
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
import { LoginApi, LoginApiError, PublicServer, ServerListData } from './LoginApi';
import { Md5 } from '../libs/crypto/md5';

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
    private selectedServerId = 0;
    private serverList: PublicServer[] = [];
    private loginGeneration = 0;

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
        this.alignServerSelector();
        this.refreshServer();
        this.loadServerList();
        if (this.serverPanel) {
            this.serverPanel.active = false;
        }
        this.refreshServerArrow();

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
        if (this.loginPending || this.enterStarted) {
            return;
        }
        LoginApi.register(this.editName.string, Md5.encrypt(this.editPass.string))
            .then(() => EventMgr.emit(LogicEvent.showToast, "注册成功，请点击进入山河"))
            .catch((error: Error) => EventMgr.emit(LogicEvent.showToast, error?.message || "注册失败"));
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
        this.scheduleOnce(this.onLoginTimeout, 20);
        this.httpLogin(this.editName.string, this.editPass.string);
    }

    /** 登录服 HTTP 流程：账号验证 → 区服列表 → 进服签发一次性票据，再直连网关。 */
    private async httpLogin(account: string, password: string): Promise<void> {
        const generation = ++this.loginGeneration;
        const stale = () => generation !== this.loginGeneration || !this.loginPending;
        try {
            const auth = await LoginApi.auth(account, Md5.encrypt(password), GameConfig.autoRegister);
            if (stale()) return;
            const list = await LoginApi.servers(auth.token);
            if (stale()) return;
            const server = this.pickServer(list, auth.last_server_id);
            if (!server) {
                throw new LoginApiError('暂无可进入的区服，请稍后再试');
            }
            this.selectedServerId = server.server_id;
            this.selectedServerName = server.name;
            LocalCache.setPersonMemory("selectedServerId", server.server_id);
            LocalCache.setPersonMemory("selectedServerName", server.name);
            this.refreshServer();

            const enter = await LoginApi.enter(auth.token, server.server_id);
            if (stale()) return;

            const loginData = {
                account: auth.account.username,
                passwd: '',
                token: enter.ticket,
                userId: enter.user_id || 0,
                serverId: enter.server_id,
                gateAddr: enter.gate_addr,
                // 票据登录：网关重连时需用 apiToken 重新签发一次性票据
                ticketLogin: true,
                apiToken: auth.token,
            };
            const command = LoginCommand.getInstance();
            command.proxy.saveLoginData(loginData);
            try {
                LocalCache.setLoginValidation(command.proxy.getLoginData());
            } catch {
                console.warn('[Login] 登录信息未能写入本地缓存');
            }
            this.unschedule(this.onLoginTimeout);
            this.loginPending = false;
            this.beginEnterWorld();
        } catch (error) {
            if (stale()) return;
            this.unschedule(this.onLoginTimeout);
            this.loginPending = false;
            this.resetLogin((error as Error)?.message || '登录失败，请稍后重试');
        }
    }

    /** 选服：上次选择 → 服务端记录的上次登录 → 有角色的服 → 第一个可进入的服。 */
    private pickServer(list: ServerListData, lastServerId?: number): PublicServer | null {
        const open = (list?.servers || []).filter(s => s.reachable && (s.status === 1 || s.status === 2));
        if (open.length === 0) return null;
        const byId = (id: number | undefined) => id ? open.find(s => s.server_id === id) : undefined;
        const saved = Number(LocalCache.getPersonMemory("selectedServerId", 0)) || 0;
        return byId(saved) || byId(lastServerId) || open.find(s => s.has_role) || open[0];
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
            this.refreshServerArrow();
        }
    }

    protected onClickServerOption(_event: Event, customEventData: string): void {
        AudioManager.instance.playClick();
        if (!customEventData) {
            return;
        }
        const id = Number(customEventData);
        const server = Number.isInteger(id) ? this.serverList.find(s => s.server_id === id) : undefined;
        if (server) {
            this.selectedServerId = server.server_id;
            this.selectedServerName = server.name;
            LocalCache.setPersonMemory("selectedServerId", server.server_id);
        } else {
            this.selectedServerName = customEventData;
        }
        LocalCache.setPersonMemory("selectedServerName", this.selectedServerName);
        this.refreshServer();
        if (this.serverPanel) {
            this.serverPanel.active = false;
            this.refreshServerArrow();
        }
    }

    /** 拉取登录服公开区服列表，动态生成选服面板（拉取失败则保留预制体里的默认项）。 */
    private loadServerList(): void {
        LoginApi.serverList().then(data => {
            if (!this.isValid) return;
            this.serverList = (data?.servers || []).slice().sort((a, b) => a.server_id - b.server_id);
            this.rebuildServerPanel();
            const current = this.serverList.find(s => s.server_id === this.selectedServerId);
            const saved = Number(LocalCache.getPersonMemory("selectedServerId", 0)) || 0;
            const initial = current
                || this.serverList.find(s => s.server_id === saved && this.serverAvailable(s))
                || this.serverList.find(s => this.serverAvailable(s));
            if (initial) {
                this.selectedServerId = initial.server_id;
                this.selectedServerName = initial.name;
                this.refreshServer();
            }
        }).catch(error => {
            console.warn('[Login] 拉取区服列表失败，使用默认区服', error);
        });
    }

    private serverAvailable(server: PublicServer): boolean {
        return !!server.reachable && (server.status === 1 || server.status === 2);
    }

    private serverTag(server: PublicServer): string {
        if (server.status === 0) return '维护中';
        if (server.status === 3) return '已关闭';
        if (!server.reachable) return '未开放';
        if (server.has_role) return '已有角色';
        return server.status === 2 ? '火爆' : '推荐';
    }

    /** 统一选服按钮与下拉列表的宽度、左缘及贴合间距，避免视觉偏移与悬空。 */
    private alignServerSelector(): void {
        const PANEL_WIDTH = 206;
        const SELECT_HEIGHT = 36;
        const GAP = 6;
        const select = this.node.getChildByName('ServerSelect');
        if (select) {
            select.getComponent(UITransform)?.setContentSize(PANEL_WIDTH, SELECT_HEIGHT);
            const bg = select.getChildByName('Background');
            if (bg) {
                bg.active = true;
                bg.setPosition(PANEL_WIDTH / 2, 0, 0);
                bg.getComponent(UITransform)?.setContentSize(PANEL_WIDTH, SELECT_HEIGHT);
                const sp = bg.getComponent(Sprite);
                if (sp) sp.color = new Color(22, 30, 34, 195);
            }
            const icon = select.getChildByName('ServerIcon');
            icon?.setPosition(18, 0, 0);
            const text = select.getChildByName('ServerText');
            if (text) {
                text.setPosition(34, 0, 0);
                text.getComponent(UITransform)?.setContentSize(PANEL_WIDTH - 64, 22);
            }
            const arrow = select.getChildByName('Arrow');
            arrow?.setPosition(PANEL_WIDTH - 18, 0, 0);
        }
        if (this.serverPanel && select) {
            const topY = select.position.y + SELECT_HEIGHT / 2;
            this.serverPanel.setPosition(select.position.x, topY + GAP, 0);
            const panelUi = this.serverPanel.getComponent(UITransform);
            if (panelUi) panelUi.setContentSize(PANEL_WIDTH, panelUi.height);
        }
    }

    private refreshServerArrow(): void {
        const arrow = this.findNode('ServerSelect/Arrow')?.getComponent(Label);
        if (arrow) {
            arrow.string = this.serverPanel?.active ? '▲' : '▼';
        }
    }

    private rebuildServerPanel(): void {
        this.alignServerSelector();
        const panel = this.serverPanel;
        const template = panel?.getChildByName('ServerS1');
        if (!panel || !template) return;
        // 清掉上一次动态生成的条目，再按服务端列表重建
        panel.children.filter(c => c.name.indexOf('ServerItem_') === 0).forEach(c => c.destroy());
        const legacy = panel.getChildByName('ServerS2');
        if (legacy) legacy.active = false;
        template.active = false;

        const PANEL_WIDTH = 206;
        const PAD_X = 10;
        const ITEM_WIDTH = PANEL_WIDTH - PAD_X * 2;
        const ROW_HEIGHT = 38;
        const ROW_GAP = 6;
        const HEADER_HEIGHT = 22;
        const HEADER_GAP = 6;
        const PAD_TOP = 12;
        const PAD_BOTTOM = 12;
        const rows = Math.max(this.serverList.length, 1);
        const rowsBlock = rows * ROW_HEIGHT + (rows - 1) * ROW_GAP;
        const height = PAD_TOP + HEADER_HEIGHT + HEADER_GAP + rowsBlock + PAD_BOTTOM;
        const available = new Color(236, 216, 176, 255);
        const unavailable = new Color(130, 124, 113, 255);
        const tagOk = new Color(132, 197, 134, 255);
        const tagOff = new Color(117, 111, 102, 255);

        const firstRowCenterY = height - PAD_TOP - HEADER_HEIGHT - HEADER_GAP - ROW_HEIGHT / 2;
        this.serverList.forEach((server, index) => {
            const item = instantiate(template);
            item.name = `ServerItem_${server.server_id}`;
            item.active = true;
            item.setPosition(PAD_X, firstRowCenterY - index * (ROW_HEIGHT + ROW_GAP), 0);
            item.getComponent(UITransform)?.setContentSize(ITEM_WIDTH, ROW_HEIGHT);
            const itemBg = item.getChildByName('Background');
            if (itemBg) {
                itemBg.setPosition(ITEM_WIDTH / 2, 0, 0);
                itemBg.getComponent(UITransform)?.setContentSize(ITEM_WIDTH, ROW_HEIGHT);
            }
            const ok = this.serverAvailable(server);
            const label = item.getChildByName('Label')?.getComponent(Label);
            const tag = item.getChildByName('Tag')?.getComponent(Label);
            if (label) {
                label.node.setPosition(12, 0, 0);
                label.node.getComponent(UITransform)?.setContentSize(ITEM_WIDTH - 70, 22);
                label.string = server.name;
                label.color = ok ? available : unavailable;
            }
            if (tag) {
                tag.node.setPosition(ITEM_WIDTH - 10, 0, 0);
                tag.string = this.serverTag(server);
                tag.color = ok ? tagOk : tagOff;
            }
            const handler = new Component.EventHandler();
            handler.target = this.node;
            handler.component = 'LoginLogic';
            handler.handler = ok ? 'onClickServerOption' : 'onClickUnavailableServer';
            handler.customEventData = ok ? String(server.server_id) : '';
            const button = item.getComponent(Button);
            if (button) button.clickEvents = [handler];
            panel.addChild(item);
        });

        // 面板底边紧贴选服条正上方，条目增多时向上整齐长高
        const panelTransform = panel.getComponent(UITransform);
        if (panelTransform) panelTransform.setContentSize(PANEL_WIDTH, height);
        const background = panel.getChildByName('Background');
        background?.setPosition(PANEL_WIDTH / 2, height / 2, 0);
        const backgroundTransform = background?.getComponent(UITransform);
        if (backgroundTransform) backgroundTransform.setContentSize(PANEL_WIDTH, height);
        const title = panel.getChildByName('Title');
        title?.setPosition(PAD_X + 4, height - PAD_TOP - HEADER_HEIGHT / 2, 0);
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
        this.enterLogic?.setStage(0.35, '重连中');
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
            ? '重连中' : '正在连接服务器并验证身份');
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
            this.refreshServerArrow();
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
        const withProtocol = /^wss?:\/\//i.test(address) ? address : `${GameConfig.gateScheme}://${address}`;
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
