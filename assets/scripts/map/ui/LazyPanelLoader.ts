import { assetManager, BlockInputEvents, Button, Color, Component, Graphics, instantiate, isValid, Label, Node, Prefab, UITransform, view } from 'cc';
import { EDITOR, PREVIEW } from 'cc/env';
import AssetLoadQueue, { AssetPriority, AssetRequestCancelled } from '../../core/AssetLoadQueue';
import { EventMgr } from '../../utils/EventMgr';
import { LogicEvent } from '../../common/LogicEvent';

/** 路径位于 ui-panels Bundle；启动 HUD 不再直接引用这些预制体。 */
export const LAZY_PANELS: Record<string, [string, string, string]> = {
    settingPrefab: ['Setting', '_settingNode', '2627c7e2-3663-4760-bd6b-9b0c85a2a189'],
    armySettingPrefab: ['CityArmySetting', '_armySettingNode', '6cc810a6-066b-484a-b3af-8d9955dee69d'],
    generalPrefab: ['GeneralList', '_generalNode', 'e68ad7c0-fbe6-4d0b-b5bd-395140c227d5'],
    generalDesPrefab: ['GeneralInfo', '_generalDesNode', 'c13713b5-3941-439e-95a8-0ba72d16b86f'],
    cityAboutPrefab: ['CityAbout', '_cityAboutNode', 'cb8a794b-4b28-4a41-8d81-0d0ab47ccf3b'],
    armySelectPrefab: ['ArmySelectNode', '_armySelectNode', '8aa291a0-ef19-4a5f-a5b0-418019b76568'],
    drawPrefab: ['Draw', '_drawNode', 'caa42f17-b55a-4e53-a93c-ef584f7e9c66'],
    drawResultrefab: ['DrawResult', '_drawResultNode', 'beaeae3e-8e1d-460d-bc0b-aef75a9adb95'],
    unionPrefab: ['Union', '_unionNode', '1e9b4c9f-a438-4925-8e8b-5bfbc5d19ed6'],
    transFormPrefab: ['Transform', '_transFormNode', 'e24a8bb9-9f6d-4e5e-9ba9-df59e493ee4b'],
    generalConvertPrefab: ['GeneralConvert', '_generalConvertNode', '65571b75-0767-47bf-9258-6c4a46346649'],
    generalRosterPrefab: ['GeneralRosterList', '_generalRosterNode', 'cac2ae01-2405-40a0-a0bc-48583fd78b9c'],
    skillPrefab: ['Skill', '_skillNode', 'fc371bc9-5d60-4fd6-8990-b69c9020498c'],
    skillInfoPrefab: ['SkilInfo', '_skillInfoNode', 'd1861182-3e2c-4c8e-ba82-6bd63952b7ba'],
    cloudAniPrefab: ['CloudAni', '_cloudAniNode', 'c9155be2-3848-4076-bba7-800f6ec3d653'],
};

const COMMON_PANELS = ['generalPrefab', 'generalDesPrefab', 'armySettingPrefab', 'armySelectPrefab',
    'drawPrefab', 'drawResultrefab', 'skillPrefab', 'skillInfoPrefab', 'unionPrefab', 'cityAboutPrefab'];

export default class LazyPanelLoader {
    private retained = new Map<string, Prefab>();
    private usedAt = new Map<string, number>();
    private request = 0;
    private disposed = false;
    private overlay: Node = null;
    private overlayTimer: ReturnType<typeof setTimeout> = null;
    private prepared = new Set<string>();
    private preparing = new Map<string, Promise<void>>();

    constructor(private owner: Component, private host: () => Node) {}

