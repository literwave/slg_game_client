import { _decorator, Component, Label, Layout, Prefab, Node, UITransform, EventTouch, instantiate, view } from 'cc';
const { ccclass, property } = _decorator;

import GeneralCommand from "../../general/GeneralCommand";
import { GeneralData } from "../../general/GeneralProxy";
import SkillCommand from "../../skill/SkillCommand";
import GeneralItemLogic, { GeneralItemType } from "./GeneralItemLogic";
import SkillIconLogic from "./SkillIconLogic";
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { LogicEvent } from '../../common/LogicEvent';
import { styleGeneralDetail } from './GeneralDetailSkin';

@ccclass('GeneralDesLogic')
export default class GeneralDesLogic extends Component {

    @property(Label)
    nameLab: Label = null;

    @property(Layout)
    srollLayout: Layout = null;

    @property(Label)
    lvLabel: Label = null;

    @property(Label)
    foreLabel: Label = null;

    @property(Label)
    defenseLabel: Label = null;

    @property(Label)
    speedLabel: Label = null;

    @property(Label)
    strategyLabel: Label = null;

    @property(Label)
    destroyLabel: Label = null;

    @property(Label)
    expLabel: Label = null;

    @property(Label)
    powerLabel: Label = null;

    @property(Label)
    costLabel: Label = null;


    @property(Prefab)
    generalItemPrefab: Prefab = null;

    @property(Node)
    generalItemParent: Node = null;

    @property([Node])
    skillIcons: Node[] = [];

    @property([Label])
    skillNameLab: Label[] = [];

    private _currData: GeneralData = null;
    private _cfgData: any = null;


    private _nameObj: any = {};
    private _addPrObj: any = {};
    private _generalNode: Node = null;
    private _layoutParent: Node = null;
    private _arranging = false;
    private _layoutKey = '';

    protected onEnable() {
        EventMgr.on(LogicEvent.updateGeneral, this.updateGeneral, this);
        this._layoutParent = this.node.parent;
        this._layoutParent?.on(Node.EventType.SIZE_CHANGED, this.refreshVisualLayout, this);
        if (this._currData) this.refreshVisualLayout();
    }

    protected onDisable() {
        EventMgr.targetOff(this);
        this._layoutParent?.off(Node.EventType.SIZE_CHANGED, this.refreshVisualLayout, this);
        this._layoutParent = null;
    }

    protected onLoad(): void {

        this._nameObj = {
            force: "武力",
            strategy: "战略",
            defense: "防御",
            speed: "速度",
            destroy: "破坏",
        };

        this._generalNode = instantiate(this.generalItemPrefab);
        this._generalNode.parent = this.generalItemParent;
    }

    public refreshVisualLayout(): void {
        if (this._arranging || !this._currData) return;
        const size = this.node.parent?.getComponent(UITransform) || view.getVisibleSize();
        const slots = this.skillIcons.map(icon => !!(icon?.getComponent(SkillIconLogic))?.getSkill());
        const key = `${size.width}:${size.height}:${slots.join(',')}`;
        if (key === this._layoutKey) return;
        this._arranging = true;
        try {
            styleGeneralDetail(this);
            this._layoutKey = key;
        } finally {
            this._arranging = false;
        }
    }

    protected updateGeneral() {
        if (!this._currData) {
            return;
        }
        var data = GeneralCommand.getInstance().proxy.getMyGeneral(this._currData.hero_type);
        if (data) {
            this.setData(this._cfgData, data);
        }
    }

    public setData(cfgData: any, curData: GeneralData): void {
        if (!cfgData || !curData) {
            return;
        }
        this._currData = curData;
        this._cfgData = cfgData;

        var nextCfg = GeneralCommand.getInstance().proxy.getGeneralLevelCfg(this._currData.level + 1);
        var levelExp = nextCfg ? nextCfg.exp : "MAX";
        var maxLevel: number = GeneralCommand.getInstance().proxy.getMaxLevel();
        if (this.lvLabel) this.lvLabel.string = this._currData.level + "/" + maxLevel;
        if (this.expLabel) this.expLabel.string = curData.exp + "/" + levelExp;

        if (this.nameLab) this.nameLab.string = this._cfgData.name;

        this._addPrObj = {
            force: this._currData.force_added,
            strategy: this._currData.strategy_added,
            defense: this._currData.defense_added,
            speed: this._currData.speed_added,
            destroy: this._currData.destroy_added,
        };


        if (this.foreLabel) this.foreLabel.string = this.formatStat(cfgData.attack);
        if (this.strategyLabel) this.strategyLabel.string = this.formatStat(cfgData.hp);
        if (this.defenseLabel) this.defenseLabel.string = this.formatStat(cfgData.defense);
        if (this.speedLabel) this.speedLabel.string = this.formatStat(cfgData.speed);
        if (this.destroyLabel) this.destroyLabel.string = this.formatStat(cfgData.crit);

        var com = this._generalNode ? this._generalNode.getComponent(GeneralItemLogic) : null;
        if (com) {
            com.updateItem({ ...this._currData, listAppearance: 'roster' }, GeneralItemType.GeneralNoThing);
        }

        if (this.powerLabel) this.powerLabel.string = cfgData.heroClass || "无";
        const skillProxy = SkillCommand.getInstance().proxy;
        const innateSkill = skillProxy.getSkillCfg(cfgData.skillId);
        if (this.costLabel) this.costLabel.string = "技能:" + (innateSkill?.name || cfgData.skill || "无");

        const skills = curData.skills || [];
        for (let index = 0; index < this.skillIcons.length; index++) {
            const equipped = skills[index] || null;
            const cfgId = equipped ? equipped.cfgId : (index === 0 ? cfgData.skillId : 0);
            const conf = skillProxy.getSkillCfg(cfgId);
            const displaySkill = skillProxy.getSkillForDisplay(cfgId);
            const icon = this.skillIcons[index]?.getComponent(SkillIconLogic);
            if (icon) icon.setData(displaySkill, equipped);
            const label = this.skillNameLab[index];
            if (label) label.string = conf?.name || '选择技能';
        }
        this.refreshVisualLayout();
    }

    private getAttrStr(key: string): string {
        let hero_type = this._currData.hero_type;
        let cfg = GeneralCommand.getInstance().proxy.getGeneralCfg(hero_type);
        if (!cfg) return this._nameObj[key] + ": 0.00";
        var str = GeneralData.getPrStr(cfg[key], this._addPrObj[key], this._currData.level, cfg[key + "_grow"]);
        return this._nameObj[key] + ":" + str;
    }

    private formatStat(value: any): string {
        const numberValue = Number(value || 0);
        return Number.isInteger(numberValue) ? String(numberValue) : numberValue.toFixed(2);
    }

    protected onClickSkill(event: EventTouch, pos) {
        AudioManager.instance.playClick();
        console.log("event", event, pos);
        const slot = Number(pos);
        const node: Node = this.skillIcons[slot] || event.currentTarget || event.target;
        const skillIcon = node ? node.getComponent(SkillIconLogic) : null;
        if (!skillIcon) {
            return;
        }
        var isEmpty = skillIcon.isEmpty();
        if (isEmpty) {
            EventMgr.emit(LogicEvent.openSkill, 1, this._currData, slot);
        } else {
            let skill = skillIcon.getSkill();
            const equipped = this._currData?.skills?.[slot];
            const type = equipped && equipped.cfgId === skill.cfgId ? 2 : 0;
            EventMgr.emit(LogicEvent.openSkillInfo, skill, type, this._currData, slot);
        }
    }

}
