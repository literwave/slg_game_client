import { Color, Label, Mask, Node, resources, Sprite, SpriteFrame, UITransform } from 'cc';
import { reportConfig, reportUnitName } from '../../battle/ReportPresentation';
import { getGeneralPortraitPath } from '../../general/GeneralPortrait';
import LoginCommand from '../../login/LoginCommand';
import { caption, inkSurface, ManagementColors as C, place } from './ManagementStyle';

const portraits = new Map<string, SpriteFrame>();
const loading = new Map<string, Promise<SpriteFrame | null>>();

/** 配置画像优先；未配置画像的守军按兵种使用本地通用画像。 */
export function reportUnitPortraitPath(side: any, unit: any): string {
    const npc = String(side?.ownerId || 0) === '0';
    const config = reportConfig(npc ? 'Monster' : 'Hero', unit?.cfgId);
    if (!npc) {
        const heads = LoginCommand.getInstance().headIcons;
        const head = heads.configs.find(row => row.heroId === Number(unit?.cfgId));
        if (head) return heads.getIconPath(head.id);
    }
    if (config?.Icon) return getGeneralPortraitPath(config.Icon);
    if (!npc) return '';
    const name = reportUnitName(side, unit);
    const kind = /头目|大帅|魔王|首领|统领/.test(name) ? 'captain' : /骑/.test(name) ? 'cavalry'
        : /弓|弩/.test(name) ? 'archer' : 'infantry';
    return `ui/report_units/${kind}/spriteFrame`;
}

export function reportUnitArt(parent: Node, side: any, unit: any, x: number, y: number, size: number,
    options: { depleted?: boolean } = {}): Node {
    const node = new Node('Portrait'); node.layer = parent.layer; parent.addChild(node); place(node, x, y, size, size);
    inkSurface(node, 'Frame', size, size, new Color(59, 58, 44), options.depleted ? new Color(122, 84, 69) : C.gold);
    const path = reportUnitPortraitPath(side, unit);
    const glyph = caption(node, 'Glyph', '兵', 0, 0, size - 4, Math.floor(size * .55), C.gold, Label.HorizontalAlign.CENTER);
    const apply = (frame: SpriteFrame | null) => {
        if (!frame || !node.isValid) return;
        glyph.node.active = false;
        const clip = new Node('Crop'); clip.layer = node.layer; node.addChild(clip); place(clip, 0, 0, size - 2, size - 2);
        clip.setSiblingIndex(1);
        clip.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const image = new Node('Image'); image.layer = node.layer; clip.addChild(image);
        const sprite = image.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.spriteFrame = frame;
        if (options.depleted) sprite.color = new Color(205, 198, 185);
        const ratio = (size - 2) / frame.originalSize.width;
        place(image, 0, -(frame.originalSize.height * ratio - size) / 2, size - 2, frame.originalSize.height * ratio);
    };
    const frame = path ? portraits.get(path) || resources.get(path, SpriteFrame) : null;
    if (frame) apply(frame);
    else if (path) {
        if (!loading.has(path)) loading.set(path, new Promise(resolve => {
            resources.load(path, SpriteFrame, (error, asset) => {
                loading.delete(path);
                if (error || !(asset instanceof SpriteFrame)) { resolve(null); return; }
                portraits.set(path, asset); resolve(asset);
            });
        }));
        void loading.get(path).then(apply);
    }
    return node;
}
