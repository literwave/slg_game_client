import { Animation, Color, Graphics, Node, Sprite, UITransform, Vec2, isValid } from 'cc';
import type { TroopData } from '../../general/TroopProxy';
import MarchPlayback from '../../world/MarchPlayback';
import type { MarchSample } from '../../world/MarchPath';
import MapUtil from '../MapUtil';
import DateUtil from '../../utils/DateUtil';
import { loadMarchAnimations, MarchAnimationSet, MarchUnitKind } from './MarchAnimationLibrary';

interface Member {
    node: Node; animation: Animation; lag: number; side: number;
    sprite: Sprite; animations?: MarchAnimationSet;
    clip: string; moving: boolean; phase: number;
    foot?: Vec2;
}

/** 通用骑将带领步兵，不显示画像；队列只表达阵形，不冒充实际兵力数字。 */
export default class MarchFormation {
    readonly root: Node;
    private members: Member[] = [];
    private signature = '';
    private revision = 0;
    private heading = new Vec2(1, -.5).normalize();
    private groundHeading = new Vec2(1, 0);
    private lastMono = 0;

    constructor(private host: Node) {
        this.root = new Node('MarchFormation');
        this.root.layer = host.layer; host.addChild(this.root);
        host.getComponent(Animation)?.stop();
        const sprite = host.getComponent(Sprite); if (sprite) sprite.enabled = false;
        const animation = host.getComponent(Animation); if (animation) animation.enabled = false;
    }

    configure(troop: TroopData | null, own: boolean): void {
        const heroes = troop?.getSortedHeroes() || [];
        const soldiers = heroes.reduce((sum, h) => sum + troop.getSoldier(h.heroIdx).count, 0);
        const escortCount = troop ? (soldiers > 0 ? 6 : 0) : 4;
        const key = `${own}:${heroes.map(h => `${h.position}:${h.heroIdx}`).join(',')}:${escortCount}`;
        if (key === this.signature) return;
        this.signature = key; this.revision++;
        for (const member of this.members) { member.node.removeFromParent(); member.node.destroy(); }
        this.members = [];
        // lag 是路径上的逻辑格距离；队尾限制在领队后 0.44 格，避免队列拖出两格。
        // 收紧间距时同步缩小角色，保留主将、副将和步兵的大小层次。
        this.addMember('Commander', 'cavalry', 0, 0, 68);
        const deputies = troop ? Math.min(2, Math.max(0, heroes.length - 1)) : 2;
        for (let i = 0; i < deputies; i++) this.addMember(`Deputy${i + 1}`, 'cavalry', .22, i ? 26 : -26, 56);
        for (let i = 0; i < escortCount; i++) {
            const row = Math.floor(i / 2);
            this.addMember(`Soldier${i + 1}`, 'infantry', .30 + row * .07, i % 2 ? 14 : -14, 40);
        }
    }

    private addMember(name: string, kind: MarchUnitKind, lag: number, side: number, size: number): void {
        const node = new Node(name); node.layer = this.host.layer; this.root.addChild(node);
        const shadow = new Node('GroundShadow'); shadow.layer = node.layer; node.addChild(shadow);
        shadow.addComponent(UITransform);
        const shadowG = shadow.addComponent(Graphics); shadowG.fillColor = new Color(20, 24, 17, 75);
        const shadowWidth = kind === 'cavalry' ? size * .20 : size * .14;
        shadowG.ellipse(0, 0, shadowWidth, shadowWidth * .34); shadowG.fill();
        const body = new Node('Body'); body.layer = node.layer; node.addChild(body);
        const transform = body.addComponent(UITransform);
        transform.setContentSize(size, size);
        transform.setAnchorPoint(.5, .04);
        const sprite = body.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        const animation = body.addComponent(Animation);
        body.active = false;
        const member: Member = { node, animation, sprite, lag, side, clip: '', moving: false, phase: this.members.length * .071 };
        this.members.push(member);
        const revision = this.revision;
        void loadMarchAnimations(kind).then(animations => {
            if (revision !== this.revision || !isValid(body)) return;
            member.animations = animations;
            animations.clips.forEach(clip => animation.addClip(clip));
            sprite.spriteFrame = animations.idleFrames[7];
            body.active = true;
        }).catch(() => { /* 共享加载器已经报告具体资源错误。 */ });
    }

