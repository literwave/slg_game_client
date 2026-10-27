# 原创地图美术与布局

布局版本3：四种资源的类型和等级逐格混排，四方向无连续三格同类型/同等级；资源州和王畿新增 `fixed-inner-resources.json` 的658个固定高级点。城池占地为3×3、5×5、9×9，使用三种既有城池立绘。配比、构建、导出与新资源地协议（含石料待补配置）见 `docs/资源混排与协议接入.md`。整图混排检查运行 `python tools/tests/mixed-resource-layout-regression.py`。

当前地图为 **1000×1000 格**，单格 200×100；采用“六出生州 → 三资源州 → 王畿洛阳”的关隘推进布局。玩法、服务端接入边界和完整关口表见 `docs/千里山河地图设计.md`。下文的旧地图迁移过程保留作美术来源记录，不再代表当前玩法坐标。

出生州4～6级全部读取 `fixed-birth-resources.json` 的6069个固定点，间距分别受8/28/48格约束，不再生成连续4级带或围绕出生点的高级地圆环。规则和后端导出步骤见 `docs/出生州固定资源配置.md`。`plan-dispersed-birth-resources.py` 仅用于另存离线候选表，构建器不会调用或重新编排它。

山脉美术布局版本5使用连体山脊 `mountain_ridge_connected` 和低山肩 `mountain_shoulder`。`mountain_layout.py` 沿阻挡带估算山脊方向，按PNG透明轮廓合并覆盖，再剔除冗余山体；不再逐格堆叠压扁的谷地。两张素材分别为1024×486、768×390透明PNG，线性采样并开启mipmap；原素材保留。单独重排美术运行 `python tools/world/mountain_layout.py`，只更新地貌中的patches，不改资源、阻挡、水系、关口和服务端配置。`python tools/tests/mountain-continuity-regression.py` 验证连接段覆盖和关口可点击空间；`mountain-renderer-regression.cjs` 验证客户端空间桶、锚点、翻转与节点复用。

新山体由内置imagegen生成，经Cocos Image Core透明裁边、等比例缩放和AssetDB导入。提示词要点：历史中国2:1等距策略地图、连接的宽缓灰绿山脊或低山肩、不等高峰与松林坡面、左上柔光、窄而自然的透明山脚；无尖柱、方形底座、建筑、文字或发光。

## 素材

全部新素材位于 `assets/resources/ui/world/`，使用内置 image_gen 生成，再通过 Cocos Image Core 裁切、缩放、保留透明通道并经 AssetDB 导入。没有以旧游戏素材作为生成参考。

- 平原与水面：`plains`、`water`，各 512×512。
- 四种山体：`ridge`、`foothills`、`peaks`、`valley`，最长边 512。
- 四种城池：`town`、`county`、`capital`、`fort`，最长边 512。
- 林地、铁矿、石场、农田：`forest`、`iron`、`quarry`、`grain`，最长边 512。
- 低等级自然资源：对应四种 `wild_` 素材，最长边 256。

统一生成提示：原创历史中国战略地图；2:1 等距正交视角；左上柔光；克制的手绘水粉与细墨线；灰绿、赭黄、灰石色；哑光；清晰小尺寸轮廓；无文字、水印、方形底座、发光描边、现有游戏参考。

各组附加提示：

1. 平原：完全俯视、可重复铺贴的草地与少量干土；低对比度；无树木、水面、建筑、格线和暗角。
2. 水面：可重复铺贴的灰青玉色淡水细波纹；均匀光线；无岸、船、岩石和大块泡沫。
3. 山体：不等高石灰岩长脊、赭色圆丘、青灰高峰、低矮谷地；零散松树；四个独立透明轮廓。
4. 城池：夯土乡镇、石墙县城、重院大城、木寨边关；不同屋顶和城墙轮廓；四个独立透明轮廓。
5. 资源：林木与伐木屋、暗色铁矿与矿洞、浅色石场、弯曲金黄田畦；小块不规则接地面；透明背景。
6. 低等级资源：三棵疏树、铁矿露岩、石灰岩碎块、稀疏野生谷草；不带房屋、工具、围栏。

## 布局与渲染

`build-original-landscape.cjs` 读取玩法表的空白/阻挡廊道，输出 `assets/resources/world/original-landscape.json`。775 个已有非资源格组成三组水系，其余地貌用四类山体重新铺设；外缘增加非交互山林。

地形材质按世界坐标连续采样原创草地和水面。河流掩码由原逻辑格生成，使用线性插值平滑河岸。地图边缘向外延伸为不等宽的岸线，角落平滑，远水渐入雾色；所有合法格子保留陆地和原坐标。

TMX 仍保存地图尺寸和 `obstruct`、`city_position` 逻辑层，已移除旧地形图集依赖。逻辑层中原来的非零 GID 归一为 1，非零位置不变，兼容现有 MapTool。山体由 `WorldLandscape` 按视口复用；`WorldMapArt` 在入图时加载并校验全套素材。

地图资源和城池 Prefab 已解除旧图集绑定。旧图片文件留在项目中供回退和其它既有引用使用，本次没有批量删除它们。UI、角色和部队素材不在本次地图美术替换范围。

重新生成当前地图：`python tools/world/build-campaign-map.py`；该脚本更新资源表、地貌和关口配置，TMX 暂存在 `temp/campaign-map/map.tmx`，须通过 Creator AssetDB 的 `save-asset` 保存到现有 `db://assets/resources/world/map.tmx`，保留 UUID。旧的 `build-original-landscape.cjs` 仅适用于旧200格地图，已加入尺寸保护。

验证：`python tools/tests/campaign-map-regression.py`；另使用 Creator 内置 Node / TypeScript 运行 `tools/tests/map-navigation-regression.cjs` 与 `tools/check-client-types.cjs`。实际 Preview 的视觉、关隘战斗和联网结算仍需在服务端同步地图后验收。
