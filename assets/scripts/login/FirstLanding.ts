import { _decorator, BlockInputEvents, Button, Color, Component, Graphics, Label, Node, Sprite, SpriteFrame, UIOpacity, UITransform, Vec2, isValid, resources } from 'cc';
import MapLogic from '../map/MapLogic';
import ProgressionCommand from '../progression/ProgressionCommand';
import { trackedTask, taskPresentation } from '../progression/ProgressionPresentation';
import { caption, inkSurface, place, textStyle, ManagementColors as C } from '../map/ui/ManagementStyle';
import { getGeneralPortraitPath } from '../general/GeneralPortrait';

const { ccclass } = _decorator;
const CLASSIC_FONT = 'STKaiti, KaiTi, BiauKai, FangSong, SimSun, Songti SC, serif';

const ZONE_ARRIVAL_LINES: Record<string, string> = {
    '青州': '主公，已抵青州故地。齐鲁沃野、东临沧海，当先安顿黎庶、修筑城垣，以奠霸业之基。',
    '徐州': '主公，已抵徐州要津。此地平畴水网、南北通衢，当先安顿百姓、夯实城防，以备四方之变。',
    '荆州': '主公，已抵荆楚之地。江汉汤汤、沃土千里，正宜先抚黎民、安顿城郭，再图北向关中。',
    '益州': '主公，已抵天府益州。群山合抱、剑阁天险，正可安顿百姓、深植根基，静待时机出关。',
    '凉州': '主公，已抵西陲凉州。关山苍茫、风骨雄健，当先安顿百姓、筑坞立城，再养铁骑以震中原。',
    '幽州': '主公，已抵北疆幽州。燕赵之地慷慨多义，正宜安顿黎庶、聚拢人心，徐图南下中原之势。',
};

/**
 * 完全对称的古典墨漆鎏金长卷对话布局：
 * 人物画龛严丝合缝内嵌于统一主匾左侧，上下齐平、左右严格居中对称（无突出阶梯与偏置感）。
 */
export function landingDialogueLayout(w: number, h: number) {
    const compact = w < 720 || h < 500;
    const width = Math.min(980, w - 32);
    const panelHeight = h < 400 ? 164 : compact ? 192 : 194;
    const inset = compact ? 10 : 14;
    const maxPortraitH = compact ? Math.min(panelHeight - inset * 2, Math.max(92, Math.floor(w * 0.30))) : (panelHeight - inset * 2);
    const portraitHeight = Math.max(88, Math.min(panelHeight - inset * 2, maxPortraitH));
    const portraitWidth = Math.round(portraitHeight * 3 / 4);
    const height = panelHeight;
    const bottom = compact ? 14 : 26;
    const gap = compact ? 14 : 22;
    const textLeft = -width / 2 + inset + portraitWidth + gap;
    const textWidth = width / 2 - textLeft;
    const padding = compact ? 12 : 24;
    return {
        width, height, bottom, panelHeight, inset,
        portraitWidth, portraitHeight, textLeft, textWidth,
        padding, fontSize: compact ? 20 : 23, lineHeight: compact ? 28 : 35,
    };
}

/** 落城时让出主城画面，以端庄对称的古典军师对话衔接第一道军令。 */
@ccclass('FirstLanding')
export default class FirstLanding extends Component {
    private map: MapLogic;
    private city: Vec2;
    private finished: (() => void) | null = null;
    private elapsed = 0;
    private stage = -1;
    private card: Node;
    private body: Label;
    private hint: Label;
    private skip: Node;
    private line = '';
    private revealed = 0;
    private dialogueOpacity: UIOpacity;
    private shadeOpacity: UIOpacity;
    private portrait: Sprite;
    private portraitFrame: Node;
    private dialoguePanel: Node;
    private sealNode: Node | null = null;
    private sealLabel: Label | null = null;
    private zoneName = '';
    private cinemaTop: Node | null = null;
    private cinemaBottom: Node | null = null;
    private cinemaTopGraphics: Graphics | null = null;
    private cinemaBottomGraphics: Graphics | null = null;
    private cinemaWidth = 1280;
    private cinemaBarHeight = 46;
    private arrivalBanner: Node | null = null;
    private arrivalOpacity: UIOpacity | null = null;
    private arrivalTitle: Label | null = null;
    private arrivalSub: Label | null = null;
    private cardBaseY = 0;
    private cardEnterElapsed = 0;
    private hiddenHud: { opacity: UIOpacity; value: number }[] = [];

