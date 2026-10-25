import { _decorator, Component, Prefab, Node, Layout, Label, EditBox, Button, Color, Graphics, instantiate, UITransform, Vec2, Sprite, SpriteFrame, input, Input, EventKeyboard, KeyCode, game, Game } from 'cc';
const { ccclass, property } = _decorator;

import LoginCommand from "../../login/LoginCommand";
import ArmySelectNodeLogic from "./ArmySelectNodeLogic";
import CityArmySettingLogic from "./CityArmySettingLogic";
import CityBuildingPanel from './CityBuildingPanel';
import MapUICommand from "./MapUICommand";
import Dialog, { DialogType } from "./Dialog";
import UnionCommand from "../../union/UnionCommand";
import MapCommand from "../MapCommand";
import MapUtil from "../MapUtil";
import CityAboutLogic from "./CityAboutLogic";
import GeneralListLogic from "./GeneralListLogic";
import TransformLogic from "./TransformLogic";
import { Tools } from "../../utils/Tools";
import GeneralInfoLogic from "./GeneralInfoLogic";
import WarReportLogic from "./WarReportLogic";
import DrawRLogic from "./DrawRLogic";
import { GeneralData } from "../../general/GeneralProxy";
import SkillLogic from "./SkillLogic";
import { SkillConf } from "../../config/skill/Skill";
import SkillInfoLogic from "./SkillInfoLogic";
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { Skill } from '../../skill/SkillProxy';
import { LogicEvent } from '../../common/LogicEvent';
import { ServerConfig } from '../../config/ServerConfig';
import { NetManager } from '../../network/socket/NetManager';
import { ProtoManager } from '../../network/pto/ProtoManager';
import TroopCommand from '../../general/TroopCommand';
import { CoreEvent } from '../../core/CoreEvent';
import HeadIconPanel from './HeadIconPanel';
import SystemOpenCommand from '../../systemopen/SystemOpenCommand';
import { arrangeHudEntries, styleBottomNavigation, styleMoreMenu, styleWarReportShortcut } from './HudMenuSkin';
import { Setting } from './Setting';
import MapTaskTracker from './MapTaskTracker';
import PlayerServicesPanel, { ServiceSection } from './PlayerServicesPanel';
import { CityPosition } from '../../login/LoginCommand';

@ccclass('MapUILogic')
export default class MapUILogic extends Component {

    @property(SpriteFrame)
    innerCityIcon: SpriteFrame = null;

    @property(SpriteFrame)
    recruitIcon: SpriteFrame = null;

    @property(SpriteFrame)
    warReportIcon: SpriteFrame = null;

    @property(SpriteFrame)
    chatMenuIcon: SpriteFrame = null;

    @property(SpriteFrame)
    skillMenuIcon: SpriteFrame = null;

    @property(SpriteFrame)
    settingsMenuIcon: SpriteFrame = null;

    @property(Prefab)
    settingPrefab: Prefab = null;

    private _settingNode: Node | null = null;

    private _innerCityButton: Node | null = null;

    @property(Node)
    contentNode: Node = null;

    @property(Prefab)
    facilityPrefab: Prefab = null;
    protected _facilityNode: Node = null;

    @property(Prefab)
    armySettingPrefab: Prefab = null;
    protected _armySettingNode: Node = null;

    @property(Prefab)
    dialog: Prefab = null;
    protected _dialogNode: Node = null;

    @property(Prefab)
    generalPrefab: Prefab = null;
    protected _generalNode: Node = null;

    @property(Prefab)
    generalDesPrefab: Prefab = null;
    protected _generalDesNode: Node = null;

    @property(Prefab)
    cityAboutPrefab: Prefab = null;
    protected _cityAboutNode: Node = null;

    @property(Prefab)
    warReportPrefab: Prefab = null;
    protected _warReportNode: Node = null;
    @property(Prefab)
    armySelectPrefab: Prefab = null;
    protected _armySelectNode: Node = null;

    @property(Prefab)
    drawPrefab: Prefab = null;
    protected _drawNode: Node = null;

    @property(Prefab)
    drawResultrefab: Prefab = null;
    protected _drawResultNode: Node = null;

    @property(Prefab)
    unionPrefab: Prefab = null;
    protected _unionNode: Node = null;

    @property(Prefab)
    chatPrefab: Prefab = null;
    protected _chatNode: Node = null;

    @property(Prefab)
    collectPrefab: Prefab = null;
    protected _collectNode: Node = null;


    @property(Prefab)
    transFormPrefab: Prefab = null;
    protected _transFormNode: Node = null;

    @property(Prefab)
    generalConvertPrefab: Prefab = null;
    protected _generalConvertNode: Node = null;

    @property(Prefab)
    generalRosterPrefab: Prefab = null;
    protected _generalRosterNode: Node = null;

    @property(Prefab)
    skillPrefab: Prefab = null;
    protected _skillNode: Node = null;

    @property(Prefab)
    skillInfoPrefab: Prefab = null;
    protected _skillInfoNode: Node = null;

    @property(Prefab)
    cloudAniPrefab: Prefab = null;
    protected _cloudAniNode: Node = null;


    @property(Node)
    widgetNode: Node = null;

    @property(Layout)
    srollLayout: Layout = null;

    @property(Label)
    nameLabel: Label = null;

    @property(Label)
    ridLabel: Label = null;

    @property(Node)
    gmPanel: Node = null;

    @property(EditBox)
    gmCommandBox: EditBox = null;

    @property(EditBox)
    gmEditBoxX: EditBox = null;

    @property(EditBox)
    gmEditBoxY: EditBox = null;

    @property(Label)
    gmCoordLabel: Label = null;

    @property(Label)
    gmTipLabel: Label = null;

    private _gmInputBound = false;
    private _gmCtrlKeys = new Set<KeyCode>();
    private _gmBDown = false;
    private _gmHistory: string[] = [];
    private _gmHistoryIndex = -1;
    private _gmHistoryDraft = "";
    private _gmMessages: string[] = [];

    protected _morePanel: Node = null;
    protected _moreMask: Node = null;
    protected _moreIndicator: Node = null;

