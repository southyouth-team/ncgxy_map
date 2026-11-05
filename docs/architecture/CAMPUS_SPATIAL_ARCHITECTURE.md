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

- 置信度只读取合法的 `confidence`；缺失或非法时保守回退为 low，不再从核验状态字段推导置信度。
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

本迁移仅覆盖此前场景脚本中四类硬编码装饰物；未将所有 POI、校园设施、建筑附属细节和完整环境材质数据化。基础对象删除同步已在第 11、16 节定义。

## 11. 基础对象删除同步（Feature tombstones）

基础校园 Feature 与编辑器用户文档采用按 ID 合并策略。对于所有基础校园对象，单纯从编辑数组移除不足以表达删除：首页下一次加载时仍会从基础数据源合并该对象。

当前迁移期通过 FeatureCollection 扩展字段 `deletedFeatureIds` 保存删除标记：
- 编辑器删除任何基础 Feature（建筑、道路、区域、边界、出入口或环境对象）时，将稳定 ID 写入删除集合。
- 删除标记与 FeatureCollection 一起保存；加载时恢复。
- undo/redo 快照包含删除标记，避免撤销/重做后状态漂移。
- 首页合并完整基础 Feature 底集与编辑器 Feature 后，按 `deletedFeatureIds` 过滤，避免被删除对象重新出现。
- FeatureCollection 正向/反向适配器均保留删除标记。

该字段是迁移期的删除同步机制，不是 GeoJSON 标准字段。未来服务端空间数据模型应将对象版本、删除状态和编辑权限纳入正式持久化契约，并定义删除冲突处理、恢复对象和审计记录。

## 12. 首页场景 Feature 合并契约

首页场景初始化通过 `mergeCampusSceneFeatureCollections(base, editor)` 统一合并：
- 全部基础 Feature（校界、出入口、建筑、道路、区域、环境对象）作为默认底集。
- 编辑器 Feature 以稳定 ID 覆盖同 ID 基础 Feature，并可增加新对象。
- `deletedFeatureIds` 在合并末端统一过滤，删除优先级高于基础数据与编辑器 Feature。
- 合并函数为纯数据函数，可在单元测试中验证，不将合并规则散落在 Vue 生命周期内。

编辑器 Feature 以稳定 ID 覆盖底集对象并可追加新对象；基础校园台账中尚未具备可定位几何的 POI 与场地记录继续保持待定位状态，不伪造 Point/Polygon。后续应在统一数据契约中为未定位记录定义独立的非空间状态，而不是将空坐标塞入 GeoJSON Feature。

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

## 15. 空间图层属性保真要求

共享空间图层适配器除归一化几何外，必须保留原 Feature 的完整 `properties`。建筑模型预览会读取入口边、屋顶、楼层、窗户密度和门宽等参数；道路和场地也可能携带路面材质、车道数、通行属性、水体属性及质量来源。适配层不得只挑选当前渲染器已使用的字段，否则后续渲染器扩展会发生静默属性丢失。

标准图层同时提供便于现有渲染器消费的顶层常用字段和完整 `properties` 副本。新增属性应优先进入 Feature.properties，渲染器按需解释，不在多个视图中复制维护业务值。

## 16. 基础校园数据与编辑器覆盖/删除的完整合并规则

首页与编辑器必须使用相同的基础校园 Feature 底集。合并规则为：
1. 全部基础 Feature（校界、出入口、建筑、道路、区域、环境设施）按稳定 ID 建立底集。
2. 编辑器保存的 Feature 按 ID 覆盖同 ID 基础对象；不存在的 ID 作为新增对象。
3. `deletedFeatureIds` 最后执行过滤，删除优先于基础 Feature 和编辑器 Feature。
4. 编辑器首次打开及加载旧版稀疏文档时，基础建筑/道路/区域/环境对象作为默认数据补齐；已保存编辑对象按 ID 覆盖。
5. 单项和批量删除基础对象都必须写入 tombstone；保存文档时同时写入顶层兼容字段和 FeatureCollection 字段。

这避免了编辑器只保存局部改动后，首页因只合并编辑器文档而丢失未被编辑的基础建筑、道路或区域。恢复对象需要移除对应 tombstone，后续将提供明确的恢复操作和冲突审计。

## 17. Feature 类型与几何契约质检

空间数据质检必须校验业务类型和几何类型的一致性，而不只是检查坐标数值：
- `boundary/building/area/green/water/sports/plaza/parking` 必须是 Polygon。
- `road` 必须是 LineString。
- `gate/poi/object` 必须是 Point。
- 每个集合成员必须是 Feature，且声明受支持的 `properties.featureType`。
- 新增业务类型必须先更新类型契约和测试，再允许进入正式数据集。

这能拦截水域被错误写成 Point、树木被错误写成 Polygon 等静默进入渲染流程的问题。当前仍只接受 Polygon、LineString、Point；MultiPolygon/MultiLineString 尚未纳入渲染适配器契约。

## 18. 编辑器删除操作入口约束

所有对象删除入口必须调用统一删除命令，不允许属性面板或快捷操作直接过滤业务数组。统一删除命令负责图层锁校验、undo 快照、基础 Feature tombstone 和选中状态清理；否则不同入口会产生不同持久化语义。

## 19. 编辑器质量字段与统一数据质检映射

编辑器历史文档使用 `qualityStatus`，基础空间数据质检使用两个独立字段：
- `confidence`：low / medium / high，表达数据置信度。
- `verificationStatus`：verified / unverified，表达人工核验状态。

Feature 序列化适配器必须保留原始 `qualityStatus`，并确保以上两个标准字段合法。不得将 `unverified` 直接写入 `confidence`。当旧文档没有置信度时，按保守默认值 low + unverified 输出；已核验对象默认 medium + verified。来源和置信度仍需根据实际资料人工校准。

点对象的规范类型固定为 `featureType: object`，具体设施类别放在 `objectType`（例如 tree、bench、streetlight）。不得把具体资产类型直接作为 featureType，否则统一几何契约无法识别其 Point 语义。

## 20. 属性面板修改与撤销/重做

属性面板通过 `v-model` 修改对象属性时，必须在用户开始编辑前记录 undo 快照。否则自动保存会持久化修改，但撤销栈中没有修改前状态。当前通过控件 focus 建立快照；未来若引入复杂输入控件，应统一接入编辑事务入口。


## 21. 置信度与核验状态的字段隔离

三个字段具有不同语义，不得互相赋值：

- `confidence`：数据置信度等级，仅允许 `low`、`medium`、`high`。
- `verificationStatus`：人工核验状态，仅允许 `verified`、`unverified`。
- `qualityStatus`：编辑器迁移期字段，保留历史核验状态；当前规范值为 `verified` 或 `unverified`。

正向序列化时优先保留合法的显式 `confidence` 和 `verificationStatus`；缺失时按 `qualityStatus` 保守推导，未核验对象默认为 low + unverified。旧版 `confidence` 不得作为 `qualityStatus` 的回退来源。

反向适配时分别恢复三个字段，不能用 `qualityStatus` 覆盖 `confidence`。统一质检必须直接针对编辑器生成的 FeatureCollection 执行，以确保保存边界的数据契约与基础校园数据一致。


## 22. 点对象基础数据加载规则

编辑器从基础 FeatureCollection 初始化 Point 对象时，必须保留 `confidence` 与 `verificationStatus` 在对象 `properties` 中；编辑器迁移字段 `qualityStatus` 只能来自同名字段或 `verificationStatus`，禁止回退到置信度字段。点对象的坐标、朝向、缩放、来源及质量元数据必须在加载、保存和反向适配中完整保留。


## 23. 第三阶段验收边界与编辑器权威状态

当前统一空间数据的已完成边界为：

1. GeoJSON FeatureCollection 是保存与渲染交换边界的规范格式。
2. 基础校园空间 Feature 与编辑器 Feature 按稳定 ID 合并，编辑器覆盖同 ID 基础要素，删除标记在合并后过滤。
3. 首页与编辑器预览通过共享适配器从 FeatureCollection 派生相同空间图层。
4. 质量字段 `confidence`、`verificationStatus` 与迁移字段 `qualityStatus` 分离。

当前未完成边界：编辑器仍以四组响应式 legacy 数组作为交互工作状态，在保存/预览时再序列化为 FeatureCollection。因此不能称 FeatureCollection 已是编辑器内部唯一权威状态，也不能宣布第三阶段完全验收。

后续迁移要求：
- 以单个响应式 FeatureCollection 作为编辑器唯一可变空间状态。
- 工具栏、绘制、拖动、批量选择、复制粘贴、属性面板、撤销/重做全部通过 Feature ID 与 geometry/properties 操作该集合。
- legacy 数组只允许作为有明确生命周期的只读兼容视图，不得与 FeatureCollection 双向独立写入。
- 保存、首页渲染、编辑器预览都直接消费该权威 FeatureCollection。
- 保持 schemaVersion 旧文档读取能力，并提供可回滚的迁移测试。


## 24. FeatureCollection 版本化历史快照

编辑器 undo/redo 历史现统一存储版本化 `CampusFeatureSnapshot`，其空间载荷为单一 GeoJSON FeatureCollection，删除标记随快照保存。恢复通过规范反向适配器生成当前交互模型；旧版四数组历史快照保留读取兼容。

