import { _decorator, BlockInputEvents, Button, Canvas, Color, Component, EditBox, Graphics,
    Label, Layers, Mask, Node, SafeArea, Sprite, SpriteFrame, UIOpacity, UITransform, Widget,
    director, resources, view } from 'cc';
import LotteryCommand, { LotteryResult } from '../general/LotteryCommand';
import LoginCommand from '../login/LoginCommand';
import ConfigManager from '../core/ConfigManager';
import { getGeneralPortraitPath } from '../general/GeneralPortrait';
import HeroPortraitMotion from '../general/HeroPortraitMotion';
import { skipsLotteryAnimation } from './LotteryAnimationSettings';
import { itemGlyph, itemIconPath, itemName } from '../common/ItemPresentation';
import { LogicEvent } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';
import { caption, inkSurface, ManagementColors as C, panelButton, place } from '../map/ui/ManagementStyle';
import { LotteryRewardEntry, lotteryRewardEntries, lotteryResultLayout, lotteryQualityStyle } from './LotteryRewardPresentation';

const { ccclass } = _decorator;
const GOLD = new Color(239, 198, 113), BRIGHT = new Color(255, 232, 178);
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (v: number) => 1 - Math.pow(1 - clamp(v), 3);
const rgb = (v: number[], alpha = 255) => new Color(v[0], v[1], v[2], alpha);
interface RewardCardView { node: Node; icon: Sprite; fallback: Label; tag: Label; name: Label; count: Label; }

/** 展示服务端点将奖励；继续点将复用命令的扣费和防重保护，演出不更改背包。 */
@ccclass('LotteryRewardWindow')
export default class LotteryRewardWindow extends Component {
    private static current: LotteryRewardWindow | null = null;

    public static show(result: LotteryResult): void {
        if (!result?.rewards?.length) return;
        if (this.current?.isValid) { this.current.acceptResult(result); return; }
        const scene = director.getScene(), canvas = scene?.getComponentInChildren(Canvas);
        if (!canvas) return;
        for (const box of scene.getComponentsInChildren(EditBox)) if (box.isFocused()) box.blur();
        const node = new Node('LotteryRewardOverlay');
        node.layer = canvas.node.getChildByName('MapUIScene')?.layer || Layers.Enum.UI_3D;
        canvas.node.addChild(node);
        const logic = node.addComponent(LotteryRewardWindow);
        this.current = logic;
        logic.showResult(result);
    }

    private queue: LotteryResult[] = [];
    private continuation: { count: number; total: number } | null = null;
    private result: LotteryResult;
    private entries: LotteryRewardEntry[] = [];
    private featured: LotteryRewardEntry[] = [];
    private featuredIndex = 0;
    private phase: 'hero' | 'results' = 'results';
    private clock = 0;
    private generation = 0;
    private page = 0;
    private layoutQueued = false;
    private metrics = lotteryResultLayout(1280, 720);
    private safe: Node;
    private panel: Node;
    private shade: Graphics;
    private title: Label;
    private subtitle: Label;
    private qualityLegend: Node;
    private portraitMotion: HeroPortraitMotion;
    private heroReady = true;
    private heroLoadClock = 0;
    private closeButton: Node;
    private nextBatch: Node;
    private repeatActions: Array<{ count: number; node: Node; cost: Label }> = [];
    private repeatBalance: Label;
    private repeatStatus: Label;
    private feedbackWaiting = false;
    private feedbackElapsed = 0;
    private retryInfo: Node;
    private previous: Node;
    private next: Node;
    private pagination: Label;
    private grid: Node;
    private cells: Node[] = [];
    private cardViews: RewardCardView[] = [];
    private displayedEntries: LotteryRewardEntry[] = [];
    private displayedStart = 0;
    private displayedFrames: Array<SpriteFrame | null> = [];
    private gridSignature = '';
    private requestedGridSignature = '';
    private gridToken = 0;
    private gridLoading = false;
    private gridVisible = false;
    private gridFade = -1;
    private frames = new Map<string, SpriteFrame | null>();
    private frameLoads = new Map<string, Array<(frame: SpriteFrame | null) => void>>();
    private stage: Node;
    private aura: Node;
    private rays: Sprite;
    private motes: Graphics;
    private portrait: Sprite;
    private heroFrame: Node;
    private seal: Label;
    private heroName: Label;
    private heroInfo: Label;
    private starNodes: Node[] = [];

