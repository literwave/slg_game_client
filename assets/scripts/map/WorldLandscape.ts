import { _decorator, Camera, Component, ImageAsset, Material, Node, Sprite, SpriteFrame, Texture2D, TiledMap, UITransform, Vec2, Vec4, view } from 'cc';
import WorldMapArt from './WorldMapArt';
import MapCommand from './MapCommand';
import WorldStrategicMap from './WorldStrategicMap';
const { ccclass } = _decorator;

interface LandscapePatch { x: number; y: number; art: string; width: number; heightScale?: number; anchorY?: number; flipX?: boolean; px?: number; py?: number; }

/** 连续底色与水系 + 视口内复用的山体。逻辑地图仍由原来的格子表决定。 */
@ccclass('WorldLandscape')
export default class WorldLandscape extends Component {
    private camera: Camera = null;
    private material: Material = null;
    private riverTexture: Texture2D = null;
    private riverImage: ImageAsset = null;
    private groundFrame: SpriteFrame = null;
    private patches: LandscapePatch[] = [];
    private patchBuckets = new Map<string, number[]>();
    private activePatches = new Map<number, Node>();
    private pool: Node[] = [];
    private decoration: Node = null;
    private lastX = Infinity;
    private lastY = Infinity;
    private lastHeight = 0;
    private lastWidth = 0;

    initialize(map: TiledMap, camera: Camera): void {
        this.camera = camera;
        const size = map.getMapSize(), tile = map.getTileSize(), config = WorldMapArt.landscape;
        if (size.width !== config.width || size.height !== config.height) throw new Error('原创地形与逻辑地图尺寸不匹配');
        for (const layer of map.getLayers()) layer.node.active = false;
        // 最远概览仍覆盖边缘视口，透明雾区也能响应滚轮和拖动。
        const surfaceWidth = (size.width + size.height) * tile.width * .5 + 8000;
        const surfaceHeight = (size.width + size.height) * tile.height * .5 + 8000;
        const ground = new Node('OriginalGround'); ground.layer = this.node.layer; this.node.addChild(ground);
        ground.addComponent(UITransform).setContentSize(surfaceWidth, surfaceHeight);
        const sprite = ground.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        // 自有 SpriteFrame 保持完整 0..1 UV；不改变共享素材的动态合图属性。
        this.groundFrame = new SpriteFrame();
        const source = WorldMapArt.frame('plains');
        this.groundFrame.texture = source.original?._texture || source.texture;
        this.groundFrame.packable = false; sprite.spriteFrame = this.groundFrame;
        const bytes = new Uint8Array(size.width * size.height * 4);
        for (const id of config.riverCells) { bytes[id * 4] = 255; bytes[id * 4 + 3] = 255; }
        for (const id of config.mountainCells || []) { bytes[id * 4 + 1] = 255; bytes[id * 4 + 3] = 255; }
        this.riverImage = new ImageAsset({ _data: bytes, width: size.width, height: size.height,
            format: Texture2D.PixelFormat.RGBA8888, _compressed: false });
        this.riverTexture = new Texture2D(); this.riverTexture.image = this.riverImage;
        this.riverTexture.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
        this.riverTexture.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
        this.material = new Material(); this.material.initialize({ effectAsset: WorldMapArt.effect });
        this.material.setProperty('mapMetrics', new Vec4(size.width, size.height, tile.width, tile.height));
        this.material.setProperty('surfaceMetrics', new Vec4(surfaceWidth, surfaceHeight, 0, 0));
        const water = WorldMapArt.frame('water');
        this.material.setProperty('waterTexture', water.original?._texture || water.texture);
        this.material.setProperty('riverTexture', this.riverTexture); sprite.customMaterial = this.material;
        this.decoration = new Node('MountainRanges'); this.decoration.layer = this.node.layer; this.node.addChild(this.decoration);
        // 山体遮住后方的自然资源图标；城池、关隘、选中提示与部队仍在上层。
        // 与地面分层，避免资源图标像贴纸一样浮在山顶。
        const resourceLayer = this.node.parent?.getChildByName('resNode');
        if (resourceLayer) {
            this.decoration.setParent(resourceLayer.parent, true);
            this.decoration.setSiblingIndex(resourceLayer.getSiblingIndex() + 1);
        }
        this.patches = config.patches.map((p: LandscapePatch) => ({ ...p,
            px: (p.x - p.y) * tile.width * .5,
            py: (size.height - 1 - p.x - p.y) * tile.height * .5 }));
        this.patches.forEach((patch, id) => {
            const key = `${Math.floor(patch.px / 1024)},${Math.floor(patch.py / 1024)}`;
            if (!this.patchBuckets.has(key)) this.patchBuckets.set(key, []);
            this.patchBuckets.get(key).push(id);
        });
        this.node.addComponent(WorldStrategicMap).initialize(camera);
        this.updateVisible();
    }

