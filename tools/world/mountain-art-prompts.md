# 连体山脉美术

## 宽桥关城（2026-10-29）

当前跨河关隘使用 `assets/resources/ui/world/fortified_river_bridge.png`，1536×976、透明PNG。内置imagegen生成，Cocos Image Core按alpha阈值8裁边后等比缩放，AssetDB导入并回读确认线性采样、Clamp和mipmap。先前的 `grand_river_bridge` 为废弃的细桥方案，不再用于关隘。

最终构图：桥从左下向右上，宽石铺军用通道，中央关城横跨道路、城门正对桥面，城门前后各有宽阔集结区与两道大拱；桥头低坡引道带不规则草土边。城墙厚重，深灰重檐、克制红木；无旗帜、人物、文字、绘制水面或周围山体。水面由项目地形材质实时绘制，拱洞保留透明。生成提示明确“bridge travels bottom-left to top-right, gate faces bottom-left, roadway enters gate at threshold height”，避免城门错误地开在桥侧水面上。

美术纵向比例在 `GateGeometry` 统一校准为0.82，匹配地图2:1等距轴；绘制和点击共用锚点及有效高度。关城和两段宽桥面分开命中，不以整张透明图片拦截河面点击。

2026-10-27，使用内置 imagegen 生成，两张图片均保留透明通道，经 Cocos Image Core 透明裁边（阈值8）和等比例缩放，再由 AssetDB 导入。线性采样、Clamp、mipmap 已回读确认。旧素材保留。

| 项目资源 | 尺寸 | 用途 |
| --- | --- | --- |
| `assets/resources/ui/world/mountain_ridge_connected.png` | 1024×486 | 连续长山脊，按山带方向翻转 |
| `assets/resources/ui/world/mountain_shoulder.png` | 768×390 | 低山肩、急转方向和关口过渡 |

运行时通过 `ui/world/` 加载。布局生成命令及验证见 [布局说明](README.md)。

2026-10-28新增两张内置imagegen原创透明素材。Cocos Image Core以阈值8裁去透明边，再等比例缩放到最长边1024，由AssetDB导入；两张均已确认透明通道、线性采样、Clamp与mipmap。运行时已验证为SpriteFrame。

| 项目资源 | 尺寸 | 用途 |
| --- | --- | --- |
| `assets/resources/ui/world/mountain_massif_natural.png` | 1024×547 | 不对称主峰、分叉岩脊和下降的林木山肩 |
| `assets/resources/ui/world/mountain_saddle_natural.png` | 1024×543 | 低矮弯曲山脊、宽鞍部与缓坡 |

新增素材提示词要点：historical Chinese isometric 2D strategy terrain; orthographic 2:1 view, 30-degree down view; irregular connected eroded gray-olive rock, muted moss and small pine clusters; asymmetric branching massif with unequal broad summits / low winding wooded saddle with rounded rocky knobs; diffuse upper-left light, matte painted texture; irregular narrow ground fringe, actual transparent background and padding; no geometric platform, sky, buildings, snow, water, text, glow or identical repeated peaks。原始生成尺寸1536×1024。

## 连体山脊生成提示词

Use case: stylized-concept. Asset type: one transparent PNG mountain-range segment for a historical Chinese isometric 2D strategy game map. Create ONE cohesive elongated mountain ridge, not a sprite sheet. Orthographic 2:1 isometric view, looking down from 30 degrees. The long ground footprint runs diagonally from upper-left to lower-right (about 20 degrees downward across image). A natural contiguous folded rocky ridge with 3 unequal broad triangular summits joined by substantial saddles and forested shoulders; central broad summit highest, left summit lower, right endpoint tapers to low foothills. NO tall thin karst pillars, no needles, no isolated stones. Rugged gray-olive and warm gray stone, muted moss-green and ochre scrub, restrained small dark pine clusters. Match a detailed hand-painted historical strategy-game map: crisp readable silhouette, matte painted texture, soft upper-left daylight, modest contrast, no photorealism. Broad coherent rock faces and gentle foothills instead of noisy tiny fragments. Mountain base is attached to the mountains, irregular narrow moss/soil fringe fading naturally to transparent; no giant flat grassy platform, no rectangular/diamond base. The base should be almost as solid as a connected landform so adjacent copies can overlap about 35 percent to join without gaps. Full isolated object centered with 5% transparent margin all around, no cropping, fully transparent outside the landform, no opaque background or checkerboard. Landscape composition 1536 by 1024. No writing, labels, borders, red pixels, water, clouds, buildings, characters, dramatic cast shadows or glow.

## 低山肩生成提示词

Use case: stylized-concept. ONE transparent game terrain sprite, a compact low mountain shoulder / foothill massif for an isometric 2D historical Chinese strategy map. Orthographic 2:1 isometric camera viewed down at 30 degrees; no perspective horizon. One broad rounded low rocky hill with an off-center broad crag and two descending forested shoulders, all firmly fused into one continuous landform. A subdued saddle shape rather than steep tall peaks. Muted olive grass and dark pine clusters across warm gray rock, ochre earth patches. Detailed but readable painted strategy-game art, restrained texture, matte, diffuse daylight from upper left, no theatrical shadow. Entire compact hill fits inside an approximately oval footprint 1.7 times wider than its height, with irregular moss-soil fringe that fades softly to actual transparency. No flat green platform or geometric base. No isolated scattered boulders, no thin karst needles, no snow, no dramatic lighting, no glow or halo, no sky, no water, no buildings, no text or grid. Keep every part in frame with 6 percent transparent padding, transparent background, sharp organic silhouette. 1536x1024 landscape image.
