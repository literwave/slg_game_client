import type { AmbientPoint, CityAmbientLayout } from './CityAmbientRoutes';

const road = (...points: AmbientPoint[]): AmbientPoint[] => points.map(([x,y]): AmbientPoint => [x / 1040, y / 650]);
const gridRoad = (...points: AmbientPoint[]): AmbientPoint[] => points.map(([x,y]): AmbientPoint => [x / 1040, y / 520]);
const polygon = (...points: AmbientPoint[]): AmbientPoint[] => points;
// 原版主城画布为 1546×1017；遮挡系统使用 1040×650 的统一坐标。
const originalRoad = (...points: AmbientPoint[]): AmbientPoint[] => points.map(([x,y]): AmbientPoint => [x / 1546, y / 1017]);
const originalPolygon = (...points: AmbientPoint[]): AmbientPoint[] => points.map(([x,y]): AmbientPoint => [x * 1040 / 1546, y * 650 / 1017]);

// 每个阶段都沿各自的石板路标定，避开城墙、建筑和门楼。
const GRID_CITY_ROADS: Record<string, readonly (readonly AmbientPoint[])[]> = {
    'player-city-grid-01': [[[448,239],[464,247],[480,255]], [[530,282],[546,290],[562,298]], [[610,326],[626,334],[642,342]]],
    'player-city-grid-10-wall-v2': [[[450,238],[466,246],[482,254]], [[540,285],[556,293],[572,301]], [[625,332],[641,340],[657,348]]],
    'player-city-grid-15': [[[448,225],[460,231],[472,237]], [[535,286],[551,294],[567,302]], [[620,334],[636,342],[652,350]]],
    'player-city-grid-20': [[[448,225],[460,231],[472,237]], [[535,286],[551,294],[567,302]], [[620,334],[636,342],[652,350]]],
    'player-city-grid-25': [[[490,260],[500,265],[510,270]], [[550,294],[564,301],[578,308]], [[620,334],[636,342],[652,350]]],
    'player-city-grid-30': [[[490,260],[500,265],[510,270]], [[550,294],[564,301],[578,308]], [[620,334],[636,342],[652,350]]],
};

/** 主城人物路线按各自的原画标定，不借用其他城图的道路。 */
export function playerCityAmbientLayout(art: string, x: number, y: number): {
    activity: CityAmbientLayout; occluders: readonly (readonly AmbientPoint[])[];
} | null {
    const gridRoads = GRID_CITY_ROADS[art];
    if (gridRoads) return {
        activity: { drill: [550 / 1040, 294 / 520], trainees: 0, patrollers: 6, patrolDistrictCounts: [2,2,2],
            seed: (Math.imul(x,1009) ^ Math.imul(y,9176)) >>> 0,
            roads: gridRoads.map(points => gridRoad(...points)) },
        occluders: [],
    };
    if (art === 'player-city-arrow-10') {
        return {
            activity: { drill: [580 / 1040, 380 / 650], trainees: 0, patrollers: 6, patrolDistrictCounts: [2,2,2],
                seed: (Math.imul(x,1009) ^ Math.imul(y,9176)) >>> 0, roads: [
                    road([555,324],[570,334],[585,345]),
                    road([611,363],[627,374],[642,385]),
                    road([517,422],[532,433],[547,444]),
                ] },
            occluders: [],
        };
    }
    if (art === 'player-city-stage-10') {
        return {
            activity: { drill: [580 / 1040, 380 / 650], trainees: 0, patrollers: 6, patrolDistrictCounts: [2,2,2],
                seed: (Math.imul(x,1009) ^ Math.imul(y,9176)) >>> 0, roads: [
                    road([555,325],[571,337],[587,349]),
                    road([590,359],[605,371],[619,382]),
                    road([532,409],[548,421],[564,433]),
                ] },
            occluders: [],
        };
    }
    if (art === 'player-city-rework-fit-10') {
        return {
            activity: { drill: [580 / 1040, 390 / 650], trainees: 0, patrollers: 6, patrolDistrictCounts: [2,2,2],
                seed: (Math.imul(x,1009) ^ Math.imul(y,9176)) >>> 0, roads: [
                    road([550,349],[570,357],[589,365]),
                    road([581,378],[596,386],[610,394]),
                    road([545,419],[560,429],[575,439]),
                ] },
            occluders: [],
        };
    }
    if (art === 'player_city_lv10') {
        return {
            activity: { drill: [810 / 1546, 530 / 1017], trainees: 0, patrollers: 6, patrolDistrictCounts: [2,2,2],
                seed: (Math.imul(x,1009) ^ Math.imul(y,9176)) >>> 0, roads: [
                    originalRoad([725,445],[765,448],[805,450]),
                    originalRoad([835,518],[865,529],[892,540]),
                    originalRoad([782,610],[813,615],[845,620]),
                ] },
            occluders: [
                originalPolygon([465,249],[667,140],[818,245],[814,327],[719,386],[611,443],[475,361]),
                originalPolygon([648,565],[714,528],[788,566],[791,608],[731,642],[660,604]),
                originalPolygon([889,590],[1035,514],[1137,568],[1135,638],[1021,704],[905,653]),
                originalPolygon([925,473],[982,440],[1056,476],[1051,520],[995,554],[930,522]),
            ],
        };
    }
    if (art !== 'player-city-lv10-courtyard-v6') return null;
    return {
        activity: { drill: [.5,.55], trainees: 0, patrollers: 6, patrolDistrictCounts: [2,2,2],
            seed: (Math.imul(x,1009) ^ Math.imul(y,9176)) >>> 0, roads: [
                road([516,350],[550,375],[588,401],[614,418]),
                road([550,375],[574,361],[611,390],[588,401]),
                road([524,468],[549,489],[582,510]),
                road([164,319],[188,303],[211,286]),
            ] },
        occluders: [
            polygon([220,219],[470,76],[603,158],[604,246],[539,283],[536,308],[486,342],[351,375],[224,302]),
            polygon([176,336],[217,299],[444,441],[435,465],[439,496],[392,523],[189,390]),
            polygon([605,197],[653,144],[860,288],[851,310],[852,348],[807,378],[611,250]),
            polygon([613,433],[721,375],[788,408],[780,433],[783,492],[697,557],[644,520],[640,467]),
            polygon([375,384],[405,357],[432,386],[477,402],[501,447],[473,463],[388,412]),
            polygon([581,291],[618,265],[641,292],[672,299],[716,358],[716,379],[673,368],[589,310]),
            polygon([468,552],[517,504],[566,548],[566,600],[517,633],[471,601]),
        ],
    };
}
