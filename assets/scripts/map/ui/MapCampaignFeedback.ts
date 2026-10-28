import { _decorator, BlockInputEvents, Button, Color, Component, Graphics, Label, Node, UITransform } from 'cc';
import CampaignFeedback, { CampaignCue, CaptureActivity } from '../../world/CampaignFeedback';
import WorldCommand from '../../world/WorldCommand';
import LoginCommand from '../../login/LoginCommand';
import BattleCommand from '../../battle/BattleCommand';
import DateUtil from '../../utils/DateUtil';
import { EventMgr } from '../../utils/EventMgr';
import { LogicEvent as E } from '../../common/LogicEvent';
import { NetEvent } from '../../network/socket/NetInterface';
import { caption, inkSurface, ManagementColors as C, place } from './ManagementStyle';
const { ccclass } = _decorator;
const TONES = { gold: C.gold, green: new Color(141, 199, 172), red: new Color(227, 138, 120) };

/** 不依赖地块选中、资源显隐或地图缩放的战况提示。只在有新战况/占领任务时出现。 */
@ccclass('MapCampaignFeedback')
export default class MapCampaignFeedback extends Component {
    readonly state = new CampaignFeedback();
    private rows: Node[] = [];
    private keys: string[] = [];
    private visible: Array<CampaignCue | CaptureActivity> = [];
    private openReport: () => void;
    private elapsed = 0;
    initialize(openReport: () => void): void { this.openReport = openReport; }
    onLoad(): void {
        this.node.addComponent(UITransform);
        EventMgr.on(E.battleStarted, this.battleStart, this);
        EventMgr.on(E.battleFinished, this.battleResult, this);
        EventMgr.on(E.updateWorldEntities, this.sync, this);
        EventMgr.on(E.updateMarches, this.sync, this);
        EventMgr.on(E.updateMyRole, this.sync, this);
        EventMgr.on(E.enterLogin, this.clear, this);
        EventMgr.on(NetEvent.ServerDisconnected, this.clear, this);
        this.sync();
    }
    onDestroy(): void { EventMgr.targetOff(this); }
    private clear(): void { this.state.clear(); this.render(); }
    private sync(): void {
        const world = WorldCommand.getInstance();
        this.state.sync(Array.from(world.entities.values()), world.marches.values(),
            LoginCommand.getInstance().proxy.getRoleData()?.userId, DateUtil.getServerTime() / 1000);
        this.render();
    }
    private battleStart(data: any): void { this.state.battleStart(data, DateUtil.getServerTime() / 1000); this.render(); }
    private battleResult(data: any): void {
        this.state.battleResult(data, BattleCommand.getInstance().battles.get(String(data.battleId))?.start,
            DateUtil.getServerTime() / 1000);
        this.render();
    }
    update(dt: number): void {
        this.elapsed += dt; if (this.elapsed < .1) return;
        this.elapsed = 0; this.render();
    }
    private action(parent: Node, name: string, callback: () => void): Node {
        const node = new Node(name); node.layer = parent.layer; parent.addChild(node);
        node.addComponent(UITransform); node.addComponent(Button);
        node.on(Button.EventType.CLICK, callback, this); return node;
    }
    private row(index: number): Node {
        if (this.rows[index]) return this.rows[index];
        const node = new Node(`Activity_${index}`); node.layer = this.node.layer; this.node.addChild(node);
        node.addComponent(UITransform); node.addComponent(BlockInputEvents);
        this.action(node, 'Coordinate', () => {
            const pos = this.visible[index]?.pos;
            if (pos) EventMgr.emit(E.scrollToMap, pos.x, pos.y);
        });
        this.action(node, 'Report', () => this.openReport?.());
        this.action(node, 'Dismiss', () => {
            const cue = this.visible[index] as CampaignCue;
            if (cue?.id) { this.state.dismiss(cue.id); this.render(); }
        });
        const bar = new Node('Progress'); bar.layer = node.layer; node.addChild(bar);
        bar.addComponent(UITransform); bar.addComponent(Graphics);
        this.rows.push(node); return node;
    }
    private render(): void {
        const parent = this.node.parent?.getComponent(UITransform);
        if (!parent) return;
        const now = DateUtil.getServerTime() / 1000;
        this.visible = [...this.state.notices(now), ...Array.from(this.state.captures.values())];
        const width = Math.max(240, Math.min(414, parent.width - 32));
        // 底部中央留白处向上排列，避开上方地块菜单、两侧任务/队列及底部导航。
        place(this.node, 0, -parent.height / 2 + 160, width, 1);
        this.visible.forEach((data, index) => {
            const row = this.row(index), capture = 'endTime' in data ? data : null;
            const cue = !capture ? data as CampaignCue : null;
            const left = capture ? Math.max(0, Math.ceil(capture.endTime - now)) : 0;
            const title = capture ? `部队${capture.troopIdx} · ${left ? '占领中' : '占领确认中'}` : cue.title;
            const detail = capture ? left ? `还需 ${DateUtil.converSecondStr(left * 1000)}` : '等待服务器确认归属' : cue.detail;
            const color = TONES[cue?.tone || 'gold'];
            const key = `${width}:${title}:${detail}:${JSON.stringify(data.pos)}:${cue?.reportId || ''}`;
            row.active = true; place(row, 0, index * 66, width, 60);
            if (this.keys[index] !== key) {
                this.keys[index] = key;
                inkSurface(row, 'Surface', width, 60, new Color(29, 34, 29, 232), new Color(color.r, color.g, color.b, 115));
                caption(row, 'Title', title, -54, 13, width - 136, 16, color);
                caption(row, 'Detail', detail, -13, -12, width - 56, 12, C.text);
                const coord = row.getChildByName('Coordinate');
                coord.active = !!data.pos;
                place(coord, width / 2 - 78, 13, 102, 28);
                caption(coord, 'Text', data.pos ? `(${data.pos.x}, ${data.pos.y})` : '', 0, 0, 102, 13, C.gold, Label.HorizontalAlign.RIGHT);
                const close = row.getChildByName('Dismiss'); close.active = !!cue;
                place(close, width / 2 - 16, 14, 28, 28);
                caption(close, 'Text', '×', 0, 0, 28, 18, C.muted, Label.HorizontalAlign.CENTER);
                const report = row.getChildByName('Report'); report.active = !!cue?.reportId;
                place(report, width / 2 - 56, -12, 78, 28);
                caption(report, 'Text', '查看战报 ›', 0, 0, 78, 12, C.gold, Label.HorizontalAlign.CENTER);
                if (report.active) caption(row, 'Detail', '战报已生成', -55, -12, width - 140, 12, C.text);
            }
            const bar = row.getChildByName('Progress'); bar.active = !!capture;
            if (capture) {
                const ratio = Math.min(1, Math.max(0, (now - capture.startTime) / Math.max(.001, capture.endTime - capture.startTime)));
                const g = bar.getComponent(Graphics); g.clear();
                g.fillColor = new Color(77, 74, 52, 190); g.rect(-width / 2 + 10, -27, width - 20, 2); g.fill();
                g.fillColor = C.gold; g.rect(-width / 2 + 10, -27, (width - 20) * ratio, 2); g.fill();
            }
        });
        this.rows.forEach((row, i) => { row.active = i < this.visible.length; });
    }
}
