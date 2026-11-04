import { _decorator, Component, Label, Node } from 'cc';
const {ccclass, property} = _decorator;
import SkillCommand from "../../skill/SkillCommand";
import { Skill } from "../../skill/SkillProxy";
import SkillIconLogic from "./SkillIconLogic";
import { styleSkillCard } from './SkillListView';

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
        this.limitLab.string = '已装备';
        styleSkillCard(this.node, this.icon, this.nameLab, this.limitLab, count > 0);
    }

}
