# 南昌工学院三维校园地图

基于 Vue 3 + Vite + Three.js + JavaScript 构建的模块化三维校园地图工程。

## 环境要求

- Node.js 20.19+ 或 22.12+
- npm 10+

## 本地运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm run preview
```

## 当前版本状态

工程已包含程序化演示场景和三种相机交互模式：

- 上帝视角：俯视、平移、缩放
- 第三人称：跟随观察目标，拖拽环绕、滚轮缩放、键盘移动
- 第一人称：点击进入鼠标视角，WASD/方向键移动，Shift 加速，Esc 释放鼠标

**重要：当前演示场景不是南昌工学院真实测绘模型。** 原先虚构的示例建筑位置已从建筑数据中移除，避免将假数据误认为真实建筑坐标。道路、地面、树木和环境布局仍是演示占位内容，后续必须使用经配准的校园底图数据替换。

## 多校园平台架构

- [多校园平台架构与 API 边界](docs/multi-campus-architecture.md)
- [MySQL 数据库结构 V1](docs/multi-campus-database-v1.sql)
- [地图数据契约 V1](docs/campus-map-data-contract-v1.md)

当前仓库仍是前端演示工程；上述文档先固化多学校数据模型和服务端边界，后续再在独立 Node.js API 服务中落地。线上地图数据应由后端持久化，不能将浏览器缓存或 public JSON 作为正式数据源。

## 真实校园建模资料

- 实施方案：[`docs/real-campus-modeling-plan.md`](docs/real-campus-modeling-plan.md)
- 实地采集规范：[`docs/field-survey.md`](docs/field-survey.md)
- 校园空间数据契约：[`public/data/campus.json`](public/data/campus.json)
- 建筑资产数据契约：[`public/data/buildings.json`](public/data/buildings.json)

## 真实数据生产流程

1. 使用公开校园地图建立校园边界、道路、水体和建筑 footprint。
2. 使用现场控制点校准底图坐标；手机 GNSS 只作辅助定位。
3. 按建筑编号采集四向照片、角点、长宽、层数、屋顶和入口信息。
4. 使用 QGIS 管理矢量底图，Blender 制作建筑模型并导出 GLB。
5. 在 Three.js 中按建筑 manifest 加载模型，坐标和模型文件分离管理。

真实建筑数据尚未完成采集与配准前，不应将演示场景作为真实校园地图发布。
