import { _decorator, BlockInputEvents, Camera, Color, Component, Node, Label, ProgressBar, Button, Sprite, Vec2, tween, UIOpacity, UITransform, view } from 'cc';
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
import WorldCommand from '../world/WorldCommand';
import { resourceLandForCell } from '../world/ResourceLand';
import LoginCommand from '../login/LoginCommand';
import { caption, hideSprite, inkSurface, ManagementColors, panelButton, place, textStyle } from './ui/ManagementStyle';

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
    protected _t = null;
    private _panel: Node = null;
    private _panelHeight = 200;
    private _camera: Camera = null;
    private _panelWidth = 340;
    private _iconTop = 100;
    private _iconHalfWidth = 100;
    private _campaignText = '';

    protected onLoad(): void {
        this._panel = new Node('TileInformation'); this._panel.layer = this.node.layer;
        this.node.addChild(this._panel); this._panel.addComponent(UITransform);
        this._panel.addComponent(BlockInputEvents);
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
    }

    private buttons(): Button[] {
        return [this.btnEnter, this.btnOccupy, this.btnMove, this.btnGiveUp, this.btnReclaim,
            this.btnBuild, this.btnTransfer, this.btnTagAdd, this.btnTagRemove].filter(Boolean);
    }

    protected onDestroy(): void {
        this._data = null;
        this._pixelPos = null;
    }

    protected onEnable(): void {
        EventMgr.on(LogicEvent.updateBuild, this.onUpdateBuild, this);
        EventMgr.on(LogicEvent.updateWorldEntities, this.onWorldEntities, this);

        var uiOpacity = this.bgSelect.getComponent(UIOpacity) || this.bgSelect.addComponent(UIOpacity);
        uiOpacity.opacity = 255;

        let t = tween(uiOpacity).to(0.9, { opacity: 150 }).to(0.9, { opacity: 255 });
        t = t.repeatForever(t);
        t.start();

        this._t = t;

    }

    protected onDisable(): void {
        EventMgr.targetOff(this);
        this._t?.stop();
        this.stopCountDown();
    }

    protected onUpdateBuild(data: MapBuildData): void {
        if (this._data
            && this._data instanceof MapBuildData
            && this._data.x == data.x
            && this._data.y == data.y) {
            this.setCellData(data, this._pixelPos);
        }
    }
    private onWorldEntities(): void {
        if (this._data && this._pixelPos && this._data.type >= 52 && this._data.type <= 55) this.setCellData(this._data, this._pixelPos);
    }

    protected onClickEnter(): void {
        AudioManager.instance.playClick();
        if (this._data instanceof MapCityData) {
            EventMgr.emit(LogicEvent.openCityAbout, this._data);
        }
        this.node.parent = null;
    }


    protected onTagAdd(): void {
        AudioManager.instance.playClick();
        MapCommand.getInstance().opPosTag(1, this._data.x, this._data.y, this.labelName.string);
        this.node.parent = null;
    }

    protected onTagRemove(): void {
        AudioManager.instance.playClick();
        MapCommand.getInstance().opPosTag(0, this._data.x, this._data.y);
        this.node.parent = null;
    }

    protected onClickOccupy(): void {
        AudioManager.instance.playClick();
        if (!this._data) return;
        const reason = MapCommand.getInstance().campaignBlockReason(this._data.x, this._data.y);
        if (reason) { EventMgr.emit(LogicEvent.showTip, reason, null); return; }
        if (this._data.type >= 52 && this._data.type <= 55) {
            const issue = WorldCommand.getInstance().resourceLandIssue(this._data.x, this._data.y, this._data.type, this._data.level);
            if (issue) { EventMgr.emit(LogicEvent.showToast, issue); return; }
            EventMgr.emit(LogicEvent.openArmySelectUi, ArmyCmd.Attack, this._data.x, this._data.y);
        } else if (MapCommand.getInstance().isCanOccupyCell(this._data.x, this._data.y)) {
            EventMgr.emit(LogicEvent.openArmySelectUi, ArmyCmd.Attack, this._data.x, this._data.y);
        } else {
            EventMgr.emit(LogicEvent.showToast, '只能占领自己相邻的地');
        }

        this.node.parent = null;
    }

    public setCellData(data: any, pixelPos: Vec2): void {
        this.stopCountDown();
        this._data = data;
        this._pixelPos = pixelPos;
        this._panelWidth = Math.min(340, Math.max(240, view.getVisibleSize().width - 32));
        this.labelPos.string = "(" + data.x + ", " + data.y + ")";
        this.leftInfoNode.active = true;
        this.btnMove.node.active = false;
        this.btnGiveUp.node.active = false;
        this.btnReclaim.node.active = false;
        this.btnBuild.node.active = false;
        this.btnTransfer.node.active = false;
        this.btnEnter.node.active = false;
        this.btnOccupy.node.active = false;
        this.bgSelect.getComponent(UITransform).width = 200;
        this.bgSelect.getComponent(UITransform).height = 100;

        var isTag = MapCommand.getInstance().proxy.isPosTag(this._data.x, this._data.y);
        this.btnTagAdd.node.active = !isTag;
        this.btnTagRemove.node.active = isTag;

        if (this._data instanceof MapResData) {
            this.btnOccupy.node.active = true;
            this.durableNode.active = false;
        } else if (this._data instanceof MapBuildData) {
            const build = this._data as MapBuildData;
            const mine = build.rid == MapCommand.getInstance().buildProxy.myId;
            const ally = build.unionId > 0 && build.unionId == MapCommand.getInstance().buildProxy.myUnionId;
            const captive = build.parentId > 0 && build.parentId == MapCommand.getInstance().buildProxy.myUnionId;
            this.btnOccupy.node.active = !mine && !ally && !captive;
            this.durableNode.active = true;
            this.labelDurable.string = Math.ceil(this._data.curDurable / 100) + "/" + Math.ceil(this._data.maxDurable / 100);
            this.progressBarDurable.progress = this._data.curDurable / this._data.maxDurable;
        } else if (this._data instanceof MapCityData) {
            const city = this._data as MapCityData;
            if (city.rid == MapCommand.getInstance().cityProxy.myId) {
                this.btnEnter.node.active = true;
                this.btnTagAdd.node.active = false;
                this.btnTagRemove.node.active = false;
            } else {
                const ally = city.unionId > 0 && city.unionId == MapCommand.getInstance().cityProxy.myUnionId;
                const captive = city.parentId > 0 && city.parentId == MapCommand.getInstance().cityProxy.myUnionId;
                this.btnOccupy.node.active = !ally && !captive;
            }
            this.bgSelect.getComponent(UITransform).setContentSize(WorldMapArt.playerCityWidth * 1.2, WorldMapArt.playerCityWidth * .6);
            this.leftInfoNode.active = false;
            this.durableNode.active = true;
            this.labelDurable.string = Math.ceil(this._data.curDurable / 100) + "/" + Math.ceil(this._data.maxDurable / 100);
            this.progressBarDurable.progress = this._data.curDurable / this._data.maxDurable;

        }



        if (this._data.type == MapResType.SYS_CITY) {
            const width = WorldMapArt.cityWidth(this._data.level) * 1.2;
            this.bgSelect.getComponent(UITransform).setContentSize(width, width * .5);
        }

        const city = this._data instanceof MapCityData;
        const art = city ? 'capital' : this._data.type === MapResType.SYS_CITY
            ? WorldMapArt.cityArt(this._data.level)
            : ({ 50: 'fort', 52: 'forest', 53: 'iron', 54: 'quarry', 55: 'grain' }[this._data.type] || 'fort');
        const frame = WorldMapArt.frame(art);
        const iconWidth = city ? WorldMapArt.playerCityWidth : this._data.type === MapResType.SYS_CITY
            ? WorldMapArt.cityWidth(this._data.level) : this._data.type === MapResType.SYS_FORTRESS ? 138 : 80 + this._data.level * 5;
        this._iconTop = iconWidth * frame.originalSize.height / frame.originalSize.width * .8 + 12;
        this._iconHalfWidth = iconWidth / 2 + 12;


        if (this.leftInfoNode.active) {

            let resData: MapResData = MapCommand.getInstance().proxy.getResData(this._data.id) || this._data;
            let resCfg: MapResConfig = MapCommand.getInstance().proxy.getResConfig(resData.type, resData.level);

            let soldiers = MapUICommand.getInstance().proxy.getDefenseSoldiers(resData.level);
            this.labelYield.string = MapCommand.getInstance().proxy.getResYieldDesList(resCfg).join("\n") || '暂无产量信息';
            this.labelSoldierCnt.string = soldiers > 0 ? "守备兵力  " + soldiers * 3 : '暂无守军情报';
            const land = resourceLandForCell(resData.type, resData.level);
            if (land) {
                this.labelYield.string = `资源储量  ${land.Capacity}\n采集速度  ${land.GatherSpeed}`;
                this.labelSoldierCnt.string = '击败守军后占领';
            }

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

        const entity = WorldCommand.getInstance().resourceLandAt(data.x, data.y);
        if (entity && data.type >= 52 && data.type <= 55) {
            const mine = String(entity.ownerId) === String(LoginCommand.getInstance().proxy.getRoleData()?.userId);
            this.labelUnion.string = mine ? '我方领地' : String(entity.ownerId || 0) !== '0' ? '已被占领' : '未占领';
            this.btnOccupy.node.active = !mine;
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
            this.labelSoldierCnt.string = '可通行 · 可作为连地目标';
        } else if (data instanceof MapResData && data.type >= 52 && data.type <= 55) {
            this.labelName.string = `${data.level}级${{ 52: '林地', 53: '铁矿', 54: '石料', 55: '粮田' }[data.type]}`;
        }
        this.layoutPanel();
    }

    private layoutPanel(): void {
        if (!this._panel) return;
        const yieldLines = this.leftInfoNode.active ? this.labelYield.string.split('\n').length : 0;
        const buttons = this.buttons().filter(button => button.node.active);
        const rowCount = Math.ceil(buttons.length / 3);
        const campaignHeight = this._campaignText ? this._campaignText.split('\n').length * 22 + 8 : 0;
        this._panelHeight = 104 + campaignHeight + (yieldLines ? yieldLines * 24 + 28 : 0)
            + (this.durableNode.active ? 28 : 0) + (this.bgMain.active ? 24 : 0) + rowCount * 46;
        const height = this._panelHeight;
        const width = this._panelWidth, contentWidth = width - 36;
        place(this._panel, 0, 0, width, height);
        inkSurface(this._panel, 'Surface', width, height, new Color(38, 40, 31, 248), ManagementColors.gold);
        const left = Label.HorizontalAlign.LEFT, right = Label.HorizontalAlign.RIGHT;
        textStyle(this.labelName, -48, height / 2 - 28, contentWidth - 96, 20);
        textStyle(this.labelPos, width / 2 - 66, height / 2 - 28, 96, 13, ManagementColors.muted, right);
        textStyle(this.labelUnion, -30, height / 2 - 58, contentWidth - 60, 14, ManagementColors.muted, left, 24);
        textStyle(this.labelLunxian, contentWidth / 2 - 28, height / 2 - 58, 56, 14, new Color(205, 135, 107, 255), right, 24);
        let y = height / 2 - 80;
        if (campaignHeight) {
            const label = caption(this._panel, 'CampaignDetail', this._campaignText, 0,
                y - (campaignHeight - 8) / 2, contentWidth, 13, ManagementColors.gold);
            textStyle(label, 0, y - (campaignHeight - 8) / 2, contentWidth, 13, ManagementColors.gold, left, campaignHeight - 8);
            label.enableWrapText = true; label.lineHeight = 22; y -= campaignHeight;
        }
        this.labelYield.node.active = this.labelSoldierCnt.node.active = this.leftInfoNode.active;
        if (yieldLines) {
            textStyle(this.labelYield, 0, y - yieldLines * 12, contentWidth, 15, ManagementColors.text, left, yieldLines * 24);
            this.labelYield.lineHeight = 24; this.labelYield.enableWrapText = true;
            y -= yieldLines * 24 + 20;
            textStyle(this.labelSoldierCnt, 0, y, contentWidth, 14, ManagementColors.muted, left, 24); y -= 18;
        }
        this.labelDurable.node.active = this.durableNode.active;
        if (this.durableNode.active) {
            if (!this.labelDurable.string.startsWith('耐久')) this.labelDurable.string = '耐久  ' + this.labelDurable.string;
            textStyle(this.labelDurable, 0, y - 12, contentWidth, 14, ManagementColors.muted, left, 24); y -= 28;
        }
        this.labelMian.node.active = this.bgMain.active;
        if (this.bgMain.active) { textStyle(this.labelMian, 0, y - 12, contentWidth, 14, ManagementColors.gold, left, 24); y -= 24; }
        for (let i = 0; i < buttons.length; i++) {
            const columns = Math.min(3, buttons.length - Math.floor(i / 3) * 3);
            const width = (contentWidth - (columns - 1) * 8) / columns;
            const label = buttons[i].getComponentInChildren(Label);
            const texts = new Map<Button, string>([[this.btnEnter, '进入'], [this.btnOccupy, WorldCampaign.gateAt(this._data.x, this._data.y) ? '攻打关隘' : '占领'],
                [this.btnMove, '驻守'], [this.btnGiveUp, '放弃'], [this.btnReclaim, '屯田'], [this.btnBuild, '建造'],
                [this.btnTransfer, '调动'], [this.btnTagAdd, '标记'], [this.btnTagRemove, '取消标记']]);
            const text = texts.get(buttons[i]) || label?.string || '进入';
            panelButton(buttons[i].node, text, -contentWidth / 2 + width / 2 + (i % 3) * (width + 8),
                -height / 2 + 30 + (rowCount - 1 - Math.floor(i / 3)) * 46, width, 36, buttons[i] === this.btnOccupy || buttons[i] === this.btnEnter);
        }
        hideSprite(this.bgSelect);
        const ui = this.bgSelect.getComponent(UITransform);
        const g = inkSurface(this.bgSelect, 'SelectionOutline', ui.width, ui.height, null, null);
        g.lineWidth = 4; g.strokeColor = new Color(239, 209, 126, 255); g.fillColor = new Color(204, 180, 104, 45);
        g.moveTo(0, ui.height / 2); g.lineTo(ui.width / 2, 0); g.lineTo(0, -ui.height / 2);
        g.lineTo(-ui.width / 2, 0); g.close(); g.fill(); g.stroke();
        // 内外双线在地表形成清晰选中标记，不缩放或裁切建筑本身。
        g.lineWidth = 1.5; g.strokeColor = new Color(255, 241, 185, 210);
        g.moveTo(0, ui.height * .43); g.lineTo(ui.width * .43, 0); g.lineTo(0, -ui.height * .43);
        g.lineTo(-ui.width * .43, 0); g.close(); g.stroke();
        this.lateUpdate();
    }

    protected lateUpdate(): void {
        if (!this._panel || !this._data) return;
        if (!this._camera) for (let p = this.node.parent; p; p = p.parent) {
            this._camera = p.getChildByName('Map Camera')?.getComponent(Camera);
            if (this._camera) break;
        }
        if (!this._camera) return;
        const size = view.getVisibleSize(), camera = this._camera.node.position;
        const scale = this._camera.orthoHeight * 2 / Math.max(1, size.height);
        const anchor = this._pixelPos;
        const sx = (anchor.x - camera.x) / scale, sy = (anchor.y - camera.y) / scale;
        const margin = 18, halfWidth = size.width / 2, halfHeight = size.height / 2;
        const fit = Math.min(1, (size.height - margin * 2) / this._panelHeight, (size.width - margin * 2) / this._panelWidth);
        const hw = this._panelWidth * fit / 2, hh = this._panelHeight * fit / 2;
        const above = sy + this._iconTop / scale + 16 + hh;
        const rightX = sx + this._iconHalfWidth / scale + 16 + hw;
        const leftX = sx - this._iconHalfWidth / scale - 16 - hw;
        let px = sx, py = above;
        if (above + hh > halfHeight - margin) {
            if (rightX + hw <= halfWidth - margin) { px = rightX; py = sy; }
            else if (leftX - hw >= -halfWidth + margin) { px = leftX; py = sy; }
            else py = sy - this.bgSelect.getComponent(UITransform).height / scale / 2 - 20 - hh;
        }
        px = Math.max(-halfWidth + hw + margin, Math.min(halfWidth - hw - margin, px));
        py = Math.max(-halfHeight + hh + margin, Math.min(halfHeight - hh - margin, py));
        this._panel.setScale(scale * fit, scale * fit, 1);
        this._panel.setPosition((px - sx) * scale, (py - sy) * scale, 0);
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