    protected onLoad(): void {
        this.node.addComponent(UITransform);
        this.stretch(this.node);
        this.node.addComponent(BlockInputEvents);
        this.shade = this.make('Backdrop', this.node).addComponent(Graphics);
        this.safe = this.make('SafeContent', this.node); this.stretch(this.safe); this.safe.addComponent(SafeArea);
        this.panel = this.make('LotteryResults', this.safe);
        this.panel.addComponent(BlockInputEvents);
        this.title = this.label(this.panel, 'Title', '', 30, C.text);
        this.subtitle = this.label(this.panel, 'Subtitle', '', 14, C.muted);
        this.qualityLegend = this.make('QualityLegend', this.panel);
        for (let quality = 1; quality <= 5; quality++) {
            const style = lotteryQualityStyle(quality);
            this.label(this.qualityLegend, 'Quality_' + quality, '◆ ' + style.name, 12, rgb(style.accent));
        }
        this.grid = this.make('RewardGrid', this.panel);
        this.grid.getComponent(UIOpacity).opacity = 0;
        this.stage = this.make('FiveStarStage', this.panel);
        this.stage.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        this.aura = this.make('GoldenAura', this.stage);
        const halo = this.sprite('Glow', this.aura);
        halo.color = new Color(255, 197, 83, 155);
        this.load(halo, 'ui/system_unlock/glow_gold/spriteFrame');
        this.rays = this.sprite('Rays', this.aura); this.rays.color = new Color(244, 191, 96, 110);
        this.load(this.rays, 'ui/system_unlock/rays_gold/spriteFrame');
        this.heroFrame = this.make('HeroBanner', this.stage);
        this.portrait = this.sprite('HeroPortrait', this.heroFrame);
        this.portraitMotion = new HeroPortraitMotion(this.portrait);
        this.motes = this.make('GoldenMotes', this.stage).addComponent(Graphics);
        this.seal = this.label(this.heroFrame, 'PortraitFallback', '将', 74, GOLD);
        this.heroName = this.label(this.stage, 'HeroName', '', 40, BRIGHT);
        this.heroInfo = this.label(this.stage, 'HeroInfo', '', 16, C.muted);
        for (let i = 0; i < 5; i++) this.starNodes.push(this.label(this.stage, 'Star' + i, '★', 26, GOLD).node);
        this.closeButton = this.button('LotteryClose', () => this.close());
        this.nextBatch = this.button('LotteryNextBatch', () => this.showNextBatch());
        for (const count of [1, 10]) this.repeatActions.push({ count,
            node: this.button('LotteryRepeat_' + count, () => this.repeatDraw(count)),
            cost: this.label(this.panel, 'LotteryRepeatCost_' + count, '', 12, C.muted) });
        this.repeatBalance = this.label(this.panel, 'LotteryRepeatBalance', '', 13, C.muted);
        this.repeatStatus = this.label(this.panel, 'LotteryRepeatStatus', '', 13, C.muted);
        this.retryInfo = this.button('LotteryRetryInfo', () => LotteryCommand.getInstance().requestInfo());
        this.previous = this.button('LotteryPrevious', () => this.turnPage(-1));
        this.next = this.button('LotteryNext', () => this.turnPage(1));
        this.pagination = this.label(this.panel, 'Page', '', 13, C.muted);
        this.node.on(Node.EventType.SIZE_CHANGED, this.queueLayout, this);
        this.safe.on(Node.EventType.SIZE_CHANGED, this.queueLayout, this);
        view.on('canvas-resize', this.queueLayout, this);
        view.on('design-resolution-changed', this.queueLayout, this);
        EventMgr.on(LogicEvent.enterLogin, this.dispose, this);
        for (const event of [LogicEvent.lotteryChanged, LogicEvent.upateMyRoleRes, LogicEvent.updateInventory]) {
            EventMgr.on(event, this.refreshActions, this);
        }
    }

