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
    clip: string; moving: boolean; dustPhase: number; facing: number;
    guardPose: boolean;
    foot?: Vec2;
    arrivalFoot?: Vec2;
}

/** 通用骑将带领步兵，不显示画像；队列只表达阵形，不冒充实际兵力数字。 */
export default class MarchFormation {
    readonly root: Node;
    private members: Member[] = [];
    private signature = '';
    private revision = 0;
    private heading = new Vec2(1, -.5).normalize();
    private groundHeading = new Vec2(1, 0);
    private previousCenter: Vec2 | null = null;
    private lastMono = 0;
    private gaitTime = 0;
    private wasMarching = false;
    private stopElapsed = .18;
    private stopGait = 0;
    private stopContact = 0;
    private dust: Graphics;
    private dustElapsed = 0;
    private dustVisible = false;
    private guarding = false;

    constructor(private host: Node) {
        this.root = new Node('MarchFormation');
        this.root.layer = host.layer; host.addChild(this.root);
        const dust = new Node('MarchDust'); dust.layer = host.layer; this.root.addChild(dust);
        dust.addComponent(UITransform);
        this.dust = dust.addComponent(Graphics);
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
        // 骑将与两排护卫组成紧凑方阵，六名护卫三列并进，落脚点跨度不足 0.4 格。
        // 这里的间距是地面格坐标，不随行军速度额外拉长。
        this.addMember('Commander', 'cavalry', 0, 0, 74);
        const columns = escortCount >= 6 ? 3 : 2;
        for (let i = 0; i < escortCount; i++) {
            const row = Math.floor(i / columns), rowCount = Math.min(columns, escortCount - row * columns);
            this.addMember(`Soldier${i + 1}`, 'infantry', .22 + row * .15,
                (i % columns - (rowCount - 1) / 2) * .13, 48);
        }
    }

    /** 占领倒计时期间举起兵器防守；行军途中不生效。 */
    setGuarding(on: boolean): void {
        if (this.guarding === on) return;
        this.guarding = on;
        this.root.setPosition(on ? 22 : 0, on ? -10 : 0, 0);
        for (const member of this.members) this.applyPose(member, member.moving);
    }

    private addMember(name: string, kind: MarchUnitKind, lag: number, side: number, size: number): void {
        const node = new Node(name); node.layer = this.host.layer; this.root.addChild(node);
        const shadow = new Node('GroundShadow'); shadow.layer = node.layer; node.addChild(shadow);
        shadow.addComponent(UITransform);
        const shadowG = shadow.addComponent(Graphics);
        const shadowWidth = kind === 'cavalry' ? size * .23 : size * .13;
        for (const [scale, alpha] of [[1, 18], [.78, 24], [.52, 30]]) {
            shadowG.fillColor = new Color(22, 27, 18, alpha);
            shadowG.ellipse(0, 0, shadowWidth * scale, shadowWidth * scale * .36); shadowG.fill();
        }
        const body = new Node('Body'); body.layer = node.layer; node.addChild(body);
        const transform = body.addComponent(UITransform);
        transform.setContentSize(size, size);
        transform.setAnchorPoint(.5, 18 / 256);
        const sprite = body.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.trim = false;
        const animation = body.addComponent(Animation);
        body.active = false;
        const member: Member = { node, animation, sprite, lag, side, clip: '', moving: false,
            facing: 7, guardPose: false, dustPhase: this.members.length * .097 };
        this.members.push(member);
        const revision = this.revision;
        void loadMarchAnimations(kind).then(animations => {
            if (revision !== this.revision || !isValid(body)) return;
            member.animations = animations;
            animations.clips.forEach(clip => animation.addClip(clip));
            this.applyPose(member, member.moving);
            body.active = true;
        }).catch(() => { /* 共享加载器已经报告具体资源错误。 */ });
    }

