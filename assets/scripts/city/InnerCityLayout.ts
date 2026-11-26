export type InnerCityZone = 'core' | 'civic' | 'military' | 'defense' | 'suburb';
export type InnerCityShortcutKind = 'draw' | 'troops' | 'generals' | 'market' | 'overview';

export interface InnerCityPlotSpec {
    /** 对应 BuildingDetail.json 的建筑 ID */
    type: number;
    /** 建筑默认名（配置未加载前的回退文案） */
    fallbackName: string;
    /** 建筑高清立绘路径（用于详情抽屉展示与营造路线图，不带 /spriteFrame 后缀） */
    art: string;
    /** 所属内城分区 */
    zone: InnerCityZone;
    /** 归一化坐标：[-0.5, 0.5]，原点为全景城郭底图中心 */
    nx: number;
    ny: number;
    /** 该建筑区在全景城郭中的交互/光环/施工脚手架包围尺寸（像素） */
    width: number;
    height: number;
    /** 地脚微调偏移（像素，正值向上） */
    groundOffsetY: number;
    /** 屏幕空间铭牌相对建筑中心的竖直偏移（像素，负值在下方） */
    plaqueOffsetY?: number;
    /** 已建建筑的暖光灯笼/炉火相对坐标（以 width/height 为基准，rx ∈ [-0.5, 0.5], ry ∈ [-0.5, 0.5]） */
    lanternPoints?: ReadonlyArray<{ rx: number; ry: number; radius?: number }>;
    /** 可选的专属玩法快捷入口 */
    shortcut?: {
        kind: InnerCityShortcutKind;
        label: string;
    };
}

/** 独立内城 2K 写实中轴对称汉风全景城郭（四正端庄、哑光 PBR 质感，去卡通勾边与 AI 滤镜感）。 */
export const INNER_CITY_CANVAS_WIDTH = 2560;
export const INNER_CITY_CANVAS_HEIGHT = 1440;
export const INNER_CITY_GROUND_ART = 'ui/city_buildings/inner_city_ground';
export const INNER_CITY_PLOT_FOUNDATION_ART = 'ui/city_buildings/plot_foundation';
export const INNER_CITY_PLOT_LOCKED_ART = 'ui/city_buildings/plot_locked';
export const INNER_CITY_MIN_ZOOM = 0.50;
export const INNER_CITY_MAX_ZOOM = 1.28;

export const INNER_CITY_ZONE_LABELS: Readonly<Record<InnerCityZone, string>> = {
    core: '中轴宫城',
    civic: '西翼坊市',
    military: '东翼军营',
    defense: '南垣城门',
    suburb: '城郊产区',
};

/**
 * 全城 16 栋建筑在写实中轴对称汉风全景城郭（inner_city_ground.jpg）上的端正对位：
 * - 中轴一线：主城正殿（x=0）→ 汉白玉御道 → 南门城墙主阙（x=0）→ 石拱护城桥；
 * - 北首高台平齐：聚贤府（左）与点将台（右）严格水平对称；
 * - 西翼文治坊市：太学荷塘竹苑、医馆青篷晒药、仓库双木圆仓、商行方正篷肆；
 * - 东翼演武军营：校场方正演武坪、步兵营盾矛列架、弓兵营三靶射场、骑兵营马厩围栏；
 * - 四郊自然产区：西北采石场、西南松林伐木场、南岸金麦农场、东崖轨车铁矿。
 */
