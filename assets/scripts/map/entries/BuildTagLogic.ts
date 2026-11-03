import { _decorator, Component, Node, Sprite, UITransform } from 'cc';
import MapCommand from "../MapCommand";
import { MapResData } from "../MapProxy";
import MapUtil from '../MapUtil';
import WorldMapArt, { MAP_BOOKMARK_ART } from '../WorldMapArt';
const { ccclass, property } = _decorator;

/** 地图收藏标记，与部队军旗无关；只展示，不接管地图输入。 */
@ccclass('BuildTagLogic')
export default class BuildTagLogic extends Component {
    protected _data: MapResData = null;

    @property(Node)
    tagIconNode: Node = null;

    private flag: Sprite = null;
    private markerScale = -1;

    protected onLoad(): void {
        this.prepareFlag();
        this.tagIconNode.active = false;
    }

    protected onDisable(): void {
        this._data = null;
        this.tagIconNode.active = false;
    }

    public setResourceData(data: MapResData): void {
        this._data = data;
        this.updateUI();
    }

    public updateUI(): void {
        this.prepareFlag();
        this.tagIconNode.active = !!this._data
            && MapCommand.getInstance().proxy.isPosTag(this._data.x, this._data.y);
        // 标记底座贴在格子左后侧，给资源图案和部队留出空间。
        this.tagIconNode.setPosition(-MapUtil.tileSize.width * .12, MapUtil.tileSize.height * .12, 0);
    }

    /** 近景最多 52 屏幕像素；远景渐缩至约 20，避免缩成难辨的小点。 */
    public setZoom(zoom: number): void {
        const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
        const scale = safeZoom * Math.max(.38, Math.min(1, 1 / Math.sqrt(safeZoom)));
        if (scale === this.markerScale) return;
        this.markerScale = scale;
        this.tagIconNode.setScale(scale, scale, 1);
    }

    private prepareFlag(): void {
        if (this.flag instanceof Sprite) return;
        // 兼容已缓存的旧 Prefab，但始终使用同一张已预加载的专用原画。
        let node = this.tagIconNode.getChildByName('BookmarkBanner')
            || this.tagIconNode.getChildByName('New Sprite');
        if (node?.getComponent('cc.Graphics')) {
            node.active = false;
            node.removeFromParent();
            node.destroy();
            node = null;
        }
        if (!node) {
            node = new Node('BookmarkBanner');
            this.tagIconNode.addChild(node);
        }
        const old = this.tagIconNode.getChildByName('New Sprite');
        if (old && old !== node) old.active = false;
        node.name = 'BookmarkBanner';
        node.layer = this.tagIconNode.layer;
        node.active = true;
        node.setPosition(0, 0, 0);
        node.setScale(1, 1, 1);
        const bounds = node.getComponent(UITransform) || node.addComponent(UITransform);
        const sprite = node.getComponent(Sprite) || node.addComponent(Sprite);
        sprite.customMaterial = null;
        sprite.enabled = true;
        sprite.trim = false;
        const frame = WorldMapArt.frame(MAP_BOOKMARK_ART);
        WorldMapArt.apply(sprite, MAP_BOOKMARK_ART, 52 * frame.originalSize.width / frame.originalSize.height);
        bounds.setAnchorPoint(.45, .045);
        const ui = this.tagIconNode.getComponent(UITransform);
        ui.setContentSize(bounds.contentSize);
        ui.setAnchorPoint(.45, .045);
        this.flag = sprite;
    }
}
