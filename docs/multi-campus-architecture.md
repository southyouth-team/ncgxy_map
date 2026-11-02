# 多校园地图平台架构（V1）

## 1. 产品边界

本仓库是通用校园地图平台，南昌工学院作为首个落地校园。一个平台管理多个学校，每校可拥有多个校区地图项目；各学校数据逻辑隔离，共用编辑器、API、数据契约和 Three.js 渲染引擎。

V1 优先交付南昌工学院主校区准确地图。先完成底图校准、二维矢量数据和编辑器，再接入三维展示。当前程序化三维场景仅为视觉原型，不作为测绘事实数据。

## 2. 技术架构

```text
Vue 3 + Leaflet/Leaflet-Geoman + Three.js
                 │ REST / GeoJSON
                 ▼
        NestJS 11 Modular Monolith
                 │
       ┌─────────┴──────────┐
       ▼                    ▼
 PostgreSQL + PostGIS    S3-compatible Storage
       │
       └── Redis（后续缓存/队列按需引入）
```

采用模块化单体，不在 V1 引入微服务或 Kubernetes。

## 3. 核心领域模型

```text
Campus
 ├── CampusMember
 └── CampusMap
      ├── CampusLayer
      │    └── CampusFeature (PostGIS Geometry)
      ├── CampusAsset
      └── CampusVersion
```

- Campus：学校/租户，是数据隔离边界。
- CampusMember：用户与学校之间的角色关系，角色为 owner/admin/editor/viewer。
- CampusMap：可独立编辑、预览和发布的地图项目，保存坐标参考、画布尺寸、revision 和发布版本。
- CampusLayer：建筑、道路、水域、绿地、运动场、边界、POI 等逻辑图层。
- CampusFeature：GeoJSON API 对应的空间要素，geometry 存入 PostGIS，业务属性存 JSONB。
- CampusAsset：对象存储资源元数据；文件本体不入数据库。
- CampusVersion：不可变地图快照与发布记录。

## 4. 数据隔离与权限

- 所有业务表携带 campus_id；子表同时携带 map_id。
- 查询和写入均校验当前认证用户的校园成员关系与角色，防止 IDOR。
- 不信任客户端传入的 user_id 作为身份，不以 campus_id 参数本身作为授权依据。
- viewer 只读；editor 编辑草稿；admin 管理成员、地图和发布；owner 拥有完整管理权。
- 公开展示端仅读取已发布版本。

## 5. 空间参考与 Geometry

首期校园地图是局部平面编辑场景，不是地理坐标地图：

- 坐标系：`campus-local`。
- 坐标顺序：`[x,y]`，x 向右、y 向下。
- 单位：由 map.coordinate_unit 显式声明，可为 pixel、meter 或 local-unit。
- PostGIS 使用 SRID 0 存储本地平面 Geometry；SRID 0 不代表 WGS84，也不代表米制坐标。
- API 使用 GeoJSON Geometry；数据库使用 PostGIS Geometry。
- 空间列建立 GiST 索引；需要空间检索时使用 ST_Intersects、ST_DWithin 等函数，距离计算前必须确认单位和坐标参考。
- 转换到 Three.js 的 XZ 平面由唯一适配器执行，例如 `worldX=x, worldZ=-y`，禁止各图层重复实现翻转。

未来如接入真实经纬度，新增明确 CRS 与坐标转换链路，不得把校园像素坐标直接声明为 EPSG:4326。

## 6. API 规范

统一前缀 `/api/v1`，REST + JSON，空间要素使用 GeoJSON。开发环境提供 OpenAPI/Swagger。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET/POST | /campuses | 当前用户可访问的学校 / 创建学校 |
| GET/PATCH | /campuses/:campusId | 学校详情 / 更新 |
| GET/POST | /campuses/:campusId/maps | 地图列表 / 创建地图 |
| GET/PATCH | /campuses/:campusId/maps/:mapId | 地图详情 / 更新配置 |
| GET/POST | /campuses/:campusId/maps/:mapId/layers | 图层列表 / 创建图层 |
| PATCH/DELETE | /campuses/:campusId/maps/:mapId/layers/:layerId | 更新 / 删除图层 |
| GET/POST | /campuses/:campusId/maps/:mapId/features | 要素分页 / 创建要素 |
| PATCH/DELETE | /campuses/:campusId/maps/:mapId/features/:featureId | 更新 / 删除要素 |
| POST | /campuses/:campusId/maps/:mapId/publish | 发布地图版本 |
| GET | /public/campuses/:slug/maps/:mapSlug | 读取公开发布地图 |

编辑接口采用 revision 或 If-Match 乐观锁，冲突返回 HTTP 409。

## 7. 数据与文件策略

- Feature 按要素独立保存，避免拖动一个顶点就提交整张地图。
- 编辑器防抖自动保存，并明确展示保存状态。
- 发布生成不可变版本快照，公开端绑定 published_version_id。
- 底图、照片、纹理、GLB 存对象存储，数据库只保存 metadata 和 object key。
- ZIP 仅用于项目导入导出，不作为线上主存储。
- V1 不做实时协同；先完成权限、revision 和冲突提示。

## 8. 实施顺序

1. NestJS + PostgreSQL/PostGIS 基础工程与迁移。
2. Campus / Map / Layer / Feature 领域 CRUD。
3. 南昌工学院主校区底图校准与矢量化。
4. 二维编辑器：底图导入、校准、建筑绘制、顶点编辑、属性维护。
5. 二维数据接入 Three.js。
6. 资源上传、版本发布与回滚。
7. 后续再评估室内地图、多人协作和更多学校。

## 9. V1 验收目标

- 至少支持创建两个校园项目，校园间数据隔离。
- 校园地图可管理图层和空间要素。
- 几何数据持久化到 PostGIS，空间列具备 GiST 索引。
- 刷新或更换设备后可从 API 恢复地图数据。
- 草稿编辑不影响公开发布版本。
- 南昌工学院首张地图基于校准底图与可核验矢量数据，不以程序化演示数据冒充真实地图。
