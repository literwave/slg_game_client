import { sys } from 'cc';

const KEY = 'slg.lottery.skipAnimation';
let value: boolean | undefined;
const listeners = new Set<(skip: boolean) => void>();

/** 只保存演出偏好，不影响服务端抽取、奖励或通用奖励窗口。 */
export function skipsLotteryAnimation(): boolean {
    if (value === undefined) {
        try { value = sys.localStorage.getItem(KEY) === '1'; }
        catch { value = false; }
    }
    return value;
}

export function setSkipLotteryAnimation(skip: boolean): void {
    if (skipsLotteryAnimation() === skip) return;
    value = skip;
    try { sys.localStorage.setItem(KEY, skip ? '1' : '0'); } catch { /* 隐私模式保留本次会话偏好。 */ }
    for (const listener of Array.from(listeners)) listener(skip);
}

export function watchLotteryAnimation(listener: (skip: boolean) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