    update(playback: MarchPlayback, sample: MarchSample): void {
        const now = DateUtil.monotonicNow();
        const dt = this.lastMono ? Math.min(.1, Math.max(0, (now - this.lastMono) / 1000)) : 0;
        this.lastMono = now;
        const center = MapUtil.mapCellToPixelPoint(new Vec2(sample.position.x, sample.position.y));
        const next = MapUtil.mapCellToPixelPoint(new Vec2(sample.towards.x, sample.towards.y));
        if (Vec2.distance(center, next) > .01) {
            this.heading.set(next.x - center.x, next.y - center.y).normalize();
            this.groundHeading.set(sample.towards.x - sample.position.x, sample.towards.y - sample.position.y).normalize();
        }
        for (const member of this.members) {
            // 行军沿路径跟随；到达后按最后一段朝向收队，不能永远停在拐点两侧。
            const tail = sample.moving && playback.path.length > 0 ? playback.behind(member.lag) : null;
            const foot = tail ? MapUtil.mapCellToPixelPoint(new Vec2(tail.position.x, tail.position.y))
                : MapUtil.mapCellToPixelPoint(new Vec2(sample.position.x - this.groundHeading.x * member.lag,
                    sample.position.y - this.groundHeading.y * member.lag));
            // 领队跟随同一平滑后的坐标；队员沿拐点逐个转弯。
            if (!member.lag) foot.set(center);
            const direction = tail && playback.path.length > 0
                ? MapUtil.mapCellToPixelPoint(new Vec2(tail.towards.x, tail.towards.y)).subtract(foot) : this.heading.clone();
            if (direction.lengthSqr() < .0001) direction.set(this.heading);
            direction.normalize();
            foot.x -= direction.y * member.side; foot.y += direction.x * member.side * .6;
            if (!member.foot || !member.lag) member.foot = foot.clone();
            else {
                // 改道/折返不把队员瞬间镜像到队头另一侧，短暂跟随后重新排齐。
                const blend = 1 - Math.exp(-dt / (sample.moving ? .09 : .12));
                const dx = (foot.x - member.foot.x) * blend, dy = (foot.y - member.foot.y) * blend;
                member.foot.x += dx; member.foot.y += dy;
                // 收队时保持最终朝向，避免接近落点时被微小修正反复带着转身。
                if (sample.moving && Math.hypot(dx, dy) > .01) direction.set(dx, dy).normalize();
            }
            const settling = !sample.moving && Vec2.distance(member.foot, foot) > .15;
            // 结束渐近跟随，停驻后位置和朝向保持稳定；每个队员走完再切换站立。
            if (!sample.moving && !settling) member.foot.set(foot);
            member.node.setPosition(member.foot.x - center.x, member.foot.y - center.y, 0);
            const facing = (Math.round(Math.atan2(direction.y, direction.x) / (Math.PI / 4)) + 8) % 8;
            const clip = member.animations?.clips[facing]?.name;
            const moving = sample.moving || settling;
            if (clip && (member.clip !== clip || member.moving !== moving)) {
                if (moving) {
                    member.animation.play(clip);
                    const state = member.animation.getState(clip);
                    if (state) {
                        state.time = (now / 1000 + member.phase) % state.duration;
                        state.sample();
                    }
                } else {
                    member.animation.stop();
                    member.sprite.spriteFrame = member.animations.idleFrames[facing];
                }
                member.clip = clip; member.moving = moving;
            }
        }
        this.members.slice().sort((a, b) => b.node.position.y - a.node.position.y)
            .forEach((member, i) => member.node.setSiblingIndex(i));
    }

    destroy(): void {
        this.revision++;
        this.root.removeFromParent(); this.root.destroy(); this.members = [];
        const sprite = this.host.getComponent(Sprite); if (sprite) sprite.enabled = true;
        const animation = this.host.getComponent(Animation); if (animation) animation.enabled = true;
    }
}
