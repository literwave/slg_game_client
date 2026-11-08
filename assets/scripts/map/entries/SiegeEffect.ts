import { Color, Graphics, Node, Sprite, SpriteFrame, UIOpacity, UITransform, Vec2, isValid } from 'cc';
import { preloadSiegeSheet } from './SiegeAnimationLibrary';
import { siegeBeat, siegeProjectile, SIEGE_IMPACT_DURATION, SiegeLaunch } from './SiegeChoreography';
import type { SiegePhase } from './SiegeContact';

interface Picture { node: Node; sprite: Sprite; opacity: UIOpacity; }
interface Shot { projectile: Node; impact: Picture; }

/** Presentation only: release, flight and impact share the formation clock. */
export default class SiegeEffect {
    readonly node: Node;
    private frames: SpriteFrame[] | null = null;
    private shots: Shot[] = [];
    private smoke: Picture[] = [];
    private flame: Picture;
    private trails: Graphics;
    private disposed = false;

    constructor(host: Node) {
        this.node = new Node('SiegeEffect'); this.node.layer = host.layer; host.addChild(this.node);
        this.node.active = false;
        const trailNode = this.child('TorchTrails'); trailNode.addComponent(UITransform);
        this.trails = trailNode.addComponent(Graphics);
        for (let i = 0; i < 6; i++) {
            const projectile = this.child(`Torch${i + 1}`);
            projectile.addComponent(UITransform).setContentSize(14, 12);
            const g = projectile.addComponent(Graphics);
            g.lineWidth = 2; g.strokeColor = new Color(109, 65, 32, 255);
            g.moveTo(-5, 0); g.lineTo(2, 0); g.stroke();
            g.fillColor = new Color(242, 143, 46, 65); g.circle(2, 0, 5); g.fill();
            g.fillColor = new Color(245, 155, 48, 245);
            g.moveTo(-3, 0); g.lineTo(1, 3); g.lineTo(5, 0); g.lineTo(1, -2); g.close(); g.fill();
            g.fillColor = new Color(255, 225, 146, 255); g.circle(2, 0, 1.4); g.fill();
            this.shots.push({ projectile, impact: this.picture(`WallImpact${i + 1}`, 38, .4) });
        }
        for (let i = 0; i < 2; i++) this.smoke.push(this.picture(`WallSmoke${i + 1}`, 42 - i * 4, .22));
        this.flame = this.picture('WallEmber', 24, .22);
        void preloadSiegeSheet('siege-impact-v2').then(frames => {
            if (!this.disposed && isValid(this.node, true)) this.frames = frames;
        }).catch(error => console.warn('[SiegeEffect] Effect load failed', error));
    }

    private child(name: string): Node {
        const node = new Node(name); node.layer = this.node.layer; this.node.addChild(node); node.active = false;
        return node;
    }

    private picture(name: string, size: number, anchor: number): Picture {
        const node = this.child(name), ui = node.addComponent(UITransform);
        ui.setContentSize(size, size); ui.setAnchorPoint(.5, anchor);
        const sprite = node.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.trim = false;
        return { node, sprite, opacity: node.addComponent(UIOpacity) };
    }