    update(playback: MarchPlayback, sample: MarchSample): void {
        const now = DateUtil.monotonicNow();
        const dt = this.lastMono ? Math.min(.1, Math.max(0, (now - this.lastMono) / 1000)) : 0;
        this.lastMono = now;
        // 全队共享步态时钟。到达后共同收完最后半步再站定，避免主将瞬间换姿势、
        // 护卫各自在后面继续踏步；这一小段仅影响显示，不延迟服务端到达状态。
        const justArrived = this.wasMarching && !sample.moving;
        if (justArrived) {
            this.stopElapsed = 0;
            this.stopGait = this.gaitTime;
            this.stopContact = (Math.floor(this.gaitTime / .375) + 1) * .375;
        }
        if (sample.moving) {
            this.gaitTime += dt;
            this.stopElapsed = .18;
        } else this.stopElapsed = Math.min(.18, this.stopElapsed + dt);
        const stopping = !sample.moving && this.stopElapsed < .18;
        const stopBlend = 1 - Math.pow(1 - this.stopElapsed / .18, 2);
        if (!sample.moving && (stopping || justArrived))
            this.gaitTime = this.stopGait + (this.stopContact - this.stopGait) * stopBlend;
        this.wasMarching = sample.moving;
        const center = MapUtil.mapCellToPixelPoint(new Vec2(sample.position.x, sample.position.y));
        const advance = this.previousCenter ? center.clone().subtract(this.previousCenter) : new Vec2();
        this.previousCenter = center.clone();
        const next = MapUtil.mapCellToPixelPoint(new Vec2(sample.towards.x, sample.towards.y));
        if (Vec2.distance(center, next) > .01) {
            this.heading.set(next.x - center.x, next.y - center.y).normalize();
            this.groundHeading.set(sample.towards.x - sample.position.x, sample.towards.y - sample.position.y).normalize();
        }
        // 改道包的平滑校正也属于整队位移，不能只施加到主将上。
        const pathHead = sample.moving && playback.path.length > 0 ? playback.behind(0) : null;
        const correction = pathHead ? new Vec2(sample.position.x - pathHead.position.x,
            sample.position.y - pathHead.position.y) : new Vec2();
        for (const member of this.members) {
            // 行军沿路径跟随；到达后按最后一段朝向收队，不能永远停在拐点两侧。
            const tail = sample.moving && playback.path.length > 0 ? playback.behind(member.lag) : null;
            const ground = tail ? new Vec2(tail.position.x, tail.position.y)
                : new Vec2(sample.position.x - this.groundHeading.x * member.lag,
                    sample.position.y - this.groundHeading.y * member.lag);
            const forward = tail ? new Vec2(tail.towards.x - ground.x, tail.towards.y - ground.y) : this.groundHeading.clone();
            if (forward.lengthSqr() < .0001) forward.set(this.groundHeading);
            forward.normalize();
            if (tail) { ground.x += correction.x; ground.y += correction.y; }
            const base = MapUtil.mapCellToPixelPoint(ground);
            const direction = MapUtil.mapCellToPixelPoint(new Vec2(ground.x + forward.x, ground.y + forward.y)).subtract(base).normalize();
            // 先在地面排列，再统一做等距投影，斜行时不挤成一团或左右漂移。
            ground.x -= forward.y * member.side; ground.y += forward.x * member.side;
            const foot = MapUtil.mapCellToPixelPoint(ground);
            // 领队跟随同一平滑后的坐标；队员沿拐点逐个转弯。
            if (!member.lag) foot.set(center);
            const previousFoot = member.foot?.clone();
            if (justArrived && member.foot) member.arrivalFoot = new Vec2(member.foot.x + advance.x, member.foot.y + advance.y);
            if (sample.moving) member.arrivalFoot = undefined;
            if (!member.foot || !member.lag) member.foot = foot.clone();
            else if (!sample.moving && member.arrivalFoot) {
                member.foot.set(member.arrivalFoot.x + (foot.x - member.arrivalFoot.x) * stopBlend,
                    member.arrivalFoot.y + (foot.y - member.arrivalFoot.y) * stopBlend);
                if (!stopping) member.arrivalFoot = undefined;
            }
            else {
                // 平移由整队共享，只平滑相对阵位。对绝对坐标做追赶会产生“速度 × 平滑时长”
                // 的额外滞后，导致高速时主将脱队、减速时护卫各自追赶。
                member.foot.x += advance.x; member.foot.y += advance.y;
                // 改道/折返只缓动阵位，不会将队员瞬间镜像到另一侧。
                const blend = 1 - Math.exp(-dt / (sample.moving ? .09 : .12));
                const dx = (foot.x - member.foot.x) * blend, dy = (foot.y - member.foot.y) * blend;
                member.foot.x += dx; member.foot.y += dy;
            }
            const settling = !sample.moving && (stopping || Vec2.distance(member.foot, foot) > .15);
            // 收步后位置和朝向保持稳定，全队一起切换站立。
            if (!sample.moving && !settling) member.foot.set(foot);
            member.node.setPosition(member.foot.x - center.x, member.foot.y - center.y, 0);
            // 转弯/折返的短暂跟随阶段，身体朝向实际位移，避免脸先转而双脚横滑。
            if (previousFoot && sample.moving) {
                const travel = member.foot.clone().subtract(previousFoot);
                if (travel.lengthSqr() > .0025) direction.set(travel).normalize();
            }
            const angle = Math.atan2(direction.y, direction.x);
            const difference = Math.atan2(Math.sin(angle - member.facing * Math.PI / 4), Math.cos(angle - member.facing * Math.PI / 4));
            // 等距斜边投影约 26.6°，余量须小于 4°，才能从水平朝向正常转入斜行。
            if (!member.clip || Math.abs(difference) > Math.PI / 8 + Math.PI / 60)
                member.facing = (Math.round(angle / (Math.PI / 4)) + 8) % 8;
            this.applyPose(member, sample.moving || settling);
        }
        this.updateDust(dt, now);
        this.members.slice().sort((a, b) => b.node.position.y - a.node.position.y)
            .forEach((member, i) => member.node.setSiblingIndex(i + 1));
    }

