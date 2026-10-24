import { _decorator, Component, Node, Prefab, instantiate, Label, Mask, ScrollView, UITransform, Vec2, view } from 'cc';
const { ccclass, property } = _decorator;

import { ArmyCmd } from "../../general/ArmyProxy";
import MapCommand from "../MapCommand";
import ArmySelectItemLogic from "./ArmySelectItemLogic";
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { LogicEvent } from '../../common/LogicEvent';
import TroopCommand from '../../general/TroopCommand';
import MapUtil from '../MapUtil';
import WorldCommand from '../../world/WorldCommand';
import { isResourceLandCell } from '../../world/ResourceLand';
import { caption, hideSprite, inkSurface, ManagementColors as C, manualLayout, modalBackdrop, panelButton, place, textStyle } from './ManagementStyle';

const ROW_HEIGHT = 140;
const ROW_GAP = 10;

@ccclass('ArmySelectNodeLogic')
export default class ArmySelectNodeLogic extends Component {
    @property(Node)
    armyContainer: Node = null;
    @property(Prefab)
    itemPrefab: Prefab = null;
    private resourceTarget: { x: number; y: number; action: 'occupy' | 'move' } | null = null;
    private panel: Node = null;
    private scroll: ScrollView = null;
    private viewport: Node = null;
    private status: Label = null;
    private targetLabel: Label = null;
    private rowWidth = 560;
    private viewHeight = 340;
    private refreshQueued = false;
    
    protected onLoad(): void {
        this.buildPanel();
        EventMgr.on(LogicEvent.closeArmyAelectUi, this.onClickBack, this);
        for (const event of [LogicEvent.updateTroopList, LogicEvent.troopListState, LogicEvent.troopEditState,
            LogicEvent.updateMarches, LogicEvent.updateWorldEntities, LogicEvent.updateMyGenerals]) {
            EventMgr.on(event, this.queueRefresh, this);
        }
        view.on('canvas-resize', this.onResize, this);
    }

    protected onDestroy(): void {
        EventMgr.targetOff(this);
        view.off('canvas-resize', this.onResize, this);
    }

    protected onClickBack(): void {
        AudioManager.instance.playClick();
        this.node.active = false;
    }

    public setData(cmd: number | 'move', x: number, y: number): void {
        const map = MapCommand.getInstance();
        const id = MapUtil.getIdByCellPoint(x, y), cell = map.proxy.getResData(id);
        // 移动按坐标，资源占领按实体；两种操作都只使用新版 World 部队。
        this.resourceTarget = cmd === 'move' ? { x, y, action: 'move' }
            : cmd === ArmyCmd.Attack && isResourceLandCell(cell) && !map.cityProxy.getCity(id) ? { x, y, action: 'occupy' } : null;
        this.layoutPanel();
        if (this.resourceTarget) TroopCommand.getInstance().requestTroops();
        this.refreshTroops(true);
    }
    private clearItems(): void {
        if (!this.armyContainer) return;
        for (const child of [...this.armyContainer.children]) child.destroy();
        this.armyContainer.removeAllChildren();
    }
    private queueRefresh(): void {
        if (!this.node.activeInHierarchy || this.refreshQueued) return;
        this.refreshQueued = true;
        this.scheduleOnce(() => { this.refreshQueued = false; this.refreshTroops(); }, 0);
    }
    private refreshTroops(resetScroll = false): void {
        if (!this.node.activeInHierarchy) return;
        const offset = resetScroll ? 0 : this.scroll?.getScrollOffset().y || 0;
        this.clearItems();
        if (!this.resourceTarget) {
            if (this.targetLabel) this.targetLabel.string = '';
            this.showStatus('当前目标暂不支持出征\n请返回地图选择资源地');
            return;
        }
        const { x, y, action } = this.resourceTarget, map = MapCommand.getInstance(), command = TroopCommand.getInstance();
        const id = MapUtil.getIdByCellPoint(x, y), cell = map.proxy.getResData(id);
        const issue = action === 'move' ? map.moveTargetIssue(x, y)
            : !isResourceLandCell(cell) || map.cityProxy.getCity(id) ? '目标已变更，请重新选择资源地'
            : map.campaignBlockReason(x, y) || WorldCommand.getInstance().resourceLandIssue(x, y, cell.type, cell.level);
        if (this.targetLabel) this.targetLabel.string = action === 'move' ? `移动至 (${x}, ${y}) · 点击部队移动`
            : `${cell?.level || ''}级资源地  (${x}, ${y}) · 点击部队出征`;
        if (issue) { this.showStatus(issue); return; }
        if (!command.listReady) {
            this.showStatus(command.listLoading ? '正在同步部队…' : '部队数据尚未同步\n请稍后重新打开选择队伍');
            return;
        }
        const troops = command.proxy.getTroops();
        if (!troops.length) { this.showStatus('暂无已编成的部队\n请先进入主城编队并配置兵力'); return; }
        this.showStatus('');
        for (const troop of troops) {
            const item = instantiate(this.itemPrefab);
            item.parent = this.armyContainer;
            const logic = item.getComponent(ArmySelectItemLogic);
            logic.setTroopData(troop, x, y, action);
            logic.layoutRow(this.rowWidth, ROW_HEIGHT);
            item.setPosition(0, -ROW_HEIGHT / 2 - (this.armyContainer.children.length - 1) * (ROW_HEIGHT + ROW_GAP), 0);
        }
        this.sizeContent(troops.length, offset);
    }

