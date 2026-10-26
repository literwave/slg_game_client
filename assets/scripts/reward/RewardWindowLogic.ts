import { _decorator, Component, EditBox, EventTouch, Graphics, Node, Sprite, SpriteFrame, Label, UIOpacity, UITransform, tween, Tween, Vec3, Color, resources, Prefab, instantiate, director, Canvas, Layers } from 'cc';
import { EventMgr } from "../utils/EventMgr";
import { LogicEvent } from "../common/LogicEvent";
import ConfigManager from "../core/ConfigManager";
import { getGeneralPortraitPath } from '../general/GeneralPortrait';
import { Button, BlockInputEvents, view } from 'cc';
import { caption, inkSurface, panelButton, place, ManagementColors as C } from '../map/ui/ManagementStyle';
import { itemGlyph, itemIconPath, itemName } from '../common/ItemPresentation';

const { ccclass } = _decorator;

export interface RewardInfo {
    rewardType: number;
    itemId: number;
    itemCount: number;
}

interface RewardFxAssets {
    glow: SpriteFrame | null;
    rays: SpriteFrame | null;
    spark: SpriteFrame | null;
}

const FX_GOLD = new Color(255, 221, 158, 255);
const FX_GOLD_BRIGHT = new Color(255, 241, 208, 255);
const FX_CENTER_Y = 12;
const MIN_VISIBLE_TIME = 0.55;

const REWARD_TYPE_ITEM = 1;
const REWARD_TYPE_RES = 2;
const REWARD_TYPE_HERO = 3;
const REWARD_TYPE_SOLDIER = 4;
const REWARD_TYPE_CONVERT_ITEM = 6;

@ccclass('RewardWindowLogic')
export default class RewardWindowLogic extends Component {
    private static _current: RewardWindowLogic | null = null;
    private static _loading = false;
    private static _queue: RewardInfo[][] = [];
    private static _inited = false;
    private static _fxAssets: RewardFxAssets | null = null;
    private static _fxLoading = false;
    private static _fxWaiters: Array<(assets: RewardFxAssets) => void> = [];

    /** 放在启动流程里调用一次，监听奖励展示事件 */
    public static init(): void {
        if (this._inited) {
            return;
        }
        this._inited = true;
        EventMgr.on(LogicEvent.showReward, this.onShowReward, this);
    }

    private static onShowReward(list: RewardInfo[]): void {
        this.show(list);
    }

    public static show(list: RewardInfo[]): void {
        if (!list || !list.length) {
            return;
        }
        if (this._current && this._current.isValid) {
            this._current.play(list, this._current.node.active);
            return;
        }
        if (this._loading) {
            this._queue.push(list);
            return;
        }

        this._loading = true;
        resources.load('prefab/RewardWindow', Prefab, (error: Error, prefab: Prefab) => {
            this._loading = false;
            if (error || !prefab) {
                console.error('RewardWindow prefab load failed:', error);
                return;
            }
            const node = instantiate(prefab);
            const canvas = director.getScene()?.getComponentInChildren(Canvas);
            const parent = canvas ? canvas.node : director.getScene();
            if (!parent) {
                node.destroy();
                return;
            }
            parent.addChild(node);
            node.setPosition(0, 0, 0);
            const mapUI = parent.getChildByName('MapUIScene');
            this.applyLayer(node, mapUI ? mapUI.layer : Layers.Enum.UI_3D);

            const logic = node.getComponent(RewardWindowLogic);
            if (!logic) {
                node.destroy();
                return;
            }
            this._current = logic;
            logic.play(list, false);

            while (this._queue.length) {
                const next = this._queue.shift();
                if (next) {
                    logic.play(next, true);
                }
            }
        });
    }

    private static blurFocusedInputs(): void {
        const scene = director.getScene();
        if (!scene) {
            return;
        }
        const visit = (node: Node) => {
            for (const box of node.getComponents(EditBox)) {
                if (box && box.isValid && box.isFocused()) {
                    box.blur();
                }
            }
            for (const child of node.children) {
                visit(child);
            }
        };
        visit(scene);
    }

    private static applyLayer(node: Node, layer: number): void {
        node.layer = layer;
        for (const child of node.children) {
            this.applyLayer(child, layer);
        }
    }