    /** 返回 true 表示本次交互已接管，调用者不要继续 instantiate。 */
    defer(key: string, open: () => void): boolean {
        this.usedAt.set(key, Date.now());
        if (isValid((this.owner as any)[key])) { this.cancel(); return false; }
        if (!LAZY_PANELS[key]) throw new Error(`未知界面：${key}`);
        const request = ++this.request;
        this.hideLoading();
        AssetLoadQueue.pauseBackground();
        this.overlayTimer = setTimeout(() => {
            this.overlayTimer = null;
            if (this.current(request)) this.showLoading();
        }, 120);
        void this.load(key).then(() => {
            if (!this.current(request)) return;
            this.hideLoading();
            // 再让出一帧，加载提示和按钮反馈能够先绘制出来。
            this.owner.scheduleOnce(() => { if (this.current(request)) open(); }, 0);
        }, error => {
            if (!this.current(request)) return;
            this.hideLoading();
            console.warn(`[PanelLoad] ${key}`, error);
            EventMgr.emit(LogicEvent.showToast, '加载失败，请重试');
        });
        return true;
    }

    /** 云层等装饰不显示加载遮罩，准备好后供下一次使用。 */
    prefetch(key: string): void { void this.load(key, AssetPriority.Background).catch(() => {}); }

    /** 登录后分批准备节点与首屏内容；保持 inactive，不触发 onEnable 的业务请求或输入。 */
    prefetchAll(prepare?: (key: string, node: Node) => void | Promise<void>): void {
        if (this.disposed) return;
        AssetLoadQueue.pauseBackground(1500);
        for (const key of new Set([...COMMON_PANELS, ...Object.keys(LAZY_PANELS)])) {
            void this.load(key, AssetPriority.Warmup).then(() => this.warmView(key, async () => {
                const nodeKey = LAZY_PANELS[key][1];
                // 用户提前打开的窗口已完成初始化，不能在后台重置正在操作的内容。
                if (isValid((this.owner as any)[nodeKey], true)) return;
                const node = instantiate((this.owner as any)[key]) as Node;
                node.active = false;
                this.host().addChild(node);
                (this.owner as any)[nodeKey] = node;
                try { await prepare?.(key, node); }
                catch (error) {
                    if (!node.activeInHierarchy) {
                        node.destroy();
                        if ((this.owner as any)[nodeKey] === node) (this.owner as any)[nodeKey] = null;
                    }
                    throw error;
                }
            })).catch(error => this.warn(key, error));
        }
    }

    /** 代码构建的背包、内城、战报也接入同一条限流队列。 */
    warmView(key: string, prepare: () => void | Promise<void>): Promise<void> {
        if (this.disposed || this.prepared.has(key)) return Promise.resolve();
        const pending = this.preparing.get(key);
        if (pending) return pending;
        const job = AssetLoadQueue.request(`panel-view:${key}`, async () => {
            if (this.disposed || !isValid(this.owner, true) || !isValid(this.host(), true)) return;
            await prepare();
            if (!this.disposed) this.prepared.add(key);
        }, AssetPriority.Warmup);
        this.preparing.set(key, job);
        void job.then(() => this.preparing.delete(key), error => {
            this.preparing.delete(key); this.warn(key, error);
        });
        return job;
    }

    private warn(key: string, error: unknown): void {
        if (!this.disposed && !(error instanceof AssetRequestCancelled)) console.warn('[PanelWarmup]', key, error);
    }

    cancel(): void { this.request++; this.hideLoading(); }

    private current(request: number): boolean {
        return !this.disposed && request === this.request && isValid(this.owner, true) && isValid(this.host(), true);
    }

