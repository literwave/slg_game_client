import { _decorator, Component, EditBox, Toggle, Button, Label, Node, UITransform, Graphics, Color, resources, JsonAsset, EventTouch, Vec3, BlockInputEvents, isValid, Sprite, SpriteFrame, UIOpacity, tween, Tween } from 'cc';
import { ServerConfig } from '../config/ServerConfig';
import LoginCommand from './LoginCommand';
import { EventMgr } from '../utils/EventMgr';
import { createName } from '../libs/NameDict';
import { AudioManager } from '../common/AudioManager';
import { LogicEvent } from '../common/LogicEvent';
import type { CampaignGate, CampaignMap, CampaignRegion } from '../map/WorldCampaign';
import { caption, inkSurface, panelButton, place } from '../map/ui/ManagementStyle';

const { ccclass, property } = _decorator;
export interface BirthZone { key: number; name: string; route?: string; }

export interface BirthZoneProfile {
    epithet: string;
    seal: string;
    desc: string;
}

export interface BirthLayoutMetrics {
    landscape: boolean;
    artW: number;
    artH: number;
    mapW: number;
    mapH: number;
    mapOffsetX: number;
    mapOffsetY: number;
    barX: number;
    barY: number;
    barW: number;
    barH: number;
    headerX: number;
    headerY: number;
    headerW: number;
    headerH: number;
}

// 与 birth-map-world-v3.png (1536×864) 中 10 州大陆子区域严格一致
const WORLD_ART_W = 1536;
const WORLD_ART_H = 864;
const MAP_U0 = 0.14;
const MAP_U1 = 0.86;
const MAP_V0 = 0.07;
const MAP_V1 = 0.87;

// 古典楷体/宋体字族，与玉雕古铜三国沙盘气质一致
const CLASSIC_FONT = 'STKaiti, KaiTi, BiauKai, FangSong, SimSun, Songti SC, serif';

// 从 birth-map-world-v3.png 实测提取的六大起兵州精确玉雕轮廓（归一化至整图 [0..1]×[0..1]），确保选中金光与描边 100% 严丝合缝贴合玉雕岸线与铜槽，零溢出、零折痕。
export const BIRTH_ART_SHAPES: Record<string, [number, number][]> = {
    '青州': [[0.678,0.451],[0.703,0.456],[0.735,0.455],[0.768,0.461],[0.799,0.456],[0.789,0.469],[0.780,0.486],[0.778,0.506],[0.785,0.528],[0.796,0.556],[0.803,0.584],[0.802,0.606],[0.793,0.625],[0.774,0.646],[0.754,0.668],[0.739,0.696],[0.727,0.728],[0.715,0.755],[0.701,0.772],[0.684,0.756],[0.666,0.741],[0.655,0.723],[0.658,0.702],[0.656,0.674],[0.654,0.645],[0.644,0.629],[0.628,0.615],[0.619,0.597],[0.618,0.574],[0.621,0.552],[0.633,0.533],[0.656,0.515],[0.665,0.495],[0.672,0.471]],
    '徐州': [[0.419,0.651],[0.440,0.653],[0.460,0.666],[0.480,0.681],[0.500,0.691],[0.520,0.700],[0.532,0.711],[0.544,0.733],[0.560,0.739],[0.580,0.735],[0.600,0.728],[0.625,0.727],[0.645,0.721],[0.653,0.736],[0.664,0.750],[0.678,0.763],[0.690,0.775],[0.694,0.782],[0.665,0.787],[0.625,0.792],[0.585,0.793],[0.550,0.785],[0.520,0.775],[0.498,0.780],[0.475,0.797],[0.450,0.821],[0.425,0.839],[0.405,0.841],[0.385,0.827],[0.365,0.805],[0.350,0.787],[0.357,0.770],[0.358,0.749],[0.368,0.732],[0.386,0.715],[0.399,0.693],[0.411,0.670]],
    '荆州': [[0.175,0.493],[0.199,0.485],[0.224,0.473],[0.250,0.477],[0.279,0.486],[0.296,0.495],[0.303,0.509],[0.299,0.525],[0.295,0.543],[0.302,0.559],[0.324,0.580],[0.351,0.606],[0.381,0.626],[0.409,0.643],[0.405,0.658],[0.394,0.681],[0.379,0.705],[0.360,0.726],[0.351,0.747],[0.350,0.767],[0.342,0.782],[0.314,0.769],[0.284,0.753],[0.264,0.737],[0.251,0.715],[0.243,0.684],[0.234,0.642],[0.222,0.596],[0.208,0.550],[0.191,0.519]],
    '益州': [[0.141,0.440],[0.141,0.420],[0.149,0.398],[0.165,0.378],[0.186,0.360],[0.206,0.342],[0.218,0.318],[0.225,0.290],[0.236,0.264],[0.254,0.244],[0.276,0.232],[0.300,0.220],[0.320,0.206],[0.334,0.196],[0.339,0.212],[0.354,0.230],[0.378,0.252],[0.403,0.275],[0.428,0.298],[0.444,0.311],[0.423,0.323],[0.402,0.328],[0.378,0.336],[0.352,0.344],[0.320,0.350],[0.296,0.368],[0.270,0.390],[0.249,0.416],[0.229,0.446],[0.207,0.465],[0.184,0.475],[0.158,0.468],[0.145,0.455]],
    '凉州': [[0.342,0.182],[0.353,0.163],[0.371,0.145],[0.392,0.128],[0.415,0.106],[0.435,0.084],[0.456,0.068],[0.474,0.064],[0.494,0.068],[0.514,0.080],[0.532,0.100],[0.548,0.124],[0.566,0.146],[0.588,0.160],[0.610,0.166],[0.618,0.172],[0.601,0.191],[0.579,0.209],[0.572,0.224],[0.571,0.246],[0.566,0.266],[0.555,0.278],[0.528,0.277],[0.496,0.283],[0.470,0.287],[0.461,0.294],[0.453,0.298],[0.435,0.288],[0.411,0.271],[0.383,0.248],[0.359,0.226],[0.344,0.206]],
    '幽州': [[0.632,0.161],[0.648,0.164],[0.665,0.175],[0.680,0.194],[0.696,0.214],[0.715,0.228],[0.738,0.239],[0.764,0.251],[0.788,0.270],[0.807,0.296],[0.820,0.324],[0.828,0.352],[0.830,0.380],[0.826,0.404],[0.817,0.426],[0.804,0.431],[0.785,0.438],[0.764,0.443],[0.742,0.439],[0.720,0.439],[0.706,0.438],[0.692,0.434],[0.679,0.429],[0.671,0.420],[0.669,0.406],[0.676,0.389],[0.683,0.370],[0.688,0.348],[0.696,0.327],[0.699,0.312],[0.694,0.296],[0.681,0.281],[0.662,0.265],[0.645,0.242],[0.632,0.221],[0.625,0.211],[0.625,0.201],[0.631,0.183]],
};

// 六大起兵州在底图中的视觉重心（归一化 [0..1]×[0..1]），确保州名、红菱饰点、选中锦带与进军起点均端正居于各州亮玉腹地。
const BIRTH_ART_ANCHORS: Record<string, [number, number]> = {
    '青州': [0.728, 0.596],
    '徐州': [0.452, 0.742],
    '荆州': [0.292, 0.630],
    '益州': [0.278, 0.326],
    '凉州': [0.478, 0.186],
    '幽州': [0.752, 0.348],
};

