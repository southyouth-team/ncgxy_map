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

若缺少任一 ID，编辑器必须进入显式错误状态，禁用持久化并向用户展示缺失原因；不得静默保持“等待修改”。自动保存验收应确认：创建 Feature 后快照监听触发 dirty，PUT 返回新 revision，刷新后 GET 回读包含该 Feature。