该改动收敛了历史记录的空间数据契约，但不改变当前编辑器四组响应式数组仍作为实时工作状态的事实。不能将此项改动等同于 FeatureCollection 已成为编辑器唯一可变状态。


## 25. 按稳定 Feature ID 执行空间状态变更

规范 FeatureCollection 的变更必须通过不可变 mutation API 完成，当前提供 upsert、properties patch、geometry replacement 和批量删除。所有操作以稳定 Feature.id 定位，删除可写入 tombstone，恢复同 ID Feature 时清除对应 tombstone。

这些函数是实时编辑器迁移的基础契约。迁移完成前，旧数组工作模型仍然存在；不得在 UI 中同时维护两套可写状态，也不得用深度 watch 做双向同步。


## 26. 属性检查器写入路径

属性检查器不得直接对选中对象引用执行双向绑定。属性修改应显式提供 Feature ID 和字段 patch，经规范 FeatureCollection mutation API 更新，再通过兼容适配器刷新当前交互视图。对象属性和几何仍须保持既定语义：Point 对象的 rotation/scale 属于 properties，区域类型通过 areaType 映射，建筑显示名称通过 Feature properties.name 映射。

当前属性检查器已采用该写入路径；画布绘制、拖动、顶点编辑、复制粘贴等操作尚未全部迁移。此处属于分阶段迁移状态，不构成编辑器唯一状态源验收。


## 27. 新增与删除的 Feature mutation 接入

编辑器新增空间要素应先将 legacy 输入转换为 Feature，再通过 `upsertCampusFeature` 按稳定 ID 写入 FeatureCollection；删除应通过 `removeCampusFeatures` 完成。删除基础校园 Feature 时必须记录 tombstone，防止基础数据合并时对象复活。mutation 完成后，当前迁移期交互数组由 `fromCampusFeatureCollection` 重新派生。

目前属性检查器、手工新增、AI 识图导入、单选删除和批量删除已接入该流程。拖动、顶点和道路节点编辑、复制粘贴仍有 legacy 数组直接写入点，不能将此阶段描述为唯一数据源完成。


## 28. 几何交互写入规范

几何交互（整体拖动、顶点/道路节点拖动、多选移动、点对象拖动）应按稳定 Feature ID 调用 `updateCampusFeatureGeometry`，不得以直接修改选中对象引用作为持久状态变更。更新时只替换 geometry，不覆盖 properties、source、confidence、verificationStatus、qualityStatus 等元数据。拖动起点的几何快照用于计算位移；每次指针更新都以当前规范 FeatureCollection 为 mutation 输入。

当前上述主要拖动路径已接入 mutation API，但编辑器加载、历史恢复、保存仍使用 legacy 数组作为迁移期投影；性能与真实浏览器交互尚待验收，不能据此宣称 FeatureCollection 已成为唯一实时状态源。


## 29. 编辑器规范空间状态主源

编辑器维护 `spatialFeatureCollection` 作为实时空间状态主源。新增、删除、属性更新、几何更新均通过不可变 FeatureCollection mutation API 更新该集合。保存文档、导出、预览以及历史快照的空间内容必须从该集合派生，不能再由四组 legacy 数组反向组装。

现有 SVG 编辑器仍可通过 `fromCampusFeatureCollection` 获得建筑/道路/区域/对象数组作为兼容视图；兼容数组不是权威数据。加载旧格式时允许先转换为 FeatureCollection；加载服务端 FeatureCollection 时必须优先读取规范集合。撤销/重做恢复后必须同步替换规范集合。

任何尚未迁移的直接几何写入都是迁移缺口，不得将该状态描述为完全完成。当前已迁移主要拖动、对齐/分布、顶点增删、尺寸/旋转、道路节点和复制粘贴路径；仍需通过真实浏览器验收验证交互状态、自动保存和服务端回读。


## 30. Polygon 内环在几何编辑中的保留规则

Polygon 几何编辑必须明确区分整体变换和外环顶点编辑：

- 整体平移必须对所有 rings 应用相同位移，不能只平移外环。
- 外环顶点编辑只修改第一 ring，其他内环原样保留。
- 对齐、分布、多选拖动属于整体变换，必须直接基于规范 Feature.geometry 计算，不能通过 legacy footprint 重建 Polygon。
- 对于 LineString，整体变换只修改中心线坐标；道路宽度仍属于 properties，不得烘焙或丢失。

编辑器当前的建筑/区域/道路整体拖动、多选拖动、对齐/分布已改为规范 geometry 变换；区域外环顶点编辑保留已有内环。真实浏览器交互与自动保存回读仍待验收。


## 31. 统一几何平移函数

`translateCampusFeatureGeometry(geometry, dx, dy)` 是规范 GeoJSON 几何的纯函数，支持 Point、LineString、Polygon、MultiPolygon。对 Polygon/MultiPolygon 的每一个 ring 应用相同位移，返回新几何，不修改输入。编辑器拖动、多选移动、对齐和分布必须复用此函数，避免通过 legacy 外环 footprint 重建几何而丢失水域内环。


## 32. 服务端 FeatureCollection 与基础校园数据合并

编辑器加载服务端文档时，必须优先读取保存的规范 FeatureCollection。使用 `mergeCampusFeatureCollections(base, edited)` 合并基础校园 FeatureCollection 与保存集合：

1. 基础集合提供未被编辑覆盖的默认空间对象。
2. 保存集合中相同稳定 ID 的 Feature 覆盖基础 Feature。
3. `deletedFeatureIds` tombstone 优先级最高，合并结果必须过滤对应 Feature。
4. 不认识的 Feature 类型必须保留在规范集合中，不能因为兼容投影暂不支持而在保存时丢失。
5. legacy 数组仅从合并后的规范集合派生，不能再作为服务端 FeatureCollection 的重建来源。

当前兼容投影仍只识别编辑器已支持的建筑、道路、区域和 Point 对象；未来 Feature 类型可保留但暂不能通过旧 SVG 工具编辑。


## 33. 历史恢复必须保留规范集合

`restoreCampusFeatureSnapshot` 返回兼容编辑器数组的同时，必须返回原始规范 `featureCollection`。撤销/重做恢复时直接替换编辑器的规范集合，不得通过 legacy 数组重新构建，否则当前编辑器不支持的 Feature 类型和扩展属性会丢失。兼容数组仅用于已支持对象类型的交互投影。


## 34. 复制粘贴必须以规范 Feature 为输入

编辑器复制操作从规范 FeatureCollection 按稳定 ID 读取完整 Feature；粘贴通过 `duplicateCampusFeature` 生成新 ID 并平移 geometry，properties 和 provenance 原样保留，再通过 `upsertCampusFeature` 写入规范集合。禁止从 legacy 数组重建复制数据，以免丢失 Polygon 内环、质量元数据或未来扩展属性。


## 35. 几何编辑写入边界收敛

编辑器中的几何变更必须通过 `updateCampusFeatureGeometry` 作用于规范 FeatureCollection：

- Polygon 外环顶点增删、拖动、建筑尺寸调整和旋转仅替换外环，原有内环必须保留。
- LineString 道路节点增删/拖动直接更新中心线坐标，宽度等业务属性保留在 properties。
- Point 对象拖动直接更新 Point coordinates，不能重新创建 Feature 或覆盖其业务元数据。
- 复制粘贴从规范 Feature 读取，并以新 ID 复制完整 Feature；几何偏移使用统一变换函数。
- legacy 数组可以用于渲染兼容模板和交互计算，但不得成为几何写入的权威来源。


## 36. 未知 Feature 的兼容投影与持久化

legacy 编辑器投影不是规范数据完整性的判断依据。当前编辑器只支持部分 Feature 类型映射到旧数组；未映射类型允许不出现在 legacy 数组中，但必须原样留在 `spatialFeatureCollection`。保存文档、undo/redo 和服务端刷新回读均以规范集合为依据。任何兼容投影、属性更新、几何更新和删除操作都不得通过重建 legacy 数组覆盖规范集合。


## 37. 平面编辑文档服务端 schema 契约

编辑器当前保存 `schemaVersion: 4`，其空间权威载荷为 `featureCollection`。服务端 `savePlan` 必须接受 v4，并要求存在合法 GeoJSON FeatureCollection；不得仅按旧版 v2 拒绝请求。历史 v2/v3 文档继续允许保存，以支持迁移期兼容。

服务端以 JSONB 原样持久化规范集合，结构校验不应通过白名单重建 Feature properties，未知业务字段必须保留。至少校验 FeatureCollection 类型、features 数组、稳定 ID 非空且唯一、geometry 结构、坐标有限、properties 为对象、tombstone 为字符串数组和文档体积上限。数据库 schema_version 应与文档 schemaVersion 同步。

端到端验收必须验证 PUT 后 GET 回读完整 FeatureCollection、未知 Feature、扩展 properties、Polygon 内环和删除 tombstone，并验证 revision 冲突不会覆盖服务端已有版本。


## 38. 服务端读取、首页合并与渲染消费闭环

