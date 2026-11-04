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
- 审核状态：draft → review → ready；审核也可驳回为 rejected。点击“审核通过并自动入库”后，文件自动上传服务端，不再要求手动复制到仓库 `public` 目录。
- 同一 Feature 的 2.5D 和 3D 文件合并到同一个稳定 assetId；不同视角不会互相降级。
- GLB 可暂存并在审核通过后上传服务端；当前页面仍未提供 GLB 实时预览。团队级权限审核和多副本对象存储留待后续阶段。
- 当前校园建筑 ID 是参考平面图人工近似编号。没有真实照片或建筑资料时，生成素材仅是统一风格的视觉占位，不能标记为真实复原。


## 第三阶段：服务端 AI 图片生成接入

素材工坊通过 `POST /api/v1/assets/ai-image/generate` 调用服务端接口。服务端使用 OpenAI 兼容的 `/images/generations` 路径，默认模型为 `gpt-image-2`。

### 配置与隔离

- 图片生成优先使用 `IMAGE_API_KEY`、`IMAGE_API_BASE_URL`、`IMAGE_MODEL`。
- 如果没有独立图片配置，鉴权和 Base URL 回退复用 `VISION_API_KEY`、`VISION_API_BASE_URL`；图片模型仍默认为 `gpt-image-2`。
- 图片识图继续使用 `VISION_MODEL`，当前模型为 `deepseek-flash`。两条模型配置互不覆盖。
- API Key 只在服务端读取，浏览器请求只发送提示词，不读取或传递密钥。
- 容器部署时，Base URL 必须是后端容器可访问的地址；容器内的 `localhost` 指向容器自身，不等于宿主机。

### 当前生成闭环

1. 素材工坊根据所选校园 Feature 和视角构建提示词，用户可编辑。
2. 2.5D 模式调用服务端图片生成接口，生成结果返回 Base64 data URL 并在页面预览。
3. 用户检查风格、透明背景、轮廓和细节后，将文件保存为本地候选；文件进入 IndexedDB，元数据进入 localStorage。
4. 用户点击“审核通过并自动入库”，素材自动上传到服务端持久化目录，服务端登记正式 manifest。

### 能力边界

- 当前接口只生成 2.5D 图片，不生成 GLB。3D 模型继续通过建模软件或外部 3D 生成工具导入。
- 支持 Base64 图片响应；URL 响应只允许从配置 API 的同源地址回源，拒绝跨域 URL，降低 SSRF 风险。
- 尚未审核通过的候选仍存储在浏览器本地，不是服务器持久化资产；清理浏览器站点数据可能丢失未入库候选。
- 生成图片不会自动覆盖现有程序化建筑，不会修改 Feature geometry、位置、碰撞或 walkable。
- GitHub CI 通过只代表构建和单元测试通过；必须在本地部署环境调用真实 API，才能确认服务地址、模型权限和响应格式兼容。


## 审核通过后自动入库

- 素材工坊候选仍在浏览器 IndexedDB 暂存，审核动作由用户明确触发；点击“审核通过并自动入库”后，浏览器将文件以 multipart/form-data 上传至 `POST /api/v1/assets/visual-assets`。
- 服务端校验 Feature ID、视角、来源类型、文件真实签名和大小，生成唯一文件 ID 与 SHA-256 校验值；素材写入 `ASSET_STORAGE_DIR/campus-visual-assets/files/`，元数据清单原子更新至 `ASSET_STORAGE_DIR/campus-visual-assets/manifest.json`。
- 同一空间 Feature 的 2.5D/3D 文件合并到稳定 `assetId`，同视角再次审核通过时替换该视角主文件引用；历史文件不会被自动删除，避免并发页面仍引用时产生断链。
- `GET /api/v1/assets/visual-assets/manifest` 提供正式清单；`GET /api/v1/assets/visual-assets/:fileId/content` 提供素材文件。读取接口用于场景加载，不要求浏览器附加开发身份头。
- `ASSET_STORAGE_DIR` 必须挂载到持久化磁盘卷，并纳入备份策略；容器重建但未挂载持久卷会导致素材丢失。当前实现是单实例文件清单写入队列，不适用于多副本共享同一存储目录的并发写入；多副本部署应迁移到对象存储或数据库事务/分布式锁。
- 首页启动时读取服务端 manifest；2.5D 模式按建筑 Feature ID 加载审核通过的图片 Sprite，图片加载失败时保留程序化建筑。切换到 3D 时隐藏 2.5D 图片并恢复程序化/GLB 视觉资产；空间位置、footprint、碰撞和 walkable 不变。
