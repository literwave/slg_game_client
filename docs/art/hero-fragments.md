# 武将独立碎片图标

本批覆盖 Hero.Id 1001–1026，每位武将独立生成一张碎片图标，普通版与 SP 版采用不同配色、冠甲和兵器特征。使用内置 **image_gen**，每张单独调用，参考首张吕布图的材质与构图；不是从武将卡面裁切，也不是拼图切片。

## 统一美术规范

- 古铜与墨玉（bronze / dark jade）的破裂浮雕将印，主体是突出于圆形残章的威严半身像。
- 右下方保留明显缺口，附近两片小碎屑；冠饰、兵器全部完整入画，四周留透明边距。
- 浮雕金属倒角、深浅层次和少量珐琅强调色；人物面部与代表性装备在 64 px 显示时仍可辨认。
- 统一单体居中、略向右的三分之四半身像。真正透明 alpha，无背景、地面、文字、数字、水印或外层 UI 边框。
- SP 版本改变主导配色与装备轮廓，不只增加字样；例如吕布 SP 使用银黑甲与紫红双翎，董卓 SP 使用玄铁兽盔与紫焰纹。

可复用模板（生成规范，不是所有图片的逐字历史提示词）：

```text
Use case: stylized-concept.
Asset: one independent Three Kingdoms hero-fragment inventory icon.
Reference role: style/composition only; replace the character and signature ornaments.
Style: exquisite ancient bronze and dark-jade sculptural relief, deep chiaroscuro,
beveled metal, restrained colored enamel, imposing bust projecting from a broken round medallion.
Subject: [hero identity and distinctive features from the table below].
Composition: centered isolated item, lower-right chipped edge and two tiny detached shards,
complete silhouette with transparent padding; strong shapes readable at 64 pixels.
Output: genuine transparent alpha background.
Avoid: text, Chinese characters, numbers, SP letters, UI frame, rectangular border,
scenery, floor, watermark, multiple icons, sprite sheet or collage.
```

## 制作与导入

1. 用 `view_image` 查看风格参考；内置 `image_gen` 每位武将单独调用，设置 `transparent_background: true`，将参考图明确标为风格参考。
2. 检查角色身份、兵器冠甲、普通/SP 差异、透明轮廓和碎口。保留原图，避免覆盖已确认的图标。
3. 将原图交给 Cocos **Image Core**：`resize`，`width: 256`、`height: 256`、`fit: contain`、`interpolation: bicubic`，输出 PNG。需要统一留白时先透明裁边，再等比缩放与透明补边；不得拉伸脸部或将印。
4. 使用 `image_editor_import` 经 **AssetDB** 导入最终路径，确认 ImageAsset 及 SpriteFrame 子资源。纹理使用 linear 过滤、clamp 环绕、中心轴心，保留 alpha。
5. 在奖励界面同时查看 64 px 左右的小图和 256 px 原尺寸，确认边缘清晰、角色可辨、未裁切。文件存在不能替代 SpriteFrame 导入确认。

最终目录：`assets/resources/ui/item_icons/hero_fragments/`。文件名为 `fragment_<Hero.Id>.png`；运行时路径为 `ui/item_icons/hero_fragments/fragment_<Hero.Id>/spriteFrame`。

## 角色与资源表

以下识别要素用于保持批次一致和后续复现。1003–1010 的实际角色提示词另录于文末；其他行是生成规范摘要，不声称为逐字原始提示词。

| Hero.Id | 武将 | 识别要素 | 最终文件（相对上述目录） |
|---|---|---|---|
| 1001 | 吕布 | 金红战甲、双红长翎、方天画戟、威严无须面容 | `fragment_1001.png` |
| 1002 | 刘协 | 年轻帝王、帝冠、龙纹礼服、端正清秀面容 | `fragment_1002.png` |
| 1003 | 张让 | 宦官乌冠、拂尘、无须面容、紫铜与紫色珐琅 | `fragment_1003.png` |
| 1004 | 貂蝉 | 金蝶簪、绛红舞绢、金饰、从容而有气势的面容 | `fragment_1004.png` |
| 1005 | 何太后 | 金凤冠、紫玉、墨紫礼服、庄重皇室气质 | `fragment_1005.png` |
| 1006 | 黄盖 | 白须老将、赤铜战盔、厚甲、分节铁鞭 | `fragment_1006.png` |
| 1007 | 董卓 | 肥壮黑须、兽首冠、黑金重甲、暗红披带 | `fragment_1007.png` |
| 1008 | 张角 | 黄巾长须、雷纹法杖、玉杖头、黄褐法袍 | `fragment_1008.png` |
| 1009 | 董卓 SP | 玄铁兽盔、尖角轮廓、紫焰珐琅、厚重紫袍 | `fragment_1009.png` |
| 1010 | 吕布 SP | 银黑鬼面甲、双紫红长翎、方天戟 | `fragment_1010.png` |
| 1011 | 贾诩 | 乌冠、锐眼长髯、紫黑羽扇与甲袍 | `fragment_1011.png` |
| 1012 | 步练师 | 青玉凤凰冠、绿松石铠饰、直刃宝剑 | `fragment_1012.png` |
| 1013 | 赵云 | 银龙甲、银盔白缨、银龙长枪、冰蓝披带 | `fragment_1013.png` |
| 1014 | 吕蒙 | 青绿铜盔、短须、厚铜甲、宽刃长刀 | `fragment_1014.png` |
| 1015 | 甄姬 | 银凤冠、水滴蓝玉、洛水波纹、水蓝衣 | `fragment_1015.png` |
| 1016 | 刘备 SP | 帝王旒冠、双剑、金翠龙甲、庄严中年帝王 | `fragment_1016.png` |
| 1017 | 诸葛亮 | 青玉纶巾、长髯、白羽扇、八卦纹 | `fragment_1017.png` |
| 1018 | 陆逊 | 年轻无须儒将、窄冠束发、红披风、火焰纹直剑 | `fragment_1018.png` |
| 1019 | 马云禄 | 银盔红缨、银甲、长枪 | `fragment_1019.png` |
| 1020 | 黄月英 | 琥珀金冠、齿轮弩机、机关巧匠特征 | `fragment_1020.png` |
| 1021 | 马超 | 银狮盔、蓝缨、长枪 | `fragment_1021.png` |
| 1022 | 曹操 | 金冠短须、黑红披风、宝剑 | `fragment_1022.png` |
| 1023 | 关羽 | 红脸长髯、绿巾、青龙偃月刀 | `fragment_1023.png` |
| 1024 | 张飞 | 豹盔黑甲、浓须、蛇矛 | `fragment_1024.png` |
| 1025 | 周瑜 | 赤铜凤冠、红披风、宝剑 | `fragment_1025.png` |
| 1026 | 孙尚香 | 金簪、红甲、弓箭 | `fragment_1026.png` |