    protected readonly _resArray = [
        { key: 1, name: "粮" },
        { key: 2, name: "木" },
        { key: 3, name: "铁" },
        { key: 5, name: "石" },
    ];
    private _uiListenersReady = false;
    private _hudTopShade: Graphics | null = null;
    private _headPanel: HeadIconPanel | null = null;
    private _headRequest = 0;
    private _playerAvatar: Sprite | null = null;
    private _taskTracker: MapTaskTracker | null = null;
    private _servicesPanel: PlayerServicesPanel | null = null;

    protected onLoad(): void {

        EventMgr.on(CoreEvent.gameReady, this.onGameReady, this);
        // 被顶号需要立即处理，普通界面事件等加载结束再接入。
        EventMgr.on(LogicEvent.robLoginUI, this.robLoginUI, this);

        this.gmCommandBox?.node.on(EditBox.EventType.EDITING_RETURN, this.onClickGMExecute, this);
        this.gmEditBoxX?.node.on(EditBox.EventType.EDITING_RETURN, this.onGMCoordReturn, this);
        this.gmEditBoxY?.node.on(EditBox.EventType.EDITING_RETURN, this.onGMCoordReturn, this);
        this.initHudNavigation();
        this.initMoreMenu();
        this.initHeadIconEntry();
        this.initTaskTracker();
        this.node.on(Node.EventType.SIZE_CHANGED, this.layoutHud, this);
        this.layoutHud();
        this.scheduleOnce(this.layoutHud, 0);
        this.updateRoleRes();
        this.updateRole();
    }

    private onGameReady(): void {
        if (this._uiListenersReady || !this.isValid) return;
        this._uiListenersReady = true;
        EventMgr.on(LogicEvent.openCityAbout, this.openCityAbout, this);
        EventMgr.on(LogicEvent.closeCityAbout, this.closeCityAbout, this);
        EventMgr.on(LogicEvent.openFacility, this.openFacility, this);
        EventMgr.on(LogicEvent.openArmySetting, this.openArmySetting, this);
        EventMgr.on(LogicEvent.upateMyRoleRes, this.updateRoleRes, this);
        EventMgr.on(LogicEvent.updateMyRole, this.updateRole, this);
        EventMgr.on(LogicEvent.openGeneralDes, this.openGeneralDes, this);
        EventMgr.on(LogicEvent.openGeneralChoose, this.openGeneralChoose, this);
        EventMgr.on(LogicEvent.openArmySelectUi, this.onOpenArmySelectUI, this);
        EventMgr.on(LogicEvent.openDrawResult, this.openDrawR, this);
        EventMgr.on(LogicEvent.interiorCollect, this.onCollection, this);
        EventMgr.on(LogicEvent.openGeneralConvert, this.onOpenGeneralConvert, this);
        EventMgr.on(LogicEvent.openGeneralRoster, this.onOpenGeneralRoster, this);
        EventMgr.on(LogicEvent.openGeneral, this.openGeneral, this);
        EventMgr.on(LogicEvent.openSkill, this.onOpenSkill, this);
        EventMgr.on(LogicEvent.closeSkill, this.onCloseSkill, this);
        EventMgr.on(LogicEvent.openSkillInfo, this.onOpenSkillInfo, this);
        EventMgr.on(LogicEvent.beforeScrollToMap, this.beforeScrollToMap, this);
        EventMgr.on(LogicEvent.showTip, this.showTip, this);
        EventMgr.on(LogicEvent.confirmMoveCity, this.showMoveCityConfirm, this);
        EventMgr.on(LogicEvent.mapEenterChange, this.onMapCenterChange, this);
        EventMgr.on(ServerConfig.s2c_gm_command_help, this.onGMCommandHelp, this);
        EventMgr.on(ServerConfig.s2c_tell_me, this.onTellMe, this);
        this.bindGMInput();
        TroopCommand.getInstance().requestTroops();



        // 加载期间数据层继续同步，在这里一次性取最新缓存刷新 HUD。
        this.updateRoleRes();
        this.updateRole();
        let unionId = MapCommand.getInstance().cityProxy.myUnionId;
        if (Number(unionId) > 0) {
            UnionCommand.getInstance().unionApplyList(unionId);
        }
    }

    protected robLoginUI(): void {
        this.showTip("账号在其他地方登录", function () {
            EventMgr.emit(LogicEvent.enterLogin);
        });
    }

    protected showTip(text: string, close: Function): void {
        if (this._dialogNode == null) {
            this._dialogNode = instantiate(this.dialog)
            this._dialogNode.parent = this.contentNode;
        } else {
            this._dialogNode.active = true;
        }
        this._dialogNode.setSiblingIndex(this.topLayer());
        this._dialogNode.getComponent(Dialog).show(text, DialogType.OnlyConfirm);
        this._dialogNode.getComponent(Dialog).setConfirmCB(null);
        this._dialogNode.getComponent(Dialog).setCancelCB(null);
        this._dialogNode.getComponent(Dialog).setClose(close);
    }

    private cityMoveTargetIssue(pos: CityPosition): string {
        const issue = LoginCommand.getInstance().cityMoveIssue(pos);
        if (issue) return issue;
        const map = MapCommand.getInstance(), id = MapUtil.getIdByCellPoint(pos.x, pos.y);
        if (!map.proxy.getResData(id)?.isEmpty || map.cityProxy.getCity(id) || map.buildProxy.getBuild(id)) {
            return '请选择没有城池或建筑的空地';
        }
        return map.campaignBlockReason(pos.x, pos.y, false);
    }

    private showMoveCityConfirm(pos: CityPosition): void {
        if (!this._uiListenersReady) return;
        const issue = this.cityMoveTargetIssue(pos);
        if (issue) { EventMgr.emit(LogicEvent.showToast, issue); return; }
        const target = { x: pos.x, y: pos.y };
        this.showTip(`将主城迁至（${target.x}，${target.y}）？\n需使用迁城令，请确认目标位置。`, null);
        const dialog = this._dialogNode.getComponent(Dialog);
        dialog.show(dialog.text.string, DialogType.Default);
        dialog.setConfirmCB(() => {
            if (!this.isValid || !this._uiListenersReady) return;
            const reason = this.cityMoveTargetIssue(target);
            if (reason) { EventMgr.emit(LogicEvent.showToast, reason); return; }
            LoginCommand.getInstance().moveCity(target);
        });
    }

