import { _decorator, Component, EditBox, EventTouch, Graphics, Node, Sprite, SpriteFrame, Label, UIOpacity, UITransform, tween, Tween, Vec3, Color, resources, Prefab, instantiate, director, Canvas, Layers } from 'cc';
import { EventMgr } from "../utils/EventMgr";
import { LogicEvent } from "../common/LogicEvent";
import ConfigManager from "../core/ConfigManager";
import { getGeneralPortraitPath } from '../general/GeneralPortrait';

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
const AUTO_DISMISS_DELAY = 5.5;
const MIN_VISIBLE_TIME = 0.55;

const REWARD_TYPE_ITEM = 1;
const REWARD_TYPE_RES = 2;
const REWARD_TYPE_HERO = 3;
const REWARD_TYPE_EQUIP = 4;
const REWARD_TYPE_CONVERT_ITEM = 6;

const ITEM_NAME_FALLBACK: { [key: number]: string } = {
    1: "粮食",
    2: "木材",
    3: "铁矿",
    5: "石料",
    4: "令牌",
};

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
        this.node.active = false;
    }

    protected onDestroy(): void {
        this.playToken++;
        if (RewardWindowLogic._current === this) {
            RewardWindowLogic._current = null;
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
        if (this.node.parent) {
            this.node.setSiblingIndex(this.node.parent.children.length - 1);
        }
        this.buildItems();

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
        this.dismiss();
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
            this.panel.setScale(0.86, 0.86, 1);
            this.panel.angle = -2;
            tween(this.panel)
                .delay(0.04)
                .to(0.52, { scale: new Vec3(1, 1, 1), angle: 0 }, { easing: 'backOut' })
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
        }, 0.92);
        this.schedule(this.spawnAmbientSpark, 0.24, 1000000);
        this.scheduleOnce(() => this.dismiss(), AUTO_DISMISS_DELAY);
    }

    private animateItems(): void {
        for (let i = 0; i < this.itemNodes.length; i++) {
            const cell = this.itemNodes[i];
            if (!cell || !cell.isValid) {
                continue;
            }
            const delay = 0.26 + i * 0.055;
            const opacity = this.ensureOpacity(cell);
            cell.setScale(0.55, 0.55, 1);
            Tween.stopAllByTarget(cell);
            Tween.stopAllByTarget(opacity);
            opacity.opacity = 0;
            tween(cell).delay(delay).to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
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

        const list = this.rewards.slice(0, 8);
        if (this.rewards.length > 8) {
            console.warn('RewardWindow only shows first 8 rewards, total:', this.rewards.length);
        }
        const rows = Math.ceil(list.length / 4);
        const cellW = 110;
        const cellH = 108;
        const gapX = 10;
        const gapY = 8;

        for (let i = 0; i < list.length; i++) {
            const cell = instantiate(this.templateNode);
            cell.active = true;
            cell.parent = this.content;

            const row = Math.floor(i / 4);
            const col = i % 4;
            const countInRow = Math.min(4, list.length - row * 4);
            const rowWidth = countInRow * cellW + (countInRow - 1) * gapX;
            const x = -rowWidth / 2 + cellW / 2 + col * (cellW + gapX);
            const totalHeight = rows * cellH + (rows - 1) * gapY;
            const y = totalHeight / 2 - cellH / 2 - row * (cellH + gapY);

            cell.setPosition(x, y, 0);
            this.itemNodes.push(cell);
            this.fillCell(cell, list[i]);
        }
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
        const path = this.getIconPath(info);
        if (!path) {
            return;
        }
        resources.load(path, SpriteFrame, (error: Error, frame: SpriteFrame) => {
            if (error || !frame || !icon.isValid) {
                return;
            }
            icon.spriteFrame = frame;
            icon.node.active = true;
        });
    }

    private getIconPath(info: RewardInfo): string {
        const item = this.getItemConfig(info.itemId);
        const isItemReward = info.rewardType === REWARD_TYPE_ITEM
            || info.rewardType === REWARD_TYPE_RES
            || info.rewardType === REWARD_TYPE_EQUIP
            || info.rewardType === REWARD_TYPE_CONVERT_ITEM;
        if (isItemReward && item) {
            const icon = typeof item.Icon === 'string' ? item.Icon.trim() : '';
            if (icon) {
                const base = icon.replace(/\.png$/i, '').replace(/\/spriteFrame$/i, '');
                return `${base}/spriteFrame`;
            }
        }
        if (info.rewardType === REWARD_TYPE_HERO) {
            const hero = this.getHeroConfig(info.itemId);
            return getGeneralPortraitPath(hero && hero.Icon);
        }
        return '';
    }

    private getRewardName(info: RewardInfo): string {
        if (info.rewardType === REWARD_TYPE_HERO) {
            const hero = this.getHeroConfig(info.itemId);
            return (hero && hero.name) || `武将 ${info.itemId}`;
        }
        if (info.rewardType === REWARD_TYPE_ITEM
            || info.rewardType === REWARD_TYPE_RES
            || info.rewardType === REWARD_TYPE_EQUIP
            || info.rewardType === REWARD_TYPE_CONVERT_ITEM) {
            const item = this.getItemConfig(info.itemId);
            const name = item && (item.Name || item.name);
            return name || ITEM_NAME_FALLBACK[info.itemId] || `道具 ${info.itemId}`;
        }
        return "奖励";
    }

    private getItemConfig(itemId: number): any {
        const items = ConfigManager.getInstance().getConfig('Item');
        if (!Array.isArray(items)) {
            return null;
        }
        return items.find((cfg: any) => cfg && cfg.Id === itemId) || null;
    }

    private getHeroConfig(heroId: number): any {
        const heroes = ConfigManager.getInstance().getConfig("Hero");
        if (!Array.isArray(heroes)) {
            return null;
        }
        return heroes.find((cfg: any) => cfg && cfg.Id === heroId) || null;
    }
}
