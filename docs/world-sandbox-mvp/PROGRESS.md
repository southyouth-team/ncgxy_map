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


---

## 2026-11-07 — 第一轮引擎专项审查与虚拟太阳动态光照

### 仓库与分支核对

- 仓库：`southyouth-team/ncgxy_map`
- 工作分支：`feat/world-sandbox-conversational-model-editor`
- 本轮代码变更基线：`7ac7cec975690e71c4a779e5093fd936a59cecca`
- 本轮文档计划更新提交：`9c3db76f71b66f5f49b8b810c30d5af3d1142ebe`
- `main` 最终核验仍指向原基线 `608a9f2c1f739cd581acb833b1e70410672e258b`。开发期间发现一次写入操作短暂推进了 main 引用，已立即通过带 expected SHA 的 ref 恢复到原基线，并再次核验；本轮最终代码提交位于功能分支。后续写入必须在每次提交后同时核验目标分支 HEAD 与 main HEAD。

### 本轮专项审查结果（基于源码，不代表浏览器验收）

1. **光照/阴影**：
   - Renderer 已开启 shadowMap，使用 `autoUpdate = false`；引擎通过 `shadowMap.needsUpdate` 显式失效更新。
   - 原太阳 DirectionalLight 位置固定；页面时间滑块只把时间折叠成 day/night 两档，无法连续改变太阳方位和高度。
   - 新增虚拟太阳位置计算，并将时间输入连接到方向光位置、光照强度/颜色、半球光和天空色；每次环境变化触发阴影贴图更新。
   - 沙盒模型 Mesh 默认启用 castShadow/receiveShadow；校园静态场景仍有按对象选择性投影的情况，角色自身不投射静态 shadowMap，而使用跟随脚底的接触阴影。因此不能声称场景内所有 Mesh 都参与动态投影。
   - 当前仍是虚拟日周期，不是按日期、时区、经纬度计算的真实太阳轨迹。

2. **交互**：
   - 沙盒模型已有玩家距离检测、提示和 E 键回调。
   - 该回调目前只是向页面发送消息，不具备通用动作注册、目标对象状态修改、条件判断和事件传播链路。
   - 室内门/楼层/房间交互已有专用逻辑，但尚未抽象为通用 Interaction System。

3. **碰撞/移动**：
   - `CollisionWorld` 支持 XZ 平面 AABB、圆形、多边形障碍及洞区；移动支持分步、防穿透和沿障碍滑动。
   - `InputController` 的玩家手动移动和导航路径均经过 CollisionWorld。
   - 目前不是完整 3D 刚体物理；沙盒 AI 模型没有自动注册碰撞体的通用流程。

4. **模型生命周期**：
   - 引擎已有 add/replace/remove/duplicate；替换和删除会释放旧对象的几何体/材质资源。
   - 仍没有统一生命周期注册表，也没有对象状态、交互引用、环境绑定的迁移机制。

5. **持久化**：
   - 页面使用 localStorage v1，保存模型 Object3D JSON、时间/天气/风力和选中模型 ID。
   - 尚未保存独立世界对象状态、交互关系、环境定义/局部覆盖和事件相关数据。

### 本轮实现

- 新增 `src/three/engine/solarPosition.js`：提供 0–24 小时虚拟日周期、太阳方向、日照强度因子和夜间反向补光方向。
- 新增 `src/three/engine/solarPosition.test.js`：覆盖日出、正午、日落、夜间和时间归一化用例（5 项）。
- 修改 `src/three/engine/createCampusEngine.js`：环境输入支持连续小时数；方向光位置、强度、颜色、半球光、天空色和阴影更新随时间变化；室内环境变化仍更新全局光照，但不在室内显示室外雨粒子。
- 修改 `src/components/WorldSandboxMvp.vue`：时间滑块将小时数传给引擎；风力滑块增加即时更新事件绑定。
- 修改 `docs/world-sandbox-mvp/PROJECT_PLAN.md`：明确 M0 的分步实施顺序，太阳光照作为第一项。

### 相关代码提交

- `97e561c5b8cb8c8339a6b25513675cb5844852d7` — 新增虚拟太阳计算
- `fa04cd06295d1e1262701ddc0a41c60d4b6876d6` — 新增太阳计算单元测试
- `d0d9c1a3394513ff330340f8077968c1217c1194` — 修正日出方向保持在地平线上方
- `ccecc5d09504ce9b9fc554e5f9b6a0a47dccfaae` — 时间驱动全局光照和阴影
- `6121f4c81bc034fcc7747bbd80bf9cb2ee23091d` — 页面传递连续时间
- `7ac7cec975690e71c4a779e5093fd936a59cecca` — 风力滑块即时更新
- `9c3db76f71b66f5f49b8b810c30d5af3d1142ebe` — 更新 M0 实施顺序

### 验证状态

