import { ServerConfig as S } from '../config/ServerConfig';
import { LogicEvent as E } from '../common/LogicEvent';
import ConfigManager from '../core/ConfigManager';
import LoginCommand from '../login/LoginCommand';
import { NetEvent } from '../network/socket/NetInterface';
import { NetManager } from '../network/socket/NetManager';
import { ProtoManager } from '../network/pto/ProtoManager';
import { protocolPayload } from '../network/pto/ProtocolCommand';
import { EventMgr } from '../utils/EventMgr';

export interface LotteryReward { rewardType: number; itemId: number; itemCount: number; }
export interface LotteryCost { itemId: number; count: number; }
export interface LotteryOption { count: number; costs: LotteryCost[]; }
export interface LotteryResult {
    id: number;
    count: number;
    lotteryTimes: number;
    rewards: LotteryReward[];
}
interface DrawRequest {
    id: number;
    count: number;
    before: number;
    timedOut: boolean;
}

const RESPONSE_TIMEOUT = 10000;

/** 使用点将回包自带的 rewardList，不拦截其它来源的通用奖励。 */
export default class LotteryCommand {
    private static _instance: LotteryCommand;
    static getInstance(): LotteryCommand {
        return this._instance || (this._instance = new LotteryCommand());
    }

    private ready = false;
    private _loaded = false;
    private _lotteryTimes = 0;
    private _error = '';
    private _request: DrawRequest | null = null;
    private _serial = 0;
    private _drawTimer: ReturnType<typeof setTimeout> | null = null;
    private _infoTimer: ReturnType<typeof setTimeout> | null = null;
    private _lastPresentedTotal = -1;

    get loaded(): boolean { return this._loaded; }
    get lotteryTimes(): number { return this._lotteryTimes; }
    get pending(): boolean { return !!this._request && !this._request.timedOut; }
    get error(): string { return this._error; }
    get loading(): boolean { return this._infoTimer !== null; }
    get sessionReady(): boolean { return this.ready; }
    get canDraw(): boolean { return this.ready && this._loaded && !this._request && !this.loading; }

    get options(): LotteryOption[] {
        const config = ConfigManager.getInstance().getConfig('Lottery');
        if (!Array.isArray(config)) return [];
        return config.filter(row => (row?.Id === 1 || row?.Id === 10) && Array.isArray(row.CostList))
            .map(row => ({ count: row.Id, costs: row.CostList.map(cost => ({ itemId: Number(cost.item_id), count: Number(cost.count) })) }))
            .filter(row => row.costs.length > 0 && row.costs.every(cost => this.uint(cost.itemId) && this.uint(cost.count)))
            .sort((a, b) => a.count - b.count);
    }

    constructor() {
        EventMgr.on(S.s2c_user_login_ok, this.onLogin, this);
        EventMgr.on(S.s2c_client_load_ok, this.onLoaded, this);
        EventMgr.on(S.s2c_req_user_lottery_info, this.onInfo, this);
        EventMgr.on(S.s2c_user_lottery, this.onDraw, this);
        EventMgr.on(NetEvent.ServerDisconnected, this.clearData, this);
        EventMgr.on(E.enterLogin, this.clearData, this);
    }

    private onLogin(): void { this.ready = true; }
    private onLoaded(): void { if (this.ready) this.requestInfo(); }

    clearData(): void {
        this.ready = false;
        this._loaded = false;
        this._lotteryTimes = 0;
        this._error = '';
        this._request = null;
        this._lastPresentedTotal = -1;
        this.stopDrawTimer();
        this.stopInfoTimer();
        this.changed();
    }

    onDestory(): void {
        this.clearData();
        EventMgr.targetOff(this);
    }

    requestInfo(): boolean {
        if (!this.ready || this.loading) return false;
        this._infoTimer = setTimeout(() => {
            this._infoTimer = null;
            this._error = '点将信息读取超时，请重新打开重试';
            this.changed();
        }, RESPONSE_TIMEOUT);
        if (!this.send(S.c2s_req_user_lottery_info, {})) {
            this.stopInfoTimer();
            this._error = '点将信息暂不可用';
            this.changed();
            return false;
        }
        this.changed();
        return true;
    }

