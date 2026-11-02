# 多校园地图平台架构（V1）

## 1. 产品边界

本仓库从单一南昌工学院演示地图升级为通用校园地图平台。南昌工学院是首个 Campus 项目，后续高校通过创建数据项目接入，不复制前端或三维引擎代码。

V1 目标：
- 一个部署实例管理多个学校（Campus）。
- 每个学校可有多个地图项目/版本。
- 地图数据由后端持久化；浏览器只负责编辑状态和渲染缓存。
- 二维编辑器和 Three.js 消费同一套标准化地图数据。
- 草稿与已发布版本隔离，编辑不会直接影响公开展示端。
- 图片、底图、GLB、纹理等二进制文件进入对象存储，MySQL 只保存元数据和对象 Key。

非目标：
- V1 不建设通用 GIS 平台，不引入 PostGIS。
- V1 不做多人实时协同；先做成员权限和乐观锁，协同编辑后续迭代。
- 不将当前粗略人工标注的 campusLayout.js 直接当作正式测绘数据。

## 2. 核心领域模型

```text
Campus（学校/租户）
  ├── CampusMember（成员与角色）
  └── CampusMap（地图项目）
        ├── CampusLayer（图层）
        │     └── CampusFeature（空间要素）
        ├── CampusAsset（资源索引）
        └── CampusVersion（版本快照）
```

### Campus
代表一个学校或校园主体，是数据隔离边界。一个学校可拥有多个校区地图。

### CampusMap
代表一个可独立编辑、预览和发布的地图项目。保存坐标参考、地图画布尺寸、当前草稿版本和当前发布版本。

### CampusLayer
用于分类管理建筑、道路、水域、绿地、运动场、边界和 POI。图层是逻辑组织单元，不是独立存储文件。

### CampusFeature
统一保存空间要素。geometry 使用 GeoJSON Geometry 结构；properties 保存建筑高度、楼层、名称、类别等业务属性。V1 坐标采用校园本地二维平面坐标，单位由地图项目声明，默认 local-unit，不伪装成经纬度或真实米制坐标。

### CampusAsset
保存对象存储资源元数据。实际文件存储于 S3 兼容存储或云厂商对象存储。

### CampusVersion
保存地图某一时点的完整数据快照及发布状态。V1 可用 JSON 快照实现回滚；数据量增大后再改为增量事件/快照混合。

## 3. 数据隔离与权限

- 所有地图业务表必须包含 campus_id；地图子表同时包含 map_id。
- API 必须从已认证用户身份读取成员关系，不信任请求体传入的 campus_id 作为授权依据。
- 每次查询、更新、删除都必须校验 campus_id + map_id + 成员权限，避免 IDOR。
- 角色建议：owner、admin、editor、viewer。
- viewer 只读；editor 可编辑草稿；admin 可管理成员、地图和发布；owner 可转移/删除学校项目。
- 公开展示端只读取已发布版本，不读取草稿表状态。

## 4. 坐标与几何规范

- GeoJSON geometry 类型：Point、LineString、Polygon、MultiPolygon。
- 统一使用二维坐标 [x, y]，x 向右、y 向下；转换到 Three.js 时由适配层映射为 XZ 平面，不允许各模块自行翻转坐标。
- map.coordinate_system 固定为 campus-local；map.coordinate_unit 支持 pixel、meter、local-unit。
- 底图校准参数独立存储：原图宽高、地图范围、缩放/平移/控制点转换参数。
- 后续如需真实地理坐标，新增 coordinate_system 类型和转换器，不改变既有本地坐标数据。
- Feature geometry 与 properties 分离；渲染样式由 layer.style 或 feature.properties.style 提供。

## 5. API 边界（REST V1）

统一前缀：`/api/v1`。所有接口要求身份认证，公开地图读取接口除外。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /campuses | 获取当前用户可访问的学校 |
| POST | /campuses | 创建学校项目 |
| GET | /campuses/:campusId | 学校详情 |
| PATCH | /campuses/:campusId | 更新学校信息 |
| GET | /campuses/:campusId/maps | 学校地图列表 |
| POST | /campuses/:campusId/maps | 创建地图 |
| GET | /campuses/:campusId/maps/:mapId | 地图配置与元数据 |
| PATCH | /campuses/:campusId/maps/:mapId | 更新地图配置 |
| GET | /campuses/:campusId/maps/:mapId/layers | 获取图层 |
| PUT | /campuses/:campusId/maps/:mapId/layers/:layerId | 保存图层配置 |
| GET | /campuses/:campusId/maps/:mapId/features | 按图层分页读取要素 |
| PUT | /campuses/:campusId/maps/:mapId/features/:featureId | 创建或更新单个要素 |
| DELETE | /campuses/:campusId/maps/:mapId/features/:featureId | 删除要素 |
| POST | /campuses/:campusId/maps/:mapId/assets/presign | 获取对象存储上传凭证 |
| POST | /campuses/:campusId/maps/:mapId/versions | 创建草稿快照 |
| POST | /campuses/:campusId/maps/:mapId/publish | 发布指定版本 |
| GET | /public/campuses/:slug/maps/:mapSlug | 获取公开发布地图 |

编辑接口建议使用 `revision` 或 `If-Match` 做乐观锁。客户端提交旧 revision 时返回 409，避免覆盖其他编辑者的新数据。

## 6. 保存策略

- 编辑器采用防抖自动保存，但显式显示“保存中 / 已保存 / 保存失败”。
- 几何数据按 Feature 保存，避免每次拖动一个顶点都提交整张地图。
- 发布时生成不可变版本快照；公开端只绑定 published_version_id。
- 资源先上传对象存储，再写入 CampusAsset 元数据；删除资源前检查是否仍被版本引用。
- 导入/导出使用 ZIP 项目包，包内包含 manifest.json、GeoJSON 数据和资源文件；ZIP 是交换格式，不是线上主存储。

## 7. 技术落地顺序

1. 固化领域模型、SQL 和 API 契约。
2. 在 Node.js 服务中实现 Campus / Map / Layer / Feature CRUD。
3. 将当前南昌工学院临时布局迁移为一个 CampusMap 数据集，并标记 prototype / unverified。
4. 建立地图编辑器：底图校准、图层管理、绘制、顶点编辑、属性编辑。
5. 将 Three.js 场景改为消费地图数据，不再直接依赖单校硬编码数据。
6. 实现资源上传、版本快照、发布和回滚。
7. 最后评估多人协作与 GIS 扩展。

## 8. V1 验收标准

- 可以创建至少两个学校项目，数据互不串读。
- 每个学校可以创建多个地图。
- 一个地图可创建、编辑、删除建筑/道路/水域/POI。
- 刷新页面或更换设备后，地图数据从后端恢复。
- 编辑草稿不会改变公开发布地图。
- 可以发布、查看历史版本并回滚。
- 导出 ZIP 后可在另一套部署环境导入并恢复数据。
