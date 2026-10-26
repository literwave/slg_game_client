import { ServerConfig } from "../config/ServerConfig";
import { EventMgr } from "../utils/EventMgr";
import { LogicEvent } from "../common/LogicEvent";
import ConfigManager from "../core/ConfigManager";

/** 奖励展示类型，对应 Global.json 中 Id=5 的 value3 */
interface RewardShowModes {
    none: number;
    windows: number;
}

export default class RewardCommand {
    private _uiReady = false;
    private _pendingRewards: any[] = [];
    protected static _instance: RewardCommand;
    public static getInstance(): RewardCommand {
        if (this._instance == null) {
            this._instance = new RewardCommand();
        }
        return this._instance;
    }

    public static destory(): boolean {
        if (this._instance) {
            this._instance.onDestory();
            this._instance = null;
            return true;
        }
        return false;
    }

    constructor() {
        EventMgr.on(ServerConfig.s2c_show_reward, this.onShowReward, this);
    }

    public onDestory(): void {
        this.clearData();
        EventMgr.targetOff(this);
    }

    public clearData(): void {
        this._uiReady = false;
        this._pendingRewards.length = 0;
    }

    public setUIReady(): void {
        if (this._uiReady) return;
        this._uiReady = true;
        const pending = this._pendingRewards.splice(0);
        for (const data of pending) {
            if (!this._uiReady) break;
            this.onShowReward(data);
        }
    }

    protected onShowReward(data: any): void {
        const rewardList = (data && data.rewardList) || [];
        if (!rewardList.length) {
            return;
        }
        if (!this._uiReady) {
            this._pendingRewards.push(data);
            return;
        }
        if (!this.needWindow(data.showTypeList)) {
            console.log("RewardCommand skip show reward, showTypeList:", data.showTypeList);
            return;
        }
        EventMgr.emit(LogicEvent.showReward, rewardList);
    }

    /** showTypeList 为空时默认弹窗；命中 windows 弹窗，只有 none 时不弹 */
    private needWindow(showTypeList: number[]): boolean {
        if (!showTypeList || !showTypeList.length) {
            return true;
        }
        const modes = this.getShowModes();
        if (showTypeList.indexOf(modes.windows) >= 0) {
            return true;
        }
        if (showTypeList.indexOf(modes.none) >= 0) {
            return false;
        }
        return true;
    }

    private getShowModes(): RewardShowModes {
        const modes: RewardShowModes = { none: 0, windows: 1 };
        const global = ConfigManager.getInstance().getConfig("Global");
        if (!Array.isArray(global)) {
            return modes;
        }
        const item = global.find((cfg: any) => cfg && cfg.Id === 5);
        const value = (item && item.value3) || {};
        if (typeof value.none === "number") {
            modes.none = value.none;
        }
        if (typeof value.windows === "number") {
            modes.windows = value.windows;
        }
        return modes;
    }
}