/** 与绘制共用真实州域多边形，不用矩形按钮代替地图选区。 */
export function containsBirthPoint(points: number[][], x: number, y: number): boolean {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i], b = points[j];
        if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
}

const DEFAULT_PROFILE: BirthZoneProfile = {
    epithet: '点选外围六州 · 择定起兵基业',
    seal: '起',
    desc: '轻点玉雕沙盘外围六州，预览破关逐鹿洛阳之路线。',
};

const ZONE_PROFILES: Record<string, BirthZoneProfile> = {
    '青州': { epithet: '东临沧海 · 齐鲁沃野', seal: '青', desc: '背海面陆而粮秣丰饶，出临淄、入河东，步步蚕食中原。' },
    '徐州': { epithet: '平畴水网 · 南北通衢', seal: '徐', desc: '四通八达，北望河东虎牢，东西两翼进退自如。' },
    '荆州': { epithet: '江汉要冲 · 兵家必争', seal: '荆', desc: '山川相依，水陆并进，出江陵关可直叩关中。' },
    '益州': { epithet: '天府沃野 · 剑阁天险', seal: '益', desc: '群山环抱而沃土深藏，稳健发育，蓄势出剑门。' },
    '凉州': { epithet: '西陲关塞 · 铁骑纵横', seal: '凉', desc: '关塞绵延，铁骑精锐，破玉门关直下河内。' },
    '幽州': { epithet: '北疆重镇 · 燕赵慷慨', seal: '幽', desc: '北地旷野，控雁门雄关以俯视河内，挥师南下。' },
};

const ZONE_PROLOGUE_LINES: Record<string, string> = {
    '青州': '主公择青州而起——齐鲁沃野，东临沧海；先据膏腴，再出临淄以图河东！',
    '徐州': '主公择徐州而起——平畴水网，南北通衢；四方策应，出广陵可直逼虎牢！',
    '荆州': '主公择荆州而起——江汉要冲，水陆交汇；北控南阳，出江陵可直叩关中！',
    '益州': '主公择益州而起——天府沃野，剑阁天险；深藏霸基，蓄锐出剑门以定中原！',
    '凉州': '主公择凉州而起——西陲雄塞，铁骑冠世；练军养锐，破玉门可威震河内！',
    '幽州': '主公择幽州而起——北疆重镇，燕赵多士；扼守雁门，挥师南下以问中原！',
};

/** 全屏沙盘舆图布局：无方框割裂，全幅山河铺满视口，顶部轻标题与底部浮条自然融入墨云边缘。 */
export function computeBirthLayout(w: number, h: number): BirthLayoutMetrics {
    const safeW = Math.max(320, w);
    const safeH = Math.max(420, h);
    const landscape = safeW >= safeH * 1.25;

    const spanU = MAP_U1 - MAP_U0;
    const spanV = MAP_V1 - MAP_V0;
    const centerOffsetV = 0.5 - (MAP_V0 + MAP_V1) * 0.5;

    let scale: number;
    if (landscape) {
        const scaleByH = safeH / WORLD_ART_H;
        const scaleByW = safeW / (WORLD_ART_W * (spanU + 0.08));
        scale = Math.min(scaleByH, scaleByW);
    } else {
        const scaleByW = safeW / (WORLD_ART_W * (spanU + 0.04));
        const scaleByH = (safeH * 0.66) / (WORLD_ART_H * spanV);
        scale = Math.min(scaleByW, scaleByH);
    }

    const artW = Math.round(WORLD_ART_W * scale);
    const artH = Math.round(WORLD_ART_H * scale);
    const mapW = Math.round(artW * spanU);
    const mapH = Math.round(artH * spanV);
    const mapOffsetX = 0;
    const mapOffsetY = Math.round(artH * centerOffsetV);

    const marginX = landscape ? Math.max(20, Math.round(safeW * 0.024)) : Math.max(14, Math.round(safeW * 0.03));
    const marginY = landscape ? Math.max(14, Math.round(safeH * 0.02)) : Math.max(16, Math.round(safeH * 0.022));

    const headerW = landscape ? Math.min(280, Math.round(safeW * 0.25)) : safeW - marginX * 2;
    const headerH = landscape ? 54 : 50;
    const headerX = landscape ? -safeW / 2 + marginX + headerW / 2 : 0;
    const headerY = safeH / 2 - marginY - headerH / 2;

    const barW = landscape ? Math.min(760, Math.max(540, Math.round(safeW * 0.62))) : safeW - marginX * 2;
    const barH = landscape ? 72 : 112;
    const barX = 0;
    const barY = -safeH / 2 + marginY + barH / 2;

    return {
        landscape,
        artW, artH, mapW, mapH, mapOffsetX, mapOffsetY,
        barX, barY: Math.round(barY), barW: Math.round(barW), barH,
        headerX: Math.round(headerX), headerY: Math.round(headerY), headerW: Math.round(headerW), headerH,
    };
}

interface ConquestPath {
    origin: { x: number; y: number };
    gate1?: CampaignGate;
    midRegion?: CampaignRegion;
    gate2?: CampaignGate;
    capital?: { x: number; y: number; name: string };
    summary: string;
}

/** 依据真实 campaign-map 拓扑计算出生州 → 关隘 → 资源州 → 洛阳的进军路线。 */
export function resolveConquestPath(map: CampaignMap | null, regionName: string): ConquestPath | null {
    if (!map?.regions?.length || !regionName) return null;
    const originRegion = map.regions.find(r => r.name === regionName);
    if (!originRegion) return null;
    const originCity = map.cities?.find(c => c.region === originRegion.id);
    const origin = originCity ? { x: originCity.x, y: originCity.y } : { x: originRegion.x, y: originRegion.y };
    const gates = map.gates || [];
    const tierById = new Map<number, CampaignRegion>(map.regions.map(r => [r.id, r]));

    const gate1 = gates.find(g => g.regions?.includes(originRegion.id)
        && g.regions.some(id => id !== originRegion.id && tierById.get(id)?.tier === 1));
    const midId = gate1?.regions.find(id => id !== originRegion.id);
    const midRegion = midId !== undefined ? tierById.get(midId) : undefined;

    const imperialRegion = map.regions.find(r => r.tier === 2);
    const gate2 = midRegion && imperialRegion
        ? gates.find(g => g.regions?.includes(midRegion.id) && g.regions?.includes(imperialRegion.id))
        : undefined;
    const imperialCity = imperialRegion
        ? (map.cities?.find(c => c.region === imperialRegion.id) || { x: imperialRegion.x, y: imperialRegion.y, name: imperialRegion.name })
        : undefined;

    const parts: string[] = [];
    if (gate1 && midRegion) {
        parts.push(`经 ${gate1.name} → ${midRegion.name}`);
        if (gate2 && imperialCity) parts.push(`${gate2.name} → ${imperialCity.name}`);
        else if (imperialCity) parts.push(imperialCity.name);
    } else if (imperialCity) {
        parts.push(`整军经武 → 逐鹿${imperialCity.name}`);
    }
    return {
        origin, gate1, midRegion, gate2,
        capital: imperialCity ? { x: imperialCity.x, y: imperialCity.y, name: imperialCity.name } : undefined,
        summary: parts.join(' → '),
    };
}