    update(target: Vec2 | null, seconds: number, phase: SiegePhase = 'guards', durability = 1,
        sources: readonly SiegeLaunch[] = []): void {
        if (this.disposed) return;
        this.node.active = !!target && sources.length > 0;
        this.trails.clear();
        if (!target || !sources.length) {
            for (const shot of this.shots) { shot.projectile.active = false; shot.impact.node.active = false; }
            for (const smoke of this.smoke) smoke.node.active = false;
            this.flame.node.active = false;
            return;
        }
        this.trails.node.active = true;
        for (let i = sources.length; i < this.shots.length; i++) {
            this.shots[i].projectile.active = false; this.shots[i].impact.node.active = false;
        }
        const length = Math.max(1, Math.hypot(target.x, target.y));
        const tangentX = -target.y / length, tangentY = target.x / length * .5;
        for (let i = 0; i < Math.min(sources.length, this.shots.length); i++) {
            const source = sources[i], shot = this.shots[i];
            const spread = (source.index % 3 - 1) * 8;
            const contact = { x: target.x + tangentX * spread, y: target.y + tangentY * spread };
            const beat = siegeBeat(seconds, source.index, Math.hypot(contact.x - source.x, contact.y - source.y));
            // Graphics.onEnable rebuilds its material; never toggle a flying shot off/on every frame.
            shot.projectile.active = beat.flight >= 0;
            shot.impact.node.active = beat.impactAge >= 0 && !!this.frames;
            if (beat.flight >= 0) {
                const p = siegeProjectile(source, contact, beat.flight);
                shot.projectile.setPosition(p.x, p.y, 0); shot.projectile.angle = p.angle;
                for (let j = 3; j > 0; j--) {
                    const tail = siegeProjectile(source, contact, Math.max(0, beat.flight - j * .025));
                    const head = siegeProjectile(source, contact, Math.max(0, beat.flight - (j - 1) * .025));
                    this.trails.strokeColor = new Color(233, 164, 72, 90 - j * 20); this.trails.lineWidth = 1;
                    this.trails.moveTo(tail.x, tail.y); this.trails.lineTo(head.x, head.y); this.trails.stroke();
                }
            }
            if (beat.impactAge >= 0) {
                const progress = beat.impactAge / SIEGE_IMPACT_DURATION;
                if (this.frames) {
                    const impact = shot.impact;
                    impact.sprite.spriteFrame = this.frames[(phase === 'wall' ? 0 : 3) * 8 + Math.min(7, Math.floor(progress * 8))];
                    impact.node.setPosition(contact.x, contact.y, 0);
                    const scale = phase === 'wall' ? .9 : .65;
                    impact.node.setScale(scale, scale, 1); impact.opacity.opacity = Math.round(220 - progress * 165);
                }
                if (phase === 'wall') for (let chip = 0; chip < 5; chip++) {
                    const t = beat.impactAge, side = chip - 2;
                    this.trails.fillColor = new Color(161, 142, 105, Math.round((1 - progress) * 190));
                    this.trails.rect(contact.x + side * t * 24, contact.y + (22 + chip % 2 * 16) * t - 110 * t * t, 1.4, 1.4);
                    this.trails.fill();
                }
            }
        }
        // Persistent smoke represents server wall damage, never a healthy wall or the guard phase.
        const health = Number.isFinite(durability) ? Math.max(0, Math.min(1, durability)) : 1;
        const damagedWall = !!this.frames && phase === 'wall' && seconds >= 1.5 && health < .75;
        for (const smoke of this.smoke) smoke.node.active = damagedWall;
        this.flame.node.active = damagedWall && health < .35;
        if (!damagedWall) return;
        for (let i = 0; i < this.smoke.length; i++) {
            const smoke = this.smoke[i], age = ((seconds + i * 1.1) % 2.8) / 2.8;
            smoke.sprite.spriteFrame = this.frames[8 + Math.floor(age * 8)];
            smoke.opacity.opacity = Math.round(Math.sin(age * Math.PI) * (1 - health) * 95);
            smoke.node.setPosition(target.x + tangentX * (i ? 9 : -9) + age * 4,
                target.y + tangentY * (i ? 9 : -9) + age * 23, 0);
            smoke.node.setScale(.7 + age * .4, .7 + age * .4, 1);
        }
        if (health < .35) {
            this.flame.sprite.spriteFrame = this.frames[16 + Math.floor(seconds * 10) % 8];
            this.flame.node.setPosition(target.x, target.y, 0); this.flame.opacity.opacity = 150;
        }
    }

    destroy(): void {
        this.disposed = true;
        if (isValid(this.node, true)) { this.node.removeFromParent(); this.node.destroy(); }
        this.shots = []; this.smoke = []; this.frames = null;
    }
}
