import { _decorator, Camera, Color, Component, Node, Label, ProgressBar, Button, Sprite, Vec2, UIOpacity, UITransform, view } from 'cc';
const { ccclass, property } = _decorator;

import { ArmyCmd } from "../general/ArmyProxy";
import DateUtil from "../utils/DateUtil";
import { MapBuildData } from "./MapBuildProxy";
import { MapCityData } from "./MapCityProxy";
import MapCommand from "./MapCommand";
import { MapResConfig, MapResData, MapResType } from "./MapProxy";
import MapUICommand from "./ui/MapUICommand";
import { EventMgr } from '../utils/EventMgr';
import { AudioManager } from '../common/AudioManager';
import { LogicEvent } from '../common/LogicEvent';
import WorldMapArt from './WorldMapArt';
import WorldCampaign from './WorldCampaign';
import LoginCommand from '../login/LoginCommand';
import { playerCityFootprint } from './PlayerCityAppearance';
import MapUtil from './MapUtil';
import { isResourceLandCell } from '../world/ResourceLand';
import WorldCommand, { MarchTargetType } from '../world/WorldCommand';
import MapMarkCommand from '../world/MapMarkCommand';
import { hasId, idKey } from '../network/pto/ProtocolCommand';
import { caption, hideSprite, inkSurface, ManagementColors, panelButton, place, textStyle } from './ui/ManagementStyle';
import { paintTileSelection } from './TileHighlight';
import RightInfoNodeLogic from './ui/RightInfoNodeLogic';

@ccclass('MapClickUILogic')
export default class MapClickUILogic extends Component {
    @property(Node)
    bgSelect: Node = null;
    @property(Label)
    labelName: Label = null;
    @property(Label)
    labelUnion: Label = null;
    @property(Label)
    labelLunxian: Label = null;
    @property(Label)
    labelPos: Label = null;
    @property(Label)
    labelMian: Label = null;
    @property(Node)
    bgMain: Node = null;

    @property(Node)
    durableNode: Node = null;
    @property(Label)
    labelDurable: Label = null;
    @property(ProgressBar)
    progressBarDurable: ProgressBar = null;
    @property(Node)
    leftInfoNode: Node = null;
    @property(Label)
    labelYield: Label = null;
    @property(Label)
    labelSoldierCnt: Label = null;
    @property(Button)
    btnMove: Button = null;
    @property(Button)
    btnOccupy: Button = null;
    @property(Button)
    btnGiveUp: Button = null;
    @property(Button)
    btnReclaim: Button = null;
    @property(Button)
    btnEnter: Button = null;
    @property(Button)
    btnBuild: Button = null;
    @property(Button)
    btnTransfer: Button = null;

    @property(Button)
    btnTagAdd: Button = null;
    @property(Button)
    btnTagRemove: Button = null;

    protected _data: any = null;
    protected _pixelPos: Vec2 = null;
    private selectionKey = '';
    private selectionPhase = 0;
    private selectionPulse: UIOpacity = null;
    private _panel: Node = null;
    private _panelHeight = 200;
    private _camera: Camera = null;
    private _panelWidth = 340;
    private _campaignText = '';
    private _btnRelocate: Button = null;
    private _dockHost: Node = null;
    private _secondaryPanel: Node = null;
    private _closeButton: Button = null;
    private _occupying = false;
    private _sidebar: RightInfoNodeLogic = null;
    private _selectInSidebar = false;
    private _presentationKey = '';
    private _progressY = 0;

    protected onLoad(): void {
        this._panel = new Node('TileInformation'); this._panel.layer = this.node.layer;
        this.node.addChild(this._panel); this._panel.addComponent(UITransform);
        this._panel.active = false;
        const relocate = new Node('RelocateCity'); relocate.layer = this.node.layer;
        this._panel.addChild(relocate); relocate.addComponent(UITransform);
        this._btnRelocate = relocate.addComponent(Button);
        caption(relocate, 'Caption', '迁城', 0, 0, 90, 16);
        relocate.on(Button.EventType.CLICK, this.onClickRelocate, this);
        for (const name of ['bg', 'bgUnion', 'bgPos']) {
            const node = this.node.getChildByName(name); if (node) node.active = false;
        }
        hideSprite(this.bgMain);
        const labels = [this.labelName, this.labelPos, this.labelUnion, this.labelLunxian,
            this.labelYield, this.labelSoldierCnt, this.labelDurable, this.labelMian];
        for (const label of labels) {
            label.node.parent = this._panel; label.customMaterial = null;
            // 旧预制体的位图字体与新字号不匹配，会出现字形挤压和重叠。
            label.font = null; label.useSystemFont = true; label.fontFamily = 'Microsoft YaHei';
        }
        for (const button of this.buttons()) button.node.parent = this._panel;
        for (const label of this._panel.getComponentsInChildren(Label)) {
            label.customMaterial = null; label.font = null; label.useSystemFont = true;
            label.fontFamily = 'Microsoft YaHei';
        }
        for (const child of this.leftInfoNode.children) child.active = false;
        this.progressBarDurable.node.active = false;
        for (const sprite of this.node.getComponentsInChildren(Sprite)) {
            if (this._panel.getComponentsInChildren(Sprite).indexOf(sprite) < 0) sprite.enabled = false;
        }
        for (const label of this.node.getComponentsInChildren(Label)) {
            if (this._panel.getComponentsInChildren(Label).indexOf(label) < 0) label.enabled = false;
        }
        this.bgSelect.setSiblingIndex(0);
        this.setupDock();
    }