    private static ensureFxAssets(callback: (assets: RewardFxAssets) => void): void {
        if (this._fxAssets) {
            callback(this._fxAssets);
            return;
        }
        if (this._fxLoading) {
            this._fxWaiters.push(callback);
            return;
        }

        this._fxLoading = true;
        Promise.all([
            this.loadFrame('ui/system_unlock/glow_gold/spriteFrame'),
            this.loadFrame('ui/system_unlock/rays_gold/spriteFrame'),
            this.loadFrame('ui/system_unlock/spark_gold/spriteFrame'),
        ]).then((frames) => {
            const assets: RewardFxAssets = {
                glow: frames[0],
                rays: frames[1],
                spark: frames[2],
            };
            this._fxAssets = assets;
            this._fxLoading = false;
            callback(assets);
            const waiters = this._fxWaiters.slice();
            this._fxWaiters.length = 0;
            waiters.forEach((waiter) => waiter(assets));
        });
    }

    private static loadFrame(path: string): Promise<SpriteFrame | null> {
        return new Promise((resolve) => {
            resources.load(path, SpriteFrame, (error: Error, asset: SpriteFrame) => {
                if (error || !asset) {
                    console.warn('RewardWindow effect sprite load failed:', path, error);
                    resolve(null);
                    return;
                }
                resolve(asset);
            });
        });
    }

    private rewards: RewardInfo[] = [];
    private content: Node | null = null;
    private templateNode: Node | null = null;
    private panel: Node | null = null;
    private confirm: Node | null = null;
    private veil: Node | null = null;
    private opacity: UIOpacity | null = null;
    private titleNode: Node | null = null;
    private subtitleNode: Node | null = null;
    private dividerNode: Node | null = null;

    private fxRays: Node | null = null;
    private fxGlow: Node | null = null;
    private fxParticles: Node | null = null;
    private fxSparkTemplate: Node | null = null;
    private itemNodes: Node[] = [];
    private basePositions: Map<Node, Vec3> = new Map();
    private elapsed: number = 0;
    private idleReady: boolean = false;
    private closing: boolean = false;
    private playToken: number = 0;
    private shownAt: number = 0;
    private skipButton: Node;
    private previousButton: Node;
    private nextButton: Node;
    private pageLabel: Label;
    private page = 0;
    private pageSize = 10;
    private columns = 5;
    private cardRows = 2;
    private cardAreaHeight = 410;
    private windowWidth = 800;
    private windowHeight = 590;

    protected onLoad(): void {
        this.opacity = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
        this.panel = this.node.getChildByPath('Panel');
        this.confirm = this.node.getChildByPath('Panel/Confirm');
        this.veil = this.node.getChildByName('Veil');
        this.content = this.node.getChildByPath('Panel/Content');
        this.titleNode = this.node.getChildByPath('Panel/Title');
        this.subtitleNode = this.node.getChildByPath('Panel/Subtitle');
        this.dividerNode = this.node.getChildByPath('Panel/Divider');
        this.templateNode = this.content ? this.content.getChildByName('ItemTemplate') : null;
        if (this.templateNode) {
            this.templateNode.active = false;
        }
        if (this.confirm) {
            this.confirm.active = false;
        }
        if (this.veil) {
            this.veil.on(Node.EventType.TOUCH_END, this.onBackdropClick, this);
        }
        if (this.panel) {
            this.panel.on(Node.EventType.TOUCH_END, this.onPanelTouch, this);
        }
        this.prepareVeil();
        this.buildFxNodes();
        if (!this.node.getComponent(BlockInputEvents)) this.node.addComponent(BlockInputEvents);
        const button = (name: string, action: () => void) => {
            const n = this.createNode(name, this.panel, 120, 42, 0, 0);
            n.addComponent(Button); n.on(Button.EventType.CLICK, action, this); return n;
        };
        this.skipButton = button('SkipAnimation', () => this.skipAnimation());
        this.previousButton = button('PreviousPage', () => this.changePage(-1));
        this.nextButton = button('NextPage', () => this.changePage(1));
        this.pageLabel = caption(this.panel, 'PageNumber', '', 0, 0, 150, 14, C.muted, Label.HorizontalAlign.CENTER);
        if (this.confirm) {
            if (!this.confirm.getComponent(Button)) this.confirm.addComponent(Button);
            this.confirm.on(Button.EventType.CLICK, () => this.dismiss(), this);
        }
        this.node.active = false;
    }

