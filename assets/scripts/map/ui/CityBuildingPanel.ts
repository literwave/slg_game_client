import { _decorator, BlockInputEvents, Button, Canvas, Color, Component, Graphics, Label, Mask, Node, SafeArea,
    ScrollView, Sprite, SpriteFrame, UITransform, Vec2, Widget, resources, view } from 'cc';
import BuildCommand from '../../build/BuildCommand';
import { buildingArt, buildingGoalPresentation, buildingNextUnlocks } from './BuildingPresentation';
import { BuildingGraphEdge, BuildingGraphNode, buildingGoalKey, buildingGraphFocus,
    buildingProgressionGraph, layoutBuildingGraph } from './BuildingProgressionGraph';
import LoginCommand from '../../login/LoginCommand';
import { itemIconPath } from '../../common/ItemPresentation';
import { LogicEvent } from '../../common/LogicEvent';
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import MapUICommand from './MapUICommand';
import { FacilityConfig } from './MapUIProxy';
import { caption, inkSurface, ManagementColors as C, panelButton, place } from './ManagementStyle';

const { ccclass } = _decorator;
const GREEN = new Color(159, 190, 141), RED = new Color(227, 148, 121);
const TABS = ['全部建筑', '军事', '资源', '城务'];
interface BuildingCard { data: BuildingGraphNode; cfg: FacilityConfig; node: Node; art: Sprite; title: Label; level: Label; state: Label; }
interface ConditionView { node: Node; title: Label; progress: Label; type: number; level: number; }

/** 城建面板只展示服务器快照；查询、升级都由 BuildCommand 管理。 */
@ccclass('CityBuildingPanel')
export default class CityBuildingPanel extends Component {
    private safe: Node;
    private panel: Node;
    private header: Label;
    private summary: Label;
    private status: Label;
    private tabs: Node[] = [];
    private closeButton: Node;
    private backButton: Node;
    private routeTitle: Label;
    private routeHint: Label;
    private routeLine: Graphics;
    private layerLabels: Label[] = [];
    private focusButton: Node;
    private graphNodes: BuildingGraphNode[] = [];
    private graphEdges: BuildingGraphEdge[] = [];
    private graphMetrics = layoutBuildingGraph([], 600);
    private graphSignature = '';
    private layoutQueued = false;
    private grid: ScrollView;
    private content: Node;
    private detail: Node;
    private detailScroll: ScrollView;
    private detailContent: Node;
    private action: Node;
    private actionHint: Label;
    private detailTitle: Label;
    private detailLevel: Label;
    private detailArt: Sprite;
    private description: Label;
    private conditionTitle: Label;
    private conditions: Label;
    private conditionRows: ConditionView[] = [];
    private unlockTitle: Label;
    private unlocks: Label;
    private costTitle: Label;
    private costs: Array<{ node: Node; icon: Sprite; label: Label }> = [];
    private cards: BuildingCard[] = [];
    private selected = 1;
    private selectedLevel = 1;
    private category = 0;
    private cityId = 0;
    private width = 1100;
    private height = 664;
    private cardWidth = 190;
    private detailWidth = 340;
    private layingOut = false;
    private detailOnly = false;
    private syncRetries = 0;
    private retryScheduled = false;
    private frames = new Map<string, SpriteFrame>();
    private loadingFrames = new Map<string, Promise<SpriteFrame>>();
    private imageKeys = new WeakMap<Sprite, string>();

    show(cityId: number): void {
        this.cityId = cityId;
        if (!this.panel) this.build();
        this.category = 0;
        this.selected = 1;
        this.selectedLevel = this.nextLevel(1);
        this.detailOnly = false;
        this.syncRetries = 0;
        this.unschedule(this.retrySync);
        this.retryScheduled = false;
        this.node.active = true;
        this.safe.getComponent(SafeArea).updateArea();
        this.layout();
        this.focusSelected();
        MapUICommand.getInstance().qryCityFacilities(cityId, true);
        this.refresh();
    }

