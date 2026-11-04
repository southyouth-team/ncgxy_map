## 2026-11-04 — 属性面板编辑纳入撤销/重做快照

- **修改文件**：`src/editor/CampusPlanEditor.vue`。
- **实际完成**：建筑名称/模板/楼层/高度/窗户/入口/屋顶、区域名称/类型、对象名称/类型/朝向/缩放、道路宽度等属性控件在获得焦点时先创建 undo 快照，避免直接 v-model 修改绕过历史记录。
- **验证状态**：前端 CI 最新提交 `65dff73` 测试与构建通过；本次快照改动等待新 CI。真实浏览器端交互仍需验收。
## 2026-11-04 — 统一编辑器与基础数据质量字段契约

- **修改文件**：`src/editor/campusFeatureCollection.js`、`src/data/campus/campusGeoJSON.test.js`。
- **实际完成**：
  - 编辑器 Feature 序列化时保留 `qualityStatus`，同时规范化输出 `confidence` 与 `verificationStatus`。
- 进一步修正点对象的规范类型：GeoJSON `featureType` 固定为 `object`，树木/座椅/路灯等具体类别写入 `objectType`。此前把 tree 直接作为 featureType 与统一 Point 对象契约不一致，现已对齐基础数据模型。
  - 旧编辑器文档缺少标准字段时使用保守默认值 low / unverified；已核验状态映射为 medium / verified。
  - 增加端到端适配器单测：编辑器建筑、道路、区域和点对象生成的 FeatureCollection 必须通过统一空间数据质检。
- **验证状态**：代码与测试已提交，等待最新 CI。
- **已知限制**：默认置信度只是数据治理初值，不代表真实精度；后续需由可靠来源逐对象校准。
## 2026-11-04 — 修复区域删除绕过统一删除契约

- **修改文件**：`src/editor/CampusPlanEditor.vue`。
- **实际完成**：区域属性面板原先直接过滤数组，绕过基础 Feature tombstone 写入；现统一调用 `deleteSelected()`，复用图层锁、撤销快照、基础对象删除标记和选中状态清理。
- **验证状态**：修复已提交，等待 CI；真实浏览器端删除/刷新回归尚未执行。
- **下一步**：检查其余编辑器入口是否存在绕过统一删除、撤销或自动保存流程的直接数组修改。
## 2026-11-04 — 扩展空间数据类型与几何一致性质检

- **修改文件**：`src/data/campus/campusGeoJSON.js`、`src/data/campus/campusGeoJSON.test.js`。
- **实际完成**：
  - 将所有当前业务 Feature 类型映射到明确几何契约：区域/建筑使用 Polygon，道路使用 LineString，出入口/POI/设施对象使用 Point。
  - 校验集合成员必须为 Feature，并拒绝缺失或未知的 featureType。
  - 增加错误用例，覆盖水域 Point、树木 Polygon、未知业务类型。
- **验证状态**：代码和测试已提交，等待最新 CI；尚未进行真实浏览器验收。
- **已知限制**：目前几何契约不支持 MultiPolygon/MultiLineString；后续如需复杂边界，应先扩展渲染适配器和测试。
- **下一步**：验证 CI，再检查建筑/道路/区域属性编辑 UI 是否完整写入 Feature.properties。
## 2026-11-04 — 完整基础校园数据合并与编辑器底集补齐

- **修改文件**：`src/data/campus/campusGeoJSON.js`、`src/data/campus/campusGeoJSON.test.js`、`src/editor/CampusPlanEditor.vue`。
- **实际完成**：
  - 首页合并函数改为将全部基础 Feature 作为底集，不再只合并校界、出入口和点对象。
  - 编辑器同 ID Feature 覆盖基础 Feature；新增 Feature 保留；tombstone 在最终阶段过滤。
  - 编辑器首次打开/加载稀疏旧文档时补齐基础建筑、道路、区域及 96 个基础环境对象，编辑器已保存数据按 ID 覆盖。
  - 单项和批量删除任何基础对象都会记录删除标记。
  - 保存文档时将 `deletedFeatureIds` 写入顶层兼容字段和 FeatureCollection，修复此前构建保存文档时遗漏删除标记的问题。
