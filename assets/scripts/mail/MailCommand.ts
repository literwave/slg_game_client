import ProtocolCommand, { hasId, idKey } from '../network/pto/ProtocolCommand';
import SnapshotStore from '../network/pto/SnapshotStore';
import { ServerConfig as S } from '../config/ServerConfig';
import { LogicEvent as E } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';
import ConfigManager from '../core/ConfigManager';

export interface MailInfo {
    mailId: number; mailUid: number | string; title: string; content: string;
    isRead: boolean; isLock: boolean; isGotReward: boolean; startTime: number; endTime: number;
}
export interface MailDetail {
    mailUid: number | string; detailList: string[];
    rewardList: Array<{ rewardType: number; itemId: number; itemCount: number }>;
}
export interface MailRef { mailKind: number; mailUid: number | string; }

/** mailId仅用于模板；所有读、锁定、删除、领奖均使用mailUid，保留int64精度。 */
export default class MailCommand extends ProtocolCommand {
    private static instance: MailCommand;
    static getInstance(): MailCommand { return this.instance || (this.instance = new MailCommand()); }
    private lists = new Map<number, SnapshotStore<MailInfo>>();
    private details = new Map<string, MailDetail>();
    private detailKinds = new Map<string, number>();
    private removed = new Set<string>();
    private loadedKinds = new Set<number>();
    public listLoaded(kind: number): boolean { return this.loadedKinds.has(kind); }
    constructor() {
        super();
        this.listen(S.s2c_req_mail_list, d => {
            if (!this.validKind(d.mailKind)) return;
            this.finish(`mail-list:${d.mailKind}`);
            const store = this.store(d.mailKind);
            store.replace((d.mailInfoList || []).filter(m => hasId(m.mailUid) && !this.removed.has(idKey(m.mailUid))));
            this.loadedKinds.add(d.mailKind);
            this.notify(d.mailKind);
        });
        this.listen(S.s2c_sync_mail, d => {
            if (!this.validKind(d.mailKind) || !hasId(d.mailInfo?.mailUid) || this.removed.has(idKey(d.mailInfo.mailUid))) return;
            const store = this.store(d.mailKind), old = store.get(d.mailInfo.mailUid);
            store.put({ ...d.mailInfo, isRead: !!(old?.isRead || d.mailInfo.isRead),
                isGotReward: !!(old?.isGotReward || d.mailInfo.isGotReward) });
            this.notify(d.mailKind);
        });
        this.listen(S.s2c_req_mail_detail, d => {
            const key = idKey(d.mailUid), kind = this.detailKinds.get(key);
            this.finish(`mail-detail:${key}`); this.detailKinds.delete(key);
            if (!kind || !this.getMail(kind, key) || this.removed.has(key)) return;
            this.details.set(key, { mailUid: d.mailUid, detailList: d.detailList || [], rewardList: d.rewardList || [] });
            this.patch(kind, key, { isRead: true });
            EventMgr.emit(E.updateMailDetail, kind, this.details.get(key));
        });
        this.listen(S.s2c_set_mail_lock, d => {
            if (!this.validKind(d.mailKind)) return;
            this.finish(`mail-lock:${d.mailKind}:${idKey(d.mailUid)}`);
            this.patch(d.mailKind, d.mailUid, { isLock: !!d.isLock });
        });
        this.listen(S.s2c_del_mail_list, d => {
            if (!this.validKind(d.mailKind)) return;
            this.finish(`mail-delete:${d.mailKind}`);
            for (const uid of d.mailUidList || []) {
                if (!hasId(uid)) continue;
                const key = idKey(uid);
                this.removed.add(key); this.store(d.mailKind).remove(key);
                this.details.delete(key); this.detailKinds.delete(key); this.finish(`mail-detail:${key}`);
            }
            this.notify(d.mailKind);
        });
        this.listen(S.s2c_get_mail_reward, d => {
            this.finish(S.c2s_get_mail_reward);
            for (const ref of d.mailKindUidList || []) this.patch(ref.k, ref.v, { isGotReward: true });
            // 道具/兵力与奖励展示只消费Reward协议，不在此处重复发放。
        });
    }
    protected reset(): void {
        this.lists.clear(); this.details.clear(); this.detailKinds.clear(); this.removed.clear();
        this.loadedKinds.clear();
    }
    protected onSessionReady(): void { [1, 2, 3].forEach(kind => this.requestList(kind)); }
    private validKind(kind: number): boolean { return [1, 2, 3].indexOf(kind) >= 0; }
    private store(kind: number): SnapshotStore<MailInfo> {
        if (!this.lists.has(kind)) this.lists.set(kind, new SnapshotStore<MailInfo>(m => idKey(m.mailUid)));
        return this.lists.get(kind);
    }
    getList(kind: number): MailInfo[] {
        return this.validKind(kind) ? this.store(kind).values().sort((a, b) => b.startTime - a.startTime) : [];
    }
    getMail(kind: number, uid: number | string): MailInfo | undefined { return this.lists.get(kind)?.get(uid); }
    getDetail(uid: number | string): MailDetail | undefined { return this.details.get(idKey(uid)); }
    unreadCount(kind: number): number { return this.getList(kind).filter(m => !m.isRead).length; }
    private notify(kind: number): void { EventMgr.emit(E.updateMailList, kind, this.getList(kind)); }
    private patch(kind: number, uid: number | string, change: Partial<MailInfo>): void {
        const mail = this.getMail(kind, uid);
        if (!mail) return;
        this.store(kind).put({ ...mail, ...change }); this.notify(kind);
    }
    requestList(mailKind: number): boolean {
        const key = `mail-list:${mailKind}`;
        if (!this.validKind(mailKind) || this.isPending(key)) return false;
        const store = this.store(mailKind); store.begin();
        const sent = this.request(S.c2s_req_mail_list, { mailKind }, key, () => store.cancel());
        if (!sent) store.cancel();
        return sent;
    }
    requestDetail(mailKind: number, mailUid: number | string): boolean {
        const key = idKey(mailUid);
        if (!this.getMail(mailKind, key) || this.isPending(`mail-detail:${key}`)) return false;
        this.detailKinds.set(key, mailKind);
        const sent = this.request(S.c2s_req_mail_detail, { mailKind, mailUid }, `mail-detail:${key}`, () => this.detailKinds.delete(key));
        if (!sent) this.detailKinds.delete(key);
        return sent;
    }
    setLock(mailKind: number, mailUid: number | string, isLock: boolean): boolean {
        if (!this.getMail(mailKind, mailUid) || typeof isLock !== 'boolean') return false;
        return this.request(S.c2s_set_mail_lock, { mailKind, mailUid, isLock }, `mail-lock:${mailKind}:${idKey(mailUid)}`);
    }
    deleteMails(mailKind: number, mailUidList: Array<number | string>): boolean {
        const ids = Array.from(new Set((mailUidList || []).map(idKey)));
        if (!ids.length || ids.some(uid => !this.getMail(mailKind, uid) || this.getMail(mailKind, uid).isLock)) return false;
        return this.request(S.c2s_del_mail_list, { mailKind, mailUidList: ids }, `mail-delete:${mailKind}`);
    }
    claimRewards(refs: MailRef[]): boolean {
        if (!refs?.length || refs.some(r => !this.getMail(r.mailKind, r.mailUid) || this.getMail(r.mailKind, r.mailUid).isGotReward)) return false;
        const unique = new Map(refs.map(r => [`${r.mailKind}:${idKey(r.mailUid)}`, { k: r.mailKind, v: idKey(r.mailUid) }]));
        return this.request(S.c2s_get_mail_reward, { mailKindUidList: Array.from(unique.values()) });
    }
    /** 模板参数按标题、正文顺序消费；服务端已给文本时优先显示，不把参数当富文本。 */
    presentation(kind: number, uid: number | string): { title: string; content: string; sender: string; icon: string } | null {
        const mail = this.getMail(kind, uid);
        if (!mail) return null;
        const template = (ConfigManager.getInstance().getConfig('Mail') || []).find(row => row.Id === mail.mailId);
        const args = this.getDetail(uid)?.detailList || [];
        let index = 0;
        const format = (text: string) => (text || '').replace(/%s/g, () => args[index++] ?? '…');
        const title = format(template?.Title), content = format(template?.Content);
        return { title: mail.title || title, content: mail.content || content,
            sender: template?.Sender || '', icon: template?.Icon || '' };
    }
}
