import { Button, Color, EventTouch, Label, Node, Sprite, UIOpacity, UITransform, Vec2, Vec3 } from 'cc';
import CityGeneralItemLogic from './CityGeneralItemLogic';
import { caption, inkSurface, ManagementColors as C, place } from './ManagementStyle';

/** 卡片仍可点开详情；越过拖动阈值才接管输入，松手只提交一次换位。 */
export default class TroopDragInteraction {
    private source = -1;
    private target = -1;
    private touchId = -1;
    private origin = new Vec2();
    private dragging = false;
    private snapshot = '';
    private ghost: Node = null;
    private outlines: Node[] = [];
    private muted: UIOpacity = null;
    private oldOpacity = 255;
    private buttons: Array<{ button: Button; enabled: boolean }> = [];
    constructor(private root: Node, private cards: CityGeneralItemLogic[],
        private canEdit: () => boolean, private commit: (from: number, to: number) => void) {
        for (const card of cards) {
            card.node.on(Node.EventType.TOUCH_START, this.start, this, true);
            card.node.on(Node.EventType.TOUCH_MOVE, this.move, this, true);
            card.node.on(Node.EventType.TOUCH_END, this.end, this, true);
            card.node.on(Node.EventType.TOUCH_CANCEL, this.abort, this, true);
        }
    }
    destroy(): void {
        this.cancel();
        for (const card of this.cards) {
            card.node.off(Node.EventType.TOUCH_START, this.start, this, true);
            card.node.off(Node.EventType.TOUCH_MOVE, this.move, this, true);
            card.node.off(Node.EventType.TOUCH_END, this.end, this, true);
            card.node.off(Node.EventType.TOUCH_CANCEL, this.abort, this, true);
        }
        if (this.ghost?.isValid) this.ghost.destroy();
        this.outlines.forEach(n => { if (n?.isValid) n.destroy(); });
    }
    private roster(): string { return this.cards.map(c => c.formationHeroId).join(':'); }
    private start(e: EventTouch): void {
        if (this.touchId !== -1 || !this.canEdit()) return;
        const index = this.cards.findIndex(c => c.node === e.currentTarget);
        const card = this.cards[index];
        if (!card?.formationUnlocked || !card.formationHeroId) return;
        for (let n = e.target as Node; n && n !== card.node; n = n.parent) if (n === card.btnDown) return;
        this.source = index; this.touchId = e.getID(); this.target = -1;
        this.origin.set(e.getUILocation()); this.snapshot = this.roster();
    }
    private move(e: EventTouch): void {
        if (e.getID() !== this.touchId || this.source < 0) return;
        if (!this.canEdit() || this.snapshot !== this.roster()) { this.cancel(); return; }
        const p = e.getUILocation();
        if (!this.dragging) {
            if (Vec2.squaredDistance(this.origin, p) < 64) return;
            this.dragging = true;
            const card = this.cards[this.source];
            card.suppressDragClick();
            this.muted = card.node.getComponent(UIOpacity) || card.node.addComponent(UIOpacity);
            this.oldOpacity = this.muted.opacity; this.muted.opacity = 110;
            this.buttons = card.node.getComponentsInChildren(Button).map(button => ({ button, enabled: button.enabled }));
            this.buttons.forEach(({ button }) => button.enabled = false);
            this.showGhost(card);
        }
        e.propagationStopped = true;
        const local = this.root.getComponent(UITransform).convertToNodeSpaceAR(new Vec3(p.x, p.y, 0));
        this.ghost.setPosition(local.x, local.y + 32, 0);
        this.target = this.cards.findIndex((card, i) => i !== this.source && card.formationUnlocked
            && card.node.getComponent(UITransform).getBoundingBoxToWorld().contains(p));
        this.cards.forEach((card, i) => {
            let outline = this.outlines[i];
            if (!outline && i === this.target) {
                const ui = card.node.getComponent(UITransform);
                const g = inkSurface(card.node, 'FormationDropTarget', ui.width - 4, ui.height - 4,
                    new Color(197, 166, 108, 24), C.gold);
                outline = this.outlines[i] = g.node; outline.setSiblingIndex(card.node.children.length - 1);
            }
            if (outline) outline.active = i === this.target;
        });
    }
    private end(e: EventTouch): void {
        if (e.getID() !== this.touchId) return;
        const p = e.getUILocation();
        const from = this.source, to = this.cards.findIndex((card, i) => i !== from && card.formationUnlocked
            && card.node.getComponent(UITransform).getBoundingBoxToWorld().contains(p));
        const submit = this.dragging && to >= 0 && this.canEdit() && this.snapshot === this.roster();
        if (this.dragging) { e.propagationStopped = true; this.cards[from].suppressDragClick(); }
        this.cancel();
        if (submit) this.commit(from, to);
    }
    private abort(e: EventTouch): void { if (e.getID() === this.touchId) this.cancel(); }
    cancel(): void {
        if (this.dragging && this.source >= 0) this.cards[this.source].suppressDragClick();
        if (this.muted?.isValid) this.muted.opacity = this.oldOpacity;
        this.buttons.forEach(({ button, enabled }) => { if (button.isValid) button.enabled = enabled; });
        this.buttons = []; this.muted = null;
        this.outlines.forEach(n => { if (n?.isValid) n.active = false; });
        if (this.ghost?.isValid) this.ghost.active = false;
        this.source = this.target = this.touchId = -1; this.dragging = false;
    }
    private showGhost(card: CityGeneralItemLogic): void {
        if (!this.ghost) {
            this.ghost = new Node('FormationDragGhost'); this.ghost.layer = this.root.layer;
            this.root.addChild(this.ghost); this.ghost.addComponent(UITransform);
            this.ghost.addComponent(UIOpacity).opacity = 235;
            place(this.ghost, 0, 0, 108, 154);
            inkSurface(this.ghost, 'Surface', 108, 154, C.ink, C.gold);
            const portrait = new Node('Portrait'); portrait.layer = this.root.layer; this.ghost.addChild(portrait);
            portrait.addComponent(UITransform); portrait.addComponent(Sprite).sizeMode = Sprite.SizeMode.CUSTOM;
            place(portrait, 0, 10, 80, 110);
        }
        this.ghost.active = true; this.ghost.setSiblingIndex(this.root.children.length - 1);
        this.ghost.getChildByName('Portrait').getComponent(Sprite).spriteFrame = card.headIcon.spriteFrame;
        caption(this.ghost, 'Name', card.labelName.string, 0, -62, 96, 14, C.text, Label.HorizontalAlign.CENTER);
    }
}