- 读取删除记录时合并顶层兼容字段与 FeatureCollection 内的 `deletedFeatureIds`，避免任一旧格式字段存在空数组时覆盖另一处有效删除记录。
  - 扩展合并测试，覆盖基础建筑/区域保留和基础道路删除优先级。
- **验证状态**：最新修复提交 `74d3120` 的 Frontend CI 与 Backend CI 均通过（Frontend 测试与构建成功，Backend CI 成功）；此前首次前端 CI 仅因测试预期未同步增加的删除 ID 而失败，已修正。未进行真实浏览器验收。
- **已知限制**：删除后恢复对象的 UI 操作尚未实现；编辑冲突仍依赖现有文档 revision 机制。
- **下一步**：验证 CI；继续检查编辑器属性保存与首页渲染的完整字段映射。
## 2026-11-04 — 修复共享场景适配器的属性丢失

- **修改文件**：`src/data/campus/campusGeoJSON.js`、`src/three/world/campus/campusSceneData.js`、`src/three/world/campus/campusSceneData.test.js`。
- **实际完成**：
  - 建筑、道路、区域标准图层保留原 Feature 的完整 properties。
  - 编辑器预览文档将完整属性透传，保留屋顶样式、入口边、窗户密度、门宽、车道数、路面材质等扩展字段。
  - 增加测试验证建筑、道路和水域属性从 FeatureCollection 到预览输入的保真。
- **验证状态**：修复代码和测试已提交，等待最新前端/后端 CI；未进行真实浏览器验收。
- **已知限制**：属性保真只解决数据适配层丢字段问题，不代表首页渲染器已经解释所有扩展属性；仍需逐个补充 renderer capability 和真实数据核验。
- **下一步**：验证 CI，继续审查基础数据覆盖策略与场景渲染输入；完成第三阶段验收后进入双引擎阶段。
## 2026-11-04 — 首页与编辑器预览共用场景数据适配器

- **新增文件**：`src/three/world/campus/campusSceneData.js`、`src/three/world/campus/campusSceneData.test.js`。
- **修改文件**：`src/three/world/campus/createCampusScene.js`、`src/three/engine/createCampusEngine.js`。
- **实际完成**：
  - 新增共享适配器，从统一 FeatureCollection 派生标准空间图层与编辑器预览兼容文档。
  - 首页场景通过共享适配器读取建筑、道路、区域和点对象图层。
  - 编辑器预览优先消费规范 FeatureCollection；旧版数组文档先转换为 FeatureCollection，再进入同一适配器。
  - 新增测试验证建筑 footprint、道路中心线、区域几何、点对象坐标和属性由同一输入派生。
- **验证状态**：首次前端 CI 暴露共享适配器导入路径少一级目录，已修正为从 campus 目录正确回到 src/data；修复提交 CI 待回收。未进行浏览器人工验收。
- **边界说明**：当前完成的是共享数据适配层，不是独立双引擎；首页和编辑器预览仍由 Three.js 渲染。第四阶段仍需建立真正的 2.5D/3D 双 renderer 契约。
- **下一步**：回收 CI；检查场景预览与首页的坐标校准差异；继续补齐基础建筑/道路/区域来源合并与数据覆盖语义。
## 2026-11-04 — 统一校园目录与空间 Feature 的数据边界

- **修改文件**：`src/data/campus/campusGeoJSON.js`、`src/data/campus/campusGeoJSON.test.js`。
- **实际完成**：
  - 基础 FeatureCollection 的 metadata 增加 `catalogue`，集中保存未定位 POI、场地台账和建筑身份元数据。
  - `getCampusSpatialLayers` 优先从当前 FeatureCollection catalogue 读取 POI/场地目录。
  - 首页 Feature 合并函数保留基础 metadata，避免目录数据在合并时丢失。
  - 增加测试验证目录可从统一数据集读取，未定位 POI 不会被伪造成 GeoJSON Feature。
- **验证状态**：代码与测试已提交，等待 CI；未进行浏览器端到端验收。
- **已知限制**：目录中的 POI/场地多数仍待定位，建筑身份和 footprint 仍有待核验状态；尚未统一编辑器预览与首页场景构建流程。
- **下一步**：验证 CI，随后抽取共享场景 Feature 适配器，避免首页与编辑器预览分别转换同一空间数据。
## 2026-11-04 — 抽取首页 Feature 合并契约