## 1003–1010 实际角色提示词

下列文字为对应调用中 `Subject` 的原文，配合上方统一构图与输出规范使用。内置生成具有随机性，可复现的是角色与美术约束，而非逐像素相同结果。

**1003 张让**

```text
ZHANG RANG, imposing ancient Chinese imperial eunuch. Slender refined beardless face, cold commanding eyes, tall black ceremonial eunuch court crown, sculpted purple-bronze robes, an elegant ivory horsetail whisk crossing one shoulder, subtle imperial-purple enamel accents. He must read as a formidable court power, not a warrior helmet or feminine dancer.
```

**1004 貂蝉**

```text
DIAO CHAN, formidable elegant ancient Chinese heroine. Refined young woman's sculpted face and confident powerful gaze, ornate gold butterfly hairpin and sculpted flowing black hair, rich crimson dance silk sweeping around her shoulder, fine gold jewelry, deep red enamel accents. Her beauty should be dignified and commanding; fully clothed. No military helmet, no beard.
```

**1005 何太后**

```text
EMPRESS DOWAGER HE, commanding dignified mature ancient Chinese empress. Noble poised woman's sculpted face, calm imperial authority, large ornate gold phoenix crown with dark-violet jewels, neat sculpted black hair, substantial ink-purple ceremonial silk robes with restrained gold phoenix ornament. Stately broad composition, not a young dancer. No military helmet or weapon.
```

**1006 黄盖**

```text
HUANG GAI, formidable veteran ancient Chinese military commander. Weathered elderly male face, fierce brows, broad white moustache and full white beard, heavy red-bronze battle helmet, rugged embossed lamellar armor, a prominent short segmented IRON WAR WHIP beside his right shoulder, rust-red enamel accents. Strong old-warrior authority, absolutely no modern whip or firearm.
```

**1007 董卓**

```text
DONG ZHUO, brutal powerful ancient Chinese warlord. Massive heavyset broad-shouldered male bust, large fleshy stern face, thick coarse black moustache and full black beard, low heavy beast-head ceremonial war crown, black-and-antique-gold heavy armor with a huge ferocious animal face on one shoulder. Dark red-brown enamel accents, tyrannical presence and weight. Ordinary Dong Zhuo version: primarily antique gold and black, NO violet flames, NO silver armor, NO tall feather plumes.
```

**1008 张角**

```text
ZHANG JIAO, imposing ancient Chinese Yellow Turban mystic leader. Lean weathered male face, intense wise eyes, long black-and-grey flowing beard, a very recognizable folded saffron-yellow cloth turban, ancient yellow and ochre ritual robes with cast bronze trim, an upright bronze ritual staff bearing sculpted lightning motifs and a small jade finial beside his shoulder. Yellow-gold enamel lightning details, disciplined formidable Taoist master. No soldier helmet, no long feathers, no western wizard hat.
```

**1009 董卓 SP**

```text
DONG ZHUO SP, special formidable variant of a brutal ancient Chinese warlord. Massive heavyset broad-shouldered male bust, broad rugged angry face with heavy coarse BLACK beard, glaring ruthless eyes, terrifying DARK IRON BEAST-HEAD HELMET with jagged horn-like metal points, immense blackened-metal armor. Strong VIOLET-FLAME ENAMEL engraved motifs on helmet and chest, bold violet jewel and purple cloak accents. Deliberately different from ordinary gold/red Dong Zhuo: predominant charcoal black, gunmetal and deep violet, thin weathered bronze rim, fierce demonic-beast silhouette. Keep human face readable and metal relief realistic. No actual fire background, no red feather plume.
```

**1010 吕布 SP**

```text
LU BU SP, special formidable variant of ancient Chinese champion Lu Bu. Powerful clean-shaven handsome masculine sculpted face with fierce eyes, long black hair, SILVER-BLACK DEMON-MASK ARMOR on shoulders and chest, high sculpted silver-black war crown with TWO sweeping long DARK PURPLE AND MAGENTA feather plumes, visible ornate crescent FANGTIAN HALBERD blade beside his right shoulder. Deliberately different from ordinary gold/red Lu Bu reference: SILVER, BLACK and PURPLE-MAGENTA are dominant character colors, restrained weathered bronze medallion rim and deep jade field; no red-and-gold armor. Confident overwhelming commander presence, clear face, crisp strong silhouette.
```