平面编辑文档的读取链路为 `GET /campuses/:campusId/maps/:mapId/scene/plan` → `ScenesService.findPlan` → `campus_plan_document.document` JSONB。读取接口返回数据库文档对象，不按建筑/道路/区域白名单重建 FeatureCollection。编辑器 `loadEditorDocument` 优先使用 `document.featureCollection`，将基础校园 FeatureCollection 与服务端集合按稳定 ID 合并，并将 tombstone 应用于合并结果。

首页 `loadHomepagePlanDocument` 读取同一平面编辑文档；启动场景前将规范 FeatureCollection 与基础校园数据合并，再传入 `createCampusEngine`。Three.js 校园场景通过 `createCampusSceneRenderData` / `getCampusSpatialLayers` 从 FeatureCollection 派生建筑、道路、区域和 Point 图层。编辑器 3D 预览也使用同一 `createCampusSceneRenderData` 适配边界。

未知 Feature 类型即使暂不被当前渲染图层识别，也必须留在传入的 FeatureCollection 中；渲染适配器不支持绘制不等于数据可以被删除。当前渲染图层只消费已支持的几何/featureType，未知 Feature 的可视化属于后续能力，不阻断其保存和往返完整性。

服务端 API 集成测试已验证 v4 FeatureCollection 的 PUT/GET 回读、JSONB 扩展属性、Polygon 内环、删除 tombstone 和 revision 冲突。Frontend CI 与 Backend CI 在提交 `b315858` 均成功。真实浏览器仍需验证自动保存、刷新回读、编辑器关闭后首页刷新和 2.5D/3D 预览一致性；legacy 数组仍是兼容交互投影，不应标记为完全移除。


## 39. 建筑 Polygon 内环兼容投影

建筑规范 Feature 的 Polygon 可以包含外环和一个或多个内环（例如建筑中庭、镂空区域）。legacy 编辑器投影必须保留这些内环：FeatureCollection → building.footprint/building.holes → FeatureCollection 的转换不得只保留外环。几何编辑更新外环时仍须沿用规范 Feature 中已有内环。新增回归测试验证建筑内环的双向转换坐标完全一致。


## 40. 首页场景合并的 metadata 保留

首页合并基础校园 FeatureCollection 与编辑器 FeatureCollection 时，除按稳定 ID 合并 Feature、应用 tombstone 外，还必须合并集合级 metadata。基础 metadata 作为默认值，编辑器 metadata 的同名字段优先；双方均包含 catalogue 时按 catalogue 子键合并，避免编辑器保存的扩展目录或数据版本信息在首页加载时丢失。该操作不修改输入集合，并继续保留未知 Feature。


## 41. 首页合并必须继承双方 tombstone

mergeCampusSceneFeatureCollections 合并基础集合与编辑器集合时，deletedFeatureIds 必须取双方删除标记的稳定去重并集，再统一过滤 Feature。即使当前基础校园集合通常不携带 tombstone，也不能让通用合并边界依赖这一隐含前提；未来基础数据版本或多来源合并携带删除标记时，已删除 Feature 不得因合并而复活。


## 42. 编辑器加载必须保留基础集合 metadata

编辑器初始化和加载服务端文档时，基础 FeatureCollection 必须直接来自 buildCampusGeoJSON() 的完整结果，不能仅从建筑、道路、区域、点对象四组兼容数组重新构建，否则 metadata.catalogue 等未定位目录信息会丢失。toCampusFeatureCollection() 在承担兼容转换职责时必须透传 document.metadata；mergeCampusFeatureCollections() 对基础与编辑器 metadata 采用基础默认、编辑器同名字段优先的策略，catalogue 按子键合并。首页和编辑器必须遵守同一集合级元数据保留语义。


## 43. 服务端保存必须原样保留集合级 metadata

schema v4 的 FeatureCollection metadata 属于规范空间数据的一部分。SaveRpgMapDto 将 document 作为对象接收，服务层校验后直接 JSON.stringify 写入 JSONB；不得通过仅声明已知字段的嵌套 DTO 或白名单映射重建 FeatureCollection。API 集成测试覆盖 metadata.dataset、metadata.catalogue 中基础目录与编辑器扩展目录的 PUT/GET 原样回读。


## 44. 编辑器冲突恢复前取消待执行自动保存

当编辑器检测到 revision 冲突后，用户选择重新加载服务端版本时，必须先清除尚未触发的自动保存定时器，再开始读取服务端文档。否则旧本地快照可能在服务端重载完成前再次发起保存请求，造成额外冲突或状态提示抖动。冲突恢复期间若仍有保存请求进行中，则不允许并发执行重载。


## 45. 服务端 GeoJSON geometry 必须按类型校验结构

schema v4 的 FeatureCollection 服务端校验不能仅递归检查坐标是否为有限数字；必须先识别 GeoJSON 标准 geometry 类型，再按各类型的坐标嵌套结构校验。Point/MultiPoint、LineString/MultiLineString、Polygon/MultiPolygon 分别校验 Position、线段、闭合 LinearRing 和多层集合结构；GeometryCollection 递归校验子 geometry，并设置递归深度上限。Position 至少包含两个有限数值，LineString 至少两个 Position，Polygon 的每个 LinearRing 至少四个 Position 且首尾位置一致。未知 geometry 类型、错误嵌套、非有限坐标和非法环必须拒绝。当前编辑器主要生产 Point、LineString、Polygon；对暂不渲染的合法扩展类型仍须在 FeatureCollection 中原样保留。


## 46. 自动保存失败不得无限重试同一快照

编辑器自动保存请求必须区分“请求期间发生新编辑”与“本次请求失败但内容未变化”：

- 保存开始时固定本次请求快照 `requestSnapshot`。
- 请求完成后，只有当前文档快照与 `requestSnapshot` 不同，才安排一次短延迟补发，以保存请求进行期间产生的新编辑。
- 若本次请求失败且文档没有变化，不得仅因当前快照仍不同于上次成功保存快照而循环重试；应保留错误状态，等待用户后续编辑或显式重试入口。
- 版本冲突仍进入独立冲突状态，不得自动覆盖服务端版本。

该规则防止网络中断或服务端持续异常时，以固定间隔无限发送同一份失败文档。仍需浏览器验证：保存请求进行中继续编辑、请求失败后的停止行为、后续编辑是否重新触发自动保存，以及 409 冲突后的服务端重载。


## 47. 底图预览资源不得阻断空间文档持久化

编辑器加载平面文档时，规范 FeatureCollection 与 revision 是核心持久化状态；referenceImage 的二进制预览是辅助资源。若服务端文档读取成功，但底图预览资源请求失败，必须保留底图引用和错误提示，同时继续完成 documentLoaded 初始化，使后续空间编辑仍可自动保存。不得让辅助图片请求失败导致已加载空间数据进入“无法自动保存”的半初始化状态。若空间文档 API 本身失败，则仍不得启用自动保存。


## 48. 编辑器卸载时的待保存快照处理

当编辑器因 SPA 路由切换或组件关闭而卸载时：

- 清理 debounce timer 前，比较当前 `buildDocument()` 快照与最后成功保存快照。
- 若文档已成功加载、无正在执行的保存、无版本冲突且内容存在未保存变化，应立即启动一次保存请求。
- 若已有保存请求正在执行，不并发提交；由该请求完成后的快照比较机制处理请求期间的新编辑。
- 该策略降低组件卸载导致的 debounce 修改丢失风险，但不承诺浏览器整页关闭、强制刷新、断网或进程终止时请求一定完成。若需要覆盖这些场景，应另行设计本地恢复队列或可靠后台同步协议。


## 49. 撤销/重做快照必须保留 FeatureCollection metadata

FeatureCollection 的集合级 metadata 与 features、deletedFeatureIds 同属规范空间数据。创建 CampusFeatureSnapshot 时必须完整复制 metadata，不能只保存空间 Feature 与删除标记。恢复快照后 metadata.dataset、metadata.catalogue 和未知扩展字段必须保持不变，避免撤销/重做后下一次自动保存将集合级元数据永久清除。测试必须覆盖 metadata 经 JSON 序列化和恢复的 round-trip。


## 50. 建筑放置交互与几何创建语义

“建筑摆放”必须采用单击创建默认矩形 Footprint 的交互：根据画布点击位置生成 Polygon 外环，立即选中新 Feature 并切换到选择工具，允许后续拖动、改名、调整尺寸和顶点。多边形自定义绘制作为独立“建筑轮廓”工具，要求至少三个顶点并显式完成。不得将尚未完成的绘制控制点误认为已创建的建筑 Feature。点对象拖动由 SVG 根节点捕获 pointer 事件，移动时只更新对应 Point Feature 的规范 geometry；对象图层隐藏时不得显示对象。


## 51. 自动保存状态必须区分已启用与已持久化

“自动保存已开启”仅表示机制可用，不代表当前文档已经写入服务端。编辑器状态至少区分等待修改/未保存、保存中、保存成功、版本冲突和保存失败；保存成功应展示服务端 revision，失败应提供可见错误信息。加载已有文档后显示已加载版本；空文档不能标记为已保存。手动保存入口必须复用相同 PUT API、revision 乐观锁和错误处理，不得绕过持久化契约。最终仍以 GET 回读与刷新后的 FeatureCollection 一致作为验收标准。


## 52. 编辑器挂载前必须完成校园与地图标识注入

