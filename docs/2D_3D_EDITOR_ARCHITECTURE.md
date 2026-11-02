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


## 动态工作区坐标（当前实现）

- 编辑器几何仍保留原始校园平面图像素坐标，兼容既有 640×480 标注与 mapPixelToWorld 投影。
- 工作区边界由建筑 footprint、区域 polygon、道路节点动态计算，并始终包含原始 640×480 参考图范围。
- 边界按网格步长向外取整并增加留白；要素移动或新增到参考图之外时，工作区自动扩展，不裁剪、不重写几何。
- “适配工作区”根据当前动态范围调整视口；平移/缩放仍只改变视口，不改变要素坐标。
- 导出的编辑文档附带 workspaceBounds，供后续画布初始化和场景导入使用。

注意：这里的 pixel 是编辑器坐标单位，不是地理坐标，也不是米。当前 mapPixelToWorld 仍是演示比例投影；要得到真实校园尺度，必须完成控制点配准/比例校准，不能把动态工作区误认为 GIS 世界坐标系统。


## 第九阶段：底图校准计算底座（本阶段）
- 新增 `src/editor/campusMapCalibration.js`，定义底图像素坐标到 campus-local 局部坐标的 2D 相似变换：统一比例、旋转和平移。
- 支持两个及以上控制点的最小二乘拟合；控制点冗余时输出 RMS 残差，便于识别点选质量和底图畸变。
- 提供正向映射、反向映射和底图资源元数据构造方法；资源元数据只保存 URI、像素宽高和透明度，不将大体积 Base64 写入场景 JSON。
- 增加比例/旋转/平移、冗余控制点残差、反算、退化输入和资源元数据测试。
- 本阶段只交付可测试的计算模块与数据契约，尚未接入编辑器点选 UI、图片上传/对象存储、控制点持久化和 Three.js 坐标映射。当前编辑器原始 640×480 数据不会被自动重投影。
- 坐标语义：target 是 campus-local 局部坐标，不是经纬度；只有在控制点的 target 坐标和单位经过测量确认后，才可称为米制局部坐标。相似变换无法校正底图的非均匀拉伸、透视畸变或扫描变形；此类数据需要仿射/更高阶配准并评估误差。


### 第十阶段：底图导入与校准面板（前端原型）
- 编辑器支持 PNG/JPG/WebP 本地图片导入、底图透明度调节、移除底图和控制点选取。
- 控制点在画布显示位置换算回原始图片像素坐标；用户逐点输入目标 campus-local 坐标，至少两个点后实时拟合比例、旋转、平移和 RMS 残差。
- 场景导出增加 referenceImage 元数据与 calibration 参数，控制点随文档导出。
- 限制：图片当前仅通过浏览器内存预览，导出只保存 `local-preview-only` URI 和元数据，不包含图片字节；刷新后无法恢复图片。尚未实现对象存储/资产 API、跨会话资源 URL、后台持久化。
- 当前校准结果用于显示与导出，不会自动重投影现有建筑/道路/区域，也未接入 Three.js 预览的坐标转换链路。不能把本功能描述为已完成 GIS 配准。


## 第十一阶段：校准坐标接入三维预览
- 当场景文档同时包含 calibration 和 referenceImage 元数据时，三维预览将编辑器 640×480 坐标先按图片宽高换算为原始底图像素，再应用相似变换得到 campus-local 坐标，最后映射到 Three.js XZ 平面。
- 建筑 footprint、区域 polygon 和道路融合面统一使用同一映射函数，避免出现建筑已校准但道路/区域仍使用旧坐标的错位。
- 未提供校准数据的历史文档继续走原有 mapPixelToWorld 演示投影，保持向后兼容。
- 文档字段 `worldUnitsPerCampusUnit` 默认 1，只定义 campus-local 单位到 Three.js world unit 的数值比例；它不会自动证明 campus-local 单位是米。只有测量控制点使用米时，才能把该单位解释为米。
- 三维预览的地面仍是演示底板；本阶段不改变二维几何存储坐标、不执行数据迁移，也不代表底图资源已持久化。当前本地预览图片刷新后仍需重新导入。


## 第十二阶段：二维平面文档持久化
- 二维编辑器文档使用独立的 `campus_plan_document` 表和 `GET/PUT /campuses/:campusId/maps/:mapId/scene/plan` 接口。
- 二维编辑文档与三维 GIS 场景文档（`campus_scene`）隔离，避免编辑器保存时覆盖三维场景对象及其 Feature 关联。
- 文档通过 revision 乐观锁避免并发覆盖；底图文件通过地图资源接口上传，编辑文档仅保存资源 ID 和受控 contentPath。
- 当前资源存储由 `ASSET_STORAGE_DIR` 指定的本地文件系统提供，部署时必须挂载持久化卷；尚未实现对象存储适配。


## 第十三阶段：底图 AI 识图 MVP（模型适配层）

- 底图上传完成后自动调用 `POST /campuses/:campusId/maps/:mapId/assets/:assetId/recognize`，识别建筑、道路、绿地、水体、运动场、广场、停车场和设施。
- 视觉模型使用 OpenAI Chat Completions 兼容接口，支持通过 `VISION_API_BASE_URL` 接入兼容服务；`VISION_API_KEY` 和 `VISION_MODEL` 必须由部署环境配置，密钥不得写入前端。
- 识别结果使用原始图片像素坐标，返回 Polygon / LineString、类型、名称、置信度和来源标记；低于 0.75 的结果标记为待人工复核。
- 识别结果先导入二维编辑器草稿并触发自动保存，不直接写入正式 GIS Feature，避免模型误判污染权威空间数据。
- 编辑器提供“同时生成场景素材”选项。当前开关为建筑分配已有内置像素风建筑模板；独立 AI 模型生成、素材库持久化和树木/路灯等装饰资产生成尚未接入，不能视为已交付。
- 当前识图接口为同步请求，最长等待 180 秒；大图、慢模型或高并发场景应升级为持久化异步任务队列。图片按原图像素输出，暂不进行分块推理；超大底图建议先切片或降低分辨率。
- 配置示例（写入服务端环境变量）：

```env
VISION_API_BASE_URL=https://api.openai.com/v1
VISION_API_KEY=replace-with-server-side-key
VISION_MODEL=vision-capable-model
```

- 识别依赖模型本身支持图像输入和 JSON 输出；非视觉模型、仅文本模型或不支持 `response_format=json_object` 的兼容服务无法正常工作。
