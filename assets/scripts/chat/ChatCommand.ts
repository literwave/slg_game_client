import { ServerConfig as S } from '../config/ServerConfig';
import { LogicEvent as E } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';
import ProtocolCommand, { hasId, idKey } from '../network/pto/ProtocolCommand';
import LoginCommand from '../login/LoginCommand';
import UnionCommand from '../union/UnionCommand';
import ConfigManager from '../core/ConfigManager';
import ChatProxy from './ChatProxy';
import { CHAT_MAX_LENGTH, validChatTarget } from './ChatPresentation';

export default class ChatCommand extends ProtocolCommand {
    private static _instance: ChatCommand;
    static getInstance(): ChatCommand { return this._instance || (this._instance = new ChatCommand()); }
    static destory(): boolean {
        if (!this._instance) return false;
        this._instance.onDestory(); this._instance = null; return true;
    }
    readonly proxy = new ChatProxy();
    private allianceId = '0';
    private historyAllianceId = '0';
    private historyErrors = new Set<string>();
    private outgoing: { channel: number; content: string; targetId: number | string } | null = null;
    constructor() {
        super();
        [S.s2c_chat, S.s2c_sync_chat].forEach(name => this.listen(name, d => {
            if (d.msg?.channel === 2 && !UnionCommand.getInstance().proxy.isMeInUnion()) return;
            this.proxy.updateMessage(d.msg, LoginCommand.getInstance().proxy.getRoleData()?.userId);
            const pending = this.outgoing;
            if (pending && d.msg?.channel === pending.channel && d.msg.content === pending.content
                && idKey(d.msg.senderId) === idKey(LoginCommand.getInstance().proxy.getRoleData()?.userId)
                && (pending.channel !== 3 || idKey(d.msg.targetId) === idKey(pending.targetId))) {
                this.outgoing = null; this.finish('chat:send');
                EventMgr.emit(E.chatSendResult, { ...pending, success: true });
            }
            EventMgr.emit(E.updateChatHistory);
        }));
        this.listen(S.s2c_req_chat_list, d => {
            const key = this.proxy.key(d.channel, d.targetId);
            if (!this.isPending(key)) return;
            this.finish(key);
            if (d.channel === 2 && this.historyAllianceId !== this.allianceId) {
                // 退盟/换盟途中收到的旧历史不能进入新联盟频道。
                if (hasId(this.allianceId)) this.chatHistory(1);
                return;
            }
            if (d.channel === 2 && !UnionCommand.getInstance().proxy.isMeInUnion()) return;
            this.proxy.updateHistory(d.channel, d.targetId, d.msgList);
            this.historyErrors.delete(key);
            EventMgr.emit(E.updateChatHistory);
        });
        EventMgr.on(E.unionChange, this.onAllianceChange, this);
    }
    protected reset(): void {
        this.proxy.clearData(); this.allianceId = '0'; this.historyAllianceId = '0';
        this.historyErrors.clear(); this.outgoing = null;
        EventMgr.emit(E.updateChatHistory);
    }
    protected onSessionReady(): void {
        const globals = ConfigManager.getInstance().getConfig('Global');
        const config = Array.isArray(globals) ? globals.find(g => g.Id === 9) : globals?.['9'];
        this.proxy.limit = Math.max(1, Number(config?.value1) || 100);
        this.chatHistory(0);
    }
    private onAllianceChange(id: any): void {
        const key = idKey(id);
        if (key === this.allianceId) return;
        this.allianceId = key;
        this.proxy.clearAlliance();
        EventMgr.emit(E.updateChatHistory);
        if (hasId(id) && !this.isPending('2')) this.chatHistory(1);
    }
    private validChannel(channel: number, targetId: any): boolean {
        return ([1, 2, 3].indexOf(channel) >= 0) && (channel !== 2 || UnionCommand.getInstance().proxy.isMeInUnion())
            && (channel !== 3 || (validChatTarget(targetId) && idKey(targetId) !== idKey(LoginCommand.getInstance().proxy.getRoleData()?.userId)));
    }
    chat(content: string, type = 0, targetId: number | string = 0): boolean {
        const channel = type + 1;
        if (!content.trim() || Array.from(content.trim()).length > CHAT_MAX_LENGTH || !this.validChannel(channel, targetId)
            || this.isPending('chat:send') || !this.sessionReady) return false;
        const pending = { channel, content: content.trim(), targetId: channel === 3 ? targetId : 0 };
        this.outgoing = pending;
        const sent = this.request(S.c2s_chat, pending, 'chat:send', () => {
            this.outgoing = null;
            EventMgr.emit(E.chatSendResult, { ...pending, success: false });
        });
        if (!sent) this.outgoing = null;
        return sent;
    }
    chatHistory(type: number, targetId: number | string = 0): boolean {
        const channel = type + 1;
        if (!this.validChannel(channel, targetId)) return false;
        const key = this.proxy.key(channel, targetId);
        if (this.isPending(key)) return false;
        if (channel === 2) this.historyAllianceId = this.allianceId;
        this.historyErrors.delete(key);
        this.proxy.beginHistory(channel, targetId);
        const sent = this.request(S.c2s_req_chat_list, { channel, targetId: channel === 3 ? targetId : 0 }, key,
            () => { this.proxy.cancelHistory(channel, targetId); this.historyErrors.add(key); EventMgr.emit(E.updateChatHistory); });
        if (!sent) this.proxy.cancelHistory(channel, targetId);
        return sent;
    }
    join(type: number, _id: any): void { this.chatHistory(type); }
    exit(type: number, _id: any): void { if (type === 1) this.proxy.clearAlliance(); }
    historyFailed(channel: number, targetId: any = 0): boolean { return this.historyErrors.has(this.proxy.key(channel, targetId)); }
    markRead(channel: number, targetId: any = 0): void {
        if (this.proxy.markRead(channel, targetId)) EventMgr.emit(E.chatReadChanged);
    }
}
