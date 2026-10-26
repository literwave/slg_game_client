# 独立道具图标

本批为新版 `Item` 表的 9 种非碎片道具各制作一张独立图标，与上一批 26 张[武将碎片图标](hero-fragments.md)共同覆盖当前全部 35 种道具。使用内置 **image_gen** 分别生成，最终均为 256 × 256 透明 PNG。

## 风格与识别规范

三国写实手绘游戏物品，浅三分之四视角，精细且可信的材质、暖色边缘高光与墨玉色暗部。资源保留粮食、木、铁、石的自然材质；令符使用青铜、玄金、玉石和朱红强调色。参考 `hero_fragments/fragment_1001.png` 的材质表现，不复制武将人脸、圆章或碎口。

单个物品或紧凑组合居中，主体约占画布 80–86%，轮廓完整，64 px 下仍可辨认。保留真实透明 alpha；无底板、场景、地面投影、文字、UI 边框、水印或浮空粒子。

最终目录为 `assets/resources/ui/item_icons/items/`。下表是统一生成规范摘要；只有文末明确记录的内容属于逐字实际提示词。

| Item.Id | 道具 | 识别要素 | 最终文件（相对上述目录） |
|---|---|---|---|
| 1 | 粮草 | 金黄谷穗与装满谷物的小麻布袋，蜂蜜金谷粒、自然亚麻色 | `item_1.png` |
| 2 | 木材 | 三根深棕木料以麻绳扎束，粗树皮与清晰端面年轮 | `item_2.png` |
| 3 | 铁矿 | 粗矿石紧邻一小块锻铁，冷灰金属与高明度银灰切面 | `item_3.png` |
| 4 | 石料 | 三块浅暖灰长方建筑方石，粗石面与清楚的块状轮廓 | `item_4.png` |
| 100 | 令牌 | 完整厚重青铜虎形虎符，少量深玉绿镶嵌 | `item_100.png` |
| 101 | 训练加速 | 青铜沙漏、红丝带、交叉短剑装饰 | `item_101.png` |
| 102 | 治疗加速 | 白玉药瓶、青绿药叶、附挂小沙漏 | `item_102.png` |
| 103 | 点将符 | 完整朱红玄金长方兵符，金龙浮雕、虎首扣与红飘带 | `item_103.png` |
| 1001 | 迁城令 | 金边展开古地图，中心青铜城门标记与朱红绳结 | `item_1001.png` |

## 可复现流程

1. 使用 `view_image` 查看参考。每种道具单独调用内置 `image_gen`，以 `referenced_image_paths` 指定材质参考，设置 `transparent_background: true`。
2. 检查物品特征、完整轮廓和透明边缘。将生成原图送入 Cocos **Image Core**：`resize`，`width: 256`、`height: 256`、`fit: contain`、`interpolation: bicubic`，输出透明 PNG；需要归一化留白时先透明裁边，再等比缩放与透明补边。
3. 通过 **AssetDB** 导入 `assets/resources/ui/item_icons/items/item_<Item.Id>.png`，确认 ImageAsset 和 SpriteFrame 子资源；使用 linear 过滤、clamp 环绕与中心轴心。跨来源原图可先经 AssetDB 导入暂存，再从已确认的项目资源进入 Image Core。
4. 在奖励和资源显示中检查小尺寸辨识度，并回读 SpriteFrame、验证运行时资源加载。本批 9 张已完成 256 RGBA 导入与 SpriteFrame 确认；与 26 张碎片合计 35 项运行时加载已通过。

## 客户端显示映射

`assets/scripts/common/ItemPresentation.ts` 对上述 9 个 **Item.Id** 优先返回 `ui/item_icons/items/item_<Item.Id>/spriteFrame`。碎片通过 `Kind: 8` 与 `useParams.hero_id` 找到 Hero.Id，使用 `ui/item_icons/hero_fragments/fragment_<Hero.Id>/spriteFrame`；当前覆盖 Hero.Id 1001–1026，对应 Item.Id 11001–11026。

未覆盖的新道具继续回退到 `Item.Icon`。这是客户端显示覆盖，未修改上游同步文件 `assets/resources/config/Item.json`；不要用 `Kind` 代替道具 ID，也不要把迁城令的 Item.Id 1001 当作英雄 ID。

## 提示词附件

以下公共模板与三个 `Subject` 是粮草、木材、铁矿的实际生成提示词。复现时将对应 `Subject` 替换进模板；其余六项采用上表的生成规范，不声称是逐字历史提示词。

```text
Use case: stylized-concept. Asset type: one independent inventory resource icon for a polished Three Kingdoms historical strategy game.
Input image 1 is ONLY a material-rendering and painterly quality reference. Do not copy its subject, human face, armor, round medallion, bronze frame, jade base or broken fragments.
Subject: [insert the exact subject below]
Style: refined realistic hand-painted game item, exquisite believable real-world material texture, shallow three-quarter angle, clear sculptural depth. Restrained warm edge highlights and subtle dark-jade-toned shadows harmonize with the reference while the resource keeps its natural material colors.
Composition: a SINGLE centered isolated compact object/group occupying about 80–86% of the square canvas, all edges fully inside the image with comfortable transparent margin; bold coherent silhouette and large readable shapes at 64 pixels.
Output: genuine transparent alpha background.
Avoid: human faces, portrait, circular medallion, badge, fragments, display pedestal, base plate, scenery, ground, floor, cast shadow, floating particles, sparkles, text, numbers, logos, watermark, UI frame, border, collage, sprite sheet or multiple separate icons.
```

**1 粮草 — Subject**

```text
FOOD RESOURCE: a small rustic cloth sack visibly filled with golden grain, with several ripe golden wheat/millet ears leaning across its side. Clearly recognizable as grain provisions, not a coin bag. Warm honey-gold grain heads, natural linen sack, a simple cord tie. One compact cohesive inventory item.
```

**2 木材 — Subject**

```text
WOOD RESOURCE: exactly three substantial dark-brown timber logs tied into one compact bundle with coarse natural hemp rope. Broad clearly visible circular end-grain rings on the front cut ends, rough realistic bark along the logs, a few clean warm wood facets. One sturdy cohesive bundle, no leaves or ground.
```

**3 铁矿 — Subject**

```text
IRON ORE RESOURCE: a compact cluster of coarse iron-bearing dark rock with a single small forged iron ingot resting immediately against it, visually one cohesive resource item. Cold grey metallic faces, bright readable silver-grey angular facets on the ore, rough dark stone between metal facets. Iron, not gold or gems; no crystals, no glowing magic, no gemstones.
```