    private build(): void {
        this.node.addComponent(UITransform);
        this.stretch(this.node);
        for (let parent = this.node.parent; parent; parent = parent.parent) {
            if (parent.getComponent(Canvas)) { this.node.getComponent(Widget).target = parent; break; }
        }
        this.node.addComponent(BlockInputEvents);
        this.safe = this.makeNode('SafeContent', this.node);
        this.stretch(this.safe);
        this.safe.addComponent(SafeArea);
        this.panel = this.makeNode('CityBuildingWindow', this.safe);
        this.header = caption(this.panel, 'Title', '内城营造', 0, 0, 250, 30);
        this.summary = caption(this.panel, 'Overview', '', 0, 0, 600, 17, C.muted);
        this.status = caption(this.panel, 'SyncStatus', '', 0, 0, 250, 14, C.muted, Label.HorizontalAlign.RIGHT);
        this.closeButton = this.button(this.panel, 'Close', () => { this.node.active = false; });
        this.backButton = this.button(this.panel, 'BackToRoute', () => { this.detailOnly = false; this.layout(); this.focusSelected(); });
        TABS.forEach((text, index) => {
            this.tabs.push(this.button(this.panel, `Category_${index}`, () => {
                this.category = index;
                this.detailOnly = false;
                const configs = MapUICommand.getInstance().proxy.getFacilityConfigs();
                if (!configs.some(cfg => cfg.type === this.selected && this.visible(cfg))) this.selected = configs.find(cfg => this.visible(cfg))?.type || 1;
                this.selectedLevel = this.nextLevel(this.selected);
                this.layout(); this.focusSelected(); this.detailScroll.scrollToTop(0);
            }));
        });
        this.grid = this.makeScroll('BuildingGraph', this.panel);
        this.content = this.grid.content;
        this.routeLine = this.makeNode('ProgressionLine', this.content).addComponent(Graphics);
        this.routeTitle = caption(this.panel, 'RouteTitle', '建筑依赖图', 0, 0, 280, 19, C.gold);
        this.routeHint = caption(this.panel, 'RouteHint', '实线 已满足 · 虚线 未满足 · 金线 选中路径', 0, 0, 600, 13, C.muted);
        this.focusButton = this.button(this.panel, 'FocusBuilding', () => this.focusSelected());
        this.detail = this.makeNode('BuildingDetail', this.panel);
        this.detailScroll = this.makeScroll('DetailScroll', this.detail);
        this.detailContent = this.detailScroll.content;
        this.detailTitle = caption(this.detailContent, 'BuildingName', '', 0, 0, 260, 25);
        this.detailLevel = caption(this.detailContent, 'BuildingLevel', '', 0, 0, 260, 15, C.gold);
        this.detailArt = this.makeSprite('BuildingArt', this.detailContent);
        this.description = caption(this.detailContent, 'Description', '', 0, 0, 280, 16, C.muted);
        this.description.enableWrapText = true;
        this.conditionTitle = caption(this.detailContent, 'ConditionTitle', '建造条件', 0, 0, 280, 16, C.gold);
        this.conditions = caption(this.detailContent, 'Conditions', '', 0, 0, 280, 15);
        this.conditions.enableWrapText = true;
        this.unlockTitle = caption(this.detailContent, 'UnlockTitle', '后续建设', 0, 0, 280, 15, C.gold);
        this.unlocks = caption(this.detailContent, 'Unlocks', '', 0, 0, 280, 13, C.muted);
        this.unlocks.enableWrapText = true;
        this.costTitle = caption(this.detailContent, 'CostTitle', '所需资源', 0, 0, 280, 16, C.gold);
        for (let i = 0; i < 4; i++) {
            const node = this.makeNode(`Cost_${i}`, this.detailContent);
            this.costs.push({ node, icon: this.makeSprite('Icon', node), label: caption(node, 'Amount', '', 0, 0, 230, 15) });
        }
        this.action = this.button(this.detail, 'BuildAction', this.onAction);
        this.actionHint = caption(this.detail, 'ActionHint', '', 0, 0, 280, 13, C.muted, Label.HorizontalAlign.CENTER);
        this.node.on(Node.EventType.SIZE_CHANGED, this.queueLayout, this);
        this.safe.on(Node.EventType.SIZE_CHANGED, this.queueLayout, this);
        view.on('canvas-resize', this.queueLayout, this);
        view.on('design-resolution-changed', this.queueLayout, this);
        for (const event of [LogicEvent.updateCityBuilds, LogicEvent.protocolRequestChanged, LogicEvent.upateMyRoleRes]) {
            EventMgr.on(event, this.refresh, this);
        }
    }

    private visible(cfg: FacilityConfig): boolean {
        return this.category === 0 || (this.category === 1 ? cfg.category === 2 : this.category === 2 ? cfg.category === 3 : cfg.category !== 2 && cfg.category !== 3);
    }

