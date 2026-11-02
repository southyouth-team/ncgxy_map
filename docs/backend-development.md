# 后端开发说明（NestJS）

## 技术基线

- NestJS 11 + TypeScript
- Node.js 24 LTS
- PostgreSQL 16+ + PostGIS 3.4+
- TypeORM：连接池与迁移管理；业务读写使用参数化 SQL，复杂 GIS 查询集中在 GIS repository
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

## 开发身份与生产认证边界

当前 `DevIdentityGuard` 仅用于本地联调，通过 `X-Dev-User-Id` 请求头模拟身份。仅当 `NODE_ENV` 不是 production 时允许；生产环境所有受保护业务接口均拒绝该模式，返回 401。该机制不是正式认证，部署生产前必须接入宿主应用的 JWT/Session 身份适配器。

示例：

```bash
curl -H "X-Dev-User-Id: dev-user-001" http://localhost:3001/api/v1/campuses
```

## 目录约定

- `src/common/auth`：开发身份 Guard 和当前用户装饰器。
- `src/config`：环境配置。
- `src/database`：TypeORM 数据源与迁移。
- `src/modules/health`：存活与就绪探针。
- `src/modules/campuses`：学校与成员访问边界。
- `src/modules/maps`：地图项目。
- 后续拆分 `layers`、`features`、`assets`、`versions`。
- Controller 负责 HTTP 边界；Service 负责业务编排；持久化通过 DataSource 参数化 SQL。复杂空间查询放入独立 GIS repository。

## 空间数据规范

校园二维编辑首期使用 `campus-local` 平面坐标，坐标顺序为 `[x,y]`，x 向右、y 向下。该坐标不是经纬度，也不自动代表米。数据库采用 PostGIS geometry SRID 0 存储此类本地坐标，并在地图元数据中声明坐标单位、画布尺寸和校准参数。未来接入真实地理坐标时，必须通过明确的坐标参考系统和转换流程处理，不能直接给本地坐标标注 EPSG:4326。

Feature geometry 使用 GeoJSON 作为 API 传输格式，PostGIS Geometry 作为数据库空间存储。空间列必须建立 GiST 索引。

## 数据库迁移策略

- TypeORM `synchronize=false`，禁止生产环境自动同步结构。
- 所有结构变更通过版本化 migration。
- PostGIS 扩展由初始迁移启用。
- 不使用 MySQL SQL 文件初始化 PostgreSQL。
- 迁移前备份；生产变更先在测试环境验证。

## 当前未实现

图层与 Feature CRUD、GeoJSON 几何校验、revision/If-Match 乐观锁、正式认证、对象存储上传、地图发布与版本回滚尚未实现。不要将当前基础接口视为可直接投入生产的完整地图服务。