- **修改文件**：`src/data/campus/campusGeoJSON.js`、`src/data/campus/campusGeoJSON.test.js`、`src/App.vue`。
- **实际完成**：
  - 新增纯函数 `mergeCampusSceneFeatureCollections`，集中处理基础边界/出入口/环境对象与编辑器 FeatureCollection 的合并。
  - 同 ID 编辑器 Feature 覆盖基础 Feature；编辑器新增 Feature 保留；删除标记在合并末端统一过滤。
  - 首页初始化改为调用统一合并函数，移除 Vue 生命周期中的临时 Map 合并逻辑。
  - 增加覆盖、追加、删除优先级单元测试。
- **验证状态**：首次前端 CI 发现测试文件遗漏合并函数导入，已补齐 import 并触发新一轮 CI；当前修复提交结果待回收。未进行真实浏览器验收。
- **已知限制**：基础校园建筑/道路/区域的完整权威数据源仍未统一；未定位 POI 和场地记录暂不生成伪造几何。
- **下一步**：梳理基础 POI、场地台账与 FeatureCollection 的关系，明确未定位记录模型；随后统一首页与编辑器预览的场景构建适配器。
## 2026-11-04 — 编辑器基础对象删除同步

- **修改文件**：`src/editor/CampusPlanEditor.vue`、`src/editor/campusFeatureCollection.js`、`src/editor/campusFeatureCollection.test.js`、`src/App.vue`。
- **实际完成**：
  - FeatureCollection 增加迁移期 `deletedFeatureIds`，正向/反向适配器保留删除标记。
  - 编辑器删除历史场景装饰对象时记录稳定 ID；单选删除和批量删除均覆盖。
  - 删除标记进入自动保存文档，并纳入 undo/redo 快照。
  - 首页合并基础环境 Feature 与编辑器 Feature 后按删除标记过滤，避免基础对象被重新合并出来。
  - 增加适配器删除标记往返测试。
- **验证状态**：代码已提交；首次前端 CI 暴露新增测试遗漏反向适配器导入，已补齐 import 并重新触发 CI；此前 Backend CI 已通过。当前修复提交的 CI 结果待回收；未进行真实浏览器端到端验收。
- **已知限制**：当前 tombstone 仅针对来源为 `legacy-scene-decoration` 的基础环境对象；其他基础数据删除策略、恢复对象、服务端冲突解决和审计仍需设计。
- **下一步**：验证 CI，补充首页合并行为测试；随后统一编辑器预览和首页的场景构建入口，继续完成第三阶段数据契约。

## 2026-11-04 — 环境装饰对象纳入统一空间数据

- **修改文件**：`src/data/campus/campusGeoJSON.js`、`src/data/campus/campusGeoJSON.test.js`、`src/three/world/campus/createCampusScene.js`、`src/App.vue`。
- **实际完成**：
  - 将原场景内树木、花卉、长椅、路灯共 96 个对象迁移为 Point Feature。
  - 每个对象拥有稳定 ID、类型、坐标、来源、置信度和未核验状态。
  - 首页把基础装饰 Feature 与编辑器 FeatureCollection 合并，同 ID 编辑对象覆盖基础对象。
  - 主场景从统一对象图层生成树木、花卉、座椅和路灯，删除了渲染脚本内对应的独立坐标数组。
  - 增加 96 个对象的 FeatureCollection 数据回归测试，并修正基础 Feature 数量断言；首次 CI 暴露数量断言误差，已按实际 Feature 数修正。
- **数据质量说明**：坐标从旧场景装饰数组迁移，属于历史视觉占位坐标，全部标记未核验；不能作为真实校园设施测绘成果。
- **已知限制**：基础对象删除的 tombstone/同步语义尚未定义；其他 POI 和环境细节仍有独立数据源；尚未完成真实浏览器验收。
- **下一步**：补齐对象编辑删除同步语义和场景交互回归，再统一编辑器预览与首页渲染适配器。

## 2026-11-04 — 首页场景初始化接入统一 FeatureCollection