    private showStatus(text: string): void {
        if (this.status) { this.status.string = text; this.status.node.active = !!text; }
        if (text) this.sizeContent(0, 0);
    }

    private sizeContent(count: number, offset: number): void {
        if (!this.scroll) return;
        this.scroll.stopAutoScroll();
        const height = Math.max(this.viewHeight, count * (ROW_HEIGHT + ROW_GAP) - ROW_GAP);
        this.armyContainer.getComponent(UITransform).setContentSize(this.rowWidth, height);
        this.armyContainer.setPosition(0, this.viewHeight / 2, 0);
        this.scroll.scrollToOffset(new Vec2(0, Math.max(0, Math.min(offset, height - this.viewHeight))), 0);
    }

    private buildPanel(): void {
        this.panel = this.node.getChildByName('bottomNode');
        if (!this.panel || !this.armyContainer) return;
        for (const name of ['btnBack', 'leftNode']) {
            const old = this.node.getChildByName(name); if (old) old.active = false;
        }
        const close = this.node.getChildByName('btnClose');
        if (close) close.parent = this.panel;
        hideSprite(this.panel); manualLayout(this.armyContainer);
        const scrollNode = new Node('TroopScroll'); scrollNode.layer = this.node.layer;
        this.panel.addChild(scrollNode); scrollNode.addComponent(UITransform);
        this.scroll = scrollNode.addComponent(ScrollView);
        this.scroll.horizontal = false; this.scroll.vertical = true; this.scroll.cancelInnerEvents = true;
        this.viewport = new Node('Viewport'); this.viewport.layer = this.node.layer;
        scrollNode.addChild(this.viewport); this.viewport.addComponent(UITransform);
        this.viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        this.armyContainer.parent = this.viewport;
        this.armyContainer.getComponent(UITransform).setAnchorPoint(.5, 1);
        this.scroll.content = this.armyContainer;
        this.status = caption(this.panel, 'Status', '', 0, -28, 400, 17, C.muted, Label.HorizontalAlign.CENTER);
        this.targetLabel = caption(this.panel, 'Target', '', 0, 0, 400, 15, C.muted);
        for (const label of this.panel.getComponentsInChildren(Label)) {
            label.font = null; label.useSystemFont = true; label.fontFamily = 'Microsoft YaHei';
        }
        this.layoutPanel();
    }

    private onResize(): void { if (this.node.activeInHierarchy) { this.layoutPanel(); this.refreshTroops(); } }

    private layoutPanel(): void {
        if (!this.panel) return;
        const size = modalBackdrop(this.node, this.node.getChildByName('mask'));
        const width = Math.min(660, size.width - 24), height = Math.min(580, size.height - 24);
        place(this.panel, 0, 0, width, height);
        inkSurface(this.panel, 'Surface', width, height, C.ink, C.gold);
        const title = this.panel.getChildByName('Label')?.getComponent(Label);
        textStyle(title, 0, height / 2 - 34, width - 140, 24, C.text, Label.HorizontalAlign.CENTER);
        if (title) title.string = '选择队伍';
        panelButton(this.panel.getChildByName('btnClose'), '', width / 2 - 32, height / 2 - 32, 40, 40, false, true);
        textStyle(this.targetLabel, 0, height / 2 - 76, width - 40, 15, C.muted);
        this.rowWidth = width - 32; this.viewHeight = Math.max(60, height - 112);
        place(this.scroll.node, 0, -44, this.rowWidth, this.viewHeight);
        place(this.viewport, 0, 0, this.rowWidth, this.viewHeight);
        textStyle(this.status, 0, -34, width - 48, 17, C.muted, Label.HorizontalAlign.CENTER, 110);
        this.status.enableWrapText = true; this.status.lineHeight = 28;
    }
}