    private nextLevel(type: number): number {
        const cfg = MapUICommand.getInstance().proxy.getFacilityConfigs().find(cfg => cfg.type === type);
        const current = BuildCommand.getInstance().levels.get(type) || 0;
        return cfg?.upLevels[current] ? current + 1 : Math.max(1, current);
    }

    private selectBuilding(type: number, target = this.nextLevel(type)): void {
        const cfg = MapUICommand.getInstance().proxy.getFacilityConfigs().find(cfg => cfg.type === type);
        if (!cfg) return;
        if (!this.visible(cfg)) this.category = 0;
        this.selected = type;
        this.selectedLevel = Math.max(target, BuildCommand.getInstance().levels.get(type) || 0);
        this.detailOnly = true;
        this.layout(); this.focusSelected(); this.detailScroll.scrollToTop(0);
    }

    private focusSelected(): void {
        const key = buildingGoalKey(this.selected, this.selectedLevel);
        const card = this.cards.find(card => card.data.key === key);
        if (!card) return;
        const viewport = this.grid.node.getComponent(UITransform).height;
        const height = this.content.getComponent(UITransform).height;
        this.grid.scrollToOffset(new Vec2(0, Math.max(0, Math.min(height - viewport, -card.node.position.y - viewport * .45))), .15);
    }

    private queueLayout(): void {
        if (!this.node.activeInHierarchy || this.layoutQueued) return;
        this.layoutQueued = true;
        this.scheduleOnce(() => {
            this.layoutQueued = false;
            if (this.isValid && this.node.activeInHierarchy) this.layout();
        }, 0);
    }

    private layout(): void {
        if (!this.panel || this.layingOut) return;
        this.layingOut = true;
        this.node.getComponent(Widget).updateAlignment();
        this.safe.getComponent(Widget).updateAlignment();
        this.safe.getComponent(SafeArea).updateArea();
        const oldOffset = this.grid.getScrollOffset().y;
        const root = this.node.getComponent(UITransform), safe = this.safe.getComponent(UITransform);
        this.width = Math.min(1140, Math.max(280, safe.width - 32));
        this.height = Math.min(710, Math.max(360, safe.height - 32));
        inkSurface(this.node, 'Scrim', root.width, root.height, new Color(0, 0, 0, 175), null);
        place(this.panel, 0, 0, this.width, this.height);
        const scale = Math.min(1, (safe.width - 16) / this.width, (safe.height - 16) / this.height);
        this.panel.setScale(scale, scale, 1);
        inkSurface(this.panel, 'WindowSurface', this.width, this.height, C.ink, C.gold);
        const w = this.width, h = this.height;
        const titleWidth = Math.min(272, w - 96), summaryWidth = Math.min(480, w - 48);
        place(this.header.node, -w / 2 + 24 + titleWidth / 2, h / 2 - 39, titleWidth, 44);
        this.header.fontSize = w < 400 ? 24 : 30;
        place(this.summary.node, -w / 2 + 24 + summaryWidth / 2, h / 2 - 78, summaryWidth, 30);
        this.summary.fontSize = w < 500 ? 14 : 17;
        panelButton(this.closeButton, '', w / 2 - 31, h / 2 - 31, 44, 44, false, true);
        place(this.status.node, w / 2 - 166, h / 2 - 78, 280, 26);
        this.status.node.active = w >= 760;
        this.tabs.forEach((node, i) => panelButton(node, w < 500 && i === 0 ? '全部' : TABS[i], -w / 2 + 24 + (w - 48) / 4 * (i + .5), h / 2 - 123,
            (w - 48) / 4 - 6, 34, i === this.category));
        const bodyHeight = h - 170;
        const wide = w >= 760;
        const gridWidth = wide ? Math.floor((w - 64) * .61) : w - 48;
        const gridHeight = bodyHeight - 64;
        this.detailWidth = wide ? w - 64 - gridWidth : gridWidth;
        const detailHeight = wide ? bodyHeight : bodyHeight - 40;
        const bodyTop = h / 2 - 150;
        const graphX = -w / 2 + 24 + gridWidth / 2;
        this.sizeScroll(this.grid, graphX, bodyTop - 64 - gridHeight / 2, gridWidth, gridHeight);
        this.grid.node.active = wide || !this.detailOnly;
        this.routeTitle.node.active = this.routeHint.node.active = this.focusButton.active = this.grid.node.active;
        place(this.routeTitle.node, graphX - 57, bodyTop - 18, gridWidth - 114, 28);
        place(this.routeHint.node, graphX, bodyTop - 46, gridWidth - 8, 22);
        this.routeHint.overflow = Label.Overflow.SHRINK;
        panelButton(this.focusButton, '定位目标', graphX + gridWidth / 2 - 50, bodyTop - 17, 96, 30);
        this.detail.active = wide || this.detailOnly;
        this.backButton.active = !wide && this.detailOnly;
        panelButton(this.backButton, '‹ 建设路线', -w / 2 + 78, bodyTop - 15, 108, 30);
        place(this.detail, wide ? w / 2 - 24 - this.detailWidth / 2 : 0,
            bodyTop - (wide ? 0 : 40) - detailHeight / 2, this.detailWidth, detailHeight);
        inkSurface(this.detail, 'DetailSurface', this.detailWidth, detailHeight, C.panel);
        this.sizeScroll(this.detailScroll, 0, 35, this.detailWidth - 24, Math.max(60, detailHeight - 82));
        this.layoutRoute(gridWidth, gridHeight);
        this.grid.scrollToOffset(new Vec2(0, Math.max(0, Math.min(this.graphMetrics.height - gridHeight, oldOffset))), 0);
        panelButton(this.action, '', 0, -detailHeight / 2 + 46, this.detailWidth - 32, 42, true);
        place(this.actionHint.node, 0, -detailHeight / 2 + 14, this.detailWidth - 28, 22);
        this.layingOut = false;
        this.refresh();
    }

