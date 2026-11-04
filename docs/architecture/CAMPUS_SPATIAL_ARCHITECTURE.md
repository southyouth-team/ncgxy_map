# 校园空间建模与渲染架构

状态：当前架构决策；详细产品目标见仓库根目录 `PROJECT_GOALS.md`。

## 1. 模块边界

- **校园探索应用层**：入口、视图切换、漫游交互、对象详情、导航。
- **地图编辑器应用层**：底图校准、图层/对象选择、几何绘制、属性编辑、保存、预览。
- **统一空间数据层**：Feature、Geometry、属性、质量状态、资产引用、关系。
- **2.5D 渲染适配层**：等距相机、像素风资产、遮挡、角色和碰撞。
- **3D 渲染适配层**：透视/正交相机、三维建筑与环境资产、光照和漫游。
- **空间服务层**：校园/地图/图层/Feature 的持久化、版本与权限。

## 2. 数据契约原则

一个空间对象只能有一个权威几何和稳定 ID。视图层不得私自复制或重定义校园布局。

推荐 Feature 表达：
- `id`、`campusId`、`mapId`、`layerId`、`type`
- `geometry`：GeoJSON Geometry
- `properties`：业务属性
- `source`、`qualityStatus`、`schemaVersion`
- 可选 `assetRef`、`rendering`、`relationships`

坐标系统、单位、原点和轴向必须明确。当前项目已有 campus-local/pixel-to-world 转换，不能把局部像素坐标误认为经纬度或米；所有渲染坐标转换集中在适配层。

## 3. 对象几何规范

| 类型 | 几何 | 渲染生成 |
|---|---|---|
| building | Polygon/MultiPolygon | footprint 拉伸、楼层/高度、屋顶 |
| road | LineString/MultiLineString + width | 路面带、边缘、标线、连接 |
| tree | Point / 实例集合 | 树干、树冠、碰撞半径 |
| water | Polygon/MultiPolygon | 水面、岸线 |
| green_area | Polygon/MultiPolygon | 地表、植被 |
| plaza/sports/parking | Polygon/MultiPolygon | 地面材质及设施 |
| facility | Point + rotation/size 或实例 | 资产模板实例 |

道路应保留中心线、宽度和连通关系；不得只保存渲染后的多边形而丢失道路语义。树木/设施不应强制绘制成面。

## 4. 视图转换契约

2.5D 和 3D 渲染器均接收同一份标准化 Feature 集合：
- 读取同一 ID、几何和属性。
- 坐标适配由统一转换函数完成。
- 2.5D/3D 可以选择不同资产和材质，但不得修改源几何。
- 选中对象、编辑对象和导航目标通过稳定 ID 关联。
- 编辑器预览与校园探索调用相同渲染适配器，避免预览与首页两套实现。

## 5. 编辑器工作流

1. 选择底图/地图版本并校准坐标。
2. 选择对象类型（建筑、道路、树木、水域、绿地、广场、设施等）。
3. 选择与类型匹配的绘制工具（点、线、面、实例）。
4. 绘制几何并输入必要属性。
5. 校验几何合法性、属性完整性和空间关系。
6. 保存为统一空间 Feature。
7. 通过 2.5D/3D 渲染适配器预览。
8. 发布/保存版本后，校园探索读取同一数据。

## 6. 当前代码整改原则

- 先理顺入口与生命周期，再调整渲染器内部结构。
- 不以 query 参数的多个别名长期承担产品路由语义。
- 2.5D/3D 切换不能通过加载不同虚构校园场景实现。
- 当前样板场景只作为视觉验证资产；逐步将其视觉规范迁移到真实校园数据渲染。
- 室内能力保留但不占用当前户外建模主线。

## 7. 统一 FeatureCollection 迁移状态

当前编辑器的交互层仍使用 buildings / roads / areas / objects 四类集合，以降低现有工具、属性面板和撤销重做逻辑的迁移风险；但保存与预览边界已增加标准 GeoJSON `featureCollection`：

