import { _decorator, BlockInputEvents, Button, Color, Component, Label, Mask, Node,
    SafeArea, ScrollView, Sprite, UITransform, Widget } from 'cc';
import BattleCommand, { ReportInfo } from '../../battle/BattleCommand';
import { reportKind, reportLayout, reportResult, reportTime } from '../../battle/ReportPresentation';
import { ServerConfig as S } from '../../config/ServerConfig';
import { LogicEvent as E } from '../../common/LogicEvent';
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { itemGlyph, itemName } from '../../common/ItemPresentation';
import InventoryIconCache from '../../inventory/InventoryIconCache';
import BattleReplayView from './BattleReplayView';
import BattleReplayPaintedView from './BattleReplayPaintedView';
import { battleReportOverview } from './BattleReportSummaryView';
import { reportDispatchCard, reportEmptyState, reportFilters, reportReadAll, reportWindowFrame } from './BattleReportFrameView';
import { caption, inkSurface, ManagementColors as C, panelButton, place } from './ManagementStyle';
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

    /** 提前构建首开界面；不会切频道、发送消息或请求战报。 */
    public prepareView(): void {
        if (!this.panel) this.build();
        this.node.getComponent(Widget).updateAlignment();
        this.safe.getComponent(Widget).updateAlignment();
        this.safe.getComponent(SafeArea).updateArea();
        this.layout();
    }

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
        reportWindowFrame(this.panel, m.width, m.height);
        place(this.tabs, 0, top - m.filterCenter, m.contentWidth, m.filterHeight);
        reportFilters(this.tabs, m.contentWidth, FILTERS, this.category);
        const bodyY = top - m.bodyTop - m.bodyHeight / 2;
        this.positionScroll(this.list, m.narrow ? 0 : left + m.inset + m.listWidth / 2, bodyY, m.listWidth, m.bodyHeight);
        this.positionScroll(this.detail, m.narrow ? 0 : m.width / 2 - m.inset - m.detailWidth / 2, bodyY, m.detailWidth, m.bodyHeight);
        reportReadAll(this.panel.getChildByName('ReadAll'), m.width / 2 - m.inset - 65, -top + 24);
        panelButton(this.panel.getChildByName('Back'), '返回列表', left + m.inset + 52, -top + 24, 104, 28);
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
            : `${c.getReports().length} 封${c.unreadCount ? ` · ${c.unreadCount} 未读` : ''}`);
        this.panel.getChildByName('ReadAll').getComponent(Button).interactable = c.sessionReady && c.unreadCount > 0 && !c.requestInFlight(S.c2s_read_report);
        this.panel.getChildByName('ReadAll').active = c.unreadCount > 0;
        if (this.selected && !rows.some(r => String(r.reportId) === this.selected)) this.selected = '';
        this.list.node.active = !m.narrow || !this.selected;
        this.detail.node.active = !m.narrow || !!this.selected;
        this.panel.getChildByName('Back').active = m.narrow && !!this.selected;
        const used = new Set(rows.map(r => String(r.reportId))), width = m.listWidth;
        for (const node of this.list.content.children.slice()) if (!used.has(node.name)) { node.removeFromParent(); node.destroy(); }
        rows.forEach((r, i) => {
            const id = String(r.reportId), cell = this.list.content.getChildByName(id) || this.button(this.list.content, id, () => this.select(id));
            place(cell, 0, -50 - i * 112, width, 100);
            reportDispatchCard(cell, r, width, id === this.selected);
        });
        this.contentHeight(this.list, Math.max(m.bodyHeight, rows.length * 112 - 12), width, false);
        const empty = this.list.node.getChildByName('Empty'); empty.active = !rows.length && !m.narrow;
        place(empty, 0, 0, width - 32, 100);
        const emptyLabel = empty.getComponent(Label); emptyLabel.enableWrapText = true;
        emptyLabel.string = !c.sessionReady ? '等待重新连接' : c.loading ? '正在读取战报…' : c.loadError || (!c.loaded ? '等待战报同步' : '暂无军报');
        const emptyArt = this.list.node.getChildByName('ReportEmptyState'); if (emptyArt) emptyArt.active = !rows.length && m.narrow;
        if (!rows.length && m.narrow) reportEmptyState(this.list.node, width, m.bodyHeight, m.bodyHeight / 2, emptyLabel.string);
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
        if(BattleReplayPaintedView.supports(info))void BattleReplayPaintedView.prepare().catch(()=>undefined);
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
    private text(parent: Node, name: string, value: string, y: number, width: number, size = 15, color = C.text,
        align = Label.HorizontalAlign.LEFT): number {
        const label = caption(parent, name, value, 0, y, width, size, color, align);
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
        const key = JSON.stringify([width, m.bodyHeight, this.selected, this.category, this.page, info, replay, detailPending, replayPending,
            c.sessionReady, c.loading, c.loadError, c.getReports(this.category).length]);
        if (key === this.detailKey) return;
        const location = `${width}:${m.bodyHeight}:${this.selected}:${this.page}`, reset = location !== this.detailLocation;
        this.detailKey = key; this.detailLocation = location;
        for (const node of this.detail.content.children.slice()) { node.removeFromParent(); node.destroy(); }
        const root = this.detail.content;
        inkSurface(this.detail.node, 'Surface', width, m.bodyHeight, C.inset, C.line);
        let y = -8;
        if (!brief) {
            reportEmptyState(root, width, m.bodyHeight, 0, c.getReports(this.category).length ? '点选左侧军报' : '战斗结束后收录军报');
        } else {
            const dateWidth=width-176;
            caption(root, 'Date', reportTime(brief.time), -width/2+18+dateWidth/2, y-12, dateWidth, 12, C.muted);
            const hasPosition=Number.isFinite(brief.pos?.x)&&Number.isFinite(brief.pos?.y);
            const coordinates=this.button(root,'Coordinates',()=>{
                if(!hasPosition)return;
                this.close();EventMgr.emit(E.scrollToMap,brief.pos.x,brief.pos.y);
            });
            place(coordinates,width/2-82,y-12,128,28);
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
            y -= 28;
            if (!info) {
                const title = caption(root, 'Result', `${reportResult(brief.result)} · ${reportKind(brief)}`,
                    0, y - 16, width - 36, 23, brief.result === 1 ? WIN : LOSS);
                title.overflow = Label.Overflow.SHRINK; y -= 38;
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
                y -= 40;
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
        y -= battleReportOverview(root, info, y, width);
        return this.rewardTray(root, info.rewardList || [], y, width);
    }
    private rewardTray(root: Node, rewards: ReportInfo['rewardList'], y: number, width: number): number {
        const trayWidth = width - 32, cellWidth = 72, gap = 12, rowHeight = 66;
        const columns = Math.max(1, Math.floor((trayWidth - 24 + gap) / (cellWidth + gap)));
        const height = rewards.length ? 22 + Math.ceil(rewards.length / columns) * rowHeight : 52;
        const tray = this.nodeAt(root, 'BattleRewards');
        place(tray, 0, y - height / 2, trayWidth, height);
        const top = height / 2;
        const surface = inkSurface(tray, 'Surface', trayWidth, height, new Color(35, 38, 30), C.line);
        const heading = caption(tray, 'Title', '战利品', 0, top - 12, 100, 13, C.gold, Label.HorizontalAlign.CENTER);
        place(heading.node, 0, top - 12, 100, 20);
        surface.strokeColor = C.line; surface.lineWidth = 1;
        surface.moveTo(-trayWidth / 2 + 16, top - 12); surface.lineTo(-42, top - 12);
        surface.moveTo(42, top - 12); surface.lineTo(trayWidth / 2 - 16, top - 12); surface.stroke();
        if (!rewards.length) caption(tray, 'Empty', '本次战斗无奖励', 0, top - 35, trayWidth - 32, 12, C.muted, Label.HorizontalAlign.CENTER);
        rewards.forEach((reward, index) => {
            const row = Math.floor(index / columns), column = index % columns;
            const rowCount = Math.min(columns, rewards.length - row * columns);
            const cell = this.nodeAt(tray, `Reward${index}`);
            place(cell, (column - (rowCount - 1) / 2) * (cellWidth + gap), top - 44 - row * rowHeight, cellWidth, rowHeight);
            const rim = inkSurface(cell, 'ItemFrame', 44, 44, new Color(24, 28, 22), new Color(152, 127, 76));
            // 双层铜边与四角短线沿用战报配色，不表达不存在的道具稀有度。
            rim.strokeColor = new Color(86, 78, 52); rim.rect(-19, -19, 38, 38); rim.stroke();
            rim.strokeColor = C.gold; rim.lineWidth = 2;
            for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
                rim.moveTo(sx * 15, sy * 21); rim.lineTo(sx * 21, sy * 21); rim.lineTo(sx * 21, sy * 15);
            }
            rim.stroke();
            const glyph = caption(cell, 'Glyph', itemGlyph(reward.itemId), 0, 3, 34, 23, C.gold, Label.HorizontalAlign.CENTER);
            const icon = this.nodeAt(cell, 'Icon'), sprite = icon.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM; icon.active = false;
            const applyIcon = (frame: ReturnType<typeof InventoryIconCache.get>) => {
                if (!frame || !icon.isValid) return;
                const rect = frame.originalSize, scale = 36 / Math.max(1, rect.width, rect.height);
                sprite.spriteFrame = frame; place(icon, 0, 3, rect.width * scale, rect.height * scale);
                icon.active = true; glyph.node.active = false;
            };
            const frame = InventoryIconCache.get(reward.itemId);
            if (frame) applyIcon(frame); else void InventoryIconCache.load(reward.itemId).then(applyIcon);
            const count = caption(cell, 'Amount', String(Number(reward.itemCount) || 0), -1, -13, 38, 13, C.text, Label.HorizontalAlign.RIGHT);
            place(count.node, -1, -13, 38, 18);
            count.isBold = true; count.overflow = Label.Overflow.SHRINK;
            count.outlineColor = new Color(13, 17, 12); count.outlineWidth = 2;
            const name = caption(cell, 'Name', itemName(reward.itemId), 0, -32, cellWidth, 11, C.text, Label.HorizontalAlign.CENTER);
            place(name.node, 0, -32, cellWidth, 18);
            name.overflow = Label.Overflow.SHRINK;
        });
        return y - height;
    }
}
