# 本地打开二维地图编辑页

## 启动前提

- Node.js 满足项目要求。
- PostgreSQL + PostGIS 已启动并完成基础校园/主地图初始化。
- API 服务可访问，开发环境允许通过 `X-Dev-User-Id` 识别开发用户。

## 启动后端

```bash
cd server
npm install
npm run start:dev
```

开发环境默认自动执行 TypeORM 迁移。新增的 `CreateCampusRpgMap1762300000000` 会创建二维地图文档表。

## 启动前端

在仓库根目录：

```bash
npm install
npm run dev
```

浏览器访问：

```text
http://localhost:5173/?view=editor
```

也可以从应用首页点击“二维搭建”。

## 当前交付能力

- 地面/道路/水域瓦片绘制、图层切换、装饰对象放置、缩放。
- 编辑器启动时从 `GET /api/v1/campuses/:campusId/maps/:mapId/scene/rpg` 加载文档。
- 点击“保存地图”调用 `PUT /api/v1/campuses/:campusId/maps/:mapId/scene/rpg`，写入 PostgreSQL JSONB 文档。
- 保存采用 revision 乐观锁；并发版本不一致时返回 HTTP 409，前端提示重新加载。
- “导出 JSON”仍可将当前文档下载到本地。

## 边界说明

- RPG 文档与三维场景文档分别版本化保存，但共用同一 campus_map。
- GIS Feature Geometry 仍是建筑、道路等空间实体的平面事实来源。
- 当前“切换三维视图”只返回现有 Three.js 校园浏览场景；RPG 瓦片到 Three.js 地面网格的渲染适配尚未完成。
- 若 API 未启动、校园/主地图未初始化或当前开发用户没有 editor 权限，编辑页会显示加载/保存错误，不会伪装成已保存。