    private acceptResult(result: LotteryResult): void {
        if (this.continuation?.count === result.count && this.continuation.total === result.lotteryTimes) {
            this.showResult(result);
        } else {
            this.queue.push(result);
            this.refreshActions();
        }
    }

    private showResult(result: LotteryResult): void {
        this.continuation = null;
        this.gridToken++; this.requestedGridSignature = ''; this.gridLoading = false;
        this.generation++;
        this.portraitMotion?.reset();
        this.result = result;
        this.entries = lotteryRewardEntries(result.rewards, ConfigManager.getInstance().getConfig('Hero'), ConfigManager.getInstance().getConfig('Item'));
        this.featured = this.entries.filter(entry => entry.fiveStar);
        this.featuredIndex = 0; this.page = 0; this.clock = 0;
        this.phase = this.featured.length && !skipsLotteryAnimation() ? 'hero' : 'results';
        // 演出期间预热所有奖励图标，翻页和跳过时可直接使用缓存。
        this.entries.forEach(entry => this.requestFrame(this.entryIconPath(entry), () => {}));
        if (this.phase === 'hero') {
            this.gridVisible = false; this.gridFade = -1;
            if (this.grid) this.grid.getComponent(UIOpacity).opacity = 0;
        }
        if (this.phase === 'hero') this.showHero();
        this.layout();
        this.queueLayout();
    }

    private showHero(): void {
        const entry = this.featured[this.featuredIndex], token = ++this.generation;
        this.clock = 0; this.heroLoadClock = 0; this.heroReady = false;
        this.portraitMotion.reset();
        this.portrait.spriteFrame = null; this.seal.node.active = true;
        this.heroName.string = entry.hero.name;
        this.heroInfo.string = [entry.hero.Camp, entry.hero.Class].filter(Boolean).join(' · ');
        const path = getGeneralPortraitPath(entry.hero.Icon);
        const current = () => this.isValid && token === this.generation && this.phase === 'hero';
        const ready = () => { if (current()) { this.fitPortrait(); this.heroReady = true; this.clock = 0; } };
        this.requestFrame(path, frame => {
            if (!current()) return;
            if (!frame) { ready(); return; }
            this.portrait.spriteFrame = frame; this.seal.node.active = false;
            this.fitPortrait();
            this.portraitMotion.attach(frame).then(ready, ready);
        });
    }

    /** 跳过只切到本次全部结果，后到的贴图不会重启演出。 */
    public skipAnimation(): void {
        if (this.phase !== 'hero') return;
        this.generation++; this.phase = 'results'; this.clock = 10;
        this.portraitMotion?.reset();
        this.layout();
    }

    protected update(dt: number): void {
        const step = Math.min(dt, .1);
        if (this.phase === 'hero' && !this.heroReady) {
            this.heroLoadClock += step;
            // 极慢或失败的资源不让奖励页永久卡住，右上角始终可以关闭。
            if (this.heroLoadClock < 6) return;
            this.generation++; this.portraitMotion?.reset(); this.heroReady = true; this.clock = 0;
        }
        this.clock += step;
        if (this.phase === 'results' && this.feedbackWaiting && this.feedbackElapsed < .35) {
            this.feedbackElapsed += Math.min(dt, .1);
            if (this.feedbackElapsed >= .35) this.refreshActions();
        }
        if (this.phase === 'hero') {
            this.animateHero();
            if (this.clock >= 4.6) {
                this.featuredIndex++;
                if (this.featuredIndex < this.featured.length) { this.showHero(); this.layout(); }
                else { this.generation++; this.portraitMotion?.reset(); this.phase = 'results'; this.clock = 0; this.layout(); }
            }
        } else if (this.grid && this.gridFade >= 0) {
            this.gridFade += Math.min(dt, .1);
            this.grid.getComponent(UIOpacity).opacity = Math.round(255 * ease(this.gridFade / .18));
            if (this.gridFade >= .18) this.gridFade = -1;
        }
    }