    private applyPose(member: Member, moving: boolean): void {
        const changed = member.moving !== moving;
        member.moving = moving;
        const animations = member.animations, clip = animations?.clips[member.facing]?.name;
        if (!clip) return;
        const changedClip = member.clip !== clip;
        if (changedClip) member.sprite.node.setScale(animations.mirrored[member.facing] ? -1 : 1, 1, 1);
        if (moving) {
            member.guardPose = false;
            if (changedClip || changed) {
                member.animation.play(clip);
                // 由队列统一采样，避免每个 Animation 各自累计时间造成错拍。
                member.animation.pause();
            }
            const state = member.animation.getState(clip);
            if (state && state.duration > 0) {
                state.time = this.gaitTime % state.duration;
                state.sample();
            }
        } else if (changedClip || changed || member.guardPose !== this.guarding) {
            member.animation.stop();
            member.guardPose = this.guarding;
            const frames = this.guarding && animations.guardFrames?.length
                ? animations.guardFrames : animations.idleFrames;
            member.sprite.spriteFrame = frames[member.facing] || animations.idleFrames[member.facing];
            member.sprite.node.setScale(animations.mirrored[member.facing] ? -1 : 1, 1, 1);
        }
        member.clip = clip;
    }

    private updateDust(dt: number, now: number): void {
        if (!this.members.some(member => member.moving)) {
            if (this.dustVisible) this.dust.clear();
            this.dustVisible = false; this.dustElapsed = 0; return;
        }
        this.dustElapsed += dt;
        if (this.dustVisible && this.dustElapsed < .1) return;
        this.dustElapsed = 0; this.dustVisible = true; this.dust.clear();
        for (const member of this.members) {
            if (!member.moving) continue;
            const age = (now / 1100 + member.dustPhase * 3) % 1;
            const x = member.node.position.x - this.heading.x * (5 + age * 13);
            const y = member.node.position.y - this.heading.y * (5 + age * 13);
            this.dust.fillColor = new Color(193, 174, 126, Math.round((1 - age) * 26));
            this.dust.ellipse(x, y, 3 + age * 5, 1.3 + age * 2); this.dust.fill();
        }
    }

    destroy(): void {
        this.revision++;
        this.root.removeFromParent(); this.root.destroy(); this.members = [];
        const sprite = this.host.getComponent(Sprite); if (sprite) sprite.enabled = true;
        const animation = this.host.getComponent(Animation); if (animation) animation.enabled = true;
    }
}
