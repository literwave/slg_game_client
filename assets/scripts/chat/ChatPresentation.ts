/** 聊天界面使用相同的频道、留白与长度规则。 */
export const CHAT_CHANNELS = ['世界', '联盟', '私聊'];
export const CHAT_MAX_LENGTH = 200;

export function validChatTarget(value: unknown): boolean {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) return false;
    const text = String(value ?? '');
    return /^[1-9]\d{0,18}$/.test(text) && (text.length < 19 || text <= '9223372036854775807');
}

export function chatDockLayout(width: number, height: number) {
    const narrow = width < 720, margin = narrow ? 12 : 20;
    // 横屏与任务卡等宽；窄屏为右侧战报入口保留空间。
    const w = Math.min(344, Math.max(1, narrow ? width - margin * 2 - 76 : width - 440 - margin * 2));
    const h = 84, bottom = narrow ? 100 : 20;
    return { width: w, height: h, x: -width / 2 + margin + w / 2,
        y: -height / 2 + bottom + h / 2, taskBottom: Math.max(124, bottom + h + 12) };
}

export function chatPanelLayout(width: number, height: number) {
    const w = Math.min(600, width - 24), h = Math.min(760, height - 24);
    return { width: Math.max(260, w), height: Math.max(360, h),
        scale: Math.min(1, Math.max(1, w) / 260, Math.max(1, h) / 360),
        x: width >= 860 ? -width / 2 + 20 + w / 2 : 0 };
}

export function shortChatText(text: string, max: number): string {
    const chars = Array.from(String(text || '').replace(/\s+/g, ' '));
    return chars.length > max ? chars.slice(0, Math.max(1, max - 1)).join('') + '…' : chars.join('');
}

export function chatTime(seconds: number): string {
    if (!seconds) return '';
    const date = new Date(seconds * 1000), today = new Date();
    const time = `${('0' + date.getHours()).slice(-2)}:${('0' + date.getMinutes()).slice(-2)}`;
    return date.toDateString() === today.toDateString() ? time : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}
