import { _decorator, BlockInputEvents, Button, Color, Component, Graphics, Label, Mask, Node,
    SafeArea, ScrollView, Sprite, UITransform, Widget } from 'cc';
import BattleCommand, { ReportInfo } from '../../battle/BattleCommand';
import { reportKind, reportLayout, reportResult, reportTime, reportUnitName, soldierTotals } from '../../battle/ReportPresentation';
import { ServerConfig as S } from '../../config/ServerConfig';
import { LogicEvent as E } from '../../common/LogicEvent';
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { itemName } from '../../common/ItemPresentation';
import InventoryIconCache from '../../inventory/InventoryIconCache';
import BattleReplayView from './BattleReplayView';
import BattleReplayPaintedView from './BattleReplayPaintedView';
import { reportUnitArt } from './ReportUnitArt';
import { caption, headerRule, inkSurface, ManagementColors as C, panelButton, place } from './ManagementStyle';
const { ccclass } = _decorator;
const WIN = new Color(135, 185, 139), LOSS = new Color(208, 121, 103);
const FILTERS: Array<[number, string]> = [[0, '全部'], [4, '资源地'], [1, '讨伐'], [2, '攻城'], [3, '防守']];

@ccclass('BattleReportPanel')
export default class BattleReportPanel extends Component {
    private safe: Node;
    private panel: Node;
    private tabs: Node;
    private list: ScrollView;
    private detail: ScrollView;
    private metrics = reportLayout(1280, 720);
    private selected = '';
    private category = 0;
    private page: 'summary' | 'replay' = 'summary';
    private detailKey = '';
    private detailLocation = '';
    private queued = false;
    private layingOut = false;

    onEnable(): void {
        EventMgr.on(E.upateWarReport, this.queueRender, this);
        EventMgr.on(E.protocolRequestChanged, this.queueRender, this);
        EventMgr.on(E.updateReportDetail, this.onDetail, this);
        EventMgr.on(E.updateReportReplay, this.queueRender, this);
        EventMgr.on(E.enterLogin, this.close, this);
        if (this.panel) this.layout();
    }
    onDisable(): void { EventMgr.targetOff(this); this.unschedule(this.flushRender); this.queued = false; }
    onDestroy(): void { EventMgr.targetOff(this); }

