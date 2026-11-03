import { _decorator, BlockInputEvents, Component, Node, Prefab, instantiate, Label, Mask, ScrollView, UITransform, Vec2, sys, view } from 'cc';
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
import Modal from '../../utils/Modal';
import RightInfoNodeLogic from './RightInfoNodeLogic';
import { caption, headerRule, hideSprite, inkSurface, ManagementColors as C, manualLayout, panelButton, place, textStyle } from './ManagementStyle';

const ROW_HEIGHT = 96;
const ROW_GAP = 8;

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
    private hint: Label = null;
    private hiddenSidebar: { node: Node; active: boolean }[] = [];
    private itemCount = 3;
    private rowWidth = 560;
    private viewWidth = 560;
    private viewHeight = 340;
    private refreshQueued = false;
    private targetEntityKey = '';
    
    protected onLoad(): void {
        this.buildPanel();
        EventMgr.on(LogicEvent.closeArmyAelectUi, this.close, this);
        for (const event of [LogicEvent.updateTroopList, LogicEvent.troopListState, LogicEvent.troopEditState,
            LogicEvent.updateMarches, LogicEvent.updateMyGenerals, LogicEvent.protocolRequestChanged]) {
            EventMgr.on(event, this.queueRefresh, this);
        }
        EventMgr.on(LogicEvent.updateWorldEntities, this.onTargetEntitiesChanged, this);
        view.on('canvas-resize', this.onResize, this);
    }

    protected onEnable(): void {
        // 选队临时接替侧栏，保留原来的分页和展开状态，避免两层面板相互遮挡。
        let parent = this.node.parent;
        while (parent) {
            const sidebar = parent.getComponentInChildren(RightInfoNodeLogic);
            if (sidebar) {
                const nodes = [sidebar.node, sidebar.node.parent?.getChildByName('RightInfoTab')];
                this.hiddenSidebar = nodes.filter((node): node is Node => !!node).map(node => ({ node, active: node.active }));
                for (const entry of this.hiddenSidebar) entry.node.active = false;
                break;
            }
            parent = parent.parent;
        }
        this.layoutPanel();
    }

    protected onDisable(): void {
        this.scroll?.stopAutoScroll();
        for (const entry of this.hiddenSidebar) if (entry.node.isValid) entry.node.active = entry.active;
        this.hiddenSidebar = [];
    }

    protected onDestroy(): void {
        EventMgr.targetOff(this);
        view.off('canvas-resize', this.onResize, this);
    }

    protected onClickBack(): void {
        AudioManager.instance.playClick();
        this.close();
    }

    private close(): void {
        this.node.active = false;
    }

    public setData(cmd: number | 'move', x: number, y: number): void {
        const map = MapCommand.getInstance();
        const id = MapUtil.getIdByCellPoint(x, y), cell = map.proxy.getResData(id);
        // 移动按坐标，资源占领按实体；两种操作都只使用新版 World 部队。
        const occupiable = !!cell && (cell.isEmpty || isResourceLandCell(cell)) && !map.cityProxy.getCity(id);
        this.resourceTarget = cmd === 'move' ? { x, y, action: 'move' }
            : cmd === ArmyCmd.Attack && occupiable ? { x, y, action: 'occupy' } : null;
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
    private resourceEntityKey(): string {
        if (this.resourceTarget?.action !== 'occupy') return '';
        const { x, y } = this.resourceTarget;
        const world = WorldCommand.getInstance();
        const entity = world.resourceLandAt(x, y);
        return `${world.resourceLandEntityId(x, y)}:${entity ? entity.ownerId : 0}`;
    }
    private onTargetEntitiesChanged(): void {
        // 其他部队位置推送不能反复重建卡片，否则正在滑动/点击的队伍会被销毁。
        if (this.resourceEntityKey() !== this.targetEntityKey) this.queueRefresh();
    }
    private refreshTroops(resetScroll = false): void {
        if (!this.node.activeInHierarchy) return;
        this.targetEntityKey = this.resourceEntityKey();
        const offset = resetScroll ? 0 : this.scroll?.getScrollOffset().y || 0;
        if (!this.resourceTarget) {
            if (this.targetLabel) this.targetLabel.string = '';
            this.showStatus('当前目标暂不支持出征\n请返回地图选择资源地');
            return;
        }
        const { x, y, action } = this.resourceTarget, map = MapCommand.getInstance(), command = TroopCommand.getInstance();
        const id = MapUtil.getIdByCellPoint(x, y), cell = map.proxy.getResData(id);
        const empty = !!cell?.isEmpty;
        const world = WorldCommand.getInstance();
        const blocked = (!empty && !isResourceLandCell(cell)) || !!map.cityProxy.getCity(id);
        const issue = action === 'move' ? map.moveTargetIssue(x, y)
            : blocked ? '目标已变更，请重新选择空地或资源地'
            : map.campaignBlockReason(x, y) || (empty ? world.emptyLandIssue(x, y) : world.resourceLandIssue(x, y, cell.type, cell.level));
        if (this.targetLabel) this.targetLabel.string = action === 'move' ? `移动至 (${x}, ${y})`
            : `占领 · ${empty ? '空地' : `${cell?.level || ''}级资源地`} (${x}, ${y})`;
        if (issue) { this.showStatus(issue); return; }
        if (!command.listReady) {
            this.showStatus(command.listLoading ? '正在同步部队…' : '部队数据尚未同步\n请稍后重新打开选择队伍');
            return;
        }
        const troops = command.proxy.getTroops();
        if (!troops.length) { this.showStatus('暂无已编成的部队\n请先进入主城编队并配置兵力'); return; }
        this.showStatus('');
        this.itemCount = troops.length;
        this.layoutPanel();
        const used = new Set<Node>();
        for (let index = 0; index < troops.length; index++) {
            const troop = troops[index], name = `Troop${troop.troopIdx}`;
            let item = this.armyContainer.getChildByName(name);
            if (!item) {
                item = instantiate(this.itemPrefab); item.name = name;
                item.parent = this.armyContainer;
            }
            used.add(item);
            const logic = item.getComponent(ArmySelectItemLogic);
            logic.setTroopData(troop, x, y, action);
            logic.layoutRow(this.rowWidth, ROW_HEIGHT);
            item.setPosition(0, -ROW_HEIGHT / 2 - index * (ROW_HEIGHT + ROW_GAP), 0);
        }
        for (const child of [...this.armyContainer.children]) if (!used.has(child)) { child.removeFromParent(); child.destroy(); }
        this.sizeContent(troops.length, offset);
    }

    private showStatus(text: string): void {
        if (this.status) { this.status.string = text; this.status.node.active = !!text; }
        if (text) {
            this.clearItems(); this.itemCount = 0; this.layoutPanel(); this.sizeContent(0, 0);
        }
    }

    private sizeContent(count: number, offset: number): void {
        if (!this.scroll) return;
        this.scroll.stopAutoScroll();
        const height = Math.max(this.viewHeight, count * (ROW_HEIGHT + ROW_GAP) - ROW_GAP);
        this.armyContainer.getComponent(UITransform).setContentSize(this.viewWidth, height);
        this.armyContainer.setPosition(0, this.viewHeight / 2, 0);
        this.scroll.scrollToOffset(new Vec2(0, Math.max(0, Math.min(offset, height - this.viewHeight))), 0);
        if (this.hint) this.hint.string = height > this.viewHeight + 1 ? '上下滑动选择部队' : '点选地图可重新选择目标';
    }

    private buildPanel(): void {
        this.panel = this.node.getChildByName('bottomNode');
        if (!this.panel || !this.armyContainer) return;
        // 仅侧栏内拦截输入，地图、任务和底部入口保持可操作。
        const modal = this.node.getComponent(Modal); if (modal) modal.enabled = false;
        const blocker = this.node.getComponent(BlockInputEvents); if (blocker) blocker.enabled = false;
        const mask = this.node.getChildByName('mask'); if (mask) mask.active = false;
        if (!this.panel.getComponent(BlockInputEvents)) this.panel.addComponent(BlockInputEvents);
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
        this.scroll.elastic = false; this.scroll.inertia = true;
        this.viewport = new Node('Viewport'); this.viewport.layer = this.node.layer;
        scrollNode.addChild(this.viewport); this.viewport.addComponent(UITransform);
        this.viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        this.armyContainer.parent = this.viewport;
        this.armyContainer.getComponent(UITransform).setAnchorPoint(.5, 1);
        this.scroll.content = this.armyContainer;
        this.status = caption(this.panel, 'Status', '', 0, -28, 400, 17, C.muted, Label.HorizontalAlign.CENTER);
        this.targetLabel = caption(this.panel, 'Target', '', 0, 0, 400, 15, C.muted);
        this.hint = caption(this.panel, 'Hint', '', 0, 0, 280, 12, C.muted, Label.HorizontalAlign.CENTER);
        for (const label of this.panel.getComponentsInChildren(Label)) {
            label.font = null; label.useSystemFont = true; label.fontFamily = 'Microsoft YaHei';
        }
        this.layoutPanel();
    }

    private onResize(): void { if (this.node.activeInHierarchy) { this.layoutPanel(); this.refreshTroops(); } }

    private layoutPanel(): void {
        if (!this.panel) return;
        const size = view.getVisibleSize();
        place(this.node, 0, 0, size.width, size.height);
        // 当前 UI 根没有 SafeArea，直接使用 Creator 返回的设计坐标安全矩形一次。
        const safe = sys.getSafeAreaRect();
        const width = Math.min(320, Math.max(280, safe.width * .3), safe.width - 24);
        const top = Math.min(96, safe.height * .2), bottom = Math.min(92, safe.height * .18);
        const rows = Math.max(1, Math.min(3, this.itemCount));
        const height = Math.min(100 + rows * ROW_HEIGHT + (rows - 1) * ROW_GAP, safe.height - top - bottom);
        place(this.panel, safe.x + safe.width - size.width / 2 - width / 2 - 12,
            safe.y + safe.height - size.height / 2 - top - height / 2, width, height);
        inkSurface(this.panel, 'Surface', width, height, C.ink, C.line);
        const title = this.panel.getChildByName('Label')?.getComponent(Label);
        textStyle(title, -18, height / 2 - 25, width - 64, 18, C.text);
        if (title) title.string = '选择部队';
        panelButton(this.panel.getChildByName('btnClose'), '', width / 2 - 26, height / 2 - 25, 36, 36, false, true);
        textStyle(this.targetLabel, 0, height / 2 - 50, width - 28, 13, C.gold, Label.HorizontalAlign.LEFT, 22);
        headerRule(this.panel, width - 24, height / 2 - 66);
        this.viewWidth = this.rowWidth = width - 24; this.viewHeight = height - 100;
        place(this.scroll.node, 0, -26, this.viewWidth, this.viewHeight);
        place(this.viewport, 0, 0, this.viewWidth, this.viewHeight);
        textStyle(this.status, 0, -26, width - 48, 14, C.muted, Label.HorizontalAlign.CENTER, this.viewHeight);
        this.status.enableWrapText = true; this.status.lineHeight = 24;
        textStyle(this.hint, 0, -height / 2 + 12, width - 24, 12, C.muted, Label.HorizontalAlign.CENTER, 18);
    }
}