    protected onEnable(): void {
        view.on('canvas-resize', this.onResize, this);
        view.on('design-resolution-changed', this.onResize, this);
    }

    protected onDestroy(): void {
        view.off('canvas-resize', this.onResize, this);
        view.off('design-resolution-changed', this.onResize, this);
        this.playToken++;
        if (RewardWindowLogic._current === this) {
            RewardWindowLogic._current = null;
        }
    }

    protected onDisable(): void {
        view.off('canvas-resize', this.onResize, this);
        view.off('design-resolution-changed', this.onResize, this);
        this.playToken++;
        this.unscheduleAllCallbacks();
        this.stopFxTweens();
        if (this.opacity) Tween.stopAllByTarget(this.opacity);
        for (const cell of this.itemNodes) {
            Tween.stopAllByTarget(cell);
            const opacity = cell.getComponent(UIOpacity);
            if (opacity) Tween.stopAllByTarget(opacity);
        }
    }

    protected update(deltaTime: number): void {
        if (!this.node.active || this.closing) {
            return;
        }
        this.elapsed += deltaTime;
        if (this.fxRays) {
            this.fxRays.angle -= deltaTime * 2.2;
        }
        if (this.idleReady && this.fxGlow) {
            const scale = 1 + Math.sin(this.elapsed * 2.2) * 0.035;
            this.fxGlow.setScale(scale, scale, 1);
        }
    }

    public play(list: RewardInfo[], append: boolean): void {
        RewardWindowLogic.blurFocusedInputs();
        this.node.active = true;
        this.closing = false;
        this.idleReady = false;
        this.elapsed = 0;
        this.shownAt = Date.now();
        this.unscheduleAllCallbacks();
        this.stopFxTweens();
        this.rewards = append ? this.rewards.concat(list) : list.slice();
        this.page = 0;
        this.layoutWindow();
        if (this.node.parent) {
            this.node.setSiblingIndex(this.node.parent.children.length - 1);
        }
        this.buildItems();
        this.skipButton.active = true;
        if (this.confirm) this.confirm.active = true;

        if (this.opacity) {
            Tween.stopAllByTarget(this.opacity);
            this.opacity.opacity = 0;
        }

        const token = ++this.playToken;
        RewardWindowLogic.ensureFxAssets((assets) => {
            if (token !== this.playToken || !this.node || !this.node.isValid || !this.node.active) {
                return;
            }
            this.applyFxFrames(assets);
            this.animateIn();
        });
    }

    private onBackdropClick(): void {
        if (Date.now() - this.shownAt < MIN_VISIBLE_TIME * 1000) {
            return;
        }
        if (!this.idleReady) this.skipAnimation();
        else this.dismiss();
    }

    private onPanelTouch(event: EventTouch): void {
        event.propagationStopped = true;
    }

    private prepareVeil(): void {
        if (!this.veil) {
            return;
        }
        if (this.veil.getChildByName('RewardSolidBackdrop')) {
            return;
        }
        const backdrop = this.createNode('RewardSolidBackdrop', this.veil, 1280, 720, 0, 0);
        const graphics = backdrop.addComponent(Graphics);
        graphics.fillColor = new Color(7, 5, 4, 240);
        graphics.rect(-640, -360, 1280, 720);
        graphics.fill();
    }

    private dismiss(): void {
        if (this.closing) {
            return;
        }
        this.closing = true;
        this.idleReady = false;
        this.playToken++;
        this.unscheduleAllCallbacks();
        if (this.panel) {
            Tween.stopAllByTarget(this.panel);
            tween(this.panel).to(0.16, { scale: new Vec3(1.025, 1.025, 1) }).start();
        }
        if (this.opacity) {
            Tween.stopAllByTarget(this.opacity);
            tween(this.opacity).to(0.14, { opacity: 0 }).call(() => {
                this.node.active = false;
            }).start();
        } else {
            this.scheduleOnce(() => {
                this.node.active = false;
            }, 0.14);
        }
    }

