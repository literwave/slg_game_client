
import { _decorator, Component, Label, Sprite, Layout, Node, color } from 'cc';
const { ccclass, property } = _decorator;

import GeneralCommand from "../../general/GeneralCommand";
import { GeneralData } from "../../general/GeneralProxy";
import TroopCommand from "../../general/TroopCommand";
import GeneralHeadLogic from "./GeneralHeadLogic";
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { LogicEvent } from '../../common/LogicEvent';
import { applyGeneralCardSkin, clearGeneralCardSkin } from './GeneralCardSkin';
import { caption, hideSprite, inkSurface, ManagementColors, place } from './ManagementStyle';

// /**军队命令*/
export class GeneralItemType {
    static GeneralInfo: number = 0;//武将详情
    static GeneralDispose: number = 1;//武将上阵
    static GeneralConScript: number = 2;//武将征兵
    static GeneralNoThing: number = 3;//无用
    static GeneralSelect: number = 4;//选择
}


@ccclass('GeneralItemLogic')
export default class GeneralItemLogic extends Component {

    @property(Label)
    nameLabel: Label = null;

    @property(Label)
    lvLabel: Label = null;

    @property(Sprite)
    spritePic: Sprite = null;

    @property(Label)
    costLabel: Label = null;

    @property(Label)
    campLabel: Label = null;

    @property(Label)
    armLabel: Label = null;

    @property(Layout)
    starLayout: Layout = null;

    @property(Node)
    delNode: Node = null;

    @property(Node)
    useNode: Node = null;


    @property(Node)
    selectNode: Node = null;

    private _curData: any = null;
    private _type: number = GeneralItemType.GeneralInfo;
    private _position: number = 0;
    private _cityData: any = null;
    private _orderId: number = 1;
    private _isSelect: boolean = false;

    protected onLoad(): void {
        if (this.delNode) this.delNode.active = false;
        if (this.useNode) this.useNode.active = false;
        if (this.selectNode) this.selectNode.active = false;
        this._isSelect = false;
    }


    public setData(curData: GeneralData, type: number = 0, position: number = 0): void {
        this.applyItemData(curData, type, position);
    }



    public updateItem(curData: any, type: number = null, position: number = null): void {
        if (!curData) {
            return;
        }
        this._type = type != null ? type : (curData.listType != null ? curData.listType : GeneralItemType.GeneralInfo);
        this._position = position != null ? position : (curData.listPosition != null ? curData.listPosition : 0);
        this.updateView(curData);
    }

    private applyItemData(curData: any, type: number, position: number): void {
        if (!curData) {
            return;
        }
        this._type = type;
        this._position = position;
        this.updateView(curData);
    }


    protected updateView(curData: any): void {
        clearGeneralCardSkin(this.node);
        this._curData = curData;

        // 服务器下发的 hero_type 就是配置 ID
        const hero_type = this.getHeroIdx(this._curData);
        let cfgData = GeneralCommand.getInstance().proxy.getGeneralCfg(hero_type);

        if (cfgData && cfgData.name) {
            this.nameLabel.string = cfgData.name;
            this.showStar(cfgData.star, this._curData.star_lv || 0);
            if (this.armLabel) this.armLabel.string = cfgData.heroClass || this.armstr(cfgData.arms || []);
            if (this.costLabel) {
                const costText = cfgData.cost > 0 ? String(cfgData.cost) : (cfgData.quality > 0 ? String(cfgData.quality) : "");
                this.costLabel.string = costText;
                this.costLabel.node.active = costText != "";
            }

            const campMap: { [key: number]: string } = {
                1: "汉", 2: "群", 3: "魏", 4: "蜀", 5: "吴"
            };
            const campText = cfgData.campText || campMap[cfgData.camp] || "";
            if (this.campLabel) {
                this.campLabel.string = campText;
                this.campLabel.node.active = campText != "";
            }
        } else {
            this.nameLabel.string = "未知武将";
            this.showStar(0, 0);
            console.warn("武将显示异常: hero_type=", hero_type, "cfgData=", cfgData, "原始数据对象:", this._curData);
        }

        this.lvLabel.string = "Lv." + (this._curData.level || 1);

        const headLogic = this.spritePic ? this.spritePic.getComponent(GeneralHeadLogic) : null;
        if (headLogic) {
            headLogic.setHeadId(hero_type);
        } else {
            console.warn("GeneralItemLogic: GeneralHeadLogic component not found on spritePic node.");
        }

        if (this.delNode) this.delNode.active = false;
        if (this.useNode) {
            const troopIdx = TroopCommand.getInstance().proxy.getTroopIdxByHero(hero_type);
            this.useNode.active = troopIdx > 0;
            if (troopIdx > 0) {
                hideSprite(this.useNode);
                // 网格卡片会缩放到一半：横幅和字号按最终显示尺寸设计，居中覆盖人物躯干。
                place(this.useNode, 0, 0, 298, 76);
                const banner = inkSurface(this.useNode, 'TroopBadge', 298, 76, color(24, 29, 26, 250), null);
                banner.strokeColor = color(232, 195, 119, 255);
                banner.lineWidth = 3;
                banner.roundRect(-147.5, -36.5, 295, 73, 4);
                banner.stroke();
                banner.lineWidth = 1;
                banner.strokeColor = ManagementColors.gold;
                banner.moveTo(-135, 29); banner.lineTo(135, 29);
                banner.moveTo(-135, -29); banner.lineTo(135, -29);
                banner.stroke();
                const number = caption(this.useNode, 'TroopNumber', `部队${troopIdx}`, 0, 0, 272, 40,
                    color(255, 233, 181, 255), Label.HorizontalAlign.CENTER);
                number.fontFamily = 'Microsoft YaHei';
                number.isBold = true;
            }
        }
        this.select(false);
        if (curData.listAppearance === 'roster') {
            applyGeneralCardSkin(this.node, {
                name: this.nameLabel.string,
                level: this.lvLabel.string,
                role: cfgData ? (this.armLabel?.string || '') : '',
                camp: cfgData ? (this.campLabel?.string || '') : '',
                stat: cfgData?.cost > 0 ? '统御 ' + cfgData.cost :
                    (cfgData?.quality > 0 ? '品阶 ' + cfgData.quality : ''),
                stars: cfgData?.star || 0,
                promotedStars: curData.star_lv || 0,
            });
        }
    }

