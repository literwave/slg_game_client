import { _decorator, Component, Label, Node } from 'cc';
const {ccclass, property} = _decorator;
import SkillCommand from "../../skill/SkillCommand";
import { Skill } from "../../skill/SkillProxy";
import SkillIconLogic from "./SkillIconLogic";
import { styleSkillCard } from './SkillListView';

const TARGET_NAMES: Record<number, string> = {
    1: '自身', 4: '我军全体', 5: '敌军单体',
    6: '敌军1-2个目标', 7: '敌军2-3个目标', 8: '敌军全体',
};

@ccclass('SkillItemLogic')
export default class SkillItemLogic extends Component {

   
    @property(Label)
    nameLab: Label = null;

       
    @property(Label)
    limitLab: Label = null;

    @property(Node)
    icon:Node = null;

    _skill: Skill = null;

    protected onEnable():void{
        
    }

    protected updateItem(skill:Skill):void{
   
        var conf = SkillCommand.getInstance().proxy.getSkillCfg(skill.cfgId);
        this._skill = skill;
        this.nameLab.string = conf ? conf.name : '未知战法';

        this.icon.getComponent(SkillIconLogic).setData(skill, null);

        const count = (skill.generals || []).length;
        this.limitLab.string = conf ? `装备 ${count}${conf.limit > 0 ? ' / ' + conf.limit : ''}` : '—';
        const outline = SkillCommand.getInstance().proxy.outLine;
        const trigger = outline?.trigger_type?.list?.find(item => item.type === conf?.trigger)?.des;
        const target = outline?.target_type?.list?.find(item => item.type === conf?.target)?.des
            || TARGET_NAMES[conf?.target];
        styleSkillCard(this.node, this.icon, this.nameLab, this.limitLab, conf?.trigger, trigger, target, count > 0);
    }

}
