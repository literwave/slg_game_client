import { _decorator, BlockInputEvents, Button, Component, Label, Mask, Node, ScrollView, Sprite, UITransform, Vec2, view } from 'cc';
import CityCommand from '../../world/CityCommand';
import WorldCommand from '../../world/WorldCommand';
import LoginCommand from '../../login/LoginCommand';
import TroopCommand from '../../general/TroopCommand';
import GeneralCommand from '../../general/GeneralCommand';
import GeneralHeadLogic from './GeneralHeadLogic';
import WorldCampaign from '../WorldCampaign';
import { cityDeploymentCount, ownCityDeployments } from '../CityDeployment';
import { hasId, idKey } from '../../network/pto/ProtocolCommand';
import { EventMgr } from '../../utils/EventMgr';
import { LogicEvent as E } from '../../common/LogicEvent';
import { caption, inkSurface, ManagementColors as C, panelButton, place } from './ManagementStyle';

const { ccclass } = _decorator;

/** 城池收纳驻留部队。总数来自城池协议，自己的编队和回城操作来自实时行军快照。 */
@ccclass('CityTroopsPanel')
export default class CityTroopsPanel extends Component {
    private cityId = '';
    private panel: Node;
    private content: Node;
    private scroll: ScrollView;
    private width = 440;
    private height = 400;
    private queued = false;

    protected onEnable(): void {
        for (const event of [E.updateAllianceCities, E.updateMarches, E.updateTroopList, E.updateTroop,
            E.updateMyGenerals, E.updateMyRole, E.protocolRequestChanged]) EventMgr.on(event, this.queueRefresh, this);
        EventMgr.on(E.enterLogin, this.close, this);
        this.node.on(Node.EventType.SIZE_CHANGED, this.queueRefresh, this);
    }
    protected onDisable(): void {
        EventMgr.targetOff(this); this.node.off(Node.EventType.SIZE_CHANGED, this.queueRefresh, this);
        this.unschedule(this.refresh); this.queued = false;
    }
    protected onDestroy(): void { EventMgr.targetOff(this); }

    show(cityId: number | string): void {
        this.cityId = idKey(cityId); this.node.active = true;
        if (!this.panel) this.build();
        this.refresh();
        CityCommand.getInstance().requestInfo(cityId);
    }