    private animateHero(): void {
        const t = this.clock, reveal = ease((t - .12) / .85);
        this.heroFrame.getComponent(UIOpacity).opacity = Math.round(reveal * 255);
        this.heroFrame.setScale(.965 + reveal * .035, .965 + reveal * .035, 1);
        this.portraitMotion?.update(t);
        this.animateMotes(t);
        const opening = ease(t / 1.1);
        this.aura.setScale(.88 + opening * .12, .88 + opening * .12, 1);
        this.aura.getComponent(UIOpacity).opacity = Math.round(opening * (145 + Math.sin(t * 1.4) * 15));
        this.rays.node.angle = t * 5;
        this.heroName.node.getComponent(UIOpacity).opacity = Math.round(ease((t - .55) / .6) * 255);
        this.heroInfo.node.getComponent(UIOpacity).opacity = Math.round(ease((t - 1.15) / .5) * 255);
        this.starNodes.forEach((node, i) => {
            const p = ease((t - 1.05 - i * .13) / .4);
            node.getComponent(UIOpacity).opacity = Math.round(p * 255);
            node.setScale(1.2 - p * .2, 1.2 - p * .2, 1);
        });
    }

    private animateMotes(t: number): void {
        if (!this.motes) return;
        const g = this.motes, bounds = this.heroFrame.getComponent(UITransform);
        const x = this.heroFrame.position.x, y = this.heroFrame.position.y;
        g.clear();
        for (let i = 0; i < 9; i++) {
            const progress = (t * (.11 + (i % 3) * .013) + i * .113) % 1;
            const fade = Math.sin(progress * Math.PI) * ease(t / .8);
            const side = i % 2 ? 1 : -1;
            const px = x + side * bounds.width * (.49 + .10 * Math.sin(i * 2.3)) + Math.sin(t * .6 + i) * 4;
            const py = y + (progress - .5) * bounds.height;
            g.fillColor = new Color(245, 205, 132, Math.round(110 * fade));
            g.circle(px, py, 1 + i % 3 * .35); g.fill();
        }
    }

    private queueLayout(): void {
        if (this.layoutQueued) return;
        this.layoutQueued = true;
        this.scheduleOnce(() => { this.layoutQueued = false; if (this.result) this.layout(); }, 0);
    }

    private layout(): void {
        if (!this.result) return;
        this.node.getComponent(Widget).updateAlignment();
        this.safe.getComponent(Widget).updateAlignment(); this.safe.getComponent(SafeArea).updateArea();
        const root = this.node.getComponent(UITransform), safe = this.safe.getComponent(UITransform);
        this.metrics = lotteryResultLayout(safe.width || root.width, safe.height || root.height);
        const { width: w, height: h, scale } = this.metrics, top = h / 2, bottom = -top;
        place(this.shade.node, 0, 0, root.width, root.height);
        this.shade.clear(); this.shade.fillColor = new Color(4, 9, 8, 215);
        this.shade.rect(-root.width / 2, -root.height / 2, root.width, root.height); this.shade.fill();
        place(this.panel, 0, 0, w, h); this.panel.setScale(scale, scale, 1);
        inkSurface(this.panel, 'Surface', w, h, new Color(21, 27, 25), new Color(180, 145, 82));
        const hero = this.phase === 'hero';
        this.title.string = hero ? '名将应召' : '点将所得';
        this.subtitle.string = hero ? '★ 五星名将 ★' + (this.featured.length > 1 ? `   ${this.featuredIndex + 1} / ${this.featured.length}` : '')
            : `点将 ${this.result.count} 次 · 获得 ${this.entries.length} 项奖励`;
        this.subtitle.color = hero ? GOLD : C.muted;
        place(this.title.node, 0, top - 35, w - 128, 44);
        place(this.subtitle.node, 0, top - 72, w - 36, 26);
        panelButton(this.closeButton, '', w / 2 - 30, top - 30, 44, 44, false, true);
        this.stage.active = hero;
        this.grid.active = !hero;
        place(this.stage, 0, 0, w - 24, h - 172);
        if (hero) this.layoutHero();
        else this.buildGrid();
        const actionWidth = Math.min(240, (w - 52) / 2), gap = 12;
        panelButton(this.nextBatch, '下一批奖励', 0, bottom + 60, actionWidth, 42);
        this.repeatActions.forEach((action, i) => {
            panelButton(action.node, action.count === 1 ? '再点一次' : '再点十次', (i - .5) * (actionWidth + gap), bottom + 60, actionWidth, 42, action.count === 10);
            place(action.cost.node, action.node.position.x, bottom + 22, actionWidth + 4, 24);
        });
        for (const node of [this.nextBatch, ...this.repeatActions.map(action => action.node)]) {
            const label = node.getComponentInChildren(Label);
            label.overflow = Label.Overflow.SHRINK;
            label.fontSize = w < 460 ? 14 : 16;
        }
        // 余额固定在左侧，过程提示独立放右侧，连抽或贴图加载不能替换余额。
        const footerX = (actionWidth + gap) / 2;
        place(this.repeatBalance.node, -footerX, bottom + 100, actionWidth, 26);
        place(this.repeatStatus.node, footerX, bottom + 100, actionWidth, 26);
        panelButton(this.retryInfo, '重新同步点将', footerX, bottom + 100, Math.min(140, actionWidth), 28);
        const pages = Math.max(1, Math.ceil(this.entries.length / this.metrics.pageSize));
        this.qualityLegend.active = !hero && pages === 1;
        const legendWidth = Math.min(390, w - 40), legendCell = legendWidth / 5;
        place(this.qualityLegend, 0, top - 101, legendWidth, 24);
        this.qualityLegend.children.forEach((node, i) => place(node, (i - 2) * legendCell, 0, legendCell, 24));
        this.previous.active = this.next.active = this.pagination.node.active = !hero && pages > 1;
        panelButton(this.previous, '上一页', -w / 2 + 72, top - 101, 94, 26);
        panelButton(this.next, '下一页', w / 2 - 72, top - 101, 94, 26);
        place(this.pagination.node, 0, top - 101, 80, 24);
        this.pagination.string = `${this.page + 1} / ${pages}`;
        this.previous.getComponent(Button).interactable = this.page > 0;
        this.next.getComponent(Button).interactable = this.page + 1 < pages;
        this.refreshActions();
    }

