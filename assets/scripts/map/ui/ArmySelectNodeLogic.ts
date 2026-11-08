import { _decorator, BlockInputEvents, Button, Component, Node, Prefab, instantiate, Label, Mask, ScrollView, UITransform, UIOpacity, Vec2, sys, view } from 'cc';
const { ccclass, property } = _decorator;

import { ArmyCmd } from "../../general/ArmyProxy";
import MapCommand from "../MapCommand";
import ArmySelectItemLogic, { TroopOrderAction } from "./ArmySelectItemLogic";
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { LogicEvent } from '../../common/LogicEvent';
import TroopCommand from '../../general/TroopCommand';
import MapUtil from '../MapUtil';
import WorldCommand, { MarchTargetType } from '../../world/WorldCommand';
import CityCommand from '../../world/CityCommand';
import WorldCampaign from '../WorldCampaign';
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
    private resourceTarget: { x: number; y: number; action: TroopOrderAction } | null = null;
    private panel: Node = null;
    private scroll: ScrollView = null;
    private viewport: Node = null;
    private status: Label = null;
    private targetLabel: Label = null;
    private statusTitle: Label = null;
    private stateArt: Node = null;
    private primaryButton: Node = null;
    private secondaryButton: Node = null;
    private state: 'list' | 'empty' | 'loading' | 'error' | 'invalid' = 'loading';
    private primaryAction: 'dispatch' | 'formation' | 'retry' | 'routeRetry' | 'choose' | 'none' = 'none';
    private selectedTroopIdx = 0;
    private targetRevision = 0;
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
            LogicEvent.updateMarches, LogicEvent.updateMyGenerals, LogicEvent.protocolRequestChanged,
            LogicEvent.updateCity, LogicEvent.updateCitys, LogicEvent.updateAllianceCities, LogicEvent.updateMyRole]) {
            EventMgr.on(event, this.queueRefresh, this);
        }
        EventMgr.on(LogicEvent.updateWorldEntities, this.onTargetEntitiesChanged, this);
        EventMgr.on(LogicEvent.updateMarchRoute, this.onRouteChanged, this);
        view.on('canvas-resize', this.onResize, this);
        this.schedule(this.refreshMovingRoute, 3);
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
        WorldCommand.getInstance().clearMarchRoute();
        this.scroll?.stopAutoScroll();
        for (const entry of this.hiddenSidebar) if (entry.node.isValid) entry.node.active = entry.active;
        this.hiddenSidebar = [];
    }

    protected onDestroy(): void {
        WorldCommand.getInstance().clearMarchRoute();
        EventMgr.targetOff(this);
        view.off('canvas-resize', this.onResize, this);
    }

    protected onClickBack(): void {
        AudioManager.instance.playClick();
        this.close();
    }

    private close(): void {
        this.targetRevision++;
        this.resourceTarget = null;
        this.node.active = false;
    }

    public setData(cmd: number | 'move' | 'attackCity' | 'redeploy', x: number, y: number): void {
        this.targetRevision++;
        const map = MapCommand.getInstance();
        const id = MapUtil.getIdByCellPoint(x, y), cell = map.proxy.getResData(id);
        // 所有地图指令都使用新版 World 部队，攻城使用服务端城池实体。
        const occupiable = !!cell && (cell.isEmpty || isResourceLandCell(cell)) && !map.cityProxy.getCity(id);
        this.resourceTarget = cmd === 'move' ? { x, y, action: 'move' }
            : cmd === 'attackCity' ? { x, y, action: 'attackCity' }
            : cmd === 'redeploy' ? { x, y, action: 'redeploy' }
            : cmd === ArmyCmd.Attack && occupiable ? { x, y, action: 'occupy' } : null;
        const cities = CityCommand.getInstance();
        if ((cmd === 'attackCity' || cmd === 'redeploy') && !cities.loaded && !cities.loading) cities.requestList();
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
            this.showStatus('请选择空地或资源地', 'invalid');
            return;
        }
        const { x, y, action } = this.resourceTarget, map = MapCommand.getInstance(), command = TroopCommand.getInstance();
        const id = MapUtil.getIdByCellPoint(x, y), cell = map.proxy.getResData(id);
        const empty = !!cell?.isEmpty;
        const world = WorldCommand.getInstance();
        const blocked = (!empty && !isResourceLandCell(cell)) || !!map.cityProxy.getCity(id);
        const issue = action === 'move' ? map.moveTargetIssue(x, y)
            : action === 'attackCity' ? world.cityAttackIssue(x, y)
            : action === 'redeploy' ? world.cityRedeployIssue(x, y)
            : blocked ? '目标已变更，请重新选择空地或资源地'
            : map.campaignBlockReason(x, y) || (empty ? world.emptyLandIssue(x, y) : world.resourceLandIssue(x, y, cell.type, cell.level));
        const resourceName = { 52: '林地', 53: '铁矿', 54: '石料', 55: '粮田' }[cell?.type] || '资源地';
        if (this.targetLabel) this.targetLabel.string = action === 'move' ? `${WorldCampaign.landmark(x, y) || '目的地'}  ·  ${x}, ${y}`
            : (action === 'attackCity' || action === 'redeploy') ? `${WorldCampaign.landmark(x, y) || '城池'}  ·  ${x}, ${y}`
            : `${empty ? '空地' : `${cell?.level || ''}级${resourceName}`}  ·  ${x}, ${y}`;
        if ((action === 'attackCity' || action === 'redeploy') && !CityCommand.getInstance().at(x, y)) {
            const cities = CityCommand.getInstance();
            this.showStatus(cities.loading ? '正在同步城池…' : '城池同步失败', cities.loading ? 'loading' : 'error');
            return;
        }
        if (issue) { this.showStatus(issue, 'invalid'); return; }
        if (!command.listReady) {
            this.showStatus(command.listLoading ? '正在同步部队…' : '部队同步失败', command.listLoading ? 'loading' : 'error');
            return;
        }
        const troops = command.proxy.getTroops();
        if (!troops.length) { this.showStatus('编入武将，分配兵力', 'empty'); return; }
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
            logic.onSelected = troopIdx => { this.selectedTroopIdx = troopIdx; this.updateSelection(); };
            logic.layoutRow(this.rowWidth, ROW_HEIGHT);
            item.setPosition(0, -ROW_HEIGHT / 2 - index * (ROW_HEIGHT + ROW_GAP), 0);
        }
        for (const child of [...this.armyContainer.children]) if (!used.has(child)) { child.removeFromParent(); child.destroy(); }
        if (!troops.some(troop => troop.troopIdx === this.selectedTroopIdx)) {
            this.selectedTroopIdx = troops.find(troop =>
                !this.armyContainer.getChildByName(`Troop${troop.troopIdx}`)?.getComponent(ArmySelectItemLogic)?.selectionIssue)?.troopIdx
                || troops[0].troopIdx;
        }
        this.sizeContent(troops.length, offset);
        this.updateSelection();
    }

    private showStatus(text: string, state: 'empty' | 'loading' | 'error' | 'invalid' = 'error'): void {
        this.state = text ? state : 'list';
        if (this.status) { this.status.string = text; this.status.node.active = !!text; }
        if (this.statusTitle) {
            this.statusTitle.node.active = state === 'empty' && !!text;
            this.statusTitle.string = '尚未编队';
        }
        if (this.stateArt) this.stateArt.active = state === 'empty' && !!text;
        if (text) {
            WorldCommand.getInstance().clearMarchRoute();
            this.clearItems(); this.itemCount = 0; this.selectedTroopIdx = 0;
            this.layoutPanel(); this.sizeContent(0, 0);
        }
    }

    private updateSelection(): void {
        for (const item of this.armyContainer.children) {
            const logic = item.getComponent(ArmySelectItemLogic);
            if (logic) logic.setSelected(item.name === `Troop${this.selectedTroopIdx}`);
        }
        this.updateRoute();
        this.onRouteChanged();
    }

    private updateRoute(force = false): void {
        const world = WorldCommand.getInstance(), target = this.resourceTarget;
        if (this.state !== 'list' || !target || !this.selectedItem() || this.selectedItem().selectionIssue) {
            world.clearMarchRoute(); return;
        }
        const targetType = target.action === 'move' ? MarchTargetType.Move
            : target.action === 'attackCity' ? MarchTargetType.AttackCity
            : target.action === 'redeploy' ? MarchTargetType.Redeploy : MarchTargetType.OccupyResource;
        world.previewMarchRoute(this.selectedTroopIdx, targetType, { x: target.x, y: target.y }, force);
    }

    private onRouteChanged(): void {
        if (!this.node.activeInHierarchy) return;
        this.selectedItem()?.setRoutePreview(WorldCommand.getInstance().marchRoute);
        this.layoutActions();
    }

    private refreshMovingRoute(): void {
        if (!this.node.activeInHierarchy) return;
        const world = WorldCommand.getInstance();
        if (world.marchRoute?.status === 'ready' && world.marches.get(this.selectedTroopIdx)?.state === 1) {
            this.updateRoute(true);
        }
    }

    private selectedItem(): ArmySelectItemLogic | null {
        return this.armyContainer?.getChildByName(`Troop${this.selectedTroopIdx}`)?.getComponent(ArmySelectItemLogic) || null;
    }

    private onPrimary(): void {
        if (this.primaryAction === 'routeRetry') { AudioManager.instance.playClick(); this.updateRoute(true); return; }
        if (this.primaryAction === 'formation') { this.openFormation(); return; }
        if (this.primaryAction === 'choose') { this.onClickBack(); return; }
        if (this.primaryAction === 'retry') {
            AudioManager.instance.playClick();
            if (this.resourceTarget?.action === 'attackCity' || this.resourceTarget?.action === 'redeploy') CityCommand.getInstance().requestList();
            TroopCommand.getInstance().requestTroops(true);
            this.refreshTroops();
            return;
        }
        if (this.primaryAction === 'dispatch' && WorldCommand.getInstance().marchRoute?.status === 'ready') {
            this.selectedItem()?.dispatchOrder();
        }
    }

    private onSecondary(): void {
        if (this.state === 'list' && WorldCommand.getInstance().isTroopAtHome(this.selectedTroopIdx)) this.openFormation();
        else this.onClickBack();
    }

    private openFormation(): void {
        const city = MapCommand.getInstance().cityProxy.getMyMainCity();
        if (!city?.cityId || !this.resourceTarget) return;
        const revision = this.targetRevision;
        const index = this.selectedTroopIdx || 1;
        AudioManager.instance.playClick();
        this.node.active = false;
        EventMgr.emit(LogicEvent.openArmySetting, city.cityId, index, () => {
            // 只响应本次编队返回；关闭选队、换目标或场景销毁后不能重新弹出旧目标。
            if (!this.isValid || !this.node.isValid || revision !== this.targetRevision || !this.resourceTarget) return;
            this.node.active = true;
            TroopCommand.getInstance().requestTroops();
            this.refreshTroops(true);
        });
    }

    private layoutActions(): void {
        if (!this.primaryButton || !this.panel) return;
        const { width, height } = this.panel.getComponent(UITransform);
        const command = TroopCommand.getInstance();
        const cityReady = !!MapCommand.getInstance().cityProxy.getMyMainCity()?.cityId;
        const troop = command.proxy.getTroop(this.selectedTroopIdx);
        const leader = troop?.getHeroIdxAt(0);
        const atHome = WorldCommand.getInstance().isTroopAtHome(this.selectedTroopIdx);
        this.primaryAction = 'none';
        let text = '正在同步…';
        if (this.state === 'empty') {
            text = cityReady ? '前往编队' : '主城同步中…';
            if (cityReady && !command.editingTroopIdx) this.primaryAction = 'formation';
        } else if (this.state === 'error') {
            text = '重试同步'; this.primaryAction = 'retry';
        } else if (this.state === 'invalid') {
            text = '重选目标'; this.primaryAction = 'choose';
        } else if (this.state === 'list') {
            const issue = this.selectedItem()?.selectionIssue;
            if ((!leader || troop.getSoldier(leader).count <= 0) && atHome) {
                text = leader ? '补充兵力' : '前往编队';
                if (cityReady && command.listReady && !command.editingTroopIdx) this.primaryAction = 'formation';
            } else {
                text = this.resourceTarget?.action === 'redeploy' ? '确认调动'
                    : this.resourceTarget?.action === 'move' ? '确认移动'
                    : this.resourceTarget?.action === 'attackCity' ? '确认攻城' : '确认出征';
                if (troop && !issue) {
                    const route = WorldCommand.getInstance().marchRoute;
                    if (route?.status === 'ready') this.primaryAction = 'dispatch';
                    else if (route?.status === 'error') { text = '重试路线'; this.primaryAction = 'routeRetry'; }
                    else text = route?.status === 'unreachable' ? '无法到达' : '寻路中…';
                }
            }
        }
        const y = -height / 2 + 34, secondaryWidth = 88, gap = 10;
        panelButton(this.secondaryButton, this.state === 'list' && atHome ? '编队' : '返回地图',
            -width / 2 + 16 + secondaryWidth / 2, y, secondaryWidth, 44);
        const primaryWidth = width - 32 - secondaryWidth - gap;
        panelButton(this.primaryButton, text, width / 2 - 16 - primaryWidth / 2, y, primaryWidth, 44, true);
        this.primaryButton.getComponent(Button).interactable = this.primaryAction !== 'none';
        this.primaryButton.getComponent(UIOpacity).opacity = this.primaryAction === 'none' ? 140 : 255;
        const secondaryReady = this.state !== 'list' || !atHome || (cityReady && !command.editingTroopIdx);
        this.secondaryButton.getComponent(Button).interactable = secondaryReady;
        this.secondaryButton.getComponent(UIOpacity).opacity = secondaryReady ? 255 : 140;
    }

    private sizeContent(count: number, offset: number): void {
        if (!this.scroll) return;
        this.scroll.stopAutoScroll();
        const height = Math.max(this.viewHeight, count * (ROW_HEIGHT + ROW_GAP) - ROW_GAP);
        this.armyContainer.getComponent(UITransform).setContentSize(this.viewWidth, height);
        this.armyContainer.setPosition(0, this.viewHeight / 2, 0);
        this.scroll.scrollToOffset(new Vec2(0, Math.max(0, Math.min(offset, height - this.viewHeight))), 0);

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
        this.statusTitle = caption(this.panel, 'StateTitle', '', 0, 0, 280, 18, C.text, Label.HorizontalAlign.CENTER);
        const art = inkSurface(this.panel, 'EmptyFormation', 80, 58, null, null);
        this.stateArt = art.node;
        art.lineWidth = 1.5; art.strokeColor = C.line;
        art.roundRect(-34, -22, 22, 30, 2); art.roundRect(12, -22, 22, 30, 2); art.stroke();
        art.strokeColor = C.gold; art.roundRect(-13, -6, 26, 36, 2);
        art.moveTo(-6, 12); art.lineTo(6, 12); art.moveTo(0, 6); art.lineTo(0, 18); art.stroke();
        for (const [name, handler] of [['PrimaryAction', this.onPrimary], ['SecondaryAction', this.onSecondary]] as const) {
            const button = new Node(name); button.layer = this.node.layer; this.panel.addChild(button);
            button.addComponent(UITransform); button.addComponent(Button); button.addComponent(UIOpacity);
            button.on(Button.EventType.CLICK, handler, this);
            if (name === 'PrimaryAction') this.primaryButton = button; else this.secondaryButton = button;
        }
        this.statusTitle.node.active = this.stateArt.active = false;
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
        const width = Math.min(328, Math.max(280, safe.width * .3), safe.width - 24);
        const top = Math.min(96, safe.height * .16), bottom = 20;
        const rows = Math.max(1, Math.min(3, this.itemCount));
        const contentHeight = this.state === 'list' ? 156 + rows * ROW_HEIGHT + (rows - 1) * ROW_GAP : this.state === 'empty' ? 300 : 248;
        const height = Math.min(contentHeight, safe.height - top - bottom);
        place(this.panel, safe.x + safe.width - size.width / 2 - width / 2 - 12,
            safe.y + safe.height - size.height / 2 - top - height / 2, width, height);
        inkSurface(this.panel, 'Surface', width, height, C.ink, C.line);
        const title = this.panel.getChildByName('Label')?.getComponent(Label);
        textStyle(title, -18, height / 2 - 25, width - 64, 18, C.text);
        if (title) title.string = this.resourceTarget?.action === 'redeploy' ? '调动部队'
            : this.resourceTarget?.action === 'move' ? '移动部队'
            : this.resourceTarget?.action === 'attackCity' ? '攻城部队' : '出征部队';
        panelButton(this.panel.getChildByName('btnClose'), '', width / 2 - 30, height / 2 - 27, 40, 40, false, true);
        textStyle(this.targetLabel, 0, height / 2 - 50, width - 28, 13, C.gold, Label.HorizontalAlign.LEFT, 22);
        headerRule(this.panel, width - 24, height / 2 - 66);
        this.viewWidth = this.rowWidth = width - 24; this.viewHeight = Math.max(32, height - 156);
        place(this.scroll.node, 0, -6, this.viewWidth, this.viewHeight);
        this.scroll.node.active = this.state === 'list';
        place(this.viewport, 0, 0, this.viewWidth, this.viewHeight);
        const compact = this.viewHeight < 120;
        if (this.stateArt) {
            this.stateArt.active = this.state === 'empty' && !compact;
            this.stateArt.setPosition(0, 30, 0);
        }
        textStyle(this.statusTitle, 0, compact ? 6 : -16, width - 40, 18, C.text, Label.HorizontalAlign.CENTER, 28);
        textStyle(this.status, 0, this.state === 'empty' ? (compact ? -24 : -48) : -6,
            width - 48, 14, C.muted, Label.HorizontalAlign.CENTER, this.state === 'empty' ? 24 : this.viewHeight);
        this.status.enableWrapText = true; this.status.lineHeight = 22;
        this.layoutActions();
    }
}