    initialize(map: MapLogic, city: Vec2, finished: () => void, zoneName = ''): void {
        this.map = map; this.city = city; this.finished = finished; this.zoneName = zoneName || '';
        this.node.addComponent(UITransform);
        this.node.addComponent(BlockInputEvents);
        // 只改变可见度，避免停用 HUD 触发退订和数据重建。
        for (const sibling of this.node.parent.children) {
            if (sibling === this.node) continue;
            const opacity = sibling.getComponent(UIOpacity) || sibling.addComponent(UIOpacity);
            this.hiddenHud.push({ opacity, value: opacity.opacity }); opacity.opacity = 0;
        }
        this.cinemaTop = this.make('CinemaTop');
        this.cinemaTopGraphics = this.cinemaTop.addComponent(Graphics);
        this.cinemaBottom = this.make('CinemaBottom');
        this.cinemaBottomGraphics = this.cinemaBottom.addComponent(Graphics);

        this.arrivalBanner = this.make('ArrivalBanner');
        this.arrivalBanner.addComponent(Graphics);
        this.arrivalOpacity = this.arrivalBanner.addComponent(UIOpacity);
        this.arrivalOpacity.opacity = 0;
        const arrivalMain = this.zoneName ? `${this.zoneName} · 旌旗初立` : '山河初定 · 旌旗初立';
        this.arrivalTitle = caption(this.arrivalBanner, 'ArrivalTitle', arrivalMain, 0, 10, 420, 30,
            new Color(252, 234, 180), Label.HorizontalAlign.CENTER);
        this.arrivalTitle.isBold = true;
        this.arrivalTitle.fontFamily = CLASSIC_FONT; this.arrivalTitle.useSystemFont = true;
        this.arrivalTitle.outlineColor = new Color(10, 14, 14, 240); this.arrivalTitle.outlineWidth = 2.2;
        this.arrivalSub = caption(this.arrivalBanner, 'ArrivalSub', '拨云瞰九州 · 择土筑基业', 0, -18, 380, 14,
            new Color(220, 206, 172), Label.HorizontalAlign.CENTER);
        this.arrivalSub.fontFamily = CLASSIC_FONT; this.arrivalSub.useSystemFont = true;
        this.arrivalSub.outlineColor = new Color(10, 14, 14, 210); this.arrivalSub.outlineWidth = 1.2;

        this.card = this.make('Dialogue');
        this.dialogueOpacity = this.card.addComponent(UIOpacity);
        this.card.addComponent(Button).transition = Button.Transition.NONE;
        this.card.on(Button.EventType.CLICK, this.advance, this);
        // 统一对称主匾位于底层，人物画龛内嵌其左侧，上下齐平零阶梯
        this.dialoguePanel = this.make('DialoguePanel', this.card);
        this.portraitFrame = this.make('PortraitFrame', this.card);
        caption(this.portraitFrame, 'PortraitFallback', '军师', 0, 0, 100, 24, C.gold, Label.HorizontalAlign.CENTER);
        this.portrait = this.make('Portrait', this.portraitFrame).addComponent(Sprite);
        this.portrait.sizeMode = Sprite.SizeMode.CUSTOM;
        this.portrait.node.active = false;

        this.sealNode = this.make('SpeakerSeal', this.card);
        this.sealNode.addComponent(Graphics);
        this.sealLabel = caption(this.sealNode, 'SealChar', '谋', 0, 0, 24, 14, new Color(252, 238, 204), Label.HorizontalAlign.CENTER);
        this.sealLabel.isBold = true;
        this.sealLabel.fontFamily = CLASSIC_FONT; this.sealLabel.useSystemFont = true;

        caption(this.card, 'Speaker', '随行军师', 0, 0, 110, 23, C.gold, Label.HorizontalAlign.LEFT);
        caption(this.card, 'SpeakerRole', '· 帐下幕僚', 0, 0, 160, 14, C.text, Label.HorizontalAlign.LEFT);
        this.body = caption(this.card, 'Story', '', 0, 0, 500, 22, new Color(248, 242, 224), Label.HorizontalAlign.LEFT);
        this.hint = caption(this.card, 'AdvanceHint', '轻触续览 ›', 0, 0, 140, 13, C.muted, Label.HorizontalAlign.RIGHT);
        this.skip = this.make('Skip'); this.skip.addComponent(Button);
        caption(this.skip, 'Text', '跳过 ›', 0, 0, 72, 14, C.text, Label.HorizontalAlign.CENTER);
        this.skip.on(Button.EventType.CLICK, this.finish, this);
        this.node.parent.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        this.layout(); this.card.active = false;
        this.drawCinemaBars(1);
        this.loadPortrait();
        this.map.showLandingFrame(this.city, 0);
    }

