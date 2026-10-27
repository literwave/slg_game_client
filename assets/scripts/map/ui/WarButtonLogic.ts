import { _decorator, Color, Component, Graphics, Node, Sprite } from 'cc';
const { ccclass, property } = _decorator;

import BattleCommand from '../../battle/BattleCommand';
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { LogicEvent } from '../../common/LogicEvent';

@ccclass('WarButtonLogic')
export default class WarButtonLogic extends Component {


    @property(Node)
    tipsNode:Node = null;

    protected onEnable():void{
        this.tipsNode = this.tipsNode || this.node.getChildByName('img_gem_21');
        if (this.tipsNode) {
            const sprite = this.tipsNode.getComponent(Sprite); if (sprite) sprite.enabled = false;
            const g = this.tipsNode.getComponent(Graphics) || this.tipsNode.addComponent(Graphics);
            g.clear(); g.fillColor = new Color(204, 56, 44); g.circle(0, 0, 5.5); g.fill();
            g.lineWidth = 1; g.strokeColor = new Color(248, 205, 148); g.circle(0, 0, 5.5); g.stroke();
        }
        EventMgr.on(LogicEvent.upateWarReport, this.updateView, this);
        this.updateView();
    }


    protected updateView():void{
        if (this.tipsNode) this.tipsNode.active = BattleCommand.getInstance().unreadCount > 0;
    }

    protected onDisable():void{
        EventMgr.targetOff(this);
    }

    protected onClickClose(): void {
        this.node.active = false;
        AudioManager.instance.playClick();
    }


}
