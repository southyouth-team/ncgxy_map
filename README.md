# 南昌工学院三维校园地图

基于 Vue 3 + Vite + Three.js + JavaScript 构建的校园地图前端，后端 API 独立部署在 `server/`。

## 环境要求

- Node.js 20.19+ 或 22.12+
- npm 10+
- MySQL 8.0+

## 前端本地运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm run preview
```

## 后端本地运行

```bash
cd server
cp .env.example .env
# 修改 .env 中的 MySQL 连接参数，并提前创建 DB_NAME 对应数据库
npm install
# 在 MySQL 8 中执行 sql/001_core_schema.sql
npm run dev
```

后端默认监听 `http://localhost:3001`。健康检查：
- `GET /health`：进程健康状态
- `GET /ready`：数据库连通性检查

本地联调时，设置 `AUTH_MODE=development`，请求携带 `X-Dev-User-Id: 1`。该方式仅用于本地开发；生产环境必须由宿主应用认证中间件注入 `req.user.id`，不得开放开发态身份头。

## 当前交付范围

当前已建立后端最小基础：
- Express API 服务、MySQL 连接池、统一 JSON 响应与错误处理。
- 学校项目创建、列表、详情、更新；创建学校时自动将创建者设为 owner。
- 地图项目创建、列表、详情、更新。
- 学校成员权限校验和地图 revision 乐观锁基础。
- MySQL 核心表：campus、campus_member、campus_map、campus_layer、campus_feature。

当前尚未完成：图层/空间要素 CRUD、底图资源上传、二维编辑器、地图数据接入 Three.js、正式身份认证适配和线上部署。不要将当前 API 基础误认为完整地图编辑系统。

## 当前前端演示状态

工程已包含程序化演示场景和三种相机交互模式：
- 上帝视角：俯视、平移、缩放
- 第三人称：跟随观察目标，拖拽环绕、滚轮缩放、键盘移动
- 第一人称：点击进入鼠标视角，WASD/方向键移动，Shift 加速，Esc 释放鼠标

**重要：当前演示场景不是南昌工学院真实测绘模型。** 道路、地面、树木和环境布局仍是演示占位内容，后续必须使用经校准的校园底图数据替换。

## 多校园平台架构

- [多校园平台架构与 API 边界](docs/multi-campus-architecture.md)
- [MySQL 数据库结构 V1](docs/multi-campus-database-v1.sql)
- [地图数据契约 V1](docs/campus-map-data-contract-v1.md)

## 真实校园建模资料

- 实施方案：[`docs/real-campus-modeling-plan.md`](docs/real-campus-modeling-plan.md)
- 实地采集规范：[`docs/field-survey.md`](docs/field-survey.md)
- 校园空间数据契约：[`public/data/campus.json`](public/data/campus.json)
- 建筑资产数据契约：[`public/data/buildings.json`](public/data/buildings.json)

真实数据生产流程：先校准校园底图，再矢量化道路、水域和建筑 footprint，随后采集建筑属性与现场照片，最后制作 GLB 并接入 Three.js。未经核验的坐标和楼栋名称必须标记为待确认，不得作为正式数据发布。
