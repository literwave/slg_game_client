import { Node, UITransform } from 'cc';
import { orderWorldDepth } from './WorldDepthOrder';

/** 路线留在地面，建筑保持原图层；部队独立绘制在建筑上方。 */
export default class MapDepthLayer {
    private static layers = new WeakMap<Node, MapDepthLayer>();
    readonly actors: Node;
    readonly routes: Node;
    private troopLayer: Node | null = null;
    private footprints = new WeakMap<Node, { halfWidth: number; halfHeight: number }>();

    static forLayer(layer: Node): MapDepthLayer | null {
        const world = layer?.parent;
        if (!world) return null;
        let depth = this.layers.get(world);
        if (!depth) { depth = new MapDepthLayer(world, layer.layer); this.layers.set(world, depth); }
        return depth;
    }

    private constructor(world: Node, layer: number) {
        const make = (name: string) => {
            const node = new Node(name); node.layer = layer;
            node.addComponent(UITransform); world.addChild(node); return node;
        };
        this.routes = make('WorldMarchGround');
        const ground = world.getChildByName('resBuildNode') || world.getChildByName('sysCityNode');
        this.routes.setSiblingIndex(ground ? ground.getSiblingIndex() : 0);
        this.actors = make('WorldDepthActors');
        const buildings = world.getChildByName('roleCityNode');
        if (buildings) this.actors.setSiblingIndex(buildings.getSiblingIndex() + 1);
    }

    get troops(): Node {
        if (!this.troopLayer?.isValid) {
            const world = this.actors.parent;
            const node = new Node('WorldMarchTroops'); node.layer = this.actors.layer;
            node.addComponent(UITransform); world.addChild(node);
            const army = world.getChildByName('armyNode');
            if (army) node.setSiblingIndex(army.getSiblingIndex() + 1);
            this.troopLayer = node;
        }
        return this.troopLayer;
    }

    building(node: Node, width: number, height: number): void {
        if (node.parent !== this.actors) node.parent = this.actors;
        this.footprints.set(node, { halfWidth: width / 2, halfHeight: height / 2 });
    }

    update(): void {
        const ordered = orderWorldDepth(this.actors.children.map(node => ({ value: node,
            x: node.position.x, y: node.position.y, ...this.footprints.get(node) })));
        // 建筑之间、士兵之间各自按落脚点排序，不让城墙盖住部队。
        ordered.forEach((node, i) => { if (node.getSiblingIndex() !== i) node.setSiblingIndex(i); });
        if (this.troopLayer?.isValid) {
            const troops = orderWorldDepth(this.troopLayer.children.map(node => ({ value: node,
                x: node.position.x, y: node.position.y })));
            troops.forEach((node, i) => { if (node.getSiblingIndex() !== i) node.setSiblingIndex(i); });
        }
    }
}