首页通过校园列表和地图列表确定当前校园与地图后，必须先将稳定的 `campusId`、`mapId` 写入共享的 `sceneDocument`，再挂载或初始化 `CampusPlanEditor`。该标识初始化不能依赖编辑器文档已经存在：首次创建编辑文档时，服务端 GET 可能返回空 document，但编辑器仍必须能够使用校园/地图 ID 完成空文档初始化和后续 PUT。

若缺少任一 ID，或空间文档 GET 请求失败，编辑器必须进入显式错误状态，禁用持久化并向用户展示具体原因；不得静默保持“等待修改”。自动保存验收应确认：创建 Feature 后快照监听触发 dirty，PUT 返回新 revision，刷新后 GET 回读包含该 Feature。


## 53. Vue 父子生命周期下的编辑器 ID 延迟注入

CampusPlanEditor 可能在父组件 App 的异步初始化完成前先执行自身 onMounted。若首次挂载时 campusId/mapId 尚未传入，loadEditorDocument 会提前退出。组件必须监听两个标识的 props 变化，并在它们均可用且文档尚未加载时重新触发加载；不能假设父组件 onMounted 一定早于子组件。若初始 props 已具备两个标识，则由组件原有挂载流程加载，避免重复请求。


## 54. 平面编辑文档请求体大小限制

Express 默认 JSON parser 的 100 KiB 上限不足以承载包含完整 FeatureCollection 的平面编辑文档。Nest 启动时关闭默认 body parser，并显式注册 16 MiB JSON parser；URL-encoded parser 单独保留 1 MiB 上限。16 MiB 请求上限与 ScenesService 当前 15 MiB 文档序列化大小校验对齐。该调整只解决 HTTP 请求体解析层限制，不放宽业务 schema、几何校验、权限或 revision 乐观锁。验收必须确认 PUT 成功、revision 递增，并通过 GET 回读验证完整文档。

## 55. Express 请求体解析器注册

- Nest 应用通过 `NestFactory.create(AppModule, { bodyParser: false })` 关闭默认解析器，避免 Express 默认 100 KiB JSON 限制先行拦截空间文档。
- 在 Express 平台显式注册 `json({ limit: '16mb' })` 与 `urlencoded({ extended: true, limit: '1mb' })`，使用 `app.use()` 挂载中间件；不调用 `INestApplication` 未声明的 `useBodyParser()`。
- 16 MiB 传输上限与 15 MiB 场景文档业务上限保持边界关系，业务校验仍是最终约束。

## 56. 2D 编辑器空间对象首屏一致性

- `CampusPlanEditor` 的本地基础数组仅是加载期间的初始状态，不能在服务端保存文档尚未读取时作为最终空间视图展示。
- SVG 空间对象组由 `documentLoaded` 门控；只有服务端文档 GET、基础 FeatureCollection 与编辑 FeatureCollection 合并、legacy 交互投影完成后才显示对象。
- 参考底图预览属于非关键辅助资源，采用后台异步加载，不能阻塞空间文档就绪。
- 本修复只调整首屏可见时序，不改变 FeatureCollection 的数据权威性、合并优先级、tombstone 语义或保存协议。


## 57. 撤销/重做恢复必须重建建筑兼容边界

规范 FeatureCollection 中建筑 Polygon 的外环是几何权威数据，不保存旧编辑器专用的 `rect`。历史快照恢复到 SVG 编辑器兼容数组时，`fromCampusFeatureCollection` 必须根据 Polygon 外环重新计算 `[minX, minY, maxX, maxY]`，并将其作为 `rect` 输出。CampusPlanEditor 的历史恢复入口继续对建筑执行 `normalizeBuilding`，以兼容旧版快照和历史文档。撤销/重做回归测试必须覆盖快照序列化、恢复后 footprint 与 rect 的一致性；不得把 rect 反向写入或替代规范 geometry。


## 58. 编辑器历史导航文案与快捷键

- 历史栈的用户操作命名统一为“上一步 / 下一步”，分别对应现有 undo/redo，不改变底层历史快照结构和 FeatureCollection 权威数据。
- 上一步使用 Ctrl/Cmd + Z；下一步使用 Ctrl/Cmd + Shift + Z。键盘事件在 input、textarea、select 和 contenteditable 中不应被编辑器截获，避免干扰文本编辑。
- 两处历史操作入口（顶部操作区、画布工具栏）必须使用一致文案和快捷键提示；无历史记录时上一步禁用，无可重做记录时下一步禁用。
- 撤销后产生新编辑时，现有 snapshot 逻辑清空 redo/future 栈；历史恢复继续触发既有自动保存监听，不引入独立持久化路径。

## 59. 室外第一人称相机与输入契约

- 第一人称是室外角色漫游模式，不是正交总览镜头的近距离观察。无论当前展示模式为 2.5D 或 3D，firstPerson 均必须使用透视相机；2.5D 正交相机只用于总览/跟随的 2.5D 展示。
- 进入第一人称时，相机位置必须同步到玩家眼部坐标（当前玩家高度约 1.7 个场景单位），视线目标由第一人称 yaw/pitch 计算。切换入口不得保留总览相机的高空位置并以缓动方式飞向玩家。
- 视图模式在第一人称期间切换时，不得将相机重新切回正交投影；退出第一人称后再由总览/跟随模式按当前 viewMode 选择投影相机。
- 鼠标点击画布请求 Pointer Lock，锁定后通过鼠标 movementX/movementY 更新 yaw/pitch；Esc 由浏览器释放 Pointer Lock。触屏继续使用现有 Pointer Events 观察控制。
- WASD/方向键按当前第一人称 yaw 计算平面移动，位移仍经过统一 CollisionWorld；输入焦点位于 INPUT/TEXTAREA/SELECT 或 contenteditable 时不得抢占按键。第一人称移动键需阻止浏览器默认滚动，窗口失焦时清空持续按压状态。
- 第一人称模式隐藏玩家自身 Sprite，避免角色贴图遮挡视野；切换回跟随/总览后恢复既有显示规则。
- 回归验收覆盖透视投影、眼部相机定位、鼠标锁定与旋转、WASD、建筑/设施碰撞、Esc 退出以及 2.5D/3D 模式切换。代码测试不替代真实浏览器验收。


## 60. 地图渲染与编辑器性能边界

- 2.5D/3D 总览采用按需渲染：初始化、窗口尺寸变化、相机交互、视角切换、场景对象变更时请求帧；静止总览且 OrbitControls 阻尼结束后停止持续 requestAnimationFrame。第三人称/第一人称仍使用连续帧，以维持输入、碰撞、角色动画和相机跟随。
- 建筑入口对象在校园场景初始化时建立索引。运行时只在玩家位置发生有效变化时计算附近入口，不允许每帧遍历完整校园场景树。
- 首页默认入口将地图编辑器、室内平面编辑器和建筑轮廓编辑器拆为异步组件，只有进入相应编辑场景时才加载对应代码分块。
- 基础 2.5D 总览不下载/解析 GLB 建筑资产。校园 3D 或角色跟随视角按需动态导入模型加载器；编辑器三维预览使用自身预览对象，不应加载未参与预览的基础校园 GLB。回到 2.5D 总览时，已加载的独立模型隐藏。
- 编辑器自动保存监听空间对象集合的深度变更并由 Vue 批处理；鼠标拖动期间不得同步序列化整份地图。防抖窗口结束后再生成文档快照、比较已保存版本并发起保存；保存请求只构建一次文档快照。
- 性能优化不得改变空间 FeatureCollection、几何、对象数量、编辑器撤销/重做、自动保存时序或碰撞语义。性能收益需在真实浏览器分别验收静止总览、平移/缩放、角色移动、编辑拖动和 3D 首次加载。


## 46. 第二轮渲染性能策略（2026-11-05）

- 2.5D/总览模式关闭实时阴影。该模式主要呈现程序化静态校园网格，实时阴影会让大量静态 mesh 额外参与 shadow map pass；树冠投影等原有贴花式视觉元素不受影响。
- 仅在 3D 跟随/第一人称模式开启实时阴影，避免将高开销阴影计算施加到默认总览场景。
- WebGL drawing buffer 根据视口 CSS 像素面积动态缩放，目标像素面积约 1,500,000；低分辨率视口仍保持 1x，高分辨率视口按面积比例降采样。
- 显式添加 `?render-debug=1` 后，渲染诊断输出 renderer draw calls、triangles、points、lines、geometries、textures、场景对象数、Mesh 数以及最近一次 renderer.render CPU 提交耗时。
- 诊断数据用于区分 CPU 提交开销、draw-call 压力、几何/纹理资源规模与 GPU 像素填充压力；浏览器端仍需结合 DevTools Performance/GPU 信息判断真实 GPU 执行时间。
- 以上优化不修改 FeatureCollection、Feature geometry、对象 ID、碰撞体、自动保存、撤销/重做和首页/编辑器数据一致性契约。


## 61. 渲染质量、阴影缓存与深度精度（2026-11-05）

