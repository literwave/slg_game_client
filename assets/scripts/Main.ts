import { _decorator, Component, Prefab, Node, instantiate, TiledMapAsset, JsonAsset, AudioSource, assert, Camera, screen, view, director, Director } from 'cc';
const { ccclass, property } = _decorator;

import { GameConfig } from "./config/GameConfig";
import LoaderManager, { LoadData, LoadDataType } from "./core/LoaderManager";
import ConfigManager from "./core/ConfigManager";
import ArmyCommand from "./general/ArmyCommand";
import GeneralCommand from "./general/GeneralCommand";
import TroopCommand from "./general/TroopCommand";
import LoginCommand from "./login/LoginCommand";
import MapCommand from "./map/MapCommand";
import MapUICommand from "./map/ui/MapUICommand";
import { HttpManager } from "./network/http/HttpManager";
import { NetEvent } from "./network/socket/NetInterface";
import { NetManager } from "./network/socket/NetManager";
import SkillCommand from "./skill/SkillCommand";
import Toast from "./utils/Toast";
import { Tools } from "./utils/Tools";
import { EventMgr } from './utils/EventMgr';
import { AudioManager } from './common/AudioManager';
import { LogicEvent } from './common/LogicEvent';
import { ProtoManager } from './network/pto/ProtoManager';
import { CoreEvent } from './core/CoreEvent';
import LoadingLogic from './common/LoadingLogic';
import ReconnectLogic, { ReconnectState } from './common/ReconnectLogic';
import RewardCommand from './reward/RewardCommand';
import RewardWindowLogic from './reward/RewardWindowLogic';
import SystemOpenCommand from './systemopen/SystemOpenCommand';

@ccclass('Main')
export default class Main extends Component {
    @property(Prefab)
    loginScenePrefab: Prefab = null;

    @property(Prefab)
    mapScenePrefab: Prefab = null;
    @property(Prefab)
    mapUIScenePrefab: Prefab = null;

    @property(Prefab)
    loadingPrefab: Prefab = null;


    @property(Prefab)
    waitPrefab: Prefab = null;

    @property(Prefab)
    toastPrefab: Prefab = null;

    private _audioSource: AudioSource = null!;
    private toastNode: Node = null;
    protected _loginScene: Node = null;
    protected _mapScene: Node = null;
    protected _mapUIScene: Node = null;
    protected _loadingNode: Node = null;
    protected _waitNode: Node = null;
    private _reconnectNode: Node = null;
    private _reconnectLogic: ReconnectLogic = null;
    private _retryTimes: number = 0;
    private _loadGeneration = 0;
    private _enteringMap = false;
    private _mapReady = false;
    private _mapUiReady = false;
    private _heroAssetsReady = false;
    private _skillAssetsReady = false;
    private _headAssetsReady = false;
    private _finishingLoading = false;
    private _heroRequest: Promise<boolean> | null = null;
    private _heroWarmupTimer: ReturnType<typeof setTimeout> | null = null;
    private _mapPreparation: Generator<void, void, unknown> | null = null;
    private _afterLoadingDraw: (() => void) | null = null;


    protected onLoad(): void {

        console.log("main load");

        this.node.on(Node.EventType.SIZE_CHANGED, this.alignUiCamera, this);
        view.on('design-resolution-changed', this.alignUiCamera, this);
        this.alignUiCamera();

        const audioSource = this.getComponent(AudioSource)!;
        assert(!!audioSource);
        this._audioSource = audioSource;

        AudioManager.instance.init(this._audioSource);

        EventMgr.on(LogicEvent.enterMap, this.onEnterMap, this);
        EventMgr.on(CoreEvent.mapReady, this.onMapReady, this);
        EventMgr.on(CoreEvent.mapLoadFailed, this.onMapLoadFailed, this);
        EventMgr.on(LogicEvent.enterLogin, this.enterLogin, this);
        EventMgr.on(LogicEvent.showToast, this.onShowToast, this);
        EventMgr.on(LogicEvent.showWaiting, this.showWaitNode, this);
        EventMgr.on(LogicEvent.hideWaiting, this.hideWaitNode, this);

        EventMgr.on(NetEvent.ServerRequesting, this.showWaitNode, this);
        EventMgr.on(NetEvent.ServerRequestSucess, this.onServerRequest, this);
        EventMgr.on(NetEvent.ServerReconnecting, this.onServerReconnecting, this);
        EventMgr.on(NetEvent.ServerReconnectSuccess, this.onServerReconnectSuccess, this);
        EventMgr.on(NetEvent.ServerReconnectFailed, this.onServerReconnectFailed, this);

        RewardCommand.getInstance();
        TroopCommand.getInstance();


        //初始化连接
        // NetManager.getInstance().connect({ url: GameConfig.serverUrl, type: NetNodeType.BaseServer });
        HttpManager.getInstance().setWebUrl(GameConfig.webUrl);

        // 初始化 Protobuf (异步)
        ProtoManager.getInstance().init().then(() => {
            if (!this.isValid) return;
            console.log("Protobuf initialized");
            //初始化业务模块
            LoginCommand.getInstance();
            this.enterLogin();
        });

    }