    private setupDock(): void {
        if (this._secondaryPanel) return;
        const action = (name: string, text: string, callback: () => void): Button => {
            const node = new Node(name); node.layer = this._panel.layer; this._panel.addChild(node);
            node.addComponent(UITransform);
            const button = node.addComponent(Button);
            caption(node, 'Caption', text, 0, 0, 80, 16);
            node.on(Button.EventType.CLICK, callback, this);
            return button;
        };
        this._closeButton = action('CloseTile', '×', this.closeSelection);
        if (!this.labelPos.node.getComponent(Button)) this.labelPos.node.addComponent(Button);
        this.labelPos.node.on(Button.EventType.CLICK, this.focusSelection, this);
        this._secondaryPanel = new Node('SecondaryActions'); this._secondaryPanel.layer = this._panel.layer;
        this._panel.addChild(this._secondaryPanel); this._secondaryPanel.addComponent(UITransform);
        for (const button of this.secondaryButtons()) button.node.parent = this._secondaryPanel;
        this.attachDock();
    }

    private secondaryButtons(): Button[] {
        return [this.btnGiveUp, this.btnReclaim, this.btnBuild, this.btnTransfer,
            this._btnRelocate, this.btnTagAdd, this.btnTagRemove].filter(Boolean);
    }

    private attachDock(): boolean {
        if (!this._dockHost?.isValid) {
            this._dockHost = null;
            for (let parent = this.node.parent; parent; parent = parent.parent) {
                const hud = parent.getChildByName('MapUIScene')?.getChildByName('HudRoot');
                if (hud) { this._dockHost = hud; break; }
            }
        }
        if (!this._dockHost) return false;
        if (!this._sidebar?.isValid) this._sidebar = this._dockHost.getComponentInChildren(RightInfoNodeLogic);
        if (!this._sidebar) return false;
        if (this._panel.layer !== this._dockHost.layer) {
            const setLayer = (node: Node): void => { node.layer = this._dockHost.layer; node.children.forEach(setLayer); };
            setLayer(this._panel);
            this._panel.setScale(1, 1, 1);
        }
        return true;
    }

    private closeSelection(): void {
        AudioManager.instance.playClick();
        this.node.parent = null;
    }

    private focusSelection(): void {
        if (!this._data) return;
        AudioManager.instance.playClick();
        EventMgr.emit(LogicEvent.scrollToMap, this._data.x, this._data.y);
    }

    private buttons(): Button[] {
        return [this.btnEnter, this.btnOccupy, this.btnMove, this.btnGiveUp, this.btnReclaim,
            this.btnBuild, this.btnTransfer, this._btnRelocate, this.btnTagAdd, this.btnTagRemove].filter(Boolean);
    }

    protected onDestroy(): void {
        // 选框和详情分别托管在地图层与侧栏，仍由本组件负责回收。
        if (this.bgSelect?.isValid && this.bgSelect.parent !== this.node) this.bgSelect.destroy();
        if (this._sidebar?.isValid) this._sidebar.releaseTilePanel(this._panel);
        if (this._panel?.isValid) this._panel.destroy();
        this._data = null;
        this._pixelPos = null;
    }

    protected onEnable(): void {
        EventMgr.on(LogicEvent.updateBuild, this.onUpdateBuild, this);
        EventMgr.on(LogicEvent.cityMoveState, this.updateRelocateButton, this);
        EventMgr.on(LogicEvent.updateWorldEntities, this.onWorldResourceChanged, this);
        EventMgr.on(LogicEvent.updateMarches, this.onWorldResourceChanged, this);
        EventMgr.on(LogicEvent.updateMyRole, this.onWorldResourceChanged, this);
        EventMgr.on(LogicEvent.updateTag, this.onMarksChanged, this);
        this.bgSelect.active = !!this._data && !(this._data instanceof MapCityData);
        this.placeGroundSelection();

        var uiOpacity = this.bgSelect.getComponent(UIOpacity) || this.bgSelect.addComponent(UIOpacity);
        uiOpacity.opacity = 255;

        this.selectionPhase = 0;
        if (this._panel) this.attachDock();
    }

