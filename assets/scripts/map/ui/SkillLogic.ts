import { _decorator, Component, ScrollView } from 'cc';
const {ccclass, property} = _decorator;

import { GeneralData } from "../../general/GeneralProxy";
import GeneralCommand from "../../general/GeneralCommand";
import SkillCommand from "../../skill/SkillCommand";
import { Skill } from "../../skill/SkillProxy";
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import ListLogic from '../../utils/ListLogic';
import { LogicEvent } from '../../common/LogicEvent';
import SkillListView from './SkillListView';

@ccclass('SkillLogic')
export default class SkillLogic extends Component {

    @property(ScrollView)
    scrollView: ScrollView = null;

    _general: GeneralData = null;
    _type: number = 0;
    _skillPos : number = -1;
    private listView: SkillListView = null;
    private triggerFilter = 0;
    private items: Skill[] = [];

    protected onEnable():void{
        this.ensureView().refreshSize();
        EventMgr.on(LogicEvent.skillListInfo, this.onSkillList, this);
        EventMgr.on(LogicEvent.updateGeneral, this.onSkillList, this);
        this.onSkillList();
        SkillCommand.getInstance().qrySkillList();
    }

    protected onDisable():void {
        EventMgr.targetOff(this)
    }

    protected onDestroy(): void {
        this.listView?.dispose();
    }

    private ensureView(): SkillListView {
        if (!this.listView) this.listView = new SkillListView(this.node, this.scrollView,
            value => this.onFilterChanged(value));
        return this.listView;
    }

    private onFilterChanged(value: number): void {
        if (this.triggerFilter === value) return;
        AudioManager.instance.playClick();
        this.triggerFilter = value;
        this.renderList(true);
    }

    private renderList(reset = false): void {
        const proxy = SkillCommand.getInstance().proxy;
        const items = this.items.filter(item => !this.triggerFilter || proxy.getSkillCfg(item.cfgId)?.trigger === this.triggerFilter);
        const comp = this.scrollView?.node.getComponent(ListLogic);
        if (comp) comp.setData(items, reset ? undefined : 0);
        this.ensureView().setState(this.triggerFilter, items.length, this.items.length);
    }

    protected onSkillList(){
    
        const proxy = SkillCommand.getInstance().proxy;
        const generals = GeneralCommand.getInstance().proxy.getMyGenerals();
        this.items = proxy.skillConfs.map(conf => {
            const item = Object.assign(new Skill(), proxy.getSkillForDisplay(conf.cfgId));
            item.generals = generals.filter(general =>
                (general.skills || []).some(skill => skill && skill.cfgId === conf.cfgId)
            ).map(general => general.id);
            return item;
        });
        this.renderList();
    }

    protected onClickClose(): void {
        this.node.active = false;
        AudioManager.instance.playClick();
    }

    protected onClickItem(data: Skill, target): void {
        AudioManager.instance.playClick();
        EventMgr.emit(LogicEvent.openSkillInfo, data, this._type, this._general, this._skillPos);
    }


    /** type:0普通展示、type:1 学习、2:武将查看 **/
    public setData(type:number, general:GeneralData, skillPos: number) {
        this._type = type;
        this._general = general;
        this._skillPos = skillPos;
        this.triggerFilter = 0;
        this.renderList(true);
    }

}