    public show(): void {
        if (!this.panel) this.build();
        this.selected = ''; this.page = 'summary'; this.detailKey = ''; this.detailLocation = '';
        this.node.getComponent(Widget).updateAlignment();
        this.safe.getComponent(Widget).updateAlignment();
        this.safe.getComponent(SafeArea).updateArea();
        this.layout();
        BattleCommand.getInstance().requestReports();
    }
    private close(): void { this.node.active = false; }
    private nodeAt(parent: Node, name: string): Node {
        const node = new Node(name); node.layer = parent.layer; node.addComponent(UITransform); parent.addChild(node); return node;
    }
    private stretch(node: Node): void {
        const w = node.getComponent(Widget) || node.addComponent(Widget);
        w.isAlignLeft = w.isAlignRight = w.isAlignTop = w.isAlignBottom = true;
        w.left = w.right = w.top = w.bottom = 0; w.alignMode = Widget.AlignMode.ALWAYS; w.updateAlignment();
    }
    private button(parent: Node, name: string, action: () => void): Node {
        const node = this.nodeAt(parent, name); node.addComponent(Button);
        node.on(Button.EventType.CLICK, () => { AudioManager.instance.playClick(); action(); }, this); return node;
    }
    private scroll(parent: Node, name: string): ScrollView {
        const node = this.nodeAt(parent, name), scroll = node.addComponent(ScrollView);
        scroll.horizontal = false; scroll.vertical = true; scroll.cancelInnerEvents = true;
        const viewport = this.nodeAt(node, 'Viewport'); viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const content = this.nodeAt(viewport, 'Content'); content.getComponent(UITransform).setAnchorPoint(.5, 1);
        scroll.content = content; return scroll;
    }
    private build(): void {
        if (!this.node.getComponent(UITransform)) this.node.addComponent(UITransform);
        this.stretch(this.node); this.node.addComponent(BlockInputEvents);
        this.safe = this.nodeAt(this.node, 'SafeContent'); this.stretch(this.safe); this.safe.addComponent(SafeArea);
        this.panel = this.nodeAt(this.safe, 'ReportWindow');
        caption(this.panel, 'Title', '战报', 0, 0, 160, 28);
        caption(this.panel, 'Status', '', 0, 0, 400, 13, C.muted);
        this.button(this.panel, 'Close', () => this.close());
        this.button(this.panel, 'ReadAll', () => BattleCommand.getInstance().readReports());
        this.button(this.panel, 'Back', () => { this.selected = ''; this.layout(); });
        this.tabs = this.nodeAt(this.panel, 'Filters');
        for (const [id] of FILTERS) this.button(this.tabs, String(id), () => {
            if (this.category === id) return;
            this.category = id; this.selected = ''; this.list.scrollToTop(); this.layout();
        });
        this.list = this.scroll(this.panel, 'Reports');
        caption(this.list.node, 'Empty', '', 0, 0, 260, 16, C.muted, Label.HorizontalAlign.CENTER);
        this.detail = this.scroll(this.panel, 'Detail');
        this.node.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        this.safe.on(Node.EventType.SIZE_CHANGED, this.layout, this);
    }
    private layout(): void {
        if (!this.panel || this.layingOut) return;
        const size = this.safe.getComponent(UITransform), root = this.node.getComponent(UITransform);
        if (size.width <= 1 || size.height <= 1) return;
        this.layingOut = true;
        this.metrics = reportLayout(size.width, size.height);
        const m = this.metrics, top = m.height / 2, left = -m.width / 2;
        inkSurface(this.node, 'Scrim', root.width, root.height, new Color(4, 9, 7, 185), null);
        place(this.panel, 0, 0, m.width, m.height); this.panel.setScale(m.scale, m.scale, 1);
        inkSurface(this.panel, 'Surface', m.width, m.height, C.ink, C.gold);
        place(this.panel.getChildByName('Title'), left + 96, top - 34, 148, 40);
        place(this.panel.getChildByName('Status'), 0, top - 67, m.width - 44, 24);
        panelButton(this.panel.getChildByName('Close'), '', m.width / 2 - 38, top - 35, 38, 38, false, true);
        headerRule(this.panel, m.width - 40, top - 87);
        place(this.tabs, 0, top - 116, m.width - 40, 36);
        const step = (m.width - 40) / FILTERS.length;
        FILTERS.forEach(([id, name], i) => panelButton(this.tabs.getChildByName(String(id)), name,
            (i - 2) * step, 0, step - 6, 34, id === this.category));
        const bodyY = top - 146 - m.bodyHeight / 2;
        this.positionScroll(this.list, m.narrow ? 0 : left + 20 + m.listWidth / 2, bodyY, m.listWidth, m.bodyHeight);
        this.positionScroll(this.detail, m.narrow ? 0 : m.width / 2 - 20 - m.detailWidth / 2, bodyY, m.detailWidth, m.bodyHeight);
        panelButton(this.panel.getChildByName('ReadAll'), '全部已读', m.width / 2 - 72, -top + 18, 104, 28);
        panelButton(this.panel.getChildByName('Back'), '返回列表', left + 72, -top + 18, 104, 28);
        this.render(); this.layingOut = false;
    }
    private positionScroll(scroll: ScrollView, x: number, y: number, width: number, height: number): void {
        place(scroll.node, x, y, width, height); place(scroll.content.parent, 0, 0, width, height);
    }
    private queueRender(): void {
        if (!this.panel || this.queued || !this.node.activeInHierarchy) return;
        this.queued = true; this.scheduleOnce(this.flushRender, 0);
    }
    private flushRender(): void { this.queued = false; if (this.node.activeInHierarchy) this.render(); }
    private render(): void {
        const c = BattleCommand.getInstance(), m = this.metrics, rows = c.getReports(this.category);
        const status = this.panel.getChildByName('Status').getComponent(Label);
        status.string = !c.sessionReady ? '连接已断开，等待重新连接' : c.loadError || (c.loading ? '正在同步战报…'
            : `${c.getReports().length} 份战报 · ${c.unreadCount ? `${c.unreadCount} 份未读` : '全部已读'}`);
        this.panel.getChildByName('ReadAll').getComponent(Button).interactable = c.sessionReady && c.unreadCount > 0 && !c.requestInFlight(S.c2s_read_report);
        if (this.selected && !rows.some(r => String(r.reportId) === this.selected)) this.selected = '';
        this.list.node.active = !m.narrow || !this.selected;
        this.detail.node.active = !m.narrow || !!this.selected;
        this.panel.getChildByName('Back').active = m.narrow && !!this.selected;
        const used = new Set(rows.map(r => String(r.reportId))), width = m.listWidth;
        for (const node of this.list.content.children.slice()) if (!used.has(node.name)) { node.removeFromParent(); node.destroy(); }
        rows.forEach((r, i) => {
            const id = String(r.reportId), cell = this.list.content.getChildByName(id) || this.button(this.list.content, id, () => this.select(id));
            place(cell, 0, -49 - i * 108, width, 100);
            inkSurface(cell, 'Surface', width, 100, id === this.selected ? new Color(63, 60, 43) : C.panel, id === this.selected ? C.gold : C.line);
            caption(cell, 'Result', reportResult(r.result), -width / 2 + 42, 24, 52, 19, r.result === 1 ? WIN : LOSS).isBold = true;
            caption(cell, 'Kind', reportKind(r), 32, 24, width - 112, 16);
            caption(cell, 'Time', reportTime(r.time), 0, -8, width - 32, 12, C.muted);
            caption(cell, 'Position', `战场 (${r.pos?.x ?? '—'}, ${r.pos?.y ?? '—'})`, -24, -32, width - 80, 13, C.muted);
            caption(cell, 'Read', r.isRead ? '已读' : '未读', width / 2 - 36, -32, 44, 12, r.isRead ? C.muted : C.gold, Label.HorizontalAlign.RIGHT);
            let dot = cell.getChildByName('Unread');
            if (!dot) { dot = this.nodeAt(cell, 'Unread'); const g = dot.addComponent(Graphics); g.fillColor = new Color(205, 62, 48); g.circle(0, 0, 4); g.fill(); }
            dot.setPosition(width / 2 - 14, 34); dot.active = !r.isRead;
        });
        this.contentHeight(this.list, Math.max(m.bodyHeight, rows.length * 108 - 8), width, false);
        const empty = this.list.node.getChildByName('Empty'); empty.active = !rows.length;
        place(empty, 0, 0, width - 32, 100);
        const emptyLabel = empty.getComponent(Label); emptyLabel.enableWrapText = true;
        emptyLabel.string = c.loading ? '正在读取战报…' : c.loadError || (!c.loaded ? '等待战报同步' : '暂无战报\n战斗结束后会在这里留下记录');
        this.renderDetail();
    }
    private select(id: number | string): void {
        this.selected = String(id); this.page = 'summary'; this.detailKey = ''; this.detailLocation = '';
        const c = BattleCommand.getInstance(), info = c.details.get(this.selected);
        if (info) this.onDetail(info);
        else c.requestDetail(id);
        this.render();
    }
    private onDetail(info: ReportInfo): void {
        if (String(info.brief.reportId) !== this.selected || !this.node.activeInHierarchy) return;
        // 成功取得正在查看的详情后才发已读；红点等服务器确认后消除。
        if (!info.brief.isRead) BattleCommand.getInstance().readReports([info.brief.reportId]);
        this.queueRender();
    }
    private contentHeight(scroll: ScrollView, height: number, width: number, reset: boolean): void {
        const viewportH = scroll.node.getComponent(UITransform).height;
        const offset = reset ? 0 : Math.max(0, scroll.getScrollOffset().y);
        scroll.stopAutoScroll();
        scroll.content.getComponent(UITransform).setContentSize(width, Math.max(viewportH, height));
        scroll.content.setPosition(0, viewportH / 2 + Math.min(offset, Math.max(0, height - viewportH)));
    }
    private text(parent: Node, name: string, value: string, y: number, width: number, size = 15, color = C.text): number {
        const label = caption(parent, name, value, 0, y, width, size, color);
        label.enableWrapText = true; label.overflow = Label.Overflow.RESIZE_HEIGHT;
        label.lineHeight = Math.ceil(size * 1.55); label.verticalAlign = Label.VerticalAlign.TOP;
        label.updateRenderData(true);
        const height = Math.max(label.lineHeight, label.node.getComponent(UITransform).height);
        label.node.setPosition(0, y - height / 2); return height;
    }
    private renderDetail(): void {
        const c = BattleCommand.getInstance(), brief = c.reports.get(this.selected), info = c.details.get(this.selected);
        const replay = c.replays.get(this.selected) || info?.replay;
        const detailPending = c.requestInFlight(`detail:${this.selected}`), replayPending = c.requestInFlight(`replay:${this.selected}`);
        const m = this.metrics, width = m.detailWidth;
        const key = JSON.stringify([width, m.bodyHeight, this.selected, this.page, info, replay, detailPending, replayPending, c.sessionReady]);
        if (key === this.detailKey) return;
        const location = `${width}:${m.bodyHeight}:${this.selected}:${this.page}`, reset = location !== this.detailLocation;
        this.detailKey = key; this.detailLocation = location;
        for (const node of this.detail.content.children.slice()) { node.removeFromParent(); node.destroy(); }
        const root = this.detail.content;
        inkSurface(this.detail.node, 'Surface', width, m.bodyHeight, C.inset, C.line);
        let y = -18;
        if (!brief) {
            this.text(root, 'Prompt', '战场纪事', -m.bodyHeight / 2 + 36, width - 40, 24, C.gold);
            this.text(root, 'Hint', '选择一份战报，查看交战双方与战斗详情', -m.bodyHeight / 2 - 8, width - 40, 14, C.muted);
        } else {
            const title = caption(root, 'Result', `${reportResult(brief.result)} · ${reportKind(brief)}`, 0, y - 16, width - 36, 23, brief.result === 1 ? WIN : LOSS);
            title.overflow = Label.Overflow.SHRINK; y -= 38;
            const dateWidth=width-176;
            caption(root, 'Date', reportTime(brief.time), -width/2+18+dateWidth/2, y-14, dateWidth, 13, C.muted);
            const hasPosition=Number.isFinite(brief.pos?.x)&&Number.isFinite(brief.pos?.y);
            const coordinates=this.button(root,'Coordinates',()=>{
                if(!hasPosition)return;
                this.close();EventMgr.emit(E.scrollToMap,brief.pos.x,brief.pos.y);
            });
            place(coordinates,width/2-82,y-14,128,32);
            const link=caption(coordinates,'CoordinateText',hasPosition?`(${brief.pos.x}, ${brief.pos.y})`:'坐标未知',
                0,0,128,14,hasPosition?C.gold:C.muted,Label.HorizontalAlign.RIGHT);
            link.isUnderline=hasPosition;link.overflow=Label.Overflow.SHRINK;
            const coordinateButton=coordinates.getComponent(Button);coordinateButton.interactable=hasPosition;
            coordinateButton.target=link.node;coordinateButton.transition=Button.Transition.SCALE;
            coordinateButton.zoomScale=.96;coordinateButton.duration=.08;
            if(hasPosition){
                coordinates.on(Node.EventType.MOUSE_ENTER,()=>link.color=C.text);
                coordinates.on(Node.EventType.MOUSE_LEAVE,()=>link.color=C.gold);
            }
            y -= 36;
            if (!info) {
                y -= this.text(root, 'Loading', detailPending ? '正在加载战报详情…' : '详情暂未加载，请重试', y, width - 36, 15, C.muted) + 16;
                if (!detailPending) {
                    const retry = this.button(root, 'Retry', () => c.requestDetail(this.selected));
                    panelButton(retry, '重新加载', 0, y - 20, 128, 38, true); y -= 56;
                }
            } else {
                ['summary', 'replay'].forEach((page, i) => {
                    const tab = this.button(root, page, () => {
                        this.page = page as 'summary' | 'replay'; this.detailKey = '';
                        if (page === 'replay' && !replay) c.requestReplay(this.selected);
                        this.renderDetail();
                    });
                    panelButton(tab, i ? '回合回放' : '战况总览', (i - .5) * (width - 30) / 2, y - 17, (width - 38) / 2, 34, this.page === page);
                });
                y -= 46;
                if (this.page === 'summary') y = this.summary(root, info, y, width);
                else if (replay) {
                    const stage=this.nodeAt(root,'ReplayStage'),player=stage.addComponent(BattleReplayView);
                    const openBattlefield=BattleReplayPaintedView.supports(info)?()=>{
                        player.pause();AudioManager.instance.playClick();BattleReplayPaintedView.open(this.safe,info,replay);
                    }:undefined;
                    const height=player.initialize(info,replay,width-24,m.bodyHeight+y-18,openBattlefield);
                    stage.setPosition(0,y-height/2);y-=height;
                } else {
                    y -= this.text(root, 'ReplayLoading', replayPending ? '正在加载回合记录…' : '回合记录暂未加载', y, width - 36, 15, C.muted) + 14;
                    if (!replayPending) {
                        const retry = this.button(root, 'RetryReplay', () => c.requestReplay(this.selected));
                        panelButton(retry, '重新加载', 0, y - 20, 128, 38); y -= 56;
                    }
                }
            }
        }
        this.contentHeight(this.detail, -y + 18, width, reset);
    }
    private summary(root: Node, info: ReportInfo, y: number, width: number): number {
        const sides = [info.atkSide, info.defSide], stacked = width < 480;
        const cardWidth = stacked ? width - 32 : (width - 48) / 2;
        const maxUnits = Math.max(...sides.map(side => side?.units?.length || 0));
        const cardHeight = 116 + maxUnits * 46;
        sides.forEach((side, i) => {
            const card = this.nodeAt(root, `SideCard${i}`);
            place(card, stacked ? 0 : (i - .5) * (cardWidth + 16),
                y - cardHeight / 2 - (stacked ? i * (cardHeight + 12) : 0), cardWidth, cardHeight);
            inkSurface(card, 'Surface', cardWidth, cardHeight, new Color(39, 44, 35), C.line);
            const top = cardHeight / 2, stats = soldierTotals(side), tone = i ? LOSS : C.gold;
            caption(card, 'Side', i ? '守方' : '攻方', 0, top - 18, cardWidth - 24, 12, tone);
            const name = caption(card, 'Commander', side?.name || (i ? '守军' : '出征部队'), 0, top - 44, cardWidth - 24, 20, C.text);
            name.overflow = Label.Overflow.SHRINK;
            const wounded = (side?.units || []).reduce((sum, unit) => sum + Math.max(0, (unit.afterSoldier?.hurtCount || 0) - (unit.beforeSoldier?.hurtCount || 0)), 0);
            const values = stats ? [stats.after, wounded, stats.lost] : ['—', '—', '—'];
            ['剩余兵力', '本次负伤', '阵亡'].forEach((label, j) => {
                const x = (j - 1) * (cardWidth - 20) / 3;
                caption(card, `Value${j}`, String(values[j]), x, top - 74, (cardWidth - 20) / 3, 21, j === 0 ? WIN : j === 2 ? LOSS : C.text, Label.HorizontalAlign.CENTER);
                caption(card, `Stat${j}`, label, x, top - 96, (cardWidth - 20) / 3, 11, C.muted, Label.HorizontalAlign.CENTER);
            });
            (side?.units || []).forEach((unit, index) => {
                const row = this.nodeAt(card, `Unit${index}`), yy = top - 138 - index * 46;
                place(row, 0, yy, cardWidth - 24, 42);
                reportUnitArt(row, side, unit, -cardWidth / 2 + 32, 0, 36);
                const rowWidth = cardWidth - 78, xx = 20;
                const unitName = caption(row, 'Name', `${reportUnitName(side, unit)} · Lv.${unit.level || 1}`, xx, 9, rowWidth, 13);
                unitName.overflow = Label.Overflow.SHRINK;
                const amount = unit.afterSoldier?.count || 0, before = unit.beforeSoldier?.count || 0;
                caption(row, 'Count', `${before} → ${amount}`, xx, -10, rowWidth, 12, C.muted);
            });
        });
        y -= (cardHeight + 12) * (stacked ? 2 : 1);
        y -= this.text(root, 'RewardsTitle', '战斗奖励', y, width - 36, 18, C.gold) + 12;
        if (!info.rewardList?.length) y -= this.text(root, 'NoRewards', '本次战斗无奖励', y, width - 36, 14, C.muted);
        else {
            const columns = Math.max(1, Math.floor((width - 36) / 148)), cellWidth = (width - 36) / columns;
            info.rewardList.forEach((reward, i) => {
                const cell = this.nodeAt(root, `Reward${i}`), x = -width / 2 + 18 + cellWidth / 2 + (i % columns) * cellWidth;
                place(cell, x, y - 25 - Math.floor(i / columns) * 58, cellWidth - 6, 50);
                const frame = InventoryIconCache.get(reward.itemId);
                if (frame) {
                    const icon = this.nodeAt(cell, 'Icon'), sprite = icon.addComponent(Sprite);
                    sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.spriteFrame = frame;
                    const rect = frame.originalSize, scale = 36 / Math.max(rect.width, rect.height);
                    place(icon, -cellWidth / 2 + 22, 0, rect.width * scale, rect.height * scale);
                }
                caption(cell, 'Name', itemName(reward.itemId), 20, 10, cellWidth - 48, 12, C.muted);
                caption(cell, 'Amount', `×${Number(reward.itemCount || 0).toLocaleString()}`, 20, -10, cellWidth - 48, 15);
            });
            y -= Math.ceil(info.rewardList.length / columns) * 58;
        }
        return y;
    }
}