    private layoutHero(): void {
        const { width: w, height: h } = this.metrics, wide = w >= 620, stageH = h - 172;
        const ph = Math.min(wide ? 400 : 300, stageH - (wide ? 20 : 102));
        const pw = ph * .74, px = wide ? -w * .21 : 0, py = wide ? 0 : 43;
        place(this.heroFrame, px, py, pw, ph);
        inkSurface(this.heroFrame, 'BannerSurface', pw + 10, ph + 10, new Color(57, 44, 27), GOLD);
        place(this.portrait.node, 0, 0, pw, ph); this.fitPortrait();
        place(this.seal.node, 0, 0, pw, ph);
        place(this.aura, px, py, ph * 1.7, ph * 1.7);
        this.aura.children.forEach(node => place(node, 0, 0, ph * 1.9, ph * 1.9));
        const x = wide ? w * .22 : 0, nameY = wide ? 25 : -stageH / 2 + 75;
        place(this.heroName.node, x, nameY, wide ? w * .4 : w - 40, 54);
        this.heroName.fontSize = wide ? 42 : 30;
        place(this.heroInfo.node, x, wide ? -80 : -stageH / 2 + 16, wide ? w * .4 : w - 40, 24);
        this.starNodes.forEach((node, i) => place(node, x + (i - 2) * 34, wide ? -28 : -stageH / 2 + 34, 34, 38));
        this.animateHero();
    }

    private fitPortrait(): void {
        const frame = this.portrait.spriteFrame;
        if (!frame) return;
        const area = this.heroFrame.getComponent(UITransform), s = frame.originalSize;
        const fit = Math.min(area.width / s.width, area.height / s.height);
        this.portrait.node.getComponent(UITransform).setContentSize(s.width * fit, s.height * fit);
    }

    private buildGrid(): void {
        const { width: w, pageSize, areaHeight, gridY } = this.metrics;
        this.page = Math.min(this.page, Math.max(0, Math.ceil(this.entries.length / pageSize) - 1));
        place(this.grid, 0, gridY, w - 40, areaHeight);
        this.layoutGridCards();
        const list = this.entries.slice(this.page * pageSize, (this.page + 1) * pageSize);
        this.prepareGrid(list, `${this.result.id}:${this.result.lotteryTimes}:${this.page}:${pageSize}`, this.page * pageSize);
    }

