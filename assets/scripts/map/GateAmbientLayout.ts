import type { CityArtMatrix } from './CityArtFit';
import type { CityArtLayout } from './CityFootprint';
import type { AmbientPoint, CityAmbientLayout } from './CityAmbientRoutes';
import { GateAppearance, gateArtLayout, gateWidth, gateHeight, GATE_ANCHOR_X, GATE_ANCHOR_Y, BRIDGE_ANCHOR_X, BRIDGE_ANCHOR_Y } from './GateGeometry';

const road = (width: number, height: number, ...points: AmbientPoint[]): AmbientPoint[] =>
    points.map(([x, y]): AmbientPoint => [x / width, y / height]);
// 遮挡器复用城池的 1040×650 标定空间，绘制仍采用各关隘自己的完整画布。
const mask = (width: number, height: number, ...points: AmbientPoint[]): AmbientPoint[] =>
    points.map(([x, y]): AmbientPoint => [x / width * 1040, y / height * 650]);

/** 每关六人，分别安排内院、近门、远门；固定岗哨与往返、随机巡逻共用城内避让逻辑。 */
export function gateAmbientLayout(data: GateAppearance & { x: number; y: number; level: number },
    mirrored: boolean, tileWidth: number, tileHeight: number): {
        activity: CityAmbientLayout; art: CityArtLayout; occluders: readonly (readonly AmbientPoint[])[]; memberSize: number;
    } {
    const bridge = data.crossing === 'bridge', w = bridge ? 1280 : 1536, h = bridge ? 853 : 1024;
    const anchorX = bridge ? BRIDGE_ANCHOR_X : GATE_ANCHOR_X, anchorY = bridge ? BRIDGE_ANCHOR_Y : GATE_ANCHOR_Y;
    const sign = mirrored ? -1 : 1;
    const forward: CityArtMatrix = [sign, 0, -sign * anchorX, 0, -1, 1 - anchorY];
    const inverse: CityArtMatrix = [sign, 0, anchorX, 0, -1, 1 - anchorY];
    const width = gateWidth(data.level, data, tileWidth), height = gateHeight(data.level, data, tileWidth, tileHeight);
    const roads = bridge ? [
        road(w,h,[422,418],[525,392],[614,341]),
        road(w,h,[486,358],[525,392],[576,435]),
        road(w,h,[230,691],[320,640],[384,597]),
        road(w,h,[896,614],[960,657],[1024,691]),
    ] : [
        road(w,h,[614,594],[768,512],[983,389]),
        road(w,h,[691,440],[768,512],[845,553]),
        road(w,h,[614,461],[722,399],[814,348]),
        road(w,h,[522,655],[614,676],[707,727]),
    ];
    const occluders = bridge ? [
        mask(w,h,[512,205],[666,51],[922,256],[858,418],[742,444],[525,290]),
        mask(w,h,[243,307],[307,247],[397,307],[358,392],[269,384]),
        mask(w,h,[576,478],[640,418],[730,478],[691,563],[602,554]),
    ] : [
        mask(w,h,[307,563],[430,461],[630,563],[614,676],[492,717],[323,635]),
        mask(w,h,[399,328],[614,195],[768,287],[753,358],[553,471],[430,399]),
        mask(w,h,[814,430],[876,379],[937,420],[876,471]),
        mask(w,h,[753,625],[1060,451],[1229,532],[1167,614],[891,748],[768,676]),
        mask(w,h,[983,215],[1075,133],[1213,205],[1152,317],[1044,297]),
        mask(w,h,[707,799],[768,737],[845,799],[814,881],[737,881]),
        mask(w,h,[61,430],[123,379],[184,430],[154,492],[77,481]),
        mask(w,h,[707,82],[768,31],[829,82],[799,133],[722,123]),
        mask(w,h,[1352,430],[1413,379],[1475,430],[1444,492],[1367,481]),
    ];
    const fitted = bridge ? null : gateArtLayout(data.level, data, tileWidth, tileHeight);
    // 镜像只改变平面 X；NPC 与贴格材质必须使用同一套四角变换。
    const mirrorForward = (m: CityArtMatrix): CityArtMatrix => [m[0]*sign,m[1]*sign,m[2]*sign,m[3],m[4],m[5]];
    const mirrorInverse = (m: CityArtMatrix): CityArtMatrix => [m[0]*sign,m[1],m[2],m[3]*sign,m[4],m[5]];
    return {
        activity: { drill: roads[0][0], trainees: 0, patrollers: 6, patrolDistrictCounts: [2,2,2],
            seed: (data.x * 1009 + data.y * 9176) >>> 0, roads },
        art: fitted ? { ...fitted, fit: { forward: mirrorForward(fitted.fit.forward), inverse: mirrorInverse(fitted.fit.inverse),
            upperForward: mirrorForward(fitted.fit.upperForward), upperInverse: mirrorInverse(fitted.fit.upperInverse) } }
            : { width, height, anchorX, anchorY, fit: { forward, inverse, upperForward: forward, upperInverse: inverse } },
        occluders, memberSize: Math.min(width * .024, tileWidth * .085),
    };
}
