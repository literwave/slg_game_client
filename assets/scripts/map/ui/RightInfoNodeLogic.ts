import { _decorator, BlockInputEvents, Component, Mask, Toggle, ScrollView, Prefab, Node, instantiate, tween, Tween, Vec3, UITransform, Label, Layout, Color, Button, Sprite } from 'cc';
const { ccclass, property } = _decorator;

import { ArmyData } from "../../general/ArmyProxy";
import TroopCommand from "../../general/TroopCommand";
import { TroopData } from "../../general/TroopProxy";
import MapCommand from "../MapCommand";
import RightArmyItemLogic from "./RightArmyItemLogic";
import { MapCityData } from "../MapCityProxy";
import RightCityItemLogic from "./RightCityItemLogic";
import RightTagItemLogic from "./RightTagItemLogic";
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { LogicEvent } from '../../common/LogicEvent';
import { CoreEvent } from '../../core/CoreEvent';
import { drawCommandPanel, drawCommandHandle } from './RightHudSkin';
import MapMarkCommand from '../../world/MapMarkCommand';
import { caption, ManagementColors, panelButton, place } from './ManagementStyle';
import { commandEmpty, commandTab } from './RightSidebarView';
import SidebarIconCache from './SidebarIconCache';

@ccclass('RightInfoNodeLogic')
export default class RightInfoNodeLogic extends Component {
    @property([Toggle])
    toggles: Toggle[] = [];
    @property(ScrollView)
    armyScrollView: ScrollView = null;
    @property(ScrollView)
    cityScrollView: ScrollView = null;
    @property(ScrollView)
    tagsScrollView: ScrollView = null;

    @property(Prefab)
    armyItemPrefabs: Prefab = null;
    @property(Prefab)
    cityItemPrefabs: Prefab = null;

    @property(Prefab)
    tagItemPrefabs: Prefab = null;

    protected _armys: Node[] = [];

    private _collapsed: boolean = false;
    private _animating: boolean = false;
    private _expandedPos: Vec3 = new Vec3();
    private _collapsedX: number = 0;
    private _arrowNode: Node = null;
    private _arrowBasePos: Vec3 = new Vec3();
    private _tabExpandedPos: Vec3 = new Vec3();
    private _tabCollapsedPos: Vec3 = new Vec3();
    private _tabNode: Node = null;
    private _tileToggle: Toggle = null;
    private _tileScroll: ScrollView = null;
    private _tilePanel: Node = null;
    private _tileHeight = 0;
    private _baseHeight = 240;
    private _selectedTab = 0;
    private _previousTab = 0;
    private _tileLayoutKey = '';


    protected onLoad(): void {
        EventMgr.on(CoreEvent.gameReady, this.refreshTabStyle, this);
        EventMgr.on(LogicEvent.updateArmyList, this.onUpdateArmyList, this);
        EventMgr.on(LogicEvent.updateArmy, this.onUpdateArmy, this);
        EventMgr.on(LogicEvent.updateTroopList, this.onUpdateTroopList, this);
        EventMgr.on(LogicEvent.updateTroop, this.onUpdateTroop, this);
        EventMgr.on(LogicEvent.updateTag, this.onUpdateTag, this);

        this.ensureTileTab();
        this.initToggleEvents();
        SidebarIconCache.prepare().then(() => { if (this.isValid) this.refreshTabStyle(); })
            .catch(error => console.warn('侧栏图标加载失败，保留功能图形', error));
        this.selectTab(0);
        this.scheduleOnce(this.layoutPanel, 0);
        if (this.node.parent) {
            this.node.parent.on(Node.EventType.SIZE_CHANGED, this.layoutPanel, this);
        }
        this.initArmys();
        // MapUILogic 统一请求部队数据，避免首屏重复请求和重建列表。
    }

