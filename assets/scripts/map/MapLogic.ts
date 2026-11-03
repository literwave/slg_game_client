import { _decorator, Component, TiledMap, Camera, Node, Vec2, UITransform, EventMouse, EventTouch, Vec3, view, isValid } from 'cc';
const { ccclass } = _decorator;

import MapCommand from "./MapCommand";
import MapUtil from "./MapUtil";
import { EventMgr } from '../utils/EventMgr';
import { LogicEvent } from '../common/LogicEvent';
import WorldStrategicMap from './WorldStrategicMap';

// 进场展示主城与周边地块；最近缩放和内城视角独立配置。
const DEFAULT_MAP_HEIGHT = 450;
const CLOSE_UP_HEIGHT = 192;
const CITY_VIEW_HEIGHT = 300;
const WHEEL_GESTURE_GAP = 180;
const WHOLE_MAP_ZOOM_LEVEL = 4;

@ccclass('MapLogic')
export default class MapLogic extends Component {
    protected _cmd: MapCommand;
    protected _tiledMap: TiledMap = null;
    protected _mapCamera: Camera = null;
    protected _isTouch: boolean = false;
    protected _isMove: boolean = false;
    protected _orthoHeight:number = DEFAULT_MAP_HEIGHT;
    private _targetHeight = DEFAULT_MAP_HEIGHT;
    private _zooming = false;
    private _zoomAnchor = new Vec2();
    private _zoomLevel = 1;
    // 显式定位时，全图也以目标为中心；下一次主动缩放再恢复总览居中。
    private _wholeMapFocus: Vec2 = null;
    private _cityReturnHeight: number = null;
    private _cityReturnLevel = 1;
    private _cityFocusPoint: Vec2 = null;
    private _wheelDirection = 0;
    private _wheelDelta = 0;
    private _lastWheelEvent = -Infinity;
    private _lastWheelStep = -Infinity;
    private _smallWheelStepped = false;
    private _touchPoints = new Map<number, Vec2>();
    private _pinchDistance = 0;
    private _pinchStepped = false;
    private _suppressTouchClick = false;

    // 相机中心限制在四个角格的连线内，边缘地块仍然可以完整查看。
    private _cameraBoundary: Vec2[] = [];
    private _clampedCameraPoint: Vec2 = new Vec2();
    private _activeTouchId: number = null;
    private _touchOrigin = new Vec2();
    private _inputNode: Node = null;

    protected _touchAniNode: Node = null;
    protected _centerPoint: Vec2 = null;

    // 拖动输入按帧合并，避免一帧内多次刷新 TiledMap 裁剪
    protected _pendingCameraX: number = 0;
    protected _pendingCameraY: number = 0;
    protected _moveDirty: boolean = false;
    protected _tempCameraPos: Vec3 = new Vec3();
    protected _lastCenterSyncTime: number = 0;

    
    protected onLoad(): void {
        console.log("MapLogic onLoad");
        this._cmd = MapCommand.getInstance();
        this._mapCamera = this.node.parent.getChildByName("Map Camera").getComponent(Camera);
   
        // 每次进场恢复默认视野，不把上次的近景比例继续叠加。
        this._mapCamera.orthoHeight = this._orthoHeight;
        this._targetHeight = this._orthoHeight;

        EventMgr.on(LogicEvent.openCityAbout, this.openCityAbout, this);
        EventMgr.on(LogicEvent.closeCityAbout, this.closeCityAbout, this);

    }

    protected onDestroy(): void {
        EventMgr.targetOff(this);
        if (isValid(this._inputNode)) this._inputNode.targetOff(this);
        view.off('canvas-resize', this.onViewportResize, this);
        view.off('design-resolution-changed', this.onViewportResize, this);
        this._touchPoints.clear();
        this._cmd = null;
    }