    private make(name: string, parent: Node, width: number, height: number): Node {
        const node = new Node(name); node.layer = parent.layer; parent.addChild(node);
        node.addComponent(UITransform); place(node, 0, 0, width, height); return node;
    }
    private button(parent: Node, name: string, text: string, x: number, y: number, width: number, action: () => void): Node {
        const node = this.make(name, parent, width, 36), button = node.addComponent(Button);
        button.target = node; button.transition = Button.Transition.SCALE; button.zoomScale = .97;
        node.on(Button.EventType.CLICK, action, this); panelButton(node, text, x, y, width, 36);
        return node;
    }
    private build(): void {
        this.node.addComponent(BlockInputEvents);
        this.panel = this.make('Panel', this.node, this.width, this.height);
        this.button(this.panel, 'Close', '×', 0, 0, 36, this.close);
        const list = this.make('TroopList', this.panel, 400, 260);
        this.scroll = list.addComponent(ScrollView); this.scroll.horizontal = false; this.scroll.vertical = true;
        this.scroll.cancelInnerEvents = true;
        const viewport = this.make('Viewport', list, 400, 260);
        viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        this.content = this.make('Content', viewport, 400, 260);
        this.content.getComponent(UITransform).setAnchorPoint(.5, 1);
        this.scroll.content = this.content;
    }
    private queueRefresh(): void {
        if (this.queued || !this.node.activeInHierarchy) return;
        this.queued = true; this.scheduleOnce(this.refresh, 0);
    }
    private refresh(): void {
        this.queued = false;
        if (!this.panel || !this.node.activeInHierarchy) return;
        const cities = CityCommand.getInstance().cities, city = cities.get(this.cityId);
        const allianceId = LoginCommand.getInstance().proxy.getRoleData()?.allianceId;
        if (!city || !hasId(allianceId) || idKey(city.allianceId) !== idKey(allianceId)) { this.close(); return; }
        const world = WorldCommand.getInstance(), marches = ownCityDeployments(this.cityId, world.marches.values(), cities);
        const total = cityDeploymentCount(city), allies = Math.max(0, total - marches.length);
        const size = view.getVisibleSize(); this.width = Math.min(460, size.width - 32);
        this.height = Math.min(460, size.height - 48, Math.max(230, 110 + marches.length * 94 + (allies ? 50 : 0)));
        place(this.node, 0, 0, size.width, size.height);
        inkSurface(this.node, 'Shade', size.width, size.height, C.inset, null);
        place(this.panel, 0, 0, this.width, this.height);
        inkSurface(this.panel, 'Background', this.width, this.height, C.ink, C.gold);
        const top = this.height / 2;
        caption(this.panel, 'Title', WorldCampaign.landmark(city.pos.x, city.pos.y) || '城池驻军',
            -21, top - 32, this.width - 86, 23, C.text).isBold = true;
        caption(this.panel, 'Count', `队伍 × ${total}`, 0, top - 65, this.width - 44, 14, C.gold);
        place(this.panel.getChildByName('Close'), this.width / 2 - 30, top - 30, 36, 36);
        const listHeight = this.height - 105, listWidth = this.width - 32;
        place(this.scroll.node, 0, -36, listWidth, listHeight);
        const viewport = this.scroll.node.getChildByName('Viewport'); place(viewport, 0, 0, listWidth, listHeight);
        const offset = this.scroll.getScrollOffset().y;
        for (const child of [...this.content.children]) { child.removeFromParent(); child.destroy(); }
        this.content.getComponent(UITransform).setContentSize(listWidth, Math.max(listHeight, marches.length * 94 + (allies ? 50 : 0)));
        this.content.setPosition(0, listHeight / 2, 0);
        for (const [index, march] of marches.entries()) {
            const troop = TroopCommand.getInstance().proxy.getTroop(march.troopIdx);
            const heroId = troop?.getHeroIdxAt(0), proxy = GeneralCommand.getInstance().proxy;
            const general = heroId ? proxy.getMyGeneral(heroId) : null;
            const cfg = general?.config || (heroId ? proxy.getGeneralCfg(heroId) : null);
            const row = this.make('Troop' + march.troopIdx, this.content, listWidth, 86);
            row.setPosition(0, -43 - index * 94, 0);
            inkSurface(row, 'Card', listWidth, 86, C.panel, C.line);
            const portrait = this.make('Portrait', row, 48, 62); portrait.setPosition(-listWidth / 2 + 34, 0, 0);
            portrait.addComponent(Sprite).sizeMode = Sprite.SizeMode.CUSTOM;
            if (heroId) portrait.addComponent(GeneralHeadLogic).setHeadId(general?.cfgId || heroId);
            const textWidth = listWidth - 156, x = -listWidth / 2 + 68 + textWidth / 2;
            caption(row, 'Name', cfg?.name ? cfg.name + '队' : `第${march.troopIdx}部队`, x, 22, textWidth, 17, C.text).isBold = true;
            const count = troop?.getSortedHeroes().reduce((sum, h) => sum + troop.getSoldier(h.heroIdx).count, 0);
            caption(row, 'Soldiers', count === undefined ? '兵力同步中' : `兵力 ${count.toLocaleString()}`, x, -2, textWidth, 14, C.gold);
            caption(row, 'State', '我的部队 · 驻留', x, -25, textWidth, 12, C.muted);
            const action = this.button(row, 'Recall', '回城', listWidth / 2 - 45, 0, 70, () => this.recall(march.troopIdx));
            action.getComponent(Button).interactable = !world.returnToCityIssue(march.troopIdx);
        }
        if (allies) caption(this.content, 'Allies', `同盟队伍 × ${allies}`, 0, -marches.length * 94 - 24,
            listWidth - 24, 15, C.muted, Label.HorizontalAlign.CENTER);
        if (!total && !marches.length) caption(this.content, 'Empty', '暂无驻留队伍', 0, -65, listWidth - 24, 16, C.muted, Label.HorizontalAlign.CENTER);
        this.scroll.scrollToOffset(new Vec2(0, Math.max(0, offset)), 0);
    }
    private recall(troopIdx: number): void {
        const world = WorldCommand.getInstance(), cities = CityCommand.getInstance().cities;
        if (!ownCityDeployments(this.cityId, world.marches.values(), cities).some(m => m.troopIdx === troopIdx)) return;
        const issue = world.returnToCityIssue(troopIdx);
        if (issue) EventMgr.emit(E.showToast, issue);
        else if (!world.returnTroopToCity(troopIdx)) EventMgr.emit(E.showToast, '回城请求未发送');
        this.queueRefresh();
    }
    private close(): void { this.node.active = false; }
}
