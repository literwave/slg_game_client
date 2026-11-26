import { _decorator, Camera, Component, ImageAsset, Mat4, Material, Node, Sprite, SpriteFrame, Texture2D, TiledMap, UITransform, Vec2, Vec4, view } from 'cc';
import WorldMapArt from './WorldMapArt';
import MapCommand from './MapCommand';
import WorldStrategicMap from './WorldStrategicMap';
import { systemCityGroundCells, passMountainClearMasks } from './CityGround';
import { groundArtScaleY } from './MapProjection';
import { EventMgr } from '../utils/EventMgr';
import { LogicEvent } from '../common/LogicEvent';
const { ccclass } = _decorator;

interface LandscapePatch { x: number; y: number; art: string; width: number; heightScale?: number; anchorY?: number; flipX?: boolean; offsetX?: number; offsetY?: number; px?: number; py?: number; }

/** 连续底色与水系 + 视口内复用的山体。逻辑地图仍由原来的格子表决定。 */
@ccclass('WorldLandscape')
export default class WorldLandscape extends Component {
    private camera: Camera = null;
    private material: Material = null;
    private cityClipMaterial: Material = null;
    private mountainMaterial: Material = null;
    private clipWorldMatrix: Mat4 = null;
    private clipInverseMatrix = new Mat4();
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
    private terrainBytes: Uint8Array = null;
    private mapWidth = 0;
    private mapHeight = 0;
    private tileWidth = 0;
    private tileHeight = 0;
    private cityGroundPoints = new Map<number, { x: number; y: number }>();
    private passClearMasks: ReadonlyMap<number, number> = new Map();
    private cityPatchBlocks = new Map<number, boolean>();
    private patchPaddingX = 650;
    private patchPaddingY = 650;

    initialize(map: TiledMap, camera: Camera): void {
        this.camera = camera;
        const size = map.getMapSize(), tile = map.getTileSize(), config = WorldMapArt.landscape;
        if (size.width !== config.width || size.height !== config.height) throw new Error('原创地形与逻辑地图尺寸不匹配');
        this.mapWidth = size.width; this.mapHeight = size.height;
        this.tileWidth = tile.width; this.tileHeight = tile.height;
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
        for (const id of [...config.riverCells, ...(config.bridgeWaterCells || [])]) { bytes[id * 4] = 255; bytes[id * 4 + 3] = 255; }
        for (const id of config.mountainCells || []) { bytes[id * 4 + 1] = 255; bytes[id * 4 + 3] = 255; }
        // B=255 为城内硬裁切；64/96/128/160 为山口四个朝向，R/G 保留真实地形。
        this.terrainBytes = bytes;
        this.passClearMasks = passMountainClearMasks(new Set([...config.riverCells, ...(config.mountainCells || [])]));
        for (const id of this.passClearMasks.keys()) this.setCityGround(id, false);
        // 山口原画外缘用山脚衔接；不能把整片关隘占地清成草地菱形。
        for (const id of systemCityGroundCells(false)) this.setCityGround(id, true);
        for (const id of MapCommand.getInstance().cityProxy.getOccupiedCellIds()) this.setCityGround(id, true);
        EventMgr.on(LogicEvent.updatePlayerCityTiles, this.onCityGroundChanged, this);
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
        // 与连续地面共用同一张占地纹理，仅跨越城墙的山体使用此材质。
        this.cityClipMaterial = new Material();
        this.cityClipMaterial.initialize({ effectAsset: WorldMapArt.effect, technique: 1 });
        this.cityClipMaterial.setProperty('mapMetrics', new Vec4(size.width, size.height, tile.width, tile.height));
        this.cityClipMaterial.setProperty('riverTexture', this.riverTexture);
        this.cityClipMaterial.setProperty('groundTexture', this.groundFrame.texture);
        // 普通山体和城边山体使用同一种山脚混合；材质共享，避免每座山创建实例。
        this.mountainMaterial = new Material();
        this.mountainMaterial.initialize({ effectAsset: WorldMapArt.effect, technique: 3 });
        this.mountainMaterial.setProperty('mapMetrics', new Vec4(size.width, size.height, tile.width, tile.height));
        this.mountainMaterial.setProperty('groundTexture', this.groundFrame.texture);
        this.updateClipTransform();
        this.decoration = new Node('MountainRanges'); this.decoration.layer = this.node.layer; this.node.addChild(this.decoration);
        // 山体遮住后方的自然资源图标；城池、关隘、选中提示与部队仍在上层。
        // 与地面分层，避免资源图标像贴纸一样浮在山顶。
        const resourceLayer = this.node.parent?.getChildByName('resNode');
        if (resourceLayer) {
            this.decoration.setParent(resourceLayer.parent, true);
            this.decoration.setSiblingIndex(resourceLayer.getSiblingIndex() + 1);
        }
        this.patches = config.patches.map((p: LandscapePatch) => ({ ...p,
            width: p.width * tile.width / 200,
            heightScale: (p.heightScale || 1) * groundArtScaleY(tile.width, tile.height),
            px: (p.x - p.y) * tile.width * .5 + (p.offsetX || 0) * tile.width / 200,
            py: (size.height - 1 - p.x - p.y) * tile.height * .5 + (p.offsetY || 0) * tile.height / 100 }));
        this.patches.forEach((patch, id) => {
            const art = WorldMapArt.size(patch.art);
            const height = patch.width * art.height / art.width * patch.heightScale;
            this.patchPaddingX = Math.max(this.patchPaddingX, patch.width / 2);
            this.patchPaddingY = Math.max(this.patchPaddingY, height * Math.max(patch.anchorY ?? .22, 1 - (patch.anchorY ?? .22)));
            const key = `${Math.floor(patch.px / 1024)},${Math.floor(patch.py / 1024)}`;
            if (!this.patchBuckets.has(key)) this.patchBuckets.set(key, []);
            this.patchBuckets.get(key).push(id);
        });
        this.node.addComponent(WorldStrategicMap).initialize(camera);
        this.updateVisible();
    }

