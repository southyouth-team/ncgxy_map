# World Sandbox MVP 开发进度

> 本文档记录实际发生的开发与架构调整。每次项目工作完成后追加记录；开始新一轮工作前必须先读取本文件和 `PROJECT_PLAN.md`。
>
> 当前跟踪分支：`feat/world-sandbox-conversational-model-editor`

## 状态口径

- **已实现**：当前源码中能确认存在。
- **已提交**：改动已经进入记录的 Git commit。
- **自动化通过**：有对应测试/构建/CI 成功结果作为证据。
- **浏览器验收通过**：实际运行目标页面并完成指定操作验证。
- **待验证**：尚无足够证据，不得描述为通过。

---

## 2026-11-07 — 建立 World Sandbox MVP 文档驱动管理与架构基线

### 仓库基线核对

- 仓库：`southyouth-team/ncgxy_map`
- 分支：`feat/world-sandbox-conversational-model-editor`
- 本轮通过 GitHub 分支引用读取到的 HEAD：`87aa092d8cf164a82e4fe91100b32f9770e0f63a`
- HEAD 提交：`feat(sandbox): preserve model ids when restoring workspace`
- 提交时间：2026-11-06 22:45:48 UTC
- 本轮读取源码：`src/components/WorldSandboxMvp.vue`、`src/three/engine/createCampusEngine.js`；读取现有参考文档：`docs/THREE_ASSET_TEMPLATE_SANDBOX_POC.md`、`PROJECT_GOALS.md`、`docs/DEVELOPMENT_ROADMAP.md`。
- 本轮未修改业务代码；未执行测试、构建或浏览器操作；CI 未在本轮重新核验。

### 当前代码事实（源码审查，不代表浏览器验收）

1. `WorldSandboxMvp.vue` 使用 `createCampusEngine` 初始化 `rpg-sample` 场景，并切换到第三人称模式。
2. 页面已有基础几何体创建、AI 程序化模型生成接口、`executeProceduralModel` 隔离执行、模型整体/参数/部件 AI 修改入口。
3. 页面已有模型选择、移动、旋转、复制、删除，以及模型 Transform 控制模式入口；具体缩放能力以引擎控件实现为准。
4. 页面环境状态仍是固定的 `time`、`weather`、`wind` 字段；`updateEnvironment()` 将其映射为 `timeOfDay: day/night`、`weather: clear/rain`、数值风力。尚未看到动态 Environment Registry 或全局/局部环境继承覆盖实现。
5. 页面保存到浏览器 `localStorage`，存档版本为 `v1`；保存模型的 `Object3D.toJSON()`、环境三个字段、选中模型 ID。恢复时用 `ObjectLoader` 还原模型，并将原 ID 传回 `addSandboxModel`。
6. 引擎存在沙盒模型附近检测、交互提示和 `onSandboxModelInteract` 回调；这证明有基础交互入口，不等于已具备通用 Interaction Registry、动作条件系统或完整设备状态链路。
7. 引擎存在 `CollisionWorld`、输入控制和校园/室内相关能力；当前是否满足独立沙盒所需的物理/导航验收，仍需专项检查和浏览器验证。
8. 引擎源码已有 DirectionalLight、HemisphereLight、雨粒子、风摆目标和固定 `environmentConfig` 等字段；本轮尚未完整审查光照更新链路，不能认定已有太阳轨迹或动态全局阴影闭环。

### 已确认的架构决策

- 项目定位为 AI Native 3D World Engine，而非静态模型展示器。
- 世界对象逻辑上由几何/视觉表示、稳定 ID、Transform、自身状态、可选交互、环境响应、物理表示、空间关系和生命周期组成。
- 四个核心系统：Environment、Interaction、State、Runtime。
- 环境变量区分 Global 与 Local；局部默认继承全局，显式配置后覆盖。
- 太阳属于世界级 Solar/Lighting 系统；时间驱动太阳方向和全局光照/阴影，不要求每个模型单独绑定太阳。
- 玩家行为通过 Interaction System 发起，State System 修改对象状态，事件通知 Runtime；例如开关切换灯具 enabled 状态。
- 增设事件系统；世界数据与 Three.js Object3D 分离；模型定义与实例 Transform 分离。
- AI 输出结构化配置/模型描述，由受控运行时消费；不直接执行 AI 任意代码。
- 先完成核心闭环，不一次性开发 NPC、多玩家、音频全量、复杂导航和大型场景流式加载。

### 本轮文档变更

- 新增 `docs/world-sandbox-mvp/PROJECT_PLAN.md`：产品范围、架构决策、里程碑、验收标准和强制开发流程。
- 新增 `docs/world-sandbox-mvp/PROGRESS.md`：仓库基线、源码事实、决策和本轮验证状态。
- README 增加文档入口链接。

### 验证状态

- 文档内容：已根据当前分支读取的源码和既有文档建立。
- 自动化测试/构建：未执行。
- CI：未重新核验。
- 浏览器验收：未执行。
- 代码变更：无；本轮仅文档变更。

### 下一步

1. 下一轮开始前重新读取本目录两份文档，并重新核对分支 HEAD。
2. 专项审查 `createCampusEngine.js` 中渲染循环、光照、阴影、玩家交互、碰撞与沙盒模型生命周期。
3. 结合真实代码确定最小闭环的首个可验收任务；优先避免一次性铺开所有架构模块。
4. 明确模型状态/交互配置/环境定义的最小 World Document 数据契约，并制定 v1 存档迁移方案。