- **修改文件**：`src/App.vue`、`src/three/engine/createCampusEngine.js`、`src/three/world/campus/createCampusScene.js`。
- **实际完成**：
  - 首页在创建引擎前读取已保存的编辑器文档；优先使用其 FeatureCollection，没有时从现有编辑器文档结构转换。
  - 将基础校园数据中的 boundary/gate 与编辑器可编辑要素组合，作为单一 FeatureCollection 注入校园场景初始化。
  - `createCampusScene` 从注入集合派生建筑、道路、区域和 Point 设施，不再在初始化后额外调用 `previewCampusPlan` 覆盖首页地图。
  - 道路宽度参与场景道路铺装；区域 Polygon/holes 进入场景构建；树木、路灯、座椅等 Point Feature 在主场景中生成对应资产并保留 ID、名称、朝向和缩放。
- **已知限制**：旧场景中的部分树木、花卉、长椅、路灯仍以程序化装饰坐标存在，尚未全部迁移为 Feature；编辑器独立 3D 预览尚未统一到同一 renderer adapter；真实浏览器体验未验收。
- **验证状态**：本轮修改已提交，CI 正在触发；不能将提交成功视为测试通过。
- **下一步**：补充场景初始化集成测试，处理静态装饰对象数据化；随后统一 2.5D/3D 的 FeatureCollection 渲染适配器。

## 2026-11-04 — 空间数据：统一 FeatureCollection 渲染图层适配

- **修改文件**：`src/data/campus/campusGeoJSON.js`、`src/data/campus/campusGeoJSON.test.js`、`docs/architecture/CAMPUS_SPATIAL_ARCHITECTURE.md`。
- **实际完成**：
  - `getCampusSpatialLayers(collection)` 可直接接收编辑器保存的 GeoJSON FeatureCollection，不再只识别基础数据的 `area + category` 格式。
  - 统一归一化建筑 Polygon、道路 LineString、绿地/水域/运动场/广场/停车场 Polygon，以及树木/路灯/座椅/雕塑等 Point。
  - 保留道路宽度、建筑楼层/高度/模板、区域内环、点对象朝向/缩放、稳定 ID 和来源/质量状态。
  - 置信度字段兼容基础数据 `confidence` 与编辑器 `qualityStatus`。
  - 增加编辑器 FeatureCollection -> 渲染图层的转换测试。
- **验证边界**：自动化测试已补充；本提交前端 CI 尚在执行。此提交建立了渲染适配层，但首页启动尚未完全改为注入编辑器 FeatureCollection，2.5D/3D 所有路径仍需后续统一和验收。
- **下一步**：将编辑器 FeatureCollection 作为首页场景启动数据源，避免静态底图与编辑器预览叠加两份空间对象；随后把同一 FeatureCollection 接入独立的 2.5D/3D 渲染适配器。

## 2026-11-04 — 空间数据：建立统一 GeoJSON FeatureCollection 交换层

- **修改文件**：`src/editor/campusFeatureCollection.js`、`src/editor/campusFeatureCollection.test.js`、`src/editor/CampusPlanEditor.vue`、`src/three/engine/createCampusEngine.js`、`docs/architecture/CAMPUS_SPATIAL_ARCHITECTURE.md`。
- **实际完成**：
  - 新增 `toCampusFeatureCollection`，将建筑 Polygon、道路 LineString + width、区域 Polygon（含 holes）、树木/设施 Point 统一转换为 GeoJSON FeatureCollection。
  - 每个 Feature 统一保留稳定 id、featureType、name、source、qualityStatus；道路宽度、建筑属性、设施朝向/缩放保留在 properties。
  - 编辑器保存文档新增 schemaVersion 3 的 `featureCollection`；加载时优先读取 FeatureCollection，并通过兼容适配器恢复现有编辑交互集合。
  - Three.js 编辑器预览优先从 FeatureCollection 还原渲染输入，确保预览读取与保存相同的几何内容。
  - 新增几何闭合、内环保留、类型映射、异常记录过滤和往返转换测试。
- **架构边界**：当前 FeatureCollection 是统一交换/保存契约；编辑器交互仍保留旧集合，文档暂时同时包含兼容字段。服务端 canonical-only 存储、探索首页所有渲染路径统一消费 FeatureCollection 尚未完成，不能宣称第三阶段完成。
- **验证边界**：已增加 Vitest 单元测试；提交后的前端/后端 CI 待执行。尚未完成浏览器端编辑、保存、刷新和 2.5D/3D 同源数据验收。
- **下一步**：CI 通过后，继续让首页校园探索加载统一 FeatureCollection，逐步移除旧数组作为第二数据源；随后建立 2.5D/3D 共用渲染适配器。