    private async load(key: string, priority = AssetPriority.Interaction): Promise<void> {
        if (this.disposed || !isValid(this.owner, true)) return;
        if (this.retained.get(key)?.isValid) return;
        const prefab = await AssetLoadQueue.request(`panel:${key}`, async () => {
            return await new Promise<Prefab>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('界面加载超时')), 15000);
                const complete = (error: Error, value: Prefab) => {
                    clearTimeout(timer);
                    if (error || !(value instanceof Prefab) || !value.isValid) reject(error || new Error('界面资源无效'));
                    else resolve(value);
                };
                // Game View 使用编辑器主包，未生成构建后的 bundle/index.js。
                // 只在开发环境按稳定 UUID 按需读取；正式构建仍走独立功能包。
                if (EDITOR || PREVIEW) {
                    assetManager.loadAny(LAZY_PANELS[key][2], complete);
                } else {
                    const load = (bundle: any) => bundle.load(LAZY_PANELS[key][0], Prefab, complete);
                    const bundle = assetManager.getBundle('ui-panels');
                    if (bundle) load(bundle);
                    else assetManager.loadBundle('ui-panels', (error, value) => error ? complete(error, null) : load(value));
                }
            });
        }, priority);
        if (this.disposed || !isValid(this.owner, true)) return;
        if (!this.retained.has(key)) { prefab.addRef(); this.retained.set(key, prefab); }
        (this.owner as any)[key] = prefab;
        this.usedAt.set(key, Date.now());
    }

    /** 预热窗口随地图会话保留；未预热的临时窗口仍允许回收。 */
    sweep(): void {
        const now = Date.now();
        for (const key of this.retained.keys()) {
            const node = (this.owner as any)[LAZY_PANELS[key][1]] as Node;
            if (this.prepared.has(key) && isValid(node, true)) continue;
            if (node?.activeInHierarchy) { this.usedAt.set(key, now); continue; }
            if (now - (this.usedAt.get(key) || now) < 30000) continue;
            if (isValid(node, true)) node.destroy();
            (this.owner as any)[LAZY_PANELS[key][1]] = null;
        }
    }

    dispose(): void {
        this.disposed = true; this.cancel();
        for (const key of Object.keys(LAZY_PANELS)) AssetLoadQueue.cancel(`panel:${key}`, AssetPriority.Warmup);
        for (const key of this.preparing.keys()) AssetLoadQueue.cancel(`panel-view:${key}`, AssetPriority.Warmup);
        this.preparing.clear(); this.prepared.clear();
        const prefabs = [...this.retained.values()]; this.retained.clear(); this.usedAt.clear();
        setTimeout(() => prefabs.forEach(prefab => { if (prefab.isValid) prefab.decRef(); }), 0);
    }

    private hideLoading(): void {
        if (this.overlayTimer !== null) clearTimeout(this.overlayTimer);
        this.overlayTimer = null;
        if (isValid(this.overlay, true)) { this.overlay.active = false; this.overlay.destroy(); }
        this.overlay = null;
    }

    private showLoading(): void {
        const host = this.host(), size = view.getVisibleSize();
        const node = new Node('FeatureLoading'); node.layer = host.layer;
        node.addComponent(UITransform).setContentSize(size.width, size.height);
        node.addComponent(BlockInputEvents); host.addChild(node);
        node.setSiblingIndex(host.children.length - 1); this.overlay = node;
        const g = node.addComponent(Graphics);
        g.fillColor = new Color(0, 0, 0, 100); g.rect(-size.width / 2, -size.height / 2, size.width, size.height); g.fill();
        g.fillColor = new Color(29, 36, 28, 250); g.roundRect(-120, -58, 240, 116, 5); g.fill();
        const text = new Node('Text'); text.layer = node.layer; node.addChild(text);
        text.addComponent(UITransform).setContentSize(200, 35); text.setPosition(0, 18);
        const label = text.addComponent(Label); label.string = '载入中…'; label.fontSize = 20; label.color = new Color(237, 220, 179);
        const cancel = new Node('Cancel'); cancel.layer = node.layer; node.addChild(cancel);
        cancel.addComponent(UITransform).setContentSize(120, 36); cancel.setPosition(0, -27);
        const caption = cancel.addComponent(Label); caption.string = '取消'; caption.fontSize = 16; caption.color = new Color(194, 176, 132);
        cancel.addComponent(Button); cancel.on(Button.EventType.CLICK, () => this.cancel());
    }
}
