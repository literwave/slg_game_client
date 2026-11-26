# 益州州府独立外观

本版替代 v5。主城参考仅用于外墙透视、转角连接和地面占格，不沿用其殿宇与双配院布局。

两层木构府衙、两列商铺街坊、竹园小池与平桥形成三处清晰分区；灰石粉墙、暗瓦木构角楼及蓝色门旗形成州府外观。地图配色保持低饱和，人物提供尺度参照。

原画 1774×887，经 Cocos Image Core 输出近景 1040×520、远景 360×180。资源为 `city-yizhou-prefecture-v6` 与 `city-overview-yizhou-prefecture-v6`，线性过滤、clamp、不启用 mipmap。

沿用整图投影、3×3 地面占格与独立的屋顶显示空间；同步更新尺寸清单、Alpha 拾取轮廓和近远景引用。真实图像采样回归通过，未启动游戏预览。

## 生成提示词

```text
Redesign the YIZHOU PREFECTURAL CITY game sprite, using the two attached references with STRICTLY DIFFERENT roles.
REFERENCE 1 supplies ONLY camera, outer footprint, ground registration, and the structural correctness of its four connected full-height walls. Keep exactly its 2:1 wide canvas, diamond ground outline, wall base corners, roof allowance above the rear footprint, and lower-right wall gate position. DO NOT copy its interior architecture/layout, twin hollow courtyard compounds, huge central cross-shaped square, or main-city palace.
REFERENCE 2 supplies regional CHARACTER only: a prosperous Sichuan regional seat with slate-tiled timber government buildings, a modest water garden, bamboo and market life. Its overpacked clutter and vivid yellow-green foliage are problems; greatly simplify them.

Create a CLEARLY DISTINCT regional city, immediately different in silhouette and composition from reference 1:
- At the back-left interior, a compact two-storey governor's yamen with white plaster infill, dark weathered timber and broad charcoal slate roof, long rectangular rather than a tiered imperial palace. A modest attached record hall forms an L, not an enclosed square courtyard.
- A narrow straight civic street runs diagonally from the embedded lower-right gate toward the yamen, parallel to the same isometric world axis as the walls. Keep all roof ridges and foundations rigorously aligned with the two world-grid axes.
- On the RIGHT side of this street, two short rows of 3 modest merchants' houses each, cream plaster walls, muted brown wood, slate roofs, only two subdued tan awnings. Buildings grouped into clear coherent blocks, not scattered little huts. Leave visible alley gaps.
- On the LEFT FRONT side, ONE small calm jade-grey pond, a tiny simple flat stone bridge and a low garden pavilion, with a restrained bamboo grove. The pond occupies at most 10% of the city, not a bright winding river. Two distinct warehouse buildings near the left wall.
- Seven or eight tiny subtle people in the street for scale.
- Four city walls remain solid, straight, equally high and thick, connected directly to four corner towers; preserve reference 1's geometry and exact ground footprint. Give these walls their OWN architectural finish: weathered cool-grey stone plinth, pale grey plaster wall panels, simple dark slate capped battlements; compact squat dark timber corner pavilions, not duplicate tall main-city towers. Gate is a double-bay timber gatehouse directly embedded in the lower-right straight wall, with restrained faded blue hanging banners. No protruding gate bastion, no broken or stepped wall line.
- Overall earthy/desaturated map palette: warm grey stone, cream plaster, dark brown wood, charcoal slate roofs, olive green bamboo, dusty muted teal water. Minimal gilding, NO neon edges, red/yellow fringes, glitter, or oversharpened outlines.
Readable at strategy-map scale: strong primary silhouette, 3 clear interior zones (yamen, merchant quarter, garden), generous orderly circulation, no duplicate courtyard blocks and no giant empty plaza. Painted high-quality miniature game art, same elevated orthographic isometric camera and coherent lighting as reference 1. Fully transparent exterior alpha, no terrain around the city, no text, labels, UI, frame, or contact shadow outside its footprint. Output one finished sprite on a wide 2:1 canvas, matching reference 1's exact footprint placement.
```