    private syncGraph(): void {
        const b = BuildCommand.getInstance(), configs = MapUICommand.getInstance().proxy.getFacilityConfigs();
        const signature = JSON.stringify([this.category, this.selected, this.selectedLevel,
            configs.map(cfg => [cfg.type, cfg.upLevels.length]), Array.from(b.levels)]);
        if (signature === this.graphSignature) return;
        this.graphSignature = signature;
        const graph = buildingProgressionGraph(configs, b.levels, this.category, { type: this.selected, level: this.selectedLevel });
        this.graphNodes = graph.nodes; this.graphEdges = graph.edges;
        this.cards.forEach(card => { card.node.removeFromParent(); card.node.destroy(); }); this.cards = [];
        for (const data of graph.nodes) {
            const cfg = data.cfg;
            const node = this.button(this.content, `Building_${cfg.type}_${data.level}`, () => this.selectBuilding(cfg.type, data.level));
            this.cards.push({ data, cfg, node, art: this.makeSprite('Art', node),
                title: caption(node, 'Name', cfg.name, 0, 0, 160, 17),
                level: caption(node, 'Level', '', 0, 0, 90, 14, C.gold, Label.HorizontalAlign.RIGHT),
                state: caption(node, 'State', '', 0, 0, 160, 12, C.muted) });
        }
        const ui = this.grid.node.getComponent(UITransform);
        const offset = this.grid.getScrollOffset().y;
        this.layoutRoute(ui.width, ui.height);
        this.grid.scrollToOffset(new Vec2(0, Math.max(0, Math.min(this.graphMetrics.height - ui.height, offset))), 0);
    }

    private layoutRoute(width: number, height: number): void {
        this.graphMetrics = layoutBuildingGraph(this.graphNodes, width);
        const { cardWidth, cardHeight } = this.graphMetrics;
        this.cardWidth = cardWidth;
        this.layerLabels.forEach(label => label.node.active = false);
        const rows = this.graphMetrics.rows.length ? this.graphMetrics.rows : [{ y: -64,
            label: BuildCommand.getInstance().loaded ? '当前分类已全部建成' : '正在读取建筑信息…' }];
        rows.forEach((row, i) => {
            const label = this.layerLabels[i] || (this.layerLabels[i] = caption(this.content, `Layer_${i}`, '', 0, 0, width - 56, 13, C.muted));
            label.node.active = true;
            label.string = row.label;
            place(label.node, 0, row.y, width - 56, 22);
        });
        this.cards.forEach(card => {
            place(card.node, card.data.x, card.data.y, cardWidth, cardHeight);
            place(card.title.node, 0, 30, cardWidth - 20, 28);
            place(card.art.node, -cardWidth / 2 + 42, -1, 64, 50);
            place(card.level.node, cardWidth / 2 - 47, -1, 78, 36);
            card.level.enableWrapText = true; card.level.lineHeight = 19;
            place(card.state.node, 0, -35, cardWidth - 16, 24);
            card.state.overflow = card.level.overflow = Label.Overflow.SHRINK;
        });
        this.content.getComponent(UITransform).setContentSize(width, Math.max(height, this.graphMetrics.height));
        this.content.setPosition(0, height / 2, 0);
    }