    protected onDisable(): void {
        EventMgr.emit(LogicEvent.selectPlayerCity, null);
        EventMgr.targetOff(this);
        if (this.bgSelect?.isValid) this.bgSelect.active = false;
        if (this._panel?.isValid) this._panel.active = false;
        if (this._sidebar?.isValid) this._sidebar.releaseTilePanel(this._panel);
        this.stopCountDown();
    }

    protected onUpdateBuild(data: MapBuildData): void {
        if (this._data
            && this._data instanceof MapBuildData
            && this._data.x == data.x
            && this._data.y == data.y) {
            this.setCellData(data, this._pixelPos, false);
        }
    }

    protected onClickEnter(): void {
        AudioManager.instance.playClick();
        if (this._data instanceof MapCityData) {
            EventMgr.emit(LogicEvent.openCityAbout, this._data);
        }
        this.node.parent = null;
    }


    protected onTagAdd(): void {
        if (!this._data) return;
        AudioManager.instance.playClick();
        MapCommand.getInstance().opPosTag(1, this._data.x, this._data.y, this.labelName.string);
    }

    protected onTagRemove(): void {
        if (!this._data) return;
        AudioManager.instance.playClick();
        MapCommand.getInstance().opPosTag(0, this._data.x, this._data.y);
    }

    private onMarksChanged(): void {
        if (!this._data) return;
        const ownCity = this._data instanceof MapCityData && this._data.rid == MapCommand.getInstance().cityProxy.myId;
        const marked = MapMarkCommand.getInstance().has(this._data);
        this.btnTagAdd.node.active = !ownCity && !marked;
        this.btnTagRemove.node.active = !ownCity && marked;
        this.layoutPanel();
    }

    protected onClickOccupy(): void {
        AudioManager.instance.playClick();
        const empty = !!this._data?.isEmpty;
        if (this._data instanceof MapCityData || !empty && !isResourceLandCell(this._data)) {
            EventMgr.emit(LogicEvent.showToast, '请选择空地或资源地');
            return;
        }
        const { x, y, type, level } = this._data;
        const world = WorldCommand.getInstance();
        const reason = MapCommand.getInstance().campaignBlockReason(x, y)
            || (empty ? world.emptyLandIssue(x, y) : world.resourceLandIssue(x, y, type, level));
        if (reason) { EventMgr.emit(LogicEvent.showTip, reason, null); return; }
        // World 协议以真实资源实体为目标，交由服务端判定可达性及战斗占领。
        // 旧 nationMap 的相邻领地数据已不再同步，不能继续用它拦截新版出征。
        EventMgr.emit(LogicEvent.openArmySelectUi, ArmyCmd.Attack, x, y);

        this.node.parent = null;
    }

    protected onClickMove(): void {
        if (!this._data) return;
        AudioManager.instance.playClick();
        const { x, y } = this._data;
        const reason = MapCommand.getInstance().moveTargetIssue(x, y);
        if (reason) { EventMgr.emit(LogicEvent.showToast, reason); return; }
        EventMgr.emit(LogicEvent.openArmySelectUi, 'move', x, y);
        this.node.parent = null;
    }

    private onClickRelocate(): void {
        if (!this._data?.isEmpty || LoginCommand.getInstance().movingCity) return;
        AudioManager.instance.playClick();
        EventMgr.emit(LogicEvent.confirmMoveCity, { x: this._data.x, y: this._data.y });
        this.node.parent = null;
    }

    private updateRelocateButton(): void {
        if (!this._btnRelocate || !this._data) return;
        this._btnRelocate.node.active = this._data instanceof MapResData && !!this._data.isEmpty;
        this._btnRelocate.interactable = !LoginCommand.getInstance().movingCity;
        this.layoutPanel();
    }