- 建筑：Polygon，名称、楼层、模板等放入 properties。
- 道路：LineString，中心线保持为权威几何，width 保存在 properties。
- 绿地/水域/运动场/广场/停车场：Polygon，支持内环 holes。
- 树木/路灯/座椅/雕塑等：Point，类型、朝向、缩放等放入 properties。
- 每个 Feature 保留稳定 id、source、qualityStatus；坐标仍为 campus-plan-pixel，不是经纬度或米制坐标。

编辑器加载优先读取 FeatureCollection，并通过过渡适配器提供旧交互集合；保存时生成 FeatureCollection；Three.js 编辑器预览优先消费 FeatureCollection，再适配到当前渲染流程。旧 buildings/roads/areas/objects 字段暂时保留为兼容字段，尚未完成服务端 canonical-only 存储和所有渲染器的统一迁移。


## 8. 编辑器 FeatureCollection 到渲染图层的统一归一化

`getCampusSpatialLayers(collection)` 现在同时支持基础校园数据格式（`featureType: area + category`）和编辑器保存格式（`featureType: green/water/sports/plaza/parking`）。道路、建筑、区域和 Point 设施均从传入的 FeatureCollection 派生；不会为这些对象复制第二份几何。

- 置信度读取兼容 `confidence` 与编辑器 `qualityStatus`。
- 道路几何只接受 LineString，宽度统一为正数并提供安全默认值。
- 建筑 Polygon 派生 footprint，同时保留楼层、高度、模板等渲染属性。
- 区域 Polygon 保留外环与 holes，映射为既有校园场景区域类型。
- Point 设施保留 feature ID、类型、坐标、朝向、缩放和来源。
- 基础数据中的 boundary、gate、poi 仍按既有类型单独识别。

该步骤建立了从编辑器统一数据契约到通用校园渲染图层的适配能力；当前尚未把首页启动流程完全切换为注入编辑器 FeatureCollection，也未完成所有 2.5D/3D 渲染路径统一，不能据此宣布双引擎转换完成。


## 9. 首页场景初始化消费统一 FeatureCollection

首页不再先创建一份静态校园场景、再通过 `previewCampusPlan()` 覆盖显示另一份编辑器地图。当前首页在创建引擎前准备校园 FeatureCollection，并通过 `createCampusEngine({ featureCollection })` 注入 `createCampusScene()`；场景构建时统一调用 `getCampusSpatialLayers(featureCollection)` 派生建筑、道路、区域和 Point 设施。

- 编辑器 FeatureCollection 是可编辑空间对象的场景输入；基础数据中的 boundary/gate 结构要素继续由校园基础数据提供。
- 建筑、道路、区域及点设施由同一份集合派生；道路宽度参与场景铺装宽度计算，区域多边形和内环进入地表构建，点设施按类型生成场景资产。
- 静态树木、花卉、长椅、路灯等原有装饰实例仍有部分保留在场景脚本中，尚未全部迁移为可编辑 Feature；因此“所有校园环境对象均已统一数据化”仍未达成。
- 编辑器内部 3D 预览仍保留独立预览路径，待后续统一 renderer adapter。

本次完成首页场景初始化数据源的第一步收敛，不代表真实校园测绘精度验收，也不代表 2.5D/3D 双引擎转换阶段完成。


## 10. 环境装饰对象迁移状态

原场景脚本中独立维护的树木、花卉、长椅和路灯坐标已迁移到 `buildCampusGeoJSON()` 输出的 Point Feature：
- 树木、花卉、长椅、路灯均使用稳定 ID、Point 坐标和 objectType。
- 这些历史装饰对象统一标记为 `source: legacy-scene-decoration`、低置信度和未核验状态；坐标仅是既有场景视觉位置，不代表实地核验。
- 首页将这些基础环境对象与编辑器 FeatureCollection 合并，编辑器中同 ID 的对象可覆盖基础记录。
- `createCampusScene` 不再单独保存这四类装饰物的坐标数组，统一从空间图层生成资产。
- 花卉作为 Point Feature 的一种对象类型参与场景构建。

本迁移仅覆盖此前场景脚本中四类硬编码装饰物；未将所有 POI、校园设施、建筑附属细节和完整环境材质数据化。当前编辑器删除基础装饰对象的 tombstone 语义仍未定义，后续需要在数据文档层补齐删除同步规则。