    private drawConnections(): ReturnType<typeof buildingGraphFocus> {
        const selectedKey = buildingGoalKey(this.selected, this.selectedLevel);
        const focus = buildingGraphFocus(selectedKey, this.graphEdges);
        const byKey = new Map(this.graphNodes.map(node => [node.key, node]));
        const line = this.routeLine; line.clear();
        const edges = this.graphEdges.slice().sort((a, b) => Number(focus.links.has(a)) - Number(focus.links.has(b)));
        const known = BuildCommand.getInstance().loaded;
        edges.forEach((edge, i) => {
            const source = byKey.get(edge.from), target = byKey.get(edge.to);
            if (!source || !target) return;
            const active = focus.links.has(edge), met = known && edge.met;
            line.strokeColor = active ? C.gold : met ? new Color(117, 151, 110, 145) : new Color(119, 128, 116, 80);
            line.fillColor = line.strokeColor; line.lineWidth = active ? 2.6 : 1.4;
            const bottom = source.y - this.graphMetrics.cardHeight / 2;
            const top = target.y + this.graphMetrics.cardHeight / 2;
            const near = bottom - top <= this.graphMetrics.gap + 48;
            const gutter = -this.graphMetrics.width / 2 + 8 + (source.type % 4) * 4;
            const points = near ? [[source.x, bottom], [source.x, (bottom + top) / 2],
                [target.x, (bottom + top) / 2], [target.x, top + 5]] :
                [[source.x, bottom], [source.x, bottom - 18], [gutter, bottom - 18],
                    [gutter, top + 12], [target.x, top + 12], [target.x, top + 5]];
            for (let n = 1; n < points.length; n++) {
                const a = points[n - 1], b = points[n], distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
                if (distance < .1) continue;
                if (met) { line.moveTo(a[0], a[1]); line.lineTo(b[0], b[1]); }
                else for (let d = 0; d < distance; d += 11) {
                    const end = Math.min(d + 6, distance);
                    line.moveTo(a[0] + (b[0] - a[0]) * d / distance, a[1] + (b[1] - a[1]) * d / distance);
                    line.lineTo(a[0] + (b[0] - a[0]) * end / distance, a[1] + (b[1] - a[1]) * end / distance);
                }
            }
            line.stroke();
            line.moveTo(target.x - 4, top + 7); line.lineTo(target.x + 4, top + 7); line.lineTo(target.x, top + 1);
            line.close(); line.fill();
        });
        return focus;
    }