    protected onDestroy(): void {
        console.log("main onDestroy");
        this.node.off(Node.EventType.SIZE_CHANGED, this.alignUiCamera, this);
        view.off('design-resolution-changed', this.alignUiCamera, this);
        this.disposeLoadingNow();
        GeneralCommand.getInstance().clearData();
        TroopCommand.getInstance().clearData();
        EventMgr.targetOff(this);
    }

    private alignUiCamera(): void {
        const cameraNode = this.node.getChildByName('UI Camera');
        const camera = cameraNode ? cameraNode.getComponent(Camera) : null;
        const scaleY = view.getScaleY();
        // 与 Creator 3.8 Canvas 的屏幕适配公式一致，独立 UI 相机也需要跟随窗口。
        if (camera && scaleY > 0 && screen.windowSize.height > 0) {
            camera.orthoHeight = screen.windowSize.height / scaleY / 2;
        }
    }

    protected clearData(): void {
        LoginCommand.getInstance().resetClientState();
        MapCommand.getInstance().clearData();
        GeneralCommand.getInstance().clearData();
        ArmyCommand.getInstance().clearData();
        TroopCommand.getInstance().clearData();
        RewardCommand.getInstance().clearData();
    }

    private enterLogin(): void {
        this.disposeReconnectNow();
        this.disposeLoadingNow();
        this.clearAllScene();
        this.clearData();
        // 先取消网关重连，再打开登录页。否则登录页出来后，旧的重连定时器还会去连网关
        NetManager.getInstance().close();
        this._loginScene = instantiate(this.loginScenePrefab);
        this.node.addChild(this._loginScene);

    }

    private onServerReconnecting(state: ReconnectState): void {
        if (!this._mapScene && !this._mapUIScene) {
            return;
        }
        const logic = this.ensureReconnectLogic();
        if (!logic) {
            this.showTopToast('网络连接已断开，正在尝试重连');
            return;
        }
        this._reconnectNode.setSiblingIndex(this.topLayer() + 20);
        logic.showReconnecting(state);
    }

    private onServerReconnectSuccess(): void {
        if (this._reconnectLogic && this._reconnectNode && this._reconnectNode.active) {
            this._reconnectLogic.showSuccess();
        }
    }

    private onServerReconnectFailed(): void {
        if (!this._mapScene && !this._mapUIScene) {
            this.enterLogin();
            return;
        }
        const logic = this.ensureReconnectLogic();
        if (!logic) {
            this.enterLogin();
            return;
        }
        this._reconnectNode.setSiblingIndex(this.topLayer() + 20);
        logic.showFailed();
    }

    private ensureReconnectLogic(): ReconnectLogic | null {
        if (this._reconnectNode && this._reconnectNode.isValid) {
            return this._reconnectLogic;
        }
        this._reconnectNode = new Node('Reconnect');
        this._reconnectNode.layer = this.node.layer;
        this._reconnectNode.setParent(this.node);
        this._reconnectNode.setSiblingIndex(this.topLayer() + 20);
        this._reconnectLogic = this._reconnectNode.addComponent(ReconnectLogic);
        this._reconnectNode.active = false;
        return this._reconnectLogic;
    }

    private disposeReconnectNow(): void {
        if (this._reconnectNode) {
            if (this._reconnectNode.isValid) {
                this._reconnectNode.destroy();
            }
            this._reconnectNode = null;
        }
        this._reconnectLogic = null;
    }

