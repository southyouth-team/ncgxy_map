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

现在已补齐首个端到端代码链路：用户确认图片后，`POST /assets/ai-image/reconstruct-object` 调用现有 `VISION_MODEL` 输出受约束的 ObjectSculptSpec；服务端归一化材质、几何、变换和层级，拒绝非法父节点/循环/未知 primitive，并签发绑定完整设计的 HMAC token。工坊对 `building` 类调用该接口，将组件树转换成真实 Mesh，在 2.5D/3D 两个视口预览，并显示组件清单。模板归档时，重建设计内的 `referenceImageSha256` 与上传参考图重新比对。

该链路已实现代码和单测，但尚未用真实动漫彩绘城堡图片调用外部视觉模型并在浏览器验收；CI 通过也不等于第三方视觉 API 已真实可用。

### 3. 测试

新增 `createObjectSculptModel.test.js`，覆盖：

- 城堡式组件树构建为多个真实 Three.js Mesh。
- 父子组件层级和组件元数据。
- 重复 ID、缺失父节点、循环引用。
- 未支持 primitive 和越界尺寸。
- 组件数量与层级深度预算。

## 下一阶段实施顺序

1. **真实图片联调**：用已确认的动漫彩绘城堡参考图调用 `reconstruct-object`，检查模型是否按提示词返回足量独立组件、正确颜色和父子层级；如果供应商模型不支持视觉输入或结构 JSON 输出，需按实际返回修订 provider 能力，不得伪造成功。
2. **城堡结构质量提升**：当前提示词要求主体、左右塔楼/塔顶、主屋顶、城垛、入口、窗户、旗杆等部件独立建模；城堡类别服务端要求至少 12 个组件。真实联调后按参考图差异修订部件拆分、比例和材质。
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

- 已完成：受限组件树运行时、视觉模型结构化重建 API、确认图片门禁、HMAC 设计凭证、工坊双视角 Mesh 预览、组件清单、模板参考图摘要一致性校验、服务端和前端适配器单测。
- 待真实验收：外部视觉模型是否能从目标城堡图稳定输出高质量 12+ 组件；模型轮廓与参考图相似度；浏览器 2.5D/3D 视觉检查；保存/重载后是否保持同一组件树。
- 暂不实现：AI 生成 TypeScript 执行。当前 JSON 组件树已能生成基础 Mesh，只有在 primitive 表达能力不足时才评估隔离容器代码生成。
- 本阶段不更改校园空间 Feature、footprint、位置、碰撞、walkable 或地图双视角语义。


## 受控轮廓几何扩展（2026-11-05）

当前 ObjectSculptSpec runtime 在基础 primitive 外新增两种专用轮廓：

- `arch`：通过 Shape 外轮廓和 Path 内孔生成拱形开口实体，`dimensions.width/height/depth` 控制外轮廓与厚度，`geometryDescriptor.inset` 控制拱圈厚度。
- `wedge`：通过三角形截面和 ExtrudeGeometry 生成楔形棱柱，可表达山墙、三角屋顶剖面等。

两种几何仍经过服务端 primitive 白名单与数值边界校验，运行时不执行任何模型生成代码。它们提升了建筑轮廓表达能力，但不能推断参考图背面或被遮挡结构，也尚未提供任意轮廓点/布尔开洞建模。


## 任意受限轮廓拉伸（2026-11-05）

新增 `polygon` primitive：`geometryDescriptor.points` 接收 3-32 个归一化二维点（每个坐标位于 -0.5 至 0.5），`dimensions.width/height` 将轮廓映射到实际宽高，`dimensions.depth` 控制拉伸厚度。服务端和 Three.js 运行时双重校验点数、坐标、退化面积。该版本只接受单一简单外轮廓，暂不支持自交、多轮廓孔洞及布尔运算；不规则山墙、屋顶剖面可使用该能力，拱门仍使用 `arch`。


## 组件级编辑与服务端二次审核（2026-11-05）

### 编辑器交互

- 组件清单中的条目可选中；在任一预览视口点击 Mesh，会沿父级 Group 查找 componentId，并同步选中同一组件。
- 选中状态在 2.5D 与 3D 视口同步高亮。
- 属性检查器允许编辑 dimensions（width/height/depth）、transform（position/rotation/scale）和当前材质（color/roughness/metalness/opacity）。
- 所有修改直接写入当前 design.objectSculptSpec；两个视口继续由同一份 JSON 构建 Mesh，不存在 2.5D/3D 两套模型副本。
- 每个 Mesh 持有独立材质实例，避免共享材质编辑产生跨组件副作用。

### 凭证和发布门禁

- 编辑操作立即将 design.reviewed 设为 false，并清空最终 designToken；原始识别结果和原始 AI token 仅用于发起重新审核。
- 新增 `POST /assets/ai-image/review-object-design`。服务端验证原始设计 token，重新校验完整组件树与材质表，规范化后签发绑定审核后完整 design 的 HMAC token。
- 校验范围包括组件数量、ID 唯一性、primitive 白名单、材质引用、材质颜色与物理参数、尺寸范围、位置/旋转/缩放范围、polygon 轮廓点、父节点引用和循环/深度限制。
- 程序化模板创建和发布统一要求人工审核标记及当前设计凭证；旧 AI token 不能用于审核后的设计，旧最终 token 不能用于修改后的设计。
- 原始 AI token 有效期仍为 15 分钟。编辑耗时超过有效期时，应重新执行识别获取新原始凭证后再审核；不会静默延长凭证有效期。

### 测试与验收边界

- 服务端测试覆盖新凭证签发、旧凭证失效、篡改原始设计、越界尺寸、无效父节点和非法材质。
- Three.js 适配器测试覆盖组件身份元数据与材质实例隔离。
- CI 通过只证明构建和自动化测试，不替代浏览器中的点击选中、数值编辑、双视口同步和重新发布验收。
