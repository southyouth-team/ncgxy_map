# img2threejs 风格结构化重建 POC

日期：2026-11-05

## 目标

验证参考图是否可以驱动一个有明确部件层级的 Three.js 实体模型，而不是继续把图像识别压缩成少量分类参数，再套固定几何预设。

首个验证对象为动漫彩绘城堡。后续能力必须扩展到独立物体、构筑物、植被、设施、车辆、角色等类别；道路、水体和地形继续使用空间几何契约，不混入孤立物体重建流程。

## 上游参考

- [img2threejs](https://github.com/img2threejs/img2threejs)：Apache-2.0，采用 ObjectSculptSpec、组件树、材质描述、分阶段构建和渲染反馈。
- [上游架构说明](https://github.com/img2threejs/img2threejs/blob/main/docs/ARCHITECTURE.md)：脚本负责确定性校验和阶段门禁，视觉 Agent 负责判断参考图与渲染结果。
- 上游当前核心定位是 object / character reconstruction-by-code，不是完整校园环境生成器；本项目只借鉴其工作流与数据契约，不直接复制整套 Agent Skill、Python forge 或插件管理系统。

## 本仓库当前落地

### 1. ObjectSculptSpec 运行时适配器

新增 `src/three/reconstruction/createObjectSculptModel.js`：

- 接收 renderer-independent JSON component tree，输出真实 `THREE.Group`。
- 按 parent 层级建立 Group 树；每个组件对应独立 Mesh，保留组件名称和角色元数据。
- 当前首批支持 box/cuboid、cylinder、cone、sphere/ellipsoid、torus 五类基础几何。
- 材质使用独立的颜色、roughness、metalness、opacity 参数。
- 对组件数量、层级深度、尺寸、变换、材质参数和 primitive 做白名单/边界校验。
- 拒绝重复 ID、缺失父节点、循环引用、过深层级、越界尺寸和未知几何类型。
- 不执行 AI 返回的 JavaScript/TypeScript，不使用 eval、Function 或动态 import。

该适配器实现的是 img2threejs 风格组件树的受控子集，不宣称兼容上游完整 ObjectSculptSpec 2.0。未消费字段必须保留在原始设计数据中，不能静默丢弃后声称完整兼容。

### 2. 工坊预览接入

`BuildingTemplateWorkshop.vue` 已预留 `design.objectSculptSpec` 分支：存在结构化组件树时，优先使用上述适配器生成真实 Mesh；没有该字段时，原建筑生成器、五类对象生成器和 GLB 路径保持不变。

因此本提交完成的是结构化重建的运行时入口和边界校验，不代表当前视觉模型已经开始输出 ObjectSculptSpec，也不代表城堡 POC 已完成图像到模型的端到端联调。

### 3. 测试

新增 `createObjectSculptModel.test.js`，覆盖：

- 城堡式组件树构建为多个真实 Three.js Mesh。
- 父子组件层级和组件元数据。
- 重复 ID、缺失父节点、循环引用。
- 未支持 primitive 和越界尺寸。
- 组件数量与层级深度预算。

## 下一阶段实施顺序

1. **视觉识别输出升级**：在用户确认参考图后，新增结构化重建识别契约，输出对象分类、复杂度、组件树、每个组件的几何描述、材质分区、重复系统、证据与不确定项；不再只输出 `geometry: { form, count, ratio }`。
2. **城堡结构专用提示词与校验**：明确主体、塔楼、塔顶、主屋顶、城垛、入口、窗洞、装饰件等部件，并要求父子关系、相对比例和可见面证据。单图不可见的背面必须标记为推断。
3. **分阶段生成**：先 blockout 轮廓和体量，再补结构部件、局部造型、材质和细节。每阶段保留 spec 和版本，不允许一次性把全部细节塞进一个提示词。
4. **代码生成隔离**：只有在确认确实需要 AI 生成 TS factory 后才开放代码执行。执行必须运行在独立容器/受限进程中，禁用网络与宿主文件访问，限制 CPU、内存、时间、输出体积和三角面数量；不能把 Node `vm` 当作安全沙箱。
5. **真实浏览器反馈**：在现有工坊的 2.5D 正交和 3D 透视视口中渲染同一份模型，固定相机角度截图，与参考图并排检查；由视觉模型给出差异清单，逐阶段修订。
6. **人工审核与发布**：保留当前参考图确认、参数审核、服务端 HMAC 凭证、模板发布门禁；重建模型源码/spec、参考图摘要、生成模型、阶段记录和渲染证据一起归档。

## POC 验收标准

- 输入：用户确认的动漫彩绘城堡参考图。
- 输出：不是 Sprite、不是图片贴图、不是泛化白色方盒；必须是由多个真实 Three.js Mesh 构成的城堡模型。
- 结构：主楼体、至少两个可识别塔楼/塔顶、主屋顶、入口等可见结构独立成组件；组件树可检查。
- 视觉：2.5D 与 3D 使用同一份 Mesh；两种视口均可检查，3D 可旋转观察。
- 稳定性：模型可保存、重新加载；不允许不受控执行 AI 生成代码。
- 质量：与旧参数化生成器同角度对比，主体轮廓、塔楼数量/位置、屋顶形状、入口位置等身份特征明显优于旧方案。未达到时继续修订，不以“成功生成了 Mesh”作为验收。

## 当前状态

基础适配器已提交。

- 已完成：受限组件树运行时、工坊预览入口、适配器单测。
- 未完成：视觉模型输出 ObjectSculptSpec、城堡端到端重建、隔离代码生成执行器、浏览器视觉反馈闭环。
- 本阶段不更改校园空间 Feature、footprint、位置、碰撞、walkable 或地图双视角语义。
