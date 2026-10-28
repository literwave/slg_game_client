import { _decorator, Component, TiledMap, Camera, Node, Vec2, UITransform, EventMouse, EventTouch, Vec3, view, isValid } from 'cc';
const { ccclass } = _decorator;

import MapCommand from "./MapCommand";
import MapUtil from "./MapUtil";
import { EventMgr } from '../utils/EventMgr';
import { LogicEvent } from '../common/LogicEvent';

// 进场展示主城与周边地块；最近缩放和内城视角独立配置。
const DEFAULT_MAP_HEIGHT = 600;
const CLOSE_UP_HEIGHT = 192;
const CITY_VIEW_HEIGHT = 300;

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
    private _cityReturnHeight: number = null;
    private _cityFocusPoint: Vec2 = null;

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
        this._cityReturnHeight = this._mapCamera.orthoHeight;
        this._cityFocusPoint = new Vec2(data.x, data.y);
        this._zooming = false;
        this._mapCamera.orthoHeight = this.cityViewHeight();
        this._targetHeight = this._mapCamera.orthoHeight;
        this.scrollToMapPoint(this._cityFocusPoint);
    }

    protected closeCityAbout(): void {
        const city = this._cityFocusPoint;
        this._cityFocusPoint = null;
        this._mapCamera.orthoHeight = this._cityReturnHeight ?? this._orthoHeight;
        this._targetHeight = this._mapCamera.orthoHeight;
        this._cityReturnHeight = null;
        if (city) this.scrollToMapPoint(city);
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
        this.flushPendingCameraMove();
        if (!this._zooming) this._targetHeight = this._mapCamera.orthoHeight;
        // Creator Web 的滚轮量是 DOM deltaY 的 -5 倍；向上放大，触控板小增量也保留。
        const step = Math.max(-.38, Math.min(.38, -scroll * .00055));
        this._targetHeight = Math.max(CLOSE_UP_HEIGHT,
            Math.min(this.maximumZoomHeight(), this._targetHeight * Math.exp(step)));
        const anchor = event.getUILocation();
        this._zoomAnchor.set(anchor.x, anchor.y);
        this._zooming = Math.abs(this._targetHeight - this._mapCamera.orthoHeight) > .01;
        if (this._zooming) EventMgr.emit(LogicEvent.moveMap);
        event.propagationStopped = true;
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
        let height = current + (this._targetHeight - current) * (1 - Math.exp(-14 * Math.min(dt, .1)));
        if (Math.abs(height - this._targetHeight) < .15) { height = this._targetHeight; this._zooming = false; }
        this._mapCamera.orthoHeight = height;
        const after = this.viewPointToWorldPoint(this._zoomAnchor);
        const camera = this._mapCamera.node.position;
        const clamped = this.clampCameraPoint(camera.x + before.x - after.x, camera.y + before.y - after.y);
        // 接近全图档时逐步居中，保证最大档看到整张地图而非只看到一侧。
        const whole = Math.max(0, Math.min(1, (height / this.maximumZoomHeight() - .65) / .35));
        if (whole > 0) {
            const cells = this._tiledMap.getMapSize();
            const center = MapUtil.mapCellToPixelPoint(new Vec2((cells.width - 1) / 2, (cells.height - 1) / 2));
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
        if (this._isTouch) return;
        this._activeTouchId = event.getID();
        const touch = event.getUILocation();
        this._touchOrigin.set(touch.x, touch.y);
        this._isTouch = true;
        this._zooming = false;
        this._targetHeight = this._mapCamera.orthoHeight;
        this._isMove = false;
        this._moveDirty = false;
        let pos = this._mapCamera.node.position;
        this._pendingCameraX = pos.x;
        this._pendingCameraY = pos.y;
    }

    protected onTouchEnd(event: EventTouch): void {
        if (!this._isTouch || event.getID() !== this._activeTouchId) return;
        this._isTouch = false;
        this._activeTouchId = null;
        this.flushPendingCameraMove();
        if (this._isMove == false) {
            let touchLocation: Vec2 = event.touch.getUILocation();
            let touchLocation1 = this.viewPointToWorldPoint(touchLocation);
            let mapPoint: Vec2 = MapUtil.worldPixelToMapCellPoint(touchLocation1);
            // 云层区域不派发地图地块点击。
            if (!MapUtil.isVaildCellPoint(mapPoint)) return;
            if (this._cmd.proxy.strategic) {
                const next = Math.max(2400, this._mapCamera.orthoHeight / 4);
                this.scrollToMapPoint(mapPoint);
                const size = view.getVisibleSize(), origin = view.getVisibleOrigin();
                this._zoomAnchor.set(origin.x + size.width / 2, origin.y + size.height / 2);
                this._targetHeight = next; this._zooming = true;
                EventMgr.emit(LogicEvent.moveMap);
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
    }

    protected onTouchCancel(event: EventTouch): void {
        if (event.getID() !== this._activeTouchId) return;
        this._isTouch = false;
        this._activeTouchId = null;
        this.flushPendingCameraMove();
        this._isMove = false;
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

    public scrollToMapPoint(point: Vec2): void {
        this._zooming = false;
        this._targetHeight = this._mapCamera.orthoHeight;
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
            // 节点位置事件先于渲染相机矩阵更新，必须先更新投影再裁剪，避免快拖时整块地面消失。
            this._mapCamera?.camera?.update(true);
            this._tiledMap.node.emit(Node.EventType.TRANSFORM_CHANGED);
        }
    }

    private onViewportResize(): void {
        if (this._cityFocusPoint && this._mapCamera) {
            this._mapCamera.orthoHeight = this.cityViewHeight();
            this.scrollToMapPoint(this._cityFocusPoint);
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
