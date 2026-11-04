# 占领半跪防守素材

- 资源：`assets/resources/ui/march/guard_defend_sheet.png`，768 × 512，3 列 × 2 行；每格 256 × 256。
- 顺序：右、右后、背 / 右前、正、左前；运行时左侧方向镜像对应右侧原帧。
- 所有格统一从 512 × 512 等比缩放为 236 × 236，再平移到固定画布。膝脚基线约 y=237，运行时继续使用距底 18px 的锚点。人物保留真实半跪比例，不压缩站立姿势。
- 透明背景，线性过滤、Clamp，关闭 Mipmap。骑将驻守和全部行军步态保持原素材。
- 占领后步兵沿四条边内侧 0.43 格布防、朝外，成对间隔 0.32 格；就位后半跪，结束占领收拢。

## 各格校准

[
  {
    "frame": 0,
    "left": 28,
    "top": 7,
    "sourceSize": 512,
    "scaledSize": 236
  },
  {
    "frame": 1,
    "left": 20,
    "top": 6,
    "sourceSize": 512,
    "scaledSize": 236
  },
  {
    "frame": 2,
    "left": 8,
    "top": 6,
    "sourceSize": 512,
    "scaledSize": 236
  },
  {
    "frame": 3,
    "left": 32,
    "top": 9,
    "sourceSize": 512,
    "scaledSize": 236
  },
  {
    "frame": 4,
    "left": 11,
    "top": 9,
    "sourceSize": 512,
    "scaledSize": 236
  },
  {
    "frame": 5,
    "left": 4,
    "top": 9,
    "sourceSize": 512,
    "scaledSize": 236
  }
]

## 生成提示词

Create a production sprite sheet for the OCCUPY / DEFEND state of the infantry in the reference game. Reference image has cavalry in its TOP half and infantry in its BOTTOM half. Use ONLY the BOTTOM HALF infantry as appearance reference: same realistic small adult Chinese soldier, rounded dark iron helmet without a plume, dark bronze-black lamellar armor, muted blue-grey cloth sleeves and armored skirt, cream trousers, dark brown boots. Do NOT draw any horses, cavalry, red-caped generals or standing soldiers.

Output one transparent PNG sprite sheet, landscape 3:2, EXACTLY 3 equal columns by 2 equal rows, SIX independent square cells, ideally 1536x1024 pixels with 512x512 cells. This is one identical low kneeling defensive pose seen from SIX precisely ordered camera-relative directions, NOT sequential animation frames. Fixed orthographic isometric strategy-game camera elevated 30 degrees above ground, identical body dimensions, costume, equipment and scale throughout.

POSE in every cell: a low, grounded single-knee defensive kneel, one rear knee touching the ground, opposite boot firmly planted forward, both hips lowered, torso leaning slightly forward. He is visibly about 60 percent as tall as his original standing pose, but his head, hands and armor pieces are at their original scale, NOT an enlarged kneeling man. Realistic adult anatomy and solid balance, no squat hovering, no leg through body. A sturdy compact oval dark wooden shield with a simple weathered iron rim is braced on the left forearm in front of his chest/knee toward the threat. Right hand firmly grips ONE long dark-wood spear at chest height; spear is aimed OUTWARD and upward about 25 to 35 degrees above the ground, steel spearhead clearly above and forward of the shield, a tiny dark-red binding below blade. Shield and spear face the same direction as his face and forward planted boot. Do not carry spear vertically at rest; this is an active braced defensive posture, ready to repel cavalry, NOT attacking or throwing. Spear shaft must remain straight and unbroken, hand must physically grip it. No extra limbs or duplicated weapons.

Exact ROW-MAJOR cell ordering:
TOP LEFT: pure right-facing SIDE PROFILE, nose and shield and spear point toward screen RIGHT.
TOP MIDDLE: REAR RIGHT three-quarter view, facing screen UPPER RIGHT / away from viewer. See back and right shoulder, shield and spear point upper right.
TOP RIGHT: STRAIGHT BACK view, facing screen UP / away, back of helmet and armor visible, shield and spear visible slightly beyond shoulders.
BOTTOM LEFT: FRONT RIGHT three-quarter view, facing screen LOWER RIGHT / toward viewer. Face and chest visible, shield and spear point toward lower right with natural foreshortening.
BOTTOM MIDDLE: STRAIGHT FRONT view, facing screen DOWN / toward viewer, face clearly visible above shield, spear points outward toward viewer with visible diagonal shaft and spearhead.
BOTTOM RIGHT: FRONT LEFT three-quarter view, facing screen LOWER LEFT / toward viewer, mirrored counterpart of bottom left.

CELL REGISTRATION is critical: for EACH 512x512 cell the ground contact line of planted boot / kneeling knee is at y=474 (near 93 percent from top), the grounded body's contact center at x=256. The low kneeling soldier's HEAD is around y=200; his BODY occupies only lower 55 percent of cell. Do NOT center the body vertically and do NOT fill the cell with an enlarged figure. Same physical head size as reference infantry, about 48 pixels in a 512-pixel cell. Weapons may extend up and sideways into empty upper space. All spear tips and shield edges fully contained with at least 24 pixels transparent padding, no cross-cell overlap. Transparent unused upper space is intentional. Each cell must contain exactly one fully isolated soldier, no background, no ground plane, no shadow, no terrain, no grid, no divider lines, no labels, no lettering, no UI, no border, no watermark, no fake checkerboard texture. Actual transparent alpha throughout the background. Crisp detailed hand-painted realistic miniature strategy-game rendering matching the reference's volumetric armor and restrained colors, consistent upper-left warm light, not cartoon, not concept art. Six views of the SAME kneeling shield-and-raised-spear defender.