    protected lateUpdate(): void { this.updateVisible(); }

    private updateClipTransform(): void {
        const matrix = this.node.worldMatrix;
        if (this.clipWorldMatrix && Mat4.equals(this.clipWorldMatrix, matrix)) return;
        if (!this.clipWorldMatrix) this.clipWorldMatrix = new Mat4();
        Mat4.copy(this.clipWorldMatrix, matrix);
        Mat4.invert(this.clipInverseMatrix, matrix);
        this.cityClipMaterial.setProperty('worldToMap', this.clipInverseMatrix);
        this.mountainMaterial?.setProperty('worldToMap', this.clipInverseMatrix);
    }

    private cityGroundAtPoint(point: Vec2): boolean {
        const row = ((this.mapHeight - 1) * this.tileHeight * .5 - point.y) / this.tileHeight;
        const x = Math.floor(row + point.x / this.tileWidth + .5), y = Math.floor(row - point.x / this.tileWidth + .5);
        return x >= 0 && y >= 0 && x < this.mapWidth && y < this.mapHeight
            && this.terrainBytes[(y * this.mapWidth + x) * 4 + 2] > 0;
    }

    private setCityGround(id: number, occupied: boolean): boolean {
        if (!Number.isInteger(id) || id < 0 || id >= this.mapWidth * this.mapHeight) return false;
        // 入口不是城市地基：AOI 更新或玩家城迁出后，也应恢复软裁切而非整格留白。
        const value = occupied ? 255 : this.passClearMasks.get(id) || 0;
        if (this.terrainBytes[id * 4 + 2] === value) return false;
        this.terrainBytes[id * 4 + 2] = value;
        if (value > 0) {
            const x = id % this.mapWidth, y = Math.floor(id / this.mapWidth);
            this.cityGroundPoints.set(id, { x: (x - y) * this.tileWidth * .5,
                y: (this.mapHeight - 1 - x - y) * this.tileHeight * .5 });
        } else this.cityGroundPoints.delete(id);
        return true;
    }

    private onCityGroundChanged(ids: number[]): void {
        if (!this.terrainBytes || !this.riverTexture) return;
        const command = MapCommand.getInstance();
        let changed = false;
        for (const id of ids) {
            const x = id % this.mapWidth, y = Math.floor(id / this.mapWidth);
            if (this.setCityGround(id, command.isCityGroundCell(x, y))) changed = true;
        }
        if (!changed) return;
        // 合并一次 AOI 事件中的占地变化，仅上传一次；不在每帧创建纹理。
        this.riverTexture.uploadData(this.terrainBytes);
        this.cityPatchBlocks.clear();
        this.lastX = Infinity;
    }

    private patchOverCity(id: number): boolean {
        const cached = this.cityPatchBlocks.get(id);
        if (cached !== undefined) return cached;
        const patch = this.patches[id], size = WorldMapArt.size(patch.art);
        const height = patch.width * size.height / size.width * (patch.heightScale || 1);
        const left = patch.px - patch.width / 2, right = patch.px + patch.width / 2;
        const bottom = patch.py - height * (patch.anchorY ?? .22), top = bottom + height;
        // 包围盒只决定是否需要逐像素裁切，不能因为一个角重叠就隐藏整座山。
        for (const point of this.cityGroundPoints.values()) {
            const dx = Math.max(left - point.x, 0, point.x - right);
            const dy = Math.max(bottom - point.y, 0, point.y - top);
            if (dx / (this.tileWidth / 2) + dy / (this.tileHeight / 2) < 1 - 1e-9) {
                this.cityPatchBlocks.set(id, true); return true;
            }
        }
        this.cityPatchBlocks.set(id, false); return false;
    }

