import { _decorator, Component, Prefab, Node, instantiate } from 'cc';
import { AudioManager } from '../common/AudioManager';
import { LogicEvent } from '../common/LogicEvent';
const { ccclass, property } = _decorator;

import LoginCommand from "../login/LoginCommand";
import CreateLogic, { BirthZone } from '../login/CreateLogic';
import { NetEvent } from "../network/socket/NetInterface";
import { EventMgr } from '../utils/EventMgr';
import { NetManager } from "../network/socket/NetManager";
import { GameConfig } from '../config/GameConfig';
import { NetNodeType } from "../network/socket/NetNode";

@ccclass('LoginScene')
export default class LoginScene extends Component {
    @property(Prefab)
    loginPrefab: Prefab = null;
    @property(Prefab)
    createPrefab: Prefab = null;
    @property(Prefab)
    serverListPrefab: Prefab = null;

    protected _loginNode: Node = null;
    protected _createNode: Node = null;
    protected _serverListNode: Node = null;

    protected _enterNode: Node = null;

    protected onLoad(): void {
        this.openLogin();
        EventMgr.on(LogicEvent.createRole, this.onCreate, this);
        EventMgr.on(LogicEvent.enterServerComplete, this.enterServer, this);

    }

    protected onDestroy(): void {
        EventMgr.targetOff(this);
        this._loginNode = null;
        this._serverListNode = null;
    }

    protected openLogin(): void {

        if (this._loginNode == null) {
            this._loginNode = instantiate(this.loginPrefab);
            this.node.addChild(this._loginNode);
        } else {
            this._loginNode.active = true;
        }
    }

    protected onCreate(zones: BirthZone[] = []): void {

        if (this._createNode == null) {
            this._createNode = instantiate(this.createPrefab);
            this.node.addChild(this._createNode);
        } else {
            this._createNode.active = true;
        }
        this._createNode.getComponent(CreateLogic)?.configureZones(zones);
    }


    protected enterServer(): void {
        console.log("enterServer");
        EventMgr.emit(NetEvent.ServerRequesting, true);
    }

    protected onClickEnter(): void {
        //初始化登录服连接
        NetManager.getInstance().connect({ url: GameConfig.serverUrl, type: NetNodeType.GateServer });
        AudioManager.instance.playClick();
        var loginData = LoginCommand.getInstance().proxy.getLoginData();
        console.log("loginData:", loginData);
        if (loginData == null) {
            this.openLogin();
            return;
        }
        //登录完成进入服务器
        LoginCommand.getInstance().role_enterServer(loginData);
    }
}