## 2026-11-04 — 编辑器：增加连续线/面几何绘制

- **修改文件**：`src/editor/CampusPlanEditor.vue`。
- **实际完成**：
  - 建筑、道路、区域工具改为逐点采集几何，不再点击一次就生成固定矩形/预制折线。
  - 道路使用至少 2 个顶点生成 LineString，并保留道路宽度属性。
  - 建筑与绿地、水域、操场、广场、停车场等区域使用至少 3 个顶点生成 Polygon；闭合环由几何工具统一处理，编辑器 footprint 保留非重复末点的顶点环。
  - 绘制过程显示临时几何和顶点数量；通过“完成绘制”提交，通过“取消绘制”或 Esc 放弃。
  - 完成的要素进入既有建筑/道路/区域集合，沿用属性面板、撤销/重做与自动保存机制。
  - 建筑资产库点击现在只切换建筑绘制工具，不再绕过画布直接生成固定矩形。
- **验证边界**：
  - 使用现有 `createDraftGeometry` 处理 LineString/Polygon，并已有单元测试覆盖闭合、顶点数和坐标合法性。
  - 尚未在真实浏览器完成连续点击、绘制完成/取消、吸附、自动保存与三维预览端到端验收；本提交 CI 待执行。
  - 旧的单击放置辅助函数暂时保留但不再由主画布入口调用，后续清理前需确认无其他引用。
- **下一步**：运行前端 CI；继续完善绘制时的顶点吸附、道路/建筑/区域绘制体验及空间对象统一序列化。

## 2026-11-04 — 编辑器：修复点对象重做快照遗漏

- **修改文件**：`src/editor/CampusPlanEditor.vue`。
- **实际完成**：
  - 修复 redo 将当前状态压入 history 时遗漏 `objects` 集合的问题。
  - 现在 undo/redo 两个方向的快照都包含建筑、道路、区域和点对象，避免撤销后重做时树木、路灯、座椅、雕塑等对象状态丢失。
- **验证边界**：
  - 已完成代码路径检查；该提交的前端 CI 尚待执行。
  - 尚未进行真实浏览器的对象放置、撤销、重做、刷新持久化端到端验收。
- **下一步**：继续审查编辑器 Point/LineString/Polygon 的绘制与持久化闭环，并完成第一阶段浏览器入口验收。

## 2026-11-04 — 第一阶段：清理旧 showcase 查询参数

- **修改文件**：`src/App.vue`。
- **实际完成**：
  - 从进入室内建筑的跳转 URL 中移除旧的 `view=showcase` 参数，改为仅通过 `buildingId` 表达目标建筑。
  - 进入建筑时显式清理旧 `view` 参数，避免历史场景入口语义残留在 URL 中。
  - 校正注释：校园探索统一使用 `campus` 场景，室内入口不再依赖 showcase 查询参数。
- **验证边界**：
  - 本次为路由语义清理；需通过后续前端 CI 验证构建。
  - 室内建筑入口仍需浏览器端验证，不能仅凭 URL 改动认定室内流程验收通过。
- **下一步**：继续完成第一阶段路由/相机/移动端回归；验收后进入第二阶段绘制交互闭环。

## 2026-11-04 — 第一阶段：保持 2.5D / 3D 切换时的总览取景

- **修改文件**：`src/three/camera/CameraRig.js`。
- **实际完成**：
  - 总览模式切换时，使用 OrbitControls 的实时观察目标，而不是可能滞后的 `currentTarget`。
  - 正交投影与透视投影之间按垂直视场高度换算相机距离/正交视野，降低切换时校园突然放大、缩小或偏移的风险。
  - 跟随与第一人称仍由角色位置和相机控制模式驱动，不把展示投影与操控模式重新耦合。
- **验证边界**：
  - 代码已提交；实际视觉取景仍需浏览器端验证，不能仅凭公式认定体验验收通过。
  - 本次不改变校园空间数据、对象几何或编辑器保存逻辑。
- **下一步**：检查新提交的前后端 CI；浏览器验收继续覆盖 2.5D/3D 反复切换、总览拖拽后切换、跟随/第一人称切换和移动端布局。

