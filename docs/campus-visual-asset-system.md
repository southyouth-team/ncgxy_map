# 校园视觉资产统一管理方案（第一阶段）

## 目标与边界

本阶段建立 AI 生成素材优先、专业建模导入兼容的统一资产数据契约。它是资产管理基础，不是完整的 AI 生图服务，也不改变当前校园渲染结果。

**空间数据与视觉资产必须解耦：**

- FeatureCollection 继续独占空间位置、建筑 footprint、旋转/尺寸语义、碰撞、道路连接和 `walkable`。
- 资产清单只记录视觉素材、来源、审核状态、视角变体和 Feature 绑定。
- 替换素材不得改写 Feature geometry/properties，也不得重新生成碰撞。
- AI 生成、Blender/GLB 导入、程序化生成最终都进入同一资产契约。

## 资产模型

`public/data/campus-assets.json` 使用 schemaVersion 1。

### Asset

| 字段 | 含义 |
|---|---|
| assetId | 全局稳定资产 ID，不使用文件名作为主键 |
| name / category | 名称与资产类别 |
| sourceType | ai_generated / manual_model / procedural / external |
| status | draft / review / ready / archived |
| files | 一个资产可包含多个视角与用途文件 |
| provenance | 可选来源记录：provider、prompt、reference、license、createdAt、notes；AI 资产建议至少填写 provider 与 prompt |

### File variant

- `viewMode`: `2.5d`、`3d` 或明确共享的 `shared`。
- `role`: primary、thumbnail、albedo、normal、roughness、emissive。
- `mediaType`: image、spritesheet、texture、glb。
- `url`: 受控公共资产目录中的路径，禁止路径穿越。

2.5D 主素材通常使用透明背景 WebP/PNG 等图片；3D 主素材使用 GLB。一个 assetId 可以同时关联两种视角素材，也可以只有一种视角素材。**不会把 2.5D 图片自动当成 3D 模型，也不会把 GLB 当成 2.5D 图片。**

### Binding

`featureId -> assetId` 是视觉替换关系。绑定以规范空间 Feature ID 为唯一锚点，不复制位置或碰撞字段。

## 解析规则

1. 仅 `status=ready` 的资产可以进入运行时。
2. 优先使用当前视角的 `primary` 文件。
3. 只有显式登记 `shared` primary 才能作为视角 fallback。
4. 找不到素材时返回结构化原因，由当前程序化资产继续兜底。
5. 不自动跨视角降级，不自动修改空间 Feature。
6. GLB 的空间摆放仍由建筑空间数据和既有建筑清单负责；视觉资产清单不覆盖位置/旋转真值。

## AI 生成与人工建模的接入约定

- AI 生成素材进入 `draft`，记录生成 provider 和 prompt；审核尺寸、透明边缘、风格、比例、授权后转为 `ready`。校验器会对缺失来源信息给出 warning。
- 人工建模导入 GLB 使用相同 assetId/binding；模型结构、三角面、材质和包围盒继续走既有 GLB 审计。
- 程序化资产可以登记为 `procedural` 来源，但现阶段不强制把现有全部程序化 Mesh 迁移进清单。
- AI 输出文件先落入受控目录，再由清单引用；不能把临时生成 URL 当作长期资产地址。

## 本阶段交付与未交付

已交付：统一 schema、纯函数校验器、按视角解析器、自动化测试、空清单模板和架构说明。

未交付：AI 图像/3D 生成 API 接入、素材工坊 UI、上传存储、图像处理、模型自动转换、编辑器资产选择器、真实资产导入和浏览器视觉验收。当前清单为空，因此现有画面不应发生变化。


## 第二阶段：AI 素材工坊最小闭环

入口：`/asset-workshop`。当前先实现不绑定供应商的工作流：提示词由工坊按 Feature ID 与视角规则生成，用户可在任意 AI 工具中生成候选，再导入审核。

- 2.5D 输入：PNG / WebP / JPEG；3D 输入：GLB。
- 文件暂存在浏览器 IndexedDB，候选记录保存在 localStorage。它们不是服务器资产库，也不会跨设备同步。
- 审核状态：draft → review → ready。必须人工确认文件已复制到仓库 `public` 目录，才能导出 ready manifest。
- 同一 Feature 的 2.5D 和 3D 文件合并到同一个稳定 assetId；不同视角不会互相降级。
- 目前 GLB 只暂存/下载，未提供 Three.js 实时预览；云端生成 API、服务端上传、团队审核与自动部署留待后续阶段。
- 当前校园建筑 ID 是参考平面图人工近似编号。没有真实照片或建筑资料时，生成素材仅是统一风格的视觉占位，不能标记为真实复原。
