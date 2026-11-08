import { Color, Node, Rect, resources, Size, Sprite, SpriteFrame, UITransform, Vec2, isValid } from 'cc';
import { CavalryForelegRig, ForelegPoint, solveCavalryForelegPose } from './CavalryForelegPose';

// One shared texture, distinct limb tracks. Front legs cannot exchange identity
// or grow hooked toes between generated drawings.
const RECTS = [
    [30, 0, 396, 426], [578, 13, 170, 410], [1060, 13, 104, 414], [1484, 164, 160, 160],
    [120, 455, 196, 414], [606, 455, 128, 414], [1044, 605, 160, 158],
];
let pending: Promise<SpriteFrame[]>;
function loadParts(): Promise<SpriteFrame[]> {
    if (pending) return pending;
    pending = new Promise((resolve, reject) => {
        resources.load('ui/march/commander_foreleg_rig_v7/spriteFrame', SpriteFrame, (error, sheet) => {
            if (error) { reject(error); return; }
            if (!(sheet instanceof SpriteFrame) || !sheet.texture) {
                reject(new Error('Cavalry walk rig has no texture')); return;
            }
            sheet.addRef();
            resolve(RECTS.map(([x, y, width, height], index) => {
                const frame = new SpriteFrame();
                frame.name = `cavalry_rig_v7_${index}`;
                frame.reset({ texture: sheet.texture, rect: new Rect(x, y, width, height),
                    originalSize: new Size(width, height), offset: new Vec2() });
                frame.packable = false; frame.addRef(); return frame;
            }));
        });
    });
    void pending.catch(error => console.error('[CavalryWalkRig]', error));
    return pending;
}

interface Leg { upper: Node; lower: Node; hoof: Node; rig: CavalryForelegRig; phase: number; }

/** Shallow front view and its mirror; other directions retain their own art. */
export class CavalryWalkRig {
    readonly root: Node;
    ready = false;
    private legs: Leg[] = [];

    constructor(parent: Node, size: number) {
        this.root = new Node('GroundedCavalry'); this.root.layer = parent.layer;
        parent.addChild(this.root); this.root.setScale(size / 256, size / 256, 1);
        this.root.active = false;
        void loadParts().then(parts => {
            if (!isValid(this.root, true)) return;
            // Far legs are shaded and separated from the near-side tracks.
            this.addLeg(parts, 'FarHind', true, true, { x: 105, y: 153 }, { x: 102, y: 203 }, 26, 30, .25);
            this.addLeg(parts, 'FarFore', false, true, { x: 166, y: 161 }, { x: 172, y: 211 }, 27, 31, .5);
            this.addLeg(parts, 'NearHind', true, false, { x: 87, y: 164 }, { x: 82, y: 217 }, 28, 32, .75);
            this.addLeg(parts, 'NearFore', false, false, { x: 149, y: 169 }, { x: 151, y: 226 }, 30, 34, 0);
            const body = this.sprite('Torso', parts[0], 164, 176, .5, .5);
            this.place(body, { x: 128, y: 98 });
            this.ready = true;
        }).catch(() => { /* The shared loader reports once; existing sprite remains visible. */ });
    }

    private sprite(name: string, frame: SpriteFrame, width: number, height: number, ax: number, ay: number): Node {
        const node = new Node(name); node.layer = this.root.layer; this.root.addChild(node);
        const transform = node.addComponent(UITransform); transform.setContentSize(width, height); transform.setAnchorPoint(ax, ay);
        const sprite = node.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.trim = false; sprite.spriteFrame = frame;
        return node;
    }

    private addLeg(parts: SpriteFrame[], name: string, hind: boolean, far: boolean,
        shoulder: ForelegPoint, restHoof: ForelegPoint, upperLength: number, lowerLength: number, phase: number): void {
        const upper = this.sprite(`${name}Upper`, parts[hind ? 4 : 1], hind ? 19 : 15, upperLength + 7, .5, .91);
        const lower = this.sprite(`${name}Lower`, parts[hind ? 5 : 2], 10, lowerLength + 6, .5, .93);
        const hoof = this.sprite(`${name}Hoof`, parts[hind ? 6 : 3], 12, 9, .5, .85);
        if (far) for (const node of [upper, lower, hoof]) node.getComponent(Sprite).color = new Color(191, 191, 191, 255);
        this.legs.push({ upper, lower, hoof, phase, rig: { shoulder, restHoof, upperLength, lowerLength,
            strideVector: { x: 18, y: 9 }, lift: 3, bendSign: hind ? 1 : -1,
            supportFlexDegrees: hind ? 28 : 12, swingFlexDegrees: hind ? 42 : 28 } });
    }

    private place(node: Node, point: ForelegPoint): void { node.setPosition(point.x - 128, 238 - point.y, 0); }

    setVisible(visible: boolean): void { this.root.active = visible && this.ready; }

    sample(phase: number, moving = true): void {
        for (const leg of this.legs) {
            const pose = solveCavalryForelegPose(phase + leg.phase, leg.rig, moving);
            this.place(leg.upper, pose.shoulder); this.place(leg.lower, pose.knee); this.place(leg.hoof, pose.hoof);
            leg.upper.angle = Math.atan2(pose.knee.x - pose.shoulder.x, pose.knee.y - pose.shoulder.y) * 180 / Math.PI;
            leg.lower.angle = Math.atan2(pose.hoof.x - pose.knee.x, pose.hoof.y - pose.knee.y) * 180 / Math.PI;
            leg.hoof.angle = pose.hoofAngle;
        }
    }
}