    public setCellData(data: any, pixelPos: Vec2, select = true): void {
        this._selectInSidebar = select;
        this.stopCountDown();
        this._data = data;
        this._pixelPos = pixelPos;
        this._occupying = false;
        this.labelPos.string = "(" + data.x + ", " + data.y + ")";
        this.leftInfoNode.active = true;
        this.btnMove.node.active = !(data instanceof MapCityData) && (!!data.isEmpty || isResourceLandCell(data));
        this.btnGiveUp.node.active = false;
        this.btnReclaim.node.active = false;
        this.btnBuild.node.active = false;
        this.btnTransfer.node.active = false;
        this.btnEnter.node.active = false;
        this.btnOccupy.node.active = false;
        this.bgSelect.active = !(data instanceof MapCityData);
        EventMgr.emit(LogicEvent.selectPlayerCity, data instanceof MapCityData ? data.id : null);
        this.bgSelect.getComponent(UITransform).setContentSize(MapUtil.tileSize.width, MapUtil.tileSize.height);

        var isTag = MapCommand.getInstance().proxy.isPosTag(this._data.x, this._data.y);
        this.btnTagAdd.node.active = !isTag;
        this.btnTagRemove.node.active = isTag;

        if (this._data instanceof MapResData) {
            this.btnOccupy.node.active = !!data.isEmpty || isResourceLandCell(data);
            this.durableNode.active = false;
        } else if (this._data instanceof MapBuildData) {
            const build = this._data as MapBuildData;
            const mine = build.rid == MapCommand.getInstance().buildProxy.myId;
            const ally = build.unionId > 0 && build.unionId == MapCommand.getInstance().buildProxy.myUnionId;
            const captive = build.parentId > 0 && build.parentId == MapCommand.getInstance().buildProxy.myUnionId;
            this.btnOccupy.node.active = (!!data.isEmpty || isResourceLandCell(data)) && !mine && !ally && !captive;
            this.durableNode.active = this._data.maxDurable > 0;
            this.labelDurable.string = Math.ceil(this._data.curDurable / 100) + "/" + Math.ceil(this._data.maxDurable / 100);
            this.progressBarDurable.progress = this._data.maxDurable > 0 ? this._data.curDurable / this._data.maxDurable : 0;
        } else if (this._data instanceof MapCityData) {
            const city = this._data as MapCityData;
            if (city.rid == MapCommand.getInstance().cityProxy.myId) {
                this.btnEnter.node.active = true;
                this.btnTagAdd.node.active = false;
                this.btnTagRemove.node.active = false;
            }
            const footprint = playerCityFootprint(MapUtil.tileSize.width, MapUtil.tileSize.height);
            this.bgSelect.getComponent(UITransform).setContentSize(footprint.width, footprint.height);
            this.leftInfoNode.active = false;
            this.durableNode.active = city.maxDurable > 0;
            this.labelDurable.string = Math.ceil(this._data.curDurable / 100) + "/" + Math.ceil(this._data.maxDurable / 100);
            this.progressBarDurable.progress = city.maxDurable > 0 ? city.curDurable / city.maxDurable : 0;

        }



        if (this._data.type == MapResType.SYS_CITY) {
            const width = WorldMapArt.cityWidth(this._data.level) * 1.2;
            this.bgSelect.getComponent(UITransform).setContentSize(width, width * .5);
        }

        if (this.leftInfoNode.active) {

            let resData: MapResData = MapCommand.getInstance().proxy.getResData(this._data.id) || this._data;
            let resCfg: MapResConfig = MapCommand.getInstance().proxy.getResConfig(resData.type, resData.level);

            let soldiers = MapUICommand.getInstance().proxy.getDefenseSoldiers(resData.level);
            this.labelYield.string = MapCommand.getInstance().proxy.getResYieldDesList(resCfg).join("\n") || '暂无产量信息';
            this.labelSoldierCnt.string = soldiers > 0 ? "守备兵力  " + soldiers * 3 : '暂无守军情报';

            if (this._data.nickName) {
                this.labelName.string = this._data.nickName + ":" + this._data.name;
            } else {
                const names = { 50: '要塞', 51: '城池', 52: '林地', 53: '铁矿', 54: '石料', 55: '粮田' };
                this.labelName.string = this._data.name || resCfg?.name || `${resData.level}级${names[resData.type] || '土地'}`;
            }
        } else {
            this.labelName.string = this._data.name || '城池';
        }

        //归属属性
        if (this._data.rid == null || this._data.rid == 0) {
            this.labelUnion.string = "未占领";
        } else {
            if (this._data.unionId > 0) {
                this.labelUnion.string = this._data.unionName || '已占领';
            } else {
                this.labelUnion.string = "在野";
            }
        }

        if (this._data.parentId > 0) {
            this.labelLunxian.string = "沦陷";
        } else {
            this.labelLunxian.string = "";
        }


        //免战信息
        var limitTime = MapCommand.getInstance().proxy.getWarFree();
        var diff = DateUtil.getServerTime() - this._data.occupyTime;
        if (this._data instanceof MapBuildData) {
            if (diff > limitTime) {
                this.bgMain.active = false;
                this.labelMian.string = "";
            } else {
                this.bgMain.active = true;
                this.schedule(this.countDown, 1);
                this.countDown()
            }

        } else if (this._data instanceof MapCityData) {
            if (diff < limitTime && this._data.parentId > 0) {
                this.bgMain.active = true;
                this.schedule(this.countDown, 1);
                this.countDown()
            } else {
                this.bgMain.active = false;
                this.labelMian.string = "";
            }
        }
        const landmark = WorldCampaign.landmark(data.x, data.y);
        if (landmark) this.labelName.string = landmark;
        const gate = WorldCampaign.gateAt(data.x, data.y);
        const region = WorldCampaign.config?.regions[WorldCampaign.regionAt(data.x, data.y)];
        this._campaignText = gate ? `${gate.level}级关隘 · ${gate.regions.map(id => WorldCampaign.config.regions[id].name).join(' ↔ ')}\n同盟占领后打通两州，失守后路线关闭`
            : region ? `${region.name} · ${['出生州 · 稳固根基', '资源州 · 联盟争锋', '王畿 · 逐鹿洛阳'][region.tier]}` : '';
        if (gate) this.labelYield.string = '关隘守备以战斗情报为准';
        if (data.isEmpty) {
            this.labelName.string = '空地';
            this.labelYield.string = '无资源产出';
            this.labelSoldierCnt.string = '可出征占领，也可迁城';
        } else if (data instanceof MapResData && data.type >= 52 && data.type <= 55) {
            this.labelName.string = `${data.level}级${{ 52: '林地', 53: '铁矿', 54: '石料', 55: '粮田' }[data.type]}`;
        }
        this.updateWorldResourceInfo();
        this.updateRelocateButton();
    }