    private refresh(): void {
        if (!this.panel || !this.node.activeInHierarchy) return;
        const b = BuildCommand.getInstance(), configs = MapUICommand.getInstance().proxy.getFacilityConfigs();
        const balances = this.resourceBalances();
        const known = b.loaded;
        this.selectedLevel = Math.max(this.selectedLevel, b.levels.get(this.selected) || 0);
        const built = configs.filter(cfg => (b.levels.get(cfg.type) || 0) > 0).length;
        this.summary.string = known ? `主城 ${b.levels.get(1) || 0} 级    ·    已建 ${built} / ${configs.length}    ·    待建 ${configs.length - built}` : '正在读取城内建筑…';
        this.updateSyncRetry();
        this.status.string = !b.sessionReady ? '等待连接' : b.loading || this.retryScheduled ? '正在同步建筑…' :
            b.loadError ? '暂时无法同步，请稍后重新进入' : known ? '建筑变化自动同步' : '等待建筑数据';
        this.tabs.forEach((node, i) => panelButton(node, this.width < 500 && i === 0 ? '全部' : TABS[i], node.position.x, node.position.y,
            (this.width - 48) / 4 - 6, 34, i === this.category));
        this.syncGraph();
        const focus = this.drawConnections();
        const key = buildingGoalKey(this.selected, this.selectedLevel);
        for (const card of this.cards) {
            const state = buildingGoalPresentation(card.cfg, card.data.level, b.levels, configs, balances);
            const selected = card.data.key === key;
            const related = focus.ancestors.has(card.data.key) || focus.descendants.has(card.data.key);
            inkSurface(card.node, 'CardSurface', this.cardWidth, this.graphMetrics.cardHeight,
                selected ? new Color(69, 59, 36) : card.data.complete ? new Color(34, 47, 37) : C.panel,
                selected ? C.gold : related ? new Color(166, 143, 89, 190) : C.line);
            card.title.color = selected || related ? C.text : C.muted;
            card.level.string = known ? `${card.data.level} 级\n${state.achieved ? '已完成' : '当前 ' + state.level + ' 级'}` : '待同步';
            card.level.color = known && state.achieved ? GREEN : C.gold;
            card.state.string = !known ? '等待建筑信息' : state.achieved ? (state.maxed ? '已达上限' : '✓ 前置已完成')
                : !state.unlocked ? '待完成前置' : !state.enough ? '资源不足' : state.level ? '可升级' : '可建造';
            card.state.color = known && (state.achieved || state.canAct) ? GREEN : C.muted;
            card.art.color = known && !state.achieved && !state.unlocked ? new Color(157, 161, 149) : Color.WHITE;
            this.setArt(card.art, buildingArt(card.cfg, b.levels.get(card.cfg.type) || 1), 64, 50);
        }
        const cfg = configs.find(item => item.type === this.selected);
        if (!cfg) { this.action.getComponent(Button).interactable = false; return; }
        const state = buildingGoalPresentation(cfg, this.selectedLevel, b.levels, configs, balances);
        const dw = this.detailWidth - 48;
        this.detailTitle.string = cfg.name;
        place(this.detailTitle.node, 54, -32, dw - 108, 34);
        this.detailTitle.overflow = Label.Overflow.SHRINK;
        this.detailLevel.string = known ? (state.achieved ? `已完成 ${state.targetLevel} 级` : `当前 ${state.level} 级  →  目标 ${state.targetLevel} 级`) : '同步建筑信息…';
        place(this.detailLevel.node, 54, -64, dw - 108, 25);
        this.detailLevel.overflow = Label.Overflow.SHRINK;
        this.detailArt.node.setPosition(-dw / 2 + 46, -52, 0);
        this.setArt(this.detailArt, buildingArt(cfg, state.level), 96, 78);
        this.description.string = cfg.des;
        this.description.fontSize = 14; this.description.lineHeight = 20;
        place(this.description.node, 0, -119, dw, 44);
        this.conditionTitle.string = state.achieved ? '目标已完成' : '① 先完成全部前置';
        place(this.conditionTitle.node, 0, -163, dw, 26);
        this.conditions.string = !known ? '等待服务器确认建筑等级' : state.achieved ? (state.maxed ? '当前建筑已完成全部等级建设' : '该目标已经完成，可继续查看下一等级') :
            state.conditions.length ? '' : '无前置要求，可直接建设';
        this.conditions.node.active = !known || state.achieved || state.conditions.length === 0;
        place(this.conditions.node, 0, -196, dw, 30);
        this.conditions.fontSize = 14;
        this.conditionRows.forEach(row => row.node.active = false);
        let top = 218;
        if (known && !state.achieved && state.conditions.length) {
            state.conditions.forEach((condition, i) => {
                let row = this.conditionRows[i];
                if (!row) {
                    const node = this.button(this.detailContent, `Prerequisite_${i}`, () => this.selectBuilding(this.conditionRows[i].type, this.conditionRows[i].level));
                    row = { node, type: 0, level: 0, title: caption(node, 'Name', '', 0, 0, 180, 14),
                        progress: caption(node, 'Progress', '', 0, 0, 90, 13, C.muted, Label.HorizontalAlign.RIGHT) };
                    this.conditionRows.push(row);
                }
                row.type = condition.type; row.level = condition.level; row.node.active = true;
                place(row.node, 0, -198 - i * 44, dw, 38);
                inkSurface(row.node, 'Surface', dw, 38, C.inset, condition.met ? C.line : new Color(180, 119, 83));
                place(row.title.node, -42, 0, dw - 106, 26);
                row.title.string = `${condition.met ? '✓' : '·'} ${condition.name} ${condition.level} 级`;
                row.title.color = condition.met ? GREEN : C.text;
                row.title.overflow = Label.Overflow.SHRINK;
                place(row.progress.node, dw / 2 - 54, 0, 88, 26);
                row.progress.string = condition.met ? `已达 ${condition.currentLevel} 级  ›` : `${condition.currentLevel}/${condition.level} 级  ›`;
                row.progress.color = condition.met ? GREEN : RED;
                row.node.getComponent(Button).interactable = configs.some(item => item.type === condition.type);
            });
            top = 186 + state.conditions.length * 44;
        }
        this.costTitle.string = `② ${cfg.name} ${state.targetLevel} 级 · 所需资源`;
        place(this.costTitle.node, 0, -top - 13, dw, 26);
        this.costTitle.node.active = known && !state.achieved;
        const costColumns = dw >= 300 ? 2 : 1;
        const costWidth = (dw - 8 * (costColumns - 1)) / costColumns;
        this.costs.forEach((row, i) => {
            row.node.active = known && !state.achieved;
            place(row.node, -dw / 2 + costWidth / 2 + i % costColumns * (costWidth + 8),
                -top - 58 - Math.floor(i / costColumns) * 62, costWidth, 54);
            inkSurface(row.node, 'Surface', costWidth, 54, C.inset, null);
            row.icon.node.setPosition(-costWidth / 2 + 19, 0, 0);
            this.setArt(row.icon, itemIconPath(state.costs[i].id).replace(/\/spriteFrame$/, ''), 24, 24);
            place(row.label.node, 19, 0, costWidth - 46, 44);
            row.label.string = `${state.costs[i].name} ${state.costs[i].need.toLocaleString()}\n持有 ${state.costs[i].have.toLocaleString()}`;
            row.label.fontSize = 13; row.label.lineHeight = 19; row.label.enableWrapText = true;
            row.label.overflow = Label.Overflow.SHRINK;
            row.label.color = state.costs[i].have >= state.costs[i].need ? C.text : RED;
        });
        if (known && !state.achieved) top += 34 + Math.ceil(4 / costColumns) * 62;
        const next = buildingNextUnlocks(cfg.type, b.levels, configs);
        this.unlockTitle.node.active = this.unlocks.node.active = known && next.length > 0;
        if (next.length && known) {
            place(this.unlockTitle.node, 0, -top - 16, dw, 28);
            this.unlocks.string = next.slice(0, 3).map(item => `${cfg.name} ${item.requiredLevel} 级 → ${item.name} ${item.targetLevel} 级`).join('\n')
                + (next.length > 3 ? `\n另有 ${next.length - 3} 项后续建设` : '');
            const textHeight = Math.min(4, next.length) * 24;
            place(this.unlocks.node, 0, -top - 38 - textHeight / 2, dw, textHeight);
            top += 46 + textHeight;
        }
        this.detailContent.getComponent(UITransform).setContentSize(this.detailWidth - 24,
            Math.max(top + 10, this.detailScroll.node.getComponent(UITransform).height));
        const pending = b.requestInFlight(`build:${cfg.type}`);
        const blocked = !state.achieved && state.conditions.find(c => !c.met && configs.some(item => item.type === c.type));
        const label = !b.sessionReady ? '等待连接' : b.loading || this.retryScheduled ? '正在同步…' : b.loadError ? '暂时无法同步' :
            !known ? '等待建筑信息' : pending ? '等待服务器确认…' : blocked ? `前往${blocked.name} · 完成前置` : state.action;
        const canPress = b.sessionReady && known && !b.loading && !b.loadError && !pending && (state.canAct || !!blocked || state.achieved && !state.maxed);
        panelButton(this.action, label, this.action.position.x, this.action.position.y, this.detailWidth - 32, 42, !!canPress);
        this.action.getComponent(Button).interactable = !!canPress;
        this.actionHint.string = b.loadError ? '连接恢复或重新进入后自动同步' : !known ? '同步完成后可进行建设' : blocked ? '点击前置建筑可查看并继续建设' :
            state.achieved ? (state.maxed ? '当前等级配置已达上限' : '该目标已完成，可继续升级这座建筑') : !state.enough ? '前置已完成，备齐资源即可建设' : '前置与资源已齐备，可以开始建设';
        this.actionHint.overflow = Label.Overflow.SHRINK;
    }