    protected onDestroy(): void {
        if (this.node.parent) {
            this.node.parent.off(Node.EventType.SIZE_CHANGED, this.layoutPanel, this);
        }
        Tween.stopAllByTarget(this.node);
        if (this._tabNode) {
            Tween.stopAllByTarget(this._tabNode);
        }
        EventMgr.targetOff(this);
        if (this._arrowNode) {
            Tween.stopAllByTarget(this._arrowNode);
        }
        this.toggles.forEach((toggle: Toggle) => {
            if (toggle && toggle.node && toggle.node.isValid) {
                toggle.node.off(Toggle.EventType.TOGGLE, this.onClockToggle, this);
            }
        });
        this._armys.length = 0;
        this._armys = null;
    }

    protected initArmys(): void {
        const troops: TroopData[] = TroopCommand.getInstance().proxy.getTroops();
        const troopMap: Map<number, TroopData> = new Map<number, TroopData>();
        troops.forEach((troop) => troopMap.set(troop.troopIdx, troop));

        const troopCount = Math.max(3, troops.length > 0 ? troops[troops.length - 1].troopIdx : 0);
        while (this._armys.length > troopCount) {
            const item = this._armys.pop();
            item.removeFromParent();
            item.destroy();
        }
        for (let troopIdx: number = 1; troopIdx <= troopCount; troopIdx++) {
            let troop = troopMap.get(troopIdx);
            if (!troop) {
                troop = new TroopData();
                troop.troopIdx = troopIdx;
            }
            let item = this._armys[troopIdx - 1];
            if (!item || !item.isValid) {
                item = instantiate(this.armyItemPrefabs);
                item.parent = this.armyScrollView.content;
                this._armys[troopIdx - 1] = item;
            }
            const itemLogic = item.getComponent(RightArmyItemLogic);
            if (itemLogic) {
                itemLogic.setTroopData(troop, troopIdx);
            }
        }
        this.armyScrollView.content.getComponent(Layout)?.updateLayout();
        this.layoutPanel();
    }

    protected initCitys(): void {
        let citys: MapCityData[] = MapCommand.getInstance().cityProxy.getMyCitys();
        this.clearList(this.cityScrollView);
        if (citys && citys.length > 0) {
            for (let i: number = 0; i < citys.length; i++) {
                let item: Node = instantiate(this.cityItemPrefabs);
                item.parent = this.cityScrollView.content;
                item.getComponent(RightCityItemLogic).setArmyData(citys[i]);
            }
        } else {
            commandEmpty(this.cityScrollView.content, 'CityEmpty', '暂无城池', 'city', 248);
        }
        this.cityScrollView.content.getComponent(Layout)?.updateLayout();
    }

    protected initTags(): void {
        const command = MapMarkCommand.getInstance();
        let tags = MapCommand.getInstance().proxy.getPosTags();
        this.clearList(this.tagsScrollView);
        const content = this.tagsScrollView.content, width = content.getComponent(UITransform).width || 250;
        if (command.loading || command.error) {
            const summary = caption(content, 'MarkSummary', command.loading ? '正在读取标记…' : command.error,
                0, 0, width, 13, ManagementColors.gold, Label.HorizontalAlign.CENTER);
            summary.node.getComponent(UITransform).setContentSize(width, 32);
        }
        if (command.error && !command.loading) {
            const retry = new Node('MarkRetry'); retry.layer = content.layer; content.addChild(retry);
            retry.addComponent(Button); panelButton(retry, '重新读取', 0, 0, width, 32);
            retry.on(Button.EventType.CLICK, () => command.requestList());
        }
        if (command.loaded && !tags.length && !command.loading && !command.error) {
            commandEmpty(content, 'MarkEmpty', '点选地块，插旗收藏', 'flag', width);
        }
        for (let i: number = 0; i < tags.length; i++) {
            var tag = tags[i];


            let item: Node = instantiate(this.tagItemPrefabs);
            item.parent = this.tagsScrollView.content;
            item.getComponent(RightTagItemLogic).setData(tag);
        }
        content.getComponent(Layout)?.updateLayout();
    }

    protected onUpdateArmyList(datas: ArmyData[]): void {
        this.initArmys();
    }

