# 南昌工学院三维校园地图

基于 Vue 3 + Vite + Three.js 构建的校园地图前端，后端采用 NestJS + PostgreSQL + PostGIS。

## 环境要求

- Node.js 24 LTS（NestJS 11）
- npm 10+
- PostgreSQL 16+
- PostGIS 3.4+

## 前端

```bash
npm install
npm run dev
npm run build
```

## 后端

```bash
cd server
cp .env.example .env
# 配置 PostgreSQL 连接
npm install
npm run db:migrate
npm run start:dev
```

后端默认监听 `http://localhost:3001`。健康检查：
- `GET /health`：进程健康状态
- `GET /ready`：数据库与 PostGIS 连通性检查

API 前缀为 `/api/v1`，Swagger 文档地址为 `/api/docs`（开发环境）。

## 当前后端交付范围

当前阶段建立 NestJS 工程、配置管理、TypeORM 数据源、PostGIS 数据库迁移入口和健康检查。校园、地图、图层、Feature 的业务 CRUD 尚未全部落地；不要将基础工程视为完整地图编辑系统。

## 当前前端演示状态

工程已包含程序化演示场景和三种相机交互模式。**当前演示场景不是南昌工学院真实测绘模型。** 道路、地面、树木和环境布局仍是演示占位内容，后续必须使用经校准的校园底图数据替换。

## 多校园平台架构

- [多校园平台架构与 API 边界](docs/multi-campus-architecture.md)
- [PostgreSQL + PostGIS 数据库结构 V1](docs/multi-campus-database-v1.sql)
- [地图数据契约 V1](docs/campus-map-data-contract-v1.md)
- [后端开发说明](docs/backend-development.md)

## 真实校园建模资料

- 实施方案：[docs/real-campus-modeling-plan.md](docs/real-campus-modeling-plan.md)
- 实地采集规范：[docs/field-survey.md](docs/field-survey.md)
- 校园空间数据契约：[public/data/campus.json](public/data/campus.json)
- 建筑资产数据契约：[public/data/buildings.json](public/data/buildings.json)

真实数据生产流程：先校准校园底图，再矢量化道路、水域和建筑 footprint，随后采集建筑属性与现场照片，最后制作 GLB 并接入 Three.js。未经核验的坐标和楼栋名称必须标记为待确认，不得作为正式数据发布。
