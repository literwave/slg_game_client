/** 用户当前操作优先；背景预取限流，避免与拖图抢解码时间。 */
export enum AssetPriority { Background = 0, Warmup = 1, Visible = 10, Interaction = 20 }

interface Job<T = any> {
    key: string; priority: AssetPriority; load: () => Promise<T>;
    resolve: (value: T) => void; reject: (error: unknown) => void;
    promise: Promise<T>; started: boolean;
}

export class AssetRequestCancelled extends Error {}

export default class AssetLoadQueue {
    private static jobs = new Map<string, Job>();
    private static running = 0;
    private static backgroundRunning = 0;
    private static backgroundReadyAt = 0;
    private static pausedUntil = 0;
    private static timer: ReturnType<typeof setTimeout> = null;

    static request<T>(key: string, load: () => Promise<T>, priority = AssetPriority.Visible): Promise<T> {
        const existing = this.jobs.get(key);
        if (existing) {
            if (!existing.started) existing.priority = Math.max(existing.priority, priority);
            this.schedule();
            return existing.promise;
        }
        const job: Job<T> = { key, priority, load, started: false, resolve: null, reject: null, promise: null };
        job.promise = new Promise<T>((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
        this.jobs.set(key, job);
        this.schedule();
        return job.promise;
    }

    static pauseBackground(milliseconds = 800): void {
        this.pausedUntil = Math.max(this.pausedUntil, Date.now() + milliseconds);
    }

    /** 已经交给引擎的请求不能强制中断，消费者仍需校验节点和本次请求。 */
    static cancel(key: string, maxPriority = AssetPriority.Interaction): void {
        const job = this.jobs.get(key);
        if (!job || job.started || job.priority > maxPriority) return;
        this.jobs.delete(key);
        job.reject(new AssetRequestCancelled(key));
    }

    static get statistics() {
        return { running: this.running, queued: this.jobs.size - this.running, backgroundRunning: this.backgroundRunning };
    }

    private static schedule(delay = 0): void {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.timer = null; this.pump(); }, delay);
    }

    private static pump(): void {
        while (this.running < 4) {
            const candidates = [...this.jobs.values()].filter(job => !job.started &&
                (job.priority >= AssetPriority.Visible || (this.backgroundRunning < 1 &&
                    Date.now() >= Math.max(this.pausedUntil, this.backgroundReadyAt))));
            candidates.sort((a, b) => b.priority - a.priority);
            const job = candidates[0];
            if (!job) break;
            job.started = true;
            this.running++;
            const background = job.priority < AssetPriority.Visible;
            if (background) this.backgroundRunning++;
            Promise.resolve().then(job.load).then(job.resolve, job.reject).then(() => {
                this.jobs.delete(job.key);
                this.running--;
                if (background) {
                    this.backgroundRunning--;
                    // 每张图/每个界面之间给渲染和输入留出时间，不连续挤占解码。
                    this.backgroundReadyAt = Date.now() + 120;
                }
                this.schedule();
            });
        }
        if (this.running < 4 && this.backgroundRunning === 0 && [...this.jobs.values()].some(job => !job.started)) {
            this.schedule(Math.max(0, Math.max(this.pausedUntil, this.backgroundReadyAt) - Date.now()));
        }
    }
}