    protected onUpdateArmy(data: ArmyData): void {
        const mainCity = MapCommand.getInstance().cityProxy.getMyMainCity();
        if (data && mainCity && this._armys[data.order - 1] && mainCity.cityId == data.cityId) {
            this._armys[data.order - 1].getComponent(RightArmyItemLogic).setArmyData(data);
        }
    }

    protected onUpdateTroopList(): void {
        this.initArmys();
    }

    protected onUpdateTroop(troop: TroopData): void {
        if (!troop) {
            return;
        }
        const item = this._armys[troop.troopIdx - 1];
        if (item) {
            const itemLogic = item.getComponent(RightArmyItemLogic);
            if (itemLogic) {
                const previousHeight = item.getChildByName('topNode')?.getComponent(UITransform)?.height;
                itemLogic.setTroopData(troop, troop.troopIdx);
                if (previousHeight !== item.getChildByName('topNode')?.getComponent(UITransform)?.height) this.layoutPanel();
            }
        } else {
            this.initArmys();
        }
    }

    protected onUpdateTag(): void {
        if (this.tagsScrollView.node.active) this.initTags();
    }

    private clearList(scrollView: ScrollView): void {
        const items = scrollView.content.children.slice();
        scrollView.content.removeAllChildren();
        items.forEach(item => item.destroy());
    }

    private initToggleEvents(): void {
        this.toggles.forEach((toggle: Toggle) => {
            if (toggle && toggle.node) {
                toggle.node.off(Toggle.EventType.TOGGLE, this.onClockToggle, this);
                toggle.node.on(Toggle.EventType.TOGGLE, this.onClockToggle, this);
            }
        });
    }

    private ensureTileTab(): void {
        if (this._tileToggle) return;
        this._baseHeight = this.node.getComponent(UITransform).height;
        const tab = new Node('TileTab'); tab.layer = this.node.layer; tab.active = false;
        this.toggles[0].node.parent.addChild(tab); tab.addComponent(UITransform);
        this._tileToggle = tab.addComponent(Toggle);
        this._tileToggle.isChecked = false;
        caption(tab, 'Label', '地块', 0, 0, 48, 13, ManagementColors.muted, Label.HorizontalAlign.CENTER);
        this.toggles.push(this._tileToggle);
        tab.on(Toggle.EventType.TOGGLE, this.onClockToggle, this);
        const root = new Node('TileScrollView'); root.layer = this.node.layer; this.node.addChild(root);
        root.addComponent(UITransform); root.addComponent(BlockInputEvents);
        this._tileScroll = root.addComponent(ScrollView);
        this._tileScroll.horizontal = false; this._tileScroll.vertical = true;
        this._tileScroll.elastic = false; this._tileScroll.inertia = true;
        const viewport = new Node('view'); viewport.layer = root.layer; root.addChild(viewport);
        viewport.addComponent(UITransform); viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        commandEmpty(viewport, 'NoSelection', '点选地图，查看地块', 'land', 216);
        root.active = false; this._tileScroll.enabled = false;
        tab.active = true;
    }

    public showTilePanel(panel: Node, height: number, select: boolean): void {
        this.ensureTileTab();
        const changed = this._tilePanel !== panel || this._tileHeight !== height;
        this._tilePanel = panel; this._tileHeight = height;
        const viewport = this._tileScroll.node.getChildByName('view');
        if (panel.parent !== viewport) panel.parent = viewport;
        if (this._tileScroll.content !== panel) this._tileScroll.content = panel;
        this._tileScroll.enabled = true; viewport.getChildByName('NoSelection').active = false;
        const switching = select && this._selectedTab !== 3;
        if (switching) {
            this._previousTab = this._selectedTab;
            this.selectTab(3);
        }
        panel.active = this._selectedTab === 3;
        if (select && this._collapsed) { this._collapsed = false; this.layoutPanel(); }
        else if (changed && !switching) this.layoutPanel();
        if (select) {
            this._tileScroll.stopAutoScroll(); this._tileScroll.scrollToTop(0);
            panel.setPosition(0, this._tileScroll.node.getChildByName('view').getComponent(UITransform).height / 2 - height / 2, 0);
        }
    }