    private initTaskTracker(): void {
        const hud = this.node.getChildByName('HudRoot');
        if (!hud || this._taskTracker) return;
        const node = new Node('TaskTracker'); node.layer = hud.layer;
        hud.addChild(node); node.setSiblingIndex(0);
        this._taskTracker = node.addComponent(MapTaskTracker);
        this._taskTracker.initialize(() => this.openServices('tasks'));
    }

    private openServices(section: ServiceSection): void {
        if (!this._uiListenersReady || !this.contentNode) return;
        AudioManager.instance.playClick(); this.closeMoreMenu();
        if (!this._servicesPanel?.isValid) {
            const node = new Node('PlayerServicesPanel'); node.layer = this.node.layer;
            this.contentNode.addChild(node);
            this._servicesPanel = node.addComponent(PlayerServicesPanel);
        }
        this._servicesPanel.node.setSiblingIndex(this.topLayer());
        this._servicesPanel.show(section);
    }


    protected onDestroy(): void {
        // 子节点会先于父组件销毁。先释放全局监听，不能因访问已销毁节点而跳过清理。
        EventMgr.targetOff(this);
        this._uiListenersReady = false;
        this.unbindGMInput();
        const commandNode = this.gmCommandBox?.node;
        const xNode = this.gmEditBoxX?.node;
        const yNode = this.gmEditBoxY?.node;
        if (commandNode?.isValid) commandNode.off(EditBox.EventType.EDITING_RETURN, this.onClickGMExecute, this);
        if (xNode?.isValid) xNode.off(EditBox.EventType.EDITING_RETURN, this.onGMCoordReturn, this);
        if (yNode?.isValid) yNode.off(EditBox.EventType.EDITING_RETURN, this.onGMCoordReturn, this);
        this._headRequest++;
        const avatarNode = this._playerAvatar?.node;
        if (avatarNode?.isValid) avatarNode.off(Button.EventType.CLICK, this.openHeadIcons, this);
        if (this.node?.isValid) this.node.off(Node.EventType.SIZE_CHANGED, this.layoutHud, this);
        if (this._innerCityButton?.isValid) this._innerCityButton.off(Button.EventType.CLICK, this.openInnerCity, this);
        this._innerCityButton = null;
        this._playerAvatar = null;
        this.clearAllNode();
        MapUICommand.getInstance().proxy.clearData();

        console.log("MapUILogic onDestroy")
    }

    /** 按可视区域布局常驻 HUD；弹窗和地图不参与此布局。 */
    private layoutHud(): void {
        const rootUi = this.node.getComponent(UITransform);
        const hud = this.node.getChildByName("HudRoot");
        if (!rootUi || !hud) {
            return;
        }
        const width = rootUi.width;
        const height = rootUi.height;
        this.drawHudTopShade(width, height);
        this._taskTracker?.layout(width, height);
        const margin = 12;
        const top = height * 0.5;
        const bottom = -height * 0.5 + margin;
        const headerY = top - 32;
        const playerWidth = 224;
        const player = this.node.getChildByName("PlayerCard");
        if (player) {
            player.getComponent(UITransform)?.setContentSize(playerWidth, 60);
            player.setPosition(-width * 0.5 + margin + playerWidth * 0.5, top - margin - 30, 0);
        }
        const resources = this.node.getChildByName("ResourceBar");
        const resourcesUi = resources ? resources.getComponent(UITransform) : null;
        if (resources && resourcesUi) {
            // 资源栏紧凑贴右；窄屏时压缩宽度避让头像。
            const safeLeft = -width * 0.5 + margin * 2 + playerWidth;
            const safeRight = width * 0.5 - margin;
            const barWidth = Math.min(400, safeRight - safeLeft);
            const barX = safeRight - barWidth * 0.5;
            resourcesUi.setContentSize(barWidth, 40);
            resources.setPosition(barX, headerY, 0);
            const step = barWidth / 4;
            resources.children.forEach((slot, index) => {
                slot.setPosition((index - 1.5) * step, 0, 0);
                slot.getComponent(UITransform)?.setContentSize(step, 44);
                const icon = slot.getChildByName("Dot");
                if (icon) {
                    icon.setPosition(-step * 0.5 + 12, 0, 0);
                    icon.getComponent(UITransform)?.setContentSize(22, 22);
                }
                const text = slot.getChildByName("New Label");
                const textUi = text ? text.getComponent(UITransform) : null;
                if (textUi) {
                    text.setPosition(14, 0, 0);
                    textUi.setContentSize(step - 28, 32);
                }
            });
        }
        const dock = hud.getChildByName("BottomNavBar");
        const navigation = hud.getChildByName("BottomNav");
        const more = hud.getChildByName("MorePanel");
        const dockWidth = Math.min(400, width - margin * 2);
        const dockX = width * 0.5 - margin - dockWidth * 0.5;
        if (dock) {
            dock.getComponent(UITransform)?.setContentSize(dockWidth, 80);
            dock.setPosition(dockX, bottom + 40, 0);
        }
        if (navigation) {
            navigation.getComponent(UITransform)?.setContentSize(dockWidth, 80);
            navigation.setPosition(dockX, bottom + 40, 0);
            styleBottomNavigation(navigation, dockWidth);
        }
        const shortcutGap = 16;
        const shortcutY = bottom + 130;
        const moreButton = navigation?.getChildByName('MoreButton');
        const shortcutWidth = moreButton?.getComponent(UITransform)?.width ?? 72;
        // 战报跟随实际底栏入口的中心，避免右边距和列宽分别计算导致错位。
        const shortcutX = navigation && moreButton
            ? navigation.position.x + moreButton.position.x
            : width * 0.5 - margin - dockWidth / 10;
        styleWarReportShortcut(hud.getChildByName('WarReportButton'), shortcutX, shortcutY, shortcutWidth);
        const menuRight = shortcutX - shortcutWidth * 0.5 - shortcutGap;
        if (more) {
            styleMoreMenu(more, Math.min(320, menuRight + width * 0.5 - margin));
            const moreUi = more.getComponent(UITransform);
            const moreWidth = moreUi ? moreUi.width : dockWidth;
            more.setPosition(menuRight - moreWidth * 0.5, shortcutY, 0);
        }
    }

