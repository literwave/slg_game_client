# 骑将步态修复

## 当前：四拍步行 v6

针对侧向录像中前腿长期蜷曲、承重不清和马身滑行的问题，七个基础视角改为每向十二帧的四拍步行。`commander_walk_grounded_primary_v6.png` 包含侧、斜后、斜前三组；`commander_walk_grounded_axial_v6.png` 包含正、背、陡后、陡前四组。镜像后仍覆盖十二个行进方向。动作参考为美国国家美术馆公开的 Muybridge 第 580 号骑马步行连续照片；角色沿用项目的栗马、札甲、红披风。

马匹周期为 0.96 秒，步兵仍为 0.75 秒；共享单调时钟但不强制同拍。马身不再额外叠加程序弹跳、扭转和纵向压缩。竖格图片放入有留白的正方形 SpriteFrame 画布，避免正背面的马被拉宽；同一组不逐帧改变缩放和亮度。停驻单独使用 `commander_idle_v6.png` 的五个站姿。地图行军不再加载 v4 和陡前蹄子补丁，旧资源保留以便回溯。

来源、处理参数和完整提示词见 `cavalry-grounded-walk-v6.json`。下面是历史版本记录，不代表当前接入。

## 历史：十二帧行军图集 v4

骑将使用七个基础朝向、五个镜像朝向，共十二方向；护卫仍为八方向。每个朝向十二张独立绘制的步行动作。运行时使用 `commander_march_walk12_v4.png` 和 `guard_march_walk12.png`，不再同时读取下文的旧行走图集。

骑将重新绘制了七组共 84 帧。前斜向强调胸部和马头的朝向，后斜向明确露出背部，并补充接近正面/背面的陡斜视角。基础斜向按照地图投影的约 26.6° 注册，陡斜向约 63.4°；选图使用真实屏幕行进角和 3° 防抖余量，避免陡斜路径上仍用侧身图。四条腿交替支撑、弯曲、前伸与落蹄，蹄子保持完整的单蹄形状。原图保存在 `assets/art-source/cavalry-trot-v3`，内置 imagegen 的提示词和 Image Core 处理步骤见 `cavalry-trot-v3-recipes.json`、`cavalry-trot-v4-recipes.json`。

每个方向的十二帧使用完全相同的等比缩放和位移，统一接地基准约 y=178；保留腾空阶段的蹄底高度差，不逐帧裁边、拉伸或把抬起的蹄子强行贴地。固定身体注册位置，禁止用半透明叠帧掩盖动作问题。五张独立站姿继续单独收录，停驻不冻结在抬蹄状态。

验证：真实 PNG 的 84 张步态帧、边界和身体注册检查通过；`march-formation-v2`、`march-depth-regression`、`world-march-presentation` 通过。预览使用独立编队验证 ±56° 路线选中陡斜向、完整播放十二帧、保持不透明，并在到达后恢复独立站姿；未提交游戏行军指令。类型检查无新增诊断，工程仍有 ArmyCommand / ListLogic 的已有错误。额外检查的 `battle-replay-presentation` 在旧的固定锚点断言处失败（当前 192² 图帧为 18/192，断言仍为 18/256）；战报回放不在此次行军修改范围内。

- 骑将图为 10 列 × 9 行，1920 × 1728；护卫为 10 列 × 7 行，1920 × 1344。固定 192² 画布，两边均小于 2048。
- 第 0–59 格按右、右上、上、右下、下排列，每组连续十二帧；第 60–64 格为五个独立站姿。骑将第 65–76 格为陡后斜、第 77–88 格为陡前斜，第 89 格留空；护卫第 65–69 格留空。
- 每方向使用同一个缩放比例，按躯干中心注册横向位置、落脚线 y=178 注册纵向位置；保留透明边缘，禁止运行时自动裁边。
- 循环仍为 0.75 秒，以 16 fps 播放；和 `MarchPose` 使用同一周期，整队时钟、转向相位、到达收步、驻守及服务器路线保持原有规则。
- 加载发生在首次需要显示部队时；行走/站姿共用两张图，另保留两张驻守图，共四张共享纹理，不加入启动必载列表。