- 2.5D/3D 总览均保留定向光阴影。阴影贴图使用 PCFSoftShadowMap，2048×2048 分辨率；静态场景通过 renderer.shadowMap.autoUpdate=false 缓存阴影，不能因相机平移/缩放重新计算。
- 场景几何变化必须显式设置 renderer.shadowMap.needsUpdate：基础/GLB 资产加载、RPG/校园编辑预览切换、室内楼层重建/退出、场景对象几何替换均属于失效边界。
- WebGL 开启 MSAA；绘制倍率按设备 DPR 与约 240 万像素缓冲区预算自适应。CanvasTexture 像素素材继续使用 NearestFilter，MSAA 只处理几何边缘。
- 正交/透视相机 near/far 调整为 0.5/3200，避免不必要的超大深度范围降低深度缓冲精度。若仍出现局部闪烁，需进一步用 WebGL 深度可视化和对象重叠检查定位具体几何，而不是全局关闭深度测试。
- 阴影缓存与 requestAnimationFrame 按需调度分离：静止总览仍停止持续帧循环；场景变更只请求一帧并更新阴影贴图。
- 浏览器验收必须检查 2.5D 阴影、3D 阴影、编辑预览切换、室内楼层切换、近景建筑/道路/水岸边缘和缩放时的闪烁。自动化构建无法替代实际 GPU 视觉验收。



## 62. 校园人物模型与步态动画（2026-11-05）

- 正式校园和 RPG 样板区共用 `createCampusPlayer(THREE)`，角色为低多边形像素风 3D 体块模型；禁止退回单张 camera-facing Sprite 作为主角表现。
- 角色根节点位于脚底地面高度；头、躯干、背包、手臂、腿和鞋均为独立 Mesh/关节组，参与标准材质光照与阴影。
- 行走采用连续关节动画：双腿反相摆动、双臂与对侧腿反相、身体轻微垂直起伏；朝向由世界空间位移向量决定。静止时保持轻微呼吸，不应出现持续踏步。
- 编辑器预览需要 clone 完整层级并隔离几何/材质资源，动画控制器绑定到预览副本；预览销毁不得释放正式场景共享资源。
- 引擎玩家坐标代表眼部高度，渲染角色时按 1.7 世界单位回落到当前地面高度；进入第一人称时隐藏角色模型。
- 角色动画使用引擎既有 requestAnimationFrame 调度，不得创建独立常驻动画循环。
- 浏览器验收覆盖四方向行走、转向过渡、停走衔接、阴影、编辑预览副本和室内楼层高度。自动化构建通过不代表动画观感验收通过。



## 63. 校园人物脚底接触阴影

- 校园人物会持续移动，而场景 directional shadow map 为性能采用静态缓存；人物自身不再向该静态贴图投影，避免阴影停留在出生点。
- 人物根节点脚底添加柔边径向渐变接触阴影，作为独立地面 Mesh 跟随角色根节点的 X/Z 与楼层 Y 坐标。角色身体步态/呼吸动画在 body 子节点内运行，不带动接触阴影上下抖动。
- 接触阴影使用透明 CanvasTexture 和 MeshBasicMaterial，不投射阴影、不接收阴影，不触发额外 shadow pass；人物主体仍接受场景光照。
- 编辑器预览克隆人物时必须独立克隆材质 map 贴图；预览资源销毁不得 dispose 正式场景角色仍在使用的接触阴影纹理。
- 接触阴影是稳定的脚底环境遮蔽表现，不等同于随太阳方向变化的完整动态投影。若未来需要人物长距离投影，应单独设计低成本动态角色阴影，不得直接让 2048² 全场景 shadow map 每帧重算。
- 浏览器验收覆盖静止、四方向移动、转向、停走、不同楼层高度与地面接触；确认阴影不漂移、不悬空、不残留在出生点。


## 64. 漫游碰撞与空间数据源一致性（2026-11-05）

- 校园场景渲染和行走碰撞必须消费同一份规范化 FeatureCollection 派生空间层；禁止渲染读取编辑器数据、碰撞仍读取旧静态布局常量。
- 水域碰撞从 `createCampusSceneRenderData(featureCollection).layers.areas` 中筛选 `type=water` 的 Polygon，并保留所有 holes。这样湖泊移动、删除、重绘后，碰撞边界与实际水面同步，内环岛屿保持可通行。
- 建筑墙段、独立设施圆形碰撞和校园 walkableBounds 仍按各自明确语义注册；本次不通过关闭碰撞来解决空地阻挡。
- 验收：空地可自由行走；水面不可穿越；湖中岛屿可行走；编辑器修改水域后首页渲染与碰撞位置一致。


## 65. 校园空间要素通行属性（2026-11-05）

- `Feature.properties.walkable` 是人物漫游碰撞的唯一业务开关，类型默认值集中定义于 `src/data/campus/walkability.js`。
- 默认策略：building/water=false；普通 area/green/plaza/sports/parking、road、boundary、gate=true；object 中 tree/bench/streetlight/lamp/sculpture/facility=false，flower/plant/grass/decoration=true。
- 显式布尔值优先于类型默认值，支持单个对象例外；编辑器属性检查器可修改该字段，修改纳入 FeatureCollection 历史和保存机制。
- 场景构建将 walkable 写入建筑/点对象 userData；引擎仅为 walkable=false 的建筑和实体设施注册碰撞体，所有不可通行区域按 Polygon/洞区注册，不可通行道路按宽度转为面碰撞。
- 相机遮挡根集合仍保留建筑对象，不因人物可通行设置而移除视觉相机避障引用。
- 验收：空地/绿地/道路可走；默认建筑/湖水/树木/座椅/路灯不可穿越；将单个对象改为允许通行后人物可穿过；改回禁止通行后恢复阻挡；刷新后属性保持。


## 18. 建筑视觉模型与人物碰撞的所有权

校园基础 Feature footprint 是建筑碰撞的唯一权威来源。程序化建筑根据墙段/门洞生成碰撞；加载 GLB 时只替换视觉模型，不得再以 GLB 世界 AABB 叠加碰撞。AABB 会填满凹形或斜边 footprint 外侧的真实空地，产生“看起来没有物体但人物无法通过”的假障碍。只有不在规范空间图层中的独立模型，才允许使用 AABB 作为兜底碰撞。建筑通行属性仍由 Feature.properties.walkable 控制。


## 66. 校园外围漫游边界与外围道路

校园漫游的 `walkableBounds` 是人物活动范围的矩形兜底边界，不是校园道路或水域的实体碰撞。该范围必须覆盖校园底图外侧的外围环线道路及道路外侧缓冲区域：

- 活动边界以校园底图半宽/半深为基准，向四周额外扩展 12 个世界单位；不得再向内缩进，否则 CollisionWorld 按人物半径预留安全距离后，会把贴近底图边缘的外围道路截断。
- 外围道路默认可通行；道路外侧的远景草地也允许漫游，直到扩展后的活动边界。
- 水域、建筑、树木、座椅、路灯及显式设置为不可通行的 Feature 仍由独立障碍物控制。本边界调整不得移除或弱化这些碰撞。
- 验收覆盖西侧湖区左边、北/南/东/西四段外围环线道路及道路外侧；同时确认湖面仍阻挡、中央湖岛仍可通行、建筑和树木碰撞保持有效。


## 67. 漫游活动边界必须包络全部空间内容

活动边界不能直接从参考底图的 mapBounds 或 worldWidth/worldDepth 推导，因为真实数字化的校园 Feature 可能越出底图矩形。边界必须包络当前规范空间数据中的全部实际内容：

- 区域 Polygon 外环和 holes、建筑 footprint、道路中心线、点对象、校园边界 Polygon、出入口坐标共同参与范围计算。
- 坐标统一通过 mapPixelToWorld 转换到漫游世界坐标后求 min/max；道路宽度计入外围缓冲，避免中心线位于边界内而铺装路面被裁切。
- 在全部内容包络盒外仅保留少量动态缓冲（至少 2.5 世界单位，并结合道路半宽），不使用与内容无关的固定大范围。
- 活动边界只是漫游范围，不代表实体碰撞；水域、建筑、设施和显式不可通行要素仍按 Feature.properties.walkable 与各自几何碰撞。
- 新增/编辑/移动空间要素后，场景重建应重新计算包络边界。验收必须覆盖西侧湖区左边、操场外缘、外围道路和所有最外侧要素。

## 68. 2.5D / 3D 相机交互边界

- 2.5D 总览采用正交投影与固定世界方位，只允许平移和缩放；鼠标左键/右键拖动均执行平移，触屏单指拖动执行平移，禁止旋转地图方位。
- 2.5D 跟随采用经典 GBA 宝可梦地图式固定斜俯视：默认俯视约 62°、固定 yaw，镜头只随玩家位置平移，不随人物朝向旋转；跟随状态不允许调整角度。
- 2.5D 不提供第一人称入口、快捷键或相机状态。2.5D 只包含总览与固定斜俯视跟随两种相机操作模式。
- 3D 总览使用透视投影，支持平移、缩放和旋转观察；鼠标左键拖动旋转、右键拖动平移、滚轮缩放，触屏单指旋转、双指缩放/平移。
- 3D 跟随支持第三人称角度调整，并保留第一人称透视漫游。
- 从 3D 第一人称切换到 2.5D 时，必须先退出第一人称并回到固定斜俯视跟随，禁止透视第一人称状态残留。
- 浏览器验收分别覆盖：2.5D 总览鼠标/触屏只能平移、滚轮缩放有效且不能旋转；2.5D 跟随镜头固定且随角色平移；3D 总览左键可旋转、右键可平移；3D 跟随可调整角度；第一人称只在 3D 出现并可正常切换。


