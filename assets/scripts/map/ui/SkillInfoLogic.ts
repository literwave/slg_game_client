import { _decorator, Component, Label, Node, Button } from 'cc';
const {ccclass, property} = _decorator;

import { SkillConf, SkillEffectType, SkillLevel } from "../../config/skill/Skill";
import GeneralCommand from "../../general/GeneralCommand";
import { GeneralData } from "../../general/GeneralProxy";
import SkillCommand from "../../skill/SkillCommand";
import { Skill } from "../../skill/SkillProxy";
import SkillIconLogic from "./SkillIconLogic";
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { LogicEvent } from '../../common/LogicEvent';
import SkillInfoView from './SkillInfoView';

const TRIGGER_NAMES: Record<number, string> = { 1: '主动', 2: '被动', 3: '追击', 4: '指挥' };
const TARGET_NAMES: Record<number, string> = {
    1: '自身', 4: '我军全体', 5: '敌军单体',
    6: '敌军1-2个目标', 7: '敌军2-3个目标', 8: '敌军全体',
};

@ccclass('SkillInfoLogic')
export default class SkillInfoLogic extends Component {

    @property(Label)
    nameLab: Label = null;

    @property(Node)
    icon:Node = null;

 
    @property(Label)
    lvLab: Label = null;

    @property(Label)
    triggerLab: Label = null;

    @property(Label)
    targetLab: Label = null;

    @property(Label)
    armLab: Label = null;

    @property(Label)
    rateLab: Label = null;

    @property(Label)
    curDesLab: Label = null;

    @property(Label)
    nextDesLab: Label = null;

    @property(Button)
    learnBtn: Button = null;

    @property(Button)
    lvBtn: Button = null;

    @property(Button)
    giveUpBtn: Button = null;

    _data: Skill = null;
    _cfg: SkillConf = null;

    _general: GeneralData = null;
    _type: number = 0;
    _skillPos : number = -1;
    private detailView: SkillInfoView = null;

    protected onLoad(): void {
        this.ensureView();
    }

    protected onEnable() {
        this.hideUnsupportedActions();
        this.ensureView().refreshSize();
    }

    protected onDestroy(): void {
        this.detailView?.dispose();
    }

    private ensureView(): SkillInfoView {
        if (!this.detailView) this.detailView = new SkillInfoView(this.node, {
            name: this.nameLab, icon: this.icon, level: this.lvLab,
            trigger: this.triggerLab, target: this.targetLab, arms: this.armLab, rate: this.rateLab,
            current: this.curDesLab, next: this.nextDesLab,
        });
        return this.detailView;
    }

    protected onClickClose(): void {
        this.node.active = false;
        AudioManager.instance.playClick();
    }

    public setData(data: Skill, type:number, general:GeneralData, skillPos: number) {
        const proxy = SkillCommand.getInstance().proxy;
        const conf = data ? proxy.getSkillCfg(data.cfgId) : null;
        this._cfg = conf;
        this._data = data;
        this._type = type;
        this._general = general;
        this._skillPos = skillPos;
        this.hideUnsupportedActions();

        const slotSkill = type === 2 ? general?.skills?.[skillPos] : null;
        const equipped = conf && slotSkill?.cfgId === conf.cfgId ? slotSkill : null;
        this.icon?.getComponent(SkillIconLogic)?.setData(conf ? data : null, equipped);
        for (const label of [this.lvLab, this.triggerLab, this.targetLab, this.armLab,
            this.rateLab, this.curDesLab, this.nextDesLab]) {
            if (label) label.string = '';
        }
        if (this.nameLab) this.nameLab.string = conf?.name || '未知战法';
        if (!conf) {
            if (this.curDesLab) this.curDesLab.string = '暂未获取该战法的详情';
            this.ensureView().show(0, false);
            return;
        }

        const outline = proxy.outLine;
        const triggerName = outline?.trigger_type?.list?.find(item => item.type === conf.trigger)?.des;
        const targetName = outline?.target_type?.list?.find(item => item.type === conf.target)?.des;
        if (this.triggerLab) this.triggerLab.string = triggerName || TRIGGER_NAMES[conf.trigger] || '未知类型';
        if (this.targetLab) this.targetLab.string = targetName || TARGET_NAMES[conf.target] || '未知目标';
        if (this.armLab) this.armLab.string = this.armstr(conf.arms || []);
        const levels = conf.levels || [];
        const index = Math.min(Math.max(0, Math.floor(Number(equipped?.lv) || 1) - 1), levels.length - 1);
        const current = levels[index];
        if (!current) {
            if (this.curDesLab) this.curDesLab.string = '暂无等级配置';
            this.ensureView().show(0, false);
            return;
        }
        if (this.lvLab) this.lvLab.string = `${index + 1}级`;
        if (this.rateLab) this.rateLab.string = current.probability + '%';
        if (this.curDesLab) this.curDesLab.string = this.formatDescription(conf, current);
        if (this.nextDesLab) this.nextDesLab.string = levels[index + 1]
            ? this.formatDescription(conf, levels[index + 1]) : '已达最高等级';
        this.ensureView().show(index + 1, !!levels[index + 1]);
    }

    private hideUnsupportedActions(): void {
        // 当前协议只有武将技能同步，学习、升级和遗忘尚无可用接口。
        for (const button of [this.learnBtn, this.lvBtn, this.giveUpBtn]) {
            if (button) button.node.active = false;
        }
    }

    private formatDescription(conf: SkillConf, level: SkillLevel): string {
        let index = 0;
        const effects = SkillCommand.getInstance().proxy.outLine?.effect_type?.list;
        return (conf.des || '').replace(/%n%/g, () => {
            const effectType = conf.include_effect?.[index];
            const value = level.effect_value?.[index++];
            if (value == null) return '—';
            const isRate = effects?.find(effect => effect.type === effectType)?.isRate
                ?? (effectType === SkillEffectType.HurtRate);
            return String(value) + (isRate ? '%' : '');
        });
    }

    protected armstr(arms:number []): string{
        // console.log("armstr:", arms);

        var str = ""
        if(arms.indexOf(1)>=0 || arms.indexOf(4)>=0 || arms.indexOf(7)>=0){
            str += "步"
        }

        if(arms.indexOf(2)>=0 || arms.indexOf(5)>=0 || arms.indexOf(8)>=0){
            str += "弓"
        }
        
        if(arms.indexOf(3)>=0 || arms.indexOf(6)>=0 || arms.indexOf(9)>=0){
            str += "骑"
        }
        return str.split('').join(' · ') || '不限';
    }

    
    protected onClickLearn():void {
        if (!this.learnBtn?.node.active || !this._cfg) return;
        AudioManager.instance.playClick();
        if(this._general){
            GeneralCommand.getInstance().upSkill(this._general.id, this._cfg.cfgId, this._skillPos);
            this.node.active = false;
            EventMgr.emit(LogicEvent.closeSkill);
        }
    }

    protected onClickLv():void {
        if (!this.lvBtn?.node.active || !this._cfg) return;
        AudioManager.instance.playClick();
        if(this._general){
            GeneralCommand.getInstance().lvSkill(this._general.id, this._skillPos);
            this.node.active = false;
            EventMgr.emit(LogicEvent.closeSkill);
        }
    }

    protected onClickForget():void {
        if (!this.giveUpBtn?.node.active || !this._cfg) return;
        AudioManager.instance.playClick();
        if(this._general){
            GeneralCommand.getInstance().downSkill(this._general.id, this._cfg.cfgId, this._skillPos);
            this.node.active = false;
            EventMgr.emit(LogicEvent.closeSkill);
        }
    }
}