export const INNER_CITY_PLOTS: readonly InnerCityPlotSpec[] = [
    // ① 中轴高台宫阙（3 席，严正对称）
    {
        type: 1, fallbackName: '主城', art: 'ui/city_buildings/main_city', zone: 'core',
        nx: 0.000, ny: 0.306, width: 420, height: 250, groundOffsetY: -6, plaqueOffsetY: -42,
        lanternPoints: [
            { rx: -0.24, ry: -0.34, radius: 19 },
            { rx: 0.24, ry: -0.34, radius: 19 },
        ],
        shortcut: { kind: 'overview', label: '营造路线' },
    },
    {
        type: 3, fallbackName: '聚贤府', art: 'ui/city_buildings/recruitment_hall', zone: 'core',
        nx: -0.200, ny: 0.273, width: 280, height: 186, groundOffsetY: -4, plaqueOffsetY: -32,
        shortcut: { kind: 'generals', label: '武将名录' },
    },
    {
        type: 14, fallbackName: '点将台', art: 'ui/city_buildings/command_platform', zone: 'core',
        nx: 0.245, ny: 0.273, width: 290, height: 186, groundOffsetY: -4, plaqueOffsetY: -32,
        shortcut: { kind: 'draw', label: '招贤点将' },
    },

    // ② 西翼文治坊市（4 席，横平竖直）
    {
        type: 8, fallbackName: '太学', art: 'ui/city_buildings/academy', zone: 'civic',
        nx: -0.335, ny: 0.085, width: 320, height: 210, groundOffsetY: -4, plaqueOffsetY: -36,
    },
    {
        type: 7, fallbackName: '医馆', art: 'ui/city_buildings/infirmary', zone: 'civic',
        nx: -0.128, ny: 0.071, width: 310, height: 204, groundOffsetY: -4, plaqueOffsetY: -34,
    },
    {
        type: 13, fallbackName: '仓库', art: 'ui/city_buildings/warehouse', zone: 'civic',
        nx: -0.395, ny: -0.106, width: 280, height: 206, groundOffsetY: -4, plaqueOffsetY: -34,
    },
    {
        type: 15, fallbackName: '商行', art: 'ui/city_buildings/market', zone: 'civic',
        nx: -0.155, ny: -0.130, width: 320, height: 196, groundOffsetY: -4, plaqueOffsetY: -34,
        shortcut: { kind: 'market', label: '资源兑换' },
    },

    // ③ 东翼演武军营（4 席，方正军阵）
    {
        type: 2, fallbackName: '校场', art: 'ui/city_buildings/drill_ground', zone: 'military',
        nx: 0.145, ny: 0.061, width: 340, height: 214, groundOffsetY: -4, plaqueOffsetY: -34,
        shortcut: { kind: 'troops', label: '城防部队' },
    },
    {
        type: 4, fallbackName: '步兵营', art: 'ui/city_buildings/infantry_camp', zone: 'military',
        nx: 0.355, ny: 0.071, width: 320, height: 206, groundOffsetY: -4, plaqueOffsetY: -34,
    },
    {
        type: 6, fallbackName: '弓兵营', art: 'ui/city_buildings/archery_camp', zone: 'military',
        nx: 0.165, ny: -0.121, width: 330, height: 202, groundOffsetY: -4, plaqueOffsetY: -34,
    },
    {
        type: 5, fallbackName: '骑兵营', art: 'ui/city_buildings/cavalry_camp', zone: 'military',
        nx: 0.388, ny: -0.116, width: 320, height: 204, groundOffsetY: -4, plaqueOffsetY: -34,
    },

    // ④ 中轴南门城垣（1 席，与主城垂直一线居中）
    {
        type: 9, fallbackName: '城墙', art: 'ui/city_buildings/city_wall', zone: 'defense',
        nx: 0.000, ny: -0.226, width: 320, height: 200, groundOffsetY: -6, plaqueOffsetY: -32,
        lanternPoints: [{ rx: 0.0, ry: -0.18, radius: 18 }],
    },

    // ⑤ 四郊自然产区（4 席）
    {
        type: 16, fallbackName: '采石场', art: 'ui/city_buildings/quarry', zone: 'suburb',
        nx: -0.395, ny: 0.263, width: 268, height: 196, groundOffsetY: -4, plaqueOffsetY: -26,
    },
    {
        type: 12, fallbackName: '铁矿', art: 'ui/city_buildings/iron_mine', zone: 'suburb',
        nx: 0.435, ny: -0.346, width: 256, height: 192, groundOffsetY: -4, plaqueOffsetY: -24,
        lanternPoints: [{ rx: 0.02, ry: 0.02, radius: 22 }],
    },
    {
        type: 11, fallbackName: '伐木场', art: 'ui/city_buildings/lumberyard', zone: 'suburb',
        nx: -0.380, ny: -0.370, width: 264, height: 192, groundOffsetY: -4, plaqueOffsetY: -24,
    },
    {
        type: 10, fallbackName: '农场', art: 'ui/city_buildings/farm', zone: 'suburb',
        nx: -0.155, ny: -0.418, width: 290, height: 170, groundOffsetY: -4, plaqueOffsetY: -18,
    },
];