## 2026-11-04 — 第一阶段：补齐浏览器历史导航与编辑器路由状态

- **修改文件**：`src/App.vue`。
- **实际完成**：
  - 增加 `popstate` 路由同步：浏览器前进/后退时，按当前 URL 在校园探索与地图编辑器之间切换。
  - 浏览器后退离开编辑器时重新加载首页地图文档，并清理编辑器预览/室内临时场景，恢复 2.5D 总览。
  - 浏览器前进进入 `/editor` 或兼容的 `?view=editor` 时，切换到编辑器平面工作区。
  - 点击“返回校园探索”使用 `replaceState` 更新当前历史项，避免随后按浏览器后退重新进入刚关闭的编辑器。
  - 组件卸载时移除 `popstate` 监听，避免重复监听。
- **验证边界**：
  - 代码路径已补齐；真实浏览器前进/后退、直接访问 `/editor`、刷新和部署服务器 SPA fallback 仍需在浏览器/部署环境验收。
  - 本次不改变校园空间数据、相机投影或编辑器数据结构。
- **下一步**：完成入口路由的浏览器验收，再处理第一阶段剩余的 3D 全景取景和移动端控件回归。

## 2026-11-04 — 第一阶段：拆分 2.5D/3D 展示模式与相机控制

- **补充修正**：初始化 CameraRig 时直接按 `viewMode` 选择正交/透视相机，并为当前相机创建 OrbitControls；避免以 3D 初始状态加载时内部仍持有正交相机。

- **修改文件**：`src/App.vue`、`src/three/camera/CameraRig.js`、`src/three/engine/createCampusEngine.js`。
- **实际完成**：
  - 校园探索增加独立的 2.5D / 3D 展示切换：2.5D 使用正交投影，3D 使用透视投影。
  - 相机控制独立为总览、跟随、第一人称，不再把第一人称直接标记为 3D。
  - 视图切换在同一场景和同一引擎实例内完成，保留角色坐标及当前相机朝向/目标，不重载另一份校园数据。
  - 地图编辑器入口改为 `/editor` 路径，同时兼容旧 `?view=editor` 入口；退出编辑器返回 `/`。
  - 3D 预览初始化时显式使用 3D 投影。
- **验证与限制**：
  - 首轮 Frontend CI 在生产构建阶段发现 `/editor` 路径判断正则转义错误；已按构建日志修正。
  - 展示模式栏与相机控制栏分开定位，避免两组控件重叠，并为窄屏设置独立垂直间距。
  - 修正后的前后端 CI 需以最新提交的 GitHub Actions 结果为准。
  - 尚未完成真实浏览器运行时验收；透视投影下的校园取景、移动端布局及旧的室内/样板入口仍需回归检查。
  - 本次完成的是同一场景相机投影切换，不代表已完成独立 2.5D/3D 资产渲染适配器；双引擎仍属于第四阶段。
- **下一步**：在本阶段浏览器验收通过后，继续完善统一编辑器工具与点/线/面绘制工作流。

## 2026-11-04 — 第三阶段：点/实例对象进入统一编辑文档

- **修改文件**：
  - `src/editor/CampusPlanEditor.vue`
  - `src/three/engine/createCampusEngine.js`
- **实际完成**：
  - 编辑器增加点对象放置工具，支持树木、路灯、座椅、雕塑四类实例。
  - 点对象使用 GeoJSON Point 几何，属性保留名称、类型、朝向、缩放、来源和质量状态。
  - 点对象支持画布放置、拖动、选择、属性修改、删除、复制/粘贴。
  - 点对象纳入编辑文档 `objects` 字段，修复保存时强制写入空数组的问题；服务端加载、自动保存、导出均保留对象数据。
  - 撤销/重做快照纳入点对象集合，新增独立点对象图层。
  - Three.js 校园平面方案预览读取相同 Point Feature，按类型生成树木、路灯、座椅和雕塑程序化模型。
  - 移除编辑器中原先硬编码的树木装饰点，避免装饰数据与正式空间对象重复。