## 69. 首页首屏相机必须按校园内容包络居中（2026-11-05）

- 世界坐标原点不等同于校园空间数据的视觉中心。首页首次构图必须消费场景构建阶段生成的 `root.userData.contentBounds`，不得默认将相机目标固定在 `(0, 0, 0)`。
- `contentBounds` 从当前统一空间图层的区域 Polygon/holes/rect、建筑 footprint/rect、道路中心线、点对象、校园边界和出入口计算；坐标统一经 `mapPixelToWorld` 转换。
- 相机目标为包络盒中心 `((minX+maxX)/2, (minZ+maxZ)/2)`，宽高适配当前画布 aspect ratio，并保留既有 2.5D 正交投影与斜俯视方向。
- 首屏聚焦只执行一次。用户开始平移、缩放或旋转后，不得因 resize、场景数据刷新或普通状态更新自动重置相机。
- 从建筑返回等带有明确延续位置的入口可延迟初始聚焦，避免覆盖既有导航上下文。
- 验收：首次打开首页时校园主体在画布中央且四周留白合理；宽屏/窄屏均能完整呈现；手动调整视角后不被自动拉回。


## 70. 2.5D / 3D 总览相机姿态隔离（2026-11-05）

- 3D 总览允许 OrbitControls 自由旋转；用户在 3D 中调整的 yaw/pitch 仅属于 3D 透视相机状态。
- 切回 2.5D 总览时，只继承当前观察中心与可视高度，不继承 3D 相机的旋转四元数或视线方向。
- 2.5D 总览恢复固定北向上、固定 45° 斜俯视姿态，仍使用正交投影；平移中心与缩放比例按切换时的观察范围保留。
- 2.5D 的平移/缩放操作不允许改变地图方位；再次切换到 3D 时可从固定 2.5D 姿态进入 3D，再独立调整角度。
- 验收：在 3D 总览连续改变水平旋转和俯仰角，切换到 2.5D 后地图方向与倾角必须恢复固定状态；在 2.5D 平移/缩放后不发生自动旋转。


## 71. 2.5D / 3D 总览平移状态隔离（2026-11-05）

- 2.5D 与 3D 总览分别维护独立的观察中心（OrbitControls target）。
- 首次首页聚焦时，两套观察中心均初始化为校园内容包络中心，确保首次切换不会跳到原点。
- 用户在 2.5D 平移只更新 2.5D 观察中心；切换到 3D 时恢复 3D 自己的观察中心。反向切换同理。
- 每个视角保留自己的观察中心；旋转仍仅允许 3D，2.5D 固定方位，缩放和拖拽各自独立。
- 验收：在 2.5D 平移后切到 3D，3D 画面位置不应跟随；在 3D 平移后切回 2.5D，2.5D 画面位置也不应跟随。


## 72. 3D 总览鼠标平移输入与浏览器右键菜单

- 3D 总览左键拖动旋转；右键拖动平移，滚轮缩放。
- 浏览器画布必须阻止原生 `contextmenu`，否则右键菜单可能抢占拖动手势，造成 OrbitControls 无法持续接收右键移动。
- 中键拖动也映射为平移，作为鼠标设备差异下的备用操作。
- 2.5D 总览维持左键/右键平移，不开放旋转；两套总览观察中心仍独立保存。
- 浏览器验收需分别确认 3D 左键旋转、右键/中键平移、滚轮缩放，以及 2.5D 左键平移。


## 73. 3D 总览独立指针平移实现

- 3D 总览在相机控制层独立监听右键/中键 `pointerdown`、`pointermove`、`pointerup`，不再把平移完全交给 OrbitControls 鼠标按钮映射。
- 拖动期间临时关闭 OrbitControls 输入，按透视相机视场高度与画布高度换算每像素世界位移，并将相机位置和 OrbitControls target 同步平移。
- 平移向量投影到水平地面，保持观察中心高度；松开指针后恢复 OrbitControls，左键旋转和滚轮缩放继续工作。
- 2.5D 仍保持独立的地图平移输入与 2.5D/3D 观察中心隔离。


## 74. 3D 总览右键平移事件优先级（2026-11-05）

- 右键/中键平移的 `pointerdown` 在画布 DOM 捕获阶段接管，避免 OrbitControls 或其他冒泡阶段监听器先行处理右键手势。
- 被接管的指针手势执行 `preventDefault` 与 `stopPropagation`，随后由 CameraRig 独立更新相机位置和观察中心；指针释放后恢复 OrbitControls。
- 3D 左键旋转、滚轮缩放、中键平移及 2.5D 平移规则不变。
- 验收需确认右键拖动可连续平移、松开后左键仍可旋转且滚轮缩放正常；浏览器实际加载的版本必须包含本节对应提交。


## 75. 总览模式操作指南与交互文案

- 总览操作指南必须根据当前展示模式动态呈现真实输入映射：2.5D 鼠标左键/右键拖动平移且不可旋转；3D 左键拖动旋转、右键/中键拖动平移；滚轮负责缩放。
- 触屏设备说明 2.5D 单指平移、3D 单指旋转，双指执行缩放/平移。
- 指南中的操作必须与实际事件实现一致；未实现的交互（例如双击聚焦）不得出现在说明中。
- “重置视角”按钮用于恢复校园初始构图，指南应明确其用途。


## 76. 总览操作指南的显示规则（2026-11-05）

- 总览模式必须保留操作指南面板；仅隐藏装饰性介绍卡片，不得通过 overview 样式隐藏整个 control-card。
- 桌面端指南位于画布右侧；移动端使用紧凑宽度、最大高度和内部滚动，避免与底部视图切换控件发生空间冲突。
- 触屏设备和窄屏设备均不得因通用媒体查询隐藏总览操作指南；漫游模式可继续按现有布局策略隐藏该面板。
- 指南文本由 App.vue 按 2.5D/3D 与总览/跟随模式动态呈现，CSS 只负责可见性和布局，不得覆盖交互状态。
- 验收：桌面浏览器和移动端分别进入总览，指南均可见；切换 2.5D/3D 后说明实时变化；切换到漫游模式不应出现总览指南。


## 77. 总览重置入口与移动端导航控件布局（2026-11-05）

- 重置视角是总览常驻操作，不得依赖可能被隐藏的底部状态栏。按钮必须作为独立画布控件渲染，并调用现有 focusCampus，不得创建第二套相机重置逻辑。
- 桌面端重置入口位于画布右下；移动端位于左上安全区域，避开底部导航和触控移动摇杆。
- 移动端 2.5D/3D 展示切换与总览/跟随/第一人称相机模式切换使用紧凑按钮，仅保留核心标签，隐藏辅助说明；控件宽度按内容自适应，不得横向铺满屏幕。
- 移动端隐藏“打开地图编辑器”入口；桌面端保留。此规则只隐藏入口，不影响编辑器路由和桌面端功能。
- 验收覆盖窄屏/横屏、2.5D/3D、总览/跟随/第一人称状态；检查按钮可点击、地图主体不被菜单遮挡、重置后恢复校园初始构图。


## 78. 当前模式内重置视角

- 重置入口不得强制切换到总览或改变当前 2.5D/3D 投影。
- 总览模式：按当前投影重新聚焦校园内容包络。
- 跟随模式：将角色恢复到默认出生点，保留当前跟随模式及相机参数。
- 第一人称模式：将角色恢复到默认出生点，保留第一人称模式和当前观察朝向。
- 手机端隐藏操作指南面板，桌面端保留。


## 79. 手机端操作指南显示策略修正

- 手机端通过视口/触控媒体条件全局隐藏 `.control-card`，不得限定在总览模式；跟随和第一人称模式同样不显示。
- 桌面端保留操作指南。


## 22. 双引擎共享数据链路自动审计

首页校园场景与编辑器预览统一通过 `createCampusSceneRenderData` 从同一 FeatureCollection 派生空间图层。自动审计函数 `validateCampusSceneRenderData` 对以下阶段执行稳定 ID 与几何契约核对：

1. 源 FeatureCollection：按 building、road、area/green/water/sports/plaza/parking、Point object 分类建立期望对象清单。
2. 归一化空间图层：核对对象 ID 完整性、重复项和几何坐标；Polygon 外环闭合点在归一化时剥离，洞区逐环保留。
3. 编辑器预览投影：核对相同对象集合、建筑 footprint、道路中心线、区域外环/洞区、点设施坐标，以及 walkable 属性一致性。
4. 输出结构化报告：包含分类数量、检查总数、错误数量及错误代码（缺失、意外对象、重复 ID、几何不一致、通行属性不一致）。

该审计是数据管线的确定性回归测试，不代表 WebGL 最终画面、异步 GLB 资源、材质贴图或运行时碰撞的完整证明。以上运行时行为仍需由场景装配测试和浏览器抽样验收补充。当前校园底图数据仍标注为人工近似数字化，不应将自动一致性通过误解为地理位置已完成测绘核验。