    protected onEnterMap(): void {
        if (this._enteringMap || this._loadingNode || this._mapScene) {
            return;
        }
        let dataList: LoadData[] = [];
        // INDEX 0: 地图数据
        dataList.push(new LoadData("world/map", LoadDataType.FILE, TiledMapAsset));
        // INDEX 1: 配置目录 (包含 Hero.json, mapRes_0.json 等)
        dataList.push(new LoadData("config", LoadDataType.DIR, JsonAsset));

        this._enteringMap = true;
        this._mapReady = false;
        this._mapUiReady = false;
        this._heroAssetsReady = false;
        this._skillAssetsReady = false;
        this._headAssetsReady = false;
        this._finishingLoading = false;
        const generation = ++this._loadGeneration;
        const startedAt = Date.now();
        try {
            this.addLoadingNode();
            this.hideWaitNode();
            // 成功回包后立即离开创建页；加载遮罩接管输入和显示。
            if (this._loginScene) this._loginScene.active = false;
            // scheduleOnce(0) 本身不保证已经渲染。先等加载页提交一帧，
            // 再在下一轮 update 启动资源解析，避免创建页停在上一帧。
            this._afterLoadingDraw = () => {
                this._afterLoadingDraw = null;
                console.info(`[MapEntry] 加载页首帧 ${Date.now() - startedAt}ms`);
                this.scheduleOnce(() => {
                    if (!this.isValid || generation !== this._loadGeneration) return;
                    try {
                        LoginCommand.getInstance().beginMapLoading();
                        this._heroRequest = GeneralCommand.getInstance().beginLoading();
                        LoaderManager.getInstance().startLoadList(dataList, null,
                            (error: Error, paths: string[], datas: any[]) => {
                                if (!this.isValid || generation !== this._loadGeneration) return;
                                if (error != null) {
                                    this.failMapLoading(error);
                                    return;
                                }
                                console.info(`[MapEntry] 资源就绪 ${Date.now() - startedAt}ms`);
                                this._mapPreparation = this.prepareMap(datas[0] as TiledMapAsset, datas[1] as JsonAsset[]);
                            }, this);
                    } catch (error) {
                        this.failMapLoading(error);
                    }
                }, 0);
            };
            director.once(Director.EVENT_AFTER_DRAW, this._afterLoadingDraw, this);
        } catch (error) {
            this.failMapLoading(error);
        }
    }

    protected update(): void {
        if (!this._mapPreparation) return;
        try {
            // 每个渲染帧只推进一次，让进度条和骑将始终有刷新机会。
            if (this._mapPreparation.next().done) this._mapPreparation = null;
        } catch (error) {
            this.failMapLoading(error);
        }
    }

    private *prepareMap(tiledMap: TiledMapAsset, configAssets: JsonAsset[]): Generator<void, void, unknown> {
        if (!tiledMap || !Array.isArray(configAssets)) throw new Error('战场启动资源不完整');
        const configs = ConfigManager.getInstance();
        configs.loadConfigs(configAssets);
        SkillCommand.getInstance().proxy.initSkillConfig(configs.getConfig('Skill') || []);
        this.prepareSkillAssets();
        const heroJson = configs.getConfig('Hero');
        LoginCommand.getInstance().headIcons.initConfig(configs.getConfig('HeadIcon'), heroJson);
        this.prepareHeadIcons();
        const basicCfg = configs.getConfig('Global');
        MapUICommand.getInstance().proxy.setBasic({ json: basicCfg });
        if (heroJson) GeneralCommand.getInstance().proxy.initHeroConfig(heroJson, basicCfg);
        this.prepareHeroAssets();
        EventMgr.emit(CoreEvent.mapLoadProgress, 0.72, '正在整理山河地形…');
        yield;

        const mapProxy = MapCommand.getInstance().proxy;
        mapProxy.tiledMapAsset = tiledMap;
        for (const progress of mapProxy.initMapResConfigBatched(configs.getConfig('mapRes_0'))) {
            EventMgr.emit(CoreEvent.mapLoadProgress, 0.72 + progress * 0.1, '正在整理山河地形…');
            yield;
        }
        const globalWarFree = configs.getConfigItem('Global', '3');
        if (globalWarFree) mapProxy.setWarFree(globalWarFree.value1);
        EventMgr.emit(CoreEvent.mapLoadProgress, 0.83, '正在铺展战场…');
        yield;

        this.clearAllScene();
        this._mapScene = instantiate(this.mapScenePrefab);
        this._mapScene.parent = this.node;
        if (!this._enteringMap) return;
        if (this._loadingNode) this._loadingNode.setSiblingIndex(this.topLayer() + 1);
        EventMgr.emit(CoreEvent.mapLoadProgress, 0.87, '正在布置军令界面…');
        yield;

        this._mapUIScene = instantiate(this.mapUIScenePrefab);
        this._mapUIScene.parent = this.node;
        this._mapUiReady = true;
        if (this._loadingNode) this._loadingNode.setSiblingIndex(this.topLayer() + 1);
        EventMgr.emit(CoreEvent.mapLoadProgress, 0.9, '正在部署城池与资源…');
        this.tryFinishLoading();
    }