    private loadPortrait(): void {
        const apply = (frame: SpriteFrame) => {
            if (!isValid(this, true) || !this.finished || !isValid(this.portrait, true)) return;
            this.portrait.spriteFrame = frame;
            this.portrait.node.active = true;
            const fallback = this.portraitFrame.getChildByName('PortraitFallback');
            if (fallback) fallback.active = false;
        };
        resources.load('ui/onboarding/guide-advisor/spriteFrame', SpriteFrame, (err, frame) => {
            if (!err && frame instanceof SpriteFrame) { apply(frame); return; }
            resources.load(getGeneralPortraitPath('ui/hero/card_1020'), SpriteFrame, (fallbackErr, fallbackFrame) => {
                if (fallbackErr || !(fallbackFrame instanceof SpriteFrame)) {
                    console.warn('开场军师画像加载失败', fallbackErr?.message || 'SpriteFrame unavailable');
                    return;
                }
                apply(fallbackFrame);
            });
        });
    }

    private make(name: string, parent = this.node): Node {
        const node = new Node(name); node.layer = this.node.layer;
        parent.addChild(node); node.addComponent(UITransform); return node;
    }

    /** 绘制对称汉风回纹金角与古典墨漆双线大匾 */
    private paintSymmetricalPlaque(g: Graphics, w: number, h: number, dividerX: number, textLeftLocal: number, textRightLocal: number): void {
        const hw = w / 2, hh = h / 2;
        g.clear();
        // 外层微柔墨影
        g.fillColor = new Color(6, 10, 10, 120);
        g.roundRect(-hw - 4, -hh - 4, w + 8, h + 8, 6);
        g.fill();
        // 主体深墨翠漆底色（微带上下质感层次）
        g.fillColor = new Color(13, 20, 19, 244);
        g.roundRect(-hw, -hh, w, h, 4);
        g.fill();
        g.fillColor = new Color(22, 32, 30, 88);
        g.rect(-hw + 4, 0, w - 8, hh - 4);
        g.fill();

        // 外鎏金边框 + 内细金线（严格四边对称）
        g.strokeColor = new Color(204, 170, 104, 224);
        g.lineWidth = 1.6;
        g.roundRect(-hw + 0.8, -hh + 0.8, w - 1.6, h - 1.6, 4);
        g.stroke();
        g.strokeColor = new Color(224, 192, 124, 72);
        g.lineWidth = 1;
        g.roundRect(-hw + 6, -hh + 6, w - 12, h - 12, 2);
        g.stroke();

        // 四角对称汉风回纹包角饰件
        const arm = 15;
        g.strokeColor = new Color(246, 214, 140, 230);
        g.lineWidth = 2.0;
        for (const sx of [-1, 1]) {
            for (const sy of [-1, 1]) {
                const cx = sx * (hw - 2);
                const cy = sy * (hh - 2);
                g.moveTo(cx - sx * arm, cy);
                g.lineTo(cx, cy);
                g.lineTo(cx, cy - sy * arm);
            }
        }
        g.stroke();

        // 顶部与底部正中对称鎏金菱饰
        g.fillColor = new Color(244, 212, 138, 220);
        for (const sy of [-1, 1]) {
            const cy = sy * (hh - 1);
            g.moveTo(0, cy + 3.4); g.lineTo(4.6, cy); g.lineTo(0, cy - 3.4); g.lineTo(-4.6, cy); g.close();
        }
        g.fill();

        // 画龛与正文之间精致古金竖隔线 + 两端小菱点
        g.strokeColor = new Color(208, 174, 108, 92);
        g.lineWidth = 1;
        g.moveTo(dividerX, -hh + 20);
        g.lineTo(dividerX, hh - 20);
        g.stroke();
        g.fillColor = new Color(232, 198, 126, 175);
        for (const sy of [-1, 1]) {
            const cy = sy * (hh - 20);
            g.moveTo(dividerX, cy + 2.6); g.lineTo(dividerX + 2.6, cy); g.lineTo(dividerX, cy - 2.6); g.lineTo(dividerX - 2.6, cy); g.close();
        }
        g.fill();

        // 标题栏下方古金分隔细线（配左端朱金菱点，衬托文辞层次）
        const ruleY = hh - 52;
        if (textRightLocal > textLeftLocal + 40) {
            g.strokeColor = new Color(216, 182, 114, 110);
            g.lineWidth = 1;
            g.moveTo(textLeftLocal, ruleY);
            g.lineTo(textRightLocal, ruleY);
            g.stroke();
            g.fillColor = new Color(242, 206, 132, 200);
            g.moveTo(textLeftLocal, ruleY + 2.5);
            g.lineTo(textLeftLocal + 2.5, ruleY);
            g.lineTo(textLeftLocal, ruleY - 2.5);
            g.lineTo(textLeftLocal - 2.5, ruleY);
            g.close();
            g.fill();
        }
    }

