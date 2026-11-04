import { _decorator, Component, Label, Sprite } from 'cc';
const {ccclass, property} = _decorator;


import { gSkill } from "../../general/GeneralProxy";
import SkillCommand from "../../skill/SkillCommand";
import { Skill } from "../../skill/SkillProxy";


@ccclass('SkillIconLogic')
export default class SkillIconLogic extends Component {

    @property(Label)
    lvLab:Label = null;

    _data: Skill = null;
    private _iconRequest: number = 0;

    protected onLoad(): void {
        this.hideLegacyFrame();
    }

    private hideLegacyFrame(): void {
        // 旧圆形饰框没有状态含义；保留节点和等级引用，仅关闭装饰 Sprite。
        const frame = this.node.getChildByName('wrap')?.getComponent(Sprite);
        if (frame) frame.enabled = false;
    }

    public setData(data:Skill, gdata:gSkill):void{

        this.hideLegacyFrame();
        this._data = data;
        const request = ++this._iconRequest;

        if(gdata){
            if(this.lvLab){
                this.lvLab.string = "lv:" + gdata.lv;
            }
        }else{
            if(this.lvLab){
                this.lvLab.string = "";
            }
        }
        const sprite = this.getComponent(Sprite);
        if (!sprite) return;
        const proxy = SkillCommand.getInstance().proxy;
        // 图片尺寸不改变现有技能格子的大小。
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        const cached = data ? proxy.getSkillIcon(data.cfgId) : null;
        sprite.spriteFrame = cached;
        if (!data || cached) return;
        // 正常进图已准备好全部图标；资源失效或单独打开界面时只加载对应的新图。
        proxy.loadSkillIcon(data.cfgId).then(frame => {
            // 列表复用、清空或销毁后，旧请求不能覆盖当前技能图标。
            if (!this.isValid || !sprite.isValid || request !== this._iconRequest) return;
            if (frame?.isValid) sprite.spriteFrame = frame;
        });
    }

    protected onDestroy(): void {
        this._iconRequest++;
    }

    public isEmpty():boolean {
        return this._data == null;
    }

    public getSkill():Skill {
        return this._data;
    }

}
