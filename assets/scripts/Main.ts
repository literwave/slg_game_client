import { preloadSiegeSheet, SIEGE_SHEETS } from './map/entries/SiegeAnimationLibrary';
import { _decorator, Component, Prefab, Node, instantiate, TiledMapAsset, JsonAsset, AudioSource, assert, Camera, SpriteFrame, screen, view, director, Director } from 'cc';
const { ccclass, property } = _decorator;

import { GameConfig } from "./config/GameConfig";
import LoaderManager, { LoadData, LoadDataType } from "./core/LoaderManager";
import ConfigManager from "./core/ConfigManager";
import ArmyCommand from "./general/ArmyCommand";
import GeneralCommand from "./general/GeneralCommand";
import TroopCommand from "./general/TroopCommand";
import LoginCommand from "./login/LoginCommand";
import MapCommand from "./map/MapCommand";
import WorldMapArt from './map/WorldMapArt';
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
import LotteryRewardWindow from './reward/LotteryRewardWindow';
import SystemOpenCommand from './systemopen/SystemOpenCommand';
import WorldCommand from './world/WorldCommand';
import MapMarkCommand from './world/MapMarkCommand';
import ProgressionCommand from './progression/ProgressionCommand';
import BuildCommand from './build/BuildCommand';
import LotteryCommand from './general/LotteryCommand';
import InventoryCommand from './inventory/InventoryCommand';
import ChatCommand from './chat/ChatCommand';
import RankCommand from './rank/RankCommand';
import OtherUserCommand from './login/OtherUserCommand';
import MailCommand from './mail/MailCommand';
import UnionCommand from './union/UnionCommand';
import BattleCommand from './battle/BattleCommand';
import AssetLoadQueue, { AssetPriority, AssetRequestCancelled } from './core/AssetLoadQueue';
import InventoryIconCache from './inventory/InventoryIconCache';
import { itemIconPath } from './common/ItemPresentation';

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
    private _mapEntryStartedAt = 0;
    private _enteringMap = false;
    private _mapReady = false;
    private _mapUiReady = false;
    private _finishingLoading = false;
    private _heroRequest: Promise<boolean> | null = null;
    private _mapPreparation: Generator<void, void, unknown> | null = null;
    private _afterLoadingDraw: (() => void) | null = null;
    private _cityStateRequested = false;
    private _cityStateTimer: ReturnType<typeof setTimeout> | null = null;
    private _backgroundAssetKeys = new Set<string>();


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
        EventMgr.on(LogicEvent.updateCityBuilds, this.onCityBuildsChanged, this);
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
        LotteryCommand.getInstance();
        InventoryCommand.getInstance();
        UnionCommand.getInstance();
        ChatCommand.getInstance();
        RankCommand.getInstance();
        OtherUserCommand.getInstance();
        BattleCommand.getInstance();
        EventMgr.on(LogicEvent.lotteryResult, result => LotteryRewardWindow.show(result), this);
        TroopCommand.getInstance();
        // 登录前注册协议监听，避免地图/UI 懒创建模块时漏掉登录确认。
        // 这里只初始化；任务/行军列表仍等 client_load_ok 回包后才拉取。
        WorldCommand.getInstance();
        MapMarkCommand.getInstance();
        ProgressionCommand.getInstance();
        MailCommand.getInstance();
        BuildCommand.getInstance();


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
            this.showTopToast('重连中');
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
        // 加载页和战场使用同一退出流程，清掉旧会话后直接回登录，无需再点确认。
        EventMgr.emit(LogicEvent.enterLogin);
        this.showTopToast('连接中断，已返回登录');
    }

    private ensureReconnectLogic(): ReconnectLogic | null {
        if (this._reconnectNode && this._reconnectNode.isValid) {
            return this._reconnectLogic;
        }
        this._reconnectNode = new Node('Reconnect');
        // Canvas 在 default 层，重连遮罩必须由最高层 UI 相机绘制。
        this._reconnectNode.layer = this.node.getChildByName('UI Camera')?.getComponent(Camera)?.visibility || this.node.layer;
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
        dataList.push(new LoadData("world/map-geometry", LoadDataType.FILE, JsonAsset));
        // 原始配置仍为编辑源；启动只取合并后的表和紧凑地图，避免 37 次独立资源请求。
        dataList.push(new LoadData("world/boot-configs", LoadDataType.FILE, JsonAsset));
        // 四枚轻量专用侧栏图标随入场加载，第一次切页直接取缓存。
        dataList.push(new LoadData("ui/sidebar", LoadDataType.DIR, SpriteFrame));

        this._enteringMap = true;
        this._mapReady = false;
        this._mapUiReady = false;
        this._finishingLoading = false;
        this._cityStateRequested = false;
        const generation = ++this._loadGeneration;
        const startedAt = Date.now();
        this._mapEntryStartedAt = startedAt;
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
                        // 与逻辑配置并行准备，避免创建地图后才串行等待整套山河素材。
                        void WorldMapArt.prepare().catch(error => {
                            if (this.isValid && generation === this._loadGeneration && this._enteringMap) this.failMapLoading(error);
                        });
                        LoaderManager.getInstance().startLoadList(dataList, null,
                            (error: Error, paths: string[], datas: any[]) => {
                                if (!this.isValid || generation !== this._loadGeneration) return;
                                if (error != null) {
                                    this.failMapLoading(error);
                                    return;
                                }
                                this.logMapEntryStage('地图文件与配置就绪');
                                const boot = datas[1] as JsonAsset;
                                if (boot?.json?.version !== 1 || !boot.json.tables?.mapRes_0) {
                                    this.failMapLoading(new Error('战场配置版本无效'));
                                    return;
                                }
                                const tables = Object.keys(boot.json.tables).map(name => ({ name, json: boot.json.tables[name] }));
                                this._mapPreparation = this.prepareMap(datas[0] as JsonAsset, tables);
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
        try {
            // 每个渲染帧只推进一次，让进度条和骑将始终有刷新机会。
            if (this._mapPreparation?.next().done) this._mapPreparation = null;
            if (this._enteringMap && this._mapReady && this._mapUiReady) this.tryFinishLoading();
        } catch (error) {
            this.failMapLoading(error);
        }
    }

    private *prepareMap(geometry: JsonAsset, configAssets: Array<{ name: string; json: any }>): Generator<void, void, unknown> {
        if (!geometry?.json?.header || !Array.isArray(configAssets)) throw new Error('战场启动资源不完整');
        const tiledMap = new TiledMapAsset();
        tiledMap.tmxXmlStr = geometry.json.header + '</map>';
        const configs = ConfigManager.getInstance();
        configs.loadConfigs(configAssets);
        // 建筑面板使用设施适配层，必须在创建地图/UI 前装入两张建筑表。
        // 等级仍从 Build 推送读取，不能用配置中的初始等级覆盖服务端存档。
        MapUICommand.getInstance().proxy.setAllFacilityCfg(configAssets);
        SkillCommand.getInstance().proxy.initSkillConfig(configs.getConfig('Skill') || []);
        const heroJson = configs.getConfig('Hero');
        LoginCommand.getInstance().headIcons.initConfig(configs.getConfig('HeadIcon'), heroJson);
        const basicCfg = configs.getConfig('Global');
        MapUICommand.getInstance().proxy.setBasic({ json: basicCfg });
        if (heroJson) GeneralCommand.getInstance().proxy.initHeroConfig(heroJson, basicCfg);
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

        while (WorldMapArt.preparationProgress < 1) {
            EventMgr.emit(CoreEvent.mapLoadProgress, 0.83 + WorldMapArt.preparationProgress * .04, '正在铺展山河素材…');
            yield;
        }

        this.clearAllScene();
        this._mapScene = instantiate(this.mapScenePrefab);
        this._mapScene.parent = this.node;
        if (!this._enteringMap) return;
        if (this._loadingNode) this._loadingNode.setSiblingIndex(this.topLayer() + 1);
        EventMgr.emit(CoreEvent.mapLoadProgress, 0.87, '正在布置军令界面…');
        yield;

        this._mapUIScene = instantiate(this.mapUIScenePrefab);
        this._mapUIScene.parent = this.node;
        if (this._loadingNode) this._loadingNode.setSiblingIndex(this.topLayer() + 1);
        EventMgr.emit(CoreEvent.mapLoadProgress, 0.9, '正在部署城池与资源…');
        yield;

        // 隐藏窗口不参与首屏：只等待已经创建的 HUD 和当前地图视野。
        this._mapUiReady = true;
        this.logMapEntryStage('主界面就绪');
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
        this.logMapEntryStage('地图首屏就绪');
        this.tryFinishLoading();
    }

    private onCityBuildsChanged(): void {
        if (!this._enteringMap || !this._cityStateRequested) return;
        // 同一推送还会刷新地图城池，下一帧再淡出，确保材质和等级图已经应用。
        this.scheduleOnce(this.tryFinishLoading, 0);
    }

    private tryFinishLoading(): void {
        if (!this._enteringMap || this._finishingLoading || !this._mapReady || !this._mapUiReady) return;
        // 地图和资源已就绪即可通知服务器；遮罩保留到真实主城等级到达，
        // 避免先露出 level=0 的默认城图，再在玩家眼前切换等级外观。
        if (!this._cityStateRequested) {
            this._cityStateRequested = true;
            this.logMapEntryStage('请求主城资料');
            const generation = this._loadGeneration;
            this._cityStateTimer = setTimeout(() => {
                this._cityStateTimer = null;
                if (this.isValid && this._enteringMap && generation === this._loadGeneration) {
                    this.failMapLoading(new Error('主城资料读取超时'));
                }
            }, 12000);
            LoginCommand.getInstance().notifyClientLoaded();
        }
        if (!this._enteringMap || this._finishingLoading) return;
        const buildings = BuildCommand.getInstance();
        if (!buildings.loaded) {
            if (buildings.loadError) this.failMapLoading(new Error(buildings.loadError));
            else EventMgr.emit(CoreEvent.mapLoadProgress, 0.99, '正在准备主城…');
            return;
        }
        // 主城等级推送可能在首屏之后到达，仍等待当前等级图片真正就绪。
        if (WorldMapArt.visibleState.error) { this.failMapLoading(WorldMapArt.visibleState.error); return; }
        if (WorldMapArt.visibleState.pending > 0) return;
        if (this._cityStateTimer !== null) clearTimeout(this._cityStateTimer);
        this._cityStateTimer = null;
        this.finishLoading();
    }

    private finishLoading(): void {
        this._finishingLoading = true;
        this.logMapEntryStage('战场就绪，结束加载');
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
        this.logMapEntryStage('地图可操作（完整进图）');
        console.info('[MapEntry] 首屏资源', WorldMapArt.statistics);
        this.warmAssetsAfterLogin();
    }

    /** 首屏可操作后渐进加载整套功能图片；与界面预载共用单路后台队列。 */
    private warmAssetsAfterLogin(): void {
        const generation = this._loadGeneration;
        const proxy = GeneralCommand.getInstance().proxy;
        const skills = SkillCommand.getInstance().proxy;
        const heads = LoginCommand.getInstance().headIcons;
        AssetLoadQueue.pauseBackground(1500);
        const isCurrent = () => this.isValid && generation === this._loadGeneration && !!this._mapScene;
        const enqueued = new Set<string>();
        const enqueue = (key: string, load: () => Promise<unknown>) => {
            if (enqueued.has(key)) return;
            enqueued.add(key); this._backgroundAssetKeys.add(key);
            void AssetLoadQueue.request(key, () => isCurrent() ? load() : Promise.resolve(null), AssetPriority.Background)
                .catch(error => {
                    if (isCurrent() && !(error instanceof AssetRequestCancelled)) console.warn('[MapEntry] 后台预载未完成', key, error);
                }).then(() => { if (generation === this._loadGeneration) this._backgroundAssetKeys.delete(key); });
        };
        // 先准备武将首页，再补齐背包、技能、头像和余下武将，不等待打开界面。
        const owned = proxy.getUseGenerals();
        for (const hero of owned.slice(0, 6)) enqueue(`hero-warm:${hero.hero_type}`, () => proxy.loadGeneralTex(hero.hero_type));
        for (const name of SIEGE_SHEETS) enqueue(`siege-warm:${name}`, () => preloadSiegeSheet(name));
        for (const item of ConfigManager.getInstance().getConfig('Item') || []) {
            const path = itemIconPath(item.Id);
            if (path) enqueue(`item-warm:${path}`, () => InventoryIconCache.load(item.Id));
        }
        for (const skill of skills.skillConfs) {
            const path = skills.getIconPath(skill.cfgId);
            if (path) enqueue(`skill-warm:${path}`, () => skills.loadSkillIcon(skill.cfgId));
        }
        for (const head of heads.configs) enqueue(`head-warm:${heads.getIconPath(head.id)}`, () => heads.loadIcon(head.id));
        for (const hero of owned) enqueue(`hero-warm:${hero.hero_type}`, () => proxy.loadGeneralTex(hero.hero_type));
        for (const hero of proxy.getGeneralAllCfg().values()) enqueue(`hero-warm:${hero.id}`, () => proxy.loadGeneralTex(hero.id));
        console.info(`[MapEntry] 后台图片预载已排队：${enqueued.size} 项`);
    }

    private logMapEntryStage(stage: string): void {
        console.info(`[MapEntry] ${stage}：累计 ${Date.now() - this._mapEntryStartedAt}ms`);
    }

    private disposeLoadingNow(): void {
        if (this._afterLoadingDraw) {
            director.off(Director.EVENT_AFTER_DRAW, this._afterLoadingDraw, this);
            this._afterLoadingDraw = null;
        }
        this._loadGeneration++;
        for (const key of this._backgroundAssetKeys) AssetLoadQueue.cancel(key, AssetPriority.Background);
        this._backgroundAssetKeys.clear();
        this._mapPreparation = null;
        this._enteringMap = false;
        this._mapReady = false;
        this._mapUiReady = false;
        this._finishingLoading = false;
        this._heroRequest = null;
        this._cityStateRequested = false;
        if (this._cityStateTimer !== null) clearTimeout(this._cityStateTimer);
        this._cityStateTimer = null;
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
