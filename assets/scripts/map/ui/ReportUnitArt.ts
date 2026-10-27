import { Color, Label, Mask, Node, resources, Sprite, SpriteFrame, UITransform } from 'cc';
import { reportConfig, reportUnitName } from '../../battle/ReportPresentation';
import { getGeneralPortraitPath } from '../../general/GeneralPortrait';
import { caption, inkSurface, ManagementColors as C, place } from './ManagementStyle';

/** 复用进场已加载的武将画像；无美术的守军用兵种徽记。 */
export function reportUnitArt(parent: Node, side: any, unit: any, x: number, y: number, size: number): Node {
    const node = new Node('Portrait'); node.layer = parent.layer; parent.addChild(node); place(node, x, y, size, size);
    inkSurface(node, 'Frame', size, size, new Color(59, 58, 44), C.line);
    const config = reportConfig(String(side?.ownerId || 0) === '0' ? 'Monster' : 'Hero', unit.cfgId);
    const path = getGeneralPortraitPath(config?.Icon);
    const frame = path ? resources.get(path, SpriteFrame) : null;
    if (frame) {
        const clip = new Node('Crop'); clip.layer = node.layer; node.addChild(clip); place(clip, 0, 0, size - 2, size - 2);
        clip.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const image = new Node('Image'); image.layer = node.layer; clip.addChild(image);
        const sprite = image.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.spriteFrame = frame;
        const ratio = (size - 2) / frame.originalSize.width;
        place(image, 0, -(frame.originalSize.height * ratio - size) / 2, size - 2, frame.originalSize.height * ratio);
    } else {
        const name = reportUnitName(side, unit), glyph = name.indexOf('骑') >= 0 ? '骑' : name.indexOf('弓') >= 0 ? '弓' : name.indexOf('步') >= 0 ? '步' : '兵';
        caption(node, 'Glyph', glyph, 0, 0, size - 4, Math.floor(size * .55), C.gold, Label.HorizontalAlign.CENTER);
    }
    return node;
}
