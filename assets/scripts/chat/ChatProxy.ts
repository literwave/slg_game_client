import { idKey } from '../network/pto/ProtocolCommand';
export class ChatMsg {
    msgId: number | string = 0;
    rid: number | string = 0;
    targetId: number | string = 0;
    headIcon = 0;
    nick_name = '';
    type = 0;
    channel = 1;
    msg = '';
    time = 0;
    peerId = '0';
}
export default class ChatProxy {
    private histories = new Map<string, ChatMsg[]>();
    private receiving = new Map<string, ChatMsg[]>();
    private unread = new Map<string, Set<string>>();
    private peers = new Map<string, { id: string; name: string; headIcon: number }>();
    limit = 100;
    key(channel: number, targetId: any = 0): string { return channel === 3 ? `3:${idKey(targetId)}` : String(channel); }
    clearData(): void { this.histories.clear(); this.receiving.clear(); this.unread.clear(); this.peers.clear(); }
    clearAlliance(): void { this.histories.delete('2'); this.receiving.delete('2'); this.unread.delete('2'); }
    beginHistory(channel: number, targetId: any): void { this.receiving.set(this.key(channel, targetId), []); }
    cancelHistory(channel: number, targetId: any): void { this.receiving.delete(this.key(channel, targetId)); }
    private convert(d: any): ChatMsg {
        return Object.assign(new ChatMsg(), { msgId: d.msgId, rid: d.senderId, nick_name: d.senderName,
            headIcon: d.headIcon, targetId: d.targetId, channel: d.channel, type: d.channel - 1, msg: d.content, time: d.time });
    }
    private merge(key: string, messages: ChatMsg[]): void {
        const unique = new Map<string, ChatMsg>();
        messages.forEach(m => unique.set(idKey(m.msgId), m));
        this.histories.set(key, Array.from(unique.values()).sort((a, b) => a.time - b.time ||
            idKey(a.msgId).length - idKey(b.msgId).length || idKey(a.msgId).localeCompare(idKey(b.msgId))).slice(-this.limit));
        const retained = new Set(this.histories.get(key).map(m => idKey(m.msgId)));
        this.unread.get(key)?.forEach(id => { if (!retained.has(id)) this.unread.get(key).delete(id); });
    }
    updateHistory(channel: number, targetId: any, messages: any[]): void {
        const key = this.key(channel, targetId);
        this.merge(key, [...(messages || []).filter(m => m.channel === channel).map(m => {
            const msg = this.convert(m); if (channel === 3) msg.peerId = idKey(targetId); return msg;
        }), ...(this.receiving.get(key) || [])]);
        if (channel === 3) {
            const incoming = this.getHistory(3, targetId).filter(m => idKey(m.rid) === idKey(targetId)).pop();
            if (incoming) this.rememberPeer(targetId, incoming.nick_name, incoming.headIcon);
        }
        this.receiving.delete(key);
    }
    updateMessage(message: any, myUid: any): void {
        if (!message || [1, 2, 3].indexOf(message.channel) < 0) return;
        const target = idKey(message.senderId) === idKey(myUid) ? message.targetId : message.senderId;
        const key = this.key(message.channel, target);
        const msg = this.convert(message);
        if (message.channel === 3) {
            msg.peerId = idKey(target);
            this.rememberPeer(target, idKey(message.senderId) === idKey(myUid) ? '' : message.senderName,
                idKey(message.senderId) === idKey(myUid) ? 0 : message.headIcon);
        }
        const duplicate = this.histories.get(key)?.some(row => idKey(row.msgId) === idKey(msg.msgId));
        if (!duplicate && idKey(message.senderId) !== idKey(myUid)) {
            if (!this.unread.has(key)) this.unread.set(key, new Set());
            this.unread.get(key).add(idKey(msg.msgId));
        }
        const pending = this.receiving.get(key);
        if (pending) pending.push(msg);
        this.merge(key, [...(this.histories.get(key) || []), msg]);
    }
    getWorldChatList(): ChatMsg[] { return this.getHistory(1); }
    getUnionChatList(): ChatMsg[] { return this.getHistory(2); }
    getHistory(channel: number, targetId: any = 0): ChatMsg[] { return (this.histories.get(this.key(channel, targetId)) || []).slice(); }
    markRead(channel: number, targetId: any = 0): boolean { return this.unread.delete(this.key(channel, targetId)); }
    unreadCount(channel?: number, targetId?: any): number {
        if (channel && (channel !== 3 || targetId !== undefined)) return this.unread.get(this.key(channel, targetId))?.size || 0;
        let count = 0;
        this.unread.forEach((ids, key) => { if (!channel || key.startsWith('3:')) count += ids.size; });
        return count;
    }
    recent(limit = 2): ChatMsg[] {
        return Array.from(this.histories.values()).reduce((all, rows) => all.concat(rows), [] as ChatMsg[])
            .sort((a, b) => a.time - b.time || idKey(a.msgId).length - idKey(b.msgId).length || idKey(a.msgId).localeCompare(idKey(b.msgId)))
            .slice(-limit);
    }
    rememberPeer(id: any, name = '', headIcon = 0): void {
        const key = idKey(id), previous = this.peers.get(key);
        this.peers.set(key, { id: key, name: name || previous?.name || key, headIcon: headIcon || previous?.headIcon || 0 });
    }
    conversations(): { id: string; name: string; headIcon: number }[] {
        return Array.from(this.peers.values()).sort((a, b) =>
            (this.getHistory(3, b.id).slice(-1)[0]?.time || 0) - (this.getHistory(3, a.id).slice(-1)[0]?.time || 0));
    }
}
