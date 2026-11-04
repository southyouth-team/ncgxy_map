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
| provenance | 后续扩展生成模型、提示词、参考图、授权和制作记录 |

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

- AI 生成素材进入 `draft`，记录生成来源和 prompt；审核尺寸、透明边缘、风格、比例、授权后转为 `ready`。
- 人工建模导入 GLB 使用相同 assetId/binding；模型结构、三角面、材质和包围盒继续走既有 GLB 审计。
- 程序化资产可以登记为 `procedural` 来源，但现阶段不强制把现有全部程序化 Mesh 迁移进清单。
- AI 输出文件先落入受控目录，再由清单引用；不能把临时生成 URL 当作长期资产地址。

## 本阶段交付与未交付

已交付：统一 schema、纯函数校验器、按视角解析器、自动化测试、空清单模板和架构说明。

未交付：AI 图像/3D 生成 API 接入、素材工坊 UI、上传存储、图像处理、模型自动转换、编辑器资产选择器、真实资产导入和浏览器视觉验收。当前清单为空，因此现有画面不应发生变化。