    private layout(): void {
        const bounds = this.node.parent?.getComponent(UITransform);
        if (!bounds || !this.card) return;
        const w = bounds.width, h = bounds.height;
        const m = landingDialogueLayout(w, h);
        const compact = w < 720 || h < 500;
        place(this.node, 0, 0, w, h);
        this.cinemaWidth = w;
        this.cinemaBarHeight = (w < 640 || h < 480) ? 34 : 46;
        if (this.cinemaTop) place(this.cinemaTop, 0, h / 2 - this.cinemaBarHeight / 2, w, this.cinemaBarHeight);
        if (this.cinemaBottom) place(this.cinemaBottom, 0, -h / 2 + this.cinemaBarHeight / 2, w, this.cinemaBarHeight);
        if (this.arrivalBanner) {
            const bw = Math.min(460, w - 64);
            place(this.arrivalBanner, 0, h * 0.24, bw, 72);
            const ag = this.arrivalBanner.getComponent(Graphics);
            if (ag) {
                ag.clear();
                ag.fillColor = new Color(11, 18, 19, 175);
                ag.roundRect(-bw / 2, -34, bw, 68, 4);
                ag.fill();
                ag.strokeColor = new Color(228, 194, 122, 185);
                ag.lineWidth = 1.2;
                ag.moveTo(-bw / 2 + 26, 32); ag.lineTo(bw / 2 - 26, 32);
                ag.moveTo(-bw / 2 + 26, -32); ag.lineTo(bw / 2 - 26, -32);
                ag.stroke();
                ag.fillColor = new Color(246, 214, 140, 215);
                for (const sx of [-1, 1]) {
                    const dx = sx * (bw / 2 - 18);
                    ag.moveTo(dx, 3.6); ag.lineTo(dx + 3.6, 0); ag.lineTo(dx, -3.6); ag.lineTo(dx - 3.6, 0); ag.close();
                }
                ag.fill();
            }
            if (this.arrivalTitle) {
                place(this.arrivalTitle.node, 0, 10, bw - 28, 34);
                this.arrivalTitle.fontSize = w < 640 ? 22 : 28;
            }
            if (this.arrivalSub) {
                place(this.arrivalSub.node, 0, -17, bw - 28, 20);
                this.arrivalSub.fontSize = w < 640 ? 12 : 14;
            }
        }
        const shade = inkSurface(this.node, 'EdgeShade', w, h, null, null);
        this.shadeOpacity = shade.node.getComponent(UIOpacity) || shade.node.addComponent(UIOpacity);
        this.shadeOpacity.opacity = this.stage < 0 ? 0 : 255;
        for (let i = 0; i < 28; i++) {
            shade.fillColor = new Color(10, 15, 15, Math.round(224 * (1 - i / 28)));
            shade.rect(-w / 2, -h / 2 + i * 7, w, 7); shade.fill();
        }
        shade.fillColor = new Color(10, 15, 15, 76);
        shade.rect(-w / 2, h / 2 - 12, w, 12); shade.fill();

        // 整个对称主匾严格居中于 x = 0，左右留白完全一致
        this.cardBaseY = -h / 2 + m.bottom + m.height / 2;
        place(this.card, 0, this.cardBaseY, m.width, m.height);
        const base = -m.height / 2, top = base + m.panelHeight;

        place(this.dialoguePanel, 0, 0, m.width, m.panelHeight);
        const dividerX = -m.width / 2 + m.inset + m.portraitWidth + Math.round((m.textLeft - (-m.width / 2 + m.inset + m.portraitWidth)) * 0.5);
        const textAreaLeft = m.textLeft + m.padding;
        const textAreaRight = m.width / 2 - m.padding;
        const plaqueG = this.dialoguePanel.getComponent(Graphics) || this.dialoguePanel.addComponent(Graphics);
        this.paintSymmetricalPlaque(plaqueG, m.width, m.panelHeight, dividerX, textAreaLeft, textAreaRight);

        // 人物画龛严丝合缝居中于左侧对称框内（上下留白完全等距）
        const portraitCenterX = -m.width / 2 + m.inset + m.portraitWidth / 2;
        place(this.portraitFrame, portraitCenterX, 0, m.portraitWidth, m.portraitHeight);
        const mount = inkSurface(this.portraitFrame, 'Mount', m.portraitWidth, m.portraitHeight,
            new Color(14, 21, 20, 248), new Color(214, 178, 108, 228));
        mount.strokeColor = new Color(255, 232, 172, 85);
        mount.lineWidth = 1;
        mount.rect(-m.portraitWidth / 2 + 3.5, -m.portraitHeight / 2 + 3.5, m.portraitWidth - 7, m.portraitHeight - 7);
        mount.stroke();
        place(this.portrait.node, 0, 0, m.portraitWidth - 8, m.portraitHeight - 8);

        // 标题行：朱砂小印「谋」 + 紧贴的「随行军师」 + 「· 帐下幕僚」（消除尴尬大留白）
        const left = textAreaLeft;
        const textWidth = Math.max(120, textAreaRight - textAreaLeft);
        const sealSize = compact ? 22 : 24;
        const headerY = top - 30;
        if (this.sealNode) {
            place(this.sealNode, left + sealSize / 2, headerY, sealSize, sealSize);
            const sg = this.sealNode.getComponent(Graphics);
            if (sg) {
                sg.clear();
                sg.fillColor = new Color(156, 38, 28, 242);
                sg.roundRect(-sealSize / 2, -sealSize / 2, sealSize, sealSize, 3);
                sg.fill();
                sg.strokeColor = new Color(246, 214, 142, 220);
                sg.lineWidth = 1;
                sg.roundRect(-sealSize / 2 + 0.8, -sealSize / 2 + 0.8, sealSize - 1.6, sealSize - 1.6, 2.5);
                sg.stroke();
            }
            if (this.sealLabel) {
                this.sealLabel.string = this.stage === 1 ? '令' : '谋';
                this.sealLabel.fontSize = compact ? 13 : 14;
            }
        }

        const speakerLeft = left + sealSize + 10;
        const speakerW = compact ? 86 : 98;
        const speaker = this.card.getChildByName('Speaker')?.getComponent(Label);
        textStyle(speaker, speakerLeft + speakerW / 2, headerY, speakerW, compact ? 20 : 22,
            new Color(254, 226, 156), Label.HorizontalAlign.LEFT, 28);
        if (speaker) {
            speaker.isBold = true;
            speaker.fontFamily = CLASSIC_FONT;
            speaker.useSystemFont = true;
            speaker.outlineColor = new Color(12, 16, 15, 230);
            speaker.outlineWidth = 1.4;
        }
        const role = this.card.getChildByName('SpeakerRole')?.getComponent(Label);
        const roleLeft = speakerLeft + speakerW + 4;
        const roleWidth = Math.max(0, Math.min(180, textAreaRight - roleLeft));
        if (role) {
            role.node.active = roleWidth >= 60;
            role.string = this.stage === 1 ? '· 启程军令' : '· 帐下幕僚';
            role.fontFamily = CLASSIC_FONT;
            role.useSystemFont = true;
        }
        textStyle(role, roleLeft + roleWidth / 2, headerY - 1, Math.max(60, roleWidth), compact ? 13 : 14,
            new Color(206, 188, 150), Label.HorizontalAlign.LEFT, 22);

        const bodyHeight = Math.max(52, m.panelHeight - 96);
        textStyle(this.body, left + textWidth / 2, top - 62 - bodyHeight / 2, textWidth,
            m.fontSize, this.stage === 1 ? new Color(255, 228, 164) : new Color(248, 242, 224), Label.HorizontalAlign.LEFT, bodyHeight);
        this.body.enableWrapText = true; this.body.lineHeight = m.lineHeight;
        this.body.isBold = this.stage === 1;
        this.body.fontFamily = CLASSIC_FONT; this.body.useSystemFont = true;
        this.body.outlineColor = new Color(10, 14, 13, 235); this.body.outlineWidth = 1.4;
        this.body.overflow = Label.Overflow.SHRINK;

        textStyle(this.hint, textAreaRight - 66, base + 20, 132, 13,
            new Color(224, 200, 150), Label.HorizontalAlign.RIGHT, 22);
        this.hint.fontFamily = CLASSIC_FONT; this.hint.useSystemFont = true;
        this.hint.string = this.stage === 1 ? '谨遵钧令 ›' : '轻触续览 ›';

        place(this.skip, w / 2 - 62, h / 2 - 36, 86, 34);
        inkSurface(this.skip, 'SkipBg', 86, 34, new Color(16, 22, 21, 185), new Color(188, 154, 92, 165));
        const skipLbl = this.skip.getChildByName('Text')?.getComponent(Label);
        if (skipLbl) { skipLbl.fontFamily = CLASSIC_FONT; skipLbl.useSystemFont = true; }
    }

