import { Color, Node, Rect, Size, Sprite, SpriteFrame, UITransform } from 'cc';
import { easeMotion, MOTION_CHANNELS, PaintedMotion, samplePaintedMotion } from './PaintedBattleMotion';
import { PaintedHeroProfile, PaintedHeroWeapon } from './PaintedHeroCatalog';
import { PAINTED_HERO_REGIONS } from './PaintedHeroRegions';

export type PaintedKind = 'red' | 'blue' | 'lubu' | 'hero';
export type PaintedWeapon = PaintedHeroWeapon | 'crossbow';
export function paintedInfantryWeapon(name:string):PaintedWeapon {
    return /弩/.test(name)?'crossbow':/弓/.test(name)?'bow':/刀|盾/.test(name)?'sabre':'spear';
}
export class PaintedEquipmentAtlas {
    readonly parts:SpriteFrame[];
    constructor(atlas:SpriteFrame){
        this.parts=[[53,44,460,426],[726,21,103,449],[1120,97,317,357],
            [238,509,119,484],[636,536,285,435],[1239,523,78,450]].map(([x,y,w,h])=>{
            const frame=new SpriteFrame();frame.texture=atlas.texture;frame.rect=new Rect(x,y,w,h);
            frame.originalSize=new Size(w,h);frame.packable=false;return frame;
        });
    }
    destroy():void { this.parts.forEach(frame=>frame.destroy()); }
}
// 同一人物的部件共用一张纹理；矩形经过 alpha 连通域核对，不在运行时拆图或生成贴图。
const REGIONS: Record<'red'|'blue'|'lubu',number[][]> = {
    red:[[8,129,267,351],[286,110,319,310],[636,144,136,259],[860,160,130,259],
        [58,613,168,257],[326,614,122,263],[555,551,166,355],[827,546,162,367],[89,954,89,525],[248,1117,255,226]],
    blue:[[46,118,317,322],[371,59,347,371],[747,121,155,282],[1060,124,116,303],
        [92,517,159,244],[432,517,118,286],[701,478,154,325],[1007,478,157,335],[139,824,76,414],[388,944,258,225]],
    lubu:[[61,35,283,321],[388,29,383,349],[882,65,144,272],[1202,82,114,251],
        [118,401,142,249],[500,406,106,252],[828,371,165,287],[1221,376,167,282],
        [127,662,123,413],[338,685,409,375],[784,697,328,358],[1166,700,243,335]]
};
export class PaintedPuppetAtlas {
    readonly parts: SpriteFrame[];
    constructor(readonly kind: PaintedKind, atlas: SpriteFrame, cloth?: SpriteFrame, readonly profile?: PaintedHeroProfile) {
        const details=[[30,61,618,604],[728,215,747,285],[1573,279,571,221]];
        const regions=kind==='hero'?PAINTED_HERO_REGIONS[profile.id]:REGIONS[kind];
        if(!regions)throw new Error(`缺少武将分层素材：${profile?.id}`);
        this.parts=regions.map((region,index)=>{
            const extra=kind==='lubu'&&cloth&&index>=9;
            const [x,y,w,h]=extra?details[index-9]:region;
            const frame=new SpriteFrame();frame.texture=(extra?cloth:atlas).texture;frame.rect=new Rect(x,y,w,h);
            frame.originalSize=new Size(w,h);frame.packable=false;return frame;
        });
    }
    destroy(): void { this.parts.forEach(frame=>frame.destroy()); }
}
interface Arm { upper: Node; fore: Node; x: number; y: number; bend: number; }
const RAD=Math.PI/180,DEG=180/Math.PI;
const WHITE=new Color(255,255,255),HIT=new Color(255,218,204),FALLEN=new Color(155,170,181);