    private entryIconPath(entry: LotteryRewardEntry): string {
        return entry.reward.rewardType === 3 ? getGeneralPortraitPath(entry.hero?.Icon)
            : entry.reward.rewardType === 4 ? '' : itemIconPath(entry.reward.itemId);
    }

    /** 旧页一直保留到新页图标全部就绪；重复布局不重建、不重播、不显示临时占位。 */
    private prepareGrid(list: LotteryRewardEntry[], signature: string, start: number): void {
        if (signature === this.gridSignature) {
            this.gridToken++; this.requestedGridSignature = ''; this.gridLoading = false;
            if (!this.gridVisible) { this.gridVisible = true; this.applyGrid(true); }
            return;
        }
        if (signature === this.requestedGridSignature) return;
        const token = ++this.gridToken;
        this.requestedGridSignature = signature; this.gridLoading = true;
        this.refreshActions();
        const frames: Array<SpriteFrame | null> = new Array(list.length);
        let remaining = list.length;
        const commit = () => {
            if (!this.isValid || token !== this.gridToken || this.phase !== 'results') return;
            const reveal = !this.gridVisible;
            this.displayedEntries = list; this.displayedFrames = frames; this.displayedStart = start;
            this.gridSignature = signature; this.requestedGridSignature = ''; this.gridLoading = false;
            this.gridVisible = true;
            this.applyGrid(reveal);
            this.refreshActions();
        };
        if (!remaining) { commit(); return; }
        list.forEach((entry, i) => this.requestFrame(this.entryIconPath(entry), frame => {
            frames[i] = frame;
            if (--remaining === 0) commit();
        }));
    }

    private applyGrid(reveal: boolean): void {
        this.displayedEntries.forEach((entry, i) => {
            let card = this.cardViews[i];
            if (!card) {
                const node = this.make('Reward_' + i, this.grid);
                card = { node, icon: this.sprite('Icon', node), fallback: this.label(node, 'Fallback', '', 30, GOLD),
                    tag: this.label(node, 'Type', '', 11, C.muted), name: this.label(node, 'Name', '', 14, C.text),
                    count: this.label(node, 'Count', '', 17, C.text) };
                this.cardViews.push(card);
            }
            card.node.name = 'Reward_' + (this.displayedStart + i);
            const isHero = entry.reward.rewardType === 3, frame = this.displayedFrames[i];
            card.icon.spriteFrame = frame; card.icon.node.active = !!frame;
            card.fallback.node.active = !frame;
            card.fallback.string = isHero ? '将' : itemGlyph(entry.reward.itemId);
            const quality = lotteryQualityStyle(entry.quality);
            card.tag.string = [quality.name, entry.category].filter(Boolean).join(' · ');
            card.tag.color = rgb(quality.accent);
            card.name.string = entry.hero?.name || (isHero ? '武将 ' + entry.reward.itemId : entry.reward.rewardType === 4 ? '兵力' : itemName(entry.reward.itemId));
            card.name.color = entry.quality >= 3 ? rgb(quality.accent) : C.text;
            card.count.string = '×' + entry.reward.itemCount.toLocaleString();
            card.count.color = entry.quality === 5 ? BRIGHT : C.text;
        });
        this.layoutGridCards();
        this.gridFade = reveal ? 0 : -1;
        this.grid.getComponent(UIOpacity).opacity = reveal ? 0 : 255;
    }