    /** 只在初始化和尺寸变化时重绘，让顶部文字融入地图边缘。 */
    private drawHudTopShade(width: number, height: number): void {
        if (!this._hudTopShade) {
            const shade = new Node('HudTopShade');
            shade.layer = this.node.layer;
            shade.addComponent(UITransform);
            this._hudTopShade = shade.addComponent(Graphics);
            this.node.addChild(shade);
            shade.setSiblingIndex(0);
        }
        const graphics = this._hudTopShade;
        const shadeHeight = 92;
        graphics.node.getComponent(UITransform).setContentSize(width, shadeHeight);
        graphics.node.setPosition(0, height * 0.5 - shadeHeight * 0.5, 0);
        graphics.clear();
        const bands = 32;
        const bandHeight = shadeHeight / bands;
        for (let i = 0; i < bands; i++) {
            graphics.fillColor = new Color(27, 29, 23, Math.round(220 * (1 - i / (bands - 1))));
            graphics.rect(-width * 0.5, shadeHeight * 0.5 - (i + 1) * bandHeight, width, bandHeight);
            graphics.fill();
        }
    }

    protected initMoreMenu(): void {
        let hudRoot = this.node.getChildByName("HudRoot");
        if (hudRoot == null) {
            return;
        }

        this._morePanel = hudRoot.getChildByName("MorePanel");
        this._moreMask = hudRoot.getChildByName("MoreMask");
        this._moreIndicator = hudRoot.getChildByPath("BottomNav/MoreButton/MoreIndicator");

        if (this._moreMask) {
            this._moreMask.on(Node.EventType.TOUCH_END, this.closeMoreMenu, this);
        }
        if (this._morePanel) {
            this._morePanel.children.forEach((child) => {
                if (child.active && child.getComponent(Button)) child.on(Button.EventType.CLICK, this.closeMoreMenu, this);
            });
        }
    }

    private initHudNavigation(): void {
        this.initInnerCityEntry();
        arrangeHudEntries(this.node.getChildByName('HudRoot'), {
            recruit: this.recruitIcon, warReport: this.warReportIcon,
            chat: this.chatMenuIcon, skill: this.skillMenuIcon,
            settings: this.settingsMenuIcon,
        });
    }

    private ensureSettingsPanel(): Setting {
        if (!this._settingNode?.isValid) {
            if (!this.settingPrefab) throw new Error('[MapUI] 设置预制体引用缺失');
            const exit = this.node.getChildByPath('HudRoot/MorePanel/ExitButton');
            if (!exit) throw new Error('[MapUI] 设置页的退出入口缺失');
            const node = instantiate(this.settingPrefab);
            node.active = false;
            const settings = node.getComponent(Setting);
            if (!settings) { node.destroy(); throw new Error('[MapUI] 设置组件缺失'); }
            settings.setExitButton(exit);
            node.parent = this.contentNode;
            this._settingNode = node;
        }
        return this._settingNode.getComponent(Setting);
    }

    public onClickSetting(): void {
        AudioManager.instance.playClick();
        this.closeMoreMenu();
        const settings = this.ensureSettingsPanel();
        this._settingNode.setSiblingIndex(this.topLayer());
        settings.show();
    }

    private initInnerCityEntry(): void {
        const navigation = this.node.getChildByPath('HudRoot/BottomNav');
        if (!navigation || this._innerCityButton) return;
        // 沿用已核对过的市场按钮结构，新入口只替换图标、文案和事件。
        const template = navigation.children.find(node =>
            node.getChildByPath('Background/New Label')?.getComponent(Label)?.string === '市场');
        if (!template || !this.innerCityIcon) {
            console.error('[MapUI] 内城按钮缺少导航模板或图标引用');
            return;
        }
        const entry = instantiate(template);
        entry.name = 'InnerCityButton';
        const button = entry.getComponent(Button);
        const label = entry.getChildByPath('Background/New Label')?.getComponent(Label);
        const icon = entry.getChildByName('Icon')?.getComponent(Sprite);
        if (!button || !label || !icon) { entry.destroy(); return; }
        button.clickEvents = [];
        label.string = '内城';
        icon.spriteFrame = this.innerCityIcon;
        icon.sizeMode = Sprite.SizeMode.CUSTOM;
        navigation.addChild(entry);
        entry.setSiblingIndex(0);
        entry.on(Button.EventType.CLICK, this.openInnerCity, this);
        this._innerCityButton = entry;
    }

    public openInnerCity(): void {
        AudioManager.instance.playClick();
        const city = MapCommand.getInstance().cityProxy.getMyMainCity();
        if (!this._uiListenersReady || !city || city.cityId <= 0) {
            EventMgr.emit(LogicEvent.showToast, '主城信息正在同步，请稍后重试');
            return;
        }
        this.closeMoreMenu();
        this.openFacility(city);
    }

    public toggleMoreMenu(): void {
        AudioManager.instance.playClick();
        this.setMoreMenuVisible(this._morePanel != null && !this._morePanel.active);
    }

    public closeMoreMenu(): void {
        this.setMoreMenuVisible(false);
    }

    protected setMoreMenuVisible(visible: boolean): void {
        if (this._morePanel) {
            this._morePanel.active = visible;
        }
        if (this._moreMask) {
            this._moreMask.active = visible;
        }
        if (this._moreIndicator) {
            this._moreIndicator.active = visible;
        }
    }

    protected onBack(): void {
        AudioManager.instance.playClick();
        LoginCommand.getInstance().account_logout();
    }


    protected clearAllNode(): void {
        this._facilityNode = null;
        this._generalNode = null;
        this._cityAboutNode = null;
        this._armySelectNode = null;
        this._armySettingNode = null;
        this._drawNode = null;
        this._drawResultNode = null;
        this._generalDesNode = null;
        this._dialogNode = null
    }