    public releaseTilePanel(panel: Node): void {
        if (this._tilePanel !== panel) return;
        panel.active = false; this._tilePanel = null; this._tileHeight = 0;
        this._tileScroll.stopAutoScroll(); this._tileScroll.content = null; this._tileScroll.enabled = false;
        this._tileScroll.node.getChildByName('view').getChildByName('NoSelection').active = true;
        if (this._selectedTab === 3) this.selectTab(Math.min(2, this._previousTab));
        this.layoutPanel();
    }

    private layoutPanel(): void {
        // 四页共用一个选中状态，初始化、页签切换和重新排版时都保持互斥。
        const tile = this._selectedTab === 3;
        this.armyScrollView.node.active = this._selectedTab === 0;
        this.cityScrollView.node.active = this._selectedTab === 1;
        this.tagsScrollView.node.active = this._selectedTab === 2;
        if (this._tileScroll) this._tileScroll.node.active = tile;
        if (this._tilePanel) this._tilePanel.active = tile;
        const parentUi = this.node.parent ? this.node.parent.getComponent(UITransform) : null;
        const panelUi = this.getComponent(UITransform);
        if (!parentUi || !panelUi) {
            return;
        }
        const available = Math.max(160, parentUi.height - 192);
        const armyHeight = this._armys.reduce((height, item) => height + (item.getChildByName('topNode')?.getComponent(UITransform)?.height || 100), 82)
            + Math.max(0, this._armys.length - 1) * 8;
        const preferred = this._selectedTab === 0 ? Math.max(300, Math.min(402, armyHeight)) : Math.max(300, this._baseHeight);
        panelUi.height = Math.min(available, tile ? Math.max(288, this._tileHeight + 82) : preferred);
        const viewHeight = panelUi.height - 82;
        for (const scroll of [this.armyScrollView, this.cityScrollView, this.tagsScrollView]) {
            place(scroll.node, 0, -31, panelUi.width - 8, viewHeight);
            const viewport = scroll.node.getChildByName('view');
            if (viewport) place(viewport, 0, 0, panelUi.width - 8, viewHeight);
        }
        if (this._tileScroll) {
            const viewport = this._tileScroll.node.getChildByName('view');
            const key = `${panelUi.width}:${viewHeight}:${this._tileHeight}`;
            if (this._tileLayoutKey !== key) {
                this._tileLayoutKey = key;
                place(this._tileScroll.node, 0, -31, panelUi.width - 8, viewHeight);
                place(viewport, 0, 0, panelUi.width - 8, viewHeight);
                if (this._tilePanel) this._tilePanel.setPosition(0, viewHeight / 2 - this._tileHeight / 2, 0);
            }
        }
        Tween.stopAllByTarget(this.node);
        if (this._tabNode) {
            Tween.stopAllByTarget(this._tabNode);
        }
        this._animating = false;
        if (this._arrowNode) {
            Tween.stopAllByTarget(this._arrowNode);
            this._arrowNode.setPosition(this._arrowBasePos);
        }
        this.node.setPosition(parentUi.width * 0.5 - 12 - panelUi.width * 0.5, parentUi.height * 0.5 - 96 - panelUi.height * 0.5, 0);
        this.initCollapseState();
        this.refreshTabStyle();
        if (this._collapsed) {
            this.node.setPosition(this._collapsedX, this._expandedPos.y, this._expandedPos.z);
            if (this._tabNode) {
                this._tabNode.setPosition(this._tabCollapsedPos);
            }
        } else if (this._tabNode) {
            this._tabNode.setPosition(this._tabExpandedPos);
        }
    }