原始生成图与参考图在 `assets/art-source/march-walk12`，不放入 resources。使用内置 imagegen 生成真实动作，Cocos Image Core 完成透明边缘清理、裁切、统一尺寸和合图，再由 AssetDB 导入。透明杂点通过源图自身 alpha 蒙版抑制；白底残留使用白色色键去除。未使用变形、复制原帧或相邻帧透明叠加来冒充新动作。

生成约束：同一角色、同一装备、固定方向和视角；包含落脚、承重、抬腿、经过、伸展、换侧等完整步态；每张图十二个不同时间点，不换角色或方向；长枪、马尾和鞋靴完整入格。骑将保留黑札甲、红披风与栗马，护卫保留蓝布、钢甲金边与红缨。错误转向或格数不足的候选不接入。

单向护卫生成提示词及全部裁切/注册参数见 `march-walk12-recipes.json`。回归检查为 `march-walk12-art.cjs` 和 `march-formation-v2.cjs`；前者读取真实 PNG 像素检查重复帧、透明边和落脚位置，后者验证八方向切片、共享加载、完整帧回放、转弯及停止行为。

## 旧版侧向及前斜向补帧记录

使用内置 imagegen 以现有骑将为外观参考生成，再通过 Cocos Image Core 切帧、统一画布与落脚线并由 AssetDB 导入。保留黑色札甲、红披风、长枪与栗色战马。

运行时资源：
- `assets/resources/ui/march/commander_march_front_walk.png`：前斜向 8 帧，4 列 2 行；左前方向镜像。
- `assets/resources/ui/march/commander_march_side_walk.png`：侧向 10 帧，5 列 2 行；左侧方向镜像。

每格 256 × 256，透明背景，蹄底基准 y=236，运行时锚点距底部 18 像素；关闭 mipmap，线性采样、clamp。骑将和护卫共用 0.75 秒步态周期。停驻继续使用原图集最后一格的落地站姿。

生成提示词约束摘要：同一个骑将、固定镜头和体型；前后四腿都要经历伸展接地、承重、弯曲回收与换侧支撑，不能保留一直蜷起的前腿；躯干注册位置稳定，只有少量头部和披风运动；全枪与马尾不得出格；无文字、边框、地面或阴影。侧向另用旧骑兵动作作为步态参考，不采用其白马外观。

侧向使用的生成提示词：

> Create a corrected animation sheet, not a concept sheet. Image 1 supplies ONLY appearance: detailed Chinese mounted commander in black lamellar armor, red cape and plume, upright spear, chestnut horse with gold/red tack. Image 2 supplies the ten sequential HORSE LEG POSES: each pose is different and the lower legs really extend, plant, bend, and recover. Redraw the commander from image 1 in the 10 consecutive poses from image 2, in the same row-major order. Output precisely FIVE columns x TWO rows (ten 256x256 square cells), transparent 1280x512 sprite sheet. ALL characters are facing SCREEN RIGHT in the same side view with slightly elevated isometric camera. Every sprite is the same scale with horse torso and rider centered at the same pixel coordinates, and hoof contact baseline y=238 within the cell. All spear tips and tails fit inside their cell. MOST IMPORTANT: animate the horse, do not simply duplicate a static horse changing only one leg. Both front legs AND both hind legs fully alternate: in one half cycle near foreleg reaches forward and plants while the far foreleg recovers; in the second half the far foreleg reaches forward and plants while the near foreleg recovers. Show straight supporting forelegs, extending-back forelegs, clearly bent swinging forelegs, with valid equine anatomy. Each limb must progress through all these states. Keep all feet below horse belly; natural measured march, avoid exaggerated airborne leap. Slight rhythmic head/cape motion only, no whole-image sliding, no fixed curled injured-looking limb. Sharp realistic miniature illustration matching image 1. No text, no labels, no border, no ground, no cast shadows. The ten different sequential foot silhouettes are essential.

`cavalry_motion_reference.png` 是项目旧骑兵图集提取的动作参考，没有接入运行时。生成未满足透明背景或方向排列的候选未导入。
