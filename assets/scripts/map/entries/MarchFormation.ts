import { Animation, Color, Graphics, Node, Sprite, UITransform, Vec2, isValid } from 'cc';
import GeneralCommand from '../../general/GeneralCommand';
import type { TroopData } from '../../general/TroopProxy';
import MarchPlayback from '../../world/MarchPlayback';
import type { MarchSample } from '../../world/MarchPath';
import MapUtil from '../MapUtil';
import DateUtil from '../../utils/DateUtil';

interface Member {
    node: Node; animation: Animation; lag: number; side: number;
    clip: string; moving: boolean; phase: number;
    foot?: Vec2;
}
const DIRECTIONS = ['r', 'ru', 'u', 'lu', 'l', 'ld', 'd', 'rd'];

/** 主将军旗使用真实画像，副将按实际槽位显示；步兵只表示队列，不冒充兵力数字。 */
export default class MarchFormation {
    readonly root: Node;
    private members: Member[] = [];
    private signature = '';
    private revision = 0;
    private heading = new Vec2(1, -.5).normalize();
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
        const color = own ? new Color(111, 190, 233, 240) : new Color(237, 188, 98, 240);
        // 未知阵容只画通用领队，不把别人的武将套到当前实体上。
        this.addMember('Commander', 0, 0, 1.03, heroes[0]?.heroIdx || 0, color, true);
        heroes.slice(1, 3).forEach((hero, i) => this.addMember(`Deputy${i + 1}`, .36, i ? 24 : -24, .83, hero.heroIdx, color));
        for (let i = 0; i < escortCount; i++) {
            const row = Math.floor(i / 2);
            this.addMember(`Soldier${i + 1}`, .70 + row * .26, i % 2 ? 20 : -20, .62, 0, color);
        }
    }

    private addMember(name: string, lag: number, side: number, scale: number, heroId: number, color: Color, leader = false): void {
        const node = new Node(name); node.layer = this.host.layer; this.root.addChild(node);
        const shadow = new Node('GroundShadow'); shadow.layer = node.layer; node.addChild(shadow);
        shadow.addComponent(UITransform);
        const shadowG = shadow.addComponent(Graphics); shadowG.fillColor = new Color(20, 24, 17, 75);
        shadowG.ellipse(0, 0, 12 * scale, 5 * scale); shadowG.fill();
        const body = new Node('Body'); body.layer = node.layer; node.addChild(body);
        const transform = body.addComponent(UITransform);
        const template = this.host.getComponent(UITransform);
        transform.setContentSize(template?.contentSize.width || 36, template?.contentSize.height || 94);
        transform.setAnchorPoint(.5, 0);
        body.setScale(scale, scale, 1);
        const sprite = body.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.spriteFrame = this.host.getComponent(Sprite)?.spriteFrame || null;
        const animation = body.addComponent(Animation);
        const clips = this.host.getComponent(Animation)?.clips || [];
        for (const clip of clips) if (clip) animation.addClip(clip);
        const member: Member = { node, animation, lag, side, clip: '', moving: false, phase: this.members.length * .071 };
        this.members.push(member);
        if (heroId) this.addBanner(node, heroId, leader, color);
    }

    private addBanner(parent: Node, heroId: number, leader: boolean, color: Color): void {
        const banner = new Node(`HeroBanner_${heroId}`); banner.layer = parent.layer; parent.addChild(banner);
        const width = leader ? 34 : 24, height = leader ? 45 : 32;
        banner.setPosition(leader ? -24 : -18, leader ? 53 : 43, 0);
        banner.addComponent(UITransform).setContentSize(width + 4, height + 8);
        const g = banner.addComponent(Graphics);
        g.strokeColor = new Color(79, 61, 33, 255); g.lineWidth = 2;
        g.moveTo(-width / 2 - 3, -28); g.lineTo(-width / 2 - 3, height / 2 + 4); g.stroke();
        g.fillColor = new Color(35, 37, 28, 255); g.strokeColor = color; g.lineWidth = leader ? 2 : 1;
        g.rect(-width / 2 - 2, -height / 2 - 2, width + 4, height + 4); g.fill(); g.stroke();
        g.fillColor = color; g.moveTo(-width / 2 - 2, -height / 2 - 2);
        g.lineTo(0, -height / 2 - 9); g.lineTo(width / 2 + 2, -height / 2 - 2); g.close(); g.fill();
        const picture = new Node('Portrait'); picture.layer = parent.layer; banner.addChild(picture);
        picture.addComponent(UITransform).setContentSize(width, height);
        const sprite = picture.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        const revision = this.revision;
        void GeneralCommand.getInstance().proxy.loadGeneralTex(heroId).then(frame => {
            if (revision !== this.revision || !isValid(picture) || !frame) return;
            sprite.spriteFrame = frame;
        }).catch(() => { /* 画像失败保留军旗与行走动画，不阻断队列。 */ });
    }

    update(playback: MarchPlayback, sample: MarchSample): void {
        const now = DateUtil.monotonicNow();
        const dt = this.lastMono ? Math.min(.1, Math.max(0, (now - this.lastMono) / 1000)) : 0;
        this.lastMono = now;
        const center = MapUtil.mapCellToPixelPoint(new Vec2(sample.position.x, sample.position.y));
        const next = MapUtil.mapCellToPixelPoint(new Vec2(sample.towards.x, sample.towards.y));
        if (sample.moving && Vec2.distance(center, next) > .01) this.heading.set(next.x - center.x, next.y - center.y).normalize();
        for (const member of this.members) {
            const tail = playback.path.length > 0 ? playback.behind(member.lag) : null;
            const foot = tail ? MapUtil.mapCellToPixelPoint(new Vec2(tail.position.x, tail.position.y))
                : new Vec2(center.x - this.heading.x * member.lag * 115, center.y - this.heading.y * member.lag * 115);
            // 领队跟随同一平滑后的坐标；队员沿拐点逐个转弯。
            if (!member.lag) foot.set(center);
            const direction = tail && playback.path.length > 0
                ? MapUtil.mapCellToPixelPoint(new Vec2(tail.towards.x, tail.towards.y)).subtract(foot) : this.heading.clone();
            if (direction.lengthSqr() < .0001) direction.set(this.heading);
            direction.normalize();
            foot.x -= direction.y * member.side; foot.y += direction.x * member.side * .6;
            const settling = !!member.foot && Vec2.distance(member.foot, foot) > .5;
            if (!member.foot || !member.lag) member.foot = foot.clone();
            else {
                // 改道/折返不把队员瞬间镜像到队头另一侧，短暂跟随后重新排齐。
                const blend = 1 - Math.exp(-dt / .09);
                const dx = (foot.x - member.foot.x) * blend, dy = (foot.y - member.foot.y) * blend;
                member.foot.x += dx; member.foot.y += dy;
                if (Math.hypot(dx, dy) > .01) direction.set(dx, dy).normalize();
            }
            member.node.setPosition(member.foot.x - center.x, member.foot.y - center.y, 0);
            const facing = (Math.round(Math.atan2(direction.y, direction.x) / (Math.PI / 4)) + 8) % 8;
            const clip = `qb_run_${DIRECTIONS[facing]}`;
            const moving = sample.moving || settling;
            if (member.clip !== clip || member.moving !== moving) {
                member.animation.play(clip);
                const state = member.animation.getState(clip);
                if (state) state.time = member.phase;
                if (!moving) member.animation.pause();
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