@ccclass('CreateLogic')
export default class CreateLogic extends Component {
    @property(EditBox) editName: EditBox = null;
    @property(Toggle) manToggle: Toggle = null;
    @property(Button) createButton: Button = null;
    @property(Label) createButtonLabel: Label = null;
    @property(Label) statusLabel: Label = null;
    private _pending = false;
    private zones: BirthZone[] = [];
    private selected: BirthZone | null = null;
    private sheet: Node | null = null;
    private mapNode: Node;
    private overlayNode: Node;
    private worldArtNode: Node;
    private map: CampaignMap | null = null;
    private mapLoading = false;
    private message = '点选外围六州，择定起兵之地';
    private artW = 1280;
    private artH = 720;
    private mapW = 920;
    private mapH = 576;
    private mapOffsetX = 0;
    private mapOffsetY = 20;
    private zoneName: Label;
    private zoneOpacity: UIOpacity;
    private sealText: Label;
    private description: Label;
    private routeText: Label;
    private retry: Node;
    private atmosphere: Node;
    private bottomBar: Node;
    private terrainReady = false;
    private confirmBg: Graphics | null = null;
    private confirmSize = { w: 204, h: 46 };
    private launchChromeOpacities: UIOpacity[] = [];

    public configureZones(offers: BirthZone[]): void {
        this.zones = offers.filter(zone => Number.isInteger(zone.key) && zone.key > 0 && zone.name);
        this.selected = this.zones.find(zone => zone.key === this.selected?.key) || null;
        this.ensureSheet();
        this.setStatus(this.zones.length ? '点选外围六州，择定起兵之地' : '暂未取得可选州，请稍后重试');
        this.loadMap();
        this.fitSheet();
    }

    private make(name: string, parent = this.sheet): Node {
        const node = new Node(name); node.layer = this.node.layer;
        parent.addChild(node); node.addComponent(UITransform); return node;
    }

    private styleClassic(label: Label, r = 12, g = 14, b = 12, a = 230, width = 2): void {
        label.useSystemFont = true;
        label.fontFamily = CLASSIC_FONT;
        label.outlineColor = new Color(r, g, b, a);
        label.outlineWidth = width;
    }

    private ensureSheet(): void {
        if (this.sheet) return;
        // 旧预制体保留引用，但姓名和性别表单不再参与入场流程。
        if (this.editName?.node?.parent) this.editName.node.parent.active = false;
        this.sheet = this.make('BirthRegionMap', this.node);
        this.sheet.addComponent(BlockInputEvents);

        // 1. 全屏沙盘容器（底图 + 顶层矢量高亮 + 州名铭牌同级随镜头柔和推近）
        this.mapNode = this.make('Regions', this.sheet);
        this.worldArtNode = this.make('WorldArt', this.mapNode);
        const worldSp = this.worldArtNode.addComponent(Sprite);
        worldSp.sizeMode = Sprite.SizeMode.CUSTOM;
        worldSp.trim = false;

        // Overlay 位于 WorldArt 之后，确保选区金光与行军箭头渲染在沙盘原画之上
        this.overlayNode = this.make('Overlay', this.mapNode);
        this.overlayNode.addComponent(Graphics);
        this.mapNode.on(Node.EventType.TOUCH_END, this.onChoosePoint, this);

        // 2. 边缘轻墨云雾与四角回纹
        this.atmosphere = this.make('Atmosphere', this.sheet);
        this.atmosphere.addComponent(Graphics);

        // 3. 底部轻盈墨金浮条
        this.bottomBar = this.make('BottomBar', this.sheet);
        this.bottomBar.addComponent(Graphics);

        const seal = this.make('Seal', this.bottomBar);
        seal.addComponent(Graphics);
        this.sealText = caption(seal, 'Text', '起', 0, 0, 38, 22, new Color(248, 232, 192), Label.HorizontalAlign.CENTER);
        this.sealText.isBold = true;
        this.styleClassic(this.sealText, 64, 18, 14, 230, 1);

        this.zoneName = caption(this.bottomBar, 'Zone', '何处起兵', 0, 0, 150, 27, new Color(248, 228, 178), Label.HorizontalAlign.LEFT);
        this.zoneName.isBold = true;
        this.styleClassic(this.zoneName, 12, 14, 14, 245, 2);
        this.zoneOpacity = this.zoneName.node.addComponent(UIOpacity);

        this.routeText = caption(this.bottomBar, 'RouteText', DEFAULT_PROFILE.epithet, 0, 0, 360, 14, new Color(224, 194, 132), Label.HorizontalAlign.LEFT);
        this.routeText.overflow = Label.Overflow.SHRINK;
        this.styleClassic(this.routeText, 12, 14, 14, 190, 1);

        this.description = caption(this.bottomBar, 'Description', DEFAULT_PROFILE.desc, 0, 0, 420, 13, new Color(222, 214, 194), Label.HorizontalAlign.LEFT);
        this.description.overflow = Label.Overflow.SHRINK;
        this.styleClassic(this.description, 12, 14, 14, 175, 1);

        this.statusLabel = caption(this.bottomBar, 'Status', this.message, 0, 0, 240, 11, new Color(228, 190, 120), Label.HorizontalAlign.CENTER);
        this.statusLabel.overflow = Label.Overflow.SHRINK;
        this.styleClassic(this.statusLabel, 12, 14, 14, 180, 1);

        const confirm = this.make('ConfirmBirth', this.bottomBar);
        this.confirmBg = confirm.addComponent(Graphics);
        this.createButton = confirm.addComponent(Button);
        this.createButton.transition = Button.Transition.SCALE;
        this.createButton.zoomScale = 0.97;
        this.createButton.duration = 0.09;
        confirm.addComponent(UIOpacity);
        confirm.on(Button.EventType.CLICK, this.onClickCreate, this);
        this.createButtonLabel = caption(confirm, 'ConfirmLabel', '在此起兵', 0, 0, 190, 20, new Color(252, 240, 204), Label.HorizontalAlign.CENTER);
        this.createButtonLabel.isBold = true;
        this.styleClassic(this.createButtonLabel, 48, 16, 12, 240, 2);

        this.retry = this.make('Retry', this.bottomBar);
        this.retry.addComponent(Button);
        panelButton(this.retry, '重试', 0, 0, 120, 40, true);
        this.retry.on(Button.EventType.CLICK, () => {
            if (this._pending) return;
            if (!this.map) this.loadMap();
            LoginCommand.getInstance().requestCreationOptions();
        }, this);

        resources.load('ui/onboarding/birth-map-world-v3/spriteFrame', SpriteFrame, (error, frame) => {
            if (!isValid(this, true)) return;
            if (error || !(frame instanceof SpriteFrame)) { return; }
            worldSp.spriteFrame = frame;
            this.terrainReady = true;
            this.drawMap();
        });
    }

    private loadMap(): void {
        if (this.map || this.mapLoading) return;
        this.mapLoading = true;
        this.setStatus('正在铺展山河舆图…');
        resources.load('world/campaign-map', JsonAsset, (error, asset) => {
            if (!isValid(this, true)) return;
            this.mapLoading = false;
            const map = asset?.json as CampaignMap;
            if (error || !map?.landShapes?.length || !map.regions?.length || !(map.width > 0 && map.height > 0)) {
                this.setStatus('州域地图暂未就绪，请重试');
                this.fitSheet(); return;
            }
            this.map = map;
            this.setStatus(this.zones.length ? '点选外围六州，择定起兵之地' : '暂未取得可选州，请重试');
            this.fitSheet();
        });
    }