    private layoutGridCards(): void {
        const { width: w, columns, rows, pageSize, areaHeight } = this.metrics;
        const list = this.displayedEntries.slice(0, pageSize);
        const gap = 6;
        const cw = Math.floor(Math.min(164, (w - 48 - (columns - 1) * gap) / columns));
        const ch = Math.floor(Math.min(142, (areaHeight - gap * (rows - 1)) / rows));
        const rowCount = Math.ceil(list.length / columns);
        this.cells = [];
        this.cardViews.forEach((card, i) => card.node.active = i < list.length);
        list.forEach((entry, i) => {
            const card = this.cardViews[i];
            if (!card) return;
            const row = Math.floor(i / columns), col = i % columns;
            const rowWidth = Math.min(columns, list.length - row * columns) * (cw + gap) - gap;
            const cell = card.node; this.cells.push(cell);
            place(cell, -rowWidth / 2 + cw / 2 + col * (cw + gap), ((rowCount - 1) / 2 - row) * (ch + gap), cw, ch);
            const quality = lotteryQualityStyle(entry.quality), accent = quality.accent;
            const g = inkSurface(cell, 'Card', cw, ch, null, null);
            // 两个完整实心轮廓形成单层品质框，避免描边、侧亮条及角饰叠出接缝。
            const border = entry.quality >= 4 ? 2 : 1;
            const edge = accent.map((v, i) => Math.round(v * (entry.quality >= 4 ? .75 : .48) + quality.fill[i] * (entry.quality >= 4 ? .25 : .52)));
            g.fillColor = rgb(edge);
            g.roundRect(-cw / 2, -ch / 2, cw, ch, 4); g.fill();
            g.fillColor = rgb(quality.fill);
            g.roundRect(-cw / 2 + border, -ch / 2 + border, cw - border * 2, ch - border * 2, 4 - border); g.fill();
            const size = Math.min(68, cw - 28, ch - 72), s = card.icon.spriteFrame?.originalSize;
            const fit = s ? Math.min(size / s.width, size / s.height) : 1;
            place(card.icon.node, 0, 11, s ? s.width * fit : size, s ? s.height * fit : size);
            place(card.fallback.node, 0, 11, size, size);
            place(card.tag.node, 0, ch / 2 - 15, cw - 14, 20);
            card.tag.fontSize = 12;
            place(card.name.node, 0, -ch / 2 + 36, cw - 12, 24);
            place(card.count.node, 0, -ch / 2 + 14, cw - 12, 24);
        });
    }

    private turnPage(delta: number): void {
        this.page = Math.max(0, Math.min(Math.ceil(this.entries.length / this.metrics.pageSize) - 1, this.page + delta));
        this.clock = 10; this.layout();
    }
    private canRepeat(count: number): boolean {
        const cmd = LotteryCommand.getInstance(), bag = LoginCommand.getInstance().proxy;
        const option = cmd.options.find(option => option.count === count);
        return this.phase === 'results' && !this.gridLoading && !this.queue.length && cmd.canDraw && !!option
            && option.costs.every(cost => bag.getItemCount(cost.itemId) >= cost.count);
    }

    private repeatDraw(count: number): void {
        if (!this.canRepeat(count)) { this.refreshActions(); return; }
        const cmd = LotteryCommand.getInstance();
        // 回包到达前保留已获得的奖励；只替换这次主动续抽的对应结果。
        this.continuation = { count, total: cmd.lotteryTimes + count };
        if (!cmd.draw(count)) this.continuation = null;
        this.refreshActions();
    }

    private refreshActions(): void {
        if (!this.repeatStatus || !this.result || !this.isValid) return;
        const cmd = LotteryCommand.getInstance(), bag = LoginCommand.getInstance().proxy;
        const hero = this.phase === 'hero', options = cmd.options;
        for (const action of this.repeatActions) {
            action.node.active = action.cost.node.active = !hero && !this.queue.length;
            const option = options.find(option => option.count === action.count), enabled = this.canRepeat(action.count);
            action.node.getComponent(Button).interactable = enabled;
            action.node.getComponent(UIOpacity).opacity = enabled ? 255 : 115;
            action.cost.string = option ? option.costs.map(cost => `${itemName(cost.itemId)} ×${cost.count.toLocaleString()}`).join(' · ') : '配置暂不可用';
            action.cost.color = option?.costs.every(cost => bag.getItemCount(cost.itemId) >= cost.count) ? C.muted : new Color(227, 148, 121);
        }
        this.nextBatch.active = !hero && !!this.queue.length;
        const costItems = Array.from(new Set(options.reduce((ids, option) => ids.concat(option.costs.map(cost => cost.itemId)), [] as number[])));
        const balance = costItems.map(id => `${itemName(id)} ${bag.getItemCount(id).toLocaleString()}`).join(' · ');
        this.repeatBalance.string = balance;
        this.repeatBalance.node.active = !hero;
        this.previous.getComponent(Button).interactable = !this.gridLoading && this.page > 0;
        this.next.getComponent(Button).interactable = !this.gridLoading && this.page + 1 < Math.ceil(this.entries.length / this.metrics.pageSize);
        this.feedbackWaiting = cmd.pending || this.gridLoading || cmd.loading;
        if (!this.feedbackWaiting) this.feedbackElapsed = 0;
        // 瞬时请求及缓存命中不闪出加载文字；慢请求保留明确反馈。
        this.repeatStatus.string = this.feedbackWaiting ? this.feedbackElapsed < .35 ? ''
            : cmd.pending ? '正在点将，请稍候…' : this.gridLoading ? '奖励正在揭晓…' : '正在核对点将信息…'
            : !cmd.sessionReady ? '连接已断开，请重新登录' : cmd.error || (this.queue.length ? '还有其他点将结果待查看'
            : balance && !this.repeatActions.some(action => this.canRepeat(action.count)) ? '所需道具不足' : '');
        this.repeatStatus.color = cmd.error ? new Color(227, 148, 121) : C.muted;
        this.retryInfo.active = !hero && cmd.sessionReady && !cmd.loaded && !cmd.loading && !cmd.pending;
        this.repeatStatus.node.active = !hero && !this.retryInfo.active;
    }