    public topLayer(): number {
        return this.contentNode.children.length + 1;
    }
    /**
     * 设施
     */
    protected openFacility(data: any): void {
        if (this._facilityNode == null) {
            this._facilityNode = new Node('CityBuildingPanel');
            this._facilityNode.layer = this.node.layer;
            this._facilityNode.parent = this.contentNode;
            this._facilityNode.addComponent(CityBuildingPanel);
        } else {
            this._facilityNode.active = true;
        }
        this._facilityNode.setSiblingIndex(this.topLayer());
        this._facilityNode.getComponent(CityBuildingPanel).show(data.cityId);
    }

    protected openArmySetting(cityId: number, order: number): void {
        if (this._armySettingNode == null) {
            this._armySettingNode = instantiate(this.armySettingPrefab);
            this._armySettingNode.parent = this.contentNode;
        } else {
            this._armySettingNode.active = true;
        }
        this._armySettingNode.setSiblingIndex(this.topLayer());
        this._armySettingNode.getComponent(CityArmySettingLogic).setData(cityId, order);
    }
    /**
     * 武将
     */

    protected onClickGeneral() {
        AudioManager.instance.playClick();
        this.openGeneral([]);
    }

    protected openGeneral(data: number[], type: number = 0, position: number = 0): void {
        if (this._generalNode == null) {
            this._generalNode = instantiate(this.generalPrefab);
            this._generalNode.parent = this.contentNode;
        } else {
            this._generalNode.active = true;
        }
        this._generalNode.setSiblingIndex(this.topLayer());
        this._generalNode.getComponent(GeneralListLogic).setData(data, type, position);
    }


    /**
     * 武将选择
     * @param data 
     * @param zIndex 
     */
    protected openGeneralChoose(data: number[], position: number = 0): void {
        this.openGeneral(data, 1, position);
    }

    /**打开军队选择界面*/
    protected onOpenArmySelectUI(cmd: number | 'move', x: number, y: number): void {
        if (this._armySelectNode == null) {
            this._armySelectNode = instantiate(this.armySelectPrefab);
            this._armySelectNode.parent = this.contentNode;
        } else {
            this._armySelectNode.active = true;
        }
        this._armySelectNode.setSiblingIndex(this.topLayer());
        this._armySelectNode.getComponent(ArmySelectNodeLogic).setData(cmd, x, y);
    }


    /**
     * 武将详情
     */
    protected openGeneralDes(cfgData: any, curData: any): void {
        if (this._generalDesNode == null) {
            this._generalDesNode = instantiate(this.generalDesPrefab);
            this._generalDesNode.parent = this.contentNode;
        } else {
            this._generalDesNode.active = true;
        }
        this._generalDesNode.setSiblingIndex(this.topLayer());
        this._generalDesNode.getComponent(GeneralInfoLogic).setData(cfgData, curData);
    }


    /**
     * 城市
     */
    protected openCityAbout(data: any): void {

        if (this._cityAboutNode == null) {
            this._cityAboutNode = instantiate(this.cityAboutPrefab);
            this._cityAboutNode.parent = this.contentNode;
        } else {
            this._cityAboutNode.active = true;
        }

        this._cityAboutNode.setSiblingIndex(this.topLayer());
        this.widgetNode.active = false;
        EventMgr.emit(LogicEvent.scrollToMap, data.x, data.y);
        this._cityAboutNode.getComponent(CityAboutLogic).setData(data);
    }

    protected closeCityAbout(): void {
        this.widgetNode.active = true;
    }



    /**
     * 战报
     */
    protected openWarReport(): void {
        this.closeMoreMenu();
        AudioManager.instance.playClick();
        if (this._warReportNode == null) {
            this._warReportNode = instantiate(this.warReportPrefab);
            this._warReportNode.parent = this.contentNode;
        } else {
            this._warReportNode.active = true;
        }
        this._warReportNode.setSiblingIndex(this.topLayer());
        this._warReportNode.getComponent(WarReportLogic).updateView();
    }

    /**
     * 角色信息
     */
    protected updateRoleRes(): void {
        if (!this.srollLayout || !this.srollLayout.node) {
            return;
        }
        var children = this.srollLayout.node.children;
        if (!children || children.length == 0) {
            return;
        }
        var roleRes = LoginCommand.getInstance().proxy.getRoleResData();
        var resMap = this.toResMap(roleRes);
        for (let index = 0; index < this._resArray.length; index++) {
            const obj = this._resArray[index];
            this.setResLabel(children, index, obj.name, obj.key, resMap);
        }
    }

    /** 服务器资源是 { resList: [{ k, v }] }，统一成 key -> 数量 */
    private toResMap(roleRes: any): { [key: number]: number } {
        var map: { [key: number]: number } = {};
        if (!roleRes) {
            return map;
        }
        if (Array.isArray(roleRes.resList)) {
            for (const item of roleRes.resList) {
                if (item && item.k !== undefined) {
                    map[Number(item.k)] = Number(item.v) || 0;
                }
            }
        }
        for (let key = 0; key <= 20; key++) {
            if (typeof roleRes[key] === "number") {
                map[key] = roleRes[key];
            }
        }
        return map;
    }

    private setResLabel(children: readonly Node[], index: number, name: string, itemId: number, resMap: { [key: number]: number }): void {
        if (index >= children.length) {
            return;
        }
        var labelNode = children[index].getChildByName("New Label");
        var label = labelNode ? labelNode.getComponent(Label) : null;
        if (!label) {
            return;
        }
        label.string = name + " " + Tools.numberToShow(this.getResCount(itemId, resMap));
    }

    private getResCount(itemId: number, resMap: { [key: number]: number }): number {
        var proxy = LoginCommand.getInstance().proxy;
        if (proxy.hasItemCount(itemId)) {
            return proxy.getItemCount(itemId);
        }
        return resMap[itemId] || 0;
    }



    /**
     * 招募
     */
    protected openDraw(): void {
        AudioManager.instance.playClick();
        if (this._drawNode == null) {
            this._drawNode = instantiate(this.drawPrefab);
            this._drawNode.parent = this.contentNode;
        } else {
            this._drawNode.active = true;
        }
        this._drawNode.setSiblingIndex(this.topLayer());
    }