    protected armstr(arms: number[]): string {
        // console.log("armstr:", arms);

        var str = ""
        if (arms.indexOf(1) >= 0 || arms.indexOf(4) >= 0 || arms.indexOf(7) >= 0) {
            str += "步"
        } else if (arms.indexOf(2) >= 0 || arms.indexOf(5) >= 0 || arms.indexOf(8) >= 0) {
            str += "弓"
        } else if (arms.indexOf(3) >= 0 || arms.indexOf(6) >= 0 || arms.indexOf(9) >= 0) {
            str += "骑"
        }
        return str;
    }

    private getHeroIdx(data: any): number {
        return GeneralData.getHeroId(data);
    }


    public select(flag: boolean): void {
        if (this.selectNode) {
            this.selectNode.active = flag;
        }
        this._isSelect = flag;
    }


    protected showStar(star: number = 3, star_lv: number = 0): void {
        if (!this.starLayout || !this.starLayout.node) {
            return;
        }
        var childen = this.starLayout.node.children;
        for (var i = 0; i < childen.length; i++) {
            const starSprite = childen[i].getComponent(Sprite);
            if (!starSprite) {
                continue;
            }
            if (i < star) {
                childen[i].active = true;
                if (i < star_lv) {
                    starSprite.color = color(255, 0, 0);
                } else {
                    starSprite.color = color(255, 255, 255);
                }
            } else {
                childen[i].active = false;
            }
        }
        // 星数变化后立即按实际内容居中，避免复用卡牌时保留上一帧的位置。
        this.starLayout.updateLayout();
    }

    protected setOtherData(cityData: any, orderId: number = 1): void {
        this._cityData = cityData;
        this._orderId = orderId
        if (this.delNode) this.delNode.active = true;
    }


    protected onClickGeneral(event: any): void {
        AudioManager.instance.playClick();
        if (this._curData) {
            const heroId = this.getHeroIdx(this._curData);
            var cfgData = this._curData.config || GeneralCommand.getInstance().proxy.getGeneralCfg(heroId);
            console.log("onClickGeneral:", this._type);

            //武将详情
            if (this._type == GeneralItemType.GeneralInfo) {
                EventMgr.emit(LogicEvent.openGeneralDes, cfgData, this._curData);
            }

            //上阵
            else if (this._type == GeneralItemType.GeneralDispose) {
                EventMgr.emit(LogicEvent.chosedGeneral, cfgData, this._curData, this._position);
            }

            //征兵
            else if (this._type == GeneralItemType.GeneralConScript) {
                EventMgr.emit(LogicEvent.openArmyConscript, this._orderId, this._cityData);
            }

            else if (this._type == GeneralItemType.GeneralSelect) {
                this._isSelect = !this._isSelect;
                this.select(this._isSelect);
                EventMgr.emit(LogicEvent.openGeneralSelect, cfgData, this._curData, this.node);
            }
        }


    }




    /**
     * 下阵
     */
    protected onDelete(): void {
        if (!this._curData) {
            return;
        }
        var cfgData = this._curData.config || GeneralCommand.getInstance().proxy.getGeneralCfg(this.getHeroIdx(this._curData));
        EventMgr.emit(LogicEvent.chosedGeneral, cfgData, this._curData, -1);
    }




    /**
     * 战报的
     * @param curData 
     */
    public setWarReportData(curData: any): void {
        this.updateView(curData)
    }

}