    private failMapLoading(error: unknown): void {
        console.error('战场初始化失败:', error);
        // 清除半成品场景并回到可重试的登录页。
        this.enterLogin();
        EventMgr.emit(LogicEvent.showToast, '战场准备失败，请重试');
    }

    private onMapLoadFailed(error: unknown): void {
        if (this._enteringMap) this.failMapLoading(error);
    }

    private onMapReady(): void {
        if (!this._enteringMap) return;
        this._mapReady = true;
        this.tryFinishLoading();
    }

    private tryFinishLoading(): void {
        if (!this._enteringMap || this._finishingLoading || !this._mapReady || !this._mapUiReady) return;
        if (!this._heroAssetsReady) {
            EventMgr.emit(CoreEvent.mapLoadProgress, 0.98, '正在准备武将画像…');
            return;
        }
        if (!this._skillAssetsReady) {
            EventMgr.emit(CoreEvent.mapLoadProgress, 0.98, '正在准备技能图标…');
            return;
        }
        if (!this._headAssetsReady) {
            EventMgr.emit(CoreEvent.mapLoadProgress, 0.98, '正在准备头像…');
            return;
        }
        this.finishLoading();
    }

    private prepareHeadIcons(): void {
        const generation = this._loadGeneration;
        const isCurrent = () => this.isValid && this._enteringMap && generation === this._loadGeneration;
        LoginCommand.getInstance().headIcons.preloadIcons(isCurrent).then(() => {
            if (!isCurrent()) return;
            this._headAssetsReady = true;
            this.tryFinishLoading();
        }).catch(error => {
            if (isCurrent()) this.failMapLoading(error);
        });
    }

    private prepareSkillAssets(): void {
        const generation = this._loadGeneration;
        const isCurrent = () => this.isValid && this._enteringMap && generation === this._loadGeneration;
        SkillCommand.getInstance().proxy.preloadSkillIcons(isCurrent).then(() => {
            if (!isCurrent()) return;
            this._skillAssetsReady = true;
            this.tryFinishLoading();
        }).catch(error => {
            if (isCurrent()) this.failMapLoading(error);
        });
    }

    private prepareHeroAssets(): void {
        const generation = this._loadGeneration;
        let settled = false;
        const isCurrent = () => !settled && this.isValid && generation === this._loadGeneration;
        const finish = () => {
            if (!isCurrent()) return;
            settled = true;
            if (this._heroWarmupTimer !== null) clearTimeout(this._heroWarmupTimer);
            this._heroWarmupTimer = null;
            this._heroAssetsReady = true;
            this.tryFinishLoading();
        };
        // 网络/图片异常不阻塞进图，界面打开时仍可按需重试。
        this._heroWarmupTimer = setTimeout(() => {
            if (isCurrent()) console.warn('武将预加载超时，剩余画像将按需加载');
            finish();
        }, 10000);
        (this._heroRequest || Promise.resolve(false)).then((ready) => {
            if (!isCurrent()) return;
            if (!ready) {
                finish();
                return;
            }
            return GeneralCommand.getInstance().proxy.preloadMyPortraits(isCurrent).then(finish);
        }).catch((error) => {
            console.warn('武将预加载未完成:', error);
            finish();
        });
    }