- **边界与风险**：
  - 本阶段渲染接入的是当前校园平面方案预览路径；尚未完成独立、完整的 3D 渲染适配器，也未完成真实校园全量对象迁移。
  - 点对象的 2D 编辑符号目前是简化圆形标记；树木等视觉符号后续可升级为统一资产图标。
  - 多对象框选/批量拖动对 Point 几何的适配仍需专项验证。
  - 当前页面的 2.5D/第一人称相机控制尚未等同于真正独立的 2.5D/3D 视图模式。
- **验证**：
  - 前端/后端 CI 已对上一阶段通过；本阶段提交后的 CI 尚待运行完成。
  - 未完成浏览器端放置、刷新重载、撤销重做及 2.5D/3D 端到端验收。
- **下一步**：
  1. 补齐统一 Feature 数据契约与所有几何类型的编辑操作（Point/LineString/Polygon）。
  2. 实现明确的 2.5D 与 3D 展示模式，不再将第一人称相机直接标注为 3D。
  3. 将编辑器中的点/线/面对象统一送入两个渲染适配器。
  4. 清理旧的 `view=showcase` 路由语义并验证首页/编辑器入口。

# 开发变更记录

本文件只记录已经提交的事实。计划事项不得写成已完成。

## 2026-11-04 — 第二阶段：校园区域对象类型化绘制

- **变更类型**：编辑器对象工具与场景预览。
- **修改文件**：
  - `src/editor/CampusPlanEditor.vue`
  - `src/three/engine/createCampusEngine.js`
- **实际完成**：
  - 编辑器新增区域绘制工具，可在平面画布点击放置区域占地轮廓。
  - 区域类型可选：绿地/草坪、水体/湖泊、操场/运动场、广场/铺装、停车场。
  - 选中区域后可修改名称、类型，并继续使用现有顶点编辑、移动、撤销/重做和自动保存机制。
  - 2.5D/场景预览按区域类型使用不同地表材质；水体使用较低粗糙度材质。
  - 区域仍以统一 `areas` Feature 集合持久化，未新增独立的第二份地图数据。
- **限制**：
  - 区域工具当前采用点击位置生成初始矩形，再通过顶点编辑调整轮廓；尚未实现鼠标连续绘制多边形。
  - 树木、路灯、座椅等点/实例对象尚未实现为可编辑持久化对象；画布上现存的树木装饰仍有硬编码数据，不能视为正式空间数据。
  - 3D 当前仍是第一人称相机模式，尚未提供完整的第三人称透视 3D 渲染档位；需后续拆分投影模式与相机控制模式。
- **验证**：
  - 第一阶段入口重构对应 Frontend CI、Backend CI 均通过（commit `ff4d3fb`）。
  - 本阶段代码已提交；本阶段 Frontend CI / Backend CI 正在运行，结果未出炉。
  - 未完成浏览器交互验收。
- **下一步**：
  1. 实现点/实例类对象（树木、路灯、座椅），接入保存和两种渲染器。
  2. 将 2.5D/3D 视图切换与总览/跟随/第一人称相机控制解耦。
  3. 将区域矩形放置升级为连续多边形绘制。
  4. 在浏览器验证默认入口、编辑器区域绘制、自动保存和 2.5D 预览一致性。

## 2026-11-04 — 第一阶段：默认入口切换为 2.5D 校园探索

- **变更类型**：入口与场景初始化重构。
- **修改文件**：
  - `src/App.vue`
  - `src/three/engine/createCampusEngine.js`
- **实际完成**：
  - 根路径不再挂载 Canvas 2D `CampusPixelMap`，改为启动 Three.js 校园场景并应用当前平面编辑文档预览。
  - 根路径默认展示 2.5D 等距校园探索；原 `?view=editor` 仍进入平面地图编辑器。
  - 校园探索增加“打开地图编辑器”入口；编辑器 3D 预览与探索使用同一引擎实例。
  - 将等距 RPG 相机能力与虚构 RPG 样板场景类型解耦；真实校园场景可以使用等距相机，不必加载虚构样板校园。
  - 视角标签明确为“2.5D 总览 / 2.5D 探索 / 3D 视角”。