    private drawCornerBrackets(g: Graphics, w: number, h: number, len: number, color: Color, lineWidth: number): void {
        const hw = w / 2, hh = h / 2;
        g.strokeColor = color;
        g.lineWidth = lineWidth;
        const corners: [number, number, number, number][] = [
            [-hw, hh, 1, -1], [hw, hh, -1, -1], [-hw, -hh, 1, 1], [hw, -hh, -1, 1],
        ];
        for (const [cx, cy, sx, sy] of corners) {
            g.moveTo(cx, cy + sy * len);
            g.lineTo(cx, cy);
            g.lineTo(cx + sx * len, cy);
        }
        g.stroke();
    }

    private drawAtmosphere(w: number, h: number): void {
        const g = this.atmosphere.getComponent(Graphics);
        g.clear();
        const bands = 7;
        const topH = Math.min(84, h * 0.13);
        const botH = Math.min(108, h * 0.17);
        for (let i = 0; i < bands; i++) {
            const t = (bands - i) / bands;
            g.fillColor = new Color(11, 18, 20, Math.round(130 * t * t));
            g.rect(-w / 2, h / 2 - topH * ((i + 1) / bands), w, topH / bands + 1);
            g.fill();
            g.fillColor = new Color(11, 18, 20, Math.round(150 * t * t));
            g.rect(-w / 2, -h / 2 + botH * (i / bands), w, botH / bands + 1);
            g.fill();
        }
        const m = 10;
        this.drawCornerBrackets(g, w - m * 2, h - m * 2, 22, new Color(216, 186, 124, 120), 1.5);
    }

    private drawBottomBar(m: BirthLayoutMetrics): void {
        const w = m.barW, h = m.barH;
        place(this.bottomBar, m.barX, m.barY, w, h);
        const g = this.bottomBar.getComponent(Graphics);
        g.clear();
        g.fillColor = new Color(8, 12, 14, 130);
        g.roundRect(-w / 2 + 4, -h / 2 - 5, w, h, 6);
        g.fill();
        g.fillColor = new Color(15, 22, 24, 218);
        g.roundRect(-w / 2, -h / 2, w, h, 6);
        g.fill();
        g.strokeColor = new Color(210, 180, 118, 195);
        g.lineWidth = 1.4;
        g.roundRect(-w / 2 + 0.8, -h / 2 + 0.8, w - 1.6, h - 1.6, 6);
        g.stroke();
        this.drawCornerBrackets(g, w - 4, h - 4, 15, new Color(242, 212, 146, 225), 1.8);

        const sealNode = this.bottomBar.getChildByName('Seal');
        const sealSize = m.landscape ? 40 : 34;
        if (m.landscape) {
            const padX = 16;
            const btnW = Math.min(206, Math.max(160, Math.round(w * 0.27)));
            const btnH = 44;
            const btnX = w / 2 - padX - btnW / 2;
            const infoLeft = -w / 2 + padX + sealSize + 14;
            const infoRight = btnX - btnW / 2 - 14;
            const infoW = Math.max(160, infoRight - infoLeft);
            const infoCenterX = (infoLeft + infoRight) / 2;

            if (sealNode) {
                place(sealNode, -w / 2 + padX + sealSize / 2, 0, sealSize, sealSize);
                this.paintSeal(sealNode, sealSize);
                place(this.sealText.node, 0, 0, sealSize - 4, sealSize - 4);
                this.sealText.fontSize = 21;
            }
            const nameW = Math.min(116, infoW * 0.30);
            place(this.zoneName.node, infoLeft + nameW / 2, 13, nameW, 30);
            this.zoneName.fontSize = 26;
            const routeLeft = infoLeft + nameW + 6;
            const routeW = Math.max(80, infoRight - routeLeft);
            place(this.routeText.node, routeLeft + routeW / 2, 11, routeW, 20);
            this.routeText.fontSize = 14;
            place(this.description.node, infoCenterX, -13, infoW, 20);
            this.description.fontSize = 13;

            this.confirmSize = { w: btnW, h: btnH };
            place(this.createButton.node, btnX, 3, btnW, btnH);
            place(this.createButtonLabel.node, 0, 0, btnW - 18, btnH - 4);
            this.createButtonLabel.fontSize = 19;
            place(this.retry, btnX, 3, Math.min(126, btnW), 38);
            place(this.statusLabel.node, btnX, -25, btnW + 8, 16);
            this.statusLabel.fontSize = 11;
        } else {
            const padX = 14;
            const innerW = w - padX * 2;
            const topY = h / 2 - 26;
            if (sealNode) {
                place(sealNode, -w / 2 + padX + sealSize / 2, topY, sealSize, sealSize);
                this.paintSeal(sealNode, sealSize);
                place(this.sealText.node, 0, 0, sealSize - 4, sealSize - 4);
                this.sealText.fontSize = 19;
            }
            const textLeft = -w / 2 + padX + sealSize + 10;
            const textW = Math.max(120, w / 2 - padX - textLeft);
            place(this.zoneName.node, textLeft + 50, topY + 6, 100, 26);
            this.zoneName.fontSize = 22;
            const rLeft = textLeft + 100;
            const rW = Math.max(60, w / 2 - padX - rLeft);
            place(this.routeText.node, rLeft + rW / 2, topY + 5, rW, 18);
            this.routeText.fontSize = 13;
            place(this.description.node, textLeft + textW / 2, topY - 13, textW, 18);
            this.description.fontSize = 12;

            const btnH = 40;
            const btnY = -h / 2 + 10 + btnH / 2;
            place(this.statusLabel.node, 0, btnY + btnH / 2 + 9, innerW, 16);
            this.statusLabel.fontSize = 11;
            this.confirmSize = { w: innerW, h: btnH };
            place(this.createButton.node, 0, btnY, innerW, btnH);
            place(this.createButtonLabel.node, 0, 0, innerW - 20, btnH - 4);
            this.createButtonLabel.fontSize = 18;
            place(this.retry, 0, btnY, Math.min(140, innerW), 38);
        }
    }

    private paintSeal(sealNode: Node, sealSize: number): void {
        const sg = sealNode.getComponent(Graphics);
        sg.clear();
        sg.fillColor = new Color(156, 46, 34, 255);
        sg.roundRect(-sealSize / 2, -sealSize / 2, sealSize, sealSize, 4);
        sg.fill();
        sg.strokeColor = new Color(244, 212, 144, 240);
        sg.lineWidth = 1.4;
        sg.roundRect(-sealSize / 2 + 3, -sealSize / 2 + 3, sealSize - 6, sealSize - 6, 3);
        sg.stroke();
    }