    private onWorldResourceChanged(): void {
        if (!this._data?.isEmpty && !isResourceLandCell(this._data)) return;
        this.updateWorldResourceInfo();
        this.layoutPanel();
    }

    /** 占领中只认到达后的倒计时；归属仍只认倒计时结束后的 AOI ownerId。 */
    private updateWorldResourceInfo(): void {
        const empty = !!this._data?.isEmpty;
        if ((!empty && !isResourceLandCell(this._data)) || this._data instanceof MapCityData) return;
        const world = WorldCommand.getInstance();
        const entity = world.resourceLandAt(this._data.x, this._data.y);
        const userId = LoginCommand.getInstance().proxy.getRoleData()?.userId;
        const entityId = world.resourceLandEntityId(this._data.x, this._data.y);
        const march = world.marches.values().find(m => m.targetType === MarchTargetType.OccupyResource
            && idKey(m.targetId) === idKey(entityId));
        const now = DateUtil.getServerTime() / 1000;
        const countdown = world.occupyCountdownAt(this._data.x, this._data.y, now);
        const occupying = !!countdown;
        this._occupying = occupying;
        const marching = march?.state === 1;
        const mine = !occupying && entity && hasId(userId) && idKey(entity.ownerId) === idKey(userId);
        const other = entity && hasId(entity.ownerId) && !mine && !occupying;
        this.labelUnion.string = occupying ? '占领中' : other ? '其他玩家领地' : mine ? '己方领地 · 已占领' : '未占领';
        this.labelLunxian.string = '';
        this.btnOccupy.node.active = !occupying && !marching;
        if (empty && !mine && !other) {
            this.labelName.string = '空地';
            this.labelYield.string = '无资源产出';
        }
        this.unschedule(this.tickOccupyCountdown);
        if (occupying) {
            this.paintOccupyCountdown(countdown, march?.troopIdx);
            this.schedule(this.tickOccupyCountdown, .2);
        } else if (mine) this.labelSoldierCnt.string = empty ? '选择部队驻守' : '选择部队采集';
        else if (marching) this.labelSoldierCnt.string = `部队${march.troopIdx} · 出征中`;
        else if (march) this.labelSoldierCnt.string = `部队${march.troopIdx}已到达`;
        else this.labelSoldierCnt.string = other ? '选择部队出征，击败守军后占领'
            : empty ? '选择部队出征占领' : '选择部队出征，战斗胜利后占领';
        if (!occupying && this.durableNode) {
            // 资源地点开时耐久条不显示；占领读条复用同一节点。
            if (!(this._data instanceof MapBuildData) && !(this._data instanceof MapCityData)) {
                this.durableNode.active = false;
            }
        }
    }

    private tickOccupyCountdown = (): void => {
        if (!this._data || this._data instanceof MapCityData) { this.unschedule(this.tickOccupyCountdown); return; }
        const world = WorldCommand.getInstance();
        const now = DateUtil.getServerTime() / 1000;
        const countdown = world.occupyCountdownAt(this._data.x, this._data.y, now);
        if (!countdown) { this.updateWorldResourceInfo(); this.layoutPanel(); return; }
        const entityId = world.resourceLandEntityId(this._data.x, this._data.y);
        const march = world.marches.values().find(m => m.targetType === MarchTargetType.OccupyResource
            && idKey(m.targetId) === idKey(entityId));
        this.paintOccupyCountdown(countdown, march?.troopIdx);
    };

