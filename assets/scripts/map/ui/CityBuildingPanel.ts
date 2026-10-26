import { _decorator, BlockInputEvents, Button, Color, Component, Graphics, Label, Mask, Node, SafeArea,
    ScrollView, Sprite, SpriteFrame, UITransform, Vec2, Widget, resources } from 'cc';
import BuildCommand from '../../build/BuildCommand';
import { buildingArt, buildingNextUnlocks, buildingPresentation, buildingStages } from './BuildingPresentation';
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
interface BuildingCard { cfg: FacilityConfig; node: Node; art: Sprite; title: Label; level: Label; state: Label; }
interface StageView { level: number; buildings: FacilityConfig[]; node: Node; title: Label; state: Label; marker: Label; }
interface ConditionView { node: Node; title: Label; progress: Label; type: number; }

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
    private stages: StageView[] = [];
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
        this.detailOnly = false;
        this.syncRetries = 0;
        this.unschedule(this.retrySync);
        this.retryScheduled = false;
        this.node.active = true;
        this.safe.getComponent(SafeArea).updateArea();
        this.layout();
        this.grid.scrollToTop(0);
        MapUICommand.getInstance().qryCityFacilities(cityId, true);
        this.refresh();
    }

    private build(): void {
        this.node.addComponent(UITransform);
        this.stretch(this.node);
        this.node.addComponent(BlockInputEvents);
        this.safe = this.makeNode('SafeContent', this.node);
        this.stretch(this.safe);
        this.safe.addComponent(SafeArea);
        this.panel = this.makeNode('CityBuildingWindow', this.safe);
        this.header = caption(this.panel, 'Title', '内城营造', 0, 0, 250, 30);
        this.summary = caption(this.panel, 'Overview', '', 0, 0, 600, 17, C.muted);
        this.status = caption(this.panel, 'SyncStatus', '', 0, 0, 250, 14, C.muted, Label.HorizontalAlign.RIGHT);
        this.closeButton = this.button(this.panel, 'Close', () => { this.node.active = false; });
        this.backButton = this.button(this.panel, 'BackToRoute', () => { this.detailOnly = false; this.layout(); });
        TABS.forEach((text, index) => {
            this.tabs.push(this.button(this.panel, `Category_${index}`, () => {
                this.category = index;
                this.detailOnly = false;
                const first = this.cards.find(card => this.visible(card.cfg));
                if (!this.cards.some(card => card.cfg.type === this.selected && this.visible(card.cfg))) this.selected = first?.cfg.type || 1;
                this.layout(); this.grid.scrollToTop(0); this.detailScroll.scrollToTop(0);
            }));
        });
        this.grid = this.makeScroll('BuildingGrid', this.panel);
        this.content = this.grid.content;
        this.routeLine = this.makeNode('ProgressionLine', this.content).addComponent(Graphics);
        this.routeTitle = caption(this.content, 'RouteTitle', '建设路线', 0, 0, 280, 19, C.gold);
        this.routeHint = caption(this.content, 'RouteHint', '提升主城 → 解锁建筑 → 完成前置 → 继续发展', 0, 0, 600, 13, C.muted);
        const configs = MapUICommand.getInstance().proxy.getFacilityConfigs();
        for (const stage of buildingStages(configs)) {
            const node = this.makeNode(`Stage_${stage.level}`, this.content);
            this.stages.push({ ...stage, node,
                title: caption(node, 'Title', stage.level === 1 ? '主城 1 级 · 基础建设' : `主城 ${stage.level} 级 · 解锁建筑`, 0, 0, 260, 17),
                state: caption(node, 'Status', '', 0, 0, 180, 12, C.muted, Label.HorizontalAlign.RIGHT),
                marker: caption(node, 'Marker', String(stage.level), 0, 0, 28, 13, C.gold, Label.HorizontalAlign.CENTER) });
        }
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
        for (const cfg of configs) {
            const node = this.button(this.content, `Building_${cfg.type}`, () => this.selectBuilding(cfg.type));
            this.cards.push({ cfg, node, art: this.makeSprite('Art', node),
                title: caption(node, 'Name', cfg.name, 0, 0, 160, 16),
                level: caption(node, 'Level', '', 0, 0, 100, 14, C.gold, Label.HorizontalAlign.RIGHT),
                state: caption(node, 'State', '', 0, 0, 160, 13, C.muted) });
        }
        this.node.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        this.safe.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        for (const event of [LogicEvent.updateCityBuilds, LogicEvent.protocolRequestChanged, LogicEvent.upateMyRoleRes]) {
            EventMgr.on(event, this.refresh, this);
        }
    }

    private visible(cfg: FacilityConfig): boolean {
        return this.category === 0 || (this.category === 1 ? cfg.category === 2 : this.category === 2 ? cfg.category === 3 : cfg.category !== 2 && cfg.category !== 3);
    }

    private selectBuilding(type: number): void {
        const cfg = this.cards.find(card => card.cfg.type === type)?.cfg;
        if (!cfg) return;
        const oldCategory = this.category;
        if (!this.visible(cfg)) this.category = 0;
        this.selected = type;
        this.detailOnly = true;
        if (oldCategory !== this.category || this.width < 760) this.layout();
        else this.refresh();
        this.detailScroll.scrollToTop(0);
        const card = this.cards.find(item => item.cfg.type === type);
        const viewport = this.grid.node.getComponent(UITransform).height;
        const contentHeight = this.content.getComponent(UITransform).height;
        const offset = this.grid.getScrollOffset().y, top = -card.node.position.y - 50;
        if (top < offset + 44 || top + 100 > offset + viewport - 8) {
            this.grid.scrollToOffset(new Vec2(0, Math.max(0, Math.min(contentHeight - viewport, top - 60))), .2);
        }
    }

    private layout(): void {
        if (!this.panel || this.layingOut) return;
        this.layingOut = true;
        const root = this.node.getComponent(UITransform), safe = this.safe.getComponent(UITransform);
        this.width = Math.min(1140, Math.max(280, safe.width - 32));
        this.height = Math.min(710, Math.max(360, safe.height - 32));
        inkSurface(this.node, 'Scrim', root.width, root.height, new Color(0, 0, 0, 175), null);
        place(this.panel, 0, 0, this.width, this.height);
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
        const gridHeight = bodyHeight;
        this.detailWidth = wide ? w - 64 - gridWidth : gridWidth;
        const detailHeight = wide ? bodyHeight : bodyHeight - 40;
        const bodyTop = h / 2 - 150;
        this.sizeScroll(this.grid, -w / 2 + 24 + gridWidth / 2, bodyTop - gridHeight / 2, gridWidth, gridHeight);
        this.grid.node.active = wide || !this.detailOnly;
        this.detail.active = wide || this.detailOnly;
        this.backButton.active = !wide && this.detailOnly;
        panelButton(this.backButton, '‹ 建设路线', -w / 2 + 78, bodyTop - 15, 108, 30);
        place(this.detail, wide ? w / 2 - 24 - this.detailWidth / 2 : 0,
            bodyTop - (wide ? 0 : 40) - detailHeight / 2, this.detailWidth, detailHeight);
        inkSurface(this.detail, 'DetailSurface', this.detailWidth, detailHeight, C.panel);
        this.sizeScroll(this.detailScroll, 0, 35, this.detailWidth - 24, Math.max(60, detailHeight - 82));
        this.layoutRoute(gridWidth, gridHeight);
        panelButton(this.action, '', 0, -detailHeight / 2 + 46, this.detailWidth - 32, 42, true);
        place(this.actionHint.node, 0, -detailHeight / 2 + 14, this.detailWidth - 28, 22);
        this.layingOut = false;
        this.refresh();
    }

    private layoutRoute(width: number, height: number): void {
        const available = width - 36;
        const columns = Math.max(1, Math.floor((available + 10) / 174));
        this.cardWidth = (available - 10 * (columns - 1)) / columns;
        place(this.routeTitle.node, 0, -16, width - 6, 28);
        place(this.routeHint.node, 0, -42, width - 6, 24);
        this.routeHint.overflow = Label.Overflow.SHRINK;
        this.cards.forEach(card => card.node.active = this.visible(card.cfg));
        let top = 64;
        for (const stage of this.stages) {
            const cards = stage.buildings.map(cfg => this.cards.find(c => c.cfg.type === cfg.type)).filter(c => c && this.visible(c.cfg));
            stage.node.active = cards.length > 0;
            if (!cards.length) continue;
            place(stage.node, 0, -top - 18, width, 36);
            const narrow = width < 440;
            place(stage.marker.node, -width / 2 + 14, 0, 26, 26);
            place(stage.title.node, 18, narrow ? 7 : 0, width - 64, 25);
            stage.title.fontSize = narrow ? 15 : 17;
            place(stage.state.node, narrow ? 18 : width / 2 - 78, narrow ? -14 : 0, narrow ? width - 64 : 140, 20);
            stage.state.horizontalAlign = narrow ? Label.HorizontalAlign.LEFT : Label.HorizontalAlign.RIGHT;
            top += narrow ? 52 : 44;
            cards.forEach((card, i) => {
                place(card.node, -width / 2 + 36 + this.cardWidth / 2 + i % columns * (this.cardWidth + 10),
                    -top - 50 - Math.floor(i / columns) * 110, this.cardWidth, 100);
                place(card.title.node, 0, 31, this.cardWidth - 20, 25);
                place(card.art.node, -this.cardWidth / 2 + 42, -5, 64, 52);
                place(card.level.node, this.cardWidth / 2 - 49, -3, 76, 24);
                place(card.state.node, 0, -35, this.cardWidth - 20, 22);
                card.state.overflow = Label.Overflow.SHRINK;
            });
            top += Math.ceil(cards.length / columns) * 110 + 12;
        }
        this.content.getComponent(UITransform).setContentSize(width, Math.max(height, top));
        this.content.setPosition(0, height / 2, 0);
    }

    private refresh(): void {
        if (!this.panel || !this.node.activeInHierarchy) return;
        const b = BuildCommand.getInstance(), configs = MapUICommand.getInstance().proxy.getFacilityConfigs();
        const balances = this.resourceBalances();
        const known = b.loaded;
        const built = configs.filter(cfg => (b.levels.get(cfg.type) || 0) > 0).length;
        this.summary.string = known ? `主城 ${b.levels.get(1) || 0} 级    ·    已建 ${built} / ${configs.length}    ·    待建 ${configs.length - built}` : '正在读取城内建筑…';
        this.updateSyncRetry();
        this.status.string = !b.sessionReady ? '等待连接' : b.loading || this.retryScheduled ? '正在同步建筑…' :
            b.loadError ? '暂时无法同步，请稍后重新进入' : known ? '建筑变化自动同步' : '等待建筑数据';
        this.tabs.forEach((node, i) => panelButton(node, this.width < 500 && i === 0 ? '全部' : TABS[i], node.position.x, node.position.y,
            (this.width - 48) / 4 - 6, 34, i === this.category));
        const routeWidth = this.grid.node.getComponent(UITransform).width;
        const line = this.routeLine;
        line.clear(); line.lineWidth = 2;
        const shownStages = this.stages.filter(stage => stage.node.active);
        shownStages.forEach((stage, index) => {
            const reached = known && (b.levels.get(1) || 0) >= stage.level;
            const color = reached ? C.gold : C.line;
            const x = -routeWidth / 2 + 14, y = stage.node.position.y;
            if (index < shownStages.length - 1) {
                line.strokeColor = reached ? new Color(153, 134, 91, 160) : C.line;
                line.moveTo(x, y - 16); line.lineTo(x, shownStages[index + 1].node.position.y + 16); line.stroke();
            }
            line.fillColor = reached ? new Color(80, 67, 40) : C.ink;
            line.circle(x, y, 14); line.fill();
            line.strokeColor = color; line.circle(x, y, 14); line.stroke();
            stage.marker.color = reached ? C.text : C.muted;
            stage.title.color = reached ? C.text : C.muted;
            const members = stage.buildings.filter(cfg => this.visible(cfg));
            const count = members.filter(cfg => (b.levels.get(cfg.type) || 0) > 0).length;
            stage.state.string = !known ? '等待同步' : reached ? `已解锁 · 已建 ${count}/${members.length}` : `主城 ${stage.level} 级开放`;
            stage.state.color = reached ? GREEN : C.muted;
        });
        for (const card of this.cards) {
            if (!card.node.active) continue;
            const state = buildingPresentation(card.cfg, b.levels, configs, balances);
            const selected = card.cfg.type === this.selected;
            const blocked = state.conditions.find(c => !c.met);
            inkSurface(card.node, 'CardSurface', this.cardWidth, 100,
                selected ? new Color(67, 60, 41, 255) : known && !state.level && !state.unlocked ? C.inset : C.panel,
                selected ? C.gold : C.line);
            card.level.string = known ? (state.level ? `${state.level} 级` : '未建造') : '待同步';
            card.state.string = !known ? '等待建筑信息' : blocked ? `先完成 ${blocked.name} ${blocked.level} 级` : state.status;
            card.state.color = known && state.unlocked ? (state.maxed ? C.muted : GREEN) : C.muted;
            card.art.color = known && !state.level && !state.unlocked ? new Color(150, 151, 143) : Color.WHITE;
            this.setArt(card.art, buildingArt(card.cfg, state.level), 64, 52);
        }
        const cfg = configs.find(item => item.type === this.selected);
        if (!cfg) { this.action.getComponent(Button).interactable = false; return; }
        const state = buildingPresentation(cfg, b.levels, configs, balances);
        const dw = this.detailWidth - 48;
        this.detailTitle.string = cfg.name;
        place(this.detailTitle.node, 54, -32, dw - 108, 34);
        this.detailTitle.overflow = Label.Overflow.SHRINK;
        this.detailLevel.string = known ? (state.maxed ? `${state.level} 级 · 已达上限` : `${state.level} 级  →  ${state.level + 1} 级`) : '同步建筑信息…';
        place(this.detailLevel.node, 54, -64, dw - 108, 25);
        this.detailLevel.overflow = Label.Overflow.SHRINK;
        this.detailArt.node.setPosition(-dw / 2 + 46, -52, 0);
        this.setArt(this.detailArt, buildingArt(cfg, state.level), 96, 78);
        this.description.string = cfg.des;
        this.description.fontSize = 14; this.description.lineHeight = 20;
        place(this.description.node, 0, -119, dw, 44);
        this.conditionTitle.string = state.maxed ? '本阶段已完成' : '① 先完成前置建设';
        place(this.conditionTitle.node, 0, -163, dw, 26);
        this.conditions.string = !known ? '等待服务器确认建筑等级' : state.maxed ? '已完成当前阶段的建设' :
            state.conditions.length ? '' : '无前置要求，可直接建设';
        this.conditions.node.active = !known || state.conditions.length === 0;
        place(this.conditions.node, 0, -196, dw, 30);
        this.conditions.fontSize = 14;
        this.conditionRows.forEach(row => row.node.active = false);
        let top = 218;
        if (known && state.conditions.length) {
            state.conditions.forEach((condition, i) => {
                let row = this.conditionRows[i];
                if (!row) {
                    const node = this.button(this.detailContent, `Prerequisite_${i}`, () => this.selectBuilding(this.conditionRows[i].type));
                    row = { node, type: 0, title: caption(node, 'Name', '', 0, 0, 180, 14),
                        progress: caption(node, 'Progress', '', 0, 0, 90, 13, C.muted, Label.HorizontalAlign.RIGHT) };
                    this.conditionRows.push(row);
                }
                row.type = condition.type; row.node.active = true;
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
        this.costTitle.string = `② ${state.level > 0 ? '再升级' : '再建造'}${cfg.name} · 所需资源`;
        place(this.costTitle.node, 0, -top - 13, dw, 26);
        this.costTitle.node.active = known && !state.maxed;
        const costColumns = dw >= 300 ? 2 : 1;
        const costWidth = (dw - 8 * (costColumns - 1)) / costColumns;
        this.costs.forEach((row, i) => {
            row.node.active = known && !state.maxed;
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
        if (known && !state.maxed) top += 34 + Math.ceil(4 / costColumns) * 62;
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
        const blocked = state.conditions.find(c => !c.met && configs.some(item => item.type === c.type));
        const label = !b.sessionReady ? '等待连接' : b.loading || this.retryScheduled ? '正在同步…' : b.loadError ? '暂时无法同步' :
            !known ? '等待建筑信息' : pending ? '等待服务器确认…' : blocked ? `前往${blocked.name} · 完成 ${blocked.level} 级` : state.action;
        const canPress = b.sessionReady && known && !b.loading && !b.loadError && !pending && (state.canAct || !!blocked);
        panelButton(this.action, label, this.action.position.x, this.action.position.y, this.detailWidth - 32, 42, !!canPress);
        this.action.getComponent(Button).interactable = !!canPress;
        this.actionHint.string = b.loadError ? '连接恢复或重新进入后自动同步' : !known ? '同步完成后可进行建设' : blocked ? '点击前置建筑可查看并继续建设' :
            state.maxed ? '当前等级配置已达上限' : !state.enough ? '前置已完成，备齐资源即可建设' : '前置与资源已齐备，可以开始建设';
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
        const state = buildingPresentation(cfg, b.levels, configs, this.resourceBalances());
        const blocked = state.conditions.find(c => !c.met);
        if (blocked) { this.selectBuilding(blocked.type); return; }
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
        this.node.off(Node.EventType.SIZE_CHANGED, this.layout, this);
        this.safe?.off(Node.EventType.SIZE_CHANGED, this.layout, this);
        this.frames.clear(); this.loadingFrames.clear();
    }
}