    private resourceBalances(): Array<{ k: number; v: number }> {
        const proxy = LoginCommand.getInstance().proxy;
        return [1, 2, 3, 4].map(k => ({ k, v: proxy.getItemCount(k) }));
    }

    private onAction(): void {
        const b = BuildCommand.getInstance();
        if (!b.loaded || b.loadError || b.loading || !b.sessionReady) return;
        const configs = MapUICommand.getInstance().proxy.getFacilityConfigs();
        const cfg = configs.find(item => item.type === this.selected);
        if (!cfg) return;
        const state = buildingGoalPresentation(cfg, this.selectedLevel, b.levels, configs, this.resourceBalances());
        if (state.achieved) { if (!state.maxed) this.selectBuilding(cfg.type, state.level + 1); return; }
        const blocked = state.conditions.find(c => !c.met);
        if (blocked) { this.selectBuilding(blocked.type, this.nextLevel(blocked.type)); return; }
        if (!state.canAct) return;
        MapUICommand.getInstance().upFacility(this.cityId, cfg.type);
    }

    private updateSyncRetry(): void {
        const b = BuildCommand.getInstance();
        if (!b.loadError) {
            this.unschedule(this.retrySync); this.retryScheduled = false;
            if (b.loaded && !b.loading) this.syncRetries = 0;
        } else if (b.sessionReady && !b.loading && !this.retryScheduled && this.syncRetries < 2) {
            this.retryScheduled = true;
            this.scheduleOnce(this.retrySync, this.syncRetries === 0 ? 2 : 5);
        }
    }
    private retrySync = (): void => {
        this.retryScheduled = false;
        const b = BuildCommand.getInstance();
        if (!this.node.activeInHierarchy || !b.sessionReady || !b.loadError || b.loading) return;
        this.syncRetries++;
        b.requestBuildings();
    };