    private paintOccupyCountdown(countdown: { startTime: number; endTime: number }, troopIdx?: number): void {
        const now = DateUtil.getServerTime() / 1000;
        const left = Math.max(0, countdown.endTime - now);
        const span = Math.max(.001, countdown.endTime - countdown.startTime);
        const who = troopIdx ? `部队${troopIdx} · ` : '';
        this.labelSoldierCnt.string = left > 0 ? `${who}占领倒计时 ${DateUtil.converSecondStr(Math.ceil(left) * 1000)}`
            : `${who}等待服务器确认占领`;
        if (this.durableNode && this.progressBarDurable && this.labelDurable) {
            this.durableNode.active = true;
            this.progressBarDurable.node.active = true;
            this.progressBarDurable.progress = Math.min(1, Math.max(0, (now - countdown.startTime) / span));
            this.labelDurable.string = left > 0 ? DateUtil.converSecondStr(Math.ceil(left) * 1000) : '确认中';
        }
        this.paintDockProgress();
    }

    private layoutPanel(): void {
        if (!this._panel || !this._data) return;
        this.setupDock();
        if (!this.attachDock()) return;
        this._panelWidth = this._sidebar.getComponent(UITransform).width - 8;
        const width = this._panelWidth, contentWidth = width - 24;
        const marks = MapMarkCommand.getInstance();
        const marking = marks.pendingAt(this._data);
        this.btnTagAdd.interactable = this.btnTagRemove.interactable = marks.sessionReady && marks.loaded && !marks.loading && !marks.busy;
        const primary = [this.btnEnter, this.btnOccupy, this.btnMove].filter(b => b.node.active);
        const secondary = this.secondaryButtons().filter(b => b.node.active);
        const yieldText = this.leftInfoNode.active ? this.labelYield.string.replace(/\n/g, ' · ') : '';
        const yieldHeight = yieldText ? Math.min(3, Math.max(1, Math.ceil(yieldText.length * 14 / contentWidth))) * 22 : 0;
        // 常态不重复“选择部队”提示；真正的行军、占领进度才占用一行。
        const showActivity = this.leftInfoNode.active && /出征中|已到达|倒计时|等待服务器/.test(this.labelSoldierCnt.string);
        const activityHeight = showActivity ? 36 : 0;
        const durable = this.durableNode.active, showDurableText = durable && !this._occupying;
        const regionHeight = this._campaignText ? 40 : 0;
        const secondaryHeight = Math.ceil(secondary.length / 2) * 44;
        const detailsHeight = yieldHeight + activityHeight + (showDurableText ? 24 : 0) + (this.bgMain.active ? 24 : 0) + (durable ? 12 : 0);
        const height = Math.max(184, 70 + detailsHeight + (primary.length ? 48 : 0) + secondaryHeight + regionHeight + 12);
        this._panelHeight = height;
        const selected = this._selectInSidebar; this._selectInSidebar = false;
        const key = JSON.stringify([width, height, this._data.x, this._data.y, this.labelName.string,
            this.labelUnion.string, this.labelLunxian.string, yieldText, showActivity, showDurableText, this.bgMain.active,
            this._occupying, this._campaignText, marking, this.buttons().map(b => [b.node.active, b.interactable])]);
        if (key === this._presentationKey) {
            this._sidebar.showTilePanel(this._panel, height, selected);
            return;
        }
        this._presentationKey = key;
        this._panel.getComponent(UITransform).setContentSize(width, height);
        // 复用侧栏背景，不再叠加独立的浮窗。
        const oldSurface = this._panel.getChildByName('Surface'); if (oldSurface) oldSurface.active = false;
        const left = Label.HorizontalAlign.LEFT, center = Label.HorizontalAlign.CENTER;
        const top = height / 2;
        textStyle(this.labelName, -18, top - 20, contentWidth - 36, 17, ManagementColors.text, left, 30);
        const titleColor = this.labelUnion.string.includes('其他玩家') ? new Color(220, 135, 118)
            : this.labelUnion.string.includes('己方') ? new Color(139, 195, 174) : ManagementColors.muted;
        const state = this.labelUnion.string.replace(' · 已占领', '') + (this.labelLunxian.string ? ' · ' + this.labelLunxian.string : '');
        // 归属和坐标是两个独立文本，长名称也不会挤到操作区。
        this.labelUnion.node.active = false; this.labelLunxian.node.active = false;
        const status = caption(this._panel, 'Ownership', state, -56, top - 46, contentWidth - 112, 12, titleColor);
        status.overflow = Label.Overflow.SHRINK;
        textStyle(this.labelPos, contentWidth / 2 - 56, top - 46, 112, 12, ManagementColors.gold, Label.HorizontalAlign.RIGHT, 32);
        // 保留足够点击面积，用轻量图标而非另一个大按钮。
        place(this._closeButton.node, contentWidth / 2 - 14, top - 20, 32, 32);
        const oldClose = this._closeButton.node.getChildByName('ManagementButton'); if (oldClose) oldClose.active = false;
        const closeCaption = this._closeButton.node.getComponentInChildren(Label);
        closeCaption.node.active = true; closeCaption.string = '×';
        textStyle(closeCaption, 0, 0, 32, 22, ManagementColors.muted, center, 32);
        const rule = inkSurface(this._panel, 'TileRule', contentWidth, 1, null, null);
        rule.node.setPosition(0, top - 64, 0);
        rule.strokeColor = ManagementColors.line; rule.lineWidth = 1;
        rule.moveTo(-contentWidth / 2, 0); rule.lineTo(contentWidth / 2, 0); rule.stroke();
        let y = top - 72;
        this.labelYield.node.active = !!yieldHeight;
        if (yieldHeight) {
            textStyle(this.labelYield, 0, y - yieldHeight / 2, contentWidth, 14, ManagementColors.text, left, yieldHeight);
            this.labelYield.string = yieldText; this.labelYield.lineHeight = 22; this.labelYield.enableWrapText = true; y -= yieldHeight;
        }
        this.labelSoldierCnt.node.active = showActivity;
        if (showActivity) {
            textStyle(this.labelSoldierCnt, 0, y - activityHeight / 2, contentWidth, 12, ManagementColors.gold, left, activityHeight);
            this.labelSoldierCnt.enableWrapText = true; this.labelSoldierCnt.lineHeight = 18; y -= activityHeight;
        }
        this.labelDurable.node.active = showDurableText;
        if (showDurableText) {
            if (!this.labelDurable.string.startsWith('耐久')) this.labelDurable.string = '耐久  ' + this.labelDurable.string;
            textStyle(this.labelDurable, 0, y - 12, contentWidth, 12, ManagementColors.muted, left, 24); y -= 24;
        }
        this.labelMian.node.active = this.bgMain.active;
        if (this.bgMain.active) {
            textStyle(this.labelMian, 0, y - 12, contentWidth, 12, ManagementColors.gold, left, 24); y -= 24;
        }
        this._progressY = y - 5;
        if (durable) y -= 12;
        const own = this.labelUnion.string.includes('己方');
        const occupyText = WorldCampaign.gateAt(this._data.x, this._data.y) ? '攻打关隘'
            : own ? this._data.isEmpty ? '派兵驻守' : '派兵采集'
                : this.labelUnion.string.includes('其他玩家') ? '攻占领地' : '出征占领';
        const texts = new Map<Button, string>([[this.btnEnter, '进入城池'], [this.btnOccupy, occupyText],
            [this.btnMove, '移动部队'], [this.btnGiveUp, '放弃领地'], [this.btnReclaim, '屯田'], [this.btnBuild, '建造'],
            [this._btnRelocate, LoginCommand.getInstance().movingCity ? '迁城中…' : '迁城至此'],
            [this.btnTransfer, '调动'], [this.btnTagAdd, marking ? '标记中…' : '添加标记'], [this.btnTagRemove, marking ? '取消中…' : '取消标记']]);
        const gap = 8, actionWidth = (contentWidth - Math.max(0, primary.length - 1) * gap) / Math.max(1, primary.length);
        const styleAction = (button: Button, text: string, x: number, py: number, w: number, h: number, main = false): void => {
            panelButton(button.node, text, x, py, w, h, main);
            const label = button.node.getComponentInChildren(Label);
            if (label) { label.fontSize = 14; label.lineHeight = 20; }
        };
        if (primary.length) {
            y -= 8;
            primary.forEach((button, i) => styleAction(button, texts.get(button),
                -contentWidth / 2 + actionWidth / 2 + i * (actionWidth + gap), y - 20, actionWidth, 40, i === 0));
            y -= 40;
        }
        this._secondaryPanel.active = secondary.length > 0 || !!this._campaignText;
        place(this._secondaryPanel, 0, y - (secondaryHeight + regionHeight) / 2, width, secondaryHeight + regionHeight);
        const oldSecondarySurface = this._secondaryPanel.getChildByName('Surface'); if (oldSecondarySurface) oldSecondarySurface.active = false;
        const secondaryWidth = secondary.length === 1 ? contentWidth : (contentWidth - gap) / 2;
        const secondaryTop = (secondaryHeight + regionHeight) / 2;
        secondary.forEach((button, i) => styleAction(button, texts.get(button),
            secondary.length === 1 ? 0 : (i % 2 ? 1 : -1) * (secondaryWidth + gap) / 2,
            secondaryTop - 26 - Math.floor(i / 2) * 44, secondaryWidth, 36));
        const region = caption(this._secondaryPanel, 'Region', this._campaignText, 0,
            secondaryTop - secondaryHeight - regionHeight / 2, contentWidth, 12, ManagementColors.muted);
        region.node.active = !!this._campaignText; region.enableWrapText = true; region.lineHeight = 18;
        region.getComponent(UITransform).height = regionHeight;
        const legacy = this._panel.getChildByName('CampaignDetail'); if (legacy) legacy.active = false;
        this.paintDockProgress();
        hideSprite(this.bgSelect);
        this._sidebar.showTilePanel(this._panel, height, selected);
    }