    draw(count: number): boolean {
        if (!this.canDraw) return false;
        const option = this.options.find(row => row.count === count);
        if (!option) return false;
        const bag = LoginCommand.getInstance().proxy;
        if (option.costs.some(cost => bag.hasItemCount(cost.itemId) && bag.getItemCount(cost.itemId) < cost.count)) {
            this._error = '点将所需道具不足';
            this.changed();
            EventMgr.emit(E.showToast, this._error);
            return false;
        }
        const request: DrawRequest = {
            id: ++this._serial, count, before: this._lotteryTimes, timedOut: false,
        };
        this._request = request;
        this._error = '';
        this._drawTimer = setTimeout(() => this.onTimeout(request), RESPONSE_TIMEOUT);
        if (!this.send(S.c2s_user_lottery, { useLotteryTimes: count })) {
            this._request = null;
            this.stopDrawTimer();
            this._error = '点将请求未发送，请重试';
            this.changed();
            return false;
        }
        this.changed();
        return true;
    }

    private onInfo(raw: any): void {
        if (!this.ready) return;
        const data = protocolPayload(raw);
        this.stopInfoTimer();
        if (!data || !this.uint(data.lotteryTimes, true)) {
            this._error = '点将信息读取失败';
            this.changed();
            return;
        }
        this._lotteryTimes = Math.max(this._lotteryTimes, data.lotteryTimes);
        this._loaded = true;
        this._error = '';
        const request = this._request;
        if (request?.timedOut) {
            // 读请求排在写请求之后，确认服务端计数后才允许再次扣费。
            this._request = null;
            if (data.lotteryTimes === request.before) {
                this._error = '本次点将未完成，可重新点将';
            }
        }
        this.changed();
    }

    private onDraw(raw: any): void {
        if (!this.ready) return;
        const request = this._request;
        const data = protocolPayload(raw);
        if (!data) {
            if (request) this.fail('点将未成功，请稍后重试');
            return;
        }
        if (!this.uint(data.lotteryTimes, true) || !this.uint(data.useLotteryTimes)
            || data.lotteryTimes < data.useLotteryTimes) return;
        // 累计次数是本会话的单调序号，重复包不能重播；后续抽到相同奖励仍是有效结果。
        if (data.lotteryTimes <= this._lastPresentedTotal || data.lotteryTimes < this._lotteryTimes) return;
        const matches = request && data.useLotteryTimes === request.count && data.lotteryTimes === request.before + request.count;
        this._lotteryTimes = data.lotteryTimes;
        this._loaded = true;
        if (matches) { this._request = null; this.stopDrawTimer(); }
        this._lastPresentedTotal = data.lotteryTimes;
        const rewards = data.rewardList;
        if (!Array.isArray(rewards) || !rewards.length || !rewards.every(reward =>
            this.uint(reward?.rewardType) && this.uint(reward?.itemId, true) && this.uint(reward?.itemCount))) {
            this._error = '点将已完成，服务端未返回有效的奖励明细';
            EventMgr.emit(E.showToast, this._error);
            this.changed();
            return;
        }
        this._error = '';
        const result: LotteryResult = {
            id: matches ? request.id : ++this._serial, count: data.useLotteryTimes,
            lotteryTimes: data.lotteryTimes,
            rewards: rewards.map(reward => ({ rewardType: reward.rewardType, itemId: reward.itemId, itemCount: reward.itemCount })),
        };
        EventMgr.emit(E.lotteryResult, result);
        this.changed();
    }

    private onTimeout(request: DrawRequest): void {
        if (this._request !== request) return;
        this._drawTimer = null;
        request.timedOut = true;
        this._loaded = false;
        this._error = '点将响应较慢，正在核对结果';
        this.changed();
        this.requestInfo();
    }

    private fail(message: string): void {
        this._request = null;
        this.stopDrawTimer();
        this._error = message;
        this.changed();
        EventMgr.emit(E.showToast, message);
    }

    private stopDrawTimer(): void { if (this._drawTimer !== null) clearTimeout(this._drawTimer); this._drawTimer = null; }
    private stopInfoTimer(): void { if (this._infoTimer !== null) clearTimeout(this._infoTimer); this._infoTimer = null; }
    private changed(): void { EventMgr.emit(E.lotteryChanged); }
    private uint(value: any, zero = false): boolean { return Number.isInteger(value) && value >= (zero ? 0 : 1) && value <= 0x7fffffff; }
    private send(name: string, payload: object): boolean {
        const proto = ProtoManager.getInstance();
        if (!this.ready || !proto.isReady() || !proto.getIdByMsgType(name)) return false;
        const bytes = proto.encode(name, payload);
        if (!bytes) return false;
        try { NetManager.getInstance().send({ name, msg: bytes }); return true; }
        catch (error) { console.warn('点将请求发送失败', error); return false; }
    }
}