    private showNextBatch(): void {
        if (this.phase !== 'results') return;
        const next = this.queue.shift();
        if (next) this.showResult(next);
    }
    private close(): void { this.dispose(); }
    private dispose(): void {
        this.generation++; this.gridToken++; this.queue.length = 0;
        this.portraitMotion?.reset();
        if (LotteryRewardWindow.current === this) LotteryRewardWindow.current = null;
        this.node.active = false; this.node.destroy();
    }
    protected onDestroy(): void {
        this.generation++; this.gridToken++; this.frames.clear(); this.frameLoads.clear();
        this.portraitMotion?.reset();
        this.unscheduleAllCallbacks(); EventMgr.targetOff(this);
        view.off('canvas-resize', this.queueLayout, this); view.off('design-resolution-changed', this.queueLayout, this);
        if (LotteryRewardWindow.current === this) LotteryRewardWindow.current = null;
    }
    private make(name: string, parent: Node): Node {
        const node = new Node(name); node.layer = parent.layer; node.addComponent(UITransform); node.addComponent(UIOpacity); parent.addChild(node); return node;
    }
    private sprite(name: string, parent: Node): Sprite {
        const sprite = this.make(name, parent).addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM; return sprite;
    }
    private label(parent: Node, name: string, text: string, size: number, color: Color): Label {
        const label = caption(parent, name, text, 0, 0, 300, size, color, Label.HorizontalAlign.CENTER);
        label.overflow = Label.Overflow.SHRINK; label.node.addComponent(UIOpacity); return label;
    }
    private button(name: string, action: () => void): Node {
        const node = this.make(name, this.panel); node.addComponent(Button); node.on(Button.EventType.CLICK, action, this); return node;
    }
    private load(sprite: Sprite, path: string, complete?: () => boolean, token?: number): void {
        if (!path) return;
        this.requestFrame(path, frame => {
            if (!frame || !this.isValid || !sprite.isValid || (token !== undefined && token !== this.generation)) return;
            sprite.spriteFrame = frame; complete?.();
        });
    }
    private requestFrame(path: string, done: (frame: SpriteFrame | null) => void): void {
        if (!path) { done(null); return; }
        if (this.frames.has(path)) { done(this.frames.get(path)); return; }
        const waiting = this.frameLoads.get(path);
        if (waiting) { waiting.push(done); return; }
        this.frameLoads.set(path, [done]);
        resources.load(path, SpriteFrame, (error, frame) => {
            // Creator 销毁组件后会清空字段，迟到的资源回调必须先退出。
            if (!this.isValid || !this.frameLoads || !this.frames) return;
            const callbacks = this.frameLoads.get(path) || [];
            this.frameLoads.delete(path);
            const resolved = !error && frame ? frame : null;
            this.frames.set(path, resolved);
            callbacks.forEach(callback => callback(resolved));
        });
    }
    private stretch(node: Node): void {
        const widget = node.addComponent(Widget);
        widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
        widget.top = widget.bottom = widget.left = widget.right = 0;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE; widget.updateAlignment();
    }
}
