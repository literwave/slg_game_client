import { _decorator, BlockInputEvents, Color, Component, Label, Mask, Node, Prefab, ScrollView, UITransform, instantiate, view } from 'cc';
const { ccclass, property } = _decorator;

import ArmyCommand from "../../general/ArmyCommand";
import { ArmyData } from "../../general/ArmyProxy";
import { MapCityData } from "../MapCityProxy";
import CityArmyItemLogic from "./CityArmyItemLogic";
import MapUICommand from "./MapUICommand";
import { CityAddition } from "./MapUIProxy";
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { LogicEvent } from '../../common/LogicEvent';
import GeneralCommand from '../../general/GeneralCommand';
import { ServerConfig } from '../../config/ServerConfig';
import TroopCommand from '../../general/TroopCommand';
import { caption, hideSprite, inkSurface, ManagementColors as C, manualLayout, panelButton, place } from './ManagementStyle';

@ccclass('CityAboutLogic')
export default class CityAboutLogic extends Component {
    @property(Node)
    armyLayer: Node = null;
    @property(Prefab)
    armyItem: Prefab = null;

    protected _armyCnt: number = 5;//队伍数量 固定值
    protected _cityData: MapCityData = null;
    protected _armyComps: CityArmyItemLogic[] = [];
    private _armyScroll: ScrollView = null;
    private _header: Node = null;
    private _facilityButton: Node = null;

    protected onLoad(): void { this.prepareOverview(); }

    protected onEnable(): void {
        this._armyCnt = this.usesWorldTroops() ? 3 : 5;
        this.initView();
        EventMgr.on(LogicEvent.updateCityAddition, this.onUpdateCityAdditon, this);
        EventMgr.on(LogicEvent.updateTroopList, this.updateArmyList, this);
        EventMgr.on(LogicEvent.updateMyGenerals, this.updateArmyList, this);
        EventMgr.on(LogicEvent.updateGeneral, this.updateArmyList, this);
        EventMgr.on(LogicEvent.updateMarches, this.updateArmyList, this);
        view.on('canvas-resize', this.layoutOverview, this);
        view.on('design-resolution-changed', this.layoutOverview, this);
        this.layoutOverview();
    }

    protected onDisable(): void {
        EventMgr.targetOff(this);
        view.off('canvas-resize', this.layoutOverview, this);
        view.off('design-resolution-changed', this.layoutOverview, this);
    }

    protected initView(): void {
        while (this._armyComps.length > this._armyCnt) {
            const old = this._armyComps.pop(); old.node.removeFromParent(); old.node.destroy();
        }
        for (let i = this._armyComps.length; i < this._armyCnt; i++) {
            let item = instantiate(this.armyItem);
            item.parent = this.armyLayer;
            let comp: CityArmyItemLogic = item.getComponent(CityArmyItemLogic);
            comp.order = i + 1;
            this._armyComps.push(comp);
        }
        this.layoutOverview();
    }

    private prepareOverview(): void {
        if (this._header) return;
        if (!this.node.getComponent(BlockInputEvents)) this.node.addComponent(BlockInputEvents);
        const mask = this.node.getChildByName('mask');
        if (mask) mask.active = false;
        const create = (name: string, parent = this.node): Node => {
            const n = new Node(name); n.layer = this.node.layer; parent.addChild(n); n.addComponent(UITransform); return n;
        };
        this._header = create('CityHeader');
        const close = this.node.getChildByName('btnClose'); close.parent = this._header;
        this._facilityButton = this.node.getChildByName('mainNode').getChildByName('btnFacility');
        this._facilityButton.parent = this._header;
        this.node.getChildByName('mainNode').active = false;
        const scroll = create('CityTroopScroll'); this._armyScroll = scroll.addComponent(ScrollView);
        this._armyScroll.horizontal = true; this._armyScroll.vertical = false;
        this._armyScroll.elastic = false;
        const viewport = create('view', scroll); viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        this.armyLayer.parent = viewport; manualLayout(this.armyLayer); hideSprite(this.armyLayer);
        this._armyScroll.content = this.armyLayer;
    }