    protected lateUpdate(): void { this.updateVisible(); }

    protected onDisable(): void {
        if (this.decoration) this.decoration.active = false;
    }

    /** 上方山体轮廓也属于阻挡，不能穿过山体图像选到背后的土地。 */
    public blockerAt(point: Vec2): Vec2 | null {
        if (!this.decoration?.active) return null;
        let selected: LandscapePatch = null;
        for (const id of this.activePatches.keys()) {
            const patch = this.patches[id], frame = WorldMapArt.frame(patch.art);
            const height = patch.width * frame.originalSize.height / frame.originalSize.width * (patch.heightScale || 1);
            const dx = (point.x - patch.px) / (patch.width * .39);
            const dy = (point.y - patch.py - height * (.5 - (patch.anchorY ?? .22))) / (height * .39);
            if (dx * dx + dy * dy <= 1 && (!selected || patch.py < selected.py)) selected = patch;
        }
        return selected ? new Vec2(selected.x, selected.y) : null;
    }

    private updateVisible(): void {
        if (!this.camera || !this.decoration) return;
        const p = this.camera.node.position, visible = view.getVisibleSize();
        const halfHeight = this.camera.orthoHeight, halfWidth = halfHeight * visible.width / Math.max(1, visible.height);
        if (MapCommand.getInstance().proxy.strategic) { this.decoration.active = false; return; }
        if (!this.decoration.active) { this.decoration.active = true; this.lastHeight = 0; }
        if (Math.abs(p.x - this.lastX) < 60 && Math.abs(p.y - this.lastY) < 60
            && halfHeight === this.lastHeight && halfWidth === this.lastWidth) return;
        this.lastX = p.x; this.lastY = p.y; this.lastHeight = halfHeight; this.lastWidth = halfWidth;
        const wanted = new Set<number>();
        // 山脚连续铺设后，只查询视口附近的空间桶，避免每次移动遍历全图山体。
        for (let by = Math.floor((p.y - halfHeight - 650) / 1024); by <= Math.floor((p.y + halfHeight + 650) / 1024); by++) {
            for (let bx = Math.floor((p.x - halfWidth - 650) / 1024); bx <= Math.floor((p.x + halfWidth + 650) / 1024); bx++) {
                for (const id of this.patchBuckets.get(`${bx},${by}`) || []) {
                    const patch = this.patches[id];
                    if (Math.abs(patch.px - p.x) < halfWidth + 650 && Math.abs(patch.py - p.y) < halfHeight + 650) wanted.add(id);
                }
            }
        }
        for (const [id, node] of this.activePatches) if (!wanted.has(id)) {
            node.active = false; this.pool.push(node); this.activePatches.delete(id);
        }
        for (const id of wanted) {
            if (this.activePatches.has(id)) continue;
            const patch = this.patches[id];
            let node = this.pool.pop();
            if (!node) {
                node = new Node('Mountain'); node.layer = this.node.layer;
                node.addComponent(UITransform).setAnchorPoint(.5, .22); node.addComponent(Sprite);
                this.decoration.addChild(node);
            }
            WorldMapArt.apply(node.getComponent(Sprite), patch.art, patch.width);
            node.getComponent(Sprite).trim = false;
            node.getComponent(UITransform).setAnchorPoint(.5, patch.anchorY ?? .22);
            node.setScale(patch.flipX ? -1 : 1, patch.heightScale || 1, 1);
            node.setPosition(patch.px, patch.py, 0); node.active = true; this.activePatches.set(id, node);
        }
        [...this.activePatches.values()].sort((a, b) => b.position.y - a.position.y)
            .forEach((node, index) => node.setSiblingIndex(index));
    }

    protected onDestroy(): void {
        if (this.decoration?.isValid) this.decoration.destroy();
        this.material?.destroy(); this.groundFrame?.destroy(); this.riverTexture?.destroy(); this.riverImage?.destroy();
        this.activePatches.clear(); this.patchBuckets.clear(); this.pool.length = 0;
    }
}