const PLOT_BY_TYPE = new Map<number, InnerCityPlotSpec>(INNER_CITY_PLOTS.map(spec => [spec.type, spec]));

export function findInnerCityPlot(type: number): InnerCityPlotSpec | undefined {
    return PLOT_BY_TYPE.get(type);
}

/** 将归一化地块坐标转换为全景画布像素坐标（中心为 0,0）。 */
export function plotCanvasPosition(
    spec: Pick<InnerCityPlotSpec, 'nx' | 'ny'>,
    canvasW = INNER_CITY_CANVAS_WIDTH,
    canvasH = INNER_CITY_CANVAS_HEIGHT,
): { x: number; y: number } {
    return {
        x: Math.round(spec.nx * canvasW),
        y: Math.round(spec.ny * canvasH),
    };
}

/** 2.5D 深度排序：北侧（ny 较大）先绘制，南侧（ny 较小）后绘制形成自然前景遮挡。 */
export function sortedPlotOrder(specs: readonly InnerCityPlotSpec[] = INNER_CITY_PLOTS): InnerCityPlotSpec[] {
    return specs.slice().sort((a, b) => b.ny - a.ny || a.nx - b.nx);
}

/** 计算使全景底图始终铺满屏幕、不露黑边的最小允许缩放倍率。 */
export function computeMinZoom(
    viewW: number,
    viewH: number,
    canvasW = INNER_CITY_CANVAS_WIDTH,
    canvasH = INNER_CITY_CANVAS_HEIGHT,
): number {
    if (viewW <= 0 || viewH <= 0) return INNER_CITY_MIN_ZOOM;
    const coverZoom = Math.max(viewW / canvasW, viewH / canvasH);
    return Math.max(INNER_CITY_MIN_ZOOM, Math.min(INNER_CITY_MAX_ZOOM, coverZoom));
}

/** 计算进入内城时的全景初始倍率：一进城即端正完整俯瞰整座中轴汉城。 */
export function computeInitialZoom(
    viewW: number,
    viewH: number,
    canvasW = INNER_CITY_CANVAS_WIDTH,
    canvasH = INNER_CITY_CANVAS_HEIGHT,
): number {
    const minZoom = computeMinZoom(viewW, viewH, canvasW, canvasH);
    const preferred = viewW < 820 ? 0.56 : 0.52;
    return Math.min(INNER_CITY_MAX_ZOOM, Math.max(minZoom, preferred));
}

/** 约束画布平移量，确保视口边缘永远落在全景城郭之内。 */
export function clampCameraOffset(
    panX: number,
    panY: number,
    zoom: number,
    viewW: number,
    viewH: number,
    canvasW = INNER_CITY_CANVAS_WIDTH,
    canvasH = INNER_CITY_CANVAS_HEIGHT,
): { x: number; y: number } {
    const scaledW = canvasW * zoom;
    const scaledH = canvasH * zoom;
    const maxX = Math.max(0, (scaledW - viewW) * 0.5);
    const maxY = Math.max(0, (scaledH - viewH) * 0.5);
    return {
        x: Math.max(-maxX, Math.min(maxX, panX)),
        y: Math.max(-maxY, Math.min(maxY, panY)),
    };
}

/**
 * 计算聚焦某个建筑时的目标画布平移量。
 * - 当右侧详情抽屉展开时，自动将目标建筑摆放在抽屉左侧可视区黄金中心；
 * - 常规仅弹出建筑下方悬浮操作条时，略微抬高建筑以便下方操作圆钮舒展呈现。
 */
export function computeFocusPan(
    spec: Pick<InnerCityPlotSpec, 'nx' | 'ny'>,
    zoom: number,
    viewW: number,
    viewH: number,
    rightDrawerWidth: number,
    canvasW = INNER_CITY_CANVAS_WIDTH,
    canvasH = INNER_CITY_CANVAS_HEIGHT,
): { x: number; y: number } {
    const pos = plotCanvasPosition(spec, canvasW, canvasH);
    const visualShiftX = rightDrawerWidth > 0 ? -rightDrawerWidth * 0.48 : 0;
    const visualShiftY = rightDrawerWidth > 0 ? -12 : 42;
    const desiredX = visualShiftX - pos.x * zoom;
    const desiredY = visualShiftY - pos.y * zoom;
    return clampCameraOffset(desiredX, desiredY, zoom, viewW, viewH, canvasW, canvasH);
}
