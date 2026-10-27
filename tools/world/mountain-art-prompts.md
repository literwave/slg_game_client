# 连体山脉美术

2026-10-27，使用内置 imagegen 生成，两张图片均保留透明通道，经 Cocos Image Core 透明裁边（阈值8）和等比例缩放，再由 AssetDB 导入。线性采样、Clamp、mipmap 已回读确认。旧素材保留。

| 项目资源 | 尺寸 | 用途 |
| --- | --- | --- |
| `assets/resources/ui/world/mountain_ridge_connected.png` | 1024×486 | 连续长山脊，按山带方向翻转 |
| `assets/resources/ui/world/mountain_shoulder.png` | 768×390 | 低山肩、急转方向和关口过渡 |

运行时通过 `ui/world/` 加载。布局生成命令及验证见 [布局说明](README.md)。

## 连体山脊生成提示词

Use case: stylized-concept. Asset type: one transparent PNG mountain-range segment for a historical Chinese isometric 2D strategy game map. Create ONE cohesive elongated mountain ridge, not a sprite sheet. Orthographic 2:1 isometric view, looking down from 30 degrees. The long ground footprint runs diagonally from upper-left to lower-right (about 20 degrees downward across image). A natural contiguous folded rocky ridge with 3 unequal broad triangular summits joined by substantial saddles and forested shoulders; central broad summit highest, left summit lower, right endpoint tapers to low foothills. NO tall thin karst pillars, no needles, no isolated stones. Rugged gray-olive and warm gray stone, muted moss-green and ochre scrub, restrained small dark pine clusters. Match a detailed hand-painted historical strategy-game map: crisp readable silhouette, matte painted texture, soft upper-left daylight, modest contrast, no photorealism. Broad coherent rock faces and gentle foothills instead of noisy tiny fragments. Mountain base is attached to the mountains, irregular narrow moss/soil fringe fading naturally to transparent; no giant flat grassy platform, no rectangular/diamond base. The base should be almost as solid as a connected landform so adjacent copies can overlap about 35 percent to join without gaps. Full isolated object centered with 5% transparent margin all around, no cropping, fully transparent outside the landform, no opaque background or checkerboard. Landscape composition 1536 by 1024. No writing, labels, borders, red pixels, water, clouds, buildings, characters, dramatic cast shadows or glow.

## 低山肩生成提示词

Use case: stylized-concept. ONE transparent game terrain sprite, a compact low mountain shoulder / foothill massif for an isometric 2D historical Chinese strategy map. Orthographic 2:1 isometric camera viewed down at 30 degrees; no perspective horizon. One broad rounded low rocky hill with an off-center broad crag and two descending forested shoulders, all firmly fused into one continuous landform. A subdued saddle shape rather than steep tall peaks. Muted olive grass and dark pine clusters across warm gray rock, ochre earth patches. Detailed but readable painted strategy-game art, restrained texture, matte, diffuse daylight from upper left, no theatrical shadow. Entire compact hill fits inside an approximately oval footprint 1.7 times wider than its height, with irregular moss-soil fringe that fades softly to actual transparency. No flat green platform or geometric base. No isolated scattered boulders, no thin karst needles, no snow, no dramatic lighting, no glow or halo, no sky, no water, no buildings, no text or grid. Keep every part in frame with 6 percent transparent padding, transparent background, sharp organic silhouette. 1536x1024 landscape image.
