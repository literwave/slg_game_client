# 山脉错落与山脚融合

原布局偏向最大覆盖率，且用水平镜像适配山带方向，造成重复的斜向山墙和相反的明暗面。

- 主峰、低鞍部和紧凑山肩组合；沿山带加入连续摆动与小幅错位，大小和高低有稳定变化。
- `offsetX/offsetY` 使用 200×100 制作基准，显示时随地图比例投影。逻辑坐标仍为原山地格。关口贴墙山肩固定在原位置。
- 所有山体保留左上光照，不翻转图片。半透明山脚通过共享材质混入相同世界坐标的草地纹理，保留实体岩面和树木明暗。
- Alpha 混合沿用 [Creator 3.8 的混合状态参数](https://docs.cocos.com/creator/3.8/manual/en/shader/pass-parameter-list.html)，不旋转二维山体造成山峰倾斜。

## 方案二重绘（地貌版本 9）

四张山体已用内置图像生成重绘为岩壁、碎石坡、裸土、灰绿灌木草地的分层过渡：`mountain_massif_scree_v9`、`mountain_ridge_scree_v9`、`mountain_shoulder_scree_v9`、`mountain_saddle_scree_v9`。原图的投影、左上光照保持一致，山脚使用不规则碎石和灌木轮廓。完整生成提示词、处理参数及校验摘要见 `mountain-scree-v9.json`。

资源位于 `assets/resources/ui/world/`，通过 Image Core 裁去透明空边并按比例缩小。高峰、连脊、鞍部宽 1024，低山肩宽 768；全部保留透明通道，使用线性过滤、clamp 和 mipmap。Creator 已确认 ImageAsset、Texture、SpriteFrame 导入及设置。早期 v8 稿不在运行时预载或绑定名单中。

根据新图实际透明轮廓重新生成 2410 个贴片（上一版 2448 个），通过同一组 `MOUNTAIN_ARTS` 控制使用与预载。运行时只保留视口附近节点并复用。未改山地阻挡、河流、资源表、城关位置和地图 TMX；三份游戏地形源文件的 SHA256 与修改前一致。

本轮离线验证：177016 个山带采样点全部覆盖，12 座山口的 24 个入口保持可通行地形，18 个关隘点击目标及节点复用回归通过。河岸、斜向山带和潼关使用真实素材及 Creator 导入后的材质进行离线对比；本轮未启动游戏 Preview。材质未在本轮修改，上一轮 WebGL 1/2 编译和 200×100、200×125 投影检查结果仍可参考。

Creator 已确认新布局为有效 JsonAsset。加载回归的前 17 项通过，随后遇到 `Hero has stale boot data`：英雄源配置与已有启动缓存不一致，本轮未改英雄数值或重建启动配置。WorldMapArt.ts 与 WorldLandscape.ts 无编译诊断，全项目仍有 214 项既有用户代码诊断。