    /**
     * 抽卡结果
     * @param data 
     */
    protected openDrawR(data: any): void {
        if (this._drawResultNode == null) {
            this._drawResultNode = instantiate(this.drawResultrefab);
            this._drawResultNode.parent = this.contentNode;
        } else {
            this._drawResultNode.active = true;
        }
        this._drawResultNode.setSiblingIndex(this.topLayer());
        this._drawResultNode.getComponent(DrawRLogic).setData(data);
    }



    protected openUnion(): void {
        AudioManager.instance.playClick();
        if (this._unionNode == null) {
            this._unionNode = instantiate(this.unionPrefab);
            this._unionNode.parent = this.contentNode;
        } else {
            this._unionNode.active = true;
        }
        this._unionNode.setSiblingIndex(this.topLayer());
    }


    protected openChat(): void {
        AudioManager.instance.playClick();
        if (this._chatNode == null) {
            this._chatNode = instantiate(this.chatPrefab);
            this._chatNode.parent = this.contentNode;
        } else {
            this._chatNode.active = true;
        }
        this._chatNode.setSiblingIndex(this.topLayer());
    }



    protected openTr(): void {
        AudioManager.instance.playClick();
        if (this._transFormNode == null) {
            this._transFormNode = instantiate(this.transFormPrefab);
            this._transFormNode.parent = this.contentNode;
        } else {
            this._transFormNode.active = true;
        }
        this._transFormNode.setSiblingIndex(this.topLayer());
        this._transFormNode.getComponent(TransformLogic).initView();
    }

    protected onOpenGeneralConvert(): void {
        AudioManager.instance.playClick();
        console.log("onOpenGeneralConvert");
        if (this._generalConvertNode == null) {
            this._generalConvertNode = instantiate(this.generalConvertPrefab);
            this._generalConvertNode.parent = this.contentNode;

        } else {
            this._generalConvertNode.active = true;
        }

        this._generalConvertNode.setSiblingIndex(this.topLayer());

    }

    protected onOpenGeneralRoster(): void {
        AudioManager.instance.playClick();
        console.log("onOpenGeneralRoster");
        if (this._generalRosterNode == null) {
            this._generalRosterNode = instantiate(this.generalRosterPrefab);
            this._generalRosterNode.parent = this.contentNode;
        } else {
            this._generalRosterNode.active = true;
        }
        this._generalRosterNode.setSiblingIndex(this.topLayer());

    }

    onClickSkillBtn(): void {
        AudioManager.instance.playClick();
        this.onOpenSkill(0);
    }

    protected onOpenSkill(type: number = 0, general: GeneralData = null, skillPos: number = -1): void {
        console.log("onOpenSkill", type, general, skillPos);
        if (this._skillNode == null) {
            this._skillNode = instantiate(this.skillPrefab);
            this._skillNode.parent = this.contentNode;
        } else {
            this._skillNode.active = true;
        }
        this._skillNode.setSiblingIndex(this.topLayer());
        this._skillNode.getComponent(SkillLogic).setData(type, general, skillPos);
    }

    protected onCloseSkill() {
        AudioManager.instance.playClick();
        if (this._skillNode) {
            this._skillNode.active = false;
        }
    }

    protected onOpenSkillInfo(cfg: Skill, type: number = 0, general: GeneralData = null, skillPos: number = -1) {
        console.log("onOpenSkillInfo", cfg, type, general, skillPos);
        AudioManager.instance.playClick();
        if (this._skillInfoNode == null) {
            this._skillInfoNode = instantiate(this.skillInfoPrefab);
            this._skillInfoNode.parent = this.contentNode;
        } else {
            this._skillInfoNode.active = true;
        }
        this._skillInfoNode.setSiblingIndex(this.topLayer());
        this._skillInfoNode.getComponent(SkillInfoLogic).setData(cfg, type, general, skillPos);
    }


    //征收
    protected onCollection(msg: any): void {
        this.showTip("成功征收到 " + msg.gold + " 金币", null);
    }

    protected updateRole(): void {
        if (!this.isValid) return;
        var roleData = LoginCommand.getInstance().proxy.getRoleData();
        if (!roleData) return;
        this.nameLabel.string = roleData.name;
        this.ridLabel.string = "ID " + roleData.userId + "";
        const sprite = this._playerAvatar;
        if (!sprite) return;
        const request = ++this._headRequest;
        const icons = LoginCommand.getInstance().headIcons;
        const id = icons.getDisplayId(roleData.headIcon);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.color = Color.WHITE;
        sprite.spriteFrame = icons.getIcon(id);
        if (!sprite.spriteFrame) {
            icons.loadIcon(id).then(frame => {
                if (!this.isValid || !sprite.isValid || request !== this._headRequest) return;
                sprite.spriteFrame = frame;
            });
        }
    }

    private initHeadIconEntry(): void {
        const node = this.node.getChildByPath('PlayerCard/AvatarIcon');
        this._playerAvatar = node?.getComponent(Sprite) || null;
        if (!node || !this._playerAvatar) {
            console.warn('未找到主界面头像入口 PlayerCard/AvatarIcon');
            return;
        }
        const button = node.getComponent(Button) || node.addComponent(Button);
        button.transition = Button.Transition.SCALE;
        button.zoomScale = .96;
        node.on(Button.EventType.CLICK, this.openHeadIcons, this);
    }

    private openHeadIcons(): void {
        if (!this._uiListenersReady) return;
        AudioManager.instance.playClick();
        if (!LoginCommand.getInstance().isHeadIconOpen()) {
            SystemOpenCommand.getInstance().requestSystemOpen();
            EventMgr.emit(LogicEvent.showToast, '更换头像尚未开放');
            return;
        }
        this.closeMoreMenu();
        if (!this.contentNode) return;
        if (!this._headPanel?.isValid) {
            const node = new Node('HeadIconPanel');
            node.layer = this.node.layer;
            this.contentNode.addChild(node);
            this._headPanel = node.addComponent(HeadIconPanel);
        }
        this._headPanel.node.setSiblingIndex(this.topLayer());
        this._headPanel.show();
    }

