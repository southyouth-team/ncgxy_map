# 后端开发说明（NestJS）

## 技术基线

- NestJS 11 + TypeScript
- Node.js 24 LTS
- PostgreSQL 16+ + PostGIS 3.4+
- TypeORM：连接池与迁移管理；业务读写使用参数化 SQL，空间几何由 PostGIS 处理
- Redis、对象存储暂不作为首阶段强依赖

## 本地启动

1. 创建数据库 `ncgxy_campus_map`，确保数据库账号有权限安装/使用 PostGIS。
2. 安装 PostGIS 扩展包，并确认执行 `CREATE EXTENSION postgis` 可用。
3. 复制 `.env.example` 为 `.env`，配置连接参数。
4. 执行 `npm install`。
5. 执行 `npm run db:migrate`。
6. 执行 `npm run start:dev`。

健康检查：`GET /health`、`GET /ready`。开发环境 Swagger：`/api/docs`。业务 API 前缀为 `/api/v1`。

## 当前已实现模块

### Health
- `GET /health`：进程存活检查。
- `GET /ready`：检查 PostgreSQL 和 PostGIS 扩展是否可用。

### Campuses
- `POST /api/v1/campuses`：创建学校，事务内自动创建者 owner 成员关系。
- `GET /api/v1/campuses`：当前用户加入的学校。
- `GET /api/v1/campuses/:campusId`：学校详情。
- `PATCH /api/v1/campuses/:campusId`：owner/admin 更新学校资料。

### Maps
- `POST /api/v1/campuses/:campusId/maps`：创建地图项目。
- `GET /api/v1/campuses/:campusId/maps`：地图列表。
- `GET /api/v1/campuses/:campusId/maps/:mapId`：地图详情。
- `PATCH /api/v1/campuses/:campusId/maps/:mapId`：更新地图配置。

### Layers
- `POST /api/v1/campuses/:campusId/maps/:mapId/layers`：创建图层。
- `GET /api/v1/campuses/:campusId/maps/:mapId/layers`：图层列表。
- `PATCH/DELETE /api/v1/campuses/:campusId/maps/:mapId/layers/:layerId`：更新/删除图层。

### Features
- `POST /api/v1/campuses/:campusId/maps/:mapId/features`：创建空间要素，GeoJSON 转 PostGIS Geometry。
- `GET /api/v1/campuses/:campusId/maps/:mapId/features`：读取要素及 GeoJSON。
- `PATCH /api/v1/campuses/:campusId/maps/:mapId/features/:featureId`：更新要素，必须携带 revision。
- `DELETE /api/v1/campuses/:campusId/maps/:mapId/features/:featureId?revision=N`：按 revision 删除。

## 开发身份与生产认证边界

当前 `DevIdentityGuard` 仅用于本地联调，通过 `X-Dev-User-Id` 请求头模拟身份。仅当 `NODE_ENV` 不是 production 时允许；生产环境所有受保护业务接口均拒绝该模式，返回 401。该机制不是正式认证，部署生产前必须接入宿主应用的 JWT/Session 身份适配器。

示例：

```bash
curl -H "X-Dev-User-Id: dev-user-001" http://localhost:3001/api/v1/campuses
```

## 空间数据规范

首期校园二维编辑使用 `campus-local` 平面坐标，坐标顺序为 `[x,y]`，x 向右、y 向下。该坐标不是经纬度，也不自动代表米。数据库采用 PostGIS geometry SRID 0 存储本地平面坐标。GeoJSON 是 API 传输格式，Geometry 是数据库存储格式；首期接受 Point、LineString、Polygon、MultiPolygon，写入前使用 PostGIS 检查几何有效性，空间列建立 GiST 索引。

## 数据库迁移策略

- TypeORM `synchronize=false`，禁止生产环境自动同步结构。
- 所有结构变更通过版本化 migration。
- PostGIS 扩展由初始迁移启用。
- 不使用 MySQL SQL 文件初始化 PostgreSQL。
- 迁移前备份；生产变更先在测试环境验证。

## 当前未实现

正式认证、校园成员邀请/角色变更、地图 revision/If-Match、图层排序与样式管理、Feature 分页/空间过滤、资源上传、地图发布与版本回滚尚未实现。不要将当前基础接口视为可直接投入生产的完整地图服务。