    protected update(dt: number): void {
        if (!this.finished) return;
        const step = Math.min(dt, .1);
        if (this.stage < 0) {
            this.elapsed += step;
            const progress = Math.max(0, Math.min(1, (this.elapsed - .18) / 2.1));
            this.map.showLandingFrame(this.city, progress);
            this.updateLandingCinema();
            if (this.elapsed >= 2.5) { this.stage = 0; this.showStory(); }
        } else {
            if (this.stage === 1) this.updateTaskLine();
            this.cardEnterElapsed += step;
            const slideT = Math.min(1, this.cardEnterElapsed / 0.28);
            const eased = 1 - Math.pow(1 - slideT, 3);
            if (this.card && typeof this.card.setPosition === 'function' && this.cardBaseY !== 0) {
                this.card.setPosition(0, this.cardBaseY - 20 * (1 - eased), 0);
            }
            this.revealed += step * 32;
            this.body.string = Array.from(this.line).slice(0, Math.floor(this.revealed)).join('');
            if (this.dialogueOpacity) this.dialogueOpacity.opacity = Math.min(255, Math.round(eased * 255));
            if (this.shadeOpacity) this.shadeOpacity.opacity = Math.min(255, this.shadeOpacity.opacity + dt * 900);
        }
    }

    private updateLandingCinema(): void {
        const retract = this.elapsed < 1.95 ? 1 : Math.max(0, 1 - (this.elapsed - 1.95) / 0.45);
        this.drawCinemaBars(retract);
        if (this.arrivalOpacity) {
            const fadeIn = Math.max(0, Math.min(1, (this.elapsed - 0.18) / 0.45));
            const fadeOut = this.elapsed < 1.65 ? 1 : Math.max(0, 1 - (this.elapsed - 1.65) / 0.48);
            this.arrivalOpacity.opacity = Math.round(fadeIn * fadeOut * 255);
        }
    }

