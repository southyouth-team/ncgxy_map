# 后端本地开发说明

## 目录与职责

- `src/config.js`：环境变量与 MySQL 连接池。
- `src/server.js`：Express 应用、路由、身份校验、业务接口和进程生命周期。
- `sql/001_core_schema.sql`：首批核心表结构。

当前为基础骨架，接口逻辑集中在 server.js 以便快速验证端到端链路。随着图层和 Feature API 落地，将按 controller/service/DAO 拆分模块，不把当前文件组织视为最终形态。

## 启动步骤

1. 创建 MySQL 数据库，例如 `CREATE DATABASE ncgxy_campus_map CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`
2. 复制 `.env.example` 为 `.env`，填写数据库连接。
3. 执行 `sql/001_core_schema.sql`。
4. `npm install && npm run dev`。

## API

统一前缀：`/api/v1`。

| Method | Path | 说明 |
|---|---|---|
| GET | /campuses | 当前用户可访问的学校 |
| POST | /campuses | 创建学校并自动授予 owner |
| GET | /campuses/:campusId | 学校详情 |
| PATCH | /campuses/:campusId | owner/admin 更新学校 |
| GET | /campuses/:campusId/maps | 地图列表 |
| POST | /campuses/:campusId/maps | 创建地图 |
| GET | /campuses/:campusId/maps/:mapId | 地图详情 |
| PATCH | /campuses/:campusId/maps/:mapId | 更新地图配置 |

创建地图默认采用 `campus-local` 坐标系、`pixel` 单位和 640×480 画布。地图更新可在请求体传入读取时的 `revision`，不匹配时返回 409。

## 身份认证边界

开发态可使用 `AUTH_MODE=development` 和 `X-Dev-User-Id` 请求头。生产环境必须由宿主认证中间件校验会话/token，并设置 `req.user = { id }`。本服务不创建独立账号体系，也不应将客户端自行提交的 user_id 作为可信身份。

## 当前限制

目前只完成学校与地图项目 CRUD。图层/空间要素接口、文件存储、正式认证适配、版本发布和前端接入尚未完成。开发态认证不能用于公网生产部署。