    private buildFxNodes(): void {
        this.fxRays = this.createSpriteNode('RewardFxRays', this.node, 900, 900, 0, FX_CENTER_Y, null, FX_GOLD);
        this.fxRays.setSiblingIndex(1);
        this.setOpacity(this.fxRays, 0);

        this.fxGlow = this.createSpriteNode('RewardFxGlow', this.node, 720, 720, 0, FX_CENTER_Y, null, FX_GOLD_BRIGHT);
        this.fxGlow.setSiblingIndex(2);
        this.setOpacity(this.fxGlow, 0);

        this.fxParticles = this.createNode('RewardFxParticles', this.node, 1280, 720, 0, 0);
        this.fxSparkTemplate = this.createSpriteNode('SparkTemplate', this.fxParticles, 30, 30, 0, FX_CENTER_Y, null, FX_GOLD_BRIGHT);
        this.fxSparkTemplate.addComponent(UIOpacity);
        this.fxSparkTemplate.active = false;

        this.captureBasePosition(this.titleNode);
        this.captureBasePosition(this.subtitleNode);
        this.captureBasePosition(this.dividerNode);
    }

    private applyFxFrames(assets: RewardFxAssets): void {
        this.setFrame(this.fxRays, assets.rays);
        this.setFrame(this.fxGlow, assets.glow);
        this.setFrame(this.fxSparkTemplate, assets.spark || assets.glow);
    }