## 11. 基础对象删除同步（Feature tombstones）

基础校园 Feature 与编辑器用户文档采用按 ID 合并策略。对于编辑器可见的基础环境对象，单纯从编辑数组移除不足以表达删除：首页下一次加载时仍会从基础数据源合并该对象。

当前迁移期通过 FeatureCollection 扩展字段 `deletedFeatureIds` 保存删除标记：
- 编辑器删除来源为 `legacy-scene-decoration` 的对象时，将稳定 ID 写入删除集合。
- 删除标记与 FeatureCollection 一起保存；加载时恢复。
- undo/redo 快照包含删除标记，避免撤销/重做后状态漂移。
- 首页合并基础结构/装饰 Feature 与编辑器 Feature 后，按 `deletedFeatureIds` 过滤，避免被删除对象重新出现。
- FeatureCollection 正向/反向适配器均保留删除标记。

该字段是迁移期的删除同步机制，不是 GeoJSON 标准字段。未来服务端空间数据模型应将对象版本、删除状态和编辑权限纳入正式持久化契约，并定义删除冲突处理、恢复对象和审计记录。

## 12. 首页场景 Feature 合并契约

首页场景初始化通过 `mergeCampusSceneFeatureCollections(base, editor)` 统一合并：
- 基础数据仅提供校园边界、出入口和基础环境对象（`boundary/gate/object`）默认 Feature。
- 编辑器 Feature 以稳定 ID 覆盖同 ID 基础 Feature，并可增加新对象。
- `deletedFeatureIds` 在合并末端统一过滤，删除优先级高于基础数据与编辑器 Feature。
- 合并函数为纯数据函数，可在单元测试中验证，不将合并规则散落在 Vue 生命周期内。

当前建筑、道路和区域仍由编辑器 FeatureCollection 提供覆盖/新增；基础校园台账中尚未具备可定位几何的 POI 与场地记录继续保持待定位状态，不伪造 Point/Polygon。后续应在统一数据契约中为未定位记录定义独立的非空间状态，而不是将空坐标塞入 GeoJSON Feature。

## 13. 非空间校园目录与空间 Feature 的边界

尚未取得可靠坐标的 POI、场地和建筑身份台账不应伪装成 GeoJSON Point/Polygon。基础 FeatureCollection 的 `metadata.catalogue` 保存非空间目录：
- `pois`：名称、分类、名称来源状态、定位状态、可选 buildingId/position。
- `siteAreas`：场地名称/分类、几何状态与来源；geometry 为空时不生成 Feature。
- `buildingMetadata`：建筑身份、用途分类、楼栋编号和 footprint 核验状态。

`getCampusSpatialLayers` 从同一 FeatureCollection 的 catalogue 读取 POI/场地目录；合并基础 Feature 与编辑器 Feature 时保留基础 metadata。目录记录与空间几何是同一数据集中的不同数据域，待取得可靠定位后再转为正式 Feature，并保留稳定 ID 和来源。

## 14. 首页与编辑器预览共享场景适配器

`src/three/world/campus/campusSceneData.js` 是统一 FeatureCollection 到渲染输入的共享适配边界：
- 输入：规范化校园 FeatureCollection。
- 输出：`getCampusSpatialLayers` 产生的标准空间图层，以及供编辑器预览兼容渲染代码使用的 `previewDocument`。
- 首页 `createCampusScene` 从该适配器读取 layers。
- 编辑器 `previewCampusPlan` 将规范 FeatureCollection（旧文档则先经 `toCampusFeatureCollection` 转换）送入同一适配器，再消费 previewDocument。
- 建筑 footprint、道路中心线/宽度、区域 Polygon/holes、点对象坐标/朝向/缩放均由同一 FeatureCollection 派生。

此改动统一了数据归一化入口，但不代表两个渲染器已经是两套独立引擎：目前首页主场景和编辑器预览仍由 Three.js 渲染；第四阶段还需要建立独立 2.5D 与 3D renderer contract，并验证同一输入的几何一致性。
