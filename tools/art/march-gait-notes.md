# 骑将步态修复

使用内置 imagegen 以现有骑将为外观参考生成，再通过 Cocos Image Core 切帧、统一画布与落脚线并由 AssetDB 导入。保留黑色札甲、红披风、长枪与栗色战马。

运行时资源：
- `assets/resources/ui/march/commander_march_front_walk.png`：前斜向 8 帧，4 列 2 行；左前方向镜像。
- `assets/resources/ui/march/commander_march_side_walk.png`：侧向 10 帧，5 列 2 行；左侧方向镜像。

每格 256 × 256，透明背景，蹄底基准 y=236，运行时锚点距底部 18 像素；关闭 mipmap，线性采样、clamp。骑将和护卫共用 0.75 秒步态周期。停驻继续使用原图集最后一格的落地站姿。

生成提示词约束摘要：同一个骑将、固定镜头和体型；前后四腿都要经历伸展接地、承重、弯曲回收与换侧支撑，不能保留一直蜷起的前腿；躯干注册位置稳定，只有少量头部和披风运动；全枪与马尾不得出格；无文字、边框、地面或阴影。侧向另用旧骑兵动作作为步态参考，不采用其白马外观。

侧向使用的生成提示词：

> Create a corrected animation sheet, not a concept sheet. Image 1 supplies ONLY appearance: detailed Chinese mounted commander in black lamellar armor, red cape and plume, upright spear, chestnut horse with gold/red tack. Image 2 supplies the ten sequential HORSE LEG POSES: each pose is different and the lower legs really extend, plant, bend, and recover. Redraw the commander from image 1 in the 10 consecutive poses from image 2, in the same row-major order. Output precisely FIVE columns x TWO rows (ten 256x256 square cells), transparent 1280x512 sprite sheet. ALL characters are facing SCREEN RIGHT in the same side view with slightly elevated isometric camera. Every sprite is the same scale with horse torso and rider centered at the same pixel coordinates, and hoof contact baseline y=238 within the cell. All spear tips and tails fit inside their cell. MOST IMPORTANT: animate the horse, do not simply duplicate a static horse changing only one leg. Both front legs AND both hind legs fully alternate: in one half cycle near foreleg reaches forward and plants while the far foreleg recovers; in the second half the far foreleg reaches forward and plants while the near foreleg recovers. Show straight supporting forelegs, extending-back forelegs, clearly bent swinging forelegs, with valid equine anatomy. Each limb must progress through all these states. Keep all feet below horse belly; natural measured march, avoid exaggerated airborne leap. Slight rhythmic head/cape motion only, no whole-image sliding, no fixed curled injured-looking limb. Sharp realistic miniature illustration matching image 1. No text, no labels, no border, no ground, no cast shadows. The ten different sequential foot silhouettes are essential.

`cavalry_motion_reference.png` 是项目旧骑兵图集提取的动作参考，没有接入运行时。生成未满足透明背景或方向排列的候选未导入。