    private initCollapseState(): void {
        this._expandedPos.set(this.node.position);
        this._tabNode = this.node.parent ? this.node.parent.getChildByName('RightInfoTab') : null;
        this._arrowNode = this._tabNode ? this._tabNode.getChildByName('Arrow') : null;
        if (this._arrowNode) {
            this._arrowBasePos.set(this._arrowNode.position);
        }
        this._tabExpandedPos.set(this._tabNode ? this._tabNode.position : this.node.position);
        this._tabCollapsedPos.set(this._tabExpandedPos);

        const parentUi: UITransform = this.node.parent ? this.node.parent.getComponent(UITransform) : null;
        const selfUi: UITransform = this.getComponent(UITransform);
        const tabUi: UITransform = this._tabNode ? this._tabNode.getComponent(UITransform) : null;
        if (parentUi && selfUi) {
            this._collapsedX = parentUi.width * 0.5 + selfUi.width * 0.5;
            if (this._tabNode && tabUi) {
                this._tabExpandedPos.set(
                    this._expandedPos.x - selfUi.width * 0.5 - tabUi.width * 0.5,
                    this._expandedPos.y,
                    this._expandedPos.z
                );
                this._tabCollapsedPos.set(
                    this._tabExpandedPos.x + (this._collapsedX - this._expandedPos.x),
                    this._tabExpandedPos.y,
                    this._expandedPos.z
                );
            }
        }
        this.refreshCollapseVisual();
    }

    private refreshCollapseVisual(): void {
        if (!this._tabNode) {
            return;
        }
        if (this._arrowNode) {
            this._arrowNode.angle = this._collapsed ? -90 : 90;
        }
        const hint: Node = this._tabNode.getChildByName('Hint');
        const label: Label = hint ? hint.getComponent(Label) : null;
        if (label) {
            label.string = this._collapsed ? '展开' : '收起';
        }
        drawCommandHandle(this._tabNode);
    }

    private refreshTabStyle(): void {
        const panelUi = this.getComponent(UITransform);
        if (!panelUi) return;
        drawCommandPanel(this.node, panelUi.width, panelUi.height, this._selectedTab, this.toggles.length);
        const group = this.toggles[0]?.node.parent;
        if (group) group.setPosition(0, panelUi.height / 2 - 32, 0);
        const step = (panelUi.width - 18) / this.toggles.length;
        this.toggles.forEach((toggle, index) => {
            place(toggle.node, (index - (this.toggles.length - 1) / 2) * step, 0, step, 56);
            commandTab(toggle.node, index, index === this._selectedTab, step, SidebarIconCache.frame(index));
        });
    }

    onToggleCollapse(): void {
        if (this._animating) {
            return;
        }
        AudioManager.instance.playClick();
        this._animating = true;
        this._collapsed = !this._collapsed;
        this.refreshCollapseVisual();
        const target: Vec3 = new Vec3(this._collapsed ? this._collapsedX : this._expandedPos.x, this._expandedPos.y, this._expandedPos.z);
        tween(this.node)
            .to(0.34, { position: target }, { easing: 'cubicInOut' })
            .call(() => {
                this._animating = false;
            })
            .start();

        if (this._tabNode) {
            const tabTarget: Vec3 = new Vec3(
                this._collapsed ? this._tabCollapsedPos.x : this._tabExpandedPos.x,
                this._tabExpandedPos.y,
                this._tabExpandedPos.z
            );
            tween(this._tabNode)
                .to(0.34, { position: tabTarget }, { easing: 'cubicInOut' })
                .start();
        }
    }

    onClockToggle(toggle: Toggle): void {
        const index = this.toggles.indexOf(toggle);
        if (!toggle || !toggle.isChecked || index < 0) {
            return;
        }
        AudioManager.instance.playClick();
        this.selectTab(index);
    }

    private selectTab(index: number): void {
        if (!this.toggles[index]) return;
        this._selectedTab = index;
        // 动态添加地块页时 ToggleContainer 仍可能在初始化，先选中目标再取消其他页。
        this.toggles[index].setIsCheckedWithoutNotify(true);
        this.toggles.forEach((toggle, i) => {
            if (i !== index) toggle.setIsCheckedWithoutNotify(false);
        });
        this.layoutPanel();
        if (index === 1) {
            this.initCitys();
        } else if (index === 2) {
            const marks = MapMarkCommand.getInstance();
            if (!marks.loaded && !marks.loading) marks.requestList();
            this.initTags();
        }
    }
}