## 23. Three.js 实际场景装配覆盖审计

正式校园场景创建后运行 `auditCampusSceneFeatureCoverage(spatialLayers, campus)`，将规范空间层与实际 Three.js 场景树进行对照。

- 场景节点必须标记 `featureId` 与 `featureCategory`；建筑、道路段、区域网格、点设施分别使用 buildings/roads/areas/objects 分类。
- 建筑每栋至少生成一个可渲染节点；道路允许一个 Feature 对应多个路面/路缘 Mesh；水域可对应床面和水面多个网格；运动场等区域允许多层网格。
- 检查空间 Feature 是否缺失、场景是否出现源数据之外的 Feature、Feature 节点是否没有 Mesh/Line/Points，以及 Mesh 是否缺少 geometry/material。
- 场景异常通过 `onSceneAudit` 回调提供结构化报告，并输出 `[CampusSceneAudit]` 警告；使用 `?render-debug=1` 可在控制台查看通过时的分类统计。
- 此项检查验证程序化场景装配覆盖，不验证 GLB 异步资产是否成功替换、模型几何与 footprint 的精确偏差、建筑高度与源属性是否一致、纹理内容是否正确，也不能替代 GPU 实际渲染验收。异步 GLB 加载另有 `onAssetsLoaded/onAssetError` 事件，可作为下一层资产审计入口。


## 24. GLB 建筑资产加载审计

异步建筑 GLB 加载完成后，使用 `validateCampusBuildingModels(models, canonicalBuildingIds)` 执行资产级检查：

- 每个模型必须具有稳定 `buildingId`，且该 ID 应存在于规范建筑 Feature 集合；重复 ID、未知 ID 均作为异常报告。
- 模型必须包含至少一个 Mesh；每个 Mesh 必须有 geometry 和 material，并具有有限且三轴尺寸大于零的局部包围盒。
- 汇总加载模型数、Mesh 数和三角面数；加载失败列表仍由 GLB loader 的 `errors` 单独提供。
- 通过 `onAssetAudit` 回调向业务层输出结构化结果；异常输出 `[CampusAssetAudit]`，`?render-debug=1` 下可查看通过报告。
- GLB 资产是程序化建筑的增强/替换视觉层；缺失 GLB 不代表空间 Feature 丢失。此审计不验证模型与 footprint 的实际位置/旋转偏差，不验证楼层高度与源数据语义，也不衡量 GPU draw call 或帧时间。



## 25. GLB 建筑模型与规范 footprint 几何偏差审计

异步 GLB 加载后，引擎使用 `Box3.setFromObject` 计算模型世界坐标包围盒，并调用 `auditCampusBuildingModelGeometry` 对比规范建筑 Feature：

- 以稳定 buildingId 关联模型与建筑 Feature。
- 将建筑 footprint 像素坐标通过 `mapPixelToWorld` 转换为校园世界坐标，计算 footprint 轴对齐包围盒。
- 检查模型包围盒中心与 footprint 包围盒中心的水平偏移，默认容差 2.5 世界单位。
- 检查模型宽度/深度与 footprint 包围盒尺寸的相对误差，默认阈值 35%。
- 只有 Feature 提供明确正数 height 时才比较模型实际 Y 高度；容差为 max(1.5, 源高度的 20%)。缺失源高度标记为不可比较。
- 输出 `onAssetGeometryAudit` 结构化报告；异常输出 `[CampusAssetGeometryAudit]`，调试模式下输出统计。
- 未加载模型标记为 `not_loaded`，不会作为异常；没有规范 footprint 的模型 ID 会单独报错。
- 模型旋转角只记录、不判定，因为当前规范建筑 Feature 尚无统一的方向基准。
- 该对比使用轴对齐包围盒而非多边形精确重叠：凹形、斜边、旋转 footprint 会产生近似误差，结果应作为资产定位/尺度问题筛查，不作为碰撞几何的最终证明。
- 当前 GLB 清单 `public/data/buildings.json` 为空，故当前真实模型匹配数为 0；只有录入建筑模型后才能形成逐栋偏差结论。


## 26. 建筑 GLB 资产清单与摆放工作流

建筑空间 Feature 是资产清单的唯一关联基准，使用稳定 `buildingId` 绑定 GLB 文件：

1. 引擎进入 3D/跟随视图并加载 `/data/buildings.json` 后，调用 `createCampusBuildingAssetInventory` 生成全量建筑资产待办清单，并通过 `onAssetInventory` 回调提供。
2. 未配置 position 时，根据规范 footprint 的世界坐标轴对齐包围盒中心生成候选位置；这是摆放初始值，不是现场测绘原点。位置人工校准后填写 `positionVerified: true`。
3. `rotationY` 使用弧度制。规范 Feature 没有方向依据时保持未核验；不能把默认 0 当作真实朝向。确认后填写 rotationY 和 `rotationVerified: true`。
4. 只有 `status: "ready"`、有效 `/models/buildings/*.glb`、三个有限 position 值和明确 rotationY 的条目才会加载。其他条目作为待制作/待核验资产跳过，不会落到世界原点。
5. 模型文件放置于 `public/models/buildings/`，清单路径使用 `/models/buildings/<file>.glb`。
6. 加载成功后继续执行 GLB 结构检查与世界包围盒/footprint 几何偏差审计。

资产条目字段：
- `buildingId`：规范建筑 Feature ID。
- `modelUrl`：GLB 公共路径。
- `position`：校园本地米制坐标 [x, y, z]，模型原点按 footprint 中心地面位置约定。
- `rotationY`：绕 Y 轴旋转角，单位弧度。
- `status`：只有 ready 才参与加载。
- `positionVerified` / `rotationVerified`：位置和朝向人工核验标志。

当前仓库尚无已登记的建筑 GLB 文件，`public/data/buildings.json` 的 buildings 数组为空。因此运行时会从规范 Feature 生成待制作清单和位置候选值，但不会虚构模型文件、现场原点或旋转角。当前校园空间数据本身仍是人工近似数字化，候选坐标必须经图纸/现场资料复核后才能标记为 verified。


## 27. 校园资产来源与真实性边界（2026-11-05）

- 当前仓库没有独立提交的 GLB/GLTF/FBX/OBJ、图片、贴图、视频或字体资产文件；完整文件树共 150 个文件，本次资产扩展名扫描命中 0 个媒体/模型文件。
- 主校园可视资产主要由 `campusLayout.js` / FeatureCollection 空间数据和 `campusAssetLibrary.js` 程序化生成：建筑模板 10 种、人工近似建筑 footprint 约 53 个、道路中心线 10 条、基础区域记录 11 条、历史环境装饰点位 97 个。
- 草地、道路、屋顶、水面、墙体、木材等纹理由 Canvas 运行时生成；树木、花卉、座椅、路灯和人物由 Three.js 基础几何体组合。它们是项目代码生成的视觉资产，不是外部下载的素材文件。
- 主校园平面参考来自《南昌工学院 2026 级新生报到指南·校园平面图》；当前空间坐标仍为人工近似数字化的图像像素系，不能视为测绘坐标。外部图片 URL 只作为来源引用，不表示仓库已保存或取得再分发授权。
- `building-inventory-v1.json` 登记 23 条公开资料候选（17 条建筑/建筑群/场馆、6 条环境资产）和 6 个资料入口；全部未完成现场核验。候选名称不等于已定位建筑实体。
- `public/data/buildings.json` 当前没有 ready GLB 条目；真实建筑模型文件、测绘位置和朝向仍待补齐。程序化建筑继续作为当前视觉 fallback。
- 详细盘点、统计口径、来源链接和补齐顺序见 `docs/asset-source-audit-2026-11-05.md`。



## 28. AI 优先的校园视觉资产统一管理（2026-11-05）

视觉资产与空间数据分层管理。规范 FeatureCollection 仍是位置、建筑 footprint、道路连接、碰撞和 `walkable` 的唯一权威来源；视觉资产清单不得复制或覆盖这些字段。

- `public/data/campus-assets.json` 使用 schemaVersion 1，登记资产元数据、来源类型、审核状态、文件变体和 Feature 绑定。
- 资产来源统一支持 `ai_generated`、`manual_model`、`procedural`、`external`；审核状态为 `draft`、`review`、`ready`、`archived`。未达到 ready 的资产不参与解析。
- 一个 `assetId` 可登记 `2.5d`、`3d` 和显式 `shared` 文件变体。2.5D 主素材可使用图片/精灵图；3D 主素材可使用 GLB。解析优先使用当前视角 primary，只有显式 shared primary 才能 fallback，不允许跨视角隐式替代。
- `bindings` 通过稳定空间 `featureId` 关联 `assetId`。替换资产只改变视觉引用，不改变 Feature geometry、position、footprint、碰撞或通行属性。
- `src/data/campus/campusAssetManifest.js` 提供纯函数校验与视角解析；`campusAssetManifest.test.js` 覆盖有效/无效清单、视角变体、shared fallback、路径穿越、重复 ID、未知 Feature 和未审核资产。
- 资产文件必须放入受控公共目录（`/assets/campus/` 或既有 `/models/buildings/`），禁止路径穿越；AI 临时生成 URL 不作为长期资产路径。
- 当前清单为空，现有程序化资产与 `public/data/buildings.json` 的 GLB 加载流程保持不变。本阶段未接入 AI 生成服务、上传存储、素材工坊 UI、编辑器素材选择器或实际视觉替换。