    protected onClickCollection(): void {
        AudioManager.instance.playClick();

        if (this._collectNode == null) {
            this._collectNode = instantiate(this.collectPrefab);
            this._collectNode.parent = this.contentNode;
        }
        this._collectNode.active = true;
        this._collectNode.setSiblingIndex(this.topLayer());

    }

    protected onEnable(): void {
        this.bindGMInput();
    }

    protected onDisable(): void {
        this.unbindGMInput();
    }

    private bindGMInput(): void {
        if (!this._uiListenersReady || !this.enabledInHierarchy || this._gmInputBound) return;
        this._gmInputBound = true;
        input.on(Input.EventType.KEY_DOWN, this.onGMKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onGMKeyUp, this);
        game.on(Game.EVENT_HIDE, this.resetGMKeys, this);
        // Creator 3.8 的 Web 键盘事件只来自画布，EditBox 聚焦后需接收 DOM 按键。
        // 捕获到快捷键后停止传播，避免同一次按键又经 input 触发一次。
        if (typeof document !== 'undefined') {
            document.addEventListener('keydown', this.onGMBrowserKeyDown, true);
            document.addEventListener('keyup', this.onGMBrowserKeyUp, true);
        }
        if (typeof window !== 'undefined') window.addEventListener('blur', this.resetGMKeys);
    }

    private unbindGMInput(): void {
        this.resetGMKeys();
        if (!this._gmInputBound) return;
        this._gmInputBound = false;
        input.off(Input.EventType.KEY_DOWN, this.onGMKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onGMKeyUp, this);
        game.off(Game.EVENT_HIDE, this.resetGMKeys, this);
        if (typeof document !== 'undefined') {
            document.removeEventListener('keydown', this.onGMBrowserKeyDown, true);
            document.removeEventListener('keyup', this.onGMBrowserKeyUp, true);
        }
        if (typeof window !== 'undefined') window.removeEventListener('blur', this.resetGMKeys);
    }

    private resetGMKeys = (): void => {
        this._gmCtrlKeys.clear();
        this._gmBDown = false;
    };

