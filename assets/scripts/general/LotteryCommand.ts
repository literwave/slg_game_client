import { ServerConfig as S } from '../config/ServerConfig';
import { LogicEvent as E } from '../common/LogicEvent';
import ConfigManager from '../core/ConfigManager';
import LoginCommand from '../login/LoginCommand';
import { NetEvent } from '../network/socket/NetInterface';
import { NetManager } from '../network/socket/NetManager';
import { ProtoManager } from '../network/pto/ProtoManager';
import { protocolPayload } from '../network/pto/ProtocolCommand';
import RewardCommand from '../reward/RewardCommand';
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
    total: number | null;
    rewards: LotteryReward[] | null;
    rewardKey: string;
    timedOut: boolean;
}

const RESPONSE_TIMEOUT = 10000;

/** 只显示服务端奖励；计数确认包不是抽奖结果，客户端不抽池、不补发。 */
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
    private _rewardShowType: number | null = null;
    private _lastRewardKey = '';
    private _lastRewardAt = 0;

    get loaded(): boolean { return this._loaded; }
    get lotteryTimes(): number { return this._lotteryTimes; }
    get pending(): boolean { return !!this._request && !this._request.timedOut; }
    get error(): string { return this._error; }
    get loading(): boolean { return this._infoTimer !== null; }
    get rewardPresentationReady(): boolean { return this._rewardShowType !== null; }

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
        RewardCommand.getInstance().setInterceptor(data => this.consumeReward(data));
    }

    /** 必须来自服务端约定的专用展示类型，不能用“正在点将”猜测奖励来源。 */
    setRewardShowType(showType: number | null): void {
        // 0/1 是不展示/普通弹窗，不能作为点将专属来源。
        this._rewardShowType = showType !== null && this.uint(showType) && showType > 1 ? showType : null;
    }

    private onLogin(): void { this.ready = true; }
    private onLoaded(): void { if (this.ready) this.requestInfo(); }

    clearData(): void {
        this.ready = false;
        this._loaded = false;
        this._lotteryTimes = 0;
        this._error = '';
        this._request = null;
        this._lastRewardKey = '';
        this._lastRewardAt = 0;
        this.stopDrawTimer();
        this.stopInfoTimer();
        this.changed();
    }

    onDestory(): void {
        this.clearData();
        RewardCommand.getInstance().setInterceptor(null);
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
        if (!this.ready || !this._loaded || this._request || this.loading) return false;
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
            id: ++this._serial, count, before: this._lotteryTimes, total: null,
            rewards: null, rewardKey: '', timedOut: false,
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
            if (request.rewards) this.releaseReward(request);
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
            if (!request) return;
            this.fail('点将未成功，请稍后重试');
            return;
        }
        if (!this.uint(data.lotteryTimes, true) || !this.uint(data.useLotteryTimes)) return;
        if (data.lotteryTimes < this._lotteryTimes) return;
        this._lotteryTimes = data.lotteryTimes;
        this._loaded = true;
        if (!request || data.useLotteryTimes !== request.count || data.lotteryTimes !== request.before + request.count) {
            this.changed();
            return;
        }
        request.total = data.lotteryTimes;
        // 没有专用奖励标识的旧服务端保留通用奖励弹窗，不误吞其它来源奖励。
        if (!this.rewardPresentationReady) {
            this._request = null;
            this.stopDrawTimer();
        } else this.tryComplete(request);
        this.changed();
    }

    /** RewardCommand 的唯一拦截点；返回 false 时原通用奖励逻辑照常处理。 */
    private consumeReward(data: any): boolean {
        if (!this.ready || this._rewardShowType === null || !Array.isArray(data?.showTypeList)
            || !data.showTypeList.includes(this._rewardShowType)) return false;
        const rewards = data.rewardList;
        if (!Array.isArray(rewards) || !rewards.length || !rewards.every(reward =>
            this.uint(reward?.rewardType) && this.uint(reward?.itemId, true) && this.uint(reward?.itemCount))) return false;
        const key = JSON.stringify(rewards);
        const request = this._request;
        // 无请求序号，只对已完成请求紧邻的重复奖励去重；新请求可合法抽到相同奖励。
        if (!request) return this._lastRewardKey === key && Date.now() - this._lastRewardAt < 2000;
        if (request.rewardKey === key) return true;
        if (request.rewards) return request.rewardKey === key;
        request.rewards = rewards.map(reward => ({ rewardType: reward.rewardType, itemId: reward.itemId, itemCount: reward.itemCount }));
        request.rewardKey = key;
        if (request.timedOut) {
            this.releaseReward(request);
        } else this.tryComplete(request);
        return true;
    }

    private tryComplete(request: DrawRequest): void {
        if (this._request !== request || request.total === null || !request.rewards || request.timedOut) return;
        const result: LotteryResult = { id: request.id, count: request.count, lotteryTimes: request.total, rewards: request.rewards };
        this.rememberReward(request);
        this._request = null;
        this.stopDrawTimer();
        this._error = '';
        EventMgr.emit(E.lotteryResult, result);
        this.changed();
    }

    private onTimeout(request: DrawRequest): void {
        if (this._request !== request) return;
        this._drawTimer = null;
        request.timedOut = true;
        this._loaded = false;
        this._error = '点将响应较慢，正在核对结果';
        if (request.rewards) this.releaseReward(request);
        this.changed();
        this.requestInfo();
    }

    private fail(message: string): void {
        if (this._request?.rewards) this.releaseReward(this._request);
        this._request = null;
        this.stopDrawTimer();
        this._error = message;
        this.changed();
        EventMgr.emit(E.showToast, message);
    }

    private releaseReward(request: DrawRequest): void {
        if (!request.rewards) return;
        this.rememberReward(request);
        EventMgr.emit(E.showReward, request.rewards);
        request.rewards = null;
    }
    private rememberReward(request: DrawRequest): void {
        this._lastRewardKey = request.rewardKey;
        this._lastRewardAt = Date.now();
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
