# 二维 / 三维地图编辑器实施约定

## 产品决策

第一阶段的主要编辑体验采用经典掌机 RPG 风格的正交俯视像素地图。它不是 GIS 多边形编辑器，也不取代现有 GIS 校准工具。地图浏览和后续三维展示继续使用 Three.js。

编辑器提供二维搭建视图与三维浏览视图，最终共享校园空间数据；视图切换不复制或迁移业务实体。

## 数据边界

- GIS Feature Geometry 是建筑、道路、水体、绿地等空间实体平面位置与轮廓的唯一事实来源。
- RPG Tile Layer 负责地表纹理、装饰性道路/水面铺陈和像素风视觉表达。它不能成为真实建筑 footprint 的第二份权威数据。
- 场景对象通过 featureId 关联 GIS Feature；三维楼层、高度、模型、材质等放在 Scene Object。
- 纯装饰物（树、花坛、路灯等）可作为 RPG 文档对象；需要空间检索或导航的设施必须升级为 GIS Feature。
- 地图坐标与 Three.js XZ 坐标只能经 mapCoordinateMapper 转换。编辑器 tile 坐标通过明确的网格到 campus-local 转换，不得默认等于米。

## 当前交付切片

- `src/editor/rpgMapDocument.js`：版本化 RPG 地图文档、基础素材清单、网格校验和瓦片绘制操作。
- `src/editor/RpgMapEditor.vue`：俯视瓦片画布、素材选择、图层选择、装饰对象放置和本地 JSON 草稿导出。
- `src/editor/rpgMapDocument.test.js`：数据模型、网格边界和 GIS 关联约束测试。
- App 入口增加二维搭建入口；原 GIS 编辑器文件保留，不覆盖其底图上传、配准和矢量化能力。

本切片是前端交互原型。草稿导出为本地 JSON，不代表已持久化到服务端；目前还没有将 RPG Tile Document 写入数据库，也没有完成 RPG Tile Layer 到 Three.js 的渲染适配。

## 后续里程碑

1. 将 Tile Document 纳入服务端版本化保存，并增加 mapId、revision、权限和冲突校验。
2. 建立 tile-grid ↔ campus-local 的明确坐标转换，校验单位与画布范围。
3. 将 GIS Feature + Scene Object + Tile Layer 聚合为统一场景读取 DTO。
4. 编写 Three.js Tile Layer Adapter，将地面/道路/水域瓦片渲染到 XZ 平面；建筑仍由 Feature Geometry + Scene Object 生成。
5. 增加二维/三维视图切换，保留相机状态，并保证两个视图使用同一 revision 的场景数据。
6. 后续再开放三维对象拖拽编辑，并将变更反算为 GIS Feature 更新，采用乐观锁。

## 验收红线

- 不把本地导出的 JSON 说成服务端已保存。
- 不把示意瓦片、示意建筑或未经核实的属性标记为测绘事实。
- 不在 Tile Document 与 GIS Feature 中重复保存建筑 footprint。
- 不将 pixel/editor-tile 坐标冒充真实米制坐标。
- 三维视图没有完成数据适配前，不展示“二维/三维已同步”的产品承诺。