- 源码核对：已完成。
- 单元测试：已新增 5 项，但本轮没有可用的本地仓库执行环境，**未执行**。
- 构建：未执行。
- CI：当前提交未返回可用 status check；工作流查询也未返回 PR 运行记录，**不能判定通过或失败**。
- 浏览器验收：未执行；太阳方向、实际阴影长度/方向、室内光照仍需页面实测。
- 主分支：最终核验为原基线 `608a9f2c1f739cd581acb833b1e70410672e258b`，没有保留本轮功能改动。

### 未解决问题与风险

- 太阳轨迹是简化虚拟日周期，未使用日期/纬度/经度/时区。
- 当前单一 DirectionalLight 兼顾夜间补光；尚未拆分独立太阳/月光实体，也没有局部人工灯具系统。
- Shadow camera 范围固定，低角度长阴影可能超出有效范围；需通过浏览器验证后再调整。
- `renderer.shadowMap.autoUpdate = false` 依赖显式失效更新；后续新增/移动/删除会投影的场景对象必须正确调用失效机制。
- 沙盒模型默认全部 Mesh 投影，复杂 AI 模型可能增加 shadow pass 成本；后续需要按对象能力或质量等级配置。

### 下一步

1. 先核对当前功能分支 HEAD 和 main HEAD，确认代码提交落点。
2. 运行新增太阳单元测试和前端构建；若 GitHub Actions 可用则检查 CI 结果。
3. 在浏览器对 06:00、12:00、18:00、22:00 做实际光照/阴影验收，重点检查日出/日落长影和室内环境。
4. 光照验收后，下一项实现最小交互闭环：开关 Interactable → 修改灯具对象状态 → Lighting Runtime 响应；不先做通用复杂动作引擎。


---

## 2026-11-07 — MVP 环境系统独立开关（第一阶段）

### 本轮目标

将环境能力从“只有数值/模式”调整为“独立开关 + 参数值”，并保证开关状态进入沙盒存档。当前只覆盖已有 Runtime 能实际驱动的环境效果，不提前暴露尚无模拟能力的温度、湿度、重力等伪功能。

### 仓库与代码变更

- 工作分支：`feat/world-sandbox-conversational-model-editor`
- 基于前一轮记录的功能分支提交 `f21a733323c403876cced7d9011a1116a24f7e75) 继续修改。
- 修改 `src/components/WorldSandboxMvp.vue`：
  - 增加时间系统、天气总开关、降雨子开关、风力系统四个独立开关。
  - 关闭时间系统时禁用时间滑块，保留当前小时值。
  - 关闭天气总开关或降雨子开关时，不向现有 Runtime 请求雨效；天气模式选择值仍保留。
  - 关闭风力系统时向 Runtime 传递有效风速 0，但保留用户设置的风速值；重新启用后恢复该值。
  - 存档升级到 v2，持久化四个开关和原有参数；恢复逻辑继续接受 v1，旧存档缺失的开关默认开启。
- 修改 `docs/world-sandbox-mvp/PROJECT_PLAN.md`：
  - 明确环境变量的 Enabled、Parameters、Scope/Override 三层契约。
  - 明确父子开关语义、局部显式关闭优先于全局继承，以及当前 M0 的实际开关范围。

### 当前实现边界

- 本轮是 MVP UI/存档与现有 Runtime 之间的最小适配；还没有建立完整 Environment Registry，也没有局部 Zone 覆盖系统。
- 当前天气 Runtime 仅支持晴天/雨效，不代表云层、降雪、独立雾效已实现。
- 时间开关目前控制时间滑块/时间输入是否参与太阳光照更新；当前没有自动走时模拟。
- 温度、湿度、重力尚无对应模拟 Runtime，因此不在本轮 UI 中展示。

### 验证状态

- GitHub 文件写入返回：
  - 页面实现提交：`afbfeea3bb2632fe8b39981efbe45d931791bf53`
  - 计划文档提交：`0484fd071484eafd4ff8e012fb3ba28125cc817e`
- 自动化测试：未执行。
- 前端构建：未执行。
- CI：前一轮基线状态查询无 status checks、无 PR workflow runs；本轮提交尚未取得可用 CI 成功证据。
- 浏览器验收：未执行。
- 分支 HEAD 与 main HEAD：本轮文件写入后的引用核验仍待完成；不能据此宣称分支落点和主分支状态均已验证。

### 下一步

1. 重新核对功能分支与 main 的真实引用，确认连续文件写入均落在目标分支。
2. 对照源码检查开关切换、v1 → v2 存档兼容和刷新恢复。
3. 运行太阳单元测试、前端构建，并在浏览器验收开关行为及 06:00/12:00/18:00/22:00 光照。
4. 完成上述验证后，再实现开关 Interactable → 灯具状态 → Lighting Runtime 的玩家交互闭环。


### 补充修正

- 修改 `src/components/WorldSandboxMvp.vue`：时间系统关闭时，任务输入中的“时间 N 点”指令也会被拒绝，避免绕过 UI 禁用状态改变太阳光照。
- 修正提交：`6738d0e0fddab19a19e77155e8b9ada028f110af`。
