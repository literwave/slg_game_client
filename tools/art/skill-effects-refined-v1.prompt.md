# 技能特效精修图集 v1

## 用途与资源

用于战报回放的透明 Sprite 特效，搭配代码绘制的短光迹和少量粒子。风格为写实国风战争，浅金、火橙、淡蓝、粉色和青绿分别表达不同战法。人物动作与主将头像沿用。

- `assets/resources/ui/battle_replay/painted/skill-effects-refined-v1.png`：768 × 512，3 × 2，单格 256 × 256。
- `assets/resources/ui/battle_replay/painted/skill-elements-refined-v1.png`：1024 × 768，4 × 3，单格 256 × 256。
- 行优先索引，与 `PaintedBattleSkillEffects.ts` 的切分顺序一致。

## 通用图集提示词

Production 2D VFX sprite atlas for a refined historical Chinese Three Kingdoms tactical battle game. EXACTLY SIX independent transparent effects arranged on a STRICT 3-column by 2-row equal square-cell grid on a 1536x1024 transparent canvas. Each cell has 15 percent EMPTY TRANSPARENT padding on all sides, nothing crosses a cell boundary, all strokes completely contained. NO backgrounds, no checkerboard, no text, no characters, no UI borders, no arrows or labels. At small screen sizes these must read as airy painterly energy, NOT solid objects, not coins, not bulky clipart. Antique champagne gold, soft ivory cores, subdued warm smoke edges, thin wispy tails, controlled sparse sparks; substantial transparent negative space inside every effect. Top row from left: 1 a graceful thin elliptical crescent sword sweep, tapered ends, seen in ground-plane perspective, open center. 2 a swift narrow diagonal blade slash from lower left to upper right, layered ivory and faint amber trails, two delicate trailing wisps, no fireball. 3 a compact elegant impact spark, 5 irregular fine needle rays with a small warm-white luminous core and sparse tiny motes, NOT a huge starburst. Bottom row from left: 4 two delicate curling ascending silk-like energy wisps around an empty center, restrained spell charging aura, no horns, no phoenix or wreath. 5 a low horizontal charcoal ink-brush swipe with subtle muted old-gold dust at the edges, transparent exterior, for a skill title backplate. 6 a scattered small cloud of fine golden embers and 3 soft out-of-focus specks, asymmetric with open center, NOT arranged in a circle and no leaf wreath. Sophisticated high-end game visual effects, softly antialiased semitransparent falloff, real alpha transparency, luminous but no overpowering bloom. Maintain clean grid alignment and generous isolated margins. No effect may touch the outer canvas border.

## 元素图集提示词

Create a premium game VFX transparent sprite atlas. EXACTLY TWELVE isolated magical effects in a precise FOUR COLUMN by THREE ROW grid of equal square cells. Transparent landscape canvas 1536 by 1152, four cells across, three cells down. Absolutely no panel borders, scenery, lettering, characters, armor, UI badges or solid metal ornaments. Each effect has 17 percent EMPTY TRANSPARENT safety margin inside its own cell and NEVER touches neighboring cells. Real transparent alpha, soft alpha falloff, even space between items. A restrained painterly Three Kingdoms historical strategy aesthetic: elegant wisps, airy ink-like currents, ivory highlights, antique gold, jade, muted rose, delicate texture and abundant empty transparent interiors. Clear at 80px, fine highlights, no neon blob, no dense bloom, no opaque backing. Row 1 left to right: (1) compact natural amber fire plume with thin curling licking flames and a few embers, (2) slender branching ivory-gold lightning stroke, vertical, fine sparse forks, (3) graceful celadon-water crescent current with 5 droplets, open center, not a crashing ocean wave, (4) drifting rose-colored petal ribbon in an open asymmetric curved sweep with 7 distinct petals and a subtle champagne light thread, NOT a circular pink tornado. Row 2 left to right: (5) light violet and grey poison mist tendrils with empty center, no skull, (6) a translucent pale-gold protective dome arc with subtle geometric light lines, NO physical shield or round coin, (7) delicate pale-jade ground-plane ritual circle made of two thin broken elliptical light rings and four small star-like markers, NO letters or numbers, (8) 3 vertical champagne-gold rising rally wisps, featherlike flowing trails not actual wings. Row 3 left to right: (9) 3 thin silver-blue parallel wind streaks sweeping diagonally upward right, (10) restrained muted crimson binding ring, thin broken light strokes and four ember tips, no ornamental frame, (11) two soft jade healing streams rising around four tiny leaf-shaped light motes, gentle pale ivory core, (12) a long thin bright ivory-gold thrust streak from lower left to upper right, tapered needle point with two almost invisible wispy tails. All elements must be individually centered and completely contained in their 4x3 grid cells. Harmonized effect scale and soft edges, distinct silhouettes, professional layered game effects, not illustrated UI icons.

## 处理记录

1. 使用 image_gen 生成透明背景原图：通用图集 1536 × 1024，元素图集 1448 × 1086。
2. 使用 Cocos 内置图像工具按等分格裁切；通用原格为 512 × 512，元素原格为 362 × 362。
3. 各格等比例缩至 224 × 224，四周补 16px 透明留边，再合成目标图集，防止线性采样越过单格边缘。
4. 通过 AssetDB 导入 PNG 与 SpriteFrame，配置 Linear、Clamp、无 Mipmap。运行时按固定格创建 SpriteFrame，不进行动态图集打包。
5. 保留旧 `skill_effects`、`skill_elements` 素材；新战报舞台加载新图集。

图块是可组合的透明特效元素，不是逐帧技能动画。速度、飞行曲线、扩散、颜色与消散均由回放绝对时间控制。生成素材已在编辑器 Preview 做透明边缘与命中大小检查。