    private paintDockProgress(): void {
        if (!this._panel || !this._data) return;
        const exists = this._panel.getChildByName('DockProgress');
        if (!this.durableNode.active) { if (exists) exists.active = false; return; }
        const width = this._panelWidth - 24;
        const g = inkSurface(this._panel, 'DockProgress', width, 4, null, null);
        g.node.active = true; g.node.setPosition(0, this._progressY, 0);
        g.fillColor = new Color(72, 75, 60, 230); g.rect(-width / 2, -2, width, 4); g.fill();
        g.fillColor = ManagementColors.gold;
        const progress = Math.max(0, Math.min(1, this.progressBarDurable.progress));
        if (progress > 0) { g.rect(-width / 2, -2, width * progress, 4); g.fill(); }
    }

    private refreshSelection(zoom = 1): void {
        const ui = this.bgSelect.getComponent(UITransform);
        const key = `${ui.width}:${ui.height}:${Math.round(zoom * 40)}`;
        if (key === this.selectionKey) return;
        this.selectionKey = key;
        this.selectionPulse = paintTileSelection(this.bgSelect, ui.width, ui.height, zoom);
    }

    /** 详情位于右侧栏，地块选框留在部队下方，不穿过人物。 */
    private placeGroundSelection(): void {
        if (!this.bgSelect?.isValid || !this.node.activeInHierarchy) return;
        for (let parent = this.node.parent; parent; parent = parent.parent) {
            const armyLayer = (parent.getComponent('MapArmyLogic') as Component & { parentLayer: Node })?.parentLayer;
            if (!armyLayer?.parent) continue;
            if (this.bgSelect.parent !== armyLayer.parent) this.bgSelect.setParent(armyLayer.parent, true);
            // 从前方移至目标索引时数组会先缩短一项，明确保持在 armyLayer 前一位。
            const index = armyLayer.getSiblingIndex();
            const current = this.bgSelect.getSiblingIndex(), target = current < index ? index - 1 : index;
            if (current !== target) this.bgSelect.setSiblingIndex(target);
            this.bgSelect.setWorldPosition(this.node.worldPosition);
            this.bgSelect.setWorldScale(this.node.worldScale);
            return;
        }
    }