    private onGMBrowserKeyDown = (event: KeyboardEvent): void => {
        if (!this.enabledInHierarchy || !this._uiListenersReady || event.isComposing) return;
        if (!event.ctrlKey) this._gmCtrlKeys.clear();
        if (event.ctrlKey && (event.code === 'KeyB' || event.key?.toLowerCase() === 'b')) {
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) this.toggleGMPanel();
            this.resetGMKeys();
            return;
        }
        const key = event.key === 'Escape' ? KeyCode.ESCAPE
            : event.key === 'ArrowUp' ? KeyCode.ARROW_UP
            : event.key === 'ArrowDown' ? KeyCode.ARROW_DOWN : KeyCode.NONE;
        if (this.handleGMPanelKey(key)) {
            event.preventDefault();
            event.stopPropagation();
        }
    };

    private onGMBrowserKeyUp = (event: KeyboardEvent): void => {
        // Ctrl 的释放可能发生在输入框上，此时画布收不到 KEY_UP。
        if (!event.ctrlKey) this._gmCtrlKeys.clear();
        if (event.code === 'KeyB' || event.key?.toLowerCase() === 'b') this._gmBDown = false;
    };

    private onGMKeyDown(event: EventKeyboard): void {
        if (!this.enabledInHierarchy || !this._uiListenersReady) return;
        if (event.keyCode === KeyCode.CTRL_LEFT || event.keyCode === KeyCode.CTRL_RIGHT) {
            this._gmCtrlKeys.add(event.keyCode);
            return;
        }
        if (event.keyCode === KeyCode.KEY_B) {
            if (this._gmBDown) return;
            this._gmBDown = true;
            if (this._gmCtrlKeys.size > 0) this.toggleGMPanel();
            return;
        }
        this.handleGMPanelKey(event.keyCode);
    }

    private onGMKeyUp(event: EventKeyboard): void {
        this._gmCtrlKeys.delete(event.keyCode);
        if (event.keyCode === KeyCode.KEY_B) this._gmBDown = false;
    }

    private handleGMPanelKey(key: KeyCode): boolean {
        if (!this.gmPanel?.active) return false;
        if (key === KeyCode.ESCAPE) {
            this.onClickGMClose();
            return true;
        }
        if (this.gmCommandBox?.isFocused() && (key === KeyCode.ARROW_UP || key === KeyCode.ARROW_DOWN)) {
            this.navigateGMHistory(key === KeyCode.ARROW_UP ? 1 : -1);
            return true;
        }
        return false;
    }

    public toggleGMPanel(): void {
        if (!this.gmPanel || !this._uiListenersReady) return;
        if (this.gmPanel.active) {
            this.onClickGMClose();
            return;
        }
        AudioManager.instance.playClick();
        this.gmPanel.active = true;
        this.gmPanel.setSiblingIndex(this.gmPanel.parent.children.length - 1);
        this.refreshGMCoord();
        if (this.gmCommandBox) this.gmCommandBox.string = "";
        this._gmHistoryIndex = -1;
        this._gmHistoryDraft = "";
        this.setGMTip("就绪 · Enter 执行 · ↑↓ 历史 · Esc 关闭");
        this.scheduleOnce(this.focusGMCommand, 0);
    }

    public onClickGMClose(): void {
        AudioManager.instance.playClick();
        this.unschedule(this.focusGMCommand);
        this.gmCommandBox?.blur();
        this.gmEditBoxX?.blur();
        this.gmEditBoxY?.blur();
        if (this.gmPanel) this.gmPanel.active = false;
    }

    private focusGMCommand(): void {
        if (this.gmPanel?.active && this.enabledInHierarchy) this.gmCommandBox?.focus();
    }

    private onMapCenterChange(): void {
        if (this.gmPanel?.active) this.refreshGMCoord();
    }

    private refreshGMCoord(): void {
        const center = MapCommand.getInstance().proxy.getCurCenterPoint();
        if (!center) return;
        if (this.gmCoordLabel) this.gmCoordLabel.string = `当前坐标  ${center.x} , ${center.y}`;
        if (this.gmEditBoxX) this.gmEditBoxX.string = String(center.x);
        if (this.gmEditBoxY) this.gmEditBoxY.string = String(center.y);
    }

    private setGMTip(text: string, append = false): void {
        const value = (text || "").trim();
        if (append && value) {
            if (this._gmMessages[this._gmMessages.length - 1] === value) return;
            this._gmMessages.push(value);
            this._gmMessages = this._gmMessages.slice(-2);
        } else {
            this._gmMessages = value ? [value] : [];
        }
        if (this.gmTipLabel) this.gmTipLabel.string = this._gmMessages.join("\n");
    }

    public onClickGMJump(): void {
        AudioManager.instance.playClick();
        if (!this.gmEditBoxX || !this.gmEditBoxY) return;
        this.jumpToCell(this.parseGMCoord(this.gmEditBoxX.string), this.parseGMCoord(this.gmEditBoxY.string));
    }

    private onGMCoordReturn(): void {
        this.onClickGMJump();
        this.scheduleOnce(this.focusGMCommand, 0);
    }

    public onClickGMExecute(): void {
        if (!this.gmCommandBox || !this.gmPanel?.active || !this._uiListenersReady) return;
        AudioManager.instance.playClick();
        this.executeGMCommand(this.gmCommandBox.string);
        this.scheduleOnce(this.focusGMCommand, 0);
    }

    private navigateGMHistory(direction: number): void {
        if (!this.gmCommandBox || this._gmHistory.length === 0) return;
        if (this._gmHistoryIndex < 0) {
            if (direction < 0) return;
            this._gmHistoryDraft = this.gmCommandBox.string;
        }
        this._gmHistoryIndex = Math.max(-1, Math.min(this._gmHistory.length - 1, this._gmHistoryIndex + direction));
        this.gmCommandBox.string = this._gmHistoryIndex < 0
            ? this._gmHistoryDraft : this._gmHistory[this._gmHistoryIndex];
    }

    private parseGMCoord(value: string): number {
        return value?.trim() ? Number(value) : NaN;
    }

    private executeGMCommand(command: string): void {
        const text = (command || "").trim();
        if (!text) {
            this.setGMTip("请输入命令", true);
            return;
        }
        if (this._gmHistory[0] !== text) {
            this._gmHistory.unshift(text);
            this._gmHistory = this._gmHistory.slice(0, 20);
        }
        this._gmHistoryIndex = -1;
        this._gmHistoryDraft = "";
        const args = text.split(/\s+/);
        const cmd = args[0].toLowerCase();
        if (cmd === "goto" || cmd === "jump" || cmd === "tp") {
            if (args.length !== 3) {
                this.setGMTip("用法：goto x y", true);
                return;
            }
            this.jumpToCell(this.parseGMCoord(args[1]), this.parseGMCoord(args[2]));
        } else if (cmd === "pos" || cmd === "where" || cmd === "coord") {
            this.refreshGMCoord();
            const center = MapCommand.getInstance().proxy.getCurCenterPoint();
            this.setGMTip(center ? `当前坐标 ${center.x} , ${center.y}` : "坐标不可用", true);
        } else if (cmd === "help" || cmd === "?") {
            this.setGMTip("本地命令：goto x y · pos · clear · help；其它指令会发送到服务器", true);
        } else if (cmd === "clear") {
            if (this.gmCommandBox) this.gmCommandBox.string = "";
            this.setGMTip("");
        } else if (args.length === 2 && args.every(value => !isNaN(this.parseGMCoord(value)))) {
            this.jumpToCell(this.parseGMCoord(args[0]), this.parseGMCoord(args[1]));
        } else {
            const name = ServerConfig.c2s_gm_command;
            const bytes = ProtoManager.getInstance().encode(name, { cmd: text });
            if (!bytes) {
                this.setGMTip("指令编码失败，请检查 Protobuf 配置", true);
                return;
            }
            NetManager.getInstance().send({ name, msg: bytes });
            this.setGMTip("已发送：" + text + "  ·  等待服务器返回", true);
        }
    }

    private jumpToCell(x: number, y: number): void {
        const size = MapUtil.mapSize;
        if (!size || !Number.isInteger(x) || !Number.isInteger(y)
            || x < 0 || y < 0 || x >= size.width || y >= size.height) {
            this.setGMTip(size ? `坐标无效，X 范围 0-${size.width - 1}，Y 范围 0-${size.height - 1}` : "地图尚未就绪", true);
            return;
        }
        EventMgr.emit(LogicEvent.scrollToMap, x, y);
        if (this.gmEditBoxX) this.gmEditBoxX.string = String(x);
        if (this.gmEditBoxY) this.gmEditBoxY.string = String(y);
        this.setGMTip(`已跳转到 (${x}, ${y})`, true);
    }

    private onGMCommandHelp(data: any): void {
        const list = data?.ret;
        if (!Array.isArray(list) || list.length === 0) {
            this.setGMTip("服务器未返回 GM 帮助", true);
            return;
        }
        this.setGMTip("GM 帮助：" + list.slice(0, 8).map(item => item.k + "=" + item.v).join("  "), true);
    }

    protected onTellMe(data: any): void {
        const raw = data && (data.msg != null ? data.msg : (data.message != null ? data.message : (data.content != null ? data.content : data.text)));
        const msg = raw == null ? "" : String(raw).trim();
        if (msg.length === 0) {
            return;
        }
        if (this.gmPanel?.active) {
            this.setGMTip(msg, true);
        } else {
            EventMgr.emit(LogicEvent.showToast, msg);
        }
    }


    protected beforeScrollToMap(x: number, y: number, oldx: number, oldy: number): void {
        let newPoint = new Vec2(x, y);
        let oldPoint = new Vec2(oldx, oldy);
        let dis = Vec2.squaredDistance(newPoint, oldPoint);
        console.log("beforeScrollToMap:", x, y, oldx, oldy, dis);

        if (dis < 360000) {
            return;
        }

        if (this._cloudAniNode == null) {
            this._cloudAniNode = instantiate(this.cloudAniPrefab);
            this._cloudAniNode.parent = this.contentNode;
        }
        this._cloudAniNode.active = true;
        this._cloudAniNode.setSiblingIndex(this.topLayer());

    }



}