后续接入顺序：资产上传/落盘与来源记录 → AI 生成任务和审核 → 编辑器素材库 → 2.5D/3D 视角资源绑定与运行时替换。每一步均不得改变空间 Feature 的碰撞和位置语义。


## 29. AI 素材工坊最小工作流（2026-11-05）

- 独立页面路由 `/asset-workshop`，通过异步组件加载；进入该路由时跳过校园引擎初始化，避免额外创建 WebGL 场景。
- 工作流覆盖校园 Feature 选择、2.5D/3D 目标选择、来源类型、AI 提示词生成/复制、文件导入、候选预览、本地暂存、审核、下载和清单导出。
- 2.5D 当前接收 PNG/WebP/JPEG 图片；3D 当前接收 GLB。GLB 在本阶段仅暂存与下载，不在工坊中实时渲染预览，模型结构继续由既有 GLB 审计流程负责。
- 二进制文件存储在浏览器 IndexedDB，候选元数据存储在 localStorage。该数据是当前浏览器本地草稿，不会自动同步服务器或其他设备；清理浏览器站点数据可能导致本地候选丢失。
- 资产必须由用户确认已放入项目 `public` 目录后才能标记 ready。2.5D 路径限定 `/assets/campus/` 图片；3D 路径限定 `/models/buildings/` GLB。导出器过滤未确认记录并校验安全路径。
- 同一空间 Feature 的不同视角变体会归并为稳定 `campus-<featureId>` assetId，并生成唯一 Feature binding。一个视角不能同时有多个 primary；冲突由 manifest validator 拦截。
- AI 提示词只生成风格与格式约束，不代表真实建筑识别。当前平面图建筑 ID 和 footprint 仍是低置信度近似空间对象；缺少实景照片/测绘资料时，素材必须标记为视觉占位稿。
- 本阶段不接云端生成服务、不做服务端上传/权限管理、不自动部署素材，也不修改正式校园渲染和碰撞。后续再评估供应商 API 接入和资产服务器。


## 30. AI 建筑参考图驱动代码生成 3D（2026-11-05）

- `gpt-image-2` 只负责生成建筑外观参考图；`VISION_MODEL`（当前配置 `deepseek-flash`）通过 `/assets/ai-image/analyze-building` 提取参数化外观结构，不把图片误当成 3D 模型。
- 识别参数包括建筑模板、楼层数、场景视觉高度、屋顶类型/坡度、窗户密度与尺寸、门宽、墙面色板、置信度、证据和识别限制。
- 素材工坊在用户审核后将 `buildingDesign` 与原始参考图一起入库到同一 Feature 资产记录。参考图仅用于识别、审核和追溯，不进入校园地图场景。
- 运行时通过 `resolveCampusBuildingDesign` 读取已审核参数，并交给 `createPixelBuilding` 生成墙体、屋顶、窗户和入口 Mesh。2.5D 与 3D 始终共用同一套真实 3D 几何和空间 footprint；2.5D 使用固定斜俯视正交相机，3D 使用可旋转透视相机。
- 参数仅用于视觉生成。`heightBasis=estimated-scene-units-not-surveyed` 明确表示高度为场景单位估算，不是真实建筑高度；位置、footprint、碰撞、walkable 和校园测绘数据不由 AI 修改。
- 人工 GLB 继续作为可选的高精度替代轨道。旧章节中“3D 必须导入 GLB”的描述已由本流程替代。
- 端到端真实识图仍需在本地后端环境使用已配置的 `VISION_MODEL` 联调；GitHub CI 单测不代表第三方视觉服务可用，也不代表最终建筑外观已通过浏览器验收。


## 31. 2.5D / 3D 建筑表现统一（2026-11-05）

- 建筑运行时禁止将 AI 参考图创建为 Sprite 或隐藏程序化建筑。参考图仅保存在资产库，供视觉识别、人工审核和来源追溯。
- `createCampusScene` 仅从审核通过的 `buildingDesign` 读取建筑外观参数，并调用 `createPixelBuilding` 生成实体 Mesh。AI 识别参数同时作用于 2.5D 与 3D。
- `setViewMode` 只切换 `CameraRig` 的相机投影/观察控制，不再切换建筑 Sprite、隐藏 Mesh 或切换基础建筑可见性。
- 两种模式共享建筑位置、footprint、材质、几何、碰撞和 walkable；模式差异仅在相机与交互：2.5D 固定斜俯视正交视角，3D 可旋转透视视角。


## 32. 建筑模板编辑职责与 AI 素材双视角预览（2026-11-05）

- 建筑模板库由地图编辑器消费。用户在编辑器选中建筑并选择模板后，应用模板完整视觉参数（高度、楼层、屋顶、门窗、墙面）；修改进入空间 FeatureCollection 历史和自动保存链路。
- 模板套用不覆盖建筑 footprint、位置、碰撞、Feature ID 或 walkable。视觉参数与空间语义保持分层。
- AI 素材工坊只负责生成参考图、识别结构参数、审核与资产入库，不承担编辑器模板选择职责。
- 工坊展示同一程序化建筑的 2.5D 正交斜俯视和 3D 透视预览。两个 viewport 调用同一 `createPixelBuilding` 构造 Mesh；相机投影不同，几何、材质、屋顶、门窗与结构参数相同。
- AI 参考图不得作为 Sprite、平面贴图或最终地图显示素材；仅用于识别与人工审核。人工 GLB 是可选的高精度替代资产来源。


## 33. AI 建筑参考图确认门禁

AI 参数化建筑生成采用明确的人工确认状态边界：

1. 图片生成或上传后仅进入预览态，允许用户检查外观并重新生成/更换图片。
2. 用户点击“确认图片预览”时，前端向 `POST /assets/ai-image/approve-reference` 提交图片；服务端校验文件格式与真实签名，对图片字节计算 SHA-256，并签发 15 分钟有效的一次性凭证。
3. `POST /assets/ai-image/analyze-building` 必须同时携带原图片和凭证。服务端重新计算摘要，校验摘要一致、凭证未过期后立即消费凭证，再调用视觉模型。
4. 缺少凭证、图片发生变化、凭证过期或重复使用均拒绝识别。前端更换/重新生成图片时清空确认状态。
5. 当前凭证保存在 BuildingDesignService 进程内存，适用于单实例开发联调；服务重启会使未使用凭证失效。多副本部署前必须迁移到共享 Redis，并增加用户/会话绑定、审计记录与限流。

该机制确保“确认后才进入识图/3D 参数生成”的服务端流程门禁，不是身份级签名或完整审批系统。AI 识别参数仍是视觉估算，不修改校园空间 Feature 的位置、footprint、碰撞和 walkable。


## 独立建筑模板库与空间实例解耦（2026-11-05）

建筑视觉模板是可复用的独立资产，不以校园 Feature ID 为主键。模板定义名称、分类、来源、版本状态、程序化结构参数或 GLB 模型文件，以及可选的 AI 参考图和提示词溯源信息。模板创建、上传和审核不创建、不移动、不删除任何校园空间对象。

AI 参数化路径必须遵循：提示词/参考图输入 → AI 图片生成或人工上传 → 页面预览 → 用户确认 → 服务端签发图片摘要凭证 → 视觉模型结构识别 → 服务端签发短时结构参数签名 → 创建模板。未确认图片时，服务端拒绝结构识别；程序化模板创建必须提交由服务端识别结果签发且与结构参数摘要匹配的短时签名。GLB 路径允许直接上传模型并预览验收，图片可作为可选外观参考。

地图编辑器将独立模板 ID 写入建筑 Feature 的视觉属性 modelTemplateId，并将程序化结构参数写入对应 Feature properties。空间 Feature 仍然是位置、footprint、walkable 和碰撞的唯一事实来源。运行时优先解析 ready 模板；程序化模板使用 Three.js 参数化 Mesh，GLB 模板异步加载并在模型加载失败时回退程序化几何。2.5D 与 3D 共享同一模型几何，只切换相机投影和观察控制。

服务端模板清单及文件位于 ASSET_STORAGE_DIR/campus-building-templates/。当前实现是单实例文件系统队列；多实例部署必须迁移到共享对象存储/数据库并引入分布式并发控制。模板 API 当前使用 DevIdentityGuard，仅适用于开发联调，生产环境上线前必须接入正式身份认证和角色授权。


补充约束：图片确认凭证和结构参数签名当前保存在 API 进程内存中，15 分钟过期；模板文件写入与清单更新使用进程内串行队列。多副本部署时必须将两类凭证迁移到 Redis/共享任务状态，并将文件与清单迁移到具备并发控制能力的共享存储，否则不同副本之间无法可靠验证凭证或协调写入。


编辑器退出策略：退出前必须确认当前空间文档已保存到服务端；保存失败或版本冲突时不卸载编辑器。保存成功后重载校园入口，使空间 Feature、已发布模板清单、Three.js 场景和碰撞世界在同一次初始化中读取同一版本数据。当前采用页面重载保证一致性，后续可在引擎层实现原子场景热替换以消除重载。
