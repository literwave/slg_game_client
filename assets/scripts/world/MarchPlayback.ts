import type { WorldPosition } from './WorldCommand';
import { buildMarchPath, MarchMotion, MarchPath, MarchSample, projectMarchDistance, sampleMarchDistance } from './MarchPath';

/** 仅管理显示进度，不更改业务状态或服务器的行军时间。
 * 心跳是整数秒，不能逐帧用它覆盖带小数的行军时间轴。
 * 已在视野中的部队收到起步/改道后，以单调钟和服务器路径速度连续播放。
 */
export default class MarchPlayback {
    path: MarchPath = { points: [], distances: [], length: 0 };
    distance = 0;
    private endDistance = 0;
    private speed = 0;
    private lastMono = 0;
    private signature = '';
    private initialized = false;
    private correction: { x: number; y: number; started: number } | null = null;

    setMotion(motion: MarchMotion, serverNowMs: number, monoMs: number): boolean {
        const key = JSON.stringify([motion.state, motion.startTime, motion.endTime, motion.path, motion.startPos, motion.endPos]);
        if (key === this.signature) return false;
        const previous = this.initialized ? this.sample(monoMs) : null;
        this.signature = key;
        const next = buildMarchPath(motion);
        const duration = motion.endTime - motion.startTime;
        if (motion.state === 2 && previous && this.path.length > 0) {
            const target = projectMarchDistance(this.path, motion.endPos);
            if (target.error < .001 && target.distance >= this.distance) {
                // 到达包清空 path，画面仍沿保留的路径补完最后一小段。
                this.endDistance = target.distance;
                this.speed = Math.max(this.speed, (target.distance - this.distance) / .25);
                return true;
            }
        }
        this.path = next;
        this.endDistance = next.length;
        this.speed = motion.state === 1 && duration > 0 ? next.length / duration : 0;
        const elapsed = Math.max(0, serverNowMs / 1000 - motion.startTime);
        this.distance = this.speed ? Math.min(next.length, elapsed * this.speed) : next.length;
        this.correction = null;
        if (previous && this.speed) {
            const projected = projectMarchDistance(next, previous.position);
            if (projected.error < .75) this.distance = projected.distance;
        }
        const current = sampleMarchDistance(next, this.distance);
        if (previous && current) {
            const dx = previous.position.x - current.position.x, dy = previous.position.y - current.position.y;
            if (Math.hypot(dx, dy) > .0001) this.correction = { x: dx, y: dy, started: monoMs };
        }
        this.lastMono = monoMs;
        this.initialized = true;
        return true;
    }

    sample(monoMs: number): MarchSample | null {
        if (!this.initialized) return null;
        const dt = Math.min(.1, Math.max(0, (monoMs - this.lastMono) / 1000));
        this.lastMono = monoMs;
        this.distance = Math.min(this.endDistance, this.distance + dt * this.speed);
        const sample = sampleMarchDistance(this.path, this.distance, this.distance < this.endDistance - .00001);
        if (sample && this.correction) {
            const t = Math.min(1, Math.max(0, (monoMs - this.correction.started) / 250));
            const weight = (1 - t) * (1 - t);
            sample.position = { x: sample.position.x + this.correction.x * weight, y: sample.position.y + this.correction.y * weight };
            if (t >= 1) this.correction = null;
        }
        return sample;
    }

    /** 返回队员跟随点；队头尚未走够间距时，沿第一段方向排在身后。 */
    behind(lag: number): MarchSample | null {
        const distance = this.distance - lag;
        const sample = sampleMarchDistance(this.path, distance);
        if (!sample || distance >= 0 || this.path.length <= 0) return sample;
        const next = this.path.points.find(p => Math.hypot(p.x - sample.position.x, p.y - sample.position.y) > .00001);
        if (!next) return sample;
        const dx = next.x - sample.position.x, dy = next.y - sample.position.y, length = Math.hypot(dx, dy);
        sample.position = { x: sample.position.x + dx / length * distance, y: sample.position.y + dy / length * distance };
        sample.towards = next;
        return sample;
    }
}