    private drawCinemaBars(ratio: number): void {
        if (!this.cinemaTopGraphics || !this.cinemaBottomGraphics) return;
        const barH = this.cinemaBarHeight;
        const h = Math.round(barH * ratio);
        const w = this.cinemaWidth;
        const paint = (g: Graphics, isTop: boolean) => {
            g.clear();
            if (h <= 0) return;
            g.fillColor = new Color(6, 10, 11, 236);
            g.rect(-w / 2, isTop ? barH / 2 - h : -barH / 2, w, h);
            g.fill();
            g.strokeColor = new Color(210, 178, 114, Math.round(125 * ratio));
            g.lineWidth = 1;
            const y = isTop ? barH / 2 - h : -barH / 2 + h;
            g.moveTo(-w / 2, y); g.lineTo(w / 2, y); g.stroke();
        };
        paint(this.cinemaTopGraphics, true);
        paint(this.cinemaBottomGraphics, false);
    }

    private setLine(text: string): void {
        if (text === this.line) return;
        this.line = text; this.revealed = 0; this.body.string = '';
    }

    private showStory(): void {
        this.card.active = true;
        this.drawCinemaBars(0);
        if (this.arrivalBanner) this.arrivalBanner.active = false;
        if (this.stage === 0) {
            this.cardEnterElapsed = 0;
            if (this.dialogueOpacity) this.dialogueOpacity.opacity = 0;
            const zoneLine = this.zoneName
                ? (ZONE_ARRIVAL_LINES[this.zoneName] || `主公，已抵${this.zoneName}。乱世初立，当先安顿黎庶、修筑城郭，方能徐图大业。`)
                : '主公，已抵新封之地。乱世初立，当先安顿百姓、修筑城郭，方能徐图大业。';
            this.setLine(zoneLine);
        } else {
            this.updateTaskLine();
        }
        this.layout();
        if (this.stage === 0 && this.card && typeof this.card.setPosition === 'function' && this.cardBaseY !== 0) {
            this.card.setPosition(0, this.cardBaseY - 20, 0);
        }
        if (this.shadeOpacity && this.stage === 0) this.shadeOpacity.opacity = 0;
    }

    private updateTaskLine(): void {
        const task = trackedTask(ProgressionCommand.getInstance().tasks.values());
        this.setLine(task
            ? `城郭既立，百废待兴。谨呈第一道军令：「${taskPresentation(task).name}」，请主公亲裁！`
            : '城郭既立，百废待兴。先安民心、再整甲兵，万事俱备，唯请主公下令！');
    }

    private advance(): void {
        if (this.body.string !== this.line) {
            this.revealed = Array.from(this.line).length; this.body.string = this.line; return;
        }
        if (this.stage === 0) { this.stage = 1; this.showStory(); }
        else this.finish();
    }

    private restoreHud(): void {
        for (const saved of this.hiddenHud) if (saved.opacity.isValid) saved.opacity.opacity = saved.value;
        this.hiddenHud.length = 0;
    }

    private finish(): void {
        if (!this.finished) return;
        this.map.showLandingFrame(this.city, 1);
        const done = this.finished; this.finished = null;
        this.restoreHud();
        this.node.active = false; this.node.destroy(); done();
    }

    protected onDestroy(): void {
        this.finished = null; this.restoreHud();
        this.node.parent?.off(Node.EventType.SIZE_CHANGED, this.layout, this);
    }
}