    private layoutOverview(): void {
        this.prepareOverview();
        const size = this.node.parent?.getComponent(UITransform)?.contentSize || view.getVisibleSize();
        const width = size.width, height = size.height, margin = width < 700 ? 16 : 28;
        place(this.node, 0, 0, width, height);
        place(this._header, 0, height / 2 - 38, width, 76);
        inkSurface(this._header, 'Surface', width, 76, new Color(24, 31, 27, 246), C.line);
        panelButton(this._header.getChildByName('btnClose'), '‹  返回大地图', -width / 2 + margin + 66, 0, 132, 38);
        panelButton(this._facilityButton, '城建设施  ›', width / 2 - margin - 66, 0, 132, 38, true);
        const title = caption(this._header, 'CityName', this._cityData?.name || '主城', 0, 10,
            Math.max(60, width - 360), 22, C.text, Label.HorizontalAlign.CENTER);
        title.node.active = width >= 620;
        const detail = caption(this._header, 'CityDetail', this._cityData ? `主城管理 · (${this._cityData.x}, ${this._cityData.y})` : '主城管理',
            0, -17, Math.max(60, width - 360), 12, C.muted, Label.HorizontalAlign.CENTER);
        detail.node.active = width >= 620;
        const deckHeight = height < 500 ? 176 : 214, cardHeight = deckHeight - 58;
        const deck = inkSurface(this.node, 'CityTroopDeck', width, deckHeight, new Color(24, 31, 27, 242), C.line);
        deck.node.setPosition(0, -height / 2 + deckHeight / 2, 0);
        caption(this.node, 'GarrisonTitle', '城防部队', -width / 2 + margin + 70, -height / 2 + deckHeight - 21, 140, 18, C.gold);
        caption(this.node, 'GarrisonHint', '点击部队调整编队', width / 2 - margin - 100, -height / 2 + deckHeight - 21,
            200, 12, C.muted, Label.HorizontalAlign.RIGHT);
        const available = width - margin * 2, gap = 12;
        const cardWidth = Math.max(252, Math.min(360, (available - gap * 2) / 3));
        const totalWidth = Math.max(available, this._armyComps.length * (cardWidth + gap) - gap);
        place(this._armyScroll.node, 0, -height / 2 + 12 + cardHeight / 2, available, cardHeight + 4);
        const viewport = this._armyScroll.node.getChildByName('view'); place(viewport, 0, 0, available, cardHeight + 4);
        place(this.armyLayer, (totalWidth - available) / 2, 0, totalWidth, cardHeight);
        const occupied = this._armyComps.length * (cardWidth + gap) - gap;
        this._armyComps.forEach((comp, i) => {
            place(comp.node, -Math.min(totalWidth, occupied) / 2 + cardWidth / 2 + i * (cardWidth + gap), 0, cardWidth, cardHeight);
            comp.layoutOverview(cardWidth, cardHeight);
        });
        this._armyScroll.stopAutoScroll(); this._armyScroll.scrollToLeft(0);
    }

    protected onUpdateCityAdditon(cityId: number): void {
        if (this._cityData && this._cityData.cityId == cityId) {
            this.updateArmyList();
        }
    }

    protected updateArmyList(): void {
        if (!this._cityData) return;
        if (this.usesWorldTroops()) {
            const troops = TroopCommand.getInstance().proxy;
            const count = Math.max(3, ...troops.getTroops().map(t => t.troopIdx));
            if (this._armyCnt !== count) { this._armyCnt = count; this.initView(); }
            for (const comp of this._armyComps) {
                comp.isOpenedArmy(true, false);
                comp.setTroopData(this._cityData.cityId, troops.getTroop(comp.order));
            }
            return;
        }
        let additon: CityAddition = MapUICommand.getInstance().proxy.getMyCityAddition(this._cityData.cityId);
        let armyList: ArmyData[] = ArmyCommand.getInstance().proxy.getArmyList(this._cityData.cityId);
        for (let i: number = 0; i < this._armyComps.length; i++) {
            if (i >= additon.armyCnt) {
                //未开启
                this._armyComps[i].isOpenedArmy(false, false);
            } else {
                //已开启
                this._armyComps[i].isOpenedArmy(true, false);
                this._armyComps[i].setArmyData(this._cityData.cityId, armyList[i]);
            }
        }
    }

    public setData(data: MapCityData): void {
        if (!data) return;
        this._cityData = data;
        this.layoutOverview();
        if (this.usesWorldTroops()) TroopCommand.getInstance().requestTroops();
        this.updateArmyList();
        if (GeneralCommand.getInstance().isProtocolAvailable(ServerConfig.c2s_create_build)) {
            MapUICommand.getInstance().qryCityFacilities(this._cityData.cityId);
        }
    }

    private usesWorldTroops(): boolean {
        return GeneralCommand.getInstance().isProtocolAvailable(ServerConfig.c2s_req_troop);
    }


    protected onClickFacility(): void {
        AudioManager.instance.playClick();
        //设施
        EventMgr.emit(LogicEvent.openFacility, this._cityData);
    }


    protected onClickClose(): void {
        AudioManager.instance.playClick();
        this.node.active = false;

        EventMgr.emit(LogicEvent.closeCityAbout, this._cityData);
        
    }
}
