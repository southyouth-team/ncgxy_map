# GIS 与三维场景数据对齐规范

## 1. 结论与边界

GIS 不是三维编辑器的替代品。GIS 负责校园空间事实与空间计算；Three.js 负责渲染；场景编辑器负责低门槛操作和把用户意图转成空间数据变更。

系统只保留一套校园平面空间事实，不允许 GIS Feature 与 Scene Object 各自保存一份互不一致的 X/Z 位置或建筑轮廓。

## 2. 现有代码基线

### 已有 GIS 数据底座
- `campus`：校园主体。
- `campus_map`：校园地图、坐标系统、单位、画布范围、配置和 revision。
- `campus_layer`：地图图层、类型、显隐、锁定和样式。
- `campus_feature`：PostGIS Geometry(SRID=0)、属性 JSON、revision。
- `campus_asset`：底图、纹理、模型等资源元数据。
- `campus_version`：地图版本快照。

Feature 采用 2D Geometry，且数据库显式约束二维。这是合理的：校园平面位置和轮廓留在 GIS；不应为了三维展示而把业务空间事实塞进一个混杂的 3D Geometry 字段。

### 已有三维运行时
- Three.js 场景、相机和漫游控制器已经存在。
- `createCampusScene.js` 仍从 `campusLayout.js` 的静态数组生成场景。
- 当前三维建筑、道路、湖泊是演示性生成逻辑，尚未从服务端 GIS Feature 加载。
- `campusData.js` 当前没有真实建筑数据。
- 新增 `SceneDocument` 是第一版数据契约，尚未接入编辑器或后端。

## 3. 唯一事实来源（必须遵守）

### GIS Feature 是平面空间事实的唯一来源
以下信息只在 Feature/Layer 中维护：
- 建筑、道路、绿地、水体、操场等对象的平面 Geometry。
- 对象的校园局部坐标位置、占地轮廓和空间关系。
- GIS 分类、业务名称、空间质量状态及来源信息。
- 图层显隐、锁定和地图空间组织。

Feature.geometry 是 GeoJSON，SRID=0，坐标属于对应 Map 的 campus-local 坐标系。当前不能将其解释为经纬度或米。

### Scene Object 是三维表现与编辑元数据
Scene Object 通过 `featureId` 关联 GIS Feature，只保存三维特有内容：
- 模型模板 ID、模型 Asset ID。
- 建筑楼层数、层高、檐口/屋顶样式等垂直参数。
- 材质、模型局部配置、渲染开关、LOD 等表现参数。
- 组件组合关系、模块清单和场景分组。
- 垂直基准/离地高度等确实属于三维的参数。

Scene Object 不得再保存第二份建筑 footprint 或独立的 X/Z 平面位置作为权威值。Three.js 的世界坐标应由 GIS Geometry + map 坐标映射 + 三维属性派生。

### 特殊情况
- 未绑定 GIS Feature 的草稿对象允许暂存在编辑器内存/本地草稿中；正式保存时必须先创建 GIS Feature，再保存关联的 Scene Object。
- 一个 GIS Feature 默认对应一个主 Scene Object。若未来需要一个建筑由多个独立渲染部件组成，使用一个主 Scene Object + child components，不要复制 Feature。
- 道路中心线和道路面域要按业务用途选定规范 Geometry；导航路网与可视化路面可建立派生关系，但不能各自成为无规则的空间真相。
- 建筑模块是 Scene Object 的构成，不是独立 GIS 建筑，除非模块本身需要独立空间检索。

## 4. 对象类型映射

| 场景类别 | GIS Feature | Scene Object |
|---|---|---|
| 建筑 | Polygon/MultiPolygon footprint | 模板/积木、楼层、高度、屋顶、材质 |
| 道路 | LineString 中心线或 Polygon 路面，按统一规范选择 | 宽度、路面厚度、路缘、材质 |
| 草地/广场/操场 | Polygon/MultiPolygon | 地表材质、厚度、标线/装饰 |
| 湖泊/水池 | Polygon/MultiPolygon | 水面材质、透明度、波纹等 |
| 树木/设施 | Point 或 Polygon | GLB/模板、朝向、尺寸、实例化参数 |

## 5. 坐标转换规则

- GIS 仍使用 `campus-local`，Three.js 地面映射到 XZ，Y 为高度。
- 坐标映射由唯一模块负责；禁止每个模型工厂自行换算。
- Map.coordinate_unit 必须被尊重。pixel/local-unit 不能冒充 meter。
- 底图像素配准、GIS 地图坐标、Three.js 世界坐标是三个不同层次；必须通过显式转换链连接。
- 用户在三维视口拖动建筑时，编辑器将新位置/轮廓反算为 Map 坐标，更新 Feature.geometry；渲染对象随后由 Feature + Scene Object 重新生成。
- 对真实尺寸、楼层和建筑名称没有可靠来源的数据必须保留 unknown/unverified 状态，不以视觉占位模型推断事实。

## 6. 保存事务与一致性

正式保存一个对象时：
1. 校验 Map、Layer、Feature 权限及 revision。
2. 创建或更新 GIS Feature（Geometry + GIS properties）。
3. 创建或更新关联 Scene Object（三维属性 + featureId）。
4. 在同一数据库事务中写入对象关联及 revision。
5. 返回更新后的 Feature 与 Scene Object 版本。

编辑已有对象时采用乐观锁；Feature revision 或 Scene revision 冲突时返回 409，前端提示刷新/冲突处理，不静默覆盖。

删除对象时，必须明确区分删除三维表现配置与删除空间实体。普通用户删除校园建筑对象默认是删除/归档整个业务对象，并在事务中处理关联；不得留下孤儿 Scene Object。

## 7. 对现有 SceneDocument 的后续调整

当前 SceneDocument 是前端初始数据契约，不是最终 API schema。正式接入前需补充：
- `mapId`：场景所属 Map。
- `featureId`：关联 GIS Feature（草稿阶段可为空）。
- `assetId` / `templateId`：模型资源或模板引用。
- `render`：材质、模型局部设置、垂直参数。
- `schemaVersion` 与迁移策略。

并移除/限制会与 Feature.geometry 重复的平面位置和占地数据。需要将 3D 垂直偏移与 GIS 平面坐标分开。

## 8. 实施顺序与停止条件

1. 先完成此数据契约及前端纯数据模型调整。
2. 增加 Feature ↔ Scene Object 的映射/适配器和单元测试。
3. 将当前静态 `campusLayout.js` 场景标记为 demo/reference source，逐步改为 API 数据驱动。
4. 增加服务端 Scene Object 表/接口，并在事务中维护 Feature 关联。
5. 最后接入拖放编辑器。

在 1–4 完成前，不开发会直接写入正式数据的拖放 UI，避免先产生两套数据源。

## 9. 非目标

- 不把 PostGIS 2D Feature 强行改成 3D Geometry。
- 不把 Three.js Object3D 序列化后作为数据库唯一数据源。
- 不把当前校园示意图和粗略建筑占位标注宣称为测绘数据。
- 不在第一版引入微服务或独立 GIS 服务。