    private animateIn(): void {
        if (this.opacity) {
            Tween.stopAllByTarget(this.opacity);
            this.opacity.opacity = 0;
            tween(this.opacity).to(0.24, { opacity: 255 }).start();
        }

        if (this.panel) {
            Tween.stopAllByTarget(this.panel);
            this.panel.setScale(0.96, 0.96, 1);
            this.panel.angle = 0;
            tween(this.panel)
                .delay(0.04)
                .to(0.4, { scale: new Vec3(1, 1, 1), angle: 0 }, { easing: 'quadOut' })
                .start();
        }

        if (this.fxRays) {
            Tween.stopAllByTarget(this.fxRays);
            this.fxRays.setScale(0.64, 0.64, 1);
            this.fxRays.angle = 0;
            this.setOpacity(this.fxRays, 0);
            tween(this.fxRays).to(0.62, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' }).start();
            const raysOpacity = this.ensureOpacity(this.fxRays);
            tween(raysOpacity).delay(0.04).to(0.54, { opacity: 185 }).start();
        }

        if (this.fxGlow) {
            Tween.stopAllByTarget(this.fxGlow);
            this.fxGlow.setScale(0.54, 0.54, 1);
            this.setOpacity(this.fxGlow, 0);
            tween(this.fxGlow).to(0.68, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' }).start();
            const glowOpacity = this.ensureOpacity(this.fxGlow);
            tween(glowOpacity).delay(0.08).to(0.52, { opacity: 218 }).start();
        }

        this.fadeUp(this.titleNode, 0.3, 18, 0.32);
        this.fadeUp(this.subtitleNode, 0.42, 14, 0.3);
        this.fadeUp(this.dividerNode, 0.5, 10, 0.28);
        this.animateItems();

        this.scheduleOnce(() => this.spawnSparkBurst(22, new Vec3(0, FX_CENTER_Y, 0), 1.1), 0.42);
        this.scheduleOnce(() => {
            this.elapsed = 0;
            this.idleReady = true;
            this.skipButton.active = false;
        }, Math.max(1.5, 0.72 + (this.itemNodes.length - 1) * 0.11));
        this.schedule(this.spawnAmbientSpark, 0.24, 1000000);
        // 点将可能有多页奖励，保留结果直到玩家主动关闭。
    }

    private animateItems(): void {
        for (let i = 0; i < this.itemNodes.length; i++) {
            const cell = this.itemNodes[i];
            if (!cell || !cell.isValid) {
                continue;
            }
            const delay = 0.32 + i * 0.11;
            const opacity = this.ensureOpacity(cell);
            cell.setScale(0.04, 0.96, 1);
            Tween.stopAllByTarget(cell);
            Tween.stopAllByTarget(opacity);
            opacity.opacity = 0;
            tween(cell).delay(delay).to(0.4, { scale: new Vec3(1, 1, 1) }, { easing: 'cubicOut' }).start();
            tween(opacity).delay(delay).to(0.18, { opacity: 255 }).start();
            this.scheduleOnce(() => this.spawnSparkAtNode(cell, 2), delay + 0.08);
        }
    }

    private fadeUp(node: Node | null, delay: number, distance: number, duration: number): void {
        if (!node) {
            return;
        }
        const base = this.basePositions.get(node) || node.position.clone();
        const opacity = this.ensureOpacity(node);
        node.setPosition(base.x, base.y - distance, base.z);
        Tween.stopAllByTarget(node);
        Tween.stopAllByTarget(opacity);
        opacity.opacity = 0;
        tween(node).delay(delay).to(duration, { position: base }, { easing: 'quadOut' }).start();
        tween(opacity).delay(delay).to(0.24, { opacity: 255 }).start();
    }

    private spawnSparkBurst(count: number, origin: Vec3, strength: number): void {
        for (let i = 0; i < count; i++) {
            this.spawnSpark(origin, true, strength);
        }
    }

    private spawnSparkAtNode(node: Node, count: number): void {
        if (!node || !node.isValid || !this.fxParticles) {
            return;
        }
        const transform = this.fxParticles.getComponent(UITransform);
        if (!transform) {
            return;
        }
        const local = transform.convertToNodeSpaceAR(node.worldPosition);
        for (let i = 0; i < count; i++) {
            this.spawnSpark(local, true, 0.55);
        }
    }

    private spawnAmbientSpark(): void {
        if (this.closing) {
            return;
        }
        this.spawnSpark(new Vec3(0, FX_CENTER_Y, 0), false, 1);
    }

    private spawnSpark(origin: Vec3, burst: boolean, strength: number): void {
        if (!this.fxSparkTemplate || !this.fxSparkTemplate.parent) {
            return;
        }
        const spark = instantiate(this.fxSparkTemplate);
        spark.active = true;
        spark.layer = this.node.layer;
        spark.parent = this.fxParticles;

        const angle = Math.random() * Math.PI * 2;
        const startRadius = burst ? 8 + Math.random() * 22 : 92 + Math.random() * 104;
        const travel = (burst ? 70 + Math.random() * 145 : 22 + Math.random() * 48) * strength;
        const start = new Vec3(
            origin.x + Math.cos(angle) * startRadius,
            origin.y + Math.sin(angle) * startRadius,
            0,
        );
        const end = new Vec3(
            origin.x + Math.cos(angle) * (startRadius + travel),
            origin.y + Math.sin(angle) * (startRadius + travel) + 18,
            0,
        );
        const size = (burst ? 0.13 + Math.random() * 0.24 : 0.08 + Math.random() * 0.13) * strength;
        const lifetime = burst ? 0.72 + Math.random() * 0.42 : 0.95 + Math.random() * 0.35;

        spark.setPosition(start);
        spark.setScale(size, size, 1);
        spark.angle = Math.random() * 180;
        const opacity = this.ensureOpacity(spark);
        opacity.opacity = 0;

        tween(spark)
            .to(lifetime, {
                position: end,
                scale: new Vec3(size * 0.25, size * 0.25, 1),
                angle: spark.angle + 70,
            }, { easing: 'quadOut' })
            .call(() => {
                if (spark.isValid) {
                    spark.destroy();
                }
            })
            .start();
        tween(opacity)
            .to(0.14, { opacity: 245 })
            .delay(Math.max(0, lifetime - 0.42))
            .to(0.28, { opacity: 0 })
            .start();
    }

    private stopFxTweens(): void {
        const nodes = [
            this.panel,
            this.fxRays,
            this.fxGlow,
            this.titleNode,
            this.subtitleNode,
            this.dividerNode,
            this.confirm,
        ];
        for (const node of nodes) {
            if (!node) {
                continue;
            }
            Tween.stopAllByTarget(node);
            const opacity = node.getComponent(UIOpacity);
            if (opacity) {
                Tween.stopAllByTarget(opacity);
            }
        }
        if (this.fxParticles) {
            for (const spark of this.fxParticles.children.slice()) {
                if (spark !== this.fxSparkTemplate) {
                    spark.destroy();
                }
            }
        }
    }

    private captureBasePosition(node: Node | null): void {
        if (node) {
            this.basePositions.set(node, node.position.clone());
        }
    }

    private buildItems(): void {
        this.itemNodes.length = 0;
        if (!this.content || !this.templateNode) {
            return;
        }
        for (const child of this.content.children.slice()) {
            if (child !== this.templateNode) {
                child.destroy();
            }
        }

        const list = this.rewards.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize);
        const rows = Math.ceil(list.length / this.columns);
        const cellW = Math.min(136, (this.windowWidth - 60) / this.columns - 10);
        const cellH = Math.min(144, (this.cardAreaHeight - (this.cardRows - 1) * 8) / this.cardRows);
        const gapX = 10;
        const gapY = 8;

        for (let i = 0; i < list.length; i++) {
            const cell = instantiate(this.templateNode);
            cell.active = true;
            cell.parent = this.content;

            const row = Math.floor(i / this.columns);
            const col = i % this.columns;
            const countInRow = Math.min(this.columns, list.length - row * this.columns);
            const rowWidth = countInRow * cellW + (countInRow - 1) * gapX;
            const x = -rowWidth / 2 + cellW / 2 + col * (cellW + gapX);
            const totalHeight = rows * cellH + (rows - 1) * gapY;
            const y = totalHeight / 2 - cellH / 2 - row * (cellH + gapY);

            cell.setPosition(x, y, 0);
            cell.getComponent(UITransform).setContentSize(cellW, cellH);
            inkSurface(cell, 'RewardCard', cellW, cellH, new Color(41, 40, 32),
                list[i].rewardType === REWARD_TYPE_HERO ? new Color(220, 174, 92) : C.line);
            const iconNode = cell.getChildByName('Icon');
            const iconSize = Math.min(64, cellW - 28, cellH - 72);
            place(iconNode, 0, 18, iconSize, iconSize);
            const nameNode = cell.getChildByName('Name'), countNode = cell.getChildByName('Count');
            place(nameNode, 0, -cellH / 2 + 39, cellW - 12, 24);
            place(countNode, 0, -cellH / 2 + 16, cellW - 12, 23);
            const name = nameNode?.getComponent(Label), count = countNode?.getComponent(Label);
            if (name) { name.fontSize = 15; name.lineHeight = 20; name.enableWrapText = false; name.overflow = Label.Overflow.SHRINK; }
            if (count) { count.fontSize = 17; count.lineHeight = 21; count.enableWrapText = false; count.overflow = Label.Overflow.SHRINK; }
            this.itemNodes.push(cell);
            this.fillCell(cell, list[i]);
        }
        const pages = Math.max(1, Math.ceil(this.rewards.length / this.pageSize));
        this.pageLabel.string = (this.page + 1) + ' / ' + pages;
        this.previousButton.active = this.nextButton.active = this.pageLabel.node.active = pages > 1;
        this.previousButton.getComponent(Button).interactable = this.page > 0;
        this.nextButton.getComponent(Button).interactable = this.page < pages - 1;
    }

    /** 完成到最终展示状态，异步贴图返回也不会重新播放演出。 */
    public skipAnimation(): void {
        this.playToken++;
        this.unscheduleAllCallbacks();
        this.stopFxTweens();
        if (this.opacity) { Tween.stopAllByTarget(this.opacity); this.opacity.opacity = 255; }
        this.panel.setScale(1, 1, 1); this.panel.angle = 0;
        for (const node of [this.titleNode, this.subtitleNode, this.dividerNode, this.confirm, ...this.itemNodes]) {
            if (!node?.isValid) continue;
            Tween.stopAllByTarget(node);
            const opacity = this.ensureOpacity(node); Tween.stopAllByTarget(opacity); opacity.opacity = 255;
            const base = this.basePositions.get(node); if (base) node.setPosition(base);
            node.setScale(1, 1, 1);
        }
        this.fxRays.setScale(1, 1, 1); this.setOpacity(this.fxRays, 110);
        this.fxGlow.setScale(1, 1, 1); this.setOpacity(this.fxGlow, 145);
        this.skipButton.active = false; this.idleReady = true;
    }

    private changePage(direction: number): void {
        this.skipAnimation();
        this.page = Math.max(0, Math.min(Math.ceil(this.rewards.length / this.pageSize) - 1, this.page + direction));
        this.buildItems();
    }

    private layoutWindow(): void {
        const size = view.getVisibleSize();
        this.windowWidth = Math.min(840, size.width - 36);
        this.windowHeight = Math.min(600, size.height - 36);
        this.columns = this.windowWidth >= 700 ? 5 : this.windowWidth >= 560 ? 4 : this.windowWidth >= 400 ? 3 : 2;
        const narrow = this.windowWidth < 470;
        const footerHeight = narrow ? 130 : 94;
        const headerHeight = 110;
        this.cardAreaHeight = this.windowHeight - headerHeight - footerHeight;
        this.cardRows = this.cardAreaHeight >= 244 ? 2 : 1;
        this.pageSize = this.columns * this.cardRows;
        place(this.node, 0, 0, size.width, size.height);
        place(this.veil, 0, 0, size.width, size.height);
        const shade = this.veil.getChildByName('RewardSolidBackdrop')?.getComponent(Graphics);
        if (shade) { shade.clear(); shade.fillColor = new Color(6, 10, 9, 185); shade.rect(-size.width / 2, -size.height / 2, size.width, size.height); shade.fill(); }
        place(this.panel, 0, 0, this.windowWidth, this.windowHeight);
        inkSurface(this.panel, 'ResultSurface', this.windowWidth, this.windowHeight, new Color(26, 30, 26, 252), C.line);
        const top = this.windowHeight / 2, bottom = -top;
        const titleWidth = narrow ? this.windowWidth - 180 : 280;
        place(this.titleNode, narrow ? -this.windowWidth / 2 + 22 + titleWidth / 2 : 0, top - 42, titleWidth, 44);
        const titleLabel = this.titleNode?.getComponent(Label);
        if (titleLabel) titleLabel.overflow = Label.Overflow.SHRINK;
        place(this.subtitleNode, 0, top - 78, Math.min(300, this.windowWidth - 44), 26);
        place(this.dividerNode, 0, top - 100, this.windowWidth - 70, 2);
        place(this.content, 0, (footerHeight - headerHeight) / 2, this.windowWidth - 42, this.cardAreaHeight);
        panelButton(this.skipButton, '跳过动画', this.windowWidth / 2 - 83, top - 34, 130, 40);
        panelButton(this.confirm, '收下奖励', 0, bottom + 38, 150, 44, true);
        const navWidth = narrow ? Math.min(104, (this.windowWidth - 110) / 2) : 104;
        const navX = this.windowWidth / 2 - 24 - navWidth / 2;
        panelButton(this.previousButton, '上一页', -navX, bottom + (narrow ? 94 : 38), navWidth, 40);
        panelButton(this.nextButton, '下一页', navX, bottom + (narrow ? 94 : 38), navWidth, 40);
        place(this.pageLabel.node, 0, bottom + (narrow ? 94 : 76), narrow ? this.windowWidth - 64 - 2 * navWidth : 120, 22);
        for (const node of [this.titleNode, this.subtitleNode, this.dividerNode]) this.captureBasePosition(node);
    }

    private onResize(): void {
        if (!this.panel || !this.node.activeInHierarchy || this.closing || !this.rewards.length) return;
        const firstReward = this.page * this.pageSize;
        this.skipAnimation();
        this.layoutWindow();
        this.page = Math.min(Math.floor(firstReward / this.pageSize), Math.max(0, Math.ceil(this.rewards.length / this.pageSize) - 1));
        this.buildItems();
    }

    private createNode(name: string, parent: Node, width: number, height: number, x: number, y: number): Node {
        const node = new Node(name);
        node.layer = this.node.layer;
        parent.addChild(node);
        const transform = node.addComponent(UITransform);
        transform.setContentSize(width, height);
        node.setPosition(x, y, 0);
        return node;
    }

    private createSpriteNode(name: string, parent: Node, width: number, height: number, x: number, y: number, frame: SpriteFrame | null, color: Color): Node {
        const node = this.createNode(name, parent, width, height, x, y);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.type = Sprite.Type.SIMPLE;
        sprite.spriteFrame = frame;
        sprite.color = color;
        return node;
    }

    private ensureOpacity(node: Node): UIOpacity {
        return node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
    }

    private setOpacity(node: Node, value: number): void {
        this.ensureOpacity(node).opacity = value;
    }

    private setFrame(node: Node | null, frame: SpriteFrame | null): void {
        if (!node || !frame) {
            return;
        }
        const sprite = node.getComponent(Sprite);
        if (sprite) {
            sprite.spriteFrame = frame;
        }
    }

    private fillCell(cell: Node, info: RewardInfo): void {
        const countLabel = cell.getChildByName('Count')?.getComponent(Label);
        if (countLabel) {
            countLabel.string = `×${info.itemCount || 0}`;
        }
        const nameLabel = cell.getChildByName('Name')?.getComponent(Label);
        if (nameLabel) {
            nameLabel.string = this.getRewardName(info);
        }
        const icon = cell.getChildByName('Icon')?.getComponent(Sprite);
        if (!icon) {
            return;
        }
        icon.node.active = false;
        // 点将符、加速等道具允许未配置插图，仍显示可辨认的用途徽记。
        const glyph = this.createNode('ItemGlyph', cell, 66, 58, icon.node.position.x, icon.node.position.y);
        const glyphLabel = glyph.addComponent(Label);
        glyphLabel.string = info.rewardType === REWARD_TYPE_HERO ? '将' : info.rewardType === REWARD_TYPE_SOLDIER ? '兵' : itemGlyph(info.itemId);
        glyphLabel.fontSize = 34;
        glyphLabel.lineHeight = 40;
        glyphLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        glyphLabel.verticalAlign = Label.VerticalAlign.CENTER;
        glyphLabel.color = FX_GOLD;
        const path = this.getIconPath(info);
        if (!path) {
            return;
        }
        resources.load(path, SpriteFrame, (error: Error, frame: SpriteFrame) => {
            if (error || !frame || !icon.isValid) {
                return;
            }
            icon.spriteFrame = frame;
            const ui = icon.node.getComponent(UITransform), size = frame.originalSize;
            const fit = Math.min(ui.width / size.width, ui.height / size.height);
            ui.setContentSize(size.width * fit, size.height * fit);
            icon.node.active = true;
            if (glyph.isValid) glyph.active = false;
        });
    }

    private getIconPath(info: RewardInfo): string {
        const isItemReward = info.rewardType === REWARD_TYPE_ITEM
            || info.rewardType === REWARD_TYPE_RES
            || info.rewardType === REWARD_TYPE_CONVERT_ITEM;
        if (isItemReward) return itemIconPath(info.itemId);
        if (info.rewardType === REWARD_TYPE_HERO) {
            const hero = this.getHeroConfig(info.itemId);
            return getGeneralPortraitPath(hero && hero.Icon);
        }
        return '';
    }

    private getRewardName(info: RewardInfo): string {
        if (info.rewardType === REWARD_TYPE_SOLDIER) return '兵力';
        if (info.rewardType === REWARD_TYPE_HERO) {
            const hero = this.getHeroConfig(info.itemId);
            return (hero && hero.name) || `武将 ${info.itemId}`;
        }
        if (info.rewardType === REWARD_TYPE_ITEM
            || info.rewardType === REWARD_TYPE_RES
            || info.rewardType === REWARD_TYPE_CONVERT_ITEM) {
            return itemName(info.itemId);
        }
        return "奖励";
    }

    private getHeroConfig(heroId: number): any {
        const heroes = ConfigManager.getInstance().getConfig("Hero");
        const rows: any[] = Array.isArray(heroes) ? heroes : heroes && typeof heroes === 'object' ? Object.keys(heroes).map(key => heroes[key]) : [];
        return rows.find((cfg: any) => cfg && Number(cfg.Id) === heroId) || null;
    }
}