- **重要边界**：当前 3D 视角是同一场景的第一人称透视相机模式；尚未完成独立的完整 3D 建筑资产/细节升级。当前阶段也未改变平面编辑器对象类型能力。
- **验证状态**：已提交代码；等待 GitHub Actions 构建结果。尚未进行浏览器运行时验收。
- **已知风险/后续验证**：需确认默认场景中校园数据预览成功、场景 Canvas 尺寸正常、编辑器打开/关闭不丢失引擎状态；检查首页进入时的实际地面/建筑/道路可见性。
- **下一步**：补齐 2.5D 与 3D 显式切换体验及编辑器入口路由状态，再统一编辑器对象类型和几何绘制工具。

## 2026-11-04 — 建立产品目标与架构基线

- **变更类型**：文档/产品决策固化。
- **正式目标**：两个一级入口——校园探索、地图编辑器。
- **校园探索**：默认 2.5D，可切换 3D；两种视图共用同一校园空间数据。
- **地图编辑器**：以平面底图绘制建筑、道路、树木、水域、绿地、广场及设施；按对象语义选择点/线/面/实例工具；保存为统一空间模型并预览 2.5D/3D。
- **架构原则**：一套权威空间数据、多个渲染适配器；平面图是数据生产工具，不是独立权威地图。
- **代码状态**：本次只建立规范文档，尚未完成入口代码重构；当前 `src/App.vue` 默认仍挂载 `CampusPixelMap`，2.5D Three.js 入口仍依赖旧的 `?view=showcase` 逻辑。
- **验证**：已读取开发分支最新 `src/App.vue`、`CampusPixelMap.vue`、Three.js 引擎及现有产品/空间数据文档；本次没有运行构建，因为未改动运行时代码。
- **下一步**：将首页入口改为真正的 2.5D 校园探索；明确 2.5D/3D 同场景视图切换；将平面编辑器作为独立入口；移除 `isRpgSample` 同时承担样板与真实校园入口的语义混用。


## 2026-11-04 — 第三阶段：拆分置信度与核验状态

- **变更类型**：统一空间数据适配器修复与回归测试。
- **修改文件**：
  - `src/editor/campusFeatureCollection.js`
  - `src/editor/campusFeatureCollection.test.js`
  - `src/data/campus/campusGeoJSON.test.js`
  - `docs/architecture/CAMPUS_SPATIAL_ARCHITECTURE.md`
- **实际完成**：
  - 编辑器 Feature 正向序列化时，`confidence` 只表示 low / medium / high；`verificationStatus` 只表示 verified / unverified；`qualityStatus` 保留编辑器历史核验状态。
  - 不再把旧字段 `confidence` 当作 `qualityStatus` 传入，避免 high / medium 被错误解释为核验状态。
  - FeatureCollection 反向转换时分别恢复置信度、核验状态和编辑器质量状态，不再用 `qualityStatus` 覆盖置信度。
  - 新增正向/反向适配器回归测试，以及编辑器 FeatureCollection 直接进入 `validateCampusGeoJSON` 的集成质检测试。
- **验证**：
  - 已通过代码级检查确认新增断言覆盖 building、road、water 三类对象。
  - GitHub Actions 将在提交后执行；本记录不提前宣称 CI 通过。
  - 尚未进行真实浏览器端保存/刷新验收。
- **未解决事项**：
  - 仍需核对所有旧文档中 `qualityStatus` 的历史取值，确认没有超出 verified / unverified 的业务状态。
  - 仍需执行浏览器端保存、回读、首页与编辑器预览一致性验收。
- **下一步**：等待前后端 CI；通过后继续第三阶段完整 FeatureCollection 合并与持久化验收，不提前进入第四阶段。


### 统一图层置信度回退规则补充

- 修正 `getCampusSpatialLayers` 的置信度读取：只接受 low / medium / high；缺失或非法值回退为 low，不再把 `qualityStatus: unverified` 当作置信度。
- 修正旧测试中将 `confidence: medium` 错误断言为 `qualityStatus: medium` 的语义混淆，改为分别断言三个字段。


### 点对象质量元数据回读修复

- 修复编辑器初始化基础点对象时将 `confidence` 从业务属性中剥离的问题。
- `qualityStatus` 不再回退读取 `confidence`；优先使用历史质量状态，其次使用 `verificationStatus`，最终保守回退为 unverified。
- 增加点对象往返转换测试，确保 confidence、verificationStatus、rotation、scale 均保留。


- 统一质检集成用例进一步覆盖 Point 树木对象，检查其 objectType、confidence、verificationStatus 与 qualityStatus 同时符合契约。