    protected lateUpdate(dt = 0): void {
        this.placeGroundSelection();
        if (!this._panel || !this._data) return;
        if (!this._camera) for (let p = this.node.parent; p; p = p.parent) {
            this._camera = p.getChildByName('Map Camera')?.getComponent(Camera);
            if (this._camera) break;
        }
        if (!this._camera) return;
        const size = view.getVisibleSize();
        const scale = this._camera.orthoHeight * 2 / Math.max(1, size.height);
        this.refreshSelection(scale);
        this.selectionPhase += Math.min(dt, .1);
        if (this.selectionPulse) this.selectionPulse.opacity = 230 + Math.sin(this.selectionPhase * Math.PI) * 20;
        if (!this.attachDock()) { this._panel.active = false; return; }
        const width = this._sidebar.getComponent(UITransform).width - 8;
        if (this._panelWidth !== width) this.layoutPanel();
    }

    public countDown() {
        var diff = DateUtil.getServerTime() - this._data.occupyTime;
        var limitTime = MapCommand.getInstance().proxy.getWarFree();
        if (diff > limitTime) {
            this.stopCountDown();
            this.layoutPanel();

        } else {
            var str = DateUtil.converSecondStr(limitTime - diff);
            this.labelMian.string = "免战：" + str;
        }
    }

    public stopCountDown() {
        this.unscheduleAllCallbacks();
        this.labelMian.string = "";
        this.bgMain.active = false;
    }
}
