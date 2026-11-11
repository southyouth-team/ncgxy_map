# AI 模型自由动画 Runtime 设计

## 目标与原因

当前 AI 能生成 Three.js 动态代码，但 Worker 中的 `root.toJSON()` 和主线程 `ObjectLoader.parse()` 只恢复静态场景图。函数不能跨 Worker structured clone，材质 `onBeforeCompile` 也不能靠材质 JSON 恢复，因此动态意图丢失。

目标是保留 AI 自由编写 JavaScript/GLSL 的能力，同时让生成模型使用现有沙盒的时间、天气、风、昼夜、人工照明、模型参数和世界状态。宿主标准化输入与生命周期，不限定最终效果类别。

## 已决定的架构

### AI 源码契约

动态模型除现有 `createModel(THREE, params)` 外，可选导出：

```js
createModelAnimation(THREE, model, context) => ({
  update(frame),
  dispose?(),
})
```

工厂可以同步或异步返回控制器；`update()` 必须同步。AI 不创建 renderer、camera、`requestAnimationFrame`、`setInterval` 或独立渲染循环。

`context` 和 `frame` 均提供 `modelId`、`parameters`、`worldState`、`environment`；`frame` 另提供 `time` 和 `deltaTime`（秒）。每帧重新读取输入，不能把环境值只在工厂创建时复制一次。

### 环境快照

从 `createCampusEngine` 现有 `environmentConfig` 构造统一快照：

- `time.hour`、`time.period`：现有小时与 `day/night`。
- `weather.type`、`weather.rainIntensity`：现有 `clear/rain`；当前雨强为 0 或 1。
- `wind.speed`：现有 0～1 风速。
- `wind.direction`：归一化 X/Z 向量；引擎默认 `{ x: 1, z: 0 }`，`setEnvironment` 可接受有效方向，未提供时保留原方向。
- `lighting.artificialEnabled`：现有人工照明开关。

模型级 `environmentOverrides` 继续由现有声明式 binding 处理，自定义动画收到全局环境以及自己的 `worldState`。本阶段不发明新的天气控制 UI 或降雨强度滑块。

### 宿主 Runtime

`modelAnimationRuntime.js` 提供：

- `createSandboxEnvironmentSnapshot(config)`：规范化并冻结环境数据。
- `createModelAnimationRuntime(options)`：管理注册、异步源码加载、更新、错误隔离、删除和销毁。
- Runtime 内部从 `model.userData.proceduralModelSource` 动态导入源码，在主渲染上下文调用 `createModelAnimation(THREE, model, context)`。
- 每个模型独立 entry。创建或更新抛错只禁用该模型动画，保留静态模型，不影响其他模型和主渲染循环。
- 替换/删除/销毁期间完成的异步创建必须立即 dispose，不能挂回旧模型。
- 成功注册活动控制器后请求帧；活动控制器存在时 overview 帧门控继续，且动态阴影按帧失效。
- 模型替换、删除、编辑器预览替换/卸载以及引擎销毁均调用 dispose。

### 保存恢复与合批

现有 `proceduralModelSource` 已随 `userData` 和本地存档保存，无需新增存档版本。Runtime 在控制器创建前捕获一份静态 `toJSON()` 快照；保存时使用这份动画前基准，并合并当前根节点矩阵以及白名单中的宿主状态、参数值和程序化元数据。这样既不会把当前动画姿态烘焙为新基准，也不会把 AI 运行时添加的 Points/辅助节点在恢复时重复创建。控制器尚在异步创建期间也能安全保存。恢复 ObjectLoader 后，从同一份源码重新创建控制器，并读取当前环境，不序列化函数或动画帧。

`capabilities.visual.animations` 仅保留为动画目标依赖元数据：`[{ id, targetPartId }]`。静态合批保护这些 componentId 子树；没有 `type` 白名单，也不据此创建效果。AI 必须为所有会被自定义动画修改的既有部件声明稳定 targetPartId，避免目标被合批消费。

动画目标是视觉对象，不能与启用的静态碰撞体、站立面、楼梯或坡道声明相同或存在祖先/后代重叠。Runtime 在执行 AI 动画工厂前校验该边界；冲突时保留静态模型、拒绝创建控制器并报告错误。未来若需要会移动的真实物理体，应设计独立的动态碰撞能力，不能让视觉动画静默移动而 Rapier 静态碰撞留在原处。

### 预览

编辑器预览复用同一 Runtime 和同一环境快照。预览克隆需要克隆 geometry 与 material/texture，防止动画修改共享资源。每帧使用预览自己的统一 RAF 更新控制器；替换和卸载时先 dispose Runtime，再释放预览独占资源。

### AI 提示

新建和编辑提示都说明通用控制器、环境上下文、目标声明和资源生命周期。允许 AI 自由组合 Object3D 变换、几何属性、ShaderMaterial、onBeforeCompile、粒子等 Three.js 技术，不提供水面专用配方。现有碰撞、交互和声明式 environmentBindings 契约保持。

## 约束与非目标

- 旧模型没有 `createModelAnimation` 导出时保持静态；需要从自然语言重新生成或 AI 编辑补充，不根据旧 prompt 猜测动画。
- 不做流体、风场或粒子物理的正确性保证；效果公式属于 AI 创作。
- 不做无限性能预算；AI 提示要求有界循环和实用实时复杂度，Runtime 提供 delta 上限与错误隔离，但不能证明生成代码高性能。
- 不让动画直接改写 Rapier 静态碰撞声明；动态视觉部件不应冒充动态物理。
- 不提交、不推送，除非用户另行明确要求。

## 执行权限边界

Worker 仍负责模型几何构建与序列化。要直接操作恢复后的真实 Three.js 对象和编译自定义 Shader，`createModelAnimation` 必须在页面渲染上下文重新导入执行；这与 Worker 的权限边界不同。Runtime 能隔离异常和管理生命周期，但不是安全沙箱。源码仍受现有 120 KB 限制，提示继续禁止 DOM、网络、浏览器全局和外部依赖，但提示不是安全边界。生产环境若把模型源码视为不可信输入，需要另行采用独立源、可信签名或真正隔离的渲染架构；本次不把主线程执行宣称为恶意代码防护。

## 验证

- 纯数据环境快照与风向归一化测试。
- 真实源码模块创建控制器、读取每帧环境/世界状态、无动画导出兼容测试。
- 异步替换/删除竞态、单模型异常隔离、dispose 幂等测试。
- 动画目标合批保护测试。
- 新建与编辑 AI 提示契约测试。
- 前端完整 Vitest、生产构建、server Jest/构建。
- 浏览器验证自定义 Shader 编译、风速响应、保存恢复、预览与合批后效果；没有浏览器证据时不宣称视觉效果已实测。