    private drawConfirmButton(enabled: boolean): void {
        if (!this.confirmBg) return;
        const { w, h } = this.confirmSize;
        const g = this.confirmBg;
        g.clear();
        if (enabled) {
            g.fillColor = new Color(152, 44, 34, 255);
            g.roundRect(-w / 2, -h / 2, w, h, 5);
            g.fill();
            g.fillColor = new Color(235, 148, 88, 58);
            g.roundRect(-w / 2 + 3, 2, w - 6, h / 2 - 4, 3);
            g.fill();
            g.fillColor = new Color(68, 18, 14, 125);
            g.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, 7, 2);
            g.fill();
            g.strokeColor = new Color(248, 220, 150, 255);
            g.lineWidth = 1.8;
            g.roundRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2, 5);
            g.stroke();
            g.strokeColor = new Color(255, 240, 196, 145);
            g.lineWidth = 1;
            g.roundRect(-w / 2 + 5, -h / 2 + 5, w - 10, h - 10, 3);
            g.stroke();
            g.fillColor = new Color(250, 224, 160, 240);
            for (const sx of [-1, 1]) {
                const dx = sx * (w / 2 - 18);
                g.moveTo(dx, 4); g.lineTo(dx + 4, 0); g.lineTo(dx, -4); g.lineTo(dx - 4, 0); g.close(); g.fill();
            }
        } else {
            g.fillColor = new Color(46, 52, 50, 215);
            g.roundRect(-w / 2, -h / 2, w, h, 5);
            g.fill();
            g.strokeColor = new Color(148, 134, 102, 135);
            g.lineWidth = 1.3;
            g.roundRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2, 5);
            g.stroke();
        }
    }

    private fitSheet(): void {
        if (!this.sheet || !this.bottomBar || !this.atmosphere) return;
        const bounds = this.node.getComponent(UITransform);
        if (!bounds) return;
        const w = bounds.width, h = bounds.height;
        const m = computeBirthLayout(w, h);
        place(this.sheet, 0, 0, w, h);
        inkSurface(this.sheet, 'Backdrop', w, h, new Color(11, 18, 20, 255), null);

        this.artW = m.artW;
        this.artH = m.artH;
        this.mapW = m.mapW;
        this.mapH = m.mapH;
        this.mapOffsetX = m.mapOffsetX;
        this.mapOffsetY = m.mapOffsetY;

        Tween.stopAllByTarget(this.mapNode);
        place(this.mapNode, 0, 0, Math.max(w, m.artW), Math.max(h, m.artH));
        place(this.worldArtNode, 0, 0, m.artW, m.artH);
        place(this.overlayNode, 0, 0, Math.max(w, m.artW), Math.max(h, m.artH));

        place(this.atmosphere, 0, 0, w, h);
        this.drawAtmosphere(w, h);

        this.drawBottomBar(m);
        this.drawMap();
        this.updateSelection();
    }

    private toArtPos(u: number, v: number): [number, number] {
        return [(u - 0.5) * this.artW, (0.5 - v) * this.artH];
    }

    private toMapPos(mx: number, my: number): [number, number] {
        return [
            this.mapOffsetX + (mx / this.map.width - 0.5) * this.mapW,
            this.mapOffsetY + (0.5 - my / this.map.height) * this.mapH,
        ];
    }

    private regionPos(region: CampaignRegion): [number, number] {
        const anchor = this.terrainReady ? BIRTH_ART_ANCHORS[region.name] : null;
        return anchor ? this.toArtPos(anchor[0], anchor[1]) : this.toMapPos(region.x, region.y);
    }

    private drawDashedArrow(g: Graphics, x0: number, y0: number, x1: number, y1: number, endPad = 8): void {
        const dx = x1 - x0, dy = y1 - y0;
        const rawLen = Math.hypot(dx, dy);
        if (rawLen < endPad + 12) return;
        const ux = dx / rawLen, uy = dy / rawLen;
        const tx = x1 - ux * endPad, ty = y1 - uy * endPad;
        const len = rawLen - endPad;
        g.strokeColor = new Color(255, 208, 102, 70);
        g.lineWidth = 5.5;
        g.moveTo(x0, y0); g.lineTo(tx - ux * 6, ty - uy * 6); g.stroke();
        g.strokeColor = new Color(255, 236, 174, 240);
        g.lineWidth = 2.2;
        const dash = 9, gap = 6;
        for (let d = 6; d < len - 10; d += dash + gap) {
            const end = Math.min(len - 10, d + dash);
            g.moveTo(x0 + ux * d, y0 + uy * d);
            g.lineTo(x0 + ux * end, y0 + uy * end);
        }
        g.stroke();
        const ax = tx - ux * 5, ay = ty - uy * 5;
        const px = -uy, py = ux;
        g.fillColor = new Color(255, 238, 180, 255);
        g.moveTo(tx, ty);
        g.lineTo(ax - ux * 6.5 + px * 5.2, ay - uy * 6.5 + py * 5.2);
        g.lineTo(ax - ux * 6.5 - px * 5.2, ay - uy * 6.5 - py * 5.2);
        g.close();
        g.fill();
    }

    /** 绘制选中州朱金渐隐丝带（轻柔典雅，不再用沉重实心方块）。 */
    private drawActiveRibbon(g: Graphics, w: number, h: number): void {
        const hw = w / 2, hh = h / 2, tip = 14;
        g.fillColor = new Color(138, 36, 26, 212);
        g.moveTo(-hw + tip, hh);
        g.lineTo(hw - tip, hh);
        g.lineTo(hw, 0);
        g.lineTo(hw - tip, -hh);
        g.lineTo(-hw + tip, -hh);
        g.lineTo(-hw, 0);
        g.close();
        g.fill();
        // 上下纤细鎏金线
        g.strokeColor = new Color(252, 224, 152, 235);
        g.lineWidth = 1.4;
        g.moveTo(-hw + tip + 2, hh - 1); g.lineTo(hw - tip - 2, hh - 1);
        g.moveTo(-hw + tip + 2, -hh + 1); g.lineTo(hw - tip - 2, -hh + 1);
        g.stroke();
        // 左右鎏金小菱饰
        g.fillColor = new Color(255, 234, 168, 240);
        for (const sx of [-1, 1]) {
            const dx = sx * (hw - tip + 2);
            g.moveTo(dx, 3.2); g.lineTo(dx + 3.2, 0); g.lineTo(dx, -3.2); g.lineTo(dx - 3.2, 0); g.close(); g.fill();
        }
    }

    private drawMap(): void {
        const g = this.overlayNode.getComponent(Graphics); g.clear();
        const oldLabels = this.mapNode.getChildByName('Names');
        if (oldLabels) { oldLabels.active = false; oldLabels.destroy(); oldLabels.removeFromParent(); }
        if (!this.map) return;

        const labels = this.make('Names', this.mapNode);
        const minSide = Math.min(this.mapW, this.mapH);
        const selectedRegion = this.map.regions.find(region => region.name === this.selected?.name);
        const selectedId = selectedRegion?.id;
        const conquest = selectedRegion ? resolveConquestPath(this.map, selectedRegion.name) : null;

        const traceArtPoly = (pts: [number, number][]) => {
            pts.forEach((p, i) => {
                const [x, y] = this.toArtPos(p[0], p[1]);
                if (i) g.lineTo(x, y); else g.moveTo(x, y);
            });
            g.close();
        };
        const traceFallbackPoly = (pts: number[][]) => {
            pts.forEach((p, i) => {
                const [x, y] = this.toMapPos(p[0], p[1]);
                if (i) g.lineTo(x, y); else g.moveTo(x, y);
            });
            g.close();
        };

        // 1. 若底图未就绪先绘制基础底色；底图就绪后不再对未选州叠加多边形暗罩（杜绝凹多边形三角化斜纹），只对选中州精准沿玉雕岸线点亮！
        if (!this.terrainReady) {
            for (const shape of this.map.landShapes || []) {
                if (!shape.points.length) continue;
                const region = this.map.regions.find(r => r.id === shape.region);
                const available = this.zones.some(zone => zone.name === region?.name);
                const isSelected = shape.region === selectedId;
                const isImperial = region?.tier === 2;
                g.fillColor = isSelected ? new Color(224, 180, 88, 225)
                    : available ? new Color(142, 162, 138, 225)
                    : isImperial ? new Color(188, 168, 118, 225)
                    : new Color(118, 114, 100, 210);
                traceFallbackPoly(shape.points); g.fill();
            }
        }

        // 2. 选中州：沿 birth-map-world-v3.png 实测玉雕精确轮廓绘制柔和鎏金铺光与三层流金边，100% 严丝合缝贴合玉雕板块！
        if (selectedRegion) {
            const artPoly = this.terrainReady ? BIRTH_ART_SHAPES[selectedRegion.name] : null;
            if (artPoly?.length) {
                g.fillColor = new Color(248, 200, 86, 52);
                traceArtPoly(artPoly); g.fill();
                g.strokeColor = new Color(248, 198, 78, 58); g.lineWidth = 5.2;
                traceArtPoly(artPoly); g.stroke();
                g.strokeColor = new Color(255, 218, 118, 185); g.lineWidth = 2.2;
                traceArtPoly(artPoly); g.stroke();
                g.strokeColor = new Color(255, 246, 206, 245); g.lineWidth = 1.2;
                traceArtPoly(artPoly); g.stroke();
            } else {
                for (const shape of this.map.landShapes || []) {
                    if (shape.region !== selectedId || !shape.points.length) continue;
                    g.strokeColor = new Color(255, 226, 146, 240); g.lineWidth = 2.4;
                    traceFallbackPoly(shape.points); g.stroke();
                }
            }
        }

        // 3. 战略进军路线箭头（选中州 → 雄关 → 资源州 → 洛阳）
        const highlightedGates = new Set<string>();
        if (conquest) {
            const waypoints: [number, number][] = [selectedRegion ? this.regionPos(selectedRegion) : this.toMapPos(conquest.origin.x, conquest.origin.y)];
            if (conquest.gate1) {
                highlightedGates.add(conquest.gate1.name);
                waypoints.push(this.toMapPos(conquest.gate1.x, conquest.gate1.y));
            }
            if (conquest.midRegion) {
                const midCity = this.map.cities?.find(c => c.region === conquest.midRegion.id);
                waypoints.push(this.toMapPos(midCity?.x ?? conquest.midRegion.x, midCity?.y ?? conquest.midRegion.y));
            }
            if (conquest.gate2) {
                highlightedGates.add(conquest.gate2.name);
                waypoints.push(this.toMapPos(conquest.gate2.x, conquest.gate2.y));
            }
            if (conquest.capital) waypoints.push(this.toMapPos(conquest.capital.x, conquest.capital.y));
            for (let i = 0; i + 1 < waypoints.length; i++) {
                const isLast = i + 2 === waypoints.length && !!conquest.capital;
                this.drawDashedArrow(g, waypoints[i][0], waypoints[i][1], waypoints[i + 1][0], waypoints[i + 1][1], isLast ? 12 : 8);
            }
        }

        // 4. 关隘节点（仅路线途经关口高亮并标注古典细铭）
        const selPos = selectedRegion ? this.regionPos(selectedRegion) : null;
        for (const gate of this.map.gates || []) {
            const [x, y] = this.toMapPos(gate.x, gate.y);
            const hot = highlightedGates.has(gate.name);
            if (!hot) continue;
            g.fillColor = new Color(255, 206, 98, 95);
            g.circle(x, y, 10); g.fill();
            g.fillColor = new Color(172, 46, 34, 248);
            g.strokeColor = new Color(255, 232, 162, 255);
            g.lineWidth = 1.6;
            const r = 5.2;
            g.moveTo(x, y + r); g.lineTo(x + r, y); g.lineTo(x, y - r); g.lineTo(x - r, y); g.close();
            g.fill(); g.stroke();
            if (minSide >= 260) {
                let offX = 0, offY = 18;
                if (selPos) {
                    const dx = x - selPos[0], dy = y - selPos[1];
                    if (Math.hypot(dx, dy) < 104) {
                        const d = Math.max(1, Math.hypot(dx, dy));
                        offX = Math.round(dx / d * 24);
                        offY = Math.round(dy / d * 20);
                    }
                }
                const tag = this.make(`GateTag_${gate.name}`, labels);
                place(tag, x + offX, y + offY, 64, 20);
                const tg = tag.addComponent(Graphics);
                tg.fillColor = new Color(18, 22, 22, 210);
                tg.roundRect(-30, -9, 60, 18, 3); tg.fill();
                tg.strokeColor = new Color(232, 198, 126, 190);
                tg.lineWidth = 1;
                tg.moveTo(-26, -9); tg.lineTo(26, -9);
                tg.moveTo(-26, 9); tg.lineTo(26, 9);
                tg.stroke();
                const gl = caption(tag, 'Text', gate.name, 0, 0, 58, 12, new Color(252, 236, 188), Label.HorizontalAlign.CENTER);
                gl.isBold = true;
                this.styleClassic(gl, 12, 14, 14, 220, 1);
            }
        }

        // 5. 洛阳天下中枢御徽（去除各州多余的小灰方块，画面清爽大气）
        const luoyang = (this.map.cities || []).find(c => c.level >= 10);
        if (luoyang) {
            const [x, y] = this.toMapPos(luoyang.x, luoyang.y);
            g.fillColor = new Color(244, 198, 92, 68);
            g.circle(x, y, 16); g.fill();
            g.fillColor = new Color(156, 44, 34, 245);
            g.circle(x, y, 8.5); g.fill();
            g.strokeColor = new Color(255, 230, 156, 255);
            g.lineWidth = 1.6;
            g.circle(x, y, 8.5); g.stroke();
            g.fillColor = new Color(255, 246, 206, 255);
            g.moveTo(x, y + 5); g.lineTo(x + 1.9, y + 1.5); g.lineTo(x + 5, y);
            g.lineTo(x + 1.9, y - 1.5); g.lineTo(x, y - 5); g.lineTo(x - 1.9, y - 1.5);
            g.lineTo(x - 5, y); g.lineTo(x - 1.9, y + 1.5); g.close(); g.fill();
        }

        // 6. 古典镌刻楷书州名（去除生硬黑盒子，直接与玉雕古铜沙盘融为一体）
        for (const region of this.map.regions) {
            const available = this.zones.some(zone => zone.name === region.name);
            const active = region.id === selectedId;
            const isImperial = region.tier === 2;
            const [rx, ry] = this.regionPos(region);

            if (active) {
                const rw = minSide < 340 ? 84 : 112;
                const rh = minSide < 340 ? 28 : 36;
                const ribbon = this.make(`ZonePlaque_${region.id}`, labels);
                place(ribbon, rx, ry, rw, rh);
                this.drawActiveRibbon(ribbon.addComponent(Graphics), rw, rh);
                const lbl = caption(ribbon, 'Zone' + region.id, region.name, 0, 1, rw - 16,
                    minSide < 340 ? 16 : 24, new Color(255, 246, 214), Label.HorizontalAlign.CENTER);
                lbl.isBold = true;
                this.styleClassic(lbl, 62, 18, 12, 245, 2.2);
            } else if (available) {
                // 未选起兵州：墨玉楷书直接镌刻于玉雕板块之上 + 纤细古铜菱纹底线（── ◆ ──）
                const holder = this.make(`ZonePlaque_${region.id}`, labels);
                place(holder, rx, ry, 92, 42);
                const fg = holder.addComponent(Graphics);
                fg.strokeColor = new Color(66, 54, 34, 170);
                fg.lineWidth = 1.2;
                fg.moveTo(-26, -15); fg.lineTo(-6, -15);
                fg.moveTo(6, -15); fg.lineTo(26, -15);
                fg.stroke();
                fg.fillColor = new Color(156, 54, 38, 215);
                fg.moveTo(0, -11.5); fg.lineTo(3.5, -15); fg.lineTo(0, -18.5); fg.lineTo(-3.5, -15); fg.close(); fg.fill();
                const lbl = caption(holder, 'Zone' + region.id, region.name, 0, 2, 88,
                    minSide < 340 ? 16 : 22, new Color(36, 30, 22), Label.HorizontalAlign.CENTER);
                lbl.isBold = true;
                this.styleClassic(lbl, 246, 238, 216, 225, 2.6);
            } else if (isImperial) {
                // 中央洛阳：古典鎏金楷书落于御徽下方
                const lbl = caption(labels, 'Zone' + region.id, '洛阳', rx, ry - 24, 88,
                    minSide < 340 ? 15 : 21, new Color(56, 36, 16), Label.HorizontalAlign.CENTER);
                lbl.isBold = true;
                this.styleClassic(lbl, 255, 236, 182, 235, 2.6);
            } else {
                // 内陆三资源州：低调浅金古铜刻字，融入深铜板块
                const lbl = caption(labels, 'Zone' + region.id, region.name, rx, ry, 76,
                    minSide < 340 ? 14 : 18, new Color(224, 210, 174, 195), Label.HorizontalAlign.CENTER);
                lbl.isBold = true;
                this.styleClassic(lbl, 20, 22, 20, 220, 2);
            }
        }
    }

    private onChoosePoint(event: EventTouch): void {
        event.propagationStopped = true;
        if (this._pending || !this.map) return;
        const ui = event.getUILocation();
        const p = this.mapNode.getComponent(UITransform).convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        // 底图已加载时优先按实测玉雕板块轮廓精准命中，点击暗海云雾区绝不误选
        if (this.terrainReady && this.artW > 0 && this.artH > 0) {
            const u = p.x / this.artW + 0.5, v = 0.5 - p.y / this.artH;
            const artHit = this.zones.find(z => {
                const poly = BIRTH_ART_SHAPES[z.name];
                return poly ? containsBirthPoint(poly, u, v) : false;
            });
            if (artHit) { this.chooseZone(artHit); return; }
        }
        const x = ((p.x - this.mapOffsetX) / this.mapW + .5) * this.map.width;
        const y = (.5 - (p.y - this.mapOffsetY) / this.mapH) * this.map.height;
        const shape = this.map.landShapes.find(s => containsBirthPoint(s.points, x, y));
        const region = this.map.regions.find(r => r.id === shape?.region);
        // 底图已就绪且落在六大玉雕起兵州外（暗海/云雾）则静默忽略
        if (this.terrainReady && region && BIRTH_ART_SHAPES[region.name]) return;
        const zone = this.zones.find(z => z.name === region?.name);
        if (!zone) { this.setStatus('请点选外围亮色的起兵州'); return; }
        this.chooseZone(zone);
    }

    private chooseZone(zone: BirthZone): void {
        if (this._pending) return;
        this.selected = zone; AudioManager.instance.playClick();
        this.setStatus('');
        this.drawMap();
        this.updateSelection();
        const region = this.map?.regions?.find(r => r.name === zone.name);
        if (region && this.mapNode) {
            Tween.stopAllByTarget(this.mapNode);
            const [x, y] = this.regionPos(region);
            tween(this.mapNode).to(.36, {
                scale: new Vec3(1.04, 1.04, 1),
                position: new Vec3(-x * .04, -y * .04, 0),
            }, { easing: 'sineInOut' }).start();
            if (isValid(this.zoneOpacity, true)) {
                Tween.stopAllByTarget(this.zoneOpacity); this.zoneOpacity.opacity = 70;
                tween(this.zoneOpacity).to(.26, { opacity: 255 }, { easing: 'sineOut' }).start();
            }
        }
    }

    private updateSelection(): void {
        const profile = this.selected ? (ZONE_PROFILES[this.selected.name] || {
            epithet: '群雄起兵 · 蓄势待发',
            seal: this.selected.name.slice(0, 1) || '起',
            desc: this.selected.route || '在此安民筑城，开启征途。',
        }) : DEFAULT_PROFILE;

        if (this.zoneName) this.zoneName.string = this.selected?.name || '何处起兵';
        if (this.sealText) this.sealText.string = profile.seal;
        if (this.description) this.description.string = profile.desc;
        if (this.routeText) {
            if (this.selected) {
                const conquest = resolveConquestPath(this.map, this.selected.name);
                const route = this.selected.route || conquest?.summary || '';
                this.routeText.string = route ? `${profile.epithet}  ·  ${route}` : profile.epithet;
            } else {
                this.routeText.string = profile.epithet;
            }
        }

        const canConfirm = !this._pending && !!this.selected && !!this.map;
        if (this.createButton) this.createButton.interactable = canConfirm;
        this.drawConfirmButton(canConfirm);
        const buttonOpacity = this.createButton?.node?.getComponent?.(UIOpacity);
        if (buttonOpacity) buttonOpacity.opacity = canConfirm ? 255 : 175;
        if (this.createButtonLabel) {
            this.createButtonLabel.string = this._pending ? '正在落城…'
                : this.selected ? `于${this.selected.name}起兵` : '在此起兵';
        }
        if (this.retry) {
            this.retry.active = !this._pending && !this.mapLoading && (!this.map || !this.zones.length);
            this.createButton.node.active = !this.retry.active;
        }
    }

    protected onLoad(): void {
        EventMgr.on(ServerConfig.s2c_user_create, this.onCreated, this);
        EventMgr.on(LogicEvent.enterMap, this.onEnteringMap, this);
        this.editName.string = this.getRandomName();
        if (this.editName.node?.parent) this.editName.node.parent.active = false;
        this.node.on(Node.EventType.SIZE_CHANGED, this.fitSheet, this);
    }

    protected onClickCreate(): void {
        if (this._pending) return;
        if (!this.zones.length) { LoginCommand.getInstance().requestCreationOptions(); return; }
        if (!this.selected || !this.map) return;
        const command = LoginCommand.getInstance();
        if (!command.proxy.getLoginData()) { this.setStatus('登录已失效，请重新登录'); return; }
        // 名称在后台生成；请求仍沿用服务端的姓名、性别、出生州字段。
        const name = this.editName.string.trim() || this.getRandomName();
        const sex = this.manToggle?.isChecked === false ? 2 : 1, zone = this.selected.key;
        AudioManager.instance.playClick();
        this.setPending(true); this.setStatus('正在为主公安置城池…');
        this.playLaunchDive();
        this.scheduleOnce(this.onCreateTimeout, 12);
        this.scheduleOnce(() => {
            if (!this._pending) return;
            try {
                if (!command.role_create(name, sex, zone)) this.onCreateFailed('未能连接，请稍后重试');
            } catch (error) { this.onCreateFailed('未能连接，请稍后重试'); }
        }, 0);
    }

    /** 供顶层云雾转场读取所选起兵州信息，承接序章故事、印章题铭与云幕收束焦点。 */
    public getLaunchTransitionTheme(): {
        seal: string;
        title: string;
        subtitle: string;
        zoneName: string;
        storyLines: string[];
        chapterMark: string;
        focusU: number;
        focusV: number;
    } | null {
        if (!this.selected) return null;
        const profile = ZONE_PROFILES[this.selected.name] || {
            epithet: '群雄起兵 · 蓄势待发',
            seal: this.selected.name.slice(0, 1) || '起',
            desc: this.selected.route || '在此安民筑城，开启征途。',
        };
        let focusU = 0.5;
        let focusV = 0.5;
        const region = this.map?.regions?.find(r => r.name === this.selected?.name);
        const bounds = this.node?.getComponent?.(UITransform);
        if (region && bounds && bounds.width > 0 && bounds.height > 0) {
            const [rx, ry] = this.regionPos(region);
            focusU = Math.min(0.86, Math.max(0.14, 0.5 + rx / bounds.width));
            focusV = Math.min(0.86, Math.max(0.14, 0.5 - ry / bounds.height));
        }
        const provinceCouncil = ZONE_PROLOGUE_LINES[this.selected.name]
            || `主公择${this.selected.name}而起——${profile.epithet}，正是兴师立业之良地！`;
        const route = resolveConquestPath(this.map, this.selected.name);
        const routeLine = route?.summary
            ? `${route.summary}——云开金光所照，正是千军共指之帝都洛阳！`
            : '破雄关、夺要隘、会师司隶——云开金光所照，正是帝都洛阳！';
        return {
            seal: profile.seal,
            title: `入主${this.selected.name}`,
            subtitle: profile.epithet,
            zoneName: this.selected.name,
            // 八卷典雅凝练三国史诗辞章，字句对仗工整且与每幅手绘原画及SLG世界观严丝合缝
            storyLines: [
                '中平末季，阉宦乱政，董卓纵火焚洛——四百年炎汉玉阙，一夕尽成焦土。\n赤焰倒映洛水，黑烟蔽塞天光；帝星失驭，九州神器自此沦入乱世。',
                '一夕之间，万峰烽燧连天而起，残旗猎猎呼啸于苍茫暮风。\n关中、河内、河东拱卫司隶，十三雄关锁钥九州——逐鹿之局，由此大开。',
                '秦失其鹿，天下共逐——四方豪杰陈兵河谷，旌旗蔽日，营火连绵百里。\n铁马冰河，合纵连横；乱世寸土，皆凭奇谋与血火争得。',
                '干戈不息，沃野流离，万千黎庶守望孤村残灯，唯盼明主出世。\n君携幕僚按剑立于云崖，俯瞰烽烟千里——誓平宇内、再造山河！',
                `华帐燃薪，军师摇羽扇指点九州沙盘，为君与众将剖析天下大势：\n「${provinceCouncil}」`,
                '欲平天下，必先固本——伐木筑垣，开荒屯垦，锻甲铸兵，演武募士。\n广积粮秣、礼贤纳将、结盟同袍；自一城一地起，厚积破关之力！',
                `待兵锋既利、粮道充盈，便鸣鼓出关，铁骑旌旗漫卷险峻山道！\n${routeLine}`,
                `晨曦破云，碧水梯田环抱之间，君于${this.selected.name}所立初城已然落成。\n大旗猎猎迎风，万里霸业第一卷，此刻便交由主公亲笔落墨！`,
            ],
            chapterMark: `大旗初立 · 入主${this.selected.name}`,
            focusU,
            focusV,
        };
    }

    /** 确认起兵后沙盘向所选州柔滑推近、外围浮条轻淡隐去，与水墨云幕合拢衔接成一气。 */
    private playLaunchDive(): void {
        if (!this.mapNode || !this.selected || !this.map) return;
        const region = this.map.regions?.find(r => r.name === this.selected?.name);
        if (region) {
            Tween.stopAllByTarget(this.mapNode);
            const [x, y] = this.regionPos(region);
            tween(this.mapNode).to(0.58, {
                scale: new Vec3(1.24, 1.24, 1),
                position: new Vec3(-x * 0.24, -y * 0.24, 0),
            }, { easing: 'cubicInOut' }).start();
        }
        this.fadeLaunchChrome(0, 0.26);
    }

    /** 建角失败或超时时将沙盘与底部浮条柔滑复位，不卡在推进状态。 */
    private restoreLaunchDive(): void {
        if (this.mapNode) {
            Tween.stopAllByTarget(this.mapNode);
            const region = this.selected ? this.map?.regions?.find(r => r.name === this.selected?.name) : null;
            const scale = region ? 1.04 : 1;
            const [x, y] = region ? this.regionPos(region) : [0, 0];
            tween(this.mapNode).to(0.32, {
                scale: new Vec3(scale, scale, 1),
                position: new Vec3(-x * (scale - 1), -y * (scale - 1), 0),
            }, { easing: 'quadOut' }).start();
        }
        this.fadeLaunchChrome(255, 0.22);
    }

    private fadeLaunchChrome(targetOpacity: number, duration: number): void {
        const targets = [this.bottomBar].filter((n): n is Node => !!n && isValid(n, true));
        for (const node of targets) {
            const op = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
            if (!this.launchChromeOpacities.includes(op)) this.launchChromeOpacities.push(op);
            Tween.stopAllByTarget(op);
            tween(op).to(duration, { opacity: targetOpacity }, { easing: targetOpacity === 0 ? 'quadIn' : 'quadOut' }).start();
        }
    }

    private onCreated(data: { name?: string; result?: number }): void {
        if (!this._pending) return;
        if (data?.result === 2) {
            this.onCreateFailed('可选州已更新，请重新选择');
            this.selected = null; this.configureZones([]);
            LoginCommand.getInstance().requestCreationOptions(); return;
        }
        if (data?.result === 3) {
            this.zones = this.zones.filter(zone => zone.key !== this.selected?.key);
            this.selected = null;
            this.onCreateFailed('该州暂无落脚之处，请另择一州');
            if (this.mapNode) this.drawMap();
            return;
        }
        if (!data || data.result || !data.name) {
            this.editName.string = this.getRandomName();
            this.onCreateFailed('落城未成功，请重试'); return;
        }
    }
    private onEnteringMap(): void {
        if (!this._pending) return;
        this.unschedule(this.onCreateTimeout);
        this.setStatus('城址已定，正在前往…');
    }
    private onCreateTimeout(): void { this.onCreateFailed('暂未收到回复，请稍后重试'); }
    private onCreateFailed(message: string): void {
        this.unschedule(this.onCreateTimeout); this.setPending(false); this.setStatus(message);
        this.restoreLaunchDive();
    }
    private setPending(pending: boolean): void { this._pending = pending; this.updateSelection(); }
    private setStatus(message: string): void {
        this.message = message; if (this.statusLabel) this.statusLabel.string = message;
    }
    protected onRandomName(): void { if (!this._pending) this.editName.string = this.getRandomName(); }
    protected onClickToggle(): void {}
    protected getRandomName(): string { return createName(this.manToggle?.isChecked === false ? 'girl' : 'boy'); }
    protected onDestroy(): void {
        EventMgr.targetOff(this);
        if (this.mapNode) Tween.stopAllByTarget(this.mapNode);
        // 子节点可能先被销毁，此时 Label 仍有引用但 node 已被清空。
        // 直接取消创建时保存的动画目标，不再向已销毁节点查询组件。
        if (this.zoneOpacity) Tween.stopAllByTarget(this.zoneOpacity);
        this.zoneOpacity = null;
        for (const op of this.launchChromeOpacities) Tween.stopAllByTarget(op);
        this.launchChromeOpacities.length = 0;
    }
}