    private finishLoading(): void {
        this._finishingLoading = true;
        if (!this._loadingNode) {
            this.completeMapEntry();
            return;
        }
        const loadingNode = this._loadingNode;
        const logic = loadingNode.getComponent(LoadingLogic);
        if (logic) {
            logic.finish(() => {
                if (this._loadingNode === loadingNode) {
                    this._loadingNode = null;
                    this.completeMapEntry();
                }
            });
        } else {
            if (loadingNode.isValid) loadingNode.destroy();
            this._loadingNode = null;
            this.completeMapEntry();
        }
    }

    private completeMapEntry(): void {
        this._enteringMap = false;
        this._finishingLoading = false;
        this._heroRequest = null;
        // UI 先注册，再统一补发加载期间积累的数据刷新和展示事件。
        EventMgr.emit(CoreEvent.gameReady);
        GeneralCommand.getInstance().setUIReady();
        RewardWindowLogic.init();
        RewardCommand.getInstance().setUIReady();
        SystemOpenCommand.getInstance().setUIReady();
        LoginCommand.getInstance().notifyClientLoaded();
    }

    private disposeLoadingNow(): void {
        if (this._afterLoadingDraw) {
            director.off(Director.EVENT_AFTER_DRAW, this._afterLoadingDraw, this);
            this._afterLoadingDraw = null;
        }
        this._loadGeneration++;
        this._mapPreparation = null;
        this._enteringMap = false;
        this._mapReady = false;
        this._mapUiReady = false;
        this._heroAssetsReady = false;
        this._skillAssetsReady = false;
        this._headAssetsReady = false;
        this._finishingLoading = false;
        this._heroRequest = null;
        if (this._heroWarmupTimer !== null) clearTimeout(this._heroWarmupTimer);
        this._heroWarmupTimer = null;
        if (this._loadingNode) {
            if (this._loadingNode.isValid) {
                this._loadingNode.destroy();
            }
            this._loadingNode = null;
        }
    }

    protected addLoadingNode(): void {
        if (!this.loadingPrefab) throw new Error('未配置战场加载页');
        if (!this._loadingNode || !this._loadingNode.isValid) {
            this._loadingNode = instantiate(this.loadingPrefab);
        }
        this._loadingNode.parent = this.node;
        this._loadingNode.active = true;
        this._loadingNode.setSiblingIndex(this.topLayer() + 1);
    }


    protected showWaitNode(): void {
        if (this._enteringMap) return;
        if (this._waitNode == null) {
            this._waitNode = instantiate(this.waitPrefab);
            this._waitNode.parent = this.node;
        }
        this._waitNode.setSiblingIndex(this.topLayer() + 2);
        this._waitNode.active = true;
    }

    protected hideWaitNode(): void {
        if (this._waitNode) this._waitNode.active = false;
    }


    protected showTopToast(text: string = ""): void {
        if (this.toastNode == null) {
            let toast = instantiate(this.toastPrefab);
            toast.parent = this.node;
            this.toastNode = toast;
        }
        this.toastNode.active = true;
        this.toastNode.setSiblingIndex(this.topLayer() + 10);
        this.toastNode.getComponent(Toast).setText(text);
    }


    private onServerRequest(msg: any): void {
        if (msg.code == undefined || msg.code == 0 || msg.code == 9) {
            this._retryTimes = 0;
            return;
        }

        if (msg.code == -1 || msg.code == -2 || msg.code == -3 || msg.code == -4) {
            if (this._retryTimes < 3) {
                LoginCommand.getInstance().role_enterServer(LoginCommand.getInstance().proxy.getSession());
                this._retryTimes += 1;
                return
            }
        }

        this.showTopToast(Tools.getCodeStr(msg.code));
    }

    private onShowToast(msg: string) {
        this.showTopToast(msg);
    }

    protected clearAllScene() {
        if (this._mapScene) {
            this._mapScene.destroy();
            this._mapScene = null;
        }

        if (this._mapUIScene) {
            this._mapUIScene.destroy();
            this._mapUIScene = null;
        }

        if (this._loginScene) {
            this._loginScene.destroy();
            this._loginScene = null;
        }

        if (this._waitNode) {
            this._waitNode.destroy();
            this._waitNode = null;
        }

    }

    public topLayer(): number {
        return this.node.children.length + 1;
    }
}
