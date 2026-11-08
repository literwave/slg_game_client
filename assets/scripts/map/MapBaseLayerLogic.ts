import { _decorator, Component, Node, Prefab, NodePool, instantiate } from 'cc';
const { ccclass, property } = _decorator;

import MapCommand from "./MapCommand";
import WorldMapArt from './WorldMapArt';

@ccclass('MapBaseLayerLogic')
export default class MapBaseLayerLogic extends Component {
    @property(Node)
    parentLayer: Node = null;
    @property(Prefab)
    entryPrefab: Prefab = null;

    protected _cmd: MapCommand;
    protected _itemPool: NodePool = new NodePool();
    protected _itemMap: Map<number, Map<number, Node>> = new Map<number, Map<number, Node>>();
    // 离开视野后先移交节点引用，由 MapScene 统一预算逐帧回收。
    protected _retiredItems: Map<number, Map<number, Node>> = new Map();

    protected onLoad(): void {
        this._cmd = MapCommand.getInstance();
    }

    protected onDestroy(): void {
        this._cmd = null;
        this._itemMap.forEach((value: Map<number, Node>, key: number) => {
            value.clear();
        });
        this._itemMap.clear();
        this._itemMap = null;
        this._retiredItems.clear();
        this._itemPool.clear();
        this._itemPool = null;
    }

    public addItem(areaIndex: number, data: any): Node {
        if (!data) return null;
        if (this._itemMap.has(areaIndex)) {
            let id: number = this.getIdByData(data);
            let item: Node = this.getItem(areaIndex, id);
            if (item == null) {
                // 快速移回同一区域时直接接回尚未回收的节点，避免重复显示。
                item = this.takeRetiredItem(areaIndex, id) || this.createItem();
                item.parent = this.parentLayer;
                let list: Map<number, Node> = this._itemMap.get(areaIndex);
                list.set(this.getIdByData(data), item);
            }
            this.updateItem(areaIndex, data, item);
            return item;
        }
        return null;
    }

    public updateItem(areaIndex: number, data: any, item: Node = null): void {
        if (!data) return;
        if (this._itemMap.has(areaIndex)) {
            let realItem: Node = item;
            if (item == null) {
                let id: number = this.getIdByData(data);
                realItem = this.getItem(areaIndex, id);
            }
            if (realItem) {
                this.setItemData(realItem, data);
            }
        }
    }

    //子类重写
    public setItemData(item: Node, data: any): void {

    }

    public removeItem(areaIndex: number, id: number): boolean {
        const list = this._itemMap.get(areaIndex);
        if (list && list.has(id)) {
            let item: Node = list.get(id);
            this.recycleNode(item);
            list.delete(id);
            return true;
        }
        const retired = this.takeRetiredItem(areaIndex, id);
        if (retired) {
            this.recycleNode(retired);
            return true;
        }
        return false;
    }

    public getItem(areaIndex: number, id: number): Node {
        let list: Map<number, Node> = this._itemMap.get(areaIndex);
        if (list && list.has(id)) {
            return list.get(id);
        }
        return null;
    }

    protected createItem(): Node {
        if (this._itemPool.size() === 0) this.recycleOneItem();
        if (this._itemPool.size() > 0) {
            return this._itemPool.get();
        }
        let node: Node = instantiate(this.entryPrefab);
        return node;
    }

    public removeArea(areaIndex: number): void {
        if (this._itemMap.has(areaIndex)) {
            const list = this._itemMap.get(areaIndex);
            const retired = this._retiredItems.get(areaIndex);
            if (retired) list.forEach((node, id) => retired.set(id, node));
            else if (list.size > 0) this._retiredItems.set(areaIndex, list);
            this._itemMap.delete(areaIndex);
        }
    }

    private takeRetiredItem(areaIndex: number, id: number): Node {
        const list = this._retiredItems.get(areaIndex);
        if (!list) return null;
        const item = list.get(id);
        if (!item) return null;
        list.delete(id);
        if (list.size === 0) this._retiredItems.delete(areaIndex);
        return item;
    }

    public recycleOneItem(): boolean {
        const area = this._retiredItems.entries().next();
        if (area.done) return false;
        const [areaId, list] = area.value;
        const id = list.keys().next().value;
        const item = this.takeRetiredItem(areaId, id);
        this.recycleNode(item);
        return true;
    }

    private recycleNode(item: Node): void {
        WorldMapArt.unbindTree(item);
        // 池中的节点不保留流式纹理，最多缓存一批近期可复用对象。
        if (this._itemPool.size() >= 64) item.destroy();
        else this._itemPool.put(item);
    }

    public addArea(areaIndex: number): void {
        if (this._itemMap.has(areaIndex) == false) {
            this._itemMap.set(areaIndex, new Map<number, Node>());
        }
    }

    public udpateShowAreas(addIndexs: number[], removeIndexs: number[]): void {
       
        for (let i: number = 0; i < removeIndexs.length; i++) {
            this.removeArea(removeIndexs[i]);
        }
        for (let i: number = 0; i < addIndexs.length; i++) {
            this.addArea(addIndexs[i]);
        }
    }

    public initNodeByArea(areaIndex: number): void {

    }

    public getIdByData(data: any): number {
        return data.id;
    }
}