    protected onDisable(): void {
        if (this.decoration) this.decoration.active = false;
    }

    /** 上方山体轮廓也属于阻挡，不能穿过山体图像选到背后的土地。 */
    public blockerAt(point: Vec2): Vec2 | null {
        if (!this.decoration?.active || this.cityGroundAtPoint(point)) return null;
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
        this.updateClipTransform();
        const p = this.camera.node.position, visible = view.getVisibleSize();
        const halfHeight = this.camera.orthoHeight, halfWidth = halfHeight * visible.width / Math.max(1, visible.height);
        if (MapCommand.getInstance().proxy.strategic) { this.decoration.active = false; return; }
        if (!this.decoration.active) { this.decoration.active = true; this.lastHeight = 0; }
        if (Math.abs(p.x - this.lastX) < 60 && Math.abs(p.y - this.lastY) < 60
            && halfHeight === this.lastHeight && halfWidth === this.lastWidth) return;
        this.lastX = p.x; this.lastY = p.y; this.lastHeight = halfHeight; this.lastWidth = halfWidth;
        const wanted = new Set<number>();
        // 山脚连续铺设后，只查询视口附近的空间桶，避免每次移动遍历全图山体。
        for (let by = Math.floor((p.y - halfHeight - this.patchPaddingY) / 1024); by <= Math.floor((p.y + halfHeight + this.patchPaddingY) / 1024); by++) {
            for (let bx = Math.floor((p.x - halfWidth - this.patchPaddingX) / 1024); bx <= Math.floor((p.x + halfWidth + this.patchPaddingX) / 1024); bx++) {
                for (const id of this.patchBuckets.get(`${bx},${by}`) || []) {
                    const patch = this.patches[id];
                    if (Math.abs(patch.px - p.x) < halfWidth + this.patchPaddingX
                        && Math.abs(patch.py - p.y) < halfHeight + this.patchPaddingY) wanted.add(id);
                }
            }
        }
        let membershipChanged = false;
        for (const [id, node] of this.activePatches) if (!wanted.has(id)) {
            node.active = false; this.pool.push(node); this.activePatches.delete(id);
            membershipChanged = true;
        }
        for (const id of wanted) {
            const active = this.activePatches.get(id);
            const clip = this.patchOverCity(id) ? this.cityClipMaterial : this.mountainMaterial;
            if (active) { active.getComponent(Sprite).customMaterial = clip; continue; }
            const patch = this.patches[id];
            let node = this.pool.pop();
            if (!node) {
                node = new Node('Mountain'); node.layer = this.node.layer;
                node.addComponent(UITransform).setAnchorPoint(.5, .22); node.addComponent(Sprite);
                this.decoration.addChild(node);
            }
            const mountainSprite = node.getComponent(Sprite);
            WorldMapArt.apply(mountainSprite, patch.art, patch.width, () => {
                mountainSprite.customMaterial = this.patchOverCity(id) ? this.cityClipMaterial : this.mountainMaterial;
            });
            node.getComponent(Sprite).trim = false;
            node.getComponent(Sprite).customMaterial = clip;
            node.getComponent(UITransform).setAnchorPoint(.5, patch.anchorY ?? .22);
            node.setScale(patch.flipX ? -1 : 1, patch.heightScale || 1, 1);
            node.setPosition(patch.px, patch.py, 0); node.active = true; this.activePatches.set(id, node);
            membershipChanged = true;
        }
        // 山体相对位置不随相机变化；仅在出入视野时重排，避免平移持续打散渲染批次。
        if (membershipChanged) [...this.activePatches.values()].sort((a, b) => b.position.y - a.position.y)
            .forEach((node, index) => { if (node.getSiblingIndex() !== index) node.setSiblingIndex(index); });
    }

    protected onDestroy(): void {
        EventMgr.targetOff(this);
        if (this.decoration?.isValid) this.decoration.destroy();
        this.material?.destroy(); this.groundFrame?.destroy(); this.riverTexture?.destroy(); this.riverImage?.destroy();
        this.cityClipMaterial?.destroy();
        this.mountainMaterial?.destroy();
        this.activePatches.clear(); this.patchBuckets.clear(); this.pool.length = 0;
        this.cityGroundPoints.clear(); this.cityPatchBlocks.clear(); this.terrainBytes = null;
    }
}
