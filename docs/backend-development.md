# 后端开发说明（NestJS）

## 技术基线

- NestJS 11 + TypeScript
- Node.js 24 LTS
- PostgreSQL 16+ + PostGIS 3.4+
- TypeORM：常规实体读写与迁移管理
- 原生 SQL：复杂空间查询、空间索引和 PostGIS 函数
- Redis、对象存储暂不作为首阶段强依赖

## 本地启动

1. 安装 PostgreSQL，并启用 PostGIS 扩展。
2. 复制 `.env.example` 为 `.env`，配置连接参数。
3. 执行 `npm install`。
4. 执行 `npm run db:migrate`。
5. 执行 `npm run start:dev`。

健康检查：`GET /health`、`GET /ready`。开发环境 Swagger：`/api/docs`。

## 目录约定

- `src/config`：环境配置与校验。
- `src/database`：TypeORM 数据源、实体和迁移。
- `src/modules/health`：存活与就绪探针。
- 后续按领域拆分 `campuses`、`maps`、`layers`、`features`、`assets`、`versions` 模块。
- Controller 负责 HTTP 边界；Service 负责业务编排；Repository/DAO 负责持久化。复杂空间查询集中在专门的 GIS repository 中。

## 空间数据规范

校园二维编辑首期使用 `campus-local` 平面坐标，坐标顺序为 `[x,y]`，x 向右、y 向下。该坐标不是经纬度，也不自动代表米。数据库采用 PostGIS geometry SRID 0 存储此类本地坐标，并在地图元数据中声明坐标单位、画布尺寸和校准参数。未来接入真实地理坐标时，必须通过明确的坐标参考系统和转换流程处理，不能直接给本地坐标标注 EPSG:4326。

Feature geometry 使用 GeoJSON 作为 API 传输格式，PostGIS Geometry 作为数据库空间存储。空间列必须建立 GiST 索引。

## 数据库迁移策略

- TypeORM `synchronize=false`，禁止生产环境自动同步结构。
- 所有结构变更通过版本化 migration。
- PostGIS 扩展由初始迁移启用。
- 不使用 MySQL SQL 文件初始化 PostgreSQL。
- 迁移前备份；生产变更先在测试环境验证。

## 身份认证边界

正式接入由宿主应用提供的认证身份。业务层从可信认证上下文读取 user id，不信任请求体中的 user_id/campus_id 作为授权依据。开发态身份模拟后续单独实现，并且必须限制在非生产环境。