    public setTiledMap(tiledMap: TiledMap): void {
        if (isValid(this._inputNode)) this._inputNode.targetOff(this);
        this._tiledMap = tiledMap;
        // 原创底图向外延展；雾区和岸线也能开始拖动，坐标换算仍使用逻辑地图尺寸。
        this._inputNode = tiledMap.node.getChildByName('OriginalGround') || tiledMap.node;
        this._tiledMap.enableCulling = true;
        const size = tiledMap.getMapSize();
        this._cameraBoundary = [new Vec2(0, 0), new Vec2(size.width - 1, 0),
            new Vec2(size.width - 1, size.height - 1), new Vec2(0, size.height - 1)]
            .map(point => MapUtil.mapCellToPixelPoint(point));
        view.off('canvas-resize', this.onViewportResize, this);
        view.off('design-resolution-changed', this.onViewportResize, this);
        view.on('canvas-resize', this.onViewportResize, this);
        view.on('design-resolution-changed', this.onViewportResize, this);
        this.updateCulling();
        this._inputNode.on(Node.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
        this._inputNode.on(Node.EventType.TOUCH_START, this.onTouchBegan, this);
        this._inputNode.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this._inputNode.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this._inputNode.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    protected openCityAbout(data: any): void {
        this._cityReturnLevel = this.nearestZoomIndex(this._zooming ? this._targetHeight : this._mapCamera.orthoHeight);
        this._cityReturnHeight = this.zoomHeights()[this._cityReturnLevel];
        this._cityFocusPoint = new Vec2(data.x, data.y);
        this._zooming = false;
        this._mapCamera.orthoHeight = this.cityViewHeight();
        this._targetHeight = this._mapCamera.orthoHeight;
        this.scrollToMapPoint(this._cityFocusPoint);
    }

    protected closeCityAbout(): void {
        const city = this._cityFocusPoint;
        this._cityFocusPoint = null;
        this._zoomLevel = this._cityReturnLevel;
        this._mapCamera.orthoHeight = this.zoomHeights()[this._zoomLevel];
        this._targetHeight = this._mapCamera.orthoHeight;
        this._cityReturnHeight = null;
        if (this.isWholeMapView()) this.focusMapPoint(this.wholeMapCell());
        else if (city) this.scrollToMapPoint(city);
        this.updateCulling();
        this.syncCenterMapCellPoint();
    }

    private cityViewHeight(): number {
        const { width, height } = view.getVisibleSize();
        const deck = height < 500 ? 176 : 214;
        return Math.max(CITY_VIEW_HEIGHT, 620 * height / Math.max(1, width - 48) / 2,
            290 * height / Math.max(1, height - deck - 100) / 2);
    }

    protected onMouseWheel(event: EventMouse): void {
        const scroll = event.getScrollY();
        if (!scroll || !this._mapCamera || this._isTouch || this._cityReturnHeight !== null) return;
        event.propagationStopped = true;
        const now = Date.now(), direction = scroll < 0 ? 1 : -1;
        const reversed = this._wheelDirection !== direction;
        if (reversed || now - this._lastWheelEvent > WHEEL_GESTURE_GAP) {
            this._wheelDelta = 0; this._smallWheelStepped = false;
        }
        this._wheelDirection = direction; this._lastWheelEvent = now;
        // 鼠标滚轮一格切一档；触控板的一串小增量合并，惯性尾巴不连续跳到全图。
        if (Math.abs(scroll) < 120) {
            if (this._smallWheelStepped) return;
            this._wheelDelta += Math.abs(scroll);
            if (this._wheelDelta < 70) return;
            this._smallWheelStepped = true;
        }
        if (!reversed && now - this._lastWheelStep < 140) return;
        this._lastWheelStep = now;
        this.changeZoomStage(direction, event.getUILocation());
    }

    /** 近景、常用、周边、州域、全图。全图尺寸随横竖屏变化。 */
    public zoomHeights(): number[] {
        const maximum = this.maximumZoomHeight();
        return [CLOSE_UP_HEIGHT, DEFAULT_MAP_HEIGHT, 1600, Math.min(12000, maximum * .45), maximum]
            .sort((a, b) => a - b);
    }

    private nearestZoomIndex(height: number): number {
        const stages = this.zoomHeights();
        let index = 0;
        for (let i = 1; i < stages.length; i++) {
            if (Math.abs(Math.log(stages[i] / height)) < Math.abs(Math.log(stages[index] / height))) index = i;
        }
        return index;
    }

    private changeZoomStage(direction: number, anchor: Vec2): void {
        this.zoomToStage(this._zoomLevel + direction, anchor);
    }

    private isWholeMapView(): boolean {
        return this._cityReturnHeight === null && this._zoomLevel === WHOLE_MAP_ZOOM_LEVEL;
    }

    private wholeMapCell(): Vec2 {
        if (this._wholeMapFocus) return this._wholeMapFocus.clone();
        const cells = this._tiledMap.getMapSize();
        return new Vec2((cells.width - 1) / 2, (cells.height - 1) / 2);
    }

    private zoomToStage(index: number, anchor: Vec2, preserveFocus = false): void {
        if (!preserveFocus) this._wholeMapFocus = null;
        this.flushPendingCameraMove();
        const stages = this.zoomHeights();
        this._zoomLevel = Math.max(0, Math.min(stages.length - 1, index));
        this._targetHeight = stages[this._zoomLevel];
        this._zoomAnchor.set(anchor.x, anchor.y);
        this._zooming = Math.abs(this._targetHeight - this._mapCamera.orthoHeight) > .01;
        if (this._zooming) EventMgr.emit(LogicEvent.moveMap);
        else if (this.isWholeMapView()) this.focusMapPoint(this.wholeMapCell());
    }

    private resumeZoomStage(): void {
        if (this._zooming || this._cityReturnHeight !== null) return;
        const size = view.getVisibleSize(), origin = view.getVisibleOrigin();
        this.zoomToStage(this._zoomLevel, new Vec2(origin.x + size.width / 2, origin.y + size.height / 2), true);
    }

    protected update(dt = 1 / 60): void {
        if (!this._mapCamera) return;
        const zoomChanged = this.stepZoom(dt);
        if (!this._moveDirty && !zoomChanged) return;
        if (this._moveDirty) this.applyPendingCameraMove();

        const now = Date.now();
        if (now - this._lastCenterSyncTime >= 80 || (zoomChanged && !this._zooming)) {
            this._lastCenterSyncTime = now;
            this.syncCenterMapCellPoint();
        }
    }

    private stepZoom(dt: number): boolean {
        if (!this._zooming) return false;
        const before = this.viewPointToWorldPoint(this._zoomAnchor);
        const current = this._mapCamera.orthoHeight;
        let height = current + (this._targetHeight - current) * (1 - Math.exp(-22 * Math.min(dt, .1)));
        if (Math.abs(height - this._targetHeight) < Math.max(.15, this._targetHeight * .001)) {
            height = this._targetHeight; this._zooming = false;
        }
        this._mapCamera.orthoHeight = height;
        const after = this.viewPointToWorldPoint(this._zoomAnchor);
        const camera = this._mapCamera.node.position;
        const clamped = this.clampCameraPoint(camera.x + before.x - after.x, camera.y + before.y - after.y);
        // 接近全图档时逐步居中，保证最大档看到整张地图而非只看到一侧。
        const whole = this.isWholeMapView() ? Math.max(0, Math.min(1, (height / this.maximumZoomHeight() - .65) / .35)) : 0;
        if (whole > 0) {
            const center = MapUtil.mapCellToPixelPoint(this.wholeMapCell());
            clamped.x += (center.x - clamped.x) * whole;
            clamped.y += (center.y - clamped.y) * whole;
        }
        this._pendingCameraX = clamped.x; this._pendingCameraY = clamped.y; this._moveDirty = true;
        return true;
    }

    private applyPendingCameraMove(): void {
        this._moveDirty = false;
        this._tempCameraPos.set(this._pendingCameraX, this._pendingCameraY, this._mapCamera.node.position.z);
        this._mapCamera.node.setPosition(this._tempCameraPos);
        this.updateCulling();
    }

    private syncCenterMapCellPoint(): void {
        const pixelPoint = new Vec2(this._pendingCameraX, this._pendingCameraY);
        this.setCenterMapCellPoint(MapUtil.mapPixelToCellPoint(pixelPoint), pixelPoint);
    }

    private flushPendingCameraMove(): void {
        if (!this._moveDirty || !this._mapCamera) {
            return;
        }
        this.applyPendingCameraMove();
        this._lastCenterSyncTime = Date.now();
        this.syncCenterMapCellPoint();
    }

    protected onTouchMove(event: EventTouch): void {
        const tracked = this._touchPoints.get(event.getID());
        if (tracked) {
            const point = event.getUILocation(); tracked.set(point.x, point.y);
        }
        if (this._suppressTouchClick) {
            if (this._touchPoints.size < 2 || this._pinchStepped) return;
            const [a, b] = Array.from(this._touchPoints.values());
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            if (this._pinchDistance < 16) { this._pinchDistance = distance; return; }
            if (Math.abs(distance - this._pinchDistance) < 18) return;
            const ratio = distance / this._pinchDistance;
            if (ratio > 1.18 || ratio < .84) {
                this._pinchStepped = true;
                this.changeZoomStage(ratio > 1 ? -1 : 1, new Vec2((a.x + b.x) / 2, (a.y + b.y) / 2));
            }
            return;
        }
        if (this._isTouch && event.getID() === this._activeTouchId) {
            const delta = event.getUIDelta();
            if (!this._isMove) {
                const point = event.getUILocation();
                const dx = point.x - this._touchOrigin.x, dy = point.y - this._touchOrigin.y;
                // 点击时的小幅手抖不触发行军地图拖动；越过阈值后补齐累计位移。
                if (dx * dx + dy * dy < 36) return;
                delta.set(dx, dy);
            }
            if (delta.x != 0 || delta.y != 0) {
                this._isMove = true;
                // 全图只允许选区放大；拖动仍记为手势，松手不能误触发选区点击。
                if (this.isWholeMapView()) return;
                const scale = this.worldUnitsPerUIUnit();
                const point = this.clampCameraPoint(this._pendingCameraX - delta.x * scale,
                    this._pendingCameraY - delta.y * scale);
                this._pendingCameraX = point.x;
                this._pendingCameraY = point.y;
                this._moveDirty = true;
            }
        }
    }

    protected onTouchBegan(event: EventTouch): void {
        if (this._touchPoints.size >= 2 || this._isTouch && this._cityReturnHeight !== null) return;
        const touch = event.getUILocation();
        this._touchPoints.set(event.getID(), new Vec2(touch.x, touch.y));
        if (this._touchPoints.size === 2) {
            this.flushPendingCameraMove();
            const [a, b] = Array.from(this._touchPoints.values());
            this._pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
            this._pinchStepped = false;
            this._suppressTouchClick = true;
            this._isMove = true;
            this._activeTouchId = null;
            return;
        }
        this._activeTouchId = event.getID();
        this._touchOrigin.set(touch.x, touch.y);
        this._isTouch = true;
        this.flushPendingCameraMove();
        if (this._cityReturnHeight === null) {
            this._zoomLevel = this.nearestZoomIndex(this._zooming ? this._targetHeight : this._mapCamera.orthoHeight);
            this._targetHeight = this.zoomHeights()[this._zoomLevel];
        }
        // 缩向全图时继续完成居中动画，按住鼠标或手指不能停在半途。
        if (!this.isWholeMapView()) this._zooming = false;
        this._isMove = false;
        this._moveDirty = false;
        let pos = this._mapCamera.node.position;
        this._pendingCameraX = pos.x;
        this._pendingCameraY = pos.y;
    }

    protected onTouchEnd(event: EventTouch): void {
        this._touchPoints.delete(event.getID());
        if (this.finishPinch()) return;
        if (!this._isTouch || event.getID() !== this._activeTouchId) return;
        this._isTouch = false;
        this._activeTouchId = null;
        this.flushPendingCameraMove();
        if (this._isMove == false) {
            let touchLocation: Vec2 = event.touch.getUILocation();
            let touchLocation1 = this.viewPointToWorldPoint(touchLocation);
            let mapPoint: Vec2 = MapUtil.worldPixelToMapCellPoint(touchLocation1);
            // 云层区域不派发地图地块点击。
            if (!MapUtil.isVaildCellPoint(mapPoint)) { this.resumeZoomStage(); return; }
            if (this._cmd.proxy.strategic) {
                const overview = this._tiledMap.node.getComponent(WorldStrategicMap), pixel = this.worldToMapPixelPoint(touchLocation1);
                const home = overview?.pickHome?.(pixel), city = home ? null : overview?.pickCity?.(pixel);
                const landmark = home || city || overview?.pickGate(pixel);
                // 洛阳占地更广，保留完整城墙；其它城池和关口使用近景档。
                const next = home ? 1 : city ? (city.level >= 8 ? 2 : 1) : landmark ? 1 : this.nearestZoomIndex(this._mapCamera.orthoHeight) - 1;
                const size = view.getVisibleSize(), origin = view.getVisibleOrigin();
                const focus = landmark ? new Vec2(landmark.x, landmark.y) : mapPoint;
                if (home) this.scrollToMapPoint(focus, 'player-city');
                else {
                    this.zoomToStage(next, new Vec2(origin.x + size.width / 2, origin.y + size.height / 2));
                    this.focusMapPoint(focus);
                }
                if (landmark) {
                    const center = MapUtil.mapCellToPixelPoint(focus);
                    EventMgr.emit(LogicEvent.touchMap, focus, center, center);
                }
                return;
            }
            let clickCenterPoint: Vec2 = MapUtil.mapCellToPixelPoint(mapPoint);
            //派发事件
            // console.log("onTouchEnd:", touchLocation1, clickCenterPoint);

            EventMgr.emit(LogicEvent.touchMap, mapPoint, clickCenterPoint, this.worldToMapPixelPoint(touchLocation1));
        } else {
            EventMgr.emit(LogicEvent.moveMap);
        }
        this._isMove = false;
        this.resumeZoomStage();
    }

    protected onTouchCancel(event: EventTouch): void {
        this._touchPoints.delete(event.getID());
        if (this.finishPinch()) return;
        if (event.getID() !== this._activeTouchId) return;
        this._isTouch = false;
        this._activeTouchId = null;
        this.flushPendingCameraMove();
        this._isMove = false;
        this.resumeZoomStage();
    }

    private finishPinch(): boolean {
        if (!this._suppressTouchClick) return false;
        if (this._touchPoints.size === 0) {
            this._suppressTouchClick = false; this._pinchStepped = false;
            this._isTouch = false; this._activeTouchId = null; this._isMove = false;
            this.flushPendingCameraMove(); this.resumeZoomStage();
        }
        return true;
    }

    //界面坐标转世界坐标
    protected viewPointToWorldPoint(point: Vec2): Vec2 {
        const uit = this._tiledMap.node.getComponent(UITransform);
        const visible = view.getVisibleSize();
        const origin = view.getVisibleOrigin();
        const scale = this.worldUnitsPerUIUnit();
        const camera = this._mapCamera.node.position;
        return new Vec2(uit.width * uit.anchorX + camera.x + (point.x - origin.x - visible.width * 0.5) * scale,
            uit.height * uit.anchorY + camera.y + (point.y - origin.y - visible.height * 0.5) * scale);
    }

    private worldUnitsPerUIUnit(): number {
        return this._mapCamera.orthoHeight * 2 / Math.max(1, view.getVisibleSize().height);
    }

    /** 最远容纳整张菱形地图，横竖屏均留出HUD边距。 */
    public maximumZoomHeight(): number {
        if (!this._tiledMap) return this._orthoHeight * 4;
        const cells = this._tiledMap.getMapSize(), tile = this._tiledMap.getTileSize();
        const viewport = view.getVisibleSize(), aspect = viewport.width / Math.max(1, viewport.height);
        const width = (cells.width + cells.height) * tile.width * .5;
        const height = (cells.width + cells.height) * tile.height * .5;
        return Math.max(this._orthoHeight * 4, Math.max(height / 2, width / 2 / aspect) * 1.16);
    }

    private clampCameraPoint(x: number, y: number): Vec2 {
        const result = this._clampedCameraPoint;
        result.set(x, y);
        if (this._cameraBoundary.length !== 4) return result;
        let inside = true;
        let nearestDistance = Infinity;
        let nearestX = x;
        let nearestY = y;
        for (let i = 0; i < 4; i++) {
            const a = this._cameraBoundary[i];
            const b = this._cameraBoundary[(i + 1) % 4];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            // 四条边为顺时针；越界后投影到最近边，拖动可沿斜边自然滑动。
            if (dx * (y - a.y) - dy * (x - a.x) > 0.001) inside = false;
            const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / Math.max(1, dx * dx + dy * dy)));
            const px = a.x + t * dx;
            const py = a.y + t * dy;
            const distance = (x - px) ** 2 + (y - py) ** 2;
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestX = px;
                nearestY = py;
            }
        }
        if (!inside) result.set(nearestX, nearestY);
        return result;
    }



    //世界坐标转化为相对地图的像素坐标
    protected worldToMapPixelPoint(point: Vec2): Vec2 {
        var uit = this._tiledMap.node.getComponent(UITransform);
        let pixelX: number = point.x - uit.width * uit.anchorX;
        let pixelY: number = point.y - uit.height * uit.anchorY;
        return new Vec2(pixelX, pixelY);
    }

    public scrollToMapPoint(point: Vec2, focus?: 'player-city' | 'preserve-zoom'): void {
        if (focus === 'preserve-zoom') {
            if (this._cityReturnHeight === null) {
                // 列表定位只移动镜头。正在缩放时继续原来的倍率变化，但把锚点移到目标中心。
                if (!this._zooming) this._targetHeight = this._mapCamera.orthoHeight;
                this._zoomLevel = this.nearestZoomIndex(this._targetHeight);
                this._wholeMapFocus = this._zoomLevel === WHOLE_MAP_ZOOM_LEVEL ? point.clone() : null;
                const size = view.getVisibleSize(), origin = view.getVisibleOrigin();
                this._zoomAnchor.set(origin.x + size.width / 2, origin.y + size.height / 2);
            }
            this.focusMapPoint(point);
            return;
        }
        if (this._cityReturnHeight === null) {
            this._wholeMapFocus = null;
            // 主城入口直接使用可操作的近景档，不沿用全图/区域档或滚轮的未完成目标。
            this._zoomLevel = focus === 'player-city' ? 1
                : this.nearestZoomIndex(this._zooming ? this._targetHeight : this._mapCamera.orthoHeight);
            // 普通坐标定位保持原有缩放规则。
            if (this.isWholeMapView()) this._zoomLevel--;
            this._mapCamera.orthoHeight = this.zoomHeights()[this._zoomLevel];
        }
        this._zooming = false;
        this._targetHeight = this._mapCamera.orthoHeight;
        this.focusMapPoint(point);
    }

    private focusMapPoint(point: Vec2): void {
        let temp = this.toCameraPoint(point);
        if (this._cityFocusPoint) {
            const height = view.getVisibleSize().height;
            const deck = height < 500 ? 176 : 214;
            temp.y -= (deck - 76) * this._mapCamera.orthoHeight / height;
        }
        this._mapCamera.node.setPosition(temp.x, temp.y, this._mapCamera.node.position.z);
        // 相机监听尚未绑定时（进图首帧）也要立刻重算一次裁剪区
        this.updateCulling();

        this._pendingCameraX = temp.x;
        this._pendingCameraY = temp.y;
        this._moveDirty = false;
        this._lastCenterSyncTime = Date.now();

        this.syncCenterMapCellPoint();
    }

    protected setCenterMapCellPoint(point: Vec2, pixelPoint: Vec2): void {
        const visible = view.getVisibleSize();
        const halfHeight = this._mapCamera.orthoHeight;
        this._cmd.proxy.setCurCenterPoint(point, pixelPoint,
            new Vec2(halfHeight * visible.width / Math.max(1, visible.height), halfHeight));
    }

    private updateCulling() {
        if (this._tiledMap) {
            // 连续地形自行裁剪；空的坐标容器无需每次拖动强制更新矩阵、派发整棵树的变换事件。
            if (this._tiledMap.getLayers().length === 0) return;
            // 节点位置事件先于渲染相机矩阵更新，必须先更新投影再裁剪，避免快拖时整块地面消失。
            this._mapCamera?.camera?.update(true);
            this._tiledMap.node.emit(Node.EventType.TRANSFORM_CHANGED);
        }
    }

    private onViewportResize(): void {
        if (this._cityFocusPoint && this._mapCamera) {
            this._mapCamera.orthoHeight = this.cityViewHeight();
            this.scrollToMapPoint(this._cityFocusPoint);
        } else if (this._mapCamera) {
            this._targetHeight = this.zoomHeights()[this._zoomLevel];
            this._mapCamera.orthoHeight = this._targetHeight;
            this._zooming = false;
            if (this.isWholeMapView() && this._tiledMap && this._cmd) {
                this.focusMapPoint(this.wholeMapCell());
                return;
            }
        }
        this.updateCulling();
        if (!this._tiledMap || !this._mapCamera || !this._cmd) return;
        const position = this._mapCamera.node.position;
        this._pendingCameraX = position.x; this._pendingCameraY = position.y;
        this.syncCenterMapCellPoint();
    }

 
    public curCameraPoint():Vec2 {
        let pos = this._mapCamera.node.position;
        return new Vec2(pos.x, pos.y);
    }


    public toCameraPoint(point: Vec2) {
        let pixelPoint: Vec2 = MapUtil.mapCellToPixelPoint(point);
        return this.clampCameraPoint(pixelPoint.x, pixelPoint.y).clone();
    }
}
