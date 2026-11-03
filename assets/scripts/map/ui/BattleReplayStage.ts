import { Color, Graphics, Node, resources, SpriteFrame, UITransform } from 'cc';

export const REPLAY_STAGE_ASSETS = ['battlefield-command-v2', 'skill-effects-refined-v1', 'infantry_equipment',
    'skill-elements-refined-v1'] as const;
let pending: Promise<SpriteFrame[]>;
const framesByName = new Map<string, SpriteFrame>();
/** 读战报详情时就开始准备；并发打开只发起一组加载，失败允许重试。 */
export function loadReplayStage(): Promise<SpriteFrame[]> {
    if (pending) return pending;
    pending = Promise.all(REPLAY_STAGE_ASSETS.map(name => new Promise<SpriteFrame>((resolve, reject) => {
        const cached = framesByName.get(name); if(cached){resolve(cached);return;}
        resources.load('ui/battle_replay/painted/' + name + '/spriteFrame', SpriteFrame, (error, frame) => {
            if (error || !(frame instanceof SpriteFrame) || !frame.texture) {
                reject(error || new Error('战场图片无效: ' + name)); return;
            }
            frame.addRef(); frame.packable = false; framesByName.set(name, frame); resolve(frame);
        });
    }))).catch(error => { pending = null; throw error; });
    return pending;
}
function node(parent: Node, name: string): Node {
    const n = new Node(name); n.layer = parent.layer; n.addComponent(UITransform); parent.addChild(n); return n;
}

/** 空气尘光按回放时钟采样；不再创建或加载军旗。 */
export class BattleReplayStage {
    private dust: Graphics;
    private lastTime = -1;
    constructor(parent: Node, private scale: number, private width: number, private height: number) {
        this.dust = node(parent, 'Atmospheric dust').addComponent(Graphics);
    }
    frame(time: number): void {
        if (time === this.lastTime) return; this.lastTime = time;
        const g = this.dust, s = this.scale; g.clear();
        for (let i = 0; i < 14; i++) {
            const t = (time * .035 + i * .6180339) % 1;
            const x = -this.width * .48 + t * this.width * .96;
            const y = -this.height * .25 + ((i * 71) % 180) * s;
            g.fillColor = new Color(228, 201, 150, Math.round(Math.sin(t * Math.PI) * 17));
            g.ellipse(x, y, (16 + i % 4 * 6) * s, (2 + i % 3) * s); g.fill();
        }
    }
}