    protected onDisable(): void {
        this.unschedule(this.retrySync); this.retryScheduled = false;
    }

    private setArt(sprite: Sprite, path: string, width: number, height: number): void {
        this.imageKeys.set(sprite, path);
        const apply = (frame: SpriteFrame) => {
            if (!this.isValid || !sprite.isValid || this.imageKeys.get(sprite) !== path) return;
            sprite.spriteFrame = frame;
            const size = frame.originalSize, scale = Math.min(width / size.width, height / size.height);
            sprite.node.getComponent(UITransform).setContentSize(size.width * scale, size.height * scale);
        };
        const frame = this.frames.get(path);
        if (frame) { apply(frame); return; }
        sprite.spriteFrame = null;
        if (!this.loadingFrames.has(path)) this.loadingFrames.set(path, new Promise((resolve, reject) => {
            resources.load(`${path}/spriteFrame`, SpriteFrame, (error, asset) => {
                if (error || !(asset instanceof SpriteFrame)) reject(error || new Error('建筑图片类型错误'));
                else { this.frames.set(path, asset); resolve(asset); }
            });
        }));
        this.loadingFrames.get(path).then(apply).catch(() => {});
    }

    private makeNode(name: string, parent: Node): Node {
        const node = new Node(name); node.layer = parent.layer;
        node.addComponent(UITransform); parent.addChild(node); return node;
    }
    private makeSprite(name: string, parent: Node): Sprite {
        const sprite = this.makeNode(name, parent).addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.trim = false; return sprite;
    }
    private button(parent: Node, name: string, action: () => void): Node {
        const node = this.makeNode(name, parent);
        node.addComponent(Button);
        node.on(Button.EventType.CLICK, () => { AudioManager.instance.playClick(); action.call(this); }, this);
        return node;
    }
    private stretch(node: Node): void {
        const widget = node.addComponent(Widget);
        widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
        widget.top = widget.bottom = widget.left = widget.right = 0;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE; widget.updateAlignment();
    }
    private makeScroll(name: string, parent: Node): ScrollView {
        const scroll = this.makeNode(name, parent).addComponent(ScrollView);
        scroll.horizontal = false; scroll.vertical = true; scroll.cancelInnerEvents = true;
        const viewport = this.makeNode('Viewport', scroll.node);
        viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const content = this.makeNode('Content', viewport);
        content.getComponent(UITransform).setAnchorPoint(.5, 1);
        scroll.content = content; return scroll;
    }
    private sizeScroll(scroll: ScrollView, x: number, y: number, width: number, height: number): void {
        scroll.stopAutoScroll(); place(scroll.node, x, y, width, height);
        place(scroll.content.parent, 0, 0, width, height);
        scroll.content.setPosition(0, height / 2, 0);
    }
    protected onDestroy(): void {
        EventMgr.targetOff(this);
        this.node.off(Node.EventType.SIZE_CHANGED, this.queueLayout, this);
        this.safe?.off(Node.EventType.SIZE_CHANGED, this.queueLayout, this);
        view.off('canvas-resize', this.queueLayout, this);
        view.off('design-resolution-changed', this.queueLayout, this);
        this.frames.clear(); this.loadingFrames.clear();
    }
}