/** 2D 分层骨架：武器握点使用双节手臂 IK，动作切换时保留当前姿态作为过渡起点。 */
export class PaintedBattlePuppet {
    readonly root: Node;
    private head: Node;
    private legs: Node[];
    private cape: Node;
    private feathers: Node[]=[];
    private weapon: Node;
    private shield: Node;
    private far: Arm;
    private near: Arm;
    private sprites: Sprite[]=[];
    private pose=new Float32Array(MOTION_CHANNELS.length);
    private sample=new Float32Array(MOTION_CHANNELS.length);
    private previous=new Float32Array(MOTION_CHANNELS.length);
    private motion: PaintedMotion=null;
    private transition=1;
    private shade=0;
    private direction: number;
    constructor(parent: Node, private atlas: PaintedPuppetAtlas, size: number,
        readonly weaponKind:PaintedWeapon=atlas.profile?.weapon||(atlas.kind==='lubu'?'halberd':'spear'),equipment?:PaintedEquipmentAtlas,facing:1|2=1) {
        this.direction=atlas.kind==='blue'?-1:1;
        const hero=atlas.kind==='lubu'||atlas.kind==='hero',profile=atlas.profile;
        const scale=size/(hero?194:150),mirror=hero&&facing===2?-1:1;
        const holder=this.node(parent,'Painted bones');holder.setScale(scale*mirror*(profile?.breadth||1),scale,1);
        this.root=this.node(holder,'Body pivot');const d=this.direction;
        this.cape=this.part(this.root,9,hero?64:28,hero?.85:.56,hero?.95:.90,'Cloth');
        this.cape.setPosition(hero?-6:-4,hero?69:42);if(hero)this.cape.setScale(.62,1,1);
        if(!hero&&equipment&&(weaponKind==='bow'||weaponKind==='crossbow')){
            const quiver=this.partFrame(this.root,equipment.parts[4],43,.5,.5,'Quiver');
            quiver.setPosition(d*8,67);quiver.setRotationFromEuler(0,0,d*19);
        }
        this.far=this.arm(this.root,2,3,-d*12,65,-d,'Far arm');
        this.legs=[this.part(this.root,6,38,.5,.94,'Far leg'),this.part(this.root,7,38,.5,.94,'Near leg')];
        const torso=this.part(this.root,0,45,.5,.22,'Armour');torso.setPosition(0,41);
        this.head=this.node(this.root,'Head pivot');this.head.setPosition(hero?2:0,68);
        if(atlas.kind==='lubu'){
            const a=this.part(this.head,10,16,.97,.10,'Long plume');a.setPosition(-2,32);
            const b=this.part(this.head,11,12,.97,.10,'Short plume');b.setPosition(0,33);this.feathers=[a,b];
        }
        this.part(this.head,1,profile?.headHeight||(hero?46:44),profile?.headAnchor[0]??(hero?.73:atlas.kind==='red'?.63:.48),profile?.headAnchor[1]??(hero?.20:.10),'Helmet and face');
        this.near=this.arm(this.root,4,5,d*12,65,d,'Near arm');
        if(!hero&&equipment&&weaponKind==='crossbow')this.weapon=this.partFrame(this.root,equipment.parts[0],47,.5,.24,'Crossbow');
        else if(!hero&&equipment&&weaponKind==='bow')this.weapon=this.partFrame(this.root,equipment.parts[3],77,.75,.47,'Bow');
        else if(!hero&&equipment&&weaponKind==='sabre'){
            this.weapon=this.partFrame(this.root,equipment.parts[1],70,.52,.17,'Dao');
            this.shield=this.partFrame(this.root,equipment.parts[2],41,.5,.5,'Shield');
        }else this.weapon=this.part(this.root,8,profile?.weaponHeight||(hero?143:125),profile?.weaponAnchor[0]??(hero?.40:atlas.kind==='red'?.32:.76),profile?.weaponAnchor[1]??.30,'Weapon');
        this.animate('idle',0,0,true);
    }
    private node(parent:Node,name:string): Node {
        const node=new Node(name);node.layer=parent.layer;node.addComponent(UITransform);parent.addChild(node);return node;
    }
    private part(parent:Node,index:number,height:number,ax:number,ay:number,name:string):Node {
        return this.partFrame(parent,this.atlas.parts[index],height,ax,ay,name);
    }
    private partFrame(parent:Node,frame:SpriteFrame,height:number,ax:number,ay:number,name:string):Node {
        const node=this.node(parent,name);
        const transform=node.getComponent(UITransform);transform.setAnchorPoint(ax,ay);
        transform.setContentSize(height*frame.originalSize.width/frame.originalSize.height,height);
        const sprite=node.addComponent(Sprite);sprite.sizeMode=Sprite.SizeMode.CUSTOM;sprite.trim=false;sprite.spriteFrame=frame;
        this.sprites.push(sprite);return node;
    }
    private arm(parent:Node,upper:number,fore:number,x:number,y:number,bend:number,name:string):Arm {
        const u=this.part(parent,upper,23,.5,.90,name),f=this.part(u,fore,23,.5,.90,'Forearm');
        u.setPosition(x,y);f.setPosition(0,-17);return{upper:u,fore:f,x,y,bend};
    }
    private aimArm(arm:Arm,x:number,y:number):void {
        let dx=x-arm.x,dy=y-arm.y;const reach=Math.sqrt(dx*dx+dy*dy),distance=Math.max(.1,Math.min(33.5,reach));
        if(reach>33.5){dx*=distance/reach;dy*=distance/reach;}
        const aim=Math.atan2(dy,dx),bend=Math.acos(Math.max(-1,Math.min(1,distance/34)))*arm.bend;
        const ex=Math.cos(aim+bend)*17,ey=Math.sin(aim+bend)*17;
        const upper=Math.atan2(ex,-ey)*DEG,fore=Math.atan2(dx-ex,-(dy-ey))*DEG-upper;
        arm.upper.setRotationFromEuler(0,0,upper);arm.fore.setRotationFromEuler(0,0,fore);
    }
    animate(name:PaintedMotion,seconds:number,step:number,snap=false):void {
        samplePaintedMotion(name,seconds,this.sample);
        if(snap||this.motion===null){this.pose.set(this.sample);this.previous.set(this.sample);this.motion=name;this.transition=1;}
        else if(this.motion!==name){this.previous.set(this.pose);this.motion=name;this.transition=0;}
        this.transition=Math.min(1,this.transition+step/(name==='fall'?.055:.11));
        const mix=easeMotion(this.transition);
        for(let i=0;i<this.pose.length;i++)this.pose[i]=this.previous[i]+(this.sample[i]-this.previous[i])*mix;
        this.applyPose();
        const shade=name==='fall'?2:name==='hit'&&seconds<.18?1:0;
        if(this.shade!==shade){this.shade=shade;const color=shade===2?FALLEN:shade===1?HIT:WHITE;this.sprites.forEach(sprite=>sprite.color=color);}
    }
    private applyPose():void {
        const p=this.pose,d=this.direction;
        this.root.setPosition(p[0]*d,p[1]);this.root.setRotationFromEuler(0,0,d*(p[2]+p[16]));this.root.setScale(1,p[17],1);
        this.head.setRotationFromEuler(0,0,p[3]*d);
        this.legs[0].setPosition(-d*8,36+p[6]);this.legs[0].setRotationFromEuler(0,0,p[4]*d);
        this.legs[1].setPosition(d*8,36+p[7]);this.legs[1].setRotationFromEuler(0,0,p[5]*d);
        this.cape.setRotationFromEuler(0,0,p[14]*d*(this.atlas.kind==='lubu'||this.atlas.kind==='hero'?.30:1));
        this.feathers.forEach((node,i)=>node.setRotationFromEuler(0,0,(i?-6:12)+p[15]*(i?.14:.20)));
        let wx=p[8]*d,wy=p[9],wa=p[10]*d;
        const ranged=this.weaponKind==='bow'||this.weaponKind==='crossbow';
        if(ranged&&this.motion!=='shoot'){wx=(16+(p[8]-18)*.4)*d;wy=49+(p[9]-43)*.4;}
        if(this.weaponKind==='crossbow')wa=(d<0?145:-35)+p[10]*d*.18;
        else if(this.weaponKind==='bow')wa=p[10]*d*.16;
        // 对面朝向镜头的士兵，把枪尖压向下方敌阵，不能继续朝自己的后方抬枪。
        if(d<0&&!ranged&&this.weaponKind!=='sabre'&&(this.motion==='attack'||this.motion==='sweep'))wa+=Math.max(0,-p[10]-30)*1.35;
        this.weapon.setPosition(wx,wy);this.weapon.setRotationFromEuler(0,0,wa+(this.atlas.profile?.weaponRotation||0));
        this.aimArm(this.near,wx,wy);
        // 双手持枪时，副手追随枪杆后一个握点；其它动作让副手自然摆动或发出军令。
        const gripX=wx+Math.sin(wa*RAD)*13,gripY=wy-Math.cos(wa*RAD)*13;
        const fx=p[11]*d*(1-p[13])+gripX*p[13],fy=p[12]*(1-p[13])+gripY*p[13];
        this.aimArm(this.far,fx,fy);
        if(this.shield){this.shield.setPosition(fx,fy+3);this.shield.setRotationFromEuler(0,0,d*(-12+p[2]*.5));}
    }
}
