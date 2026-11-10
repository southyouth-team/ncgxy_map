# World Sandbox MVP 开发进度

> 本文档记录实际发生的开发与架构调整。每次项目工作完成后追加记录；开始新一轮工作前必须先读取本文件和 `PROJECT_PLAN.md`。
>
> 当前跟踪分支：`fix/sandbox-character-physics-continuity`

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


### 本轮提交落点复核补充

- 已通过目标分支名重新读取页面、计划和进度文件，确认上述变更内容均可从 `feat/world-sandbox-conversational-model-editor` 读取。
- 本轮页面与文档写入分别返回独立 commit SHA，相关提交均可由 GitHub commit 查询读取。
- 仓库最近提交查询返回的默认分支最新提交仍为 `608a9f2c1f739cd581acb833b1e70410672e258b`；本轮所有写入请求均显式指定功能分支，没有向 `main` 发起写入。
- 当前连接器没有提供直接读取 Git ref SHA 的操作，因此无法独立输出功能分支的 ref HEAD SHA；以目标分支文件回读和提交对象可读取作为本轮落点证据。后续若连接器提供 ref 查询，应补充精确 SHA 核验。


---

## 2026-11-07 — 玩家开关灯最小交互闭环（第一阶段）

### 本轮目标与验收标准

打通一个可复用的最小世界状态链路，不先建设大型通用动作框架：

1. 玩家靠近墙壁开关时显示交互提示。
2. 玩家按 E，交互入口根据稳定对象 ID 找到关联灯具。
3. State 更新灯具 `worldState.enabled`。
4. Runtime 根据部件声明的 `stateBinding` 更新 PointLight 可见性和灯泡材质发光强度。
5. 状态随现有 Object3D 存档保存，刷新后恢复。

### 实际改动

- `src/three/engine/createCampusEngine.js`
  - 新增 `getSandboxModelState`、`setSandboxModelState`，对象状态保存在模型根节点 `userData.worldState`。
  - 新增 `getPlayerPosition`，供演示交互对象在玩家附近生成。
  - E 键交互入口仍复用已有的距离检测与提示机制；提示文本可由对象 `interactionConfig.prompt` 自定义。
  - 状态变化后触发 `onSandboxModelStateChange` 回调、请求重绘并失效阴影贴图。
  - 加载模型时根据持久化状态重建运行时绑定。
- 新增 `src/three/engine/worldStateRuntime.js`
  - 提供最小 `applyWorldStateBindings`，支持 boolean 状态映射到 `visible`、`intensity`、`emissiveIntensity`。
- 新增 `src/three/engine/worldStateRuntime.test.js`
  - 覆盖可见性、光照强度、材质发光强度、多材质和未知绑定。
- `src/components/WorldSandboxMvp.vue`
  - 新增“创建开关灯交互演示”入口，一次创建演示灯具和墙壁开关。
  - 墙壁开关通过 `interactionConfig.targetId` 关联灯具稳定 ID。
  - 玩家靠近开关按 E 后切换灯具 enabled 状态，并同步实际 PointLight 与灯泡发光效果。
  - 提示玩家保存沙盒，现有存档会保存模型状态和关联配置。

### 当前边界

- 这是一个最小可验证闭环，不是完整 Interaction Registry / Event Bus。
- 交互动作目前为受控的 `toggle-state`，状态目标通过稳定对象 ID 关联。
- Runtime 绑定当前只覆盖可见性、灯光强度、材质发光强度；后续可按实际对象需求扩展。
- 演示灯具是沙盒内生成的 PointLight + 灯泡 Mesh；尚未将 AI 模型自然识别为灯具，也没有 AI 自动生成交互关系的流程。
- 状态随现有模型 Object3D JSON 持久化，尚未迁移到独立 World Document。

### 提交记录

- `9d6a949082059b2ba151aa2e0459af4e696c31e2` — 引擎对象状态 API 与交互提示配置。
- `cb4df7acf3eb0a0171226db1f633e802e9c9217d` — 页面开关灯演示与玩家交互回调。
- `39c48932f0b86c81028149fa3b3c6c806b6a6c92` — 玩家坐标 API 与状态变化阴影失效。
- `721f39213c62b3f16ac559b790d2174ef76ee158` — 演示对象生成在玩家附近。
- `a808de98ca86c66516addf21d3ef802165241e61` — 新增状态绑定 Runtime。
- `fe6fc3be355f7b50ec260b64258eb4878ca6a50a` — 新增状态绑定单元测试。
- `ba14a04b411848c1eaf49fe903e4b064722cfb76` — 状态绑定接入引擎并在加载时恢复。

### 验证状态

- 源码回读：已完成本轮实现路径核对；仍需最终提交后再回读确认。
- 单元测试：新增 4 项测试，**尚未执行**。
- 前端构建：未执行。
- CI：尚未取得本轮提交的成功状态记录。
- 浏览器验收：未执行；需实际验证靠近提示、按 E 开/关灯、保存刷新恢复。
- 功能分支与 main 的精确 HEAD：待最终 ref 核验；本轮写入均显式指定功能分支，未向 main 发起写入。

### 下一步

1. 核验功能分支和 main 的 ref SHA，确认所有提交落点。
2. 执行 `npm test -- --run` 与 `npm run build`；检查测试结果。
3. 浏览器验收：创建演示 → 靠近墙壁开关 → 按 E 两次验证开/关 → 保存 → 刷新 → 检查状态恢复。
4. 若通过，再把相同的状态绑定协议用于门/设备等对象；之后进入 World Document 的独立数据迁移。


---

## 2026-11-07 — AI 模型环境绑定协议第一阶段

### 本轮目标

让 AI 生成的程序化模型能够声明环境响应能力；沙盒在模型加入、环境变化、模型微调和存档恢复时自动应用这些声明。第一阶段先打通人工灯光全局开关，并提供模型级覆盖 API。

### 实际改动

- `src/three/engine/worldStateRuntime.js`
  - 新增 `applyEnvironmentBindings`。
  - 通过 `targetPartId` 匹配部件 `userData.componentId`，读取 `variable` 并映射到受控 Runtime 属性。
  - 支持模型级 `environmentOverrides` 优先于全局值。
  - 当前支持 `visible`、`intensity`、`emissiveIntensity`；不执行 AI 任意代码。
- `src/three/sandbox/proceduralModel.worker.js`
  - 从 AI 模块读取导出的 `environmentBindings`，保存到 `proceduralModelEnvironmentBindings`，随 Object3D JSON 持久化。
- `server/src/modules/assets/image-generation.service.ts`
  - 新模型生成 Prompt 要求导出 `environmentBindings`，用稳定部件 ID 声明实际存在的灯光目标。
  - 模型微调 Prompt 接收已有绑定；用户要求旧模型接入环境能力时，要求 AI 检查现有源码、增量增加绑定并尽量保留无关结构。
  - 微调响应返回环境绑定元数据；未返回时保留请求中的既有绑定。
- `server/src/modules/assets/image-generation.controller.ts`
  - 微调接口接收并转发 `environmentBindings`。
- `src/three/engine/createCampusEngine.js`
  - 新模型加入、模型替换/微调后自动应用环境绑定。
  - 增加全局 `lighting.artificial.enabled` 环境值。
  - 增加对象级 `setSandboxModelEnvironmentOverride` / `clearSandboxModelEnvironmentOverride`，显式局部值优先于全局值。
- `src/components/WorldSandboxMvp.vue`
  - 增加“人工灯光总开关”，驱动已注册绑定。
  - 存档升级到 v3，保存全局人工灯光开关；继续兼容 v1/v2。
  - AI 微调请求携带既有绑定；替换模型时保留 `worldState` 和局部环境覆盖，撤销历史也记录绑定。

### 当前协议示例

```js
export const environmentBindings = [
  {
    id: 'classroom-ceiling-light',
    targetPartId: 'classroom-ceiling-light',
    variable: 'lighting.artificial.enabled',
    property: 'intensity',
    defaultValue: true,
    enabledValue: 2.4,
    disabledValue: 0,
  },
]
```

这是数据声明示例；`targetPartId` 必须对应模型中真实存在的 `userData.componentId`。第一阶段仅实现人工灯光变量，不代表天气、风、温度等所有变量已经动态注册。

### 提交记录

- `c84eaab61dc73928653ea40b48201ee1a5e3357e` — 环境绑定 Runtime。
- `d1e8f331b2ab3816f6e522a773c4c5c0cbe23d44` — 环境绑定 Runtime 单元测试用例。
- `15fee3b42a5397d6b11e279ea1d8190911e02d8c` — Worker 读取环境绑定元数据。
- `4ac43b82449bc4dd2f34b6eec758cc54dcd13ae0` — AI 生成与微调 Prompt/服务协议。
- `be909379c8162e04aa6212faf50c63a26a4c355a` — 微调 API 传递绑定元数据。
- `fba8a31e968c6c4d0cc61ab0f9150caadd40850c` — 引擎自动应用全局/局部环境绑定。
- `7418c53af98e88e36cc15ce0b63f98cb0f0b2963` — UI 全局人工灯光开关、v3 存档及微调状态保留。
- 本轮架构协议及 M0 顺序更新见 `PROJECT_PLAN.md`。

### 验证状态

- 目标分支源码回读：已完成本轮主要文件的回读；仍需最终 HEAD/文件核验。
- 自动化测试：新增环境绑定测试用例，**尚未执行**。
- 前端构建：未执行。
- 后端测试/类型检查：未执行。
- CI：尚未取得本轮提交的成功状态记录。
- 浏览器验收：未执行。
- main：本轮写入均显式指定功能分支；需在最终核验中再次确认 main 引用未变化。

### 当前限制与待办

1. 当前自动注册只接通 `lighting.artificial.enabled`；其他环境变量尚未接入同一注册数据流。
2. 模型级覆盖 API 已提供，但尚无 UI 管理入口。
3. 第一阶段 Runtime 属性映射只支持 `visible`、`intensity`、`emissiveIntensity`；新效果必须增加受控映射。
4. 需要验证 AI 实际生成的源码是否稳定输出有效绑定，并确保绑定目标部件 ID 确实存在。
5. 需要验证旧模型通过一句话微调增加灯光绑定时，几何结构、模型 Transform、对象状态、局部覆盖和存档均保持。
6. 下一轮先运行单测、构建和后端测试；再做真实生成/微调、全局开关、局部覆盖、保存刷新浏览器验收。


---

## 2026-11-07 — 模型定义、世界环境与实例状态三层边界定型

### 本轮目标

根据产品讨论，明确“模型是否可穿越/可进入、是否响应外部环境”等能力属于建模阶段声明的模型固有定义；世界环境提供外部变量；灯具开关、门状态等属于实例运行状态。避免把三类数据混在一个参数集合中。

### 仓库与分支核对

- 仓库：`southyouth-team/ncgxy_map`
- 目标分支：`feat/world-sandbox-conversational-model-editor`（通过分支搜索确认分支存在）。
- `main` 基线：`608a9f2c1f739cd581acb833b1e70410672e258b`。
- 目标分支文档和源码均通过显式 ref 回读；GitHub compare 接口对该分支返回异常大的 ahead 计数，且未给出可直接核验的 head SHA，因此本轮不据此声称已核验精确分支 HEAD。
- 本轮只计划修改功能分支文档，不修改 main，不创建 PR。

### 源码审查发现

1. **现有环境绑定链路已部分打通**：
   - AI 生成 Prompt 要求导出 `environmentBindings`。
   - Worker 读取导出数组并保存到根节点 `userData.proceduralModelEnvironmentBindings`。
   - 新模型加入沙盒时调用环境绑定 Runtime；当前实际变量仅为 `lighting.artificial.enabled`。
   - Runtime 目前只支持 `visible`、`intensity`、`emissiveIntensity` 三种渲染属性。
2. **新模型生成的元数据链路**：
   - `WorldSandboxMvp.vue` 调用生成接口后，通过 Worker 执行源码；Worker 负责从模块导出中读取环境绑定数组。
   - 参考图用户消息模板没有单独重复列出 `environmentBindings`，但系统 Prompt 已要求导出；后续应统一所有生成入口的导出契约。
3. **AI 增量编辑链路**：
   - 页面已将旧环境绑定传入微调接口；后端 Prompt 要求保留/增量修改绑定；响应未提供数组时回退到旧绑定。
   - 模型替换时保留实例 Transform、`worldState` 和 `environmentOverrides`；撤销记录包含旧绑定。
   - 当前没有统一的模型能力 Manifest；碰撞、通行、可进入、内部空间和通用交互声明尚未进入这一 AI 元数据协议。
4. **数据边界现状**：
   - `modelParameters` 当前主要描述几何/材质编辑控件，不应承载世界环境真值或实例运行状态。
   - `worldState` 保存如灯具 enabled 的实例状态。
   - `environmentBindings` 是模型对世界环境的订阅/响应声明，不是环境变量本身。
   - 当前仍将多类元数据放在 Three.js 根节点 `userData` 中作为过渡方案；尚未迁移到独立 World Document。

### 本轮文档决策

- 在 `PROJECT_PLAN.md` 新增“三层数据边界”：
  1. Model Definition：模型几何、动态编辑参数、碰撞/通行/可进入、内部空间、环境响应声明、交互能力声明。
  2. World Environment：由沙盒统一管理的环境变量定义、开关、参数值和作用范围。
  3. Model Instance State：灯具开关、门开合、设备状态等运行时状态。
- 明确模型能力按实际情况可选声明；缺失能力段不要求补空模板。
- 明确环境绑定属于模型固有定义，但环境值不属于模型。
- 明确未知能力可以随定义保存；没有对应 Runtime 时不宣称已生效，也不因模型类别未知而拒绝模型。
- 调整 M0 顺序：先定三层数据边界和 Manifest，再打通 AI 生成/保存/恢复、增量编辑，之后按 Spatial → Interior → Interaction → Environment 扩展 Runtime。

### 本轮代码变更

- 无。本轮是架构决策定型和源码链路审查；没有修改运行时代码。

### 验证状态

- 目标分支文档和关键源码回读：已完成。
- 自动化测试/前端构建/后端测试：未执行（本轮无代码变更）。
- CI：未核验。
- 浏览器验收：未执行。
- 精确目标分支 HEAD SHA：连接器当前无法可靠提供；已避免使用旧 SHA 作为本轮基线。
- main：未发起任何写入。

### 下一步

1. 基于三层边界定义最小 `Model Capability Manifest` 数据契约，并明确与现有 `modelParameters`、`environmentBindings`、`worldState` 的兼容映射。
2. 优先修正 AI 新模型生成、Worker 解析、模型替换、存档恢复链路，使 Manifest 在全生命周期内不丢失。
3. 增量编辑接收并返回 Manifest；先确保元数据可保存和可编辑，再逐项实现 Spatial/Interior/Interaction Runtime。
4. 完成代码后执行可用的单测、构建和 CI；当前没有这些验证结果。


---

## 2026-11-07 — Model Capability Manifest v1 第一阶段接入

### 本轮目标

把模型固有能力从零散元数据升级为统一 Manifest，打通 AI 新建、隔离 Worker 解析、模型保存、AI 增量编辑和模型替换/撤销链路。此轮只接数据协议，不提前宣称碰撞、室内空间或通用交互 Runtime 已完成。

### 仓库与分支

- 仓库：`southyouth-team/ncgxy_map`
- 工作分支：`feat/world-sandbox-conversational-model-editor`
- 所有源码与文档读取/写入均显式指定该功能分支。
- 本轮没有向 `main` 写入，没有创建 PR。

### 实际代码变更

1. **AI 新模型生成 Prompt**（`server/src/modules/assets/image-generation.service.ts`）
   - 要求导出 `modelCapabilityManifest`，结构包含 `version`、`parameters` 和可选 `capabilities`。
   - 能力段按模型实际情况选择性声明：spatial、interior、environmentBindings、interactions；不要求每个模型都具备全部能力。
   - 保留 `modelParameters`、`modelParts`、`environmentBindings` 兼容导出。
   - 文本生成和参考图生成均要求输出 Manifest。

2. **隔离 Worker 解析与持久化**（`src/three/sandbox/proceduralModel.worker.js`）
   - 读取模块导出的 Manifest。
   - 没有 Manifest 的旧模型根据旧参数/环境绑定导出合成 v1 兼容 Manifest。
   - 保留未知能力字段，不按固定模型类别拒绝。
   - 将 Manifest 写入根节点 `userData.proceduralModelCapabilityManifest`。
   - 同时保留现有 `proceduralModelParameters`、`proceduralModelEnvironmentBindings` 兼容字段。

3. **AI 增量编辑 API 与 Prompt**
   - Controller 接收 `modelCapabilityManifest` 并传入 Service。
   - Service 将当前 Manifest 提供给 AI；要求 AI 返回完整更新 Manifest，并保留未被要求修改的能力声明。
   - 响应兼容旧模型：若 AI 未返回 Manifest，则沿用原 Manifest/旧环境绑定；将 Manifest 中环境绑定与旧 `environmentBindings` 响应字段同步。

4. **页面模型生命周期**
   - 新模型生成后保留 Worker 解析出的 Manifest。
   - AI 微调请求携带当前 Manifest。
   - 模型替换时优先以 Manifest 中的参数定义和环境绑定为主，旧字段作为兼容回退。
   - 撤销历史记录 Manifest；撤销时一并恢复。
   - 当前沙盒通过 `Object3D.toJSON()` 保存模型根节点 userData，因此 Manifest 随现有模型 JSON 存档；恢复仍由 ObjectLoader 读取。

5. **计划文档**
   - 新增 `PROJECT_PLAN.md` 第 3.13 节，定义 Manifest v1、旧字段兼容规则、安全边界和 Runtime 未实现声明。
   - 本轮不迁移 World Document，不改变实例 Transform、worldState 和 environmentOverrides 的既有归属。

### 当前实现边界

- 本轮建立的是 Manifest 数据往返链路；Spatial、Interior、通用 Interaction 能力尚未接 Runtime。
- 当前人工灯光 Runtime 仍通过旧的 `proceduralModelEnvironmentBindings` 字段工作；页面确保其与 Manifest 环境绑定别名同步。
- 模型参数值仍保存在现有 `proceduralModelParameterValues`；本轮没有把实例值迁移到独立 Model Definition。
- AI 返回的 Manifest 是数据声明；未实现的 capability 不会自动产生物理或交互效果。
- 现有旧模型可在 Worker 中合成 Manifest，但若没有可编辑源码，AI 仍无法保证无损增加隐藏结构。

### 提交记录

- `5fc28866f78b9a432e338588fc6b57fdc0652509` — Worker 解析并保存 Manifest。
- `7f3141daf088043207d56114c072887ea1957946` — AI 生成/微调 Prompt 与 Manifest 数据传递。
- `58409205fea54416856f81a51739ac359d3e6f41` — 微调 Controller 接收 Manifest。
- `5fd7d836f44eed378bbd717f559020c80c2dc862` — 页面保存、替换、撤销 Manifest。
- `e5101edcece5520fc4ac1bea3dcb2169d0250e27` — 同步 Manifest 与环境绑定兼容字段。
- `acd6affad99dabef754f9c51382c26161da34fd4` — 修正 Manifest/旧参数与环境绑定的优先级。

### 验证状态

- 源码：本轮修改后需再次回读关键文件确认；已完成静态字符串锚点检查，尚未运行代码。
- 自动化测试：未执行。
- 前端构建：未执行。
- 后端测试/类型检查：未执行。
- CI：未取得可确认的成功结果。
- 浏览器验收：未执行。
- 分支精确 HEAD：当前连接器无法可靠读取 ref HEAD；以文件显式 ref 回读和各文件写入返回 commit 作为落点依据。
- main：本轮未发起写入。

### 下一步

1. 回读 AI 生成 Prompt、Worker Manifest 解析、微调 API、页面替换/撤销代码，检查字段一致性。
2. 在可执行环境运行前端 build、相关单测、后端类型检查/测试。
3. 浏览器验收：新建模型 → 保存刷新 → 查看 Manifest 元数据保留；对旧模型用自然语言增加能力声明 → 替换模型 → 撤销 → 再次保存恢复。
4. 数据链路稳定后，再开始 Spatial Runtime 的最小端到端用例；优先部件级碰撞体与通行区域。


### 本轮源码回读与一致性复核补充

- 已回读 Worker、生成/微调 Service、Controller、页面替换/撤销、Manifest helper/test 和两份项目文档。
- Worker 的 Manifest 参数定义读取修正为使用归一化后的 `manifest.parameters`，避免重构后引用旧局部变量。
- Manifest 归一化逻辑抽取为 `src/three/sandbox/modelCapabilityManifest.js`，保留未知 capability 字段、显式空环境绑定数组和版本号；旧字段仅在 Manifest 缺失对应字段时回退。
- 新增 `modelCapabilityManifest.test.js`，覆盖旧模型兼容、未知能力保留、显式空绑定和旧字段回退，共 4 个用例；测试文件已提交但未执行。
- 页面参数重新生成时优先保留当前实例已持有的 Manifest，避免旧源码未导出 Manifest 时将 AI 增量添加的未知能力声明丢失。
- 微调 Service 统一输出 Manifest 与兼容参数/环境绑定字段；显式存在的 Manifest 能力声明优先，缺失字段再回退旧响应字段。

### 本轮追加提交

- `ba37d1e0699ff5332441cb62ed8f74e4098a5921` — Worker 使用 Manifest 归一化工具。
- `200df55cdf794e0f60092d0731328f0e062a263f` — 新增 Manifest 归一化工具。
- `ec43be0b5f0f2da2852f0df1aa28a25a447ab61d` — 新增 Manifest 兼容单元测试。
- `80b7ed49d87560c40bb4938b5c770f357951c75a` — 修正 Worker 从归一化 Manifest 读取参数定义。
- `f7a43eabf2b54f7de6b5c76c209b9b4fa68c33fd` — 修正微调响应中的 Manifest/旧字段回退与同步。
- `058fba2b6dd3df4050f6f37a1ea88d04f22de024` — 参数重新生成时保留现有 Manifest 能力。

### 最终核验状态（本轮）

- 最后一笔源码实现提交：`058fba2b6dd3df4050f6f37a1ea88d04f22de024`；其后只追加了 `PROJECT_PLAN.md` / `PROGRESS.md` 文档记录。最终功能分支 ref 在本轮结束前再次核验。
- `main` HEAD：`608a9f2c1f739cd581acb833b1e70410672e258b`，与本轮开始时基线一致。
- 目标分支文件回读：Manifest helper、测试、Worker、Service、Controller、页面、PROJECT_PLAN 和 PROGRESS 均可从目标分支读取。
- GitHub Actions：该 HEAD 对应的 PR workflow runs 返回空数组；没有可判定成功的 CI 记录。
- 自动化测试、前端构建、后端类型检查/测试：未执行；当前会话没有本地仓库执行环境。
- 浏览器验收：未执行。
- 本轮没有修改 main，没有创建 PR。

---

## 2026-11-07 — Spatial Runtime v1：部件级地面移动碰撞第一步

### 本轮目标

让 Manifest 中的模型部件级 box collider 真正影响玩家地面移动；建立按实例归属的障碍物生命周期。此轮不实现完整物理引擎、室内导航或门/楼梯连接。

### 仓库与分支

- 仓库：`southyouth-team/ncgxy_map`
- 目标分支：`feat/world-sandbox-conversational-model-editor`
- 所有源码与文档写入均显式指定目标功能分支。
- 本轮未向 `main` 写入，未创建 PR。
- 连接器未提供可靠的分支 HEAD 查询结果；以下以各文件更新返回的提交 SHA 和最终文件回读作为落点依据，不声称已独立核验 ref HEAD。

### 实际改动

1. `src/three/engine/modelSpatialRuntime.js`
   - 新增 `collectModelMovementObstacles`。
   - 读取 `modelCapabilityManifest.capabilities.spatial.colliders`。
   - 通过 `targetPartId` 匹配部件 `userData.componentId`。
   - 将部件局部 box collider 转换为世界空间 AABB。
   - 只把与当前地面角色高度区间相交的碰撞体交给 XZ 移动碰撞系统。
   - 未知形状、缺失部件、disabled 或 blocksMovement=false 的声明不会进入当前 Runtime。

2. `src/three/physics/CollisionWorld.js`
   - `addObstacle` 增加可选 ownerId。
   - 新增 `removeObstaclesByOwner`，支持按模型实例清理碰撞障碍。

3. `src/three/engine/createCampusEngine.js`
   - 新增模型空间碰撞刷新流程。
   - 模型加入时注册 Manifest 碰撞体。
   - TransformControls 修改模型时重算选中模型碰撞体。
   - 模型替换时移除旧障碍并注册新障碍；删除时清理该实例障碍。
   - 保持旧模型无 spatial.colliders 时原有通行行为不变。

4. `server/src/modules/assets/image-generation.service.ts`
   - 新建与微调 Prompt 明确当前可执行碰撞声明格式。
   - 要求碰撞体引用真实 componentId，墙体分段声明，门洞/通道不生成障碍。
   - 明确当前只有 box movement collider 生效，不误导 AI 声称 traversal/interior Runtime 已实现。

5. `src/three/engine/modelSpatialRuntime.test.js`
   - 新增 3 个用例：局部坐标转世界坐标、过滤禁用/无效/高空碰撞体、无空间声明保持非阻挡。

6. `PROJECT_PLAN.md`
   - 新增 Spatial Runtime v1 协议和明确的未实现边界。

### 当前能力边界与风险

- 当前只支持部件级 box collider，并将其投影为 XZ AABB；旋转物体的包围盒会扩大，可能产生保守阻挡。
- 当前地面角色碰撞不具备完整 3D 胶囊体/重力模拟；碰撞体按地面站立高度区间过滤。
- 门洞需要 AI 将墙体拆为独立部件并只为实体墙段声明 collider；当前没有 door state 自动启停碰撞的能力。
- 当前没有 traversalZones、可行走面、楼层、楼梯、电梯或室内导航 Runtime。
- AI 生成是否稳定产出正确的部件 ID 和碰撞声明，尚未进行真实生成验收。

### 提交记录

- `b9092e4655f641ed7e1e657f5c6bfdc938424206` — CollisionWorld 初始实例障碍接口（随后在本轮修正 owner 归属实现）。
- `b9f1e4161a0b79343d52361fb949df08c70dc498` — 引擎空间碰撞接入初始提交（随后在本轮修正换行与接入逻辑）。
- `3200fc71f84a3b07439d51844683d9d797cb28ba` — 新增模型空间碰撞解析模块。
- `6bc6b0d901878b248d960c5df42f54a9cbd760b0` — 新增空间 Runtime 单测。
- `9cbf9305ad39fed8b600812a2d1cff58ce7731b2` — 修正障碍物 ownerId 保存与清理。
- `df3069a345cbf13adbf4381322196c159f61fdcd` — 修正引擎接入、模型生命周期与 Transform 更新。

### 验证状态

- 目标分支文件：已再次读取 CollisionWorld、createCampusEngine、Spatial Runtime helper 和测试文件；仍需对完整文件做最终静态复核。
- 自动化测试：新增 3 个用例，**未执行**（当前会话无本地仓库执行环境）。
- 前端构建：未执行。
- 后端测试/类型检查：未执行。
- CI：未取得本轮提交成功记录。
- 浏览器验收：未执行；需要验证墙体阻挡、门洞通行、模型移动后碰撞跟随、模型删除后碰撞消失。
- `main`：本轮没有写入。

### 下一步

1. 对完整源码做静态复核，确认碰撞障碍 owner 生命周期和 TransformControls 事件没有语法/逻辑问题。
2. 在本地运行新增测试、相关 CollisionWorld 测试及前端 build。
3. 用 AI 生成一个由独立墙段构成、带门洞的房间；检查墙体阻挡、门洞可通行。
4. 验证移动/旋转/缩放/替换/删除模型时碰撞体同步。
5. 通过后再接 traversalZones 与室内空间，不提前扩展完整物理系统。


---

## 2026-11-07 — 通用对象能力推理与用户控制协议定型

### 本轮目标

根据产品决策，将“AI 自主判断 + 用户可控 + Runtime 真实执行”定义为所有世界对象的通用机制，而不是墙体/碰撞专用功能。覆盖模型、部件、区域、空间实体和运行设备；不按对象类别建立固定能力白名单。

### 本轮源码核对

- 仓库：`southyouth-team/ncgxy_map`
- 目标分支：`feat/world-sandbox-conversational-model-editor`；分支搜索确认该分支存在。
- 本轮重新读取了 `PROJECT_PLAN.md`、`PROGRESS.md`、`modelSpatialRuntime.js`、`createCampusEngine.js`、`CollisionWorld.js` 和 AI 生成/微调服务。
- 当前 `modelSpatialRuntime.js` 只读取 `modelCapabilityManifest.capabilities.spatial.colliders`，只将 box blocker 转为 XZ 平面障碍；没有通用 AI 空间推理、用户覆盖解析、几何冲突诊断或自动修复链路。
- 当前 AI Prompt 要求模型直接声明当前 Runtime 可用的 box colliders，并明确 traversal/interior 尚未执行。这是一个底层执行切片，不代表 AI 已具备通用对象能力自主判断。
- GitHub 连接器可确认目标分支存在并可按该分支读取文件，但本轮没有可靠取得分支 ref 的精确 HEAD SHA；本记录不伪造 HEAD。仓库默认分支最近提交查询仍返回 main 历史提交，不能用它替代功能分支 HEAD。

### 本轮架构决策

1. 能力推理适用于所有对象/部件/区域，不限于墙体、碰撞或空间属性。
2. 分离五个职责：AI Capability Reasoning、User Capability Control、Capability Resolver/Compiler、Capability Runtime、Diagnostics/Repair Loop。
3. AI 推断记录独立携带来源、置信度、依据、目标范围和推断状态；置信度不等于自动授权。
4. 用户覆盖独立保存，支持对象/部件/区域/属性级控制；清除覆盖后恢复基础定义/推断结果。AI 后续编辑不得静默覆盖用户明确控制。
5. Runtime 执行结果和诊断是派生数据；不能反向污染模型定义或实例状态。
6. 解析优先级确定为：用户本轮明确指令 > 已保存用户覆盖 > 已确认模型定义 > AI 最新推断 > Runtime 安全默认值。
7. 能力数据保持开放和可扩展；未知字段允许保存/往返。Runtime 只执行已实现的受控执行器，未支持能力明确标记 unsupported/uncompiled。
8. 当前 box collider Runtime 作为兼容的底层执行切片保留；未来由 Spatial Compiler 将更高层空间意图编译为执行数据，不把 collider 字段当作完整能力模型。
9. 自然语言是主要控制入口；用户不需要先理解 collider、材质属性、状态绑定等底层字段。AI 负责把意图映射为局部能力修改，并提供可审阅的变化摘要。

### 本轮文档变更

- 更新 `docs/world-sandbox-mvp/PROJECT_PLAN.md`，新增第 3.14 节“通用对象能力：AI 推理、用户控制与 Runtime 执行”。
- 明确能力覆盖空间/物理、结构拓扑、环境响应、交互状态、运动行为、视觉音频和生命周期等领域；示例清单不是封闭枚举或 Runtime 支持承诺。
- 明确 Inference、User Overrides、Runtime Execution 三类数据的独立职责。
- 增加从 AI 推理、用户确认、解析编译、Runtime 执行到诊断修复的标准链路。
- 明确本轮不改业务代码，不将当前 Spatial Runtime v1 误称为自动推理系统。

### 本轮范围与非目标

- 本轮只定型通用能力协议和路线，不新增碰撞形状、不实现通用能力注册表、不修改 AI 生成代码、不改存档结构。
- 不允许 AI 任意 JavaScript 进入主线程或 Runtime。
- 不承诺当前已支持所有能力类型；没有执行器的能力只保留声明并报告未支持。

### 验证状态

- 文档已通过 GitHub API 写入目标功能分支，并在写入前重新读取两份项目文档。
- 本轮仅文档变更；未执行自动化测试、前端构建、后端测试或浏览器验收。
- 未取得可用 CI 成功证据。
- 未修改 main，未创建 PR。
- 文档写入提交 SHA：`bba58b2284b1f4b3662b31eb6528b2384a906273`（PROJECT_PLAN.md）。PROGRESS.md 更新提交待回填。

### 下一步

1. 回读本轮更新的两份文档，确认协议与现有 Manifest v1、旧字段兼容说明无冲突。
2. 设计独立的 Capability Inference / User Override / Compile Diagnostics 数据契约与局部增量编辑语义；优先做纯数据协议和单元测试，不扩展碰撞形状。
3. 让 AI 生成/微调 Prompt 输出“推断建议”而非把推断直接伪装成已生效能力；保留当前 box collider 输出作为兼容编译结果。
4. 建立用户覆盖的保存/恢复和优先级测试，再接第一个非空间能力用例，证明机制确实通用。
5. 只有在编译器/诊断链路明确后，才逐项扩展 Runtime 执行器。


---

## 2026-11-07 — Capability Control 纯数据协议第一阶段

### 本轮目标

实现与 Three.js 解耦的通用能力控制数据解析层，覆盖任意 capability ID、对象/部件/区域 scope、AI 推断状态和用户覆盖优先级。当前阶段不接 Runtime、不修改 AI Prompt 和页面存档。

### 本轮源码基线

- 仓库：`southyouth-team/ncgxy_map`
- 分支：`feat/world-sandbox-conversational-model-editor`（分支搜索确认存在）。
- 开始前重新读取 `PROJECT_PLAN.md`、`PROGRESS.md`、Manifest helper/test、Spatial Runtime、Worker 和 AI 生成/微调服务。
- 当前 Manifest helper 只负责 v1 归一化；Spatial Runtime 只消费 box movement colliders。没有既有通用推断/覆盖解析器。
- 目标分支精确 HEAD SHA 未能通过当前连接器可靠读取；本轮不以文件 SHA 冒充分支 HEAD。

### 实际代码变更

- 新增 `src/three/sandbox/capabilityControl.js`：
  - `normalizeCapabilityControlDocument` 归一化独立推断、覆盖、诊断集合，并保留未知扩展字段。
  - `resolveCapabilityRecords` 按稳定 capabilityId + scope 合并 fallback、AI proposals、模型定义和用户覆盖。
  - 解析优先级为 fallback < AI proposal < model definition < user override。
  - pending AI proposal 不会激活；accepted 才能成为已接受推断；rejected/disable 在对应 scope 抑制能力。
  - 不设能力名称白名单，不修改输入记录，不执行能力 payload。
- 新增 `src/three/sandbox/capabilityControl.test.js`，覆盖空文档归一化、未知字段保留、用户覆盖优先级、模型定义优先于 AI 推断、pending 不激活、拒绝/禁用、部件 scope 隔离、未知能力 ID 和无副作用。

### 本轮文档变更

- 更新 `PROJECT_PLAN.md`，增加 Capability Control 数据协议第一阶段约定，明确纯数据解析边界和当前未接入的部分。
- 更新本进度记录。

### 当前边界与风险

- 当前 helper 仅在数据层可调用；尚未接入 AI 输出、模型 Manifest 生命周期、UI 用户控制、World Document/localStorage 存档或任何 Runtime。
- 解析器输出的 resolved 仅表示数据优先级解析完成，不表示能力已编译或运行。后续必须引入明确的 compile/runtime 状态和 diagnostics。
- scope key 当前按 targetType/targetId/regionId/partId 组合；后续正式协议需补稳定 ID 校验、scope 冲突/继承规则和局部依赖更新。
- 该阶段不验证几何真实性、物理冲突或行为可执行性。

### 提交记录

- `e9574ccdf41b5a7223c71859c990b83ec3b30811` — 新增 Capability Control resolver。
- `0096075adb2009e316470b2b9a9bfb9a5c9bade6` — 新增 resolver 单元测试。
- `9998ccfe8e9ff754398b4ba1aab1a9e7a2d25177` — 修正 pending AI proposal 必须保持未激活。
- `67a6751d9d061690ba775b851861a6989cd8b95d` — 更新 pending 状态测试。
- `6a233cbeb51e90c06df4f7819fc761522d485179` — 更新 `PROJECT_PLAN.md`。

### 验证状态

- 文件创建/更新 API 已返回提交 SHA。
- 关键源码和测试尚未在本轮最终回读。
- Vitest、前端 build、后端测试/typecheck 未执行。
- CI 和浏览器验收未执行。
- 未向 main 写入，未创建 PR。

### 下一步

1. 回读新增 helper、测试和两份文档，做静态一致性检查。
2. 在可执行环境运行 `npm test -- --run src/three/sandbox/capabilityControl.test.js` 与 `npm run build`。
3. 为模型定义/推断/覆盖建立持久化容器和版本迁移，不把推断元数据塞进旧 Manifest 的 capabilities 执行声明。
4. 修改 AI 生成/微调 Prompt，使 AI 输出可审阅的推断建议与证据；用户确认后才进入模型定义/覆盖。
5. 接入首个 Runtime 编译器前，先定义 diagnostics 的状态机与“resolved/compiled/applied”区别。


---

## 2026-11-07 — Capability Control 自动推断策略调整

### 本轮目标与决策

用户明确取消能力推断的逐项确认：用户明确说到的要求直接执行；用户没有提及的能力由 AI 根据模型结构和上下文自主推断。用户仍可随时通过自然语言调整，已明确表达的用户要求不得被后续 AI 推断覆盖。

### 开始前核对

- 仓库：`southyouth-team/ncgxy_map`
- 目标分支：`feat/world-sandbox-conversational-model-editor`，分支搜索确认存在。
- 已重新读取 `PROJECT_PLAN.md`、`PROGRESS.md`、`capabilityControl.js`、对应测试和 AI 生成服务。
- 当前 resolver 仍把非 accepted 的 proposal 标记为 pending/disabled，测试也明确要求人工确认；与最新产品决策冲突。
- GitHub compare 可确认目标分支与 main 的差异状态，但连接器没有稳定提供目标分支 HEAD 的独立 SHA；不以文件 blob SHA 冒充分支 HEAD。

### 实际改动

- `src/three/sandbox/capabilityControl.js`
  - AI proposals 不再要求 status=accepted；缺省、旧版 proposed 状态均自动进入解析结果。
  - 自动推断默认 enabled=true，但尊重记录显式 enabled=false。
  - AI 推断结果状态标记为 inferred；不再输出 pending。
  - 保留用户 override > model definition > AI inference > Runtime fallback 的数据优先级。
  - 解析仍然只是数据解析，不代表能力已经编译或 Runtime 已应用。
- `src/three/sandbox/capabilityControl.test.js`
  - 删除“等待人工确认”的测试预期。
  - 新增默认自动应用、兼容旧 proposed 状态、尊重显式 disabled 三个用例。
  - 保留用户覆盖优先级、模型定义优先级、拒绝/禁用、scope 隔离、未知能力扩展和无副作用测试。
- `docs/world-sandbox-mvp/PROJECT_PLAN.md`
  - 将能力策略改为自动推断，无逐项确认。
  - 明确当前轮用户指令 > 已保存用户覆盖 > 模型定义 > AI 推断 > Runtime 默认值。
  - 明确用户控制仍然有效，Runtime 未支持能力不得伪称生效。

### 本轮非目标与边界

- 本轮不声称已把 Capability Control 接入页面、Worker、AI Prompt 或存档；这些端到端链路仍未完成。
- 本轮不新增 Runtime 执行器，不把 resolved/inferred 等同于 compiled/applied。
- AI 无法判断时采用保守默认并保留不确定性，不以逐项确认作为默认工作流。

### 验证状态

- GitHub 文件读取成功；代码/测试/文档内容在写入前均来自目标功能分支。
- 本轮提交后需回读文件做静态核验。
- 当前会话没有本地仓库执行环境；Vitest、build、后端测试、CI 和浏览器验收均未执行。
- 未修改 main，未创建 PR。

### 下一步

1. 将自动推断记录接入模型生成/微调输出与 Worker/模型生命周期。
2. 将当前轮自然语言指令转成临时最高优先级 override，持久化用户明确设置。
3. 建立 capabilityControlDocument 的存档往返与迁移。
4. 实现 resolved → compiled → applied 状态与 Runtime diagnostics；先接通一个真实能力闭环。


---

## 2026-11-07 — AI 能力推断接入生成/微调 Prompt

### 本轮目标

将最新产品决策落实到模型生成和模型微调的 AI 指令：用户明确提出的要求直接执行；用户未提及的能力由 AI 根据真实几何、部件结构和上下文自主推断，不再逐项询问用户是否接受。

### 开始前核对

- 仓库：`southyouth-team/ncgxy_map`
- 目标分支：`feat/world-sandbox-conversational-model-editor`；仓库默认分支为 `main)，目标功能分支已通过分支搜索确认存在。
- 已重新读取 `PROJECT_PLAN.md`、`PROGRESS.md`、`capabilityControl.js` 和 `server/src/modules/assets/image-generation.service.ts)。
- 生成接口当前通过 system prompt 生成 `modelCapabilityManifest`；微调接口把当前 Manifest 和用户指令传入模型并返回更新后的 Manifest。
- 现有 Worker/页面/存档是否消费独立 inference/override 文档仍未确认，本轮不假设已经接通。

### 实际改动

- `server/src/modules/assets/image-generation.service.ts`
  - 新增生成阶段自主能力推断指令：基于实际几何、稳定部件 ID、对象语义和用户要求推断相关空间、室内、环境响应、交互、行为、视觉/音频及生命周期能力。
  - 明确用户本轮指令优先；未明确的能力由 AI 保守推断，不要求逐项审批。
  - 明确不凭参考图片臆造不可见结构；不默认所有对象都可进入、移动、破坏或交互。
  - 微调阶段同样要求自动推断缺失能力，保留既有声明，仅在用户指令或必要依赖要求时做局部修改。
  - 明确声明式能力不等于 Runtime 已执行，不能把未实现能力描述为已运行。
- `docs/world-sandbox-mvp/PROJECT_PLAN.md`
  - 修订五职责中 AI Reasoning / User Control 的定义。
  - 移除人工 Review/逐项接受作为默认链路，改为自动推断→解析→编译→执行。
  - 明确置信度用于追溯，不作为审批门槛。

### 非目标与边界

- 本轮只调整 AI 生成/微调指令和架构文档；没有新增 inference JSON 字段，也没有把 Capability Control 文档接入 Worker、页面状态或存档。
- 当前生成结果仍以现有 `modelCapabilityManifest` 为输出契约；独立推断记录、用户覆盖持久化及 Runtime diagnostics 的端到端集成仍待后续实现。
- 不代表空间碰撞以外的能力已有 Runtime 支持。

### 验证状态

- 本轮提交后需回读三个文件并做静态检查，确认生成/微调 prompt 均包含自动推断指令、文档不再要求逐项人工确认。
- Vitest、后端测试/typecheck、前端 build、CI 和浏览器验收均未执行；当前会话无本地仓库执行环境。
- 未修改 main，未创建 PR。

### 下一步

1. 核对 Worker 对生成模块导出项的解析方式，确定 inference 与 model definition 的兼容传递边界。
2. 将 capabilityControlDocument 接入模型对象生命周期，避免仅存在于孤立 helper。
3. 把用户当前轮明确指令转换为临时最高优先级 override，并持久化用户长期明确设置。
4. 建立世界/模型存档往返与迁移测试。
5. 接入第一个自动编译并真实运行的能力闭环，输出 resolved/compiled/applied 和 diagnostics。


---

## 2026-11-07 — Capability Control 接入模型生命周期

### 本轮目标

将能力控制文档从孤立 helper 接入真实模型生命周期，覆盖 AI 生成、隔离 Worker、模型替换、撤销、复制及现有 Object3D JSON 存档恢复。

### 开始前核对

- 仓库：`southyouth-team/ncgxy_map`
- 目标分支：`feat/world-sandbox-conversational-model-editor)，分支搜索确认存在；仓库默认分支为 `main`。
- 重新读取计划、进度、Capability Control helper/test、Manifest helper、Worker、Worker executor、沙盒页面、AI 生成/微调服务和引擎模型注册逻辑。
- 已确认 Manifest 通过 Worker 写入模型根节点 userData；页面存档将模型 Object3D JSON 写入 localStorage；模型替换和撤销会重新执行程序化源码。
- 已确认上一阶段 Capability Control helper 未被 Worker、页面或存档消费。

### 实际改动

- `src/three/sandbox/capabilityControl.js`
  - 新增 `createCapabilityControlDocument`，从 Manifest 的每个顶层 capability namespace 派生通用 AI inference proposal；不设能力名称白名单。
  - 重建 inference 时保留已有用户 overrides、diagnostics 和未知扩展字段。
- `src/three/sandbox/proceduralModel.worker.js`
  - Worker 解析 Manifest 后生成 Capability Control 文档，并写入 `userData.proceduralModelCapabilityControlDocument)。
  - 支持接收上一次模型的 Capability Control 文档，供微调替换时保留用户覆盖。
- `src/three/sandbox/executeProceduralModel.js`
  - 增加可序列化的 capabilityControlDocument Worker 参数。
- `src/components/WorldSandboxMvp.vue`
  - 模型微调/替换时将原文档传入 Worker。
  - 替换历史记录和撤销快照保留该文档。
  - 模型根节点继续通过 Object3D JSON 保存该文档；旧存档恢复时自动补齐兼容文档。
- `PROJECT_PLAN.md`
  - 更新协议与生命周期接入状态，明确目前未完成用户覆盖 UI 和 Runtime resolver 接入。

### 重要边界

- 本轮 AI 推断记录由模型 Manifest 的顶层 capability namespaces 派生，证据字段说明其 Manifest 来源；没有声称模型已经输出独立置信度或几何证据。
- 用户覆盖目前可在数据结构中保留，但尚未提供自然语言指令到结构化 override 的完整解析/写入链路。
- 解析器尚未将 overrides 编译回 Manifest 或接入碰撞/环境/交互 Runtime；本轮不宣称用户覆盖已改变实际运行行为。
- 模型复制由 Three.js Object3D JSON 克隆 userData，因此会复制能力控制文档；没有新增共享引用或外部存储。

### 验证状态

- GitHub 文件写入后需回读全部变更文件并静态检查调用链和锚点。
- Vitest、前端 build、后端测试/typecheck、CI 和浏览器验收未执行；当前会话没有本地仓库执行环境。
- 未修改 main，未创建 PR。

### 下一步

1. 增加从当前轮用户自然语言指令到结构化 user override 的 AI 输出契约，并保证微调结果不会覆盖历史 override。
2. 在 Resolver 中解析模型 inference + Manifest definitions + overrides，并将 resolved 结果提供给第一个 Runtime adapter。
3. 先验证空间 box collider 的 override 是否改变玩家阻挡行为，再扩展其他能力执行器。


---

## 2026-11-07 — 模型能力面板与空间阻挡控制闭环（第一阶段）

### 本轮目标

在现有 AI 模型编辑器中直观展示模型能力声明，并完成一个真实可操作的 Runtime 控制：按模型部件启用/关闭玩家移动阻挡。用户不需要逐项确认 AI 推断；用户通过页面调整时，写入独立覆盖记录并立即影响玩家碰撞。

### 开始前核对

- 仓库：`southyouth-team/ncgxy_map`
- 目标分支：`feat/world-sandbox-conversational-model-editor`，分支搜索确认存在；仓库默认分支为 `main`。
- 已重新读取 `PROJECT_PLAN.md`、`PROGRESS.md`、`ProceduralModelEditor.vue`、`WorldSandboxMvp.vue`、`capabilityControl.js`、`modelCapabilityManifest.js`、`modelSpatialRuntime.js`、`CollisionWorld.js` 和引擎模型注册/刷新代码。
- 确认原模型编辑器已有部件选择和参数编辑，但没有能力面板；原 Spatial Runtime 直接读取 Manifest 中的 box collider，不读取用户 overrides。
- 本轮没有把文件 blob SHA 当作分支 HEAD；GitHub 连接器没有稳定提供本轮目标分支的独立 HEAD SHA 查询结果。

### 实际改动

- `src/components/ProceduralModelEditor.vue`
  - 增加“模型能力”面板，按 Manifest capability namespace 展示能力。
  - 明确标注 Runtime 接入范围：spatial 仅部分支持 box collider 阻挡；其他能力显示未接入，不提供伪开关。
  - 选择模型部件后，空间控制列表按 `targetPartId` 过滤；未选择部件时展示模型内全部空间 collider。
  - 对 Runtime 当前可执行、部件存在且未禁用的 box collider 提供“阻挡玩家移动”开关。
  - 展示能力控制来源为模型定义或用户覆盖。
- `src/components/WorldSandboxMvp.vue`
  - 接收编辑器的 capability-change 事件。
  - 将用户修改写入 `proceduralModelCapabilityControlDocument.overrides`，按 collider capability ID + part scope 更新，不改写原始 Manifest。
  - 即时调用引擎空间障碍刷新，并提示用户保存沙盒。
- `src/three/engine/modelSpatialRuntime.js`
  - 通过 `resolveCapabilityRecords` 合并 collider 模型定义、AI inference proposals 和用户 overrides。
  - 仅对目标部件匹配的 collider 应用 `blocksMovement` 覆盖；保留其他部件的原始行为。
  - 继续只执行 box collider，不扩大 Runtime 能力范围。
- `src/three/engine/createCampusEngine.js`
  - 对外暴露 `refreshSandboxModelSpatial(model)`，使页面修改覆盖后可立即重建该模型的 CollisionWorld 障碍。
- `src/three/engine/modelSpatialRuntime.test.js`
  - 增加用户覆盖关闭阻挡的用例。
  - 增加用户覆盖开启阻挡且不影响其他部件的 scope 隔离用例。
- `PROJECT_PLAN.md`
  - 更新能力面板、用户覆盖与 Spatial Runtime 的当前实现边界。

### 相关提交

- `9489e931a8519ffb8fcbe649bc59d982af269184` — Spatial Runtime 应用部件级能力覆盖
- `7f7bceb27f61029be1cb8a75074f446b504f8509` — 暴露模型空间障碍刷新接口
- `d50cd7f714030bb8aff3d8f6c2a9bf80721da8cd` — 增加 Spatial Runtime 覆盖测试
- `52e11bbf06c6773133c73264ce9dffe4a407fdc6` — 增加模型能力面板与空间控制
- `73996c45b9f0fae0f172cdc10b71ece4aecf166d` — 页面写入用户覆盖并即时刷新碰撞
- `1b7355964d4e4e9104b669c1fb581f33676afdde` — 增加覆盖启用与 scope 隔离测试
- `508cc2e4f6892371309fc8819d6187997807c5c0` — 更新能力面板和 Runtime 架构文档
- `9b8ea927a1f46943cbdd9d36e11e39113af356de` — 修正 UI Runtime 可执行状态判断
- `1c8b38a42f402c30431accc6bccbc79570ac5bc3` — 区分不支持形状、定义禁用和目标部件缺失的 UI 状态

### 验证状态

- GitHub 目标分支回读静态断言：**11/11 通过**，覆盖 Resolver 调用、scope override、引擎刷新接口、测试用例、能力面板、实际开关事件、页面持久化覆盖、碰撞刷新调用、事件绑定和计划文档更新。
- 已回读核心实现片段，确认用户覆盖没有写回 Manifest，Runtime 仍只执行 box collider。
- Vitest：未执行（当前会话没有本地仓库执行环境）。
- 前端 build / typecheck：未执行。
- CI：未核验到本轮提交的成功结果，不能判定通过。
- 浏览器验收：未执行；因此不能声称玩家已在实际页面中完成穿越验证。
- 未修改 `main`，未创建 PR。

### 当前能力边界与风险

- 该闭环控制的是 Manifest 中明确声明的 box collider，不会自动从任意 Mesh 几何推导碰撞体。
- 如果 collider 没有稳定 ID，当前控制 ID 会回退使用 targetPartId；同一部件存在多个未命名 collider 时，可能共享同一个覆盖键。AI 后续输出应为每个 collider 提供稳定唯一 ID。
- 当前碰撞仍是玩家地面移动的 XZ 障碍，不是完整 3D 刚体物理。
- AI inference proposal 目前仍由 Manifest capability namespace 派生，不代表具备独立的几何证据或置信度。
- 页面展示其他 capability namespace，但其 Runtime 尚未接入；不提供虚假可操作开关。

### 下一步

1. 在本地运行 `modelSpatialRuntime.test.js`、前端 build 和 typecheck。
2. 浏览器生成含墙体的 AI 模型，分别切换墙体阻挡开/关，验证玩家移动是否真实穿过，并保存刷新验证覆盖仍生效。
3. 为 AI Prompt 明确要求 collider 输出稳定唯一 ID，并补充重复 ID / 缺失部件诊断。
4. 再按同一闭环方式接入内部空间/门洞/可进入能力；不提前暴露未实现控制项。


---

## 2026-11-07 — 修复 AI 建模 Prompt 字符串语法错误

- 修复 `server/src/modules/assets/image-generation.service.ts:827`：空间 Runtime 提示词字符串缺少结束单引号及数组项逗号，导致 TypeScript 报 `TS1005: ',' expected`。
- 修改仅涉及该提示词字符串的闭合，不改变模型能力约束或生成行为。
- 提交：`110b085b938e57309172e929b40d756c298392b3`。
- 已回读确认空间提示词和下一条 environmentBindings 提示词均为独立、正确闭合的数组字符串。
- 本轮未运行 TypeScript 编译或后端测试；需在本地 watcher 中确认原有两条语法错误消失。


---

## 2026-11-07 — Spatial Runtime v2 第一增量：门洞分段与状态驱动门扇

### 本轮目标

在现有模型部件级 Box Collider Runtime 上，打通门洞无墙体阻挡、门扇按实例状态启停碰撞，以及门扇旋转的基础链路。保持 Model Definition、Capability Override、Model Instance State 三层数据分离。

### 开始前核对

- 仓库：`southyouth-team/ncgxy_map`
- 目标分支：`feat/world-sandbox-conversational-model-editor`
- 开始时精确读取 branch HEAD：`85ea9147de25b209bb5f93cf136adec7333d8ab3`
- 重新读取 `PROJECT_PLAN.md`、`PROGRESS.md)、`modelSpatialRuntime.js`、`modelSpatialRuntime.test.js`、`CollisionWorld.js`、`createCampusEngine.js`、`worldStateRuntime.js`、Worker 与 AI 生成/微调 Prompt。
- 确认 v1 Runtime 只消费 Box Collider；`setSandboxModelState` 原先只应用视觉绑定，没有刷新空间碰撞。

### 实际改动

- `src/three/engine/modelSpatialRuntime.js`
  - 支持 collider 的可选 `stateCondition: { key, equals, defaultValue }`。
  - Runtime 从模型实例 `userData.worldState` 读取条件状态；缺少状态时使用 defaultValue。
  - 条件不满足时不注册该 collider 的移动障碍。
  - 显式用户 capability override 优先于 stateCondition，未修改 AI 原始 Manifest。
- `src/three/engine/createCampusEngine.js`
  - `setSandboxModelState` 更新实例状态后调用 `refreshSandboxModelSpatial`，使门扇开关状态能同步改变碰撞。
- `src/three/engine/worldStateRuntime.js`
  - 增加受控 `rotationY` 状态绑定；门扇部件可根据 boolean 实例状态在 enabledValue/disabledValue 间旋转。
  - emissiveIntensity 关闭值同时尊重声明的 disabledValue。
- `src/three/engine/modelSpatialRuntime.test.js`
  - 新增门扇 closed/open 状态切换碰撞测试。
  - 新增用户显式 collider override 优先于门扇状态条件的测试。
- `server/src/modules/assets/image-generation.service.ts`
  - 生成与微调 Prompt 要求 collider 输出稳定唯一 ID。
  - 明确墙体需围绕门洞拆分，门洞净空不生成墙体 collider。
  - 明确门扇使用独立 collider、`doorOpen` 实例状态条件和铰链旋转绑定。
  - 明确 Portal、室内导航、楼层连接尚未接入 Runtime，不得声称已生效。
- `PROJECT_PLAN.md`
  - 新增 Spatial Runtime v2 当前执行协议、能力边界和后续顺序。

### 当前边界

- 本轮没有实现从任意完整墙体 Mesh 自动识别/切割门洞；AI 必须生成墙体分段和独立门扇部件。
- 当前 `setSandboxModelState` 可驱动 `doorOpen` 状态，但玩家按键/近距离交互触发开门尚未接入 Interaction Runtime。
- 室内区域、Portal/Traversal Zone、可行走地面、楼层、楼梯、电梯仍未实现。
- 旧模型不会自动获得门洞或门扇声明；需要通过模型编辑器自然语言微调补充结构。
- 当前会话只有 GitHub 远程读写能力，没有本地 Node/Vitest/浏览器执行环境。

### 验证状态

- 已新增两项 Vitest 用例，但本轮未实际执行 Vitest。
- 未执行前端 build/typecheck、后端测试/typecheck。
- 未核验 CI。
- 未进行浏览器玩家穿门实测。
- 代码已写入目标功能分支；提交 SHA 与最终 HEAD 将在回读后记录。
- 未修改 `main`，未创建 PR。

### 下一步

1. 本地执行 `modelSpatialRuntime.test.js` 和前后端构建/typecheck，修正实际发现的问题。
2. 浏览器生成带门洞的模型，检查墙体分段是否正确；将 `doorOpen` 从 false 切换为 true/false，验证门扇旋转与碰撞同步。
3. 增加门扇交互入口，使玩家可以在门附近开关门，而不是仅通过模型实例状态 API。
4. 再实现内部空间与可行走区域/Portal 连接；随后推进楼层、楼梯和电梯。


---

## 2026-11-07 — Spatial Runtime v2 第二增量：玩家近距离开关门

### 本轮目标

将门扇实例状态从内部 API 操作扩展为玩家可触发的最小交互闭环：靠近门扇部件显示提示，按 E 切换 `doorOpen`，驱动门扇旋转与碰撞刷新。

### 开始前核对

- 仓库：`southyouth-team/ncgxy_map`
- 目标分支：`feat/world-sandbox-conversational-model-editor`
- 开始时分支 HEAD：`181620eadced6ec9eeb546facd046d002cf2f1e5`
- 重新读取项目计划、进度、引擎玩家按键/附近交互循环、模型状态 API、World State Runtime、模型 Worker 序列化路径、沙盒页面交互处理器及 AI 生成/微调 Prompt。
- 确认现有引擎已有按 E 交互和模型根级交互回调，但没有部件级交互目标定位；Worker 通过 Object3D.toJSON 序列化，部件 userData 可随模型返回。

### 实际改动

- 新增 `src/three/engine/sandboxInteractionRuntime.js`
  - 新增 `findNearestSandboxInteraction`。
  - 遍历沙盒模型部件的 `userData.interactionConfig`，按部件世界坐标/可选局部 interactionPoint 和声明半径筛选最近交互目标。
  - 返回所属模型 ID、部件 ID、目标名称和声明式交互配置。
  - 没有部件级交互声明时，保留模型根级交互回退。
- 新增 `src/three/engine/sandboxInteractionRuntime.test.js`
  - 覆盖部件级门扇交互目标解析。
  - 覆盖旧模型根级交互回退。
  - 覆盖交互半径边界。
- `src/three/engine/createCampusEngine.js`
  - 玩家附近目标扫描改为使用部件级交互解析器。
  - 提示内容支持来自部件的 prompt。
  - 按 E 时将模型 ID、目标部件 ID 和配置传给页面，不执行资产内函数。
- `src/components/WorldSandboxMvp.vue`
  - 交互处理器读取事件携带的部件级配置。
  - 支持受控 `toggle-state`，同模型门扇默认更新所属模型的 `worldState`；保留原有外部 targetId 灯具开关兼容。
  - 状态更新后提示门开/门关，并提示保存沙盒。
- `src/three/engine/worldStateRuntime.test.js`
  - 增加 boolean 实例状态驱动铰链 `rotationY` 的测试。
- `server/src/modules/assets/image-generation.service.ts`
  - 生成与微调 Prompt 增加玩家操作门扇的声明要求：门扇部件使用 `toggle-state`、`doorOpen`、交互半径和提示；同模型门扇不硬编码 targetId。
- `PROJECT_PLAN.md`
  - 记录部件级交互协议和当前 Runtime 边界。

### 当前边界

- 当前只实现 `toggle-state` 这一种受控动作，不代表通用 Interaction Registry 已完成。
- 玩家按 E 的附近交互扫描沿用现有 RPG 沙盒循环；其他场景模式尚未统一接入。
- 门洞仍由 AI 输出的墙体分段实现；Runtime 不会自动从单一墙体 Mesh 中挖洞。
- 门扇需由 AI 正确设置铰链局部原点、独立碰撞体、stateBinding 和 interactionConfig；错误枢轴或不匹配 collider 仍会造成旋转/碰撞不一致。
- 室内区域、Portal/Traversal Zone、室内导航、楼层/楼梯/电梯尚未实现。

### 验证状态

- 已新增部件级交互解析测试和门扇旋转状态测试。
- 静态回读和提交后源码断言待本轮结束前执行。
- 未执行 Vitest、前端 build/typecheck、后端测试/typecheck。
- 未核验 CI，未进行浏览器按 E 开关门实测。
- 当前会话没有本地仓库执行环境，不能替用户运行本地命令。
- 未修改 `main`，未创建 PR。

### 下一步

1. 在本地执行 `sandboxInteractionRuntime.test.js`、`modelSpatialRuntime.test.js`、`worldStateRuntime.test.js`。
2. 生成或微调一栋包含独立门扇的建筑，确认 AI 输出部件级 `interactionConfig`、`stateBinding` 和稳定 collider ID。
3. 浏览器中靠近门，确认提示出现；按 E 开门，再按 E 关门，确认门扇旋转、碰撞启停与沙盒保存恢复一致。
4. 该闭环通过后，再推进内部空间可行走区域与入口连接。


---

## 2026-11-07 — 通用几何一致性与动态空间参数绑定第一增量

### 仓库与分支基线

- 仓库：`southyouth-team/ncgxy_map`
- 分支：`feat/world-sandbox-conversational-model-editor`
- 本轮开始 HEAD：`3b4853974bee6bbc91221c1e1b8f2f4b9e612139`
- 本轮所有代码和文档写入均显式指定上述功能分支；未修改 main，未创建 PR。

### 本轮目标

按通用性原则推进模型质量和能力参数化：不增加房屋/屋顶/烟囱等模型类别特例；让 AI 动态参数能够控制已接入 Runtime 的具体空间能力。

### 实际改动

- `server/src/modules/assets/image-generation.service.ts`
  - 初始程序化生成 Prompt 增加通用几何一致性要求：统一坐标系、父子局部变换、世界变换/几何边界、连接接触、表面覆盖、异常裁切、非预期悬空和部件脱离。
  - 明确保留有依据的开口、间隙、悬挑、空腔和几何交叠；不把所有 AABB 重叠或部件不接触误判为缺陷。
  - 明确不按对象类别、Mesh 名称或部件名称生成专用规则。
  - AI 编辑 Prompt 支持参数定义通过稳定 capabilityId 绑定当前已实现的部件级 `spatial.collider.*.blocksMovement`，并声明参数只影响目标 collider。
  - 明确未接入 Runtime 的 enterable/interior 能力不能被宣称已生效。
- `src/three/engine/modelSpatialRuntime.js`
  - 从 Manifest 参数定义及实例参数值读取声明式 `bindings`。
  - 当前支持参数绑定到具体 Box Collider 的 `blocksMovement` 属性。
  - 优先级为显式用户 capability override > 参数绑定 > 状态条件/模型定义。
- `src/three/engine/modelSpatialRuntime.test.js`
  - 增加参数启停部件碰撞的测试。
  - 增加显式用户覆盖高于参数绑定的优先级测试。
- `docs/world-sandbox-mvp/PROJECT_PLAN.md`
  - 新增通用几何一致性、动态参数绑定和后续阶段的架构约束。

### 提交

- `1ea2fad27bad17187275f9f9325e70ef7eb25abf` — 参数绑定到空间能力
- `f5aeef61a693f832bc7903cae75a824c16502ff0` — 参数绑定 Runtime 测试
- `30128dc9e86d9269167259fb3751a802935c5931` — 修正用户覆盖优先级
- `38fef4063dddb6747a4cf831a561d26e6003b239` — 通用几何推理与参数绑定 Prompt
- `0c28fd8fa1fa9c3903d6a2b128cc164026c71e62` — 更新项目计划

### 当前能力边界

- 参数绑定当前只执行 `spatial.collider.*.blocksMovement`；不是任意能力属性的通用执行器。
- 用户通过自然语言要求 AI 新增参数时，AI 需要返回带有正确稳定 capabilityId 的参数 binding；需用真实生成结果验证参数是否出现、是否驱动碰撞。
- 本轮几何一致性改动是生成/编辑 Prompt 的通用约束，尚未实现 Worker 级几何诊断、自动修复循环或几何拓扑质量保证；不能据此宣称烟囱/屋顶错位问题已被程序化检测或修复。
- `enterable`、室内外视角切换、室内遮挡和独立 AI 建筑内部空间仍未接通 Runtime。
- 本轮没有把 AI 生成源码混入沙盒主程序；模型仍经独立 Worker 执行并以 Object3D 数据进入沙盒。

### 验证状态

- GitHub 文件回读/静态修改：已提交；尚未进行本轮最终完整回读。
- Vitest：未执行。
- 前端 build/typecheck：未执行。
- 后端测试/typecheck：未执行。
- CI：未核验。
- 浏览器：未验收。

### 下一步

1. 回读本轮代码并核对最终分支 HEAD、main HEAD。
2. 执行 `modelSpatialRuntime.test.js`，修复任何测试问题。
3. 使用一个普通模型做端到端参数绑定验收：自然语言新增布尔参数 → 编辑器显示 → 切换后目标 collider 即时启停 → 保存刷新后保持。
4. 再推进通用室内空间与室内视角 Runtime；先核对模型是否真的包含内部几何和可行走区域，不从校园旧楼层数据推断。

---

## 2026-11-07 — 通用几何诊断 v1 与 AI 微调上下文接入

### 本轮目标

在不引入模型类别专用规则的前提下，建立真实 Three.js 几何诊断快照，并让 AI 微调请求能够读取诊断证据，支持后续局部修复。

### 实际改动

- `src/three/sandbox/geometryDiagnostics.js`（新增）
  - 遍历真实 THREE.Mesh / BufferGeometry。
  - 采集稳定 componentId（若存在）、顶点数、局部边界和世界边界。
  - 记录缺失 position attribute、零顶点几何、非有限顶点、非有限世界变换、非有限世界边界和整体退化边界。
  - 不依赖模型类别、Mesh.name 或显示名称；平面/薄片只因单轴厚度为零不会被判为退化。
  - AABB 重叠不作为缺陷结论；不执行自动修复。
- `src/three/sandbox/proceduralModel.worker.js`
  - 在隔离 Worker 中执行生成模型后采集诊断，并将数据写入根节点 `userData.proceduralModelGeometryDiagnostics`。
  - 诊断随 Object3D JSON 序列化回主线程；生成源码仍只在 Worker 执行。
- `src/components/WorldSandboxMvp.vue`
  - AI 微调请求携带当前模型的几何诊断快照。
- `server/src/modules/assets/image-generation.controller.ts`
  - 接收 `geometryDiagnostics` 请求字段并传给 Service。
- `server/src/modules/assets/image-generation.service.ts`
  - 对诊断输入做结构化截取和大小限制，再加入 AI 编辑上下文。
  - Prompt 明确区分数值异常与空间线索，不将边界相交视为缺陷，不按名称/类别判断。
- 新增 `src/three/sandbox/geometryDiagnostics.test.js`，覆盖正常网格、重叠网格不误报、空/退化几何、平面几何、非有限顶点/变换及稳定组件 ID。
- `server/src/modules/assets/image-generation.procedural.spec.ts`
  - 增加诊断快照进入 AI 编辑上下文的服务测试。
- `PROJECT_PLAN.md`
  - 写入诊断采集字段、判断边界、数据传递和当前非目标。

### 关键边界

- 这是几何数据采集与基础数值诊断，不是完整拓扑分析器。
- 不检查任意曲面是否连续覆盖，不证明部件是否正确接触，也不自动判断屋顶/烟囱等结构关系。
- 不自动修复、不阻止模型加入世界；诊断是 AI 的辅助证据。
- 对缺失 componentId 的 Mesh 仍可采集几何，但无法稳定定位到部件；后续需由生成过程补足稳定 ID。
- 当前诊断在模型创建/微调 Worker 执行后刷新；用户在外部直接修改几何后，尚无独立的实时重诊断触发器。

### 提交记录

- `3d688f9e1afc21c9a99188e4b4ca01067ce2b77c` — 新增通用几何诊断采集器
- `7bb670927362df594c73e55b39e5dd90db291133` — 新增几何诊断测试
- `70eb3a83f8b215494c4e58e3af3e170f619226c5` — Worker 生成后附加诊断快照
- `390e900bfcb1bee053d79a4582ee0c80eaa404da` — Controller 接收诊断上下文
- `b26ef8a1390e33f9831a7109c91fc1190950ea1a` — Service 将诊断传入 AI 编辑 Prompt
- `834cf91082105c50fbfc028f013b3451ee328e4b` — 前端微调请求携带诊断
- `e340f98c47532e3a698af7c00e8637f54fb0b87b` — 增加 AI 编辑上下文测试
- `c44666b7a1e0156d67e1c4e1fdd657f7bcaca353` — 补充零顶点几何测试
- `b2747c0d0d38ae7c32b13edcf2509a650173738f` — 更新项目计划
- `65238525e1e321a97e4c183059aa185d72d7bfb0` — 严格限制 AI 诊断上下文的字段与大小
- `09edaf82f54f66a399387ed06279c15ef2afb618` — 校正诊断上下文归一化测试断言

### 验证状态

- GitHub 文件回读与静态断言：待本轮最终核对。
- Vitest / Jest：未执行（当前会话无本地仓库执行环境）。
- 前端 build / typecheck：未执行。
- 后端 typecheck：未执行。
- CI：待核验。
- 浏览器生成模型及 AI 局部修复：未验收。
- 未修改 `main`，未创建 PR。

### 下一步

1. 最终回读 Worker、诊断采集器、AI 请求传递链路和测试文件，核对分支 HEAD。
2. 本地执行 `npx vitest run src/three/sandbox/geometryDiagnostics.test.js src/three/engine/modelSpatialRuntime.test.js`。
3. 本地执行后端 `image-generation.procedural.spec.ts` 对应 Jest 测试及前端 build/typecheck。
4. 浏览器生成一个任意模型，检查其诊断是否写入模型 userData；再发起局部微调，确认 AI 请求上下文包含诊断且不破坏无关部件。
5. 根据真实模型诊断结果，再决定是否需要下一层几何关系诊断；不预设对象类别规则。

---

## 2026-11-07 — 统一模型生成与编辑工作台（第一阶段）

### 本轮目标

将新建模型和已有模型二次编辑统一到现有 `ProceduralModelEditor.vue`，避免生成页与编辑页分裂；实现真实阶段进度、生成草稿预览、参数/AI 对话编辑，以及保存后加入沙盒。视觉 AI 截图复核与自动修复不在本轮范围。

### 仓库与分支

- 仓库：`southyouth-team/ncgxy_map`
- 工作分支：`feat/world-sandbox-conversational-model-editor`
- 本轮开始核对基线：`4392cdc46595a72025a2fbb25f932c469d5ea947`
- `main` 基线：`608a9f2c1f739cd581acb833b1e70410672e258b`
- 本轮所有业务代码与文档写入均显式指定功能分支；没有向 `main` 发起写入，没有创建或合并 PR。

### 实际实现

1. **Worker 真实阶段事件**
   - `proceduralModel.worker.js` 在源码检查、模块加载、模型构建、能力元数据整理、几何诊断和序列化边界发送阶段事件。
   - 每个阶段之间让出 Worker 事件循环，使主线程能收到并显示事件。
   - 兼容同步 `createModel(THREE, parameters)`；同时允许其返回 Promise。
   - 阶段事件反映真实执行边界，不提供伪造百分比；同步模型构建内部仍无法拆分成逐部件进度。

2. **隔离执行器进度转发**
   - `executeProceduralModel` 新增可选 `onProgress` 回调。
   - 进度消息与最终模型结果共用 MessagePort 协议；回调异常不会中断模型执行。
   - 生成代码仍在独立 Worker 内执行，主线程只接收 Object3D 序列化结果并通过 ObjectLoader 还原。

3. **统一工作台 UI**
   - `ProceduralModelEditor.vue` 增加 create/edit 两种模式。
   - 无模型时展示生成阶段和错误；有模型时复用原有 Three.js 预览、参数、部件、能力和 AI 对话编辑面板。
   - 新增“保存并加入沙盒 / 保存修改”操作。
   - 生成期间禁用关闭，避免请求仍在后台运行时工作台状态被误关闭。
   - 预览模型为空时显示占位状态；模型到达后切换到真实 Three.js 预览。

4. **创建草稿与沙盒生命周期**
   - 点击生成立即打开统一工作台，先显示后端请求状态，再接收 Worker 实际阶段事件。
   - 生成完成后模型先作为草稿进入工作台，不立即注册到沙盒。
   - 草稿可使用现有参数修改、AI 对话修改和撤销路径；修改后的草稿仍不进入世界对象列表。
   - 点击“保存并加入沙盒”后才调用现有模型注册流程，并立即写入沙盒存档。
   - 双击已有可编辑 AI 模型仍调用同一工作台；已有模型编辑不创建重复实例。

5. **文档**
   - `PROJECT_PLAN.md` 新增 3.15 节，明确统一工作台交互状态、数据生命周期、阶段进度边界和验收标准。
   - `PROGRESS.md` 记录本轮实际改动与验证边界。

### 相关提交

- `b0c31c36c3532dbaa302c7e86ff94308217bfeab` — Worker 发送真实阶段事件
- `bf7734e722ae0210402299420439cd33a4ec9adb` — 执行器转发进度回调
- `9d8a72c99accfa233d6bb1bafe2053b7af9a06ad` — 编辑器扩展为统一工作台
- `d815a1ccc531644a965945fca042986723200669` — 生成流程接入统一工作台和草稿生命周期
- `da36277fb60a523451b0c6cc86051a4dbfe6755c` — 修正预览空态和生成期间关闭状态
- `1b1f5a92a7963e67a3a1a987e1e1108370c423e1` — 修正草稿保存反馈

### 当前边界与风险

- 后端 AI 生成源码接口目前仍是单次 HTTP 请求；请求未返回前只能显示“请求中”，没有服务端内部 token/步骤流。
- Worker 阶段事件是真实边界，但如果 AI 返回同步构建函数，模型构建函数内部仍是一个不可细分的同步阶段；UI 不显示虚假百分比。
- 本轮没有实现模型截图、多视角预览截图上传、视觉 AI 自检或自动修复。
- 工作台预览采用现有编辑器的独立 Three.js 预览场景，并基于当前模型数据克隆渲染；不是沙盒主场景截图。
- 已有模型编辑沿用原先即时替换内存中实例、点击保存后写入 localStorage 的行为；本轮没有改造为完整事务式暂存/提交。
- 当前没有本地仓库执行环境，无法运行用户本地 npm、构建或浏览器操作。

### 验证状态

- GitHub 文件写入：已完成，后续需做最终分支与文档回读。
- 静态源码回读：已检查 Worker 进度消息、执行器回调、工作台生成/编辑状态、草稿保存入口；尚未完成全文件编译级检查。
- 自动化测试：未执行。
- 前端构建 / TypeScript 检查：未执行。
- CI：本轮未取得可用的 CI 成功证据。
- 浏览器验收：未执行。
- 因此当前状态是“代码已提交、静态回读进行中、运行时待验证”，不能描述为测试通过。

### 下一步

1. 最终回读本轮四个核心源码文件与两份项目文档，检查状态切换、保存路径、Worker 消息协议。
2. 核验功能分支 HEAD 和 `main` HEAD，确认全部提交只落在功能分支。
3. 本地执行前端测试与构建，并在浏览器验证生成弹窗、阶段事件、模型预览、参数编辑、AI 二次编辑、保存入场景、双击重开。
4. 下一阶段再接入多视角截图和视觉 AI 自检；自动修复轮数限制为 1–2 轮，失败保留模型与问题报告，不无限循环。


### 保存失败处理补充

- `saveSandbox()` 现在返回明确成功/失败结果。
- 工作台只有在存档写入成功后才关闭；写入失败时保留工作台，提示模型/修改当前已应用于运行中的沙盒但尚未持久化，用户可重试保存。
- 新建草稿在首次保存动作时只注册一次；若本地存储失败，后续重试只重试存档，不重复创建模型实例。

---

## 2026-11-07 — 增量式程序化模型构建协议（第一阶段）

### 开始前核对

- 仓库：`southyouth-team/ncgxy_map`
- 功能分支：`feat/world-sandbox-conversational-model-editor`
- 开始 HEAD：`4842ce5ac6fb00ceb35bde911a6871a10072c480`
- `main` HEAD：`608a9f2c1f739cd581acb833b1e70410672e258b`
- 已重新读取 `PROJECT_PLAN.md`、`PROGRESS.md`、程序化生成 Service/Controller、Worker、执行器和现有 Service 测试。
- 现状确认：后端 `generateProceduralObjectFromPrompt` 只发起一次 `/chat/completions` 请求并返回完整 `generatedCode`；Controller 是普通 JSON POST；Worker 一次执行完整 `createModel`，只在执行阶段边界发送进度。当前没有 ModelPlan、ComponentChunk、服务端逐组件事件或前端增量预览。
- 当前视觉模型调用未设置 `stream: true`，代码也没有 SSE 消费逻辑。不能据此断言部署模型不支持流式，只能确认当前实现未使用流式接口。

### 本轮目标

先建立最小、开放的增量构建协议和依赖顺序基础，为后续服务端分块生成与 Worker 增量预览提供统一契约；不一次性改造整条链路。

### 实际改动

- 新增 `server/src/modules/assets/procedural-model-build.protocol.ts`
  - 定义 `ModelBuildPlan`、`ModelComponentChunk` 和 `ModelBuildEvent`。
  - 组件通过稳定 `id`、`parentId`、`dependsOn` 描述依赖。
  - 保留未知元数据；组件语义不受固定类别清单约束。
  - 新增确定性拓扑排序，依据显式父级/依赖关系安排生成顺序；同一轮可执行组件保持原始计划顺序。
  - 对重复 ID、缺失依赖和循环依赖给出明确错误；不做模型类别或几何特例判断。
- 新增 `server/src/modules/assets/procedural-model-build.protocol.spec.ts`
  - 覆盖任意组件语义、父子关系、显式依赖、重复 ID、缺失依赖和循环依赖。
- 更新 `PROJECT_PLAN.md`，记录简单模型 one-shot、复杂模型 plan/chunk、局部编辑按依赖增量更新的混合策略，以及协议 v1。
- 更新本文，明确现有 API 仍是一次性完整源码响应，当前未实现 SSE/NDJSON 和实时组件预览。

### 提交

- `8007ed419a2302a6f6105fcdfddb50f07f53e1dc` — 定义增量模型构建协议与依赖排序
- `62c807227fe7de44b6cae1c344804396fcfc6842` — 增加协议依赖排序测试

### 验证状态与边界

- GitHub 文件创建已成功；最终需回读新增文件和两份文档。
- 本会话没有本地仓库执行环境，未运行 Jest、TypeScript typecheck、后端 build。
- 未执行 CI 和浏览器验收。
- 本轮没有改变当前生成 API 的运行行为；不能宣称已实现逐部件实时预览。
- 未修改 `main`，未创建或合并 PR。

### 下一步

1. 在本地运行 `procedural-model-build.protocol.spec.ts` 和后端 typecheck。
2. 核实当前 `VISION_API_BASE_URL` 对应模型服务是否支持 OpenAI-compatible SSE，以及网关是否透传流。
3. 实现复杂模型的两阶段请求：先生成 ModelBuildPlan，再按依赖批次生成 ComponentChunk；简单模型继续走原接口。
4. 将后端事件通过 POST + NDJSON/SSE 传给统一工作台；只有组件块完整且 Worker 构建成功后才显示为已完成预览。
5. Worker 支持多个 chunk 在同一隔离上下文中构建并装配；失败保留上一个有效预览，不丢弃已完成块。


---

## 2026-11-07 — 增量构建协议边界修正

### 开始前核对

- 仓库：`southyouth-team/ncgxy_map`
- 功能分支：`feat/world-sandbox-conversational-model-editor`
- 开始 HEAD：`8603e388db04c570dfee719be3da03b913cedea0`
- `main` HEAD：`608a9f2c1f739cd581acb833b1e70410672e258b`
- 已重新读取项目计划、进度、协议文件、协议测试、生成 Service/Controller、Worker、执行器和工作台生成流程。

### 代码核查结论

- 后端当前仍然调用一次 `/chat/completions`，未设置 `stream: true`，读取完整 `choices[0].message.content` 后才返回 JSON。
- Controller 当前只有普通 JSON POST；没有 SSE/NDJSON 输出。
- Worker 当前只接受完整 `createModel` 源码并构建完整 Group；没有 ComponentChunk 输入和增量 Object3D 返回。
- 当前视觉模型服务是否支持 SSE 尚未证实；当前仓库实现未启用流式。

### 本轮改动

- 修正协议排序器对直接自依赖的处理：之前删除自身依赖边会静默接受 `id -> id`，现在明确报错。
- 测试覆盖 `dependsOn: [自身 ID]` 与 `parentId: 自身 ID` 两种直接自依赖。
- 更新计划文档，明确协议定义与真正的实时分块生成之间的实现边界。

### 验证边界

- GitHub 写入后需回读确认；本会话无本地仓库执行环境，未运行 Jest、TypeScript、Build 或浏览器验收。
- 未修改 `main`，未创建或合并 PR。

### 下一步（实时构建链路）

1. 后端新增 plan 请求与 component chunk 请求；每次 chunk 上下文必须包含完整 plan、坐标约定、已完成组件摘要和依赖约束。
2. 用 POST + NDJSON 传输事件，避免 EventSource 对 POST 请求体支持不足；客户端通过 fetch ReadableStream 消费。
3. Worker 增加同一隔离上下文中的 chunk 构建与增量快照；每块执行成功后再发布预览，失败保留最近有效快照并允许重试。
4. 简单模型继续走原 one-shot 路径；复杂模型只有在 plan 明确需要拆分时才走 chunk 路径。
5. 在真实服务端确认 SSE/NDJSON 代理透传、取消请求与超时行为后，再把“实时”标记为验收通过。

---

## 2026-11-07 — 自适应增量模型构建与工作台逐块预览（第一阶段）

### 开始前核对

- 仓库：`southyouth-team/ncgxy_map`
- 功能分支：`feat/world-sandbox-conversational-model-editor`
- 开始 HEAD：`5eae7991663bc3aa1fb18643308772622510ff5f`
- `main` HEAD：`608a9f2c1f739cd581acb833b1e70410672e258b`
- 已重新读取计划、进度、Controller、Service、协议、Worker、执行器和统一工作台。

### 实际改动

- `image-generation.service.ts`
  - 新增自适应生成方法：AI 首次响应决定 `single` 或 `components`。
  - 简单模型在同一次模型响应中返回完整源码，避免先规划再生成导致额外请求。
  - 复杂模型返回 ModelBuildPlan，后端按父级/显式依赖排序，逐组件生成 ComponentChunk。
  - 每个 chunk 上下文携带完整计划、当前组件和已完成组件摘要。
  - 设置 40 个组件、30 KB 单组件源码、15 分钟整条构建时限。
  - 服务端不执行 AI 源码。
- `image-generation.controller.ts`
  - 新增 POST `generate-procedural-object-stream`。
  - 使用 `application/x-ndjson`，逐条写出构建事件；保留原 JSON 接口。
- `procedural-model-build.protocol.ts`
  - 增加 stage/single 事件类型。
- `WorldSandboxMvp.vue`
  - 新建模型改为 Fetch ReadableStream 消费 NDJSON。
  - 简单模型沿用完整模型 Worker 构建。
  - 复杂模型每收到完整组件块，就组合已完成源码并在隔离 Worker 重建当前模型，更新工作台预览。
  - 组合源码保留 Manifest、参数、部件和环境绑定导出。
  - 根据 `parentId` 将组件 Group 还原为同一 Object3D 层级。
  - 下一块构建失败时保留上一次成功预览；最终仍走原草稿保存流程。
- `image-generation.procedural.spec.ts`
  - 新增 one-shot 快速路径事件测试。
  - 新增复杂模型依赖排序与组件事件测试。
- `PROJECT_PLAN.md`
  - 新增 3.17 节，记录接口、事件、复杂度策略、资源上限与当前缺口。

### 提交记录

- `39cd367bf95bdd8a624325ceedd8b15bf782aec1` — 自适应增量构建 Service
- `fdeb202962f72c1df4d2e2549671cf1cb0f14134` — NDJSON Controller
- `8a883da89c1a223ae7e168846fbaca61090cda9` — 扩展构建事件协议
- `5c708ede3ef884cd73f9b566aae3aa33a40d630d` — 修正 NDJSON 换行帧
- `3ad3d788c02f79969edc105768f907e9e2dd98fc` — 限制组件源码大小
- `91d26a99f41cceaf74684befca9a793bf59acc0e` — 工作台接入增量事件
- `5bf66f4a513ef8da3a2731f4c85c38002dfd318e` — 组件层级和能力导出
- `991543d26338582db7616c51234ee63fd1d9ecd2` — 限制整条构建时长
- `5f38772b147045d8886f8ae5bbe53dbe79b9b37d` — 增加服务端构建路径测试
- `6dfc94c90cc051da80a97e84873b9abea0aa68a3` — 修正组合源码转义
- `c461774c2daa2a7d9179a311374e8416cd3b9226` — 修正组件工厂匹配表达式
- `d42f37880883aa3f486f734f4fe1a41d9bf65234` — 拒绝组件源码中的额外模块导入/导出
- `300a135a6be6b2a1fb36a15fd23f4d5f22f91915` — 更新项目计划
- `8ac9d6ddeeaa8a9c990ab95e167d044c6afa496c` — 更新开发进度

### 验证状态与边界

- 本轮代码静态断言：12/12 通过；最终文档回读确认记录与提交 SHA 一致；代码提交完成后的功能分支 HEAD 为 `8ac9d6ddeeaa8a9c990ab95e167d044c6afa496c`；进度文档最终提交后 HEAD 为 `e1425c1859f6cf535ba23786c7c82815d32caf1c`，`main` 仍为 `608a9f2c1f739cd581acb833b1e70410672e258b`。
- 本会话没有本地仓库执行环境，未运行 Jest、Nest build/typecheck、前端 build/typecheck。
- CI 状态接口返回空状态列表，没有可确认的 CI 通过记录；浏览器端 NDJSON 代理透传、逐块预览和保存流程未验收。
- 当前组件预览采用“累计已完成源码在 Worker 中重建”的实现，便于保留统一模型上下文；不是在 Worker 内持久保留一个逐块可变场景。随着组件增加，重建成本会上升，需通过实际模型压测决定是否改为持久 Worker 会话。
- 单块失败保留最近有效预览，但当前还没有针对失败组件的单独重试 UI。
- 视觉模型服务是否支持 token SSE 不影响本实现：本方案使用普通模型请求，应用层生成完成事件后通过 NDJSON 推送。
- 未修改 `main`，未创建或合并 PR。

### 下一步

1. 最终回读新增 Service/Controller/工作台代码和测试，核对最终分支 HEAD。
2. 在本地运行 `npx jest --runInBand src/modules/assets/image-generation.procedural.spec.ts src/modules/assets/procedural-model-build.protocol.spec.ts`、Nest build 和前端 build/typecheck。
3. 浏览器验证简单模型单次响应、复杂模型逐块预览、组件失败保留上一预览、保存后双击编辑。
4. 若累计 Worker 重建性能不足，再改成同一 Worker 会话的持久组件注册；不要提前引入复杂消息协议。


---

## 2026-11-07 — 修复增量组件工厂正则运行时异常

### 问题与根因

- 浏览器报错：`Invalid regular expression: /^\\s*function\\s+createComponent\\s*\\\\(\\s*THREE\\s*,/: Unterminated group`。
- 根因位于 `src/components/WorldSandboxMvp.vue` 的组件工厂格式检查：正则字面量错误地使用 `\\\\(`，把左括号前多写了一层反斜杠，导致正则解析器将后续括号识别为未闭合分组。
- 正确表达式应使用 `\\(` 匹配普通左括号。

### 本轮改动

- 将工厂匹配正则修正为 `/^\\s*function\\s+createComponent\\s*\\(\\s*THREE\\s*,/`。
- 未调整组件构建协议、AI Prompt、Worker 执行或模型数据结构。
- 仅修改功能分支 `feat/world-sandbox-conversational-model-editor`，未修改 `main`，未创建 PR。

### 提交与验证

- 代码修复提交：`cc28837f08b76f471f58125c1da34b0f4fbe1f54`。
- 已通过 GitHub Contents API 写入，并重新回读源码确认正则已变为 `\s*\(` 的正确形式。
- 本会话没有本地仓库执行环境，未运行前端构建、TypeScript 检查或浏览器回归；代码静态回读确认修正内容，但运行时问题仍待用户刷新页面验收。

### 后续验收

- 刷新页面确认异步组件可正常加载。
- 生成一个走 components 分支的模型，确认首个组件能通过工厂格式检查并进入 Worker 预览。
- 再验证 single 分支不受影响。


---

## 2026-11-07 — 修复模型编辑 Prompt 字符串语法错误

### 问题与根因

- 用户本地 TypeScript watcher 报错：`image-generation.service.ts:1152:501 - TS1005: ',' expected`。
- 根因是 Geometry diagnostics Prompt 数组中的两段字符串之间误写了字面量 `\\n`，而不是源码换行；反斜杠转义字符落在字符串结束符之外，破坏 TypeScript 语法。

### 本轮改动

- 将该处错误的 `',\\n      '` 改为正常的数组元素分隔和源码换行。
- 扫描该 Service 文件后，目标 Prompt 区域未发现其他同类字面量分隔问题。
- 未修改 Prompt 语义、模型生成逻辑或其他 Runtime。

### 提交与验证

- 代码提交：`c7da8d70680942758ac7ecdf8b08b3d165abdd92`。
- GitHub 回读确认 Geometry diagnostics 与 Preserve existing model 两个字符串现已是独立数组元素。
- 未在本会话运行 TypeScript/Nest 构建；需由本地 watcher 自动重编译或执行后端 build 验证。
- 未修改 `main`，未创建 PR。

### 后续验收

- 等待本地 watcher 重新编译，确认 TS1005 消失。
- 若出现新的首条编译错误，按首个真实错误继续定位，不做无关重构。


---

## 2026-11-07 — 修复 geometryDiagnostics 严格空值检查

### 问题与根因

- 用户本地 TypeScript watcher 报错：`TS18047: 'geometryDiagnostics' is possibly 'null'`，位置为模型编辑上下文的诊断数据截断分支。
- 原条件只检查 `geometryDiagnosticsJson.length`，TypeScript 无法据此推导另一个可空变量 `geometryDiagnostics` 非 null。

### 本轮改动

- 将条件改为显式检查 `geometryDiagnostics && geometryDiagnosticsJson.length > 24000`。
- 超过大小限制时才生成精简诊断对象；未超限或输入为空时直接保留原值（包括 null）。
- 不使用非空断言，不改变诊断数据上限、Prompt 内容或模型编辑行为。

### 提交与验证

- 代码修复提交：`599cc139e4ebcfa4c782ac600554875a45d17d82`。
- GitHub 回读与 TypeScript 构建尚待确认；本会话没有本地仓库执行环境，未运行 Nest build/typecheck。
- 未修改 `main`，未创建或合并 PR。

### 后续验收

- 等待本地 Nest watcher 重新编译，确认两处 TS18047 消失。
- 如果继续出现编译错误，按新的首条错误继续定位。


---

## 2026-11-07 — 调整模型生成体验：完成后一次性预览

### 本轮目标

- 用户反馈逐组件同步预览没有必要，生成期间反复重建模型也增加等待和视觉干扰。
- 调整为“AI 全部生成完成 → Worker 一次性构建完整模型 → 展示最终预览”。
- 保留真实分块生成能力，但生成中的组件只暂存源码，不执行、不展示半成品。
- 让长时间等待有可读的阶段与组件进度，不伪造百分比。

### 开始前核对

- 仓库：`southyouth-team/ncgxy_map`
- 功能分支：`feat/world-sandbox-conversational-model-editor`
- 开始 HEAD：`949dd3e5e68dcce2b4c9f199d0e72cac4f61e4dc`
- `main` HEAD：`608a9f2c1f739cd581acb833b1e70410672e258b`
- 已读取项目计划、进度、WorldSandboxMvp.vue、ProceduralModelEditor.vue、Worker、构建 Service 和协议。

### 实际改动

- `src/components/WorldSandboxMvp.vue`
  - 组件完成事件只缓存 ComponentChunk，并将该组件进度标记为完成。
  - 移除每收到一个组件就组合累计源码、调用 Worker、替换 `editingModel` 的同步预览流程。
  - 收到 `complete` 后，才一次性组合全部组件源码并调用隔离 Worker 构建完整模型。
  - Worker 成功返回后才设置 `editingModel`，生成失败时不展示半成品。
  - 进度列表支持明确的 done 状态；组件进度显示序号/总数、组件名称、源码接收状态和源码大小。
  - AI 请求阶段显示等待模型结构分析；组件请求阶段显示正在等待该组件完整源码；最终阶段显示完整模型一次性构建。
  - 不展示伪造百分比，不把模型服务等待描述成 Worker 正在执行。
  - 删除不再使用的 assembly 事件 UI 分支。
- `src/three/sandbox/proceduralModel.worker.js`
  - 对 Blob URL 动态导入增加 `/* @vite-ignore */`，明确告知 Vite 该运行时 URL 无法静态分析，抑制对应 warning；没有改变 Worker 隔离和动态模块加载行为。
- `server/src/modules/assets/image-generation.service.ts`
  - planning 阶段事件增加明确等待说明。
  - 删除原先紧邻 complete 事件、没有实际执行工作的占位 assembly started/complete 事件，避免制造虚假的装配进度。
- `server/src/modules/assets/procedural-model-build.protocol.ts`
  - stage 事件允许携带可选 detail 字段。
- `docs/world-sandbox-mvp/PROJECT_PLAN.md`
  - 更新 3.16/3.17 生成策略，明确组件只暂存，全部生成后才进入 Worker 和最终预览。

### 提交记录

- `dcc58b6332618bb5cd1cef118626b1ebae74b385` — 前端改为完整模型生成后一次性预览。
- `b2765b63c7c82e81548d45700b906b8e801bdc91` — 标记 Worker Blob 动态导入为 Vite ignore。
- `b9b0642014f163319a8a286246458cff2f82189d` — 增加 planning 等待说明并删除占位 assembly 事件。
- `04bef503d33e821c71395c4b525188c1f0e646d2` — 扩展 stage detail 类型。
- `7e7067147f2ed3760fe492a277fb04b65c5a2b1b` — 更新项目计划。
- `00ffc5c1c83e1debc0e5aa5a0ce52c00720b3ed4` — 清理前端过时 assembly 事件处理。

### 验证状态与边界

- 已通过 GitHub 文件回读核对：组件完成事件不再调用 Worker；最终 Worker 构建位于 NDJSON complete 事件之后；Worker Blob 动态导入已添加 Vite ignore 注释。
- 本会话没有本地仓库执行环境，未运行前端 build/typecheck、Nest build、Jest 或浏览器端生成验收。
- Vite warning 是否在用户本地消失，需要本地 Vite watcher 刷新确认。
- NDJSON 后端仍按复杂度分块生成；本轮没有取消分块生成，也没有改成单次超长 AI 请求。
- 未修改 `main`，未创建或合并 PR。

### 本地验收步骤

1. 刷新前端，确认 Vite 不再提示 Blob URL 动态 import 无法分析。
2. 生成一个复杂模型：生成过程中左侧不应出现逐块模型或闪烁预览。
3. 右侧应先显示结构分析等待状态，再逐项显示组件名称、序号、等待 AI 返回、源码接收完成。
4. 所有组件完成后显示一次性 Worker 构建阶段；只有 Worker 成功后才出现完整模型预览。
5. 分别验证 single 和 components 两条路径；任一路径失败都应显示明确失败阶段，不能展示半成品。


---

## 2026-11-07 — 修复增量模型规划 JSON 输出不稳定

### 问题与定位

- 用户运行时收到 `视觉模型构建规划 JSON 格式无效`，失败发生在 planning 阶段的 `parseJson(await requestText(planningMessages))`，尚未进入 single/component 分支、组件生成或 Worker。
- 原请求仅通过 Prompt 要求 JSON，没有启用上游结构化 JSON 输出；解析器捕获异常后丢弃具体解析错误和响应内容，导致无法判断模型输出格式问题。

### 本轮改动

- `server/src/modules/assets/image-generation.service.ts`
  - 规划请求启用 OpenAI-compatible `response_format: { type: 'json_object' }`。
  - 仅规划请求启用 JSON Object 模式；后续组件请求仍返回 JavaScript ES module，不强制 JSON。
  - JSON 解析失败时记录解析器错误及受限长度的响应首尾片段，避免完整响应或密钥进入日志。
  - 对客户端返回带解析器错误摘要的规划 JSON 错误，便于快速定位。
- `server/src/modules/assets/image-generation.procedural.spec.ts`
  - one-shot 规划路径测试断言请求包含 JSON Object response format。
- `PROJECT_PLAN.md`
  - 新增 3.18 节，记录结构化输出与诊断边界。

### 验证边界

- GitHub 文件写入后需回读确认；本会话无本地仓库执行环境，未运行 Jest、Nest build/typecheck 或真实模型 API 验收。
- 上游服务是否完整支持 `response_format: { type: 'json_object' }` 仍需本地实际请求确认；若服务返回“不支持 response_format”的 HTTP 400，需要基于真实错误增加兼容回退，不能假设所有 OpenAI-compatible 服务都实现该参数。
- 未修改 `main`，未创建或合并 PR。

### 本地验收

1. 拉取当前功能分支，重启 Nest 服务。
2. 生成一个简单模型，确认 planning 请求成功返回 JSON 并进入 single 路径。
3. 生成一个复杂模型，确认 planning 返回合法 plan 并进入组件请求。
4. 若仍失败，提供新的 HTTP 状态及后端日志；现在日志会包含 JSON 解析原因和有限响应片段。


## 2026-11-07 — 修复 JSON 模式参数作用域编译错误

- 用户本地 watcher 报错：`TS2304 Cannot find name 'requireJsonObject'`，位置在原始完整模型生成方法中。
- 根因：上轮批量替换将条件参数误插入到不属于增量规划请求的普通生成方法；真正的 `requestText(messages, requireJsonObject)` 请求体却未接入该参数。
- 修复：普通模型生成请求恢复原始请求体；仅增量构建的局部 `requestText` 在 `requireJsonObject=true` 时附加 JSON Object response_format。规划调用显式传 true，组件源码调用保持默认 false。
- 已回读核对两个请求作用域；本会话未运行 Nest build/typecheck/Jest，仍需本地 watcher 验证。


---

## 2026-11-07 — 新建模型改为整体一次性生成并补充请求级重试

### 本轮目标与基线

- 用户反馈复杂模型在“生成组件 6/7：Gabled Shingle Roof”阶段出现 `The operation was aborted due to timeout`，且没有自动重试。
- 用户确认模型通常是一个整体，部件之间存在空间/结构引用；当前阶段不采用组件并发，也不再默认拆分为多次串行生成。
- 仓库：`southyouth-team/ncgxy_map`
- 目标分支：`feat/world-sandbox-conversational-model-editor`
- 开始 HEAD：`0392bc4290409ee51428ad2415e62209933e3934`
- 开始时 `main` HEAD：`608a9f2c1f739cd581acb833b1e70410672e258b`
- 进度文档更新前功能分支 HEAD：`67e81a5741e3684e5ef97dfcabee7fa6a93e5440`
- 未修改 `main`，未创建或合并 PR。

### 架构决策

- 新建模型统一采用“整体理解、一次请求生成完整 Three.js 工厂、Worker 一次构建”的默认路径。
- 取消新建流程中的 AI 策略规划请求、`single/components` 分支判断、逐组件 ComponentChunk 请求和组件级进度。
- ModelBuildPlan / ComponentChunk 协议文件暂时保留，但不再由当前新建模型接口调用；后续是否删除需独立评估其他引用，不在本轮扩大清理范围。
- NDJSON 仅用于推送阶段进度，不代表模型服务 token 级流式输出。
- 局部修改继续使用既有模型编辑接口，不纳入首次生成请求。

### 实际改动

1. `server/src/modules/assets/image-generation.service.ts`
   - `streamProceduralObjectBuild` 不再请求规划 JSON，不再循环生成组件。
   - 直接复用 `generateProceduralObjectFromPrompt` 的完整模型 Prompt 和源码生成能力。
   - 阶段事件调整为整体生成、重试、源码生成完成、complete。
   - 网络连接异常、响应 JSON 不完整、HTTP 408/425/429/5xx 采用有限重试；超时最多重试 1 次，其他暂时性错误最多 3 次总尝试。
   - HTTP 400/402 等非暂时性错误不重试；429 尝试遵守 Retry-After，等待上限 30 秒。
   - 记录生成耗时、尝试次数和源码字节数；结果携带 `generationMetrics`。
   - AI 源码仍只在隔离 Worker 中执行，服务端不执行生成代码。
2. `server/src/modules/assets/image-generation.controller.ts`
   - 更新 NDJSON 接口描述为“完整模型一次性生成和阶段进度”。
3. `src/components/WorldSandboxMvp.vue`
   - 移除组件源码组合函数、ModelPlan/Chunk 暂存和组件进度事件处理。
   - 前端只消费整体生成、重试、完整源码返回、Worker 构建、预览就绪等阶段。
   - 完整源码返回后只调用一次 `executeProceduralModel`。
   - 进度不显示组件序号/组件名称，不模拟百分比。
4. `server/src/modules/assets/image-generation.procedural.spec.ts`
   - 更新流式接口测试，断言一次完整模型请求、不发起规划/组件请求。
   - 新增超时后自动重试测试。
   - 新增 HTTP 402 不重试测试。
5. `docs/world-sandbox-mvp/PROJECT_PLAN.md`
   - 将旧 3.17/3.18 组件分块流程标记为历史实现/当前新建流程停用。
   - 新增 3.19 整体一次性生成和有限重试策略及验收标准。

### 提交记录

- `6eb06b7afe546d111b970af5af8258172cb1a008` — Service 改为整体生成流。
- `a44bd37d882055b80998eb185f4d426d09be72d3` — 修正完整模型源码校验正则。
- `b2b5b756fb36f647a6ab6d5b690e3b5a8e122af0` — 前端移除组件进度和源码组合。
- `1b203fcbdd55c1015674ad1750553dc48caa8082` — 修正 NDJSON 换行解析。
- `9518123ef996b470dd5e2e028c84e83784aeda0f` — 增加整体生成与重试测试。
- `e961c9867c7f1d955dbe8c9b61bfb795d80bfe20` — 更新 Controller 接口说明。
- `66eebd1d35c398f22fadf33a2466193ba1b0a55f` — 更新整体生成架构计划。
- `8d6621bb8b4cb66621de90429b3b89487ee55e4d` — 修正测试中的 Prompt 断言。
- `2fdc1e1cef152f5e8ace7c36bdbff7b6774bccef` — 限制超时最多自动重试一次。
- `a95de95b4ea27a461de7017107c656925bfed7c8` — 明确超时重试策略文档。
- `67e81a5741e3684e5ef97dfcabee7fa6a93e5440` — 移除已停用的组件构建协议未使用导入。

### 验证状态与边界

- 已通过 GitHub 回读核对目标分支、源码修改和文档修改。
- 已静态核对前端 NDJSON 解析按换行拆分，组件组合函数和组件进度处理已移除。
- 已新增 Jest 用例，但本会话没有本地仓库执行环境，未运行 Jest、Nest build/typecheck、前端 build 或浏览器真实模型生成。
- 未执行真实视觉模型 API 请求，因此不能确认上游服务超时后是否能稳定重试，也不能宣称生成速度已经达到目标。
- 本轮没有实现模型服务 token 级流式输出；整体源码仍需等待模型完整响应后才进入 Worker。
- 请求超时重试会重新提交一次完整生成请求，可能产生额外 Token/费用；最多一次超时重试，避免无限重试。
- 需要用户本地拉取分支后验证 TypeScript 编译、Jest、复杂模型整体生成、超时重试以及 402 不重试。

### 本地验收

1. 拉取当前功能分支并重启 Nest 与前端。
2. 生成一个复杂模型，确认后端只有一次正常完整模型请求；不再出现 planning、生成组件 1/N 等事件。
3. 检查前端只显示整体生成、Worker 构建和完成阶段。
4. 模拟或等待一次超时，确认显示“生成请求超时，正在重试”，且最多再请求一次。
5. 使用 HTTP 402 账户余额不足响应，确认不重试并直接显示错误。
6. 确认完整源码返回后 Worker 只构建一次，模型成功后才展示预览。


---

## 2026-11-08 — 恢复模型左侧预览的光圈扩散 Loading 动画

### 问题与目标

- 用户反馈模型尚未加载出来前，左侧预览区域缺少原有的光圈扩散 Loading 动画。
- 目标是在模型未构建完成且 busy 状态为 true 时，恢复清晰可见的环形扩散动画；模型加载后自动由真实 Three.js 预览替代，不遮挡模型。

### 改动

- 文件：`src/components/ProceduralModelEditor.vue`
- 在左侧空预览占位层加入双层扩散光圈和中心呼吸光点。
- 光圈采用错峰循环扩散，中心光点同步轻微呼吸，使用纯 CSS 动画，不增加 JS 定时器或渲染负担。
- Loading 标题和说明绑定当前真实 active progress 阶段；无 active 阶段时显示默认生成提示。
- 仅 `busy=true` 且模型尚未到达预览时显示动画；模型出现后空状态层自动卸载。
- 增加 `prefers-reduced-motion` 处理，减少动态效果偏好下使用静态光圈。

### 验证边界

- 已提交并通过 GitHub 回读核对组件源码。
- 本会话无本地浏览器和本地仓库运行环境，未进行浏览器动画验收或前端 build。
- 不涉及 AI 请求、Worker、模型生成耗时或沙盒 Runtime。

### 本地验收

1. 拉取当前功能分支并启动前端。
2. 新建模型，在 AI 请求和 Worker 构建期间确认左侧预览显示双层光圈向外扩散。
3. 模型构建完成后确认光圈消失，Three.js 预览正常显示。
4. 在减少动态效果系统设置下确认动画退化为静态光圈。


---

## 2026-11-08 — 修正左侧预览 Loading 光圈中心错位

### 问题与根因

- 用户提供运行截图，两个扩散圆环呈现上下错位，中心发光点落在文字下方，标题/说明与光圈视觉区域重叠。
- 回读当前样式发现圆环依赖 Grid 容器中的绝对定位静态位置，并且动画只改变 scale，没有显式固定共同中心坐标；不同浏览器布局/定位行为下存在中心不一致风险。

### 本轮改动

- 文件：`src/components/ProceduralModelEditor.vue`
- 将两个圆环和中心光点统一锚定到父容器的 50% / 50% 坐标。
- 扩散动画始终保留 `translate(-50%, -50%)`，只改变缩放和透明度，避免缩放时定位基准漂移。
- 增大动画容器并固定尺寸，标题和说明独立排列在光圈下方，移除标题额外上边距。
- 调整减少动态效果模式下的静态圆环，继续保持同心布局。
- 不修改 AI 生成、Worker、模型进度协议和 Three.js 渲染逻辑。

### 验证边界

- 本轮基于用户截图和当前分支 CSS 做静态定位修正。
- 尚未运行本地前端构建、浏览器动画回归或系统减少动态效果验收；需要用户本地刷新页面确认实际视觉结果。
- 本轮不修改 `main`，不创建或合并 PR。


---

## 2026-11-08 — 将预览 Loading 调整为连续水波涟漪

### 用户澄清的目标效果

- 需要的是中心向外扩散的水波涟漪，不是两个静态感圆环或单纯呼吸缩放。
- 多道圆形波纹从中心连续产生，半径向外增长，同时逐渐淡出；中心光点保持在原位。

### 本轮改动

- 文件：`src/components/ProceduralModelEditor.vue`
- 将两道圆环调整为三道同心波纹，按 0.9 秒间隔错峰循环，保证持续有波纹向外传播。
- 波纹从接近零半径开始，使用 ease-out 曲线扩张至约 5.8 倍尺寸；透明度从清晰逐步衰减至零。
- 中心光点保持固定坐标，仅做轻微亮度/尺寸呼吸，不随波纹扩散。
- 保留 reduced-motion 静态降级。
- 不涉及 AI 生成请求、Worker、模型构建或 Three.js Runtime。

### 验证边界

- 已提交并回读源码后，确认模板包含三道波纹，CSS 动画同时驱动半径扩张与透明度衰减。
- 本会话未运行本地前端构建或浏览器视觉验收；最终波纹速度、扩散半径和观感仍需在实际页面确认。


---

## 2026-11-08 — 修复涟漪 span 选择器冲突并恢复动态光晕

### 根因

- 用户运行截图显示三道波纹被压缩成中心附近的细小亮线，没有可见的向外扩散。
- 静态检查发现 `.model-editor__preview-empty span` 的选择器同时命中说明文字和内部三道涟漪 span。由于该选择器特异性高于单独的 `.model-editor__loading-ring`，其 `position:relative` 等声明覆盖了波纹的绝对定位；行内 span 也无法按预期呈现宽高。

### 修复

- 将说明文字选择器收窄为 `.model-editor__preview-empty > span`，不再匹配涟漪容器内部的 span。
- 为涟漪圆环显式设置 `display:block`、绝对定位、宽高、边框与增强的多层 box-shadow。
- 在涟漪容器中心增加独立的径向模糊光晕，并以 CSS 动画做呼吸变化；三道圆环仍错峰向外扩散并同步淡出。
- 不修改 AI 请求、Worker 或模型生成链路。

### 验证边界

- 已通过源码静态检查确认文字选择器不再匹配内部涟漪 span，圆环恢复 block/absolute 布局，中心光晕动画已定义。
- 本会话未运行浏览器或前端构建，真实渲染效果仍需本地刷新确认。


---

## 2026-11-08 — 修复对话式模型编辑 JSON 响应约束

### 问题定位

- 用户调用 `POST /api/v1/assets/ai-image/modify-procedural-object` 时收到 HTTP 503，Nest 错误体为 `Service Unavailable`，业务消息为“AI 模型编辑结果不是有效 JSON”。
- 代码路径表明：上游 HTTP 非 2xx 会被单独记录为“模型 AI 编辑失败（HTTP n）”；当前这条业务消息只会在上游 HTTP 成功、但 `choices[0].message.content` 无法解析为 JSON 时触发。
- 因此当前证据更支持“上游返回成功状态，但模型内容未遵守 JSON 协议”，不能直接将其认定为上游 HTTP 503。前端的 503 是本服务对解析失败抛出的 ServiceUnavailableException。

### 本轮改动

- 文件：`server/src/modules/assets/image-generation.service.ts`
- 对模型编辑请求显式增加 OpenAI 兼容的 `response_format: { type: 'json_object' }`，不再只依赖 Prompt 约束。
- JSON 解析失败时记录上游模型原始内容前 500 字符，便于识别 Markdown 包裹、截断或错误文本；客户端仍只收到稳定的业务错误，不暴露完整上游响应。
- 文件：`server/src/modules/assets/image-generation.procedural.spec.ts`
- 增加测试断言，确保对话式编辑请求启用 JSON 输出模式。

### 验证边界

- 源码静态修改与 GitHub 回读核验；尚未运行 Jest、TypeScript 构建或真实模型 API 请求。
- 如果上游模型服务不支持 OpenAI JSON mode，可能返回 HTTP 400；需结合实际服务商兼容性和运行日志进一步确认。


---

## 2026-11-08 — P0：建立模型支撑面/行走面声明与沙盒注册

### 开发基线

- 仓库：`southyouth-team/ncgxy_map`
- 分支：`feat/world-sandbox-conversational-model-editor`
- 开始 HEAD：`1db22fc8e3ff50d39ea0dfa456a92bf369c56861`
- `main` 基线：`608a9f2c1f739cd581acb833b1e70410672e258b`
- 已读取 `PROJECT_PLAN.md`、`PROGRESS.md`、模型空间 Runtime、CollisionWorld、人物输入控制器和沙盒引擎集成代码。

### 本轮目标与边界

- 本轮只落地 P0 空间数据协议与注册，不宣称人物已经能站上平台或沿坡/楼梯移动。
- P1 将单独改造人物地面求解器，避免将“声明已保存”误报为“人物行为已实现”。

### 实际改动

1. `modelCapabilityManifest.capabilities.spatial.surfaces[]`
   - 新增声明字段：`id`、`targetPartId`、`shape: "mesh"`、`supportsStanding`、`walkable`、`enabled`。
   - 支撑与行走是独立布尔属性；没有声明不自动视为可行走。
2. `src/three/engine/modelSpatialRuntime.js`
   - 新增 `collectModelSupportSurfaces(root, ownerId)`。
   - 通过稳定 `componentId` 找到目标部件，收集真实后代 Mesh 和 position attribute；缺失目标、空几何、禁用声明和不支持形状会被忽略。
   - 返回的 Mesh 引用仅供 Runtime 使用，不写回 Manifest。
3. `src/three/physics/CollisionWorld.js`
   - 增加独立 `supportSurfaces` 注册表及按模型实例 ownerId 移除能力。
   - 支撑面注册不会被塞进 `obstacles`，不会错误地阻挡人物水平移动。
4. `src/three/engine/createCampusEngine.js`
   - 模型空间刷新时同时刷新阻挡体和支撑面注册。
   - 模型替换/删除时按 ownerId 清理旧支撑面，避免悬挂引用。
5. `server/src/modules/assets/image-generation.service.ts`
   - 新建模型与对话微调 Prompt 都要求 AI 按实际几何声明 surfaces，并明确不可把墙体/装饰面标记为可行走。
   - Prompt 明确当前阶段仅注册声明，不能声称人物地面求解已支持。
6. 新增测试用例覆盖真实 Mesh 解析、无效声明过滤、Group 后代 Mesh 解析、CollisionWorld 注册与按 owner 清理。

### 验证边界

- 已提交各文件修改并将继续回读确认；本会话没有本地运行环境，未执行 Vitest、前端构建、浏览器操作或实际人物移动验收。
- P0 已建立模型定义到沙盒空间注册表的数据链路；人物仍由现有 XZ 控制器驱动，当前不能据此声称平台站立、坡道或楼梯行走已可用。
- 未修改 `main`，未创建或合并 PR。


---

## 2026-11-08 — P1a：人物移动后按真实 Mesh 支撑面修正高度

### 开发基线

- 分支：`feat/world-sandbox-conversational-model-editor`
- 开始 HEAD：`0a79d57b16b8ecfdd08d527eed7818fa34966abc`
- 已重新读取 `PROJECT_PLAN.md`、`PROGRESS.md`、`CollisionWorld.js`、`InputController.js`、控制器测试和沙盒引擎集成。

### 本轮目标

- 让人物移动后不再始终固定在默认 Y=1.7；检测脚下已注册的模型真实 Mesh 支撑面。
- 保留现有 XZ 障碍移动逻辑，不把支撑面加入障碍列表。
- 过滤过陡表面，避免把垂直墙面当成地面。

### 实际改动

1. `src/three/controls/InputController.js`
   - 初始化 Three.js Raycaster 与射线向量。
   - 新增 `resolvePlayerGroundHeight(player)`，只查询 CollisionWorld 已注册的支撑面 Mesh。
   - 从人物当前位置上方 0.35 单位向下探测，探测距离 3 单位，避免从场景顶端向下射线误命中室内屋顶。
   - 将命中面法线变换到世界空间；最大坡度阈值当前为 50°。
   - 人物键盘移动与自动寻路移动完成 XZ 碰撞解算后，按命中表面高度更新人物眼高；默认地面回退到 1.7。
2. `src/three/controls/InputController.test.js`
   - 新增测试覆盖：支撑面高度、超最大坡度过滤、无模型支撑面时默认地面高度。

### 当前能力与限制

- 已接通“模型声明 → 真实 Mesh 注册 → 人物近邻向下射线 → 人物高度更新”的最小链路。
- 这不是完整重力系统：当前没有垂直速度积分、落地状态机或平台边缘跌落；失去模型表面命中时会回到默认地面高度。
- 当前支撑面查询会接受 `supportsStanding` 或 `walkable` 声明；尚未把“只能站立但不可沿面行走”作为移动约束。
- 最大坡度为控制器常量 50°，尚未成为世界级可配置参数。
- 楼梯踏步、跳跃、动态移动平台、复杂凹凸表面和室内楼层导航未实现。

### 验证边界

- 已提交控制器与测试源码，并完成文档更新。
- 本会话没有本地仓库执行环境，未运行 Vitest、前端构建或浏览器人物移动验收；测试用例只是新增，不能描述为已通过。
- 下一步 P1b：实现垂直速度、重力、落地与离台跌落，并把 supportsStanding / walkable 的语义落实为不同移动行为。


---

## 2026-11-08 — P1b：重力、落地、平台边缘跌落与行走语义

### 开发基线

- 分支：`feat/world-sandbox-conversational-model-editor`
- 开始 HEAD：`ab3e0cf58b52b77a38a6eafbc9b56109ab0e91fc`
- 开始前重新读取项目计划、进度、人物控制器、控制器测试、CollisionWorld 和沙盒引擎相关实现。

### 实际改动

1. `src/three/controls/InputController.js`
   - 新增垂直速度、重力、落地状态、最大上台阶高度和地面探测距离。
   - 使用已注册真实 Mesh 的向下射线命中与世界空间法线，过滤超过 50° 的陡面。
   - 下降时才允许落地；落地高度必须在最大台阶范围内，避免从地面瞬间吸附到高平台。
   - 无模型支撑面时以 Y=0 作为默认世界地面，人物眼高为 1.7；离开平台后受重力下落，落到默认地面。
   - `supportsStanding` 用于静止/落地支撑；`walkable` 用于移动过程的表面支持。仅支持站立的表面不允许人物横向穿行。
   - 键盘、自动寻路和静止帧均执行垂直运动更新。
   - 重置人物位置时同步清空垂直速度并恢复 grounded 状态。
2. `src/three/controls/InputController.test.js`
   - 更新射线探测距离断言。
   - 新增防止高平台瞬间吸附、重力下落后落回默认地面、落到模型支撑面、站立面与行走面语义分离等测试。

### 当前能力与限制

- P1b 源码已实现重力积分、平台落地和平台边缘失去支撑后的下落路径；角色可从模型表面落回默认地面。
- 这仍是轻量级垂直运动，不是完整刚体/胶囊体物理。水平墙体阻挡仍由既有 XZ 碰撞世界处理。
- 最大坡度 50°、最大上台阶高度 0.45、重力 24 为当前控制器常量。
- 角色跳跃、连续楼梯踏步、自动爬梯、动态平台跟随、斜坡侧向滑落、头顶碰撞、胶囊体与三角网格精确碰撞尚未实现。
- 支撑面应提供实际 Mesh 三角面；模型 Transform 更新后需刷新空间注册，避免旧 Mesh 引用。

### 验证边界

- 已新增单元测试源码，但本会话没有本地执行环境，未运行 Vitest、前端构建或浏览器验收。不能将测试描述为通过。
- 已通过 GitHub 回读核对源码和文档提交；未修改 `main`，未创建/合并 PR。


---

## 2026-11-08 — P1c：台阶跨越与连续楼梯行走

### 实际改动

1. `InputController.resolveHorizontalPosition` 统一处理键盘与自动寻路的水平移动结果：
   - 当前处于支撑状态时，目标面是 walkable 且上升高度不超过 0.45，允许跨越。
   - 超过最大台阶高度时回滚水平移动，避免角色穿过高台阶。
   - 目标位置只有站立支撑声明、没有 walkable 声明时，阻止人物走上该表面。
   - 目标位置没有模型支撑面时允许离开平台边缘，由重力处理跌落。
2. 增加测试源码覆盖：
   - 合法高度的楼梯踏步。
   - 超高台阶阻挡。
   - 平台边缘离台。
   - 仅支持站立、不允许行走的表面。
3. 楼梯不按模型类别硬编码；运行时只根据真实 Mesh 命中高度和 Manifest 的 walkable/supportsStanding 声明工作。

### 验收边界

- 本轮完成的是角色对声明式踏步表面的通用跨越逻辑，不会自动把任意楼梯模型转化成可行走踏步。
- 若楼梯 Mesh 缺少可命中的顶面、表面法线错误或未声明 walkable，角色无法可靠爬楼梯，需要修正模型几何/能力声明。
- 最大台阶高度当前为 0.45 世界单位；尚未提供逐模型/世界级配置。
- 已新增测试源码，未在本会话执行 Vitest、构建或浏览器实际爬楼梯验收。


---

## 2026-11-08 — P1c 人物移动回归审查与相机跟随修复

### 回归审查发现

- 检查 InputController.update() 后发现：无水平输入且无自动寻路时，控制器会继续执行垂直重力积分，但直接返回，没有调用当前相机模式的跟随更新。
- 该路径会造成角色在平台边缘离台后继续下降，而第三人称/第一人称相机停留在旧高度，属于人物与镜头状态不同步问题。

### 实际改动

- 修改 src/three/controls/InputController.js：静止状态下记录垂直更新前的 Y；若本帧人物高度发生变化，则调用当前模式对应的 updateThirdPersonDesired() 或 updateFirstPersonDesired()。
- 修改 src/three/controls/InputController.test.js：增加静止下落时更新第三人称相机，以及地面静止时不重复更新相机的测试用例。
- 未改变碰撞协议、支撑面 Manifest、台阶阈值和自动寻路路径。

### 提交记录

- cf66d51d1ae072fd3c736007b139cb9c1a0e61dd — 静止下落时同步相机。
- 4f1d7bb59ffcfface1a10158be6004c8547871d7 — 增加相机同步回归测试。
- 1fcf2df720a42916b9074063addaf304feddc926 — 修正空中测试夹具。
- 后续计划与进度文档提交见本节所在提交链。

### 验证状态与限制

- 已通过 GitHub 回读核对修改前后的控制器逻辑、测试源码及文档。
- 本会话没有本地仓库执行环境，未运行 Vitest、前端构建或浏览器操作；新增测试仅为已编写，不能标记为通过。
- 最新代码提交未返回可用 CI status checks（状态列表为空）。
- main 当前仍为 608a9f2c1f739cd581acb833b1e70410672e258b；本轮写入目标为功能分支，没有修改 main，没有创建或合并 PR。

### 下一步

- 在本地运行 npx vitest run src/three/controls/InputController.test.js src/three/physics/CollisionWorld.test.js。
- 运行前端构建。
- 浏览器实测平地、坡面、连续踏步、平台边缘静止下落、模型碰撞、门洞通行和自动寻路；重点观察人物与相机是否同步、是否出现悬浮/穿透/卡台阶。


---

## 2026-11-08 — P2.1 模型 Transform 联动统一（源码修改）

### 本轮目标

修复自然语言移动/旋转命令直接修改 Three.js Object3D、但没有刷新碰撞体与支撑面的问题；统一编辑器控件与程序化变换的空间同步路径。

### 实际改动

- `src/three/engine/createCampusEngine.js`
  - 新增 `setSandboxModelTransform(id, patch)`，支持 position、rotation、scale 的 x/y/z 轴向部分更新。
  - 过滤非有限数值；不改变未传入的轴向。
  - 变换后更新世界矩阵，刷新该模型的碰撞体和支撑面，并失效阴影贴图、请求重绘。
  - `refreshSandboxModelSpatial` 在采集空间数据前显式更新模型及后代世界矩阵。
  - TransformControls 改为在 `objectChange` 时通过统一 Transform API 刷新空间注册；`change` 事件仅请求重绘。
  - 将 `setSandboxModelTransform` 暴露给页面层。
- `src/components/WorldSandboxMvp.vue`
  - 自然语言移动/旋转命令改为调用引擎 Transform API，不再直接写 Object3D 的 position/rotation。

### 验证状态

- GitHub 源码写入与回读：已完成；分支 HEAD 为 `e7b745260b0bd5af0f2e14fd589ca7f0a8014c99`，相关源码与测试文件已回读。
- 单元测试、构建、CI、浏览器验收：未执行；当前连接环境没有本地仓库执行器或浏览器运行时。
- 本轮只处理 Transform 同步，不代表完整 World Runtime 生命周期已经统一。


---

## 2026-11-08 — P2.2 模型实例生命周期一致性（源码修改）

### 本轮目标

统一模型替换、删除、引擎销毁时的空间注册清理；避免实例 ID 冲突导致场景对象与 Map 注册不一致；修复复制模型时材质纹理共享造成的跨实例资源释放风险；减少页面对象索引与引擎实例注册表之间的数据分歧。

### 实际改动

- `src/three/engine/createCampusEngine.js`
  - 新增 `removeSandboxModelSpatialRegistration(ownerId)`，统一清理模型拥有的碰撞体与支撑面；替换、删除、引擎销毁复用该入口。
  - `addSandboxModel` 拒绝重复实例 ID，避免覆盖 Map 记录但旧模型仍挂在场景中。
  - `replaceSandboxModel` 在调用方未显式提供时保留原实例 `worldState` 和 `environmentOverrides`。
  - `duplicateSandboxModel` 使用独立材质和独立纹理副本，避免删除副本时释放原模型仍在使用的纹理。
- 新增 `src/three/engine/sandboxModelLifecycle.js`：提供材质克隆与纹理所有权隔离函数。
- 新增 `src/three/engine/sandboxModelLifecycle.test.js`：覆盖材质克隆、纹理克隆、源对象隔离和无材质输入。
- `src/components/WorldSandboxMvp.vue`
  - 保存模型列表改为从引擎实例注册表读取，不再以页面辅助 Map 作为权威集合。
  - 恢复时先解析全部模型，再注册实例；注册阶段失败会回滚已注册模型。
  - 删除时只有引擎确认成功后才清理页面辅助引用。

### P2.2 验证状态

- GitHub 源码写入与回读：已完成；最新功能分支 HEAD 为 `97acc0b83379f7be4d147f96fedf57f9f33104eb`。
- 静态核对：已确认重复 ID 防护、统一空间清理、替换状态继承、纹理克隆/释放、引擎注册表存档和恢复回滚代码均存在。
- 新增 `sandboxModelLifecycle.test.js`，覆盖纹理引用隔离、重复纹理槽保留、纹理释放去重；**测试源码已添加，但未执行**。
- Vitest、前端构建、CI 和浏览器验收：未执行/无可用成功状态，不得标记通过。
- `main` 仍为 `608a9f2c1f739cd581acb833b1e70410672e258b`；未修改 main，未创建或合并 PR。


---

## 2026-11-08 — P2.3 AI 模型生成/编辑到沙盒入场链路（源码修改）

### 审查发现

- 新建模型源码在独立 Worker 中执行；Worker 负责归一化 Manifest、构建 Capability Control Document、采集几何诊断，并通过 Object3D JSON 返回页面。
- 新建草稿只有用户保存时才调用 `registerModel` / `engine.addSandboxModel`；引擎随后注册空间阻挡体、支撑面，应用世界状态与全局环境绑定。
- AI 编辑通过独立接口返回源码与 Manifest；前端再次在 Worker 执行新源码，再调用 `replaceSandboxModel` 保留实例 ID/Transform，并重建空间/环境运行时。
- 发现风险：服务端编辑响应在模型未返回 Manifest 时，会把旧 Manifest 作为兼容回退返回；页面原先无条件优先使用接口响应 Manifest，可能使 Worker 实际执行的新源码 Manifest 被旧定义覆盖。

### 实际改动

- `src/three/sandbox/modelCapabilityManifest.js`
  - 新增显式 Manifest 来源判断函数。
- `src/three/sandbox/modelCapabilityManifest.test.js`
  - 增加显式对象 Manifest、null 和数组输入测试源码。
- `src/three/sandbox/proceduralModel.worker.js`
  - 记录 Manifest 来源为 `module` 或 `legacy`，并随模型 userData 返回。
- `src/components/WorldSandboxMvp.vue`
  - AI 编辑替换时，若刚执行的源码显式导出 Manifest，则优先采用该定义；接口响应仅作为兼容回退。


### P2.3 验证状态

- 开始分支 HEAD：`d2faed4d98ab7553e47db88c4be4474b2a6da9f5`；最新功能分支 HEAD：`55b6c5ea07ea8310c0528b581f2098d27525e54c`。
- GitHub 源码写入与回读：完成；已回读 Worker、Manifest 归一化模块、编辑页面和测试源码。
- 静态核对：确认 Worker 对显式模块 Manifest 标记来源；编辑替换优先采用刚执行源码的 Manifest；服务端响应 Manifest 和当前模型 Manifest 保留兼容回退。
- 自动化测试：新增测试源码，但本轮未执行 Vitest。
- 前端构建、服务端构建、CI、浏览器真实生成/编辑/入场验收：未执行或无可用成功状态。
- `main` 当前为 `608a9f2c1f739cd581acb833b1e70410672e258b`；未修改 main，未创建或合并 PR。
- 当前只修复 Manifest 来源优先级风险；不代表生成 API、真实模型质量、门洞/室内导航或完整环境响应已经端到端验收。


### P2.3 后续回归发现：部件元数据可能滞后

- 第二轮静态审查发现，Manifest 已按 Worker 实际执行源码优先，但 `modelParts` 仍优先采用服务端响应的非空数组；AI 编辑若更新/删除部件，旧 API 兼容数据可能覆盖新 Worker 部件元数据。
- 已将部件列表来源也纳入 Worker 输出标记；编辑替换优先使用当前源码导出的列表，且保留显式空数组语义。
- 新增纯函数测试源码覆盖新部件优先、显式清空、旧模块兼容回退。


### P2.3 第二轮验证状态

- 本轮开始分支 HEAD：`a9f57bd91318d943c9486490dd73fd28e0efff70`；本轮最新功能分支 HEAD：`226e49e6f45421783069c15bff773228095f0309`。
- 静态回读确认：Worker 为 `modelParts` 记录来源；页面编辑替换使用 `resolveProceduralModelParts`，不再无条件优先使用服务端非空部件数组。
- 新增测试源码覆盖：Worker 源部件优先、显式空数组清空、旧模块 API/当前模型兼容回退。
- 自动化测试、前端构建、浏览器真实 AI 编辑与入场验收：本轮未执行。测试源码存在不等于测试通过。
- CI 状态为 pending，状态检查数量为 0，不能视为通过。
- `main` 仍为 `608a9f2c1f739cd581acb833b1e70410672e258b`；未修改 main，未创建或合并 PR。


---

## 2026-11-08 — P2.3 空间 Runtime 注册链路补强

### 本轮目标

验证模型替换后，碰撞体与支撑面注册表是否使用新 Object3D / 新 Manifest，而不是只更新模型 userData。

### 实际改动

- `src/three/engine/modelSpatialRuntime.js`
  - 新增 `refreshModelSpatialRegistration`，集中执行世界矩阵更新、旧 owner 注册清理、当前碰撞体和 Mesh 支撑面重新采集/注册。
- `src/three/engine/createCampusEngine.js`
  - 引擎空间刷新入口委托给上述函数；模型替换、Transform 和状态变更沿用同一注册路径。
- `src/three/engine/modelSpatialRuntime.test.js`
  - 增加基于真实 Three.js Group/Mesh 与 CollisionWorld 的测试源码，覆盖旧墙/旧地面替换、新墙/新地面注册、清空空间声明后的旧注册清理，以及 Transform 后世界坐标边界更新。
- `PROJECT_PLAN.md`
  - 记录 P2.3 空间注册验收边界。

### 验证状态

- 本轮开始 HEAD：`2811549ec902c700b4dec7f58d5c86f06ff179b3`。
- GitHub 源码写入与回读完成后再记录最终 HEAD。
- 自动化测试、前端构建、浏览器人物通行/站立验收：本轮未执行；测试源码不等于测试通过。
- CI 状态待检查；`main` 不修改，不创建或合并 PR。


---

## 2026-11-08 — P2.3 Capability Override 与空间存档恢复回归

### 审查结论

- AI 编辑 Worker 已将当前模型的 Capability Control Document 作为 `previousDocument` 传入 `createCapabilityControlDocument`；该函数会用新 Manifest 重建 inference proposals，同时保留原 overrides、diagnostics 和扩展字段。
- 页面替换模型时将 Worker 返回的 Capability Control Document 写入新 Object3D，再由引擎替换实例；引擎不会用新 Manifest 重置该文档。
- 沙盒保存使用 `Object3D.toJSON()`；恢复使用 `ObjectLoader.parse()`，然后调用 `engine.addSandboxModel`。后者会按恢复对象当前 Manifest 重新建立空间注册。
- 当前恢复路径已有回滚逻辑：批量注册失败时移除已注册实例及其空间句柄。

### 本轮测试源码

- `capabilityControl.test.js`：新增模型 Manifest 更新后，验证 AI inference 更新、用户对门扇碰撞的 override 与 diagnostics 保留，并且 override 仍优先于模型定义。
- `modelSpatialRuntime.test.js`：新增 Object3D JSON 序列化/反序列化回归，验证恢复后碰撞体数量/边界一致、支撑面元数据一致、Mesh 引用指向恢复后的对象，且用户 override 仍被执行。
- 测试源码已写入仓库；本会话未运行 Vitest 或构建，不能标记测试通过。

### 验证边界

- GitHub 源码回读与静态检查完成后记录最终 HEAD。
- 本轮没有本地执行器或浏览器环境；未完成真实页面刷新恢复与人物通行验收。
- 不修改 `main`，不创建或合并 PR。


### P2.3 最终静态回读记录

- 本轮开始 HEAD：`87e53ac06c8df0d3239630319d5c9ef527f0889e`。
- 本轮最终代码/文档 HEAD：`395b9bbd73d570f07d233dc84104aad3d96fcd3c`。
- 已回读确认 Capability Control 测试包含“新 Manifest 更新 proposals、保留用户 override/diagnostics、override 继续覆盖新定义”的断言。
- 已回读确认空间存档测试通过 `Object3D.toJSON()` 与 `ObjectLoader.parse()` 恢复对象，再从恢复对象重建 CollisionWorld；验证碰撞边界、支撑面声明、恢复后的 Mesh 引用及 Capability Override 均保留。
- 修正测试中恢复部件的查找方式：通过遍历读取 `userData.componentId`，不把嵌套属性路径误当作 Object3D 的直接属性名。
- GitHub 静态回读通过；Vitest、前端构建、浏览器保存/刷新/恢复和人物实际碰撞验收均未执行。
- CI 状态需以最新 HEAD 的状态接口为准；没有可用成功检查时不得标记通过。
- `main` 仍为 `608a9f2c1f739cd581acb833b1e70410672e258b`；未修改 main，未创建或合并 PR。


---

## 2026-11-08 — P2.4 通用交互 Action Runtime（源码修改）

### 开发基线

- 分支：`feat/world-sandbox-conversational-model-editor`
- 本轮开始审查基线：`6d4cad733ff1a554dd8e8dbfa0f84e72f3b5f98d`
- 已重新读取项目计划、进度、交互检测、世界状态 Runtime、引擎、页面和模型生成/编辑 Prompt。
- 现状：近邻检测已有；页面只执行 `toggle-state`，没有通用动作执行层。

### 实际改动

- 新增 `src/three/engine/sandboxActionRuntime.js`：实现 `toggle`（兼容 `toggle-state`）、`set`、`rotate`、`translate`；按稳定部件 ID 解析目标；拒绝未知动作、非法向量和缺失目标。
- `createCampusEngine.js` 新增 `applySandboxModelInteraction`：统一执行动作；状态动作委托现有 `setSandboxModelState`，Transform 动作刷新世界矩阵、碰撞/支撑注册和阴影。
- `WorldSandboxMvp.vue` 页面层不再专门解释 `toggle-state`，统一调用引擎动作入口。
- 模型生成/编辑 Prompt 增加四类受控动作的数据声明格式。
- 新增 `src/three/engine/sandboxActionRuntime.test.js`，覆盖旧协议兼容、状态 set、局部 rotate/translate、同模型显式目标、未知动作和非法输入。

### 已实现能力与限制

- 兼容性回归：保留旧墙壁开关通过 `targetId` 控制另一模型实例的状态路径；`set` 只接受可序列化原始值，拒绝对象和非有限数字。

- 源码链路为“近邻检测 → 动作声明 → Action Runtime → 实例状态/部件 Transform → 视觉与空间刷新”。
- `set` 当前只写入模型实例 `worldState`；只有已有 stateBinding 对应受支持属性时才会产生视觉效果。
- `rotate/translate` 是局部 Transform 增量，不包含动画插值、连续扫掠碰撞或跨模型事务。
- P2.4 后续 P2.5 已接入 `enter/exit` 同模型内部空间过渡；`pickup/drop` 尚未实现。
- 交互配置位于部件 `userData.interactionConfig`，Object3D JSON 可保存；端到端存档恢复仍需实测。

### 验证状态

- GitHub 源码写入与回读后记录最终 HEAD。
- 本会话没有本地仓库执行器/浏览器；Vitest、前端构建、AI 实际生成、玩家按 E、浏览器存档恢复均未执行。
- CI 以最终 HEAD 查询为准；无成功状态检查不得标记通过。
- 不修改 `main`，不创建或合并 PR。


---

## 2026-11-08 — P2.5 同模型内部空间入场与退出（源码修改）

### 本轮目标

把模型 Manifest 的 interior 声明接入玩家交互 Runtime。进入模型自身生成的内部空间，不复用校园建筑专用室内模板，不为模型类别编写专用规则。

### 实际改动

- 新增 `src/three/engine/sandboxInteriorRuntime.js`：
  - 按 `entryPointId` 查找 `capabilities.interior.entryPoints`。
  - 使用稳定 `targetPartId` 定位真实 Object3D。
  - 将部件局部地面坐标经完整世界矩阵变换为世界坐标。
  - 缺少声明、目标部件或非有限坐标时失败关闭；入口点若与当前 XZ 碰撞障碍重叠则拒绝传送。
- `sandboxActionRuntime.js` 增加 `enter` 与 `exit` 动作协议；enter 必须引用模型已声明的入口 ID。
- `createCampusEngine.js` 增加同模型内部空间过渡：
  - 进入前保存玩家世界坐标与相机模式。
  - 进入时通过 InputController 传送入口将玩家放到声明的内部地面点，角色眼高按当前 1.7 世界单位偏移，同时清理残留垂直速度、导航路径和按键状态。
  - 保留进入时第一/第三人称模式。
  - exit 恢复进入前位置、第一/第三人称模式及相机 yaw/pitch/距离参数。
  - 不创建独立室内副本，不隐藏外部场景或模型外壳。
- AI 新建/编辑 Prompt 增加统一 entryPoints、enter/exit 和内部 walkable surface 声明格式。
- 新增坐标解析、Action 协议测试源码。

### 能力边界

- 当前只实现单层内部空间的入场/退出；多楼层、楼梯、电梯、房间导航和门锁条件尚未接入。
- 入口动作是定位过渡，不会自动生成内部几何；AI 必须实际生成内部结构、出口标记、楼板表面与墙体碰撞声明。
- 是否能顺利走进门洞取决于门扇状态和碰撞声明；入口传送不等于物理穿墙。
- 角色内部移动继续使用现有 grounded movement / collision / walkable surface Runtime。

### 验证状态

- GitHub 源码写入与回读后记录最终 HEAD。
- 本会话无本地执行器/浏览器；Vitest、前端构建、真实模型生成、穿门、室内移动和退出均未执行。
- 不修改 `main`，不创建或合并 PR。


---

## 2026-11-08 — P2.6 AI 模型视觉质量检测与有限自动修正

### 本轮目标

在不重构现有生成/编辑链路的前提下，为新建模型补上“真实渲染截图 → AI 视觉检测 → 定向修正 → 重新渲染复检”的闭环。

### 实际改动

- `server/src/modules/assets/image-generation.service.ts`
  - 新增 `inspectProceduralModelVisualQuality`，复用现有 `VISION_API_KEY`、`VISION_MODEL` 和兼容 Chat Completions 接口。
  - 同时输入原始描述、可选参考图、最多五张 Three.js 实际渲染截图和几何诊断证据。
  - 输出归一化质检报告：评分、通过状态、摘要、严重程度、稳定部件 ID、可观察问题和修复指令。
  - 校验截图格式/大小；参考图上限与原生成接口保持一致。
- `server/src/modules/assets/image-generation.controller.ts`
  - 新增 `POST /assets/ai-image/inspect-procedural-object`。
- `src/components/ProceduralModelEditor.vue`
  - 新增四视角截图能力（正面、侧面、顶部、等轴）；通过独立 WebGL RenderTarget 读取像素，生成压缩 JPEG 数据 URL。
  - 在编辑面板显示最近一次视觉质检评分、状态、摘要和问题清单。
- `src/components/WorldSandboxMvp.vue`
  - 新模型 Worker 构建完成后，自动触发视觉检测。
  - 对有明确修复指令的 critical/major 问题，复用现有 AI 微调接口做局部优先修正；最多两轮，修正后重新截图复检。
  - 保留最新质检报告；质检失败不丢弃模型，明确显示未完成/未通过状态。
- `server/src/modules/assets/image-generation.service.spec.ts`
  - 新增视觉检查输入实际多视角图片、归一化通过报告，以及缺少截图时拒绝请求的测试源码。

### 当前边界

- 本轮自动质检接入新建模型生成流程；用户后续手动 AI 编辑/参数调整后的自动复检尚未接入。
- 质检依赖配置的视觉模型实际支持图像输入；服务不可用时模型仍保留，但质检状态为未完成。
- 自动修正只处理明确的 critical/major 问题，最多两轮；轻微问题仅报告，不自动改动。
- 视觉检测不证明碰撞、站立、可穿越、门状态、室内导航或交互功能正确。

### 验证状态

- GitHub 源码写入与回读：待本轮最终静态核对后记录。
- 已新增服务测试源码；**尚未运行 Jest、服务端构建、前端构建或浏览器真实渲染验收**。
- 目前不能声称视觉质检端到端通过；需要本地启动前后端，使用支持图像输入的 `VISION_MODEL` 实际生成模型，确认四视角截图非空、视觉接口可识别图片、修正后复检结果及失败回退。
- 未修改 `main`，未创建或合并 PR。

---

## 2026-11-08 — 保存模型后实例 ID 冲突与 Three.js Vue Proxy 修复

### 问题定位

- createCampusEngine.js 从持久化实例 ID 恢复序号时，正则错误地使用了双反斜杠，导致 sandbox_1 等 ID 的数字部分无法匹配；恢复已有实例后，新建模型可能再次分配 sandbox_1，触发重复 ID 异常。
- WorldSandboxMvp.vue 使用深层 ref(null) 保存正在编辑的 Three.js Object3D。模型对象被 Vue Proxy 包装后，Three.js 渲染访问只读且不可配置的矩阵属性时可能违反 Proxy 不变量，导致渲染循环持续报错。

### 实际修改

- src/three/engine/createCampusEngine.js：修正实例序号正则为单个转义的数字匹配；保留重复 ID 防护，不允许静默覆盖已有实例。
- src/components/WorldSandboxMvp.vue：将 editingModel 改为 shallowRef(null)，使 Three.js 对象保持原始引用，避免 Vue 深层代理。

### 验证边界

- GitHub 源码写入后已回读确认：序号正则可匹配数字，编辑模型状态使用 shallowRef。
- 本轮未运行前端构建、Vitest 或浏览器保存回归；不能据此宣称页面卡死问题已端到端验证通过。
- 需要本地验证：刷新恢复已有模型后再新建并保存；编辑已有模型并保存；连续渲染期间确认不再出现 modelViewMatrix Proxy 错误。

---

## 2026-11-08 — P2.7 玩家开关灯最小交互闭环（源码修改）

### 实施前验收场景

1. 在 /world-sandbox-mvp 创建“开关灯交互演示”，初始灯泡发光，实际 THREE.PointLight.intensity 为 2.2。
2. 玩家进入墙壁开关 4.8 世界单位的 XZ 交互半径后，页面显示声明的交互提示；离开范围后提示消失。
3. 玩家按 E 后，Interaction 将声明式 toggle 动作发送给引擎；通过开关配置中的稳定 targetId 定位灯具实例，将该实例 worldState.enabled 在 true/false 间切换。
4. State 更新后，Lighting Runtime 将真实 PointLight 的 intensity 在 2.2/0 之间切换；World State Runtime 同步切换灯泡 emissiveIntensity。再次按 E 可恢复。
5. 开关部件 componentId、灯具实例 ID、跨对象 targetId 和灯具 worldState 随 Object3D 存档恢复；不依赖 Mesh.name。
6. 未知目标、缺失状态键或非法光照强度不得产生无效光照更新。

### 实际修改

- 新增 src/three/engine/sandboxLightingRuntime.js：只处理实际 THREE.Light 对象的声明式 intensity 绑定；缺失状态、非法强度和非 Light 对象安全忽略。
- worldStateRuntime.js 不再接管真实 Light 的 intensity；普通对象原有 intensity 绑定保持兼容，避免通用状态 Runtime 与 Lighting Runtime 双重写入。
- createCampusEngine.js 在模型注册、模型替换和状态更新三个入口调用 Lighting Runtime；状态仍由模型实例 worldState 持有。
- WorldSandboxMvp.vue 演示灯具增加稳定部件 ID；PointLight 使用 intensity 状态绑定；墙壁开关按钮部件声明 toggle、稳定灯具实例 targetId、交互半径与提示/结果文案。
- 新增 Lighting Runtime 测试，覆盖真实 PointLight 亮灭、通用状态 Runtime 不抢写 Light，以及缺失状态/非法强度失败关闭。
- 扩展 Interaction Detection 测试，覆盖近距离目标解析、稳定实例/部件 ID、远距离不触发，以及跨对象 targetId 的 Object3D 序列化保留。
- 扩展 Action Runtime 测试，覆盖当前 toggle 协议；旧 toggle-state 兼容测试保留。
- 更新模型生成/编辑 Prompt：同模型玩家开关使用 toggle + worldState；实际 THREE.Light 使用 intensity stateBinding，灯泡使用 emissiveIntensity；跨实例 targetId 只能使用沙盒放置后提供的真实 sandboxModelId，不允许 AI 根据名称猜测。
- Lighting Runtime 测试增加“近邻检测 → 目标实例 → toggle Action → worldState → PointLight/灯泡视觉”双向切换用例。

### 静态核验与验证边界

- 开始功能分支 HEAD：a98bdef1f35372a3eb128530b085080771271f41；所有写入均显式指定 feat/world-sandbox-conversational-model-editor，每次写入后核验分支 HEAD 与该次提交一致。
- GitHub 源码写入与回读：已完成；每次提交均核验分支 HEAD 与写入提交一致。
- Vitest、前端构建和浏览器真实按 E/灯光变化/存档恢复：本轮执行环境没有仓库工作区、Node 依赖和浏览器，尚未执行，不标记通过。GitHub Combined Status 返回 0 项检查；当前可用的 workflow-run 查询仅返回 PR 触发运行且结果为空，因此 push 触发 CI 是否完成无法确认，不标记通过。
- main 保持 608a9f2c1f739cd581acb833b1e70410672e258b；未修改或合并 main，未创建 PR。

---

## 2026-11-09 — 模型 Transform 拖拽期间锁定相机输入

### 问题

- 总览模式下，Three.js TransformControls 与 CameraRig 的 OrbitControls 共用同一个渲染 DOM。原有 dragging-changed 只暂停角色输入，没有暂停 OrbitControls，因此拖拽模型 Gizmo 时相机仍可能响应同一指针手势。
- 即使关闭相机输入，OrbitControls 的阻尼更新仍可能在拖拽期间继续应用残余惯性。

### 实际修改

- src/three/camera/CameraRig.js：新增 setOrbitInteractionEnabled(enabled)，集中控制总览相机是否接受用户输入；模型拖拽期间设置 orbitInteractionSuppressed，并跳过 OrbitControls.update()，同时暂停残余阻尼移动。
- src/three/engine/createCampusEngine.js：TransformControls 的 dragging-changed 事件同时锁定/恢复相机输入和角色移动输入；拖拽结束后仅在总览模式恢复 OrbitControls。
- 不改变模型 Transform 更新、碰撞体/支撑面刷新和空白区域相机操控逻辑。

### 验证边界

- GitHub 源码写入后回读确认 CameraRig 锁定方法、阻尼暂停分支和 TransformControls 事件联动均存在。
- 本轮未运行前端构建、单元测试或浏览器实测；仍需验证 2.5D/3D 总览拖拽模型时镜头静止、拖拽结束后空白区域相机操作恢复，以及角色模式下模型 Gizmo 操作不触发角色移动。


---

## 2026-11-09 — 沙盒模型分层选址与精确落位（首轮实现）

### 产品交互决策

用户确认模型移动应采用上帝视角的逐级空间选址，而不是直接拖动模型本体：
- 先展示完整沙盒，选择一个大致区域。
- 点击区域后镜头以该点为中心逐级缩小范围；大场景可重复选择子区域。
- 当视野范围与模型真实占地尺寸达到比例阈值后，进入精确落位。
- 精确阶段鼠标移动更新真实尺寸模型预览，点击地面锁定候选位置；显式确认后才提交。
- 提交后进入 TransformControls 精调；重新选址仍走同一套分层流程。

### 本轮实际修改

- `src/three/engine/createCampusEngine.js`
  - 新增独立的 `sandboxPlacementState`，不复用旧 generatedAssets 的 `placementState`。
  - 新增 `beginSandboxModelPlacement`、`confirmSandboxModelPlacement`、`cancelSandboxModelPlacement`。
  - 放置开始时按 RPG 沙盒边界聚焦全局视图；点击地面后根据当前相机真实视野尺度逐级聚焦。
  - 根据模型真实世界包围盒生成占地预览；进入精确阶段后模型随鼠标预览，点击地面选定候选点。
  - 新模型只有确认后才进入 `sandboxModels` 实例集合；已有模型取消时恢复原位置、旋转和缩放。
  - 放置输入在 DOM 捕获阶段接管左键，避免同一左键手势进入 OrbitControls、TransformControls 和旧资产放置监听。
  - 两套放置状态互斥；旧 generatedAssets 放置语义保持独立。
  - 选中模型进入精调时暂停 OrbitControls；新增 `browse` 模式，允许显式切换回镜头浏览。
- `src/components/WorldSandboxMvp.vue`
  - AI 草稿模型保存后先进入选址，不会未经确认直接注册/写入存档。
  - 已有模型增加“重新选址”入口。
  - 增加区域选择/精确落位状态提示、确认和取消操作。
  - 落位确认后更新实例列表并触发沙盒存档；增加“浏览镜头”与精调模式切换。
- `PROJECT_PLAN.md`
  - 新增分层选址决策、交互所有权、动态尺度规则和当前边界。

### 当前明确限制

- 本轮地面落点使用水平地面平面；没有实现斜坡、台阶、平台的表面吸附。
- 当前边界约束使用样板沙盒的世界包络；尚未完成碰撞重叠预检、湖面/障碍物可放置语义和复杂地形贴合。
- 当前视野缩放阈值采用模型最大水平尺寸的 8 倍，最多五级聚焦；需要结合真实大沙盒与不同尺寸模型继续调参。
- 新模型预览使用真实模型和地面占地轮廓；尚未增加模型半透明材质 Ghost、吸附网格或碰撞风险热区。

### 本轮提交与验证边界

- 代码与文档均写入 `feat/world-sandbox-conversational-model-editor`；未修改 `main`，未创建或合并 PR。
- 本轮远程提交序列：
  - `52d5ac6cd1d2b644fdcda7d65c6881d96c541646` — 引擎分层放置状态与 API。
  - `1478938891f90d1a8a2e2ab0f7b2bb1e257fc496` — 页面放置流程接入。
  - `62fb9e48d3b6f0923ca4e7f0cbd7f38d88454765` — 放置输入所有权与旧流程互斥。
  - `c621bb2d04efee80562cf4b5e47d34208469b4f8` — 放置面板样式与操作提示。
  - `d327a9492e722d85d4677b8323685adde95397ba` — 项目计划记录。
  - `cedaa437ebb4fe0ee9f566305b306faae11a84ad` — 按当前相机实际视野尺度计算逐级聚焦。
  - `dcdef446d73bdfd0011358abb09c8f288fcd49cc` — 保留区域选择阶段的右键/中键相机平移，并拒绝占地尺寸大于沙盒边界的模型启动放置。
  - `e194a06e7664e13e367411bc0c97a4e32f07e79c` — 按当前放置尺度动态调整 3D OrbitControls 的最小/最大距离，避免默认最小距离阻止镜头逐级靠近小模型或无法适配大沙盒。
  - `5e6e3db5e9dfc6566aac5bb931f5a8ef0c7dbc5d`、`90162ccec736bb98af2cd076eaa9e0b9f7660ac8` — 放置期间隔离模型选择/删除/复制生命周期，并允许启动新模型放置时清空旧选择。
  - `47bc4dd9036133925f45429203780743626d1872` — 页面禁用放置期间会与当前实例冲突的复制、删除和列表选择操作。
  - `27a7af1aa01dbf1a94a81c815ee957440d9995f7` — 引擎层阻止放置期间对同一实例执行外部 Transform 或模型替换。
  - `1f5c8fa971b2a82ed777204c957ed77cecaf540c` — 模型落位时按沙盒地面顶面校准根节点高度，避免模型底部埋入地面。
- 已完成 GitHub 源码写入与回读；本轮尚未运行 Vitest、前端构建或浏览器交互验收。不能标记功能端到端通过。
- 本地工作区尚未更新；需要用户在对应功能分支拉取后进行实际运行验证。


---

## 2026-11-09 — 沙盒对象选择与操作入口分离

### 产品交互决策

- 单击模型只负责选中；单击空白地面清除选择。
- 双击不再触发模型编辑器；编辑、重新选址、精细调整、复制和删除均由左侧对象上下文面板中的显式按钮触发。
- 选中对象后显示轻量轮廓高亮；不自动挂载 TransformControls，普通选择状态仍可操作镜头。
- 点击“精细调整”后才挂载 Gizmo；位置/旋转/缩放属于精调子模式，“完成调整”恢复镜头控制。
- 无程序化源码的对象禁用“编辑模型”。

### 实际修改

- `src/components/WorldSandboxMvp.vue`
  - 移除双击打开编辑器的回调。
  - 左侧面板改为上下文操作区：重新选址、精细调整、编辑模型、复制、删除。
  - 精调子工具仅在进入精调后显示；编辑按钮按对象是否具有程序化源码启用/禁用。
  - 对象列表按稳定实例 ID 选择，不依赖页面辅助 Map 是否已恢复。
  - 选中回调直接从引擎实例注册表取得真实 Object3D，避免恢复对象时辅助 Map 未同步造成选择丢失。
- `src/three/engine/createCampusEngine.js`
  - 移除双击业务事件和监听器。
  - 普通单击仅选中/取消选中；选中时不自动 attach TransformControls，也不锁定 OrbitControls。
  - 增加 BoxHelper 轮廓高亮，选中对象后可见；精调变换期间同步更新轮廓。
  - 选址期间忽略普通对象选择输入，避免放置与选择竞争同一手势。
  - 替换/销毁模型时同步刷新或释放轮廓资源。

### 提交记录

- `4780708de58f12aab64734e918d8a2f273c1e097` — 页面对象上下文操作与显式编辑入口。
- `bc9ff1b462875d247cb280e4239416b02d756082` — 引擎单击选择与双击行为解绑。
- `b02e03060898416b5b08d9c2da06c68e372dbad0` — 对象列表按稳定实例 ID 选择。
- `e828ad03138fdaff284613824340f7ecaf5502f0` — 选中轮廓高亮与精调状态分离。

### 验证边界

- GitHub 源码已回读；页面与引擎中已无双击编辑回调/监听器，左侧显式操作入口、稳定 ID 选择和 BoxHelper 选择高亮均已确认存在。
- 尚未运行前端构建、Vitest 或浏览器交互验收；不能标记为端到端通过。
- 本地工作区尚未自动更新；用户需在功能分支拉取后验证单击/空白取消/双击无业务动作/显式精调/镜头恢复/编辑按钮启用条件。
- 未修改 `main`，未创建或合并 PR。


### 精调相机锁定补充

- `src/three/engine/createCampusEngine.js`：修正 TransformControls 的 `dragging-changed` 恢复条件。只要 Gizmo 仍挂载在选中对象上，OrbitControls 就持续保持禁用；只有显式点击“完成调整”执行 detach 后才恢复镜头输入。
- 提交：`019e09078dd5de0e4e95d7898b06facc8d4dfe90`。
- 该补充已完成 GitHub 源码回读；仍未运行浏览器拖拽回归。


---

## 2026-11-09 — 全景选址、占地预览与单任务左侧面板

### 交互修正

用户反馈上一版虽然提供了确认按钮，但全景点击仍会逐级聚焦，模型预览又以完整实体外观直接贴地显示，导致“选候选位置”和“正式落地”的状态边界不清楚；左侧面板也仍然堆叠着非当前操作选项。本轮按全景选址重新收敛流程。

### 实际修改

- `src/three/engine/createCampusEngine.js`
  - 移除地面点击触发的逐级镜头聚焦；进入重新选址后直接保持沙盒 overview。
  - 鼠标移动只更新模型预览和最大水平占地投影；模型使用半透明 Ghost 材质，地面同时显示绿色填充区域与边界轮廓。
  - 单击地面只锁定候选位置，新增 `candidateLocked` 状态；正式确认必须同时满足有效预览和候选锁定。
  - 锁定后鼠标移动不再改变候选位置；点击“重新选择”解除锁定后才恢复跟随预览。
  - 确认/取消时恢复原始材质、相机模式和角色输入模式；取消已有模型恢复原 Transform，取消新模型释放临时模型。
  - 保留沙盒世界边界约束；占地轮廓当前是模型世界 AABB 的 XZ 水平投影，不宣称为精确底部拓扑或碰撞可放置性检测。
- `src/components/WorldSandboxMvp.vue`
  - 左侧面板按状态互斥：重新选址时只显示选址操作；选中模型时只显示该模型操作；精细调整时只显示位置/旋转/缩放；未选中对象时才显示建模、对象列表、环境和任务面板。
  - 选址面板显示占地宽深、候选坐标、锁定状态，以及“确认落地 / 重新选择 / 取消”。
  - 选址期间禁用顶部“保存沙盒”，避免保存临时预览位置。
  - 更新操作提示，移除逐级聚焦的旧文案。

### 相关提交

- `4f0e5844ad423541b3cfbcb0b5c3500cbdf2fcdc` — 全景预览、候选锁定与 Ghost 占地范围。
- `6fe9ab36b07b0a2c74c550b5bb488b2f2b2cf196` — 左侧面板切换为单任务上下文模式。
- `2a1ce2a168b3f099e1fcf6c0e838ec333fd67cd4` — 占地信息与操作面板样式。
- `684f67004852399be02b2b23e957d3c188e1f117` — 确认/取消后恢复原相机与输入模式。
- `f7d3d2d6d8fd2c49a1885afb2f1bdbdab3e427ee` — 移除不再使用的分层缩放辅助函数。
- `3872d8ff181cad1724d0c191cb2360d40f262415` — 仅在候选锁定时显示候选坐标，避免重新选择期间显示旧坐标。

- 后续资源清理补丁：`926d3113551eb69d8653fbfb65aa37cb7938f753` — 释放生成占地边界线时使用的临时 PlaneGeometry，避免额外几何资源泄漏。

### 验证边界

- 已完成远程源码回读与静态条件核对：不存在地面点击逐级聚焦分支；确认逻辑要求 `candidateLocked`；选址/选中/精调三种面板分支互斥；选址期间保存按钮禁用。
- 尚未运行前端构建、Vitest 或浏览器交互测试；Ghost 透明度、占地轮廓可见性、overview 构图和相机恢复仍需本地实际验收。
- 未修改 `main`，未创建或合并 PR。


## 2026-11-09 — MVP 改为空白世界并增加落地冲突检测

- `WorldSandboxMvp.vue` 默认场景切换为 `blank-sandbox`，移除 MVP 对早期 RPG 校园样板的默认依赖。
- 新增 `createBlankSandboxScene.js`：只创建空白地面、远景地面、世界边界和人物出生/世界尺寸元数据；不包含建筑、道路、树木、水体、桥梁、设施或装饰。
- 保留原 `createRpgSampleScene.js` 和正式校园地图代码，不对 MVP 之外的地图页面做删除或迁移。
- 模型选址加入现有沙盒模型 AABB 重叠检测和 CollisionWorld 已登记障碍 broad-phase 检测；冲突时占地预览变红、左侧面板显示冲突名称并禁用确认。
- 确认落地入口再次检测冲突，防止候选锁定后场景变化导致无效落地；移动已有模型时排除自身。
- 精度限制：当前仍以世界 AABB 为主，CollisionWorld 多边形按包围范围保守检测；不等于精确网格相交或完整地形适配。
- 验证边界：仅完成 GitHub 远程代码写入；未运行用户本地构建、Vitest/Jest 或浏览器端穿模回归，不宣称通过。

---

## 2026-11-09 — 连续世界与四方向区块扩建

### 产品决策

- 沙盒是单一连续世界，可按需向四个方向扩建。
- 不强制校园区、生活区、商业区等功能分区；区域分组仅作为用户可选的后续组织能力。
- 扩建只增加世界空间，不缩放、不平移已有对象。

### 实际修改

- src/three/world/campus/createBlankSandboxScene.js：将基础地面组织为独立区块；初始区块尺寸为 54 × 42 世界单位。新增四方向扩建，每次增加目标方向完整边缘的一排区块；连续扩建不会重复创建已存在区块。更新统一 walkableBounds、世界尺寸、中心点和外围边界；提供世界区块状态导出/恢复。
- src/three/engine/createCampusEngine.js：新增 getSandboxWorldState / expandSandboxWorld / restoreSandboxWorld Runtime API。扩建后同步人物移动与 CollisionWorld 的边界引用，并放宽 overview 相机最大距离。reset view 使用扩建后的世界范围。
- src/components/WorldSandboxMvp.vue：无选中模型时显示世界尺寸和四方向扩建入口。模型选址期间也可以直接扩建，不必退出当前操作；扩建后继续当前选址流程。存档升级到 version 4，持久化世界区块；恢复时先还原区块，再还原模型。旧版 1–3 存档兼容。
- 本轮没有实现强制区域分类，也没有实现区域分组 UI；分组保留为未来可选管理能力。

### 提交记录

- 2e0819d1a329609a56d7c608a6eb4f9c893bec97 — 初始可扩建区块地面。
- ad9c59f0a0ddfc9cc8233e6cca4f2be415d88247 — 引擎暴露世界扩建与恢复 API。
- ebf13e7146f34d76faf1ecb12619bba100ae3f4a — 修正为扩建完整边缘区块行/列。
- c53dedc9b7fac321c18f02598754b826f4a8621e — 前端扩建入口与世界状态存档。
- ef612a0554e4f794bbf5d438a915ff57adc1a369 — 允许模型选址期间扩建世界。

### 验证边界

- 已完成远程源码写入与回读；已核对世界区块状态写入存档、恢复顺序、四方向入口和扩建时边界同步逻辑。
- 尚未运行前端构建、Vitest/Jest 或浏览器交互测试；不能宣称编译通过或端到端验收通过。
- 需要重点实测：连续扩建四方向区块无缝性、玩家进入新区域、overview 相机适配、选址扩建后继续预览、保存刷新后世界与模型坐标保持一致。
- `18e57b5e7ce662be114717247e764fac364ca294` — 恢复世界区块时校验坐标范围，并同步恢复后的区块索引，避免无效存档坐标污染世界边界。

### 2026-11-09 扩建与存档回归补强

- 扩建增加 2,500 个区块的硬上限，并在批量扩建前预检目标尺寸，避免达到上限时只扩建一部分却未更新边界。
- 世界恢复校验存档版本、区块尺寸、区块数量、坐标范围和矩形连续性；无效状态返回失败，不静默吞掉不兼容存档。
- 前端恢复世界失败时明确报错，避免继续恢复模型并造成错误的空间状态。
- 新增 createBlankSandboxScene.test.js，覆盖四方向扩建、连续多层扩建、边界计算、世界状态往返恢复、非法存档拒绝和扩建上限原子性。
- 测试代码已写入远程分支，但尚未执行 vitest；当前没有测试通过证据。

---

## 2026-11-09 — 管理模式拆分与外围地块回收

### 本轮目标

将沙盒全局管理与模型实例管理分离，并提供安全回收闲置外围区块的能力；不引入内部空洞或新的世界数据结构。

### 实际修改

- src/components/WorldSandboxMvp.vue：新增“沙盒管理 / 模型管理”一级切换。沙盒管理展示世界空间、扩建/回收、场景信息和现有环境控制；模型管理展示模型列表、选择与变换操作、AI 创建/编辑和快捷操作。保留页头保存入口。
- src/three/world/campus/createBlankSandboxScene.js：新增 removeWorldEdge(direction)，仅移除指定方向最外侧完整区块行/列；释放地面几何和材质，重算世界边界与区块索引；拒绝移除包含 (0, 0) 的边缘，并阻止世界缩减为零区块。
- src/three/engine/createCampusEngine.js：新增 removeSandboxWorldEdge(direction)。回收前检查玩家位置、模型世界包围盒和 CollisionWorld 已登记碰撞区域；存在占用时返回阻塞原因。回收成功后同步 CollisionWorld、InputController、相机范围和世界状态回调。
- src/three/world/campus/createBlankSandboxScene.test.js：新增外围区块回收、锚点/最小尺寸限制、回收后存档往返恢复测试。
- docs/world-sandbox-mvp/PROJECT_PLAN.md：记录管理模式职责、回收边界和验收标准。
- 沙盒存档结构保持 version 4；区块状态继续使用既有 world.chunks，不需要迁移。

### 远程提交

- 260fe6f18d7200ec92346b937f5ad00fc7ab2102 — 场景层外围区块回收。
- a355e7bf8337a1ee1867726c66e906b3cd993d4e — 引擎占用检测与回收 API。
- 033ff5f27780ff5dec3289a32aa0068314478cbe — 前端管理模式与回收入口。
- a7febfeb1ce96743963b85bfb8affa8e19a15b4b — 区块回收单元测试。
- 3af2e4347540be0ddfe4c7b7150097f6e094348f — 项目计划更新。

### 验证状态

- 已完成目标分支文件写入和回读；远程源码中可确认新增 API、管理入口和测试用例存在。
- 本轮没有本地仓库执行环境；Vitest、前端构建和浏览器交互均未执行，**待验证**。
- 尚需重点验证：玩家/模型占用拦截、跨区块模型包围盒、四方向连续回收、回收后保存刷新、管理模式切换时 Gizmo/选中状态保持。
- 远程提交按功能分支写入；未执行 PR 合并。

### 本地验证建议

1. npm test -- --run src/three/world/campus/createBlankSandboxScene.test.js（按项目实际 test script 调整参数）。
2. npm run build。
3. 在 /world-sandbox-mvp 中分别扩建四个方向，移动人物/模型到边缘后尝试回收，确认被拦截；移走后回收并保存刷新。
4. 在模型选中和精细调整状态下切换“沙盒管理 / 模型管理”，确认选择与 Transform Gizmo 不丢失。


### 本轮后续修正

- 5ff365bf39fed4997f27202fd783396610e45376 — 在已有模型选中时仍保留“创建新模型”入口，避免模型管理模式因选中状态隐藏创建能力。
- 9138579179a20072281e0eb3376a2d0020045a04 — 将模型占用判断改为直接比较世界 XZ 包围范围，避免构造无限高度的临时 Box3。
- 上述修正已写入目标分支并回读；仍未执行本地构建、Vitest 或浏览器验收。


---

## 2026-11-09 — 将外围整排回收纠正为任意单块回收

### 需求纠正

上一轮将“回收某一块地块”错误实现为外围整行/整列回收。该实现已被单块回收方案替换，不再保留方向回收入口。

### 本轮远程修改

- createBlankSandboxScene.js：新增 removeWorldChunk(x, z)，支持回收任意指定区块；保留初始中心锚点和至少一个区块。存档恢复允许稀疏区块集合；world.chunks 记录实际存在区块。
- CollisionWorld.js：增加 walkableRegions，人物移动按真实区块并集判定；相邻区块接缝连续，缺失区块不可进入。
- createCampusEngine.js：新增 removeSandboxWorldChunk(x, z)；检查玩家、模型世界包围盒、障碍物和可站立支撑面占用；扩建/恢复/初始化后同步可行走区块集合。
- WorldSandboxMvp.vue：以可选择的区块网格替换四方向回收按钮，选中单块后执行回收；中心锚点不可选。
- 测试：替换外围回收测试为任意内部单块回收、锚点保护、稀疏存档恢复、扩建不补回内部洞；增加 CollisionWorld 区块接缝和洞口阻挡测试。

### 验证状态

- 已写入目标功能分支并回读相关文件；未运行 Vitest、构建或浏览器验收。
- 必须本地验证：模型跨区块占用拦截、人物占用拦截、可站立面/碰撞区域拦截、内部洞口边缘移动阻挡、保存刷新、扩建不覆盖内部洞。
- 视觉远景地面目前仍是独立 horizon 平面；需重点确认回收区块后洞口视觉层次符合预期。
- 未修改 main，未创建或合并 PR。


### 后续修正

- createBlankSandboxScene.js 已移除无限延伸的 horizon fallback 地面，避免回收区块后仍被下层大平面视觉填满；实际洞口边缘和远景效果仍待浏览器验收。
- CollisionWorld.test.js 增加从有效地块向缺失地块移动时的边缘阻挡测试。

- createCampusEngine.js 另增加放置占地校验：模型 footprint 覆盖到任何已回收区块时标记为阻塞，避免回收后又把新模型放进洞内。


## 2026-11-09 — 地块管理交互与占用反馈优化

- WorldSandboxMvp.vue 将坐标网格替换为 SVG 空间布局图：区块按真实相对坐标呈现，缺失区块留空；支持缩放和滚动查看大范围世界，坐标仅在选中地块详情中展示。
- 回收失败时显示明确错误状态和具体原因；占用拦截会逐项列出玩家、模型或场景碰撞/支撑对象名称，不再只写入通用消息。
- 回收成功后显示成功状态，保留未保存提示；切换地块会清除旧回收反馈，避免反馈与当前选择错位。
- 本轮仅完成远程代码更新与回读，未运行本地构建、测试或浏览器验收。


## 2026-11-09 — 地块管理升级为独立全景空间画布

### 产品交互调整

- 地块管理从沙盒管理侧栏中独立出来，增加一级入口“地块管理”；进入后以全屏俯视空间画布呈现所有现存区块和缺失区域。
- 支持滚轮缩放、缩放按钮、自动适应全景、画布空白处拖拽平移、Shift 拖框选择，以及 Ctrl / Cmd / Shift 点击多选；提供全选和清空选择。
- 批量回收逐块调用既有 `removeSandboxWorldChunk` 安全校验：成功地块立即移除；锚点、被占用或其他校验失败的地块保留，并汇总失败原因；不做无差别整批删除。
- 保留既有世界区块数据、占用检测、稀疏区块和存档结构；不修改沙盒底层空间模型。

### 本轮修改文件

- `src/components/WorldSandboxMvp.vue`：独立全景管理界面、平移缩放、多选、批量回收与结果反馈。
- `docs/world-sandbox-mvp/PROGRESS.md`：记录本轮产品决策与验证边界。

### 验证边界

- 已写入 GitHub 功能分支；尚未运行本地 Vue 编译、前端构建、单元测试或浏览器交互验收。
- 重点待验：大量区块下全景定位与缩放、拖拽平移手感、Ctrl/Shift 多选、批量回收部分成功时世界状态同步、回收后保存刷新。


## 2026-11-09 — 地块管理改为沙盒场景内直接选取

### 需求纠正

独立俯视 SVG 地块图无法同时呈现地块上真实模型/物体，不适合作为批量回收的主要工作界面。本轮撤销独立全景图交互，改为直接在 Three.js 沙盒场景中选取地块。

### 实际修改

- `createBlankSandboxScene.js`：为真实地面区块增加管理态边界和选中覆盖层；覆盖层位于地面上方，不替换地面、不隐藏场景模型，退出管理模式时隐藏。
- `createCampusEngine.js`：新增地块管理开关和选择 API；管理模式下通过相机射线与地面平面求交得到世界坐标，再映射到真实区块。即使模型遮挡地面点击位置，也能选择其下方区块；Ctrl / Cmd / Shift 点击支持多选。管理模式禁用角色移动，保留当前 3D 场景和镜头。
- `WorldSandboxMvp.vue`：移除独立 SVG 全景画布，改为沙盒场景内地块高亮和轻量操作面板；显示选择坐标、批量回收结果。场景中的模型和物体始终保持可见。
- 批量回收继续逐块执行既有安全校验；有占用的地块不会被强制删除。

### 验证边界

- 已写入远程功能分支并进行源码回读；未运行本地构建、单元测试或浏览器验收。
- 重点验证：第三人称视角点击地块、模型遮挡时选择其下方地块、修饰键多选、选中覆盖层不遮挡模型、退出管理恢复角色移动、占用拦截提示。


## 2026-11-09 — 沙盒构建视角与人物探索视角协调

### 需求修正

地块回收已可用，但原总览镜头存在中心点固定、缩放范围不足和 2.5D 旋转受限的问题。沙盒构建需要观察整个动态世界，而人物探索需要独立的跟随镜头。

### 实际修改

- `CameraRig.js`：增加沙盒自由总览配置；沙盒总览不再受 2.5D 固定旋转约束，支持自由旋转/平移/缩放，并扩大正交缩放和透视距离范围。
- `createCampusEngine.js`：新增按当前世界 `sampleBounds` 自动聚焦的逻辑，使用动态中心点和宽深度计算全景；扩建、回收、恢复后，在总览模式下重新适配全景。
- 地块管理开启时，暂存当前人物镜头模式，切换到自由构建总览并暂停人物移动；退出时恢复原人物镜头模式和移动控制。
- 切换到沙盒总览模式时重新适配整个沙盒，不再把相机目标硬编码到世界原点。

### 验证边界

- 已写入远程功能分支并将进行源码回读。
- 未运行本地构建、Vitest 或浏览器验收；特别需要实测大范围缩放、旋转后再扩建、地块管理退出后人物镜头恢复，以及 2.5D/3D 两种投影。


## 2026-11-09 — 沙盒统一自由视角并恢复人物显示

### 问题定位

空白沙盒场景此前只创建地面和地块，没有创建 `PixelExplorerSprite`。引擎虽有玩家坐标和角色同步逻辑，但场景中没有可渲染人物对象，因此用户看不到人物。与此同时，页面初始化主动切换到第三人称，导致沙盒默认视角与地块管理视角不一致。

### 实际修改

- 空白沙盒新增可见的低多边形人物 Avatar（身体、头部、四肢和地面定位环），放置在配置的出生点。
- 沙盒页面初始化统一进入自由总览视角，不再默认切换第三人称跟随镜头。
- InputController 增加自由相机下的独立人物移动：WASD/方向键按当前相机朝向移动人物，不改变相机观察中心。
- 自由总览下的人物移动继续触发按需渲染；人物靠近模型时原有交互检测仍可工作。
- 地块管理开启时暂停人物移动；退出时恢复人物移动，镜头仍保持自由总览。
- 地块管理 HUD 与普通沙盒构建操作共用同一相机模式。

### 验证边界

- 已写入远程功能分支，并回读确认人物对象、自由移动开关、自由视角初始化和渲染唤醒逻辑存在。
- 未运行本地构建、Vitest 或浏览器验收；需重点确认人物模型尺寸/可见性、WASD 移动方向、镜头不跟随、交互提示和 2.5D/3D 下的表现。


## 2026-11-09 — 沙盒增加三档视角选择

- 顶部新增自由视角、2.5D、3D 三档互斥切换，默认自由视角。
- CameraRig 将自由总览操控从永久配置改为可切换状态：自由视角为正交投影且允许旋转；2.5D 恢复固定方位；3D 使用透视投影。
- Engine 暴露 `free` / `2.5d` / `3d` 三种沙盒视角值，并同步 TransformControls 当前相机。
- 切换视角不重建场景或重置世界数据；人物、模型、地块和环境状态保持原位。
- 仅完成远程源码修改，尚未运行构建、单元测试或浏览器验收。重点回归：三档投影和操控差异、切换时镜头中心/缩放连续性、模型精调 Gizmo 相机引用更新、人物移动与地块管理暂停恢复。


## 2026-11-09 — 修正 2.5D / 3D 视角为首页近景跟随

- 原实现只切换 2.5D 正交 / 3D 透视投影，但相机仍停留在 overview，导致画面是远景，不符合用户参照首页近景效果的要求。
- 移除沙盒对 thirdPerson 的强制 overview 归一化。
- 沙盒选择 2.5D / 3D 时，在切换投影后同步进入 thirdPerson，复用首页 CameraRig 的 2.5D 固定斜俯视跟随距离与 3D 透视跟随距离；选择自由视角则返回 overview。
- 本轮仅完成远程源码修改和回读检查，未执行本地构建、自动化测试或浏览器验收。


## 2026-11-09 — 沙盒底层统一阴影调度

### 本轮实现

- 新增 `src/three/engine/ShadowSystem.js`，将阴影贴图启用、质量配置、静态场景失效和动态投影失效收口为沙盒 Runtime 的统一服务。
- `createCampusEngine.js` 不再直接散落管理阴影贴图刷新；静态场景/光照变化走静态失效，人物移动、垂直位置变化、人物显隐切换、模型 TransformControls 调整和受风摆动对象走动态失效。
- 保留 `shadowMap.autoUpdate = false`，静态场景仍使用缓存；动态对象变化时在下一次场景渲染前标记 shadow map 需要更新，避免相机静止或自由总览按需渲染时阴影停留在旧位置。
- 新增 `ShadowSystem.test.js`，覆盖阴影缓存配置、动态失效、禁用状态和 dispose 行为。

### 当前边界

- 这是统一阴影调度的第一步：当前 Three.js 仍使用共享 DirectionalLight ShadowMap，动态对象移动时会触发整张阴影贴图更新；尚未实现独立动态阴影图层、接触阴影、按可见区域裁剪或阴影预算调度。
- 模型静态/动态状态目前由引擎已有的编辑与动画更新路径触发失效；未来新增动态实体时必须接入 ShadowSystem 的动态失效接口。
- 人物外观仍是现有占位 Avatar，本轮没有改造人物 AI 建模、骨骼 Rig 或动画资产管线。
- 远程源码与测试已写入目标功能分支；未运行本地构建、Vitest 或浏览器验收，不能标记为通过。


## 2026-11-09 — 确认未来支持工作台世界发布到首页（暂缓实施）

### 产品决策

- 后续 `world-sandbox-mvp` 定位为通用 3D 世界创建与编辑工作台，不是校园地图编辑器；不纳入校园 GIS、校园道路/建筑/POI 等专属编辑流程。
- 未来工作台编辑完成的沙盒应可作为完整世界发布，由产品首页直接加载、展示并进入探索。
- 目标链路为：工作台编辑与保存草稿 → 发布一个可追溯的世界版本 → 首页加载已发布版本。
- 首页与工作台复用统一世界数据协议、模型资产引用和运行时能力；不维护两份场景，也不采用仅导出静态模型快照的方式。
- 发布前需要具备完整世界持久化、草稿/发布隔离、版本化、资源寻址及首页运行时加载能力。

### 当前执行边界

- **本项仅记录为后续规划，当前不开发。**
- 当前 MVP 继续聚焦通用世界创建、AI 模型生成与编辑、模型实例管理、角色交互、空间/物理和环境系统。
- 不新增发布 UI、发布 API、首页加载器或版本管理实现。
- 待世界文档和 Runtime 核心能力稳定后，再单独启动发布与首页接入设计。

### 文档状态

- 已同步更新 `PROJECT_PLAN.md` 与本进度记录；本次仅更新项目决策文档，没有修改运行时代码。
- 未运行构建、测试或浏览器验收（本次为纯文档决策更新）。

## 2026-11-09 — 角色视觉资产与控制器解耦（第一阶段）

### 实际修改

- 新增 `src/three/characters/PlayerCharacterRuntime.js`：将人物视觉层挂载在稳定角色根节点下，提供模型替换、尺寸归一化、GLTF 动画混合器、`idle / walk / run` 状态映射、占位模型回退和资源释放。
- `createCampusEngine.js`：仅在空白沙盒初始化该 Runtime；暴露 `loadPlayerCharacter`、`setPlayerCharacterModel`、`setPlayerCharacterAnimation`、`restorePlayerCharacterFallback`、`getPlayerCharacterInfo`。人物移动仍由原有 CameraRig / InputController 驱动。
- `createBlankSandboxScene.js`：改为复用现有 `createCampusPlayer.js` 作为内置人物视觉，不再维护第二套沙盒专用人物几何体。
- `createCampusPlayer.js`：增加无浏览器 Canvas 环境下的 DataTexture 接触阴影回退，使共享人物创建模块可在 Node 测试环境实例化。
- 新增 `PlayerCharacterRuntime.test.js`，覆盖视觉替换不改变控制根节点、动画名称映射、恢复占位人物和无效模型拒绝；同步更新空白沙盒人物断言。

### 当前边界

- 当前已建立运行时替换接口，但尚未接入前端角色资产选择 UI，也没有提供默认线上 GLB 地址。
- 角色资产 ID 目前只保存在当前 Runtime 实例中；角色资产引用、出生点及角色配置尚未写入世界存档。
- 动画状态默认按移动/静止切换 walk/idle，并读取现有 Shift 按键状态映射 run；接口仍支持显式覆盖动画状态或切回 auto。
- 不具备骨骼动画的 GLB 可作为静态角色显示；不自动生成 Rig 或动作。
- 本轮仅完成远程源码与测试文件写入；未运行本地构建、Vitest 或浏览器验收，不能标记为通过。


## 2026-11-09 — 统一人物与世界模型的真实阴影规则

### 问题定位

- 内置人物此前使用单独的脚底柔边 Canvas/DataTexture 接触阴影，而不是 DirectionalLight ShadowMap 的真实投影。
- `createCampusPlayer.js` 在创建人物后又将全部身体 Mesh 的 `castShadow` 设为 false，因此人物不会像沙盒模型一样向地面投射真实阴影。
- 引擎已有玩家移动/垂直变化/显隐时调用 `invalidateDynamicShadowMap()` 的逻辑；根因是人物投影被禁用，而不是缺少动态失效入口。

### 本轮修正

- 移除人物专用的脚底贴图阴影，避免其外观与其他模型的真实投影不一致。
- 内置人物所有 Mesh 统一启用 `castShadow` 与 `receiveShadow`。
- 外部 GLB 角色挂载时统一启用相同阴影标记，避免 GLB 源文件的默认标记导致人物不投影。
- 增加角色资产阴影属性测试断言。
- 继续复用现有动态 ShadowMap 失效机制，不新增第二套阴影系统。

### 验证状态

- 源码修改与测试断言已写入；尚未运行本地 Vitest、构建或浏览器验收。
- 需要在沙盒中确认人物投影随移动、转向、跳跃/垂直变化及 GLB 替换正确更新，并与普通模型使用相同光照方向和阴影质量。

## 2026-11-09 — 玩家角色 AI 生成入口与动态物理尺寸适配

### 仓库基线

- 仓库：southyouth-team/ncgxy_map
- 分支：feat/world-sandbox-conversational-model-editor
- 本轮开始 HEAD：ca373b35c6a07e7189ad64addfa1a411895407eb
- 本轮基于该分支源码审查后实施；未修改 main，未创建或合并 PR。

### 本轮目标

在已有 GLB 角色加载能力上增加 AI 程序化角色生成入口，并让两种来源统一经过角色运行时和物理尺寸适配；不新增物理引擎。

### 实际改动

- src/three/characters/PlayerCharacterRuntime.js：读取模型包围盒并归一化尺寸，向外暴露宽、高、深、视点高度和碰撞半径。默认目标高度仍为 2.25 世界单位；眼高按归一化高度的 0.76 推导，水平碰撞半径按最大水平尺寸的 0.28 推导并限制安全范围。内置回退角色使用稳定默认尺寸；模型无有效高度时拒绝替换。
- src/three/physics/CollisionWorld.js：新增运行时碰撞半径更新接口；不重建世界障碍物。
- src/three/controls/InputController.js：增加角色眼高/碰撞半径适配接口。CollisionWorld 切换时自动应用当前角色碰撞半径；眼高变化时在角色站立状态下保持脚底高度。
- src/three/engine/createCampusEngine.js：GLB 加载和程序化 Object3D 加载统一应用角色尺寸。默认角色恢复时同步恢复默认物理尺寸。角色视觉根节点使用控制器当前眼高回落到地面，不再硬编码 1.7。
- src/components/WorldSandboxMvp.vue：新增 AI 角色描述生成入口，复用现有程序化模型 NDJSON API 和隔离 Worker。新增单文件 GLB 导入；暂不支持引用外部资源的 .gltf。AI 角色构建后直接替换玩家视觉模型，不作为普通世界物体加入沙盒。无动画剪辑时保留现有基础移动表现。
- 新增/更新 CollisionWorld、InputController、PlayerCharacterRuntime 单元测试，覆盖半径更新、碰撞世界切换、眼高保持和模型尺寸推导。

### 验证状态

- GitHub 远程文件写入：已完成，随后逐文件回读核对。
- 自动化测试：本轮没有可用的本地仓库执行环境，未执行。
- 前端构建：未执行。
- 后端测试：未执行；本轮复用既有生成 API，没有新增后端接口。
- CI：未核验。
- 浏览器验收：未执行。AI 生成效果、GLB 加载、角色行走/碰撞、楼梯和室内切换仍需本地验证。

### 已知边界

- AI 角色生成当前输出的是程序化静态角色模型；生成模型不保证具备骨骼或 idle/walk/run 动画。
- 当前碰撞体是 XZ 平面圆形简化碰撞，不是完整胶囊体/刚体；高度仅用于视点和视觉落地适配。
- AI 角色资产本轮只替换当前会话中的玩家外观，尚未加入独立角色资产库或世界存档持久化。
### 本轮提交与分支复核

- 本轮最终功能分支 HEAD：45bbb3c524f216af143d9d57d791ee756d0bae98。
- 关键提交：e81d10d（动态碰撞半径）、4e07dc6（控制器尺寸适配）、e5cd452（角色尺寸元数据）、9fd2722（引擎联动）、11d6140（AI/GLB 入口）、368879f/880eadf/4a76990（测试覆盖）、ee6510a（流解析与 GLB 扩展名修正）、45bbb3c（回退尺寸修正）。
- main 最终复核仍为 608a9f2c1f739cd581acb833b1e70410672e258b；本轮未修改 main。
- 已从远程仓库回读本轮修改的源码、测试和计划/进度文档；回读不等于运行时测试或浏览器验收。

## 2026-11-09 — 修正人物对高地/坡面支撑检测的漏检

### 问题定位

- `InputController.getPlayerSupportHit()` 原先从人物当前位置上方仅 0.2 个单位发射向下射线；高于射线起点的地面网格不会进入命中结果，人物可能穿过高地或坡面。
- 原探测距离为 60 个单位，射线起点和探测范围没有覆盖角色上方的地形。

### 本轮修改

- `src/three/controls/InputController.js`：地面射线改为从人物上方 `groundProbeDistance` 高度发射，向下探测范围扩展为其两倍。
- 支撑面候选按人物脚底高度过滤：高于当前脚底且超过 `maxStepHeight` 的平台不作为当前支撑，避免隔空吸附到上层楼面；在有效候选中继续按射线距离选择最近的可行走支撑面。
- 保留既有坡度法线判定、台阶高度限制、重力下落和模型声明式支撑面机制；没有把普通墙体/装饰网格自动注册为地面。
- `src/three/controls/InputController.test.js`：增加高处射线起点、上层不可达平台过滤与较低有效支撑面选择测试，并调整台阶上限测试语义。
- `docs/world-sandbox-mvp/PROJECT_PLAN.md`：记录地面探测与坡面贴合规则。

### 验证边界

- GitHub 远程提交及文件回读：已完成。运行时代码提交 `c9a96f5`；测试提交 `b3a5e1b`、`9f4651c`；计划文档提交 `e8e3646`；本进度记录随后提交。功能分支持续推进，`main` 未修改。
- 本轮没有本地仓库执行环境；未运行 Vitest、前端构建或浏览器验收，不能宣称穿模问题已端到端解决。
- 浏览器重点验收：高于基准地面的平台、缓坡上行/下行、超过台阶高度的断崖、平台边缘离开后的下落，以及室内上下层不会互相错误吸附。
- 当前地面探测只识别已登记的 `walkable` / `supportsStanding` 网格；未声明支撑能力的普通模型地面仍不会自动成为可站立面。


## 2026-11-09 — 再次确认 MVP 优先级与架构范围

### 产品决策确认

- 当前研发最高优先级是完成 `world-sandbox-mvp`，不并行启动首页发布/加载，也不回头适配旧校园 2.5D/3D 编辑器。
- World Sandbox 是唯一世界创建、编辑、运行和保存的数据事实来源。未来首页只消费沙盒发布后的世界数据，并复用统一 World Runtime；首页发布链路暂缓。
- 本阶段不保留旧校园编辑器双轨物理、不增加旧 CollisionWorld 兼容层或旧编辑器适配抽象。
- MVP 必须完成可验收闭环：创建世界、环境控制、AI 模型生成与实例编辑、人物移动/碰撞/站立/交互、场景保存和刷新恢复。

### 后续实施顺序

1. 在当前功能分支完成剩余架构审计，重点核查保存/恢复、模型重建与替换、TransformControls、场景卸载/销毁和物理生命周期。
2. 明确统一 World Runtime / Physics Runtime 接口与迁移边界。
3. 在沙盒内接入 Rapier，逐步迁移人物控制、碰撞体、支撑面和模型空间能力；不做无差别全量 Mesh 碰撞。
4. 打通室内、楼层、楼梯/坡面和交互空间连接。
5. 完成世界持久化恢复及端到端验收。

### 仓库与验证边界

- 仓库：`southyouth-team/ncgxy_map`
- 分支：`feat/world-sandbox-conversational-model-editor`
- 本轮开始 HEAD：`dd7efcf0df3c9133f3be31f20e6d984d207bde51`
- 本轮仅更新项目决策文档，不修改运行时代码；未运行测试、构建或浏览器验收。
- 未修改 `main`，未创建或合并 PR。



## 2026-11-09 — World Sandbox 运行时与物理架构审计（第一轮）

### 审计基线

- 分支 HEAD：`de8159722cc76f3034b46c98ebe01fad5a4b1c5f`
- 已检查：`package.json`、`WorldSandboxMvp.vue`、`createCampusEngine.js`、`InputController.js`、`CollisionWorld.js`、`modelSpatialRuntime.js`、`sandboxModelLifecycle.js`、`sandboxInteriorRuntime.js`、`worldStateRuntime.js`、`createBlankSandboxScene.js`、`modelCapabilityManifest.js`。
- 本轮为远程源码审计；没有修改运行时代码，也没有运行本地测试/构建/浏览器。

### 已确认的现状

1. **物理引擎尚未接入**：根目录依赖只有 Three.js、Vue 和 polygon-clipping，没有 Rapier。当前 `CollisionWorld` 是自研 XZ 平面碰撞，按角色半径做 AABB/圆/多边形阻挡和步进移动。
2. **人物不是完整 3D Character Controller**：`InputController` 负责 XZ 移动，另用向下射线检测支撑面，并自行处理重力、眼高、最大坡度和台阶高度；没有胶囊体全身碰撞、头顶/侧向高度碰撞或物理接触求解。帧间 delta 被截断到 0.05 秒，但目前不是固定物理步长。
3. **模型碰撞声明能力有限**：`modelSpatialRuntime.js` 当前只消费 Manifest 的 box collider，并把世界包围盒投影成 XZ 障碍；还按固定 Y 区间过滤。它无法表达完整 3D 复合碰撞、斜面/楼梯碰撞或真实门洞体积。
4. **可站立面已具备声明式基础**：Manifest 的 mesh surfaces 可关联真实 componentId Mesh，并由 InputController 射线采样；注册记录持有运行时 Mesh 引用，模型刷新时会先删除同 owner 的旧障碍和旧支撑面，再重建。
5. **模型生命周期已有部分闭环**：新增、替换、Transform API、TransformControls objectChange、实例状态变化会刷新空间注册；删除和 Engine dispose 会注销对应 owner 的障碍/支撑面。AI 重建时保留实例 Transform、worldState 和 environmentOverrides。
6. **室内能力尚未形成完整沙盒空间拓扑**：当前通用沙盒的 enter/exit 路径主要解析 Manifest entryPoint 并传送人物；没有独立的楼层/房间碰撞世界、楼梯连接图和多层 Character Controller 闭环。旧室内原型的楼层切换不能当作通用沙盒已完成能力。
7. **持久化由页面层主导**：`WorldSandboxMvp.vue` 将 world chunks、模型 Object3D.toJSON()、环境开关/参数及选中模型写入 localStorage v4；恢复时通过 ObjectLoader 重建模型，再调用 addSandboxModel 重建空间注册。存档闭环已存在，但 World Document 尚未成为 Engine/Runtime 的统一权威文档。
8. **角色与玩家状态没有完整持久化**：当前快照没有保存玩家位置/朝向、角色资产引用或角色配置；AI/GLB 替换的人物视觉资产只在当前 Runtime 会话内存在，刷新后不能保证恢复。
9. **环境数据仍由 Vue 页面持有**：时间、天气、风和开关保存在页面响应式状态，Engine 负责把有效值应用到视觉 Runtime；这与模型实例状态/世界数据尚未收敛到统一 World Document。
10. **资源释放已有基础**：模型替换/删除通过 sandbox lifecycle helper 释放克隆材质/贴图；Engine dispose 会注销模型空间记录、销毁控制器/角色/阴影系统并遍历场景释放几何和材质。Rapier 接入后仍需新增刚体、碰撞体、事件队列和 World 的明确销毁顺序。

### 迁移结论

- 不直接把 Rapier API 散落到 Vue、InputController 或模型生成代码中。
- 先建立沙盒专属 Physics Runtime，统一持有 Rapier World、固定时间步、刚体/碰撞体注册表、角色控制器和模型碰撞适配；Three.js 继续只负责渲染。
- 人物控制从当前 XZ + 射线逻辑迁移到 Rapier Character Controller（优先运动学角色控制器），保留输入/相机职责，不把视觉角色 Mesh 当作刚体。
- 模型 Manifest 继续作为声明式数据源；先扩展/校验 collider 与 surface 数据，再由 Physics Runtime 生成受控碰撞表示。禁止无差别将所有 Mesh 自动变成障碍。
- 静态建筑/地形可使用三角网格或复合碰撞；动态门扇/设备优先使用 box/capsule 等简单碰撞体；门洞必须由分段墙体/复合体表达，不能被整体凸包封闭。
- 楼层、房间、楼梯/坡面应建模为明确的空间连接与可行走面，不把“传送到入口”视为完整室内通行。
- 后续将 World Document 从页面层存档逐步上移为 Engine 的权威数据契约，并补齐玩家状态、角色资产引用、环境值和对象状态恢复。

### 审计未完成项

- AI Worker 与后端 Manifest 输出校验是否覆盖 collider/surface/entryPoint 引用、唯一 ID、尺寸范围和目标部件存在性。
- 模型参数编辑、重建、撤销/重做及失败回滚时的资源和物理注册事务边界。
- 场景加载失败、重复恢复、重置世界和异常 dispose 的完整性。
- Rapier 对应版本、WebAssembly 加载方式、Vite Worker/SSR 测试兼容性与锁文件策略。


### 第一轮审计补充：模型能力校验与运行时闭环

- `proceduralModel.worker.js` 当前对 AI 输出 Manifest 做结构归一化并写入 Object3D.userData，但没有看到对 collider/surface/entryPoint 的 targetPartId、唯一 ID、尺寸、实际目标 Mesh 等进行系统校验的闭环。
- `image-generation.service.ts` 的模型编辑返回路径会规范化 Manifest version、parameters 和 environmentBindings；本次检查范围内未看到对空间碰撞/楼层入口引用的语义校验。
- 程序化模型构建的组件树/参数本身已有独立校验，不能将其误认为 Manifest 空间能力也已校验。
- `WorldSandboxMvp.vue` 的存档版本 v4 仍由页面负责；快照包含世界区块、模型 Object3D JSON、环境配置和选中对象，不包含玩家 Transform、角色资产持久化引用。当前角色导入/生成没有写入该快照。
- Engine 目前以按需 requestAnimationFrame 驱动渲染，输入/自研运动使用截断后的帧 delta；Rapier 应在独立固定时间步累积器中推进，不能把物理更新简单绑在可变渲染帧上。
- TransformControls 的 objectChange 已调用 setSandboxModelTransform，因此当前 Gizmo 变换会刷新模型空间注册；迁移时需保留该同步入口，并在拖拽过程中避免重复创建/销毁物理资源，可采用更新现有刚体/碰撞体 Transform 的策略。


## 2026-11-09 — Physics Runtime 基础设施第一阶段

### 已提交到功能分支

- `package.json` 增加固定版本 `@dimforge/rapier3d-compat@0.21.0`。选择 compat 构建是为了降低 Vite 对独立 WASM 资源解析/部署的集成风险；初始化仍为异步。
- 新增 `src/three/physics/PhysicsRuntime.js`：
  - 创建 Rapier 3D World，默认重力 `(0, -9.81, 0))。
  - 固定物理时间步（默认 1/60 秒），渲染 delta 累积推进。
  - 限制最大帧 delta 和最大子步，避免后台标签页恢复后出现无限追帧。
  - 支持静态 Box 刚体/碰撞体、稳定 ID、owner 分组、Transform 更新、单体/owner 批量移除。
  - 统一 dispose，避免 World 生命周期泄漏。
  - 允许注入 Rapier 模块，便于单元测试和隔离 WASM 初始化。
- 新增 `src/three/physics/PhysicsRuntime.test.js`，覆盖固定步长、追帧限制、静态 Box 注册、Transform 更新、owner 清理、重复 ID/非法尺寸和 dispose。

### 当前边界

- PhysicsRuntime 尚未接入 `createCampusEngine.js` 的沙盒初始化和 render loop。
- 人物仍使用原 InputController + CollisionWorld；本次没有切换控制器，也没有改变当前沙盒行为。
- Manifest collider/surface 目前尚未转换为 Rapier 碰撞体。
- 角色胶囊体、运动学 Character Controller、三角网格静态碰撞、楼梯/坡面和室内多层空间尚未实现。
- 仓库当前未发现 npm/yarn/pnpm 锁文件；本次没有生成锁文件。

### 验证状态

- 已通过 GitHub 远程回读确认 package.json、PhysicsRuntime.js、PhysicsRuntime.test.js 写入。
- 未在本地执行 `npm install`、`npm test`、`npm run build`，未进行浏览器验收。新增测试当前仅是已写入源码，不能标记为通过。
- 运行时代码与测试文件写入节点：`5d7dab63cab30cafa65e6ddacaaada891954e144`；随后更新了本进度记录。


## 2026-11-09 — Physics Runtime 接入沙盒 Engine（第一阶段）

### 仓库与提交基线

- 本轮开始功能分支 HEAD：`573cdd53c389960a0e75820f3dcc33a7526c9e11`。
- 本轮运行时代码提交：
  - `6203ee08916b9d2ef77f92bb056c63eba6c0351e` — 从模型 Manifest 导出 Rapier Box Collider 注册。
  - `b5fac7d9964805cd515133585cd2d0fdcc316a87` — 增加模型物理注册适配测试。
  - `147b81d2fd0cfb3264c831fe7d0023e726a7655f` — 将 Rapier PhysicsRuntime 接入 blank sandbox Engine。
- 文档计划更新：`b6448ab79e1cb56148452cd43ef35dbdd3be08b0`。
- 所有写入均显式指定 `feat/world-sandbox-conversational-model-editor`；本轮核对 `main` 仍为 `608a9f2c1f739cd581acb833b1e70410672e258b`。

### 实际实现

1. `createCampusEngine.js` 仅在 blank-sandbox 初始化异步 Rapier PhysicsRuntime；旧校园/RPG 场景不创建该运行时。
2. 沙盒每个有效世界区块注册一个静态地面 Box，世界外围注册四面边界 Box；区块扩展、删除和存档恢复通过 `syncSandboxWalkableChunks()` 同步重建物理注册。
3. 渲染循环将帧 delta 交给 PhysicsRuntime，由 PhysicsRuntime 自己按固定时间步推进。
4. `modelSpatialRuntime.js` 扩展空间 Box 采集，可选择包含完整高度范围；继续复用现有 Manifest 状态条件、参数绑定和用户能力覆盖解析逻辑。
5. 新增 `refreshModelPhysicsRegistration()`：按模型稳定 owner ID 清理旧刚体，再将当前有效 Box Collider 以世界 AABB 的保守 Box 形式注册到 Rapier；失败时清理该 owner 已创建的部分物理对象。
6. 沙盒模型新增、TransformControls/程序化 Transform 更新、模型状态变化、AI 替换、删除和 Engine dispose 均接入物理注册刷新/清理。
7. Engine 暴露 `getPhysicsDiagnostics()`，可读取物理运行时启用状态、刚体数量、固定步长和累计丢弃时间。
8. 新增模型物理注册测试：覆盖高处 Collider 注册、Door stateCondition、owner 旧刚体清理。

### 当前实现边界（必须明确）

- 当前 Rapier 接入只建立静态地面、边界和模型 Box Collider；模型 Collider 暂时使用世界 AABB，不保留原始 OBB 方向，也不支持 Mesh/三角网格 Collider。
- 人物仍由原 InputController / CollisionWorld 移动，尚未使用 Rapier Character Controller；因此不能声称人物现在已经受到 Rapier 物理碰撞响应。
- 楼梯、坡面、室内多层、门洞复合碰撞和动态刚体尚未完成。
- 这一轮未修改 `main`，未创建或合并 PR。

### 验证状态

- 已通过 GitHub 远程回读确认 `PhysicsRuntime.js`、`modelSpatialRuntime.js`、`modelSpatialRuntime.test.js`、`createCampusEngine.js` 和项目计划文档。
- 本轮没有可用的本地仓库执行环境；未执行 `npm install`、`npm test`、`npm run build`，也未做浏览器验收。
- 新增测试已写入但未执行，不能标记为自动化通过。
- 本轮没有生成 npm/yarn/pnpm 锁文件。

### 下一步

1. 先在真实开发环境执行依赖安装、模型空间测试、PhysicsRuntime 测试和前端构建，修复实际暴露的问题。
2. 浏览器验收 blank sandbox 的 Rapier 初始化、地面/边界/模型 Box 注册，扩展/删除/恢复区块，以及模型新增/移动/替换/删除后的 bodyCount 和资源清理。
3. 验证通过后，开始迁移人物到 Rapier KinematicCharacterController；输入与相机控制继续保留，不同时重构交互 UI。


### CI 结果补充（模型物理注册测试修正后）

- 首次前端 CI 暴露本轮新增测试的浮点数精度断言问题（世界 AABB 的 Z 半尺寸为 `0.20000000000000018`）；已将该断言改为 `toBeCloseTo`，提交 `ddf33bfb16b76985c4db534d6fff0e9f1acaf2a4`。
- 修正后的前端 CI：`npm install` 成功；`npm test` 为 485 passed / 6 failed（491 total，5 个测试文件失败）；本轮新增的 Rapier 模型物理注册测试已通过。
- 与本轮开始基线 `573cdd53c389960a0e75820f3dcc33a7526c9e11` 的前端 CI 对比：基线同样是 5 个测试文件失败、6 个测试失败；失败测试文件和断言与本轮修正后的结果一致。因此目前看到的 5 个失败文件属于本轮开始前已存在的基线问题，不是本轮 Rapier 改动新增的失败。
- 前端 `npm run build` 因 CI 工作流在测试失败后跳过，尚无本轮构建结果。
- 后端基线 CI 在 `image-generation.procedural.spec.ts` 有 1 项失败（96 passed / 1 failed）；本轮新提交对应的后端 CI 当时仍在执行中，尚未取得最终结论。后端源码本轮没有修改。
- 本轮没有在本地环境运行测试；上述结果均来自 GitHub Actions。浏览器验收仍未执行。


- 后端 CI 最终结果已返回：依赖安装成功、NestJS build 成功；后端单测 96 passed / 1 failed，失败仍为 `image-generation.procedural.spec.ts` 中既有的几何诊断上下文断言，与本轮未修改的后端代码相关。与开始基线相同；PostGIS migrations / API integration / schema checks 因单测失败而跳过。


## 2026-11-09 — Rapier 人物控制器接入（第一阶段）

### 实际实现

1. `PhysicsRuntime.js`
   - 新增 `createKinematicCharacter()`：创建 position-based kinematic rigid body + capsule collider + Rapier CharacterController。
   - 支持最大爬坡角、自动跨台阶、snap-to-ground 配置。
   - 新增 `moveKinematicCharacter()`：计算期望位移的碰撞修正结果，并通过 `setNextKinematicTranslation()` 应用。
   - 新增 `setKinematicCharacterPosition()`：支持传送/重置。
   - CharacterController 在 owner 清理和 Runtime dispose 时先于刚体释放。
2. `InputController.js`
   - 新增可选 PhysicsRuntime 接口；只有 blank-sandbox 由 Engine 显式启用。
   - 键盘/虚拟按键/自动寻路继续复用原输入和相机方向计算，水平移动与重力位移交给 Rapier CharacterController。
   - Rapier 返回的脚底位置加 eyeHeight 后回写 `cameraRig.player`，保留原相机/动画调用约定。
   - 角色重置、传送、尺寸变化同步物理胶囊体；非 blank-sandbox 保持原 CollisionWorld 移动路径。
3. `createCampusEngine.js`
   - blank-sandbox 初始化 InputController 后，将同一个 PhysicsRuntime 注入人物控制器。
4. 测试
   - `PhysicsRuntime.test.js` 新增 capsule 创建、控制器参数、碰撞修正位移、传送及资源销毁测试。
   - `InputController.test.js` 新增沙盒人物初始化、Rapier 移动/重力、自动寻路及尺寸/传送同步测试。
5. `PROJECT_PLAN.md` 新增人物控制器接入契约和验收范围。

### 关键边界

- 仅 blank-sandbox 的玩家移动改用 Rapier；其他非沙盒运行模式不受影响。
- 人物是运动学胶囊体，不是动态刚体；重力向量由 InputController 提供，碰撞/滑动/坡度/台阶由 Rapier CharacterController 求解。
- 这一阶段尚未完成浏览器实测，不能宣称墙体、楼梯、坡面等真实场景行为已验收。
- 现有模型 Collider 仍是世界 AABB Box；三角网格/旋转 OBB/复合门洞碰撞未完成。

### 提交记录

- `28ed7a3b7651eec4755834bd110679a0aefb633a` — PhysicsRuntime 增加运动学胶囊角色能力。
- `611f6df00d4ce7ef29879552e8ee73d353ad199d` — PhysicsRuntime 角色生命周期测试。
- `46fbb5ac74a81b18164815d447ce8bf5713c94fa` — InputController 沙盒人物移动切换到 Rapier。
- `d991aeddb8a6ac5d0641d2186b796e9581bc5656` — Engine 将 Rapier Runtime 注入沙盒人物控制。
- `2b6fd92f2d12d3b9c38e0ed81e5f56310cb1a0d8` — InputController Rapier 移动测试。
- `fd66f27cb63bb6cf3bff0ba04df8f8fc9c1effac` — 人物控制器架构契约文档。

### 验证状态

- 上述代码和测试文件已写入功能分支；需要重新触发 CI 后确认结果。
- 本轮没有本地仓库执行环境，未运行本地 Vitest、前端构建或浏览器验收。
- CI 需重点检查 Rapier API 兼容、运动学角色测试、InputController 旧行为回归；既有基线失败需与本轮结果区分。
- 未修改 `main`，未创建/合并 PR。

### 下一步

1. 获取本轮前端/后端 CI 结果；若有失败，先定位并修复本轮新增问题。
2. 若单测通过，执行前端 build；随后在浏览器中验收人物胶囊与沙盒地面/模型 Box 的实际碰撞。
3. 重点验证墙体阻挡与滑动、台阶、坡面、平台边缘下落、落地、寻路、传送和尺寸更新。
4. 验收通过后，再进入 Manifest 的 OBB/复合 Box、Mesh Collider 与楼梯/室内多层空间。


### 固定步长运动修正（2026-11-09）

代码复核时发现：若每个渲染帧都直接调用 CharacterController，而物理世界按 1/60 固定步长推进，在 120Hz/144Hz 显示器上可能在物理步之间重复覆盖运动学目标，造成帧率相关的速度误差。已将人物运动改为速度采样：

- `InputController` 每帧只调用 `setKinematicCharacterVelocity()` 更新期望速度，并读取当前物理步后的角色位置。
- `PhysicsRuntime.step()` 在每个固定子步内统一执行 CharacterController 计算、`setNextKinematicTranslation()` 和 `world.step()`。
- 增加 `stepCount`，自动寻路只在物理步确实前进后才根据实际位移判断阻塞，避免首帧误判。
- 删除直接逐帧位移的 `moveKinematicCharacter()` API，避免绕开固定步长契约。
- 控制器禁用时显式清零待执行速度，防止 Transform/Gizmo 操作期间人物继续滑动。
- 新增固定步长消费测试，并覆盖禁用控制器清零速度。

新增/修正提交：
- `f56eb4cf907b7618e21a75a0ad65f9dd136ad0a0` — 物理子步统一消费角色速度。
- `8efdc73a3e245c88a445de6b05af457aa4a71347` — InputController 改为速度采样和物理步同步。
- `c4a31d2ad297dcac77a4858aebbcbb0d9dd30d26` — 更新人物控制测试。
- `93e3382babedf4a4694c70947ed3a33d9b824f61` — 固定步长角色运动测试。
- `6a187e93bdfaa87d7aaae962b071d2fbc79edd90` — 控制器禁用时停止待执行移动。
- `255d4cca2462f7da1a8fb6ecec9037c31f22a00b` — 禁用状态测试。
- `ec8381edcfcf727278c952898a09fbfee406f85f` — 角色脚底坐标浮点断言修正。
- `616c0e20639d4e246ee7934df57f7b4d932329d2` — 移除绕过固定步长的直接移动 API。
- `c0f9aa3ee3277a81ae4cdba0c9c114492d9cbfdc` — 删除旧的直接位移测试。
- `22767bf980d2b4fd206def6ec2e92b2c7c890b36` — 固定步长架构约束补充。

验证情况：前一轮 CI（提交 `93e3382...`）中 PhysicsRuntime 全部 10 项测试通过；InputController 新增测试中除一个脚底坐标浮点精度断言外均通过，该断言已修正。当前最新提交 `c0f9aa3...` 的前端/后端 CI 正在运行；最终结果以本条记录之后的最新 Actions 结果为准。


### 本轮 CI 最终核验（代码源与 CI 工作流提交）

- 前端 CI 在 `686be5193835ee2de1e13af4e2319f2a9393d002` 执行：`npm install` 成功；`npm test` 为 493 passed / 6 failed（499 total）。与本轮开始基线相比，仍是原有 6 项失败；本轮新增的 PhysicsRuntime / InputController Rapier 测试均通过。
- 同一前端 CI 的 `npm run build` **通过**。为避免历史测试失败阻断构建验证，本轮调整 `.github/workflows/frontend-ci.yml`：依赖安装成功后，单测失败也会继续执行 build；该变更只作用于功能分支。
- 后端 CI：NestJS build **通过**；单测为 96 passed / 1 failed，失败仍为 `image-generation.procedural.spec.ts` 的既有失败；PostGIS migration / API integration / schema verification 因后端单测失败而跳过。与本轮开始基线一致，且本轮没有修改后端源码。
- 浏览器实测未执行，故碰撞行为（墙体阻挡/滑动、台阶、坡面、下落和落地）仍需在真实沙盒页面验收。
- 最新功能分支 HEAD（本条文档更新前）：`686be5193835ee2de1e13af4e2319f2a9393d002`；`main` 保持 `608a9f2c1f739cd581acb833b1e70410672e258b`。


## 2026-11-10 — 人物通行 Profile 与模型 Traversability Manifest（第一阶段）

### 仓库与基线

- 仓库：`southyouth-team/ncgxy_map`
- 分支：`feat/world-sandbox-conversational-model-editor`
- 本轮开始分支 HEAD：`0964ceb63760f3dc87582e85a567c8d25a5a7283`。
- 本轮修改仅提交到上述功能分支；没有修改 `main`，没有创建或合并 PR。

### 已落地

1. 新增 `src/three/physics/CharacterTraversalProfile.js`，统一人物高度、胶囊半径、最大跨阶高度、最大爬坡角、最小滑落角、自动跨阶最小宽度、贴地吸附距离和 Collider offset。
2. 第一阶段默认值沿用当前沙盒既有参数（height 1.7、radius 0.55、maxStepHeight 0.45、climb angle 50°、slide angle 30°、min step width 0.275、snap distance 0.25、offset 0.01），本轮不擅自改变角色手感；这些仍是工程默认值，不是最终人体工学验收值。
3. `InputController` 以该 Profile 作为参数唯一来源，并通过兼容访问器保留既有内部调用；角色尺寸变化会重新归一化 Profile，再重建 Rapier 胶囊体。
4. `PhysicsRuntime.createKinematicCharacter()` 消费同一 Profile 计算 Capsule 高度和 CharacterController 的坡度、跨阶、贴地参数；保留旧 options 形式作为内部兼容入口，沙盒新调用统一传 Profile。
5. `modelCapabilityManifest.js` 增加 `capabilities.spatial.traversability` 的规范化与基础结构校验，包含 `stairs`、`ramps`、`passages`、`connections` 四类开放数据集合，并保留未知扩展字段。
6. Procedural Model Worker 将基础校验结果写入模型根节点 `userData.proceduralModelTraversalValidation`。当前校验只覆盖声明记录结构、稳定 ID、部件引用字段和连接端点；尚未验证 targetPartId 是否真实存在，也未生成对应 Collider。
7. AI 模型生成和编辑 Prompt 已增加上述 Traversability 声明格式，并明确禁止将“AI 声明”描述成“运行时已可通行”。

### 新增/调整测试

- 新增 `CharacterTraversalProfile.test.js`：默认值、胶囊尺寸约束、非法坡度/尺寸归一化。
- 扩展 `PhysicsRuntime.test.js`：确认同一 Profile 驱动胶囊尺寸、坡度、自动跨阶和贴地参数。
- 扩展 `InputController.test.js`：确认角色创建与尺寸变化通过 Profile 传递。
- 扩展 `modelCapabilityManifest.test.js`：覆盖四类声明规范化、扩展字段保留、缺少 ID/部件引用/连接端点诊断。

### 尚未完成（不得误报）

- Traversability Manifest 目前是声明协议和基础结构校验，不是自动识别器。
- Worker 目前未校验 targetPartId 与真实 Object3D componentId 的对应关系。
- 尚未实现楼梯踏步/坡面几何提取、坡度测量、楼梯连续性和门洞净空分析。
- 尚未将楼梯/坡面 Mesh 转成 Rapier trimesh/compound Collider；当前现有模型碰撞仍以 Box Collider/AABB 为主。
- 尚未实现人物自动路径探测、通行测试、失败诊断和 AI 自动修复闭环。
- 多楼层/房间连接仍未接入可运行导航图。

### 验证状态

- 代码与文档已通过 GitHub 远程回读；当前功能分支 HEAD 以本记录提交后的分支状态为准。
- 本轮没有本地仓库执行环境，未运行 Vitest、前端构建、后端测试或浏览器验收。新增测试仅已写入，不能标记为通过。
- 需要 CI 验证本轮新增测试和构建；浏览器仍需验证真实 Rapier 胶囊尺寸与角色移动行为。


### CI 回归核验（2026-11-10）

- 当前功能分支提交 `db523a485407c12485113004e2ebc15674ab82ea` 的 Frontend CI：`npm test` 为 500 passed / 6 failed（506 total）；本轮新增的 `CharacterTraversalProfile`、Rapier Profile 消费、模型 Traversability Manifest 测试均通过。6 项失败仍落在既有失败用例（InputController 既有坡面断言、模型 Manifest 既有空环境绑定断言、沙盒场景两项、PlayerCharacterRuntime 一项、太阳位置一项）；与此前基线的失败总数一致。前端 `npm run build` 通过。
- 同一提交的 Backend CI：NestJS build 通过；单测 96 passed / 1 failed，仍为既有 `image-generation.procedural.spec.ts` 失败，与本轮新增 Prompt 声明无关。后端数据库集成验证因单测失败按现有工作流策略未继续。
- 以上为 GitHub Actions 结果，不代表浏览器实测。尚未完成真实模型楼梯/坡面、门洞净空、人物起终点可达性验收。


## 2026-11-10 — Traversability 几何绑定分析器（第二阶段）

### 已落地

1. 新增 `src/three/sandbox/modelTraversabilityAnalyzer.js`，在真实 Three.js 模型层级上分析 Manifest 中的楼梯、坡面、通道和连接声明。
2. 对楼梯/坡面/通道执行稳定 `targetPartId` 绑定：目标不存在、目标 Mesh 缺失、`componentId` 重复时产生明确错误，不做猜测式匹配。
3. 对绑定几何采集 Mesh 数量、世界包围范围、朝上三角面数量；坡面额外统计朝上三角面的中位坡度，并可与 AI 声明坡度做偏差诊断。
4. 楼梯目前只证明声明绑定了几何并检测到朝上三角面；分析器明确输出“逐级踏步/级高连续性尚未验证”警告。
5. 通道目前只证明目标几何存在；分析器明确输出“门洞净空尚未验证”警告，不以门框包围盒错误推断开口可通过。
6. 空间连接暂时标记 deferred，尚未绑定楼层/房间节点图。
7. Procedural Model Worker 生成模型后自动运行分析器，并将报告写入 `root.userData.proceduralModelTraversabilityAnalysis`，随模型序列化结果返回。
8. 新增 `modelTraversabilityAnalyzer.test.js`，覆盖几何绑定、坡度证据、重复/缺失部件 ID、未认证状态和通道/楼梯未完成警告。

### 本阶段边界

- 当前分析器是几何证据采集与绑定校验，不创建 Rapier Collider，也不改变玩家碰撞行为。
- 三角面坡度是基于世界坐标变换后实际 Mesh 三角形法线计算；它不等于对整条坡道连续性或可达性的证明。
- 楼梯逐级识别、台阶宽高与连续性、坡面边缘/断裂检测、门洞净空体积检测、楼层连接拓扑仍待实现。
- `certifiedWalkable` 仍固定为 false，任何模型都不能仅凭本阶段分析结果获得“可通行”认证。

### 验证

- 已新增单元测试，等待 GitHub Actions 对当前提交执行；本轮尚未本地运行 Vitest 或浏览器实测。


### 楼梯几何统计增量（2026-11-10）

- 分析器新增水平踏面三角面采样，按世界空间高度聚类，输出可检测高度层数量、平均级高、沿楼梯主运行方向的平均踏面深度。
- 当 Manifest 声明 `riserHeight` / `treadDepth` 时，分析器会与几何统计结果进行偏差提示。
- 新增四级楼梯 Mesh 几何测试，验证 4 个高度层、0.18 级高和 0.4 踏面深度的提取。
- 该统计不等于完整楼梯识别：尚未证明各级踏面连续、梯段边缘无断裂、人物胶囊体能逐级通过；验收状态仍保持未认证。


### 几何分析器 CI 回归结果（提交 b56861fc）

- Frontend CI：`modelTraversabilityAnalyzer.test.js` 4/4 通过；全量前端测试 40 个测试文件通过、5 个既有测试文件失败（与前一轮 11559aae 的 5 个失败文件一致）；Vite build 通过。
- Backend CI：NestJS build 通过；单测 96 passed / 1 failed，仍为既有 `image-generation.procedural.spec.ts` 的配置/URL 解析失败。
- 本轮新增楼梯几何统计测试通过；没有引入新的 CI 失败项。
- 真实浏览器、Rapier 运行时的楼梯/坡面行走验收仍未执行。


## 2026-11-10 — 楼梯/坡面 Rapier 三角网格注册（第三阶段）

### 已落地

1. `PhysicsRuntime.createStaticTrimesh()` 新增静态三角网格 Collider API，校验 XYZ 顶点、三角索引、范围和有限数值，再交给 Rapier `ColliderDesc.trimesh`。
2. `collectModelTraversalTrimeshes()` 根据当前模型 Manifest 和实时几何分析结果，定位楼梯/坡面真实部件，提取其 Mesh 顶点，应用完整世界变换并合并三角索引。
3. `refreshModelPhysicsRegistration()` 为通过几何绑定的楼梯/坡面创建 Rapier 静态 trimesh；当同一目标部件另有 Box Collider 声明时，trimesh 替代该部件 Box，避免重叠碰撞体。
4. 每次物理注册刷新都会重新运行 `analyzeModelTraversability`，不使用模型编辑前的旧几何分析结果。
5. 新增/扩展测试覆盖 Rapier trimesh 数据校验、楼梯 Mesh 世界坐标变换、楼梯 Box Collider 替代和碰撞注册。

### CI 状态（提交 867bd4a7）

- Frontend：`modelSpatialRuntime.test.js` 20/20、`PhysicsRuntime.test.js` 12/12、`modelTraversabilityAnalyzer.test.js` 4/4 通过；全量 40 个测试文件通过、5 个既有失败文件仍失败；Vite build 通过。
- Backend：NestJS build 通过；96 passed / 1 failed，失败仍是既有 `image-generation.procedural.spec.ts` 的测试环境 URL 配置问题。
- 以上是 GitHub Actions 测试结果，不是浏览器或真实 Rapier 场景验收。

### 当前能力边界

- 静态 trimesh 已进入物理注册链路，但尚未通过真实角色胶囊体从楼梯底部走到顶部的运行时验收。
- 楼梯级高/踏深统计是几何证据，不证明每级踏步连通、没有缝隙或符合角色碰撞尺寸。
- 坡面三角网格已注册，但坡度阈值、坡面连续性、边缘跌落和滑动行为尚未通过人物测试。
- 门洞净空仍未实现自动几何提取；当前不能仅凭门框 Mesh 判断胶囊体能否穿过。


## 2026-11-10 — 隔离式 Rapier 人物通行探测器（第四阶段）

### 已落地

1. 新增 `src/three/sandbox/modelTraversalTester.js`，通过独立 Rapier World 执行路线探测，不会推进或改变用户正在运行的沙盒物理 World。
2. 探测场景会复制当前模型中声明的楼梯/坡面静态 trimesh、声明为可站立的 Mesh 支撑面，以及其他有效 Box Collider。
3. 使用 `CharacterTraversalProfile` 创建与当前控制器同一参数结构的人物胶囊体；沿 Manifest 的 `startPoint -> endPoint` 水平路线运行固定步长模拟。
4. 诊断终点到达、阻挡/卡住、跌落、无地面接触、超时；缺少起终点时返回 `needs-route-endpoints`，不做猜测。
5. 只有所有已声明楼梯/坡面路线都通过且没有未测试的 passages/connections 时，`certifiedWalkable` 才能为 true。
6. 新增真实 Rapier 集成测试：构造四级楼梯、落地平台和地面 Mesh，使用 Rapier CharacterController 实际从楼梯底部移动到顶部；另有缺少端点的拒绝认证测试。

### 当前边界

- 路线探测目前仅支持声明式楼梯/坡面路线；门洞净空、房间/楼层连接、电梯等还未纳入路线测试。
- 探测使用当前模型声明的碰撞体和支撑面副本；未声明的静态环境对象不会自动进入隔离测试世界，因此模型若依赖沙盒外部地面/平台，必须在测试场景中提供对应支撑几何。
- 当前移动路径为起点到终点的直线水平引导，尚未实现自动绕障寻路；路线失败能报告阻挡/卡住，但不能自动求解替代路线。


### 隔离式人物通行探测器 CI 结果（提交 b0d06b3f）

- `modelTraversalTester.test.js` 2/2 通过，其中包含真实 Rapier CharacterController 四级楼梯上行测试。
- `modelSpatialRuntime.test.js` 20/20、`PhysicsRuntime.test.js` 12/12、`modelTraversabilityAnalyzer.test.js` 4/4 通过。
- 前端全量测试：41 个测试文件通过、5 个既有测试文件失败；与加入本轮功能前的失败集合一致。Vite build 通过。
- 后端 NestJS build 通过；96 passed / 1 failed，仍为既有 `image-generation.procedural.spec.ts` 的 URL 配置失败，PostGIS/API 后续步骤按工作流策略跳过。
- 真实 Rapier 测试证明了当前测试夹具中的楼梯路线可通过；没有执行浏览器里的实际用户场景，也没有对 AI 生成模型样本库进行批量验收。


## 2026-11-10 — MVP 人物通行范围收敛与统一测试规格

### 决策冻结

- 人物物理规格全局唯一；外观模型可以变化，但不允许按单个模型或单次验收临时改变胶囊体尺寸和通行能力。
- MVP 地形范围限定为平地、坡路、楼梯；移动行为限定为普通行走和跳跃。
- 验收状态限定为未测试、通过、失败、缺少必要数据。
- 暂不建设自动寻路/绕障、攀爬、二段跳、多体型人物、复杂动态障碍验收和复杂落点评分。

### 本次代码调整

- testModelTraversalRoutes() 不再接受调用方覆盖 traversalProfile；通行验收固定使用全局 CharacterTraversalProfile，调用方仍可调整测试时长、固定步长和速度等运行参数。
- 更新真实 Rapier 楼梯集成测试：故意传入明显不同的人物尺寸/跨阶参数，验证测试器仍采用全局人物规格，防止通过缩小测试人物来“刷过”模型验收。

### 验证状态

- 代码和测试已写入功能分支；尚未取得本次调整后的 GitHub Actions 结果。
- 未执行本地 Vitest、构建或浏览器验收；不得将本次调整描述为测试通过。


## 2026-11-10 — 基础跳跃落点验收与卡住复位

### 已落地代码

- CharacterTraversalProfile 增加统一跳跃高度和最大水平距离，供玩家控制器与隔离式通行验收共同消费。
- InputController 增加 Space 跳跃；跳跃期间按统一最大水平距离限制空中水平速度，落地后清除跳跃状态。
- InputController 增加 R 复位：回到接入沙盒物理运行时记录的出生位置，并清空按键、寻路和跳跃状态，再同步 Rapier 胶囊体。
- Traversability Manifest 增加开放式 jumps 路线声明；隔离式 Rapier 测试模拟起跳轨迹，并且只有在目标区域内重新接地才通过。未落地、落点偏离或高度异常分别报告失败。
- 新增真实 Rapier 跳跃落点集成测试，使用起跳平台与目标平台验证落地条件。

### 验证边界

- 当前实现是直线跳跃测试，不做自动寻路或自动寻找替代落点。
- R 复位点是进入沙盒时记录的出生位置；后续如需检查点系统，再另行扩展。
- 本轮代码已写入功能分支，等待 GitHub Actions；未执行本地 Vitest、构建或浏览器验收。


### 统一人物规格补充

- 沙盒 InputController 现在直接消费全局默认 CharacterTraversalProfile，不再从旧 CollisionWorld 的半径覆盖人物规格。
- 旧 setPlayerDimensions 仅保留兼容返回值，不再允许外观模型修改人物物理高度/半径；碰撞世界切换时也统一应用标准半径。
- 出生位置仅在首次接入 PhysicsRuntime 时记录，后续 Runtime 重新绑定不会覆盖复位点。


### 跳跃/复位实现 CI 核验（代码提交 cb34ad09）

- 前端 CI：modelTraversalTester.test.js 3/3 通过（含真实 Rapier 跳跃并在目标平台重新接地的测试）；PhysicsRuntime.test.js 12/12 通过；CharacterTraversalProfile.test.js 3/3 通过。新增的跳跃、R 复位和重复跳跃测试均通过。
- 前端全量：513 passed / 6 failed（519 total；46 个测试文件中 41 个通过、5 个既有失败文件）。失败仍为既有 PlayerCharacterRuntime、InputController 坡面断言、solarPosition、modelCapabilityManifest 未知能力保留断言、createBlankSandboxScene 两项；本轮新增测试没有增加失败项。
- Vite build 通过。
- 后端 NestJS build 通过；单测 96 passed / 1 failed，仍为既有 image-generation.procedural.spec.ts 中 shared-secret/chat/completions URL 配置错误。数据库迁移/API 集成/Schema 校验因此跳过。
- 以上为 GitHub Actions 结果，不代表浏览器实测。没有在用户本地环境运行测试；Space 跳跃、R 复位、真实场景落地仍需浏览器验收。
- 代码提交：cb34ad094941642ea97ab19e8e3c3fd6423ad96d；随后仅有计划/进度文档提交。main 未修改，未合并 PR。


### 跳跃水平距离边界修正

- 将空中水平速度上限从起跳第一帧开始执行，避免起跳帧使用普通移动速度造成总跳跃距离略微超出 Profile 上限。
- 对应代码提交：ee3eff8bbb36230b4fb2697c375b89f28fedee75。该提交后的 GitHub Actions 正在执行；上一代码提交 cb34ad09 的跳跃/复位相关测试已通过。


### 最新跳跃实现 CI 结果（代码提交 ee3eff8b）

- 前端 CI：Model Traversal Tester 3/3、PhysicsRuntime 12/12、CharacterTraversalProfile 3/3 通过；InputController 本轮新增跳跃、重复跳跃、R 复位测试通过。全量仍为 513 passed / 6 failed（519 total），失败集合与项目既有基线一致，没有新增失败。
- Vite build 通过。
- 后端 CI：NestJS build 通过；96 passed / 1 failed，仍为既有 image-generation.procedural.spec.ts 的 shared-secret/chat/completions URL 配置错误；数据库集成步骤因此跳过。
- 当前分支 HEAD：ac15ad05c8b14dff90b340bd4b4a706a08c73854（相对 ee3eff8b 仅追加进度文档）。本轮没有浏览器验收或用户本地测试。


## 2026-11-10 — P1：显式静态 Mesh Collider 编译

### 本轮实现

1. 新增 `collectModelDeclaredMeshColliders(THREE, model, ownerId)`，只处理 Manifest 中显式声明的 `spatial.colliders[].shape = "mesh"`，不把普通可见 Mesh 自动注册为碰撞体。
2. 按稳定 `targetPartId/componentId` 定位部件，采集目标部件下的实际 Mesh 顶点与三角索引，并应用 Mesh 完整世界矩阵；生成 Rapier 可消费的 Float32 顶点和 Uint32 索引缓冲。
3. 保留真实碰撞几何拓扑，因此只要模型提供的碰撞网格本身存在门洞/通道开口，运行时不会再用包围盒把开口封住。碰撞网格必须只包含应阻挡玩家的表面。
4. 支持显式禁用、`blocksMovement: false`、模型 `worldState` 的布尔 `stateCondition`；跳过重复 componentId、无效/空几何和隐藏 Mesh。
5. 嵌套的独立 componentId 子组件不会被父级 Mesh Collider 重复收集；目标部件内部可通过 `userData.collisionMode = "none"` 或 `userData.physicsCollision = false` 排除单个视觉 Mesh。
6. 物理刷新先移除同一 owner 的旧注册，再注册楼梯/坡面 Trimesh 与显式 Mesh Collider；同一 targetPartId 的 Box collider 被 Mesh Trimesh 替代，避免双重碰撞体。注册失败会清理该 owner 本轮已创建的物理对象。
7. 更新 AI 生成 Prompt：复杂静态实体可声明 Mesh collider；明确门洞几何保留、水面不得碰撞、水域只允许独立竖直岸线网格，禁止将水体做成实心体；动态/变形网格不允许走静态 Mesh collider 路径。
8. 新增测试覆盖完整世界变换、视觉子 Mesh 排除、碰撞声明门控、stateCondition、Mesh 替代同部件 Box、重复刷新移除旧 owner 注册，以及 Prompt 能力契约。

### 当前能力边界

- 这是显式声明式静态 Trimesh 编译，不是 AI 自动识别任意 Mesh 语义，也不是自动为所有实体补碰撞体。
- 门洞是否可通行取决于生成的碰撞几何是否真实留空；本轮没有自动从渲染模型推导门洞/开口。
- 水域只支持模型提供独立的闭合竖直边界几何并声明为 Mesh collider；自动提取水体轮廓、自动生成岸线尚未实现。
- Trimesh 是静态碰撞表示；动态复杂物体的凸包/凸分解、动态 Mesh 更新、网格简化/焊接/退化三角面清理尚未实现。
- 本轮没有执行本地 Vitest、前后端构建或浏览器实测；代码测试等待 GitHub Actions。不能将 CI 前的测试写入描述为通过。

### 仓库与提交

- 分支：`feat/world-sandbox-conversational-model-editor`
- 本轮从 `9af03b198905eca41eb3c26812589574beb30f5e` 开始；仅更新该功能分支，未修改 main、未合并 PR。
- 核心实现和测试已提交；本条进度文档提交后需远程回读并核对最新 HEAD 与 Actions 状态。


## 2026-11-10 — 模型空间碰撞 P0：AI 与 Runtime 能力契约对齐

### 本轮改动

1. 更新程序化模型生成 Prompt，明确当前物理执行边界：普通 `spatial.colliders` 只执行 Box blocker；楼梯/坡面真实几何另走静态 Rapier Trimesh 路径；支撑面声明不等于通用碰撞生成；通道/连接等未落地能力不得宣称可运行。
2. 明确普通实体阻挡部件必须绑定真实 componentId 并声明 Box blocker，门洞/通道必须拆分；装饰薄片、叶片、线缆和玻璃等不得无差别阻挡。
3. 明确水体的当前限制：水面 Mesh 不会自动阻挡，也不应成为站立面；只有在当前 Box/AABB 能力下可以可靠构成连续闭合岸线时才声明边界阻挡，不能宣称通用水域自动编译已完成。
4. 修正 `refreshModelPhysicsRegistration` 注释，准确描述当前同时注册声明 Box 和楼梯/坡面 Trimesh，而非只注册 Box。

### 验收边界

- 新增服务端 Prompt 契约断言，锁定上述执行范围，防止未来 Prompt 再次把未实现能力描述为已支持。
- 本轮只完成 P0 契约对齐，不包含通用 Mesh 自动碰撞、凸分解、水域边界自动生成或浏览器验收。
- 代码和文档写入后需回读确认；CI 状态以本轮提交后的 Actions 为准，不能沿用历史结果。


## 2026-11-10 — 模型碰撞完整性诊断与生成前定向修复

### 已落地

1. 新增 `analyzeModelCollisionCompleteness()`，对当前 Three.js Object3D 与 Manifest 执行声明级审计。
2. 每个有意义 component Group 由 AI 显式设置 `userData.collisionPolicy = "required" | "none"`；required 部件必须绑定可执行 Collider，none 部件保持非阻挡。
3. 诊断器检查重复 componentId、重复/缺失 Collider ID、目标部件缺失或歧义、shape 不支持、Box 尺寸/中心非法、Mesh 几何不可用、布尔状态条件非法、required 部件缺失活动 Collider、视觉部件却声明 Collider 等问题。
4. `refreshModelPhysicsRegistration()` 会把诊断结果写入 `model.userData.proceduralModelCollisionAnalysis`，供运行时和 UI 读取。
5. 后端新增 `POST /assets/ai-image/repair-procedural-collisions`，只接受已知诊断代码，构造受限的修复指令并复用现有程序化模型编辑服务；诊断字段按数据处理，不作为指令执行。
6. `WorldSandboxMvp.vue` 在 AI 生成模型进入可保存草稿前先运行碰撞检查；最多触发一轮 AI 定向补齐并重新执行 Worker 构建与检查。检查未达到 `complete` 时阻止模型落位；保存前再次检查，防止编辑后引入缺失声明。
7. 更新初次生成和后续编辑 Prompt，要求每个有意义部件明确 collisionPolicy，并使用 Runtime 当前支持的 Box/Mesh Collider。

### 当前验收边界

- 诊断结果 `complete` 只代表当前声明、目标绑定和基本几何数据满足 Runtime 接入前置条件，不证明门洞/窗洞净空、岸线闭合、复杂网格拓扑质量或人物胶囊体真实通行。
- 纯视觉部件是否应阻挡仍依赖 AI 对几何意图的判断；系统不会按“建筑/树木/水体”等类别硬编码碰撞规则。
- 自动修复最多一轮；仍未通过时明确阻止模型进入沙盒，保留草稿供进一步人工/对话修复。
- 本轮未执行本地 Vitest、前后端构建或浏览器操作；需要以最新 GitHub Actions 和后续浏览器验收为准。


### 碰撞完整性门禁 CI 结果（提交 f152da26）

- Backend CI：NestJS Build 通过；11 个测试套件 99/99 通过；PostGIS migrations、API integration（10/10）和 schema verify 全部通过。
- Frontend CI：`modelCollisionAnalyzer.test.js` 7/7、`modelSpatialRuntime.test.js` 25/25、`modelTraversalTester.test.js` 3/3 通过；全量 525 passed / 6 failed（531 total，47 个测试文件中 42 个通过、5 个既有失败文件）。失败仍为 PlayerCharacterRuntime、InputController、solarPosition、modelCapabilityManifest、createBlankSandboxScene，与本轮新增碰撞功能无关；Vite build 通过。
- 本轮新增的模型碰撞诊断、运行时诊断挂载和前端自动修复/落位门禁均通过对应自动化测试与构建检查。
- 未执行浏览器实测；尚未在真实生成模型样本上验证 AI 能否稳定判断每个部件的 required/none 策略，也未验证门洞、水域边界和人物胶囊体实际通行。
- CI 工作流：Frontend `42676443612`（测试步骤因既有基线失败而整体失败，Build 通过）；Backend `42676443600`（success）。


## 2026-11-10 — 真实人物碰撞验收：隔离测试世界补齐 Mesh 与 Passage

### 本轮实现

1. 修复验收链路不一致：testModelTraversalRoutes() 原先只复制楼梯/坡面 Trimesh、支撑面和 Box 阻挡体，没有把正式运行时支持的显式静态 Mesh Collider 复制进隔离 Rapier World。
2. 现在通过 collectModelDeclaredMeshColliders() 收集真实世界变换后的顶点/索引，并在隔离世界注册静态 Rapier Trimesh；与楼梯/坡面目标重合时避免重复注册。
3. 将 traversability.passages 纳入人物路线测试。提供真实 targetPartId 和起终点后，使用同一全局人物胶囊体执行直线路径测试；connections 仍未验收。
4. 新增真实 Rapier 场景测试：
   - 建筑门洞：使用门框两侧立柱和横梁构成保留开口的 Mesh Collider，验证人物能够通过。
   - 山体：实体 Mesh 阻挡路径，验证人物不能穿过。
   - 水域：独立竖直岸线阻止人物进入；高于岸线的桥面保持可通行。
   - 原有楼梯上行与跳跃落点测试继续保留。

### 验收边界

- 本轮新增测试已提交，等待 GitHub Actions；尚未执行本地 Vitest、浏览器验收或真实 AI 模型样本批量回归。
- 门洞/山体/水域结果目前是合成 Three.js 几何夹具的 Rapier 集成测试，不等于真实 AI 生成资产已经全部通过。
- 水域自动提取轮廓和自动生成岸线仍未实现；当前要求模型提供独立竖直边界 Mesh。
- passage 只验证声明起终点之间的直线路径；不提供自动寻路，也不覆盖所有可能入口。
- 测试通过仅代表该测试几何和全局人物规格下的结果，不得外推为所有模型都不会穿模。

### 仓库状态

- 分支：feat/world-sandbox-conversational-model-editor
- 仅更新功能分支；main 未修改，未合并 PR。


## 2026-11-10 — 程序化模型生成响应诊断

### 问题定位

- 用户在浏览器触发完整模型生成后，服务端返回“视觉模型未返回程序化 Three.js 源码”。
- 对照当前分支源码，错误发生在模型 API 响应解析阶段：旧逻辑只接受 `choices[0].message.content` 为非空字符串；若上游返回 typed text content 数组、空 content、拒绝响应或仅有 reasoning 字段，都会被统一误报为“没有源码”。
- 仅凭现有错误无法判定 DeepSeek 网关本次实际返回了哪一种结构；此前代码没有记录响应形状、finish_reason 或 usage，因此不能将根因直接归咎于模型本身。

### 本轮改动

1. 程序化模型生成响应现在兼容 OpenAI 兼容接口中明确标记为 `text`/`output_text` 的文本分段，并拼接为源码候选。
2. 不把 reasoning、refusal 或任意对象当作可执行源码；保留原有 createModel 工厂与源码长度校验。
3. 当响应没有可用文本时，服务端记录受限诊断信息：响应模型/ID、choice 数量、finish_reason、message keys、content 类型/分段类型、refusal/reasoning 是否存在、上游错误摘要和 token usage。不会记录 API Key 或完整模型响应。
4. 对外错误附带 contentType 和 finish_reason，便于区分空响应、结构不兼容和输出长度终止。
5. 新增测试覆盖 typed text content 归一化，以及仅返回 reasoning 且 finish_reason=length 的失败诊断。

### 验证边界

- 本轮修改尚未执行本地 Jest、NestJS Build 或 GitHub Actions；不得视为测试通过。
- 这轮属于响应协议兼容与可观测性修复。若 DeepSeek 返回的是空 content / reasoning-only / token 截断，仍需根据新增诊断判断是否需要调整请求参数或模型输出预算；本轮不会把 reasoning 当源码，也不会自动重试消耗额外模型额度。
- 浏览器端尚未复测；需重新生成一次，并根据服务端日志确认真实响应结构。


---

## 2026-11-10 — 玩家输入连续性与铰链门碰撞同步（第一阶段）

### 本轮目标

针对浏览器综合测试反馈，先处理键盘输入/跳跃容错和开门状态下门扇碰撞的基础缺口。水深问题单独梳理，避免在没有确认“水深”语义前把表面高度、底部深度和人物浮力混为一个参数。

### 仓库与边界

- 仓库：`southyouth-team/ncgxy_map`
- 工作分支：`feat/world-sandbox-conversational-model-editor`
- 本轮基线 HEAD：`211439278933d47e0ec948d7ff16a8db563ac0cf`
- 所有代码与文档写入均显式指定功能分支；没有向 main 写入，没有创建 PR。
- 本轮不调整 CharacterTraversalProfile 的人物胶囊体尺寸、跳跃高度 1.1 或最大跳跃距离 3.0；不更换 Rapier 物理引擎。

### 实际代码变更

1. `src/three/controls/InputController.js`
   - 新增按 `KeyboardEvent.code` 优先的输入归一化；keydown/keyup 使用同一规则处理 WASD、方向键、Shift、Space 和 R。
   - 页面隐藏、窗口失焦时清理按住状态和待消费跳跃缓冲。
   - 增加默认 140ms Jump Buffer 和 100ms Coyote Time；这两个窗口只改善输入容错，不改变跳跃物理规格。
   - 模式切换、传送、复位和禁用移动时清除残留跳跃缓冲。
   - 虚拟按键入口统一归一化大小写/方向键值。

2. `src/three/controls/InputController.test.js`
   - 新增物理按键码与 keyup 归一化一致性测试。
   - 新增虚拟方向键和失焦清理测试。
   - 新增 Jump Buffer 与 Coyote Time 测试。
   - 测试已写入仓库，尚未执行。

3. `src/three/engine/modelSpatialRuntime.js`
   - Box Collider 注册 Rapier 时不再只传世界 AABB。
   - 新增保留目标部件世界位置、旋转和缩放的 oriented-box 数据；Rapier 物理路径将旋转四元数传给 Static Box。
   - CollisionWorld 平面回退路径仍保留原有保守世界 AABB 行为。

4. `src/three/engine/modelSpatialRuntime.test.js`
   - 将铰链门测试改为验证开门后门扇 Collider 仍存在且随部件旋转。
   - 新增验证 Rapier Static Box 接收门扇旋转四元数和缩放后的半尺寸。
   - 测试已写入仓库，尚未执行。

5. `server/src/modules/assets/image-generation.service.ts`
   - 修正 AI 建模契约：铰链门扇 Collider 在开/关状态下都保持启用；门状态驱动门扇旋转，Collider 跟随同一部件 Transform。
   - 明确门洞通行来自墙体真实开口，而不是删除门扇自身碰撞体。

6. 项目文档
   - `PROJECT_PLAN.md` 新增键盘输入、跳跃缓冲和铰链门碰撞同步约束。
   - 明确 Rapier Box 保留 OBB Transform；stateCondition 不应用于具有铰链 Transform 的实体门扇。

### 当前未完成与注意事项

- 行走/加速间歇停顿：已修正键值归一化和焦点状态清理路径，但仍需在浏览器持续按住 WASD/Shift 验证；目前不能认定已完全解决。
- 跳跃：Jump Buffer/Coyote Time 已实现，固定步长下的垂直速度积分一致性仍需专项检查。
- 门：新生成/编辑的铰链门应按新 Prompt 生成；已有门模型若 Collider 声明包含 doorOpen stateCondition，需要重新生成或定向编辑 Manifest。浏览器尚未验证。
- 水深：本轮没有修改水体 Runtime。现有检查未发现通用水体深度/人物浸入 Runtime 契约；下一步需先明确参数代表“水面相对地面高度”还是“水面固定、仅水体向下厚度”，再定义通用空间体与人物涉水行为，不能只改水面视觉。
- OBB 对包含非均匀父级缩放与子级旋转的复杂层级可能出现矩阵分解近似；后续需要增加嵌套 Transform 测试，复杂模型必要时改用 Trimesh/复合碰撞。

### 验证状态

- 代码写入：已提交到功能分支。
- 源码回读：需在最终核验中确认最新文件内容和 HEAD。
- 自动化测试：本轮新增测试尚未执行。
- 前端构建：未执行。
- 后端测试/类型检查：未执行。
- GitHub Actions：需检查最新 HEAD 对应 workflow 状态；未取得成功记录前不标记通过。
- 浏览器验收：尚未执行；需验证持续走路/加速、落地前按跳、离开平台边缘后按跳、门扇开关时碰撞同步。
- main：本轮开始核对为 `608a9f2c1f739cd581acb833b1e70410672e258b`；最终需再次核验保持不变。

### 下一步

1. 在当前分支执行 InputController、PhysicsRuntime、modelSpatialRuntime 相关单测和前端构建。
2. 核对跳跃重力积分是否严格随 Rapier 固定步长推进，避免渲染帧率影响跳跃高度/时长。
3. 明确水深参数语义后，设计并实现通用空间体/涉水 Runtime，不按模型类别硬编码。
4. 浏览器回归后再决定是否继续相机插值或动画层优化。


### 本轮 CI 与最终核验补充

- 最新代码提交：`e7b74f844f032cb5b9f12044c02641b163287efa`；其后本记录文档提交会推进分支 HEAD。
- Frontend CI（run `42688364917`）：**失败**。单测汇总为 532 passed / 7 failed（539 total）；前端 Build 步骤成功。失败项分别为 PlayerCharacterRuntime 视觉模型替换断言、InputController 陡坡支撑测试、modelCapabilityManifest 未知字段断言、modelTraversalTester 水域/桥梁路线测试、solarPosition 夜间方向断言、createBlankSandboxScene 玩家可见性断言和地块扩建边界断言。新增的键盘归一化/跳跃窗口用例未出现在失败列表；modelSpatialRuntime 新增门扇 OBB 用例也未出现在失败列表。由于整套单测未通过，本轮不能标记 Frontend CI 通过。
- Backend CI（run `42688364801`）：查询时仍为 in_progress，尚无结论。
- 最终核验时 main HEAD 仍为 `608a9f2c1f739cd581acb833b1e70410672e258b`，未修改 main。
- 浏览器验收：本轮没有实际运行本地页面；用户此前的综合场景测试不能替代本轮键盘/门扇代码变更后的浏览器回归。
- 当前水体深度仍未接入运行时。需要明确“深度”参数应驱动水面相对地面的高度（影响人物浸入高度），还是只改变固定水面下方的水体厚度；两者对应不同的空间模型，不能用一个参数混用。


### CI 失败原因追踪与测试契约修正

- Backend CI（run `42688364801`）在 NestJS Build 成功后，单测 `image-generation.procedural.spec.ts` 因 Prompt 文案断言仍期待旧描述 `shape:"mesh" blockers as static Rapier triangle meshes` 而失败；不是 TypeScript 编译错误或服务运行错误。
- 已将该断言更新为当前实际执行契约，并增加门扇 Collider 开/关状态保持启用、跟随部件 Transform 的 Prompt 断言。测试修改提交：`b6169ac69bcdb19a95f0051b5d831d07ad102841`。
- 最新代码提交之后 CI 需重新执行；不能沿用旧 run 的失败/成功结论。
- 再次检查生成 Prompt，已确认不存在“开门时移除门扇 Collider”及“Rapier Box 一律使用 AABB”的旧指导语句。


### 固定步长重力积分补充

- 进一步确认人物跳跃/下落的重力原先由 InputController 按渲染帧 delta 积分，而 Rapier 按固定 1/60s 子步求解；这会导致不同渲染帧率下垂直速度曲线不同。
- `PhysicsRuntime` 新增运动学角色加速度输入，固定物理子步内积分加速度；角色状态同时返回物理速度。
- `InputController` 不再对 Rapier 角色按渲染帧积分重力，而是提交重力加速度并读取物理速度；非 Rapier 的旧 CollisionWorld 路径保持原有独立更新方式。
- 新增 30/60/120Hz 渲染频率模拟测试，以及 InputController 空中重力委托测试；均已写入，尚未执行。
- 新增/更新代码提交：`075c09e1d5b195300f4e7e2107e49eda46a726e5`、`911540b37b264195f8f5212fce393a0a537af15c`、`6d5ea0018bd9117abdbd83db21efe5ba286fa2fb`、`a1192ca772b84c35d30cf970bbcee9ab449bb386`；计划文档提交：`359dd2a06efde461c8dac858749630f657211c4c`。
- 本项仍需 CI 和浏览器验证；特别检查跳跃高度/距离上限、落地清零、离开平台后自由下落和不同刷新率下轨迹一致性。


### 固定步长改动后的 CI 状态（HEAD `927e4159f9dda6957a31e72d86d1645119215c9a`）

- Frontend CI（run `42689392590`）：单测 534 passed / 7 failed（541 total），前端 Build 成功。失败仍为同一组既有失败项；新增的 InputController、PhysicsRuntime 固定步长加速度测试未出现在失败列表，门扇 OBB 测试也未出现在失败列表。
- Backend CI（run `42689392495`）：查询时仍在执行；此前 `a1192ca772b84c35d30cf970bbcee9ab449bb386` 对应 Backend CI 已成功，包含更新后的 Prompt 测试修正之前的服务端逻辑构建/测试；最新提交仍需以当前 run 为准。
- 当前全量 Frontend CI 仍不通过，不能将本轮标记为整体 CI 通过。浏览器验收仍未执行。


---

## 2026-11-10 — 玩家跳跃状态与铰链门碰撞修复

### 本轮代码变更

- 工作分支：`fix/sandbox-character-physics-continuity`
- 基于：`feat/world-sandbox-conversational-model-editor`
- `src/three/controls/InputController.js`
  - 增加 `jumpWasAirborne` 状态。
  - Rapier 首个起跳物理步仍报告 grounded 时，不再误判为落地并提前清除跳跃状态。
  - 只有角色实际离地、随后重新接触支撑面，才结束本次跳跃。
  - 传送、重置和禁用移动时同步清理跳跃飞行状态。
- `src/three/controls/InputController.test.js`
  - 增加首个起跳物理步仍 grounded 的回归用例。
  - 覆盖离地后重新落地才结束跳跃的状态转换。
- `src/three/engine/modelSpatialRuntime.js`
  - 对带有同一状态键旋转绑定的活动部件，不再因 `stateCondition` 而删除其自身碰撞体。
  - 铰链门扇的碰撞体随门扇世界 Transform 重建；固定门洞阻挡体仍可使用状态条件开关。
- `src/three/engine/modelSpatialRuntime.test.js`
  - 将原先“开门即删除门扇碰撞体”的测试改为验证门扇打开后仍有 Rapier Box Collider，且旋转四元数同步。

### 提交记录

- `bf50bdeced8565dd9e5508a9b142638203d8cc85` — 跳跃状态修复
- `0b1e096431dd3e6ba64e53f2091b4b6ccd8baedb` — 跳跃回归测试
- `f013fdf8ffdc3919e4982f6116ce86ffdcfa3e95` — 铰链门扇碰撞同步
- `dc8e97d833fd23ba14ef6ab6a76b8970fd1feb0b` — 门扇碰撞回归测试
- `349d2d00c88840895a6b379699b564489c7e559d` — 传送/禁用移动时清理跳跃状态

### 尚未完成与验证边界

- 行走/加速间歇：本轮已核对输入状态和主循环顺序，但尚未获得实际浏览器运行环境，不能把间歇问题标记为已修复；需要在真实运行时采集输入状态、帧间隔、Rapier stepCount 和角色位移。
- 水体深度：当前 MVP 没有水体体积/水面高度/水底高度到人物涉水状态的完整 Runtime。现有生成约束只描述水面和可选岸线碰撞，不存在可执行的深度参数契约。因此本轮没有伪造一个只改变外观的深度滑块。后续需先定义 water volume 数据契约，再接入参数、场景空间和角色涉水计算。
- 自动化测试、前端构建和浏览器实测：当前会话没有本地仓库执行环境，尚未执行；不得标记为通过。
- 本轮没有向 `main` 写入，也没有合并 PR。

## 2026-11-10 — 移动意图与水体深度运行时（增量）

### 已落地

1. InputController.hasMovementInput() 统一暴露键盘/虚拟方向键和自动寻路的持续移动意图。
2. createCampusEngine 的角色动画状态不再只依赖单个渲染帧的 XZ 位移差；Rapier 固定步长与渲染帧未对齐时，不会因某一帧位移为零而立即切回 idle。
3. getPhysicsDiagnostics() 增加 accumulator、stepCount、按键集合、移动意图、grounded、期望速度和角色位置，用于区分输入丢失、物理步进和实际位移问题。
4. 新增 waterVolumeRuntime.js：
   - 从 modelCapabilityManifest.capabilities.spatial.waterVolumes 收集声明式水体感知区。
   - 使用局部 XZ 范围、固定 bottomY 和 depth 计算水底/水面高度。
   - 支持参数绑定 spatial.waterVolume.<id>.depth，并在每次采样时读取 proceduralModelParameterValues 的最新值。
   - 计算 immersionDepth、depthRatio 和 characterImmersionRatio；沙盒引擎通过 onPlayerWaterStateChange 回调状态变化，并暴露 getPlayerWaterState()。
5. 生成规范补充水体数据契约：水深表示固定水底到水面的垂直距离；水体感知区不是实体 Collider，不自动改变通行、浮力或站立规则。
6. 新增水体 Runtime 单元测试，覆盖动态参数、边界外采样和无效声明过滤。

### 当前边界 / 尚未验收

- 行走/加速的实际物理位移间歇尚未定位根因。当前修改先消除渲染帧与固定物理步长不同步导致的动画 idle 闪断，并补充诊断字段；不能标记为角色移动问题已彻底修复。
- 水体 Runtime 当前输出浸水数据，不负责自动改变水面 Mesh 几何，也不负责浮力、游泳控制或水域阻挡。生成模型需要让可见水面与 bottomY + depth 保持一致。
- 参数实时生效依赖模型参数绑定和 proceduralModelParameterValues 被正确写入；若模型未声明绑定，Runtime 使用 waterVolume 自身的 depth 默认值。
- 当前只支持水平水面（允许绕 Y 轴旋转的水体区域）；倾斜水面会被跳过，不会伪造垂直水深结果。
- 本轮尚未执行 Vitest、Vite build、CI 或浏览器实测。新增测试只代表已写入测试代码，不代表测试通过。
- 没有修改或合并 main。

### CI 回归（2026-11-10，本轮提交 35d4a023）

- GitHub Actions Frontend CI：Vite production build 通过。
- Vitest：48 个测试文件中 41 个通过、7 个失败；547 个测试中 539 个通过、8 个失败。
- 新增 waterVolumeRuntime.test.js 已在 CI 中通过（3/3）。
- 与本轮开始前分支提交 0d70aed8 的 CI 对比：失败文件仍为相同的 7 个、失败用例仍为 8 个；本轮新增 1 个测试文件且没有增加失败数。
- 失败仍涉及 PlayerCharacterRuntime、InputController、modelSpatialRuntime、solarPosition、modelCapabilityManifest、modelTraversalTester、createBlankSandboxScene。InputController 当前失败断言位于既有测试第 210 行；尚未归因于本轮新增的移动意图测试。
- 该结果不是全量 CI 通过；浏览器/Rapier 实际移动、水体浸入效果仍未验收。
- 最新分支头 `ca0c03c9` 的 Frontend CI（run 42693619611）：Vite build 通过；548 个测试中 540 通过、8 失败，仍是相同 7 个失败文件/8 个失败断言。新增 waterVolumeRuntime 测试通过；失败总数未增加。
- 当前分支头 CI 仍为 failure，不能视为验收通过；失败详情见 https://github.com/southyouth-team/ncgxy_map/actions/runs/42693619611。

## 2026-11-10 — Rapier 实际位移诊断与水体浸入状态可视化（增量）

### 本轮实现

1. `src/three/physics/PhysicsRuntime.js`
   - 每个固定物理子步记录角色刚体前后位置。
   - 计算实际位移 `lastStepMovement` 与实际速度 `actualVelocity`。
   - `getKinematicCharacterState()` 保留原 `velocity` 兼容语义，同时新增 `commandedVelocity`、`actualVelocity`、`lastStepMovement`。
   - 角色传送时清零实际速度/位移诊断，避免把传送距离误判成运动速度。
2. `src/three/physics/PhysicsRuntime.test.js`
   - 新增固定步长实际位移与命令速度分离的测试。
3. `src/three/engine/createCampusEngine.js`
   - `getPhysicsDiagnostics()` 增加 Rapier 刚体真实位置、真实速度、最后一个物理子步位移和物理步计数。
   - 诊断不再只暴露 CameraRig 逻辑坐标与期望速度，后续可以区分“有输入但物理没推进”“物理推进但被阻挡”“刚体已移动但相机/角色视觉未同步”。
4. `src/components/WorldSandboxMvp.vue`
   - 接收引擎已有的 `onPlayerWaterStateChange` 回调。
   - 玩家处于声明式水域且有浸入时，页面显示水深、水面高度、浸入深度和角色浸入比例，便于验证参数变化是否真正进入 Runtime。

### 参数链路审查结果

- `ProceduralModelEditor.vue` 的参数控件会发出 `parameter-change`，包含参数 ID、当前值和值集合。
- `WorldSandboxMvp.vue` 的 `handleParameterChange()` 将参数值写入 `proceduralModelParameterValues`，并通过 Worker 重新执行模型源码；已放入沙盒的模型会通过 `replaceSandboxModel()` 触发空间注册刷新。
- `waterVolumeRuntime.js` 按 Manifest 的 `spatial.waterVolume.<id>.depth` 绑定读取同一个参数值。因此参数更新链路在源码层是连通的；但可见水面是否随参数改变，仍取决于 AI 生成源码是否确实用该参数更新水面几何/位置，尚未做真实模型浏览器验收。
- 本轮新增的是浸入数据 HUD，不是角色材质裁切或真实水线渲染；不能把 HUD 等同于完整水下视觉效果。

### 上一轮 CI 失败详情（run `42693619611`）

- Frontend Build 成功；Vitest 540/548 通过，8 项失败。
- `InputController.test.js`：陡坡测试期望地面高度 4.1，实际回退到人物默认眼高 1.7；这是地面探测测试契约/实现语义问题，不是本轮移动意图测试断言。
- `modelSpatialRuntime.test.js`：铰链门测试期望两个 Collider，实际找到一个；需检查测试场景的 Collider 声明和 OBB 注册条件。
- `PlayerCharacterRuntime.test.js`：旧测试仍期待 fallback 角色的旧 Mesh 层级/对象存在，与当前角色挂载结构不一致。
- `solarPosition.test.js`：夜间方向断言期望太阳方向 Y 大于 0，实际为负值；需确认夜间/月光方向测试约定。
- `modelCapabilityManifest.test.js`：测试未将规范化新增的空 `environmentBindings` 字段纳入期望对象。
- `modelTraversalTester.test.js`：水域/桥梁路线测试期望 `certifiedWalkable=true`，但分析器按当前认证边界返回 false；需核对该测试是否遗漏路线/碰撞声明或期望过度外推。
- `createBlankSandboxScene.test.js`：仍期待旧角色接触阴影对象以及旧世界扩建边界，和当前实现输出不一致。
- 上述失败涉及既有测试/契约漂移，不应为了让 CI 变绿而盲目放宽运行时校验；逐项核实测试意图后再修正。

### 验证状态与边界

- 本轮代码写入目标分支；尚未取得本轮新提交对应的 CI 结果。
- 新增 PhysicsRuntime 测试尚未由本轮 CI 执行。
- Vite Build、Vitest 和浏览器测试均不能提前标记通过。
- 移动根因仍待浏览器采集新诊断数据；当前增加的是观测能力，不是移动行为修复。
- 水体 HUD 只能显示 Runtime 计算结果；实际水面几何联动和角色水线视觉仍待验收。
- 未修改 `main`，未合并 PR。


## 2026-11-10 — 水体浸入语义修正、移动诊断入口与 CI 复核

### 本轮新增/修正

1. **水体浸入计算**
   - `waterVolumeRuntime.js` 将水体总深度与角色浸入深度分开。
   - `depth` 仍表示水底至水面的真实水深；`immersionDepth` 现在限制在角色脚底至头部高度范围内，不能超过角色身高。
   - `characterImmersionRatio` 以角色身高为分母；深水区不再出现浸入深度大于角色身高的错误结果。
   - `waterVolumeRuntime.test.js` 新增 3m 深水、1.7m 角色身高的回归用例；4 项测试均在 CI 通过。
   - 该修正改善浸入数据的物理语义，但不等于完成角色模型上的真实水线裁切/水下材质效果。
2. **移动/物理诊断入口**
   - `WorldSandboxMvp.vue` 新增仅开发环境启用的诊断面板。
   - 访问沙盒页面时附加查询参数 `?debug=physics`，即可查看持续输入、按键集合、期望速度、Rapier 实际速度、刚体位置、角色逻辑位置、固定物理步数和 accumulator。
   - 面板每 150ms 采样一次，离开页面会清理定时器；正常页面不启用轮询。
   - 该面板用于定位移动停顿：期望速度非零但实际速度为零，表示物理未推进或碰撞阻挡；刚体位置变化而逻辑位置不变，表示同步链路异常。
3. **回归修正**
   - `InputController.js`：角色当前脚底正落在已声明但坡度不可行走的表面上时，解析地面高度不再把角色瞬间吸附到全局地面高度；该表面仍然不可行走，只保留当前高度。
   - `modelSpatialRuntime.test.js`：铰链门测试夹具补充门扇自身的 `rotationY` 状态绑定，匹配“门扇 Collider 随门扇旋转并持续存在”的运行时契约。

### 最新 CI（run `42741449280`，commit `23d8b685bdc1b3f3c1a10298c98fa4e83d2ecd71`）

- Vite production build：通过。
- Vitest：48 个测试文件中 43 个通过、5 个失败；550 项测试中 544 项通过、6 项失败。
- `waterVolumeRuntime.test.js`：4/4 通过。
- 上一轮 `InputController` 陡坡测试与铰链门 Collider 测试已从失败列表消失。
- 当前剩余 6 项失败：
  - `modelTraversalTester.test.js`：测试把“预期被水体阻挡的路线失败”和“所有声明路线都必须通过”的整体认证条件同时要求成立，测试语义互相矛盾；需要明确区分预期阻挡路线与可通行认证路线。
  - `createBlankSandboxScene.test.js`：2 项旧断言仍依赖场景内置角色模型和旧世界边界；需要核对现有独立角色运行时/扩展边界契约后更新测试。
  - `modelCapabilityManifest.test.js`：1 项旧断言未纳入归一化新增的默认 `environmentBindings` 字段。
  - `PlayerCharacterRuntime.test.js`：1 项旧断言仍期待旧 fallback mesh 层级，需按“稳定 anchor + 独立 visual wrapper”现行结构核对。
  - `solarPosition.test.js`：1 项夜间月光方向断言与当前方向向量约定不一致，需先确认灯光方向定义再改。
- CI 仍为 failure；不能将本轮标记为全量通过。

### 当前用户侧验证方式

- 在开发环境打开沙盒页面并添加 `?debug=physics`。
- 按住 W/A/S/D 连续移动；若出现停顿，观察输入是否仍保持、期望速度是否仍非零、实际速度是否归零、物理步数是否增长。
- 进入水域时查看水深、水面高度、浸入深度和浸入比例；调节水深参数后检查这些值是否同步变化。
- 仍需真实浏览器验收；CI 单测不能替代实际键盘连续输入、碰撞场景和可视水线测试。

### 安全边界

- 所有改动仍在 `fix/sandbox-character-physics-continuity`。
- 未修改 `main`，未合并 PR。


## 2026-11-10 — 可见水面与深度参数联动

### 实现

- 水体声明新增可选但新生成模型应提供的 `surfacePartId`，指向水体容器 `targetPartId` 的直接子级水平水面 Group。
- 水面 Group 在模型默认状态下按 `bottomY + depth` 放置；Runtime 记录其初始局部 Y，并按当前深度参数相对声明默认深度的变化量移动水面 Group。
- 这样，参数编辑重新执行模型并刷新空间注册时，水面几何位置与 Water Volume 采样使用的深度同步，不再只改变传感数据。
- AI 生成提示已更新：要求显式创建水体容器和独立水面部件，并声明 `surfacePartId`；水体传感器仍不创建实体 Collider、不提供浮力或通行规则。
- `waterVolumeRuntime.test.js` 验证默认深度 0.6m 调整到 1.2m 后，水面 Group 的局部 Y 同步移动到 1.2m；深水浸入上限测试也保留。

### CI 复核（run `42741923423`，commit `d379b90b7291dfc69455a46eae1e972b4eb9ccfa`）

- Vite production build：通过。
- Vitest：48 个文件中 43 个通过、5 个失败；550 项中 544 项通过、6 项失败。
- `waterVolumeRuntime.test.js`：4/4 通过，包含水面参数联动和深水浸入上限。
- 失败项仍是前文记录的 6 项；移动陡坡与铰链门 Collider 两项已通过。
- CI 仍未全绿；水面联动尚未通过真实 AI 生成模型的浏览器实测。旧模型若没有 `surfacePartId`，仍只参与浸入采样，不会自动移动可视水面；需要重新生成或补齐该字段。


## 2026-11-10 — Frontend CI 全量恢复通过

最新验证：GitHub Actions Frontend CI run `42742327694`，commit `3bf248a5a50ec03b3bebee76187fd19d243959cb`。

- Vite production build：通过。
- Vitest：48/48 个测试文件通过。
- 测试用例：550/550 通过。
- 本轮修复/校准的测试契约包括：
  - 角色站在不可行走陡坡时保持当前高度，不被错误吸附到默认地面。
  - 铰链门测试夹具明确绑定门扇旋转状态，验证门扇 Collider 随旋转保留。
  - 水体深度参数与可视水面部件位置联动；深水浸入深度不超过角色身高。
  - Traversal 测试区分“被预期阻挡的路线”与“成功通过的路线”；若声明路线包含被阻挡项，整体 `certifiedWalkable` 应为 false。
  - 角色 fallback visual 在外部模型加载后保留但隐藏，场景角色使用当前共享 3D 模型层级。
  - 环境能力 Manifest 的默认 `environmentBindings`、夜间月光方向和沙盒扩展边界测试与当前实现契约一致。
- 该 CI 结果只证明当前自动化测试与生产构建通过；尚未替代真实浏览器中的持续键盘输入、动态碰撞、水面可视高度和角色水线验收。

## 2026-11-10 — Rapier 输入时序与步态驱动修正（待 CI）

### 本轮代码调整

- createCampusEngine.animate() 将普通移动帧顺序调整为：先提交 InputController.update(delta) 的移动意图，再执行 PhysicsRuntime.step(delta)，最后从 Rapier 同步角色锚点。
- 楼梯过渡期间仍保持独立过渡更新顺序，不把键盘移动输入混入过渡过程。
- InputController.syncPlayerFromPhysicsState() 在物理步完成后同步玩家逻辑位置和 grounded 状态；不更新 lastPhysicsStepCount，避免吞掉下一帧跳跃落地状态检测。
- 角色步态改为读取 Rapier 最后一个固定步的 actualVelocity，不再把持续按键视为角色确实移动。被碰撞体阻挡时实际速度归零，动画应回到 idle；无 Rapier 状态时使用实际帧间位移回退。
- 动画方向增量由实际物理速度乘当前渲染帧 delta 得出，降低固定物理步之间的方向信息闪断。

### 验证边界

- 新增 InputController 物理位置同步单测；需等待分支 CI 验证。
- 本轮尚未进行真实浏览器持续移动/碰撞验收。若仍然卡住，下一步依据 ?debug=physics 的 commandedVelocity、actualVelocity、stepCount、grounded 和物理位置判断碰撞阻挡或物理步进停滞。
- 本轮未修改 main，未合并 PR。

## 2026-11-10 — 移动意图与实际步态解耦

### 本轮实现

- 角色动画的 moving 状态改为“移动意图 OR 实际位移”：按住方向键或自动寻路时，即使 Rapier 当前速度为 0（例如顶住墙体），仍保留迈步反馈，不会直接切回 Idle。
- Rapier 实际速度只用于计算步态频率：正常移动随实际速度变化；持续受阻时使用低频轻量迈步，避免高速原地跑。
- 内置角色步态增加渐入/渐出，松开移动输入后平滑回到 Idle。
- 外部 GLB 动画将步态倍率传递给当前动作的 timeScale；动画覆盖状态仍优先，不被自动移动状态覆盖。
- 动画方向仍使用实际物理速度方向，避免角色被墙挡住时朝向抖动。

### 验证边界

- 新增 PlayerCharacterRuntime fallback 动画参数透传测试；仍需 CI 验证。
- 需要在浏览器验证持续按键、顶墙、松键、加速与跳跃组合；CI 不能替代真实键盘连续性验收。
- 本轮仍只修改 `fix/sandbox-character-physics-continuity`，不修改 main、不合并 PR。


## 2026-11-10 — 输入即时响应与跑跳并行

### 本轮调整

- 移除角色程序化步态的渐入延迟；按下移动键即启动迈步，松开即停止迈步。
- 外部 GLB 的 Idle/Walk/Run 动作切换取消 160ms 淡入淡出，输入状态变化后立即切换动作。
- 移除跳跃期间对水平速度的额外限速；Space 只叠加垂直起跳速度，不再把走路/快跑速度压低。
- 跳跃按下时直接读取 Rapier 最新 grounded 状态，减少渲染帧缓存状态导致的起跳输入落空。
- W/A/S/D、Shift、Space 可以同时保持：方向移动、快跑和跳跃在同一控制更新中提交给物理运行时。

### 验证边界

- 新增组合输入测试，覆盖 W + Shift + Space 同时生效且水平速度不被跳跃限速。
- 新增外部角色动画即时切换测试。
- 跑跳距离现在由当前水平速度与实际空中时间共同决定，不再强制限制为旧的 3 米跳跃水平距离；需在浏览器重新验收落地距离和碰撞表现。
- CI 与浏览器实机体验分开记录；本轮提交后以 CI 结果为准，不提前宣称真实操作已验收。


## 2026-11-11 — 角色渲染插值与首按跳跃容错（待 CI / 浏览器验收）

### 本轮根因处理

1. **角色抖动：固定步长与渲染帧不同步**
   - 原实现每次渲染直接读取 Rapier 最近一次固定步的最终位置；当渲染频率与 60Hz 物理步频不一致时，会出现位置重复若干渲染帧后再跳变的视觉节奏。
   - PhysicsRuntime.getKinematicCharacterState() 现在额外提供 interpolatedTranslation 和 interpolationAlpha，使用上一物理步位置、当前物理位置及 accumulator alpha 计算渲染位置。
   - InputController.syncPlayerFromPhysicsState() 只将插值位置写入角色/相机跟随逻辑；Rapier 碰撞、刚体位置和移动命令仍使用权威物理状态，不用插值结果反向驱动物理。
   - 新增固定步长插值测试，验证 60Hz 物理与 120Hz 渲染之间的半步位置。

2. **W + Space 首按偶发无响应**
   - 原实现收到 Space 时会用最新 grounded 快照覆盖控制器缓存；如果快照正好处于接触状态切换边界，瞬时 false 会同时清掉最近的落地状态线索。
   - 现在只有 Rapier 明确报告 grounded=true 时才刷新落地状态与 coyote time；瞬时 false 不再抹掉仍有效的离地宽限窗口。
   - 跳跃输入缓冲由 0.14s 调整为 0.22s，coyote time 由 0.10s 调整为 0.18s；这是输入容错窗口，不是人为延迟起跳。
   - 新增测试覆盖缓存 grounded=false、Rapier 快照 grounded=false 但仍在 coyote window 时，Space 首按立即进入跳跃状态。

### 验证边界

- 本轮新增测试尚未取得 CI 结果，不能提前标记通过。
- 角色插值解决的是固定物理步与渲染频率不同步导致的视觉阶梯问题；若仍抖动，下一步需进一步检查角色模型挂载层级、动画根运动与 CameraRig 跟随是否重复施加位移。
- 尚未完成真实浏览器中的 60/120/144Hz、持续 W、W+Space、W+Shift+Space 和碰撞边缘实测。
- 仍只修改 fix/sandbox-character-physics-continuity；未修改 main，未合并 PR。


## 2026-11-11 — 键盘输入捕获与事件唤醒修复（待 CI / 浏览器验收）

### 本轮调整
- 将 keydown / keyup 监听切换到 window capture 阶段，避免 UI 冒泡阶段的 stopPropagation / stopImmediatePropagation 抢先截断游戏输入。
- InputController.attach() 增加幂等保护，dispose() 与捕获阶段监听器匹配移除，避免重复挂载或监听器生命周期不一致。
- Space 首次按下后主动触发 onMovementInput，确保按需渲染场景也会立刻调度一帧；此前 Space 分支没有触发渲染唤醒回调。
- keyup 只在确实删除了对应按键时触发输入状态变更，避免无关 keyup 事件扰动当前按键状态。
- 窗口重新获得焦点时主动请求输入帧；新增 Space 首按唤醒与无关 keyup 隔离测试。

### 当前判断
- 之前“按住一段时间停止、松开再按仍可能无效”的反馈与事件被 UI 层截断、按需渲染没有被 Space 唤醒的风险相符；本轮先修复输入事件入口和帧调度入口。
- 这还不是最终根因结论。若真实浏览器仍出现输入丢失，下一步需要在输入事件、每帧按键快照、期望速度、Rapier 步数之间加入时间戳诊断，确认是事件未到达、状态被清除，还是物理执行未消费。
- CI 尚未结束，真实浏览器未验收；不得将本轮标记为已彻底解决。
- 仅修改 fix/sandbox-character-physics-continuity，未修改 main，未合并 PR。


## 2026-11-11 — 角色控制架构审计与整改基线

### 审计结论
- InputController 当前同时承担 DOM 输入、按键状态、相机相对移动计算、导航、跳跃缓冲/Coyote Time、垂直速度、Rapier 命令提交、渲染位置同步，以及旧版 CollisionWorld/raycast 移动。
- PhysicsRuntime 已拥有 Rapier 固定步进与角色物理快照，但跳跃缓冲和部分角色控制状态仍由 InputController 按渲染帧 delta 更新，尚未形成完整的固定物理步状态机。
- PlayerCharacterRuntime 主要负责模型挂载与动画表现，边界相对清晰，应保留。
- 沙盒角色的 Rapier 移动与旧版 CollisionWorld/raycast 路径并存于 InputController；需要核查所有调用方后，将 MVP 沙盒统一到 Rapier 权威路径，旧路径只保留给明确的兼容场景。

### 已建立的架构契约
新增 `docs/world-sandbox-mvp/CHARACTER-CONTROL-ARCHITECTURE.md`，明确 Input System、Character Motor、Physics Runtime、Character Presentation 四层职责和分阶段迁移顺序。

### 整改原则
- 不通过增加人为延迟、调整速度/跳跃参数掩盖输入丢失。
- 不让动画根运动反向修改 Rapier 权威位置。
- 输入边沿事件必须跨渲染帧可靠缓冲，避免短按在物理 tick 之间丢失。
- 跳跃缓冲、Coyote Time 和角色状态迁移最终统一到固定物理步时钟。
- 未完成调用方核查前，不删除旧版碰撞移动代码。
- CI 与真实浏览器验收分开记录，不以单测通过代替真实输入和碰撞验收。

### 本轮验证边界
- 本轮仅新增架构契约文档；尚未进行控制器代码拆分。
- 当前 mvp 分支起点包含此前 fix 分支完整提交历史；本轮提交没有修改 main 或合并 PR。
- 下一阶段从输入状态采集层拆分开始，保持兼容接口并增加针对性测试。


## 2026-11-11 — 输入采集层第一阶段拆分

### 本轮实现
- 新增 `src/three/controls/CharacterInputSystem.js`，将物理键盘事件归一化、按键 Set、keydown/keyup、Space 首次按下边沿、R 重置、blur/visibility 清理、focus 唤醒和事件监听生命周期集中到独立输入系统。
- `InputController` 改为组合 `CharacterInputSystem`，继续通过兼容别名暴露 `onKeyDown`、`onKeyUp`、`onWindowBlur` 等旧调用入口，避免一次性破坏既有测试与调用方。
- 键盘事件仍在 window capture 阶段采集；输入系统不负责计算速度、重力、碰撞或角色位置。
- 新增 `CharacterInputSystem.test.js`，覆盖捕获阶段监听、attach/dispose 幂等、持续按键、Space 只触发一次跳跃边沿、表单输入隔离和失焦清理。

### 当前架构状态
- Input System 已从 InputController 中独立出来，第一阶段边界已落地。
- Character Motor 尚未从 InputController 拆出；Rapier 移动命令、跳跃状态和旧版 CollisionWorld 路径仍待后续阶段迁移。
- 本轮未改变移动速度、跳跃高度、重力、碰撞体尺寸或地形通行参数。

### 验证边界
- 代码已提交到 `mvp`；最新提交为 `89887642`。
- 尚未取得该提交对应的 CI 执行结果；当前 GitHub commit status 查询未返回检查项。
- 未执行本地 Vitest/Vite build，也未完成真实浏览器键盘连续性验收。
- 不将输入采集层拆分等同于整个角色控制架构整改完成。

## 2026-11-11 — Character Motor 第一阶段拆分

### 本轮实现
- 新增 `src/three/controls/CharacterMotor.js`，将 Rapier 角色的跳跃缓冲、Coyote Time、垂直速度、跳跃生命周期、grounded 状态，以及 Rapier 角色速度/加速度命令提交迁出 `InputController`。
- `InputController` 改为组合 CharacterMotor；原有公开字段通过 getter/setter 兼容代理到 Motor，保留现有引擎、UI 和测试调用入口，避免出现第二份运动状态。
- `InputController.moveWithPhysics()`、`jumpPlayer()`、跳跃窗口更新和物理位置同步改为委托 Motor。
- 新增 `CharacterMotor.test.js`，覆盖跳跃状态归属、跑跳同时提交、overview 自由镜头显式移动、物理插值位置同步和 reset 状态清理。
- 保留非 Rapier 的 CollisionWorld/raycast 路径；本轮未删除任何旧调用方。

### 当前边界与下一步
- 本轮完成的是 Character Motor 的第一阶段结构拆分，不代表固定步时序整改完成。
- 当前跳跃缓冲与 Coyote Time 仍通过原有 render-frame 更新入口推进；下一步必须为 PhysicsRuntime 增加固定子步回调/命令消费契约，再将 Motor 状态迁入 fixed timestep。
- 水平相机相对方向计算、导航路径和部分兼容逻辑仍留在 InputController；后续需在不破坏自动寻路、室内楼梯和 overview 自由镜头的前提下继续收敛职责。
- 真实浏览器行为尚未验收；本轮没有本地项目运行环境执行 Vitest/Vite build，不能宣称测试通过。
- 代码提交到 `mvp`；本轮未修改 `main`，未合并 PR。

### 本轮提交
- `823f5bb6` — 新增 CharacterMotor
- `31f1e6b1` — InputController 委托 Motor 并保留兼容代理
- `df4fdced` — 新增 Motor 单测
- `c6f2d12c` — 保留 overview 自由镜头移动语义
- `b7957e02` — 调整 overview 自由镜头 Motor 测试

### 兼容性复核补充
- 保留 overview 自由镜头模式下由用户显式启用的角色移动；Motor 不再把 overview 一概视为禁止水平移动，跳跃仍按控制模式限制。
- 保留 `physicsCharacterId` 在兼容调用方先赋值、后绑定 PhysicsRuntime 时的语义；runtime 解绑时才清空 ID。
- 对应修正提交：`c6f2d12c`、`b7957e02`、`88c9a030`、`688f605b`。
- GitHub 当前对最新代码提交未返回 commit status，PR workflow 查询也未返回运行记录；这不是 CI 通过。Vitest/Vite build 和浏览器验收仍未执行。


## 2026-11-11 — PhysicsRuntime 固定步生命周期接口

### 本轮实现
- `PhysicsRuntime.step(frameDelta, hooks)` 新增可选 `beforeFixedStep` / `afterFixedStep` 生命周期回调。
- `beforeFixedStep` 在每个 Rapier 固定子步开始、角色位移计算之前触发；可用于消费已缓存输入、推进 Motor 固定步状态并提交本步运动命令。
- `afterFixedStep` 在 Rapier 完成求解且角色位置、grounded、actualVelocity 快照刷新后触发；可用于 Motor 落地/离地状态收敛。
- 一帧产生多个物理子步时，回调按子步逐次执行；不足一个固定步的渲染帧不会触发回调。
- 原有 `step(frameDelta)` 调用保持兼容。本轮只建立物理生命周期契约，尚未把 CharacterMotor 接入回调，避免在未完成时序迁移前改变当前运动行为。

### 验证边界
- 新增 PhysicsRuntime 单测覆盖双子步回调顺序、固定 delta/stepCount 参数，以及不足一个物理步时不触发回调。
- 当前只完成远端代码写入和结构核对；未在本地执行 Vitest / Vite Build，也未取得该提交的 CI 结果。
- 尚未完成 CharacterMotor 固定步迁移和真实浏览器连续输入验收。
- 本轮仅修改 `mvp`，未修改 `main`，未合并 PR。

### 本轮提交
- `8e9952dd` — PhysicsRuntime 增加固定步生命周期回调
- `f26fe88b` — 增加固定步回调时序单测
- `5c5da12c` — 记录固定步接口契约与验证边界


## 2026-11-11 — CharacterMotor 固定步驱动接入（待 CI / 浏览器验收）

### 本轮实现
- CharacterMotor 的 Rapier 路径不再在渲染帧 `moveWithPhysics()` 中推进 Jump Buffer / Coyote Time，也不再在该方法中提交 Rapier 速度和重力命令。
- 渲染帧只更新水平移动意图（速度向量）并读取插值快照；短按跳跃写入 Motor 缓冲，不要求该按键必须跨越一个渲染帧或物理 tick。
- 新增 Motor `beforeFixedStep()`：按固定 delta 更新跳跃缓冲和 Coyote Time，判断起跳，并提交水平/垂直速度及重力加速度。
- 新增 Motor `afterFixedStep()`：消费 Rapier 求解后的 grounded / velocity 快照，识别离地与落地并收敛跳跃生命周期。
- InputController 暴露窄委托接口；createCampusEngine 的两个 Rapier step 调用点（普通运行、楼梯过渡）均接入固定步前后回调。
- 更新 CharacterMotor 与 InputController 单测断言，使 Rapier 路径明确在固定步回调中提交运动命令。

### 架构结果
- Rapier 角色的 Jump Buffer、Coyote Time、起跳决策、重力命令和落地状态现在由固定物理子步推进。
- 渲染帧只提供最新水平意图；一个渲染帧产生多个 Rapier 子步时，每个子步都会独立更新 Motor 状态。
- 非 Rapier 的旧版 CollisionWorld 路径仍保留其 render-delta 更新，不在本轮混合迁移。
- 旧路径尚未删除；仍需完成调用方核查和独立隔离。

### 验证边界
- 代码已写入远端 `mvp`；尚未执行本地 Vitest / Vite Build。
- 尚未取得该组提交的 GitHub Actions 结果；不能宣称单测通过。
- 尚未完成 60/120/144Hz 浏览器输入 cadence、持续按键、W+Shift+Space、边缘跳跃、斜坡/台阶碰撞与重置验收。
- 需要重点复核 Rapier 的 `computedGrounded()` 在起跳首步、空中、落地首步的状态语义，确认与 Motor 的落地状态机一致。
- 本轮只修改 `mvp`，未修改 `main`，未合并 PR。

### 本轮提交
- `dbe8f55b` — Motor 固定步状态机
- `a845c489` — InputController 固定步委托
- `bc336913` — 引擎固定步回调接入
- `621501db` — Motor 固定步测试更新
- `c49dbf1f` — InputController 测试更新


### 固定步接入后的补充修订
- Motor 的 overview 自由镜头移动测试改为在固定步回调中验证命令提交，不再假设 render-frame 方法直接写入 Rapier。
- 架构文档已更新为当前实际状态：Motor 已接入引擎固定步回调，不再把它描述为“仅建立接口、尚未接入”。
- 当前仍未取得 Vitest / Vite Build / 浏览器验收结果。


## 2026-11-11 — 固定步专项覆盖与移动后端隔离

### 本轮实现
- `InputController` 增加显式 `movementBackend`：`rapier`、`collision-world`、兼容默认 `auto`。
- `createCampusEngine` 对 blank-sandbox 显式选择 `rapier`；校园场景显式选择 `collision-world`。
- Rapier 必选模式在 PhysicsRuntime 缺失时 fail-closed：不允许静默回退到 CollisionWorld/raycast 移动解算器。
- 校园兼容模式仍保留旧 CollisionWorld、支撑面射线检测和垂直移动路径；没有删除仍被校园场景及空间/放置系统使用的碰撞模块。
- 新增 InputController 测试：Rapier 不可用时禁止旧路径接管；只有显式选择 collision-world 才执行旧移动路径。
- 新增 CharacterMotor cadence 测试：以 60/120/144Hz render cadence 消费相同 60Hz fixed timestep，验证 Coyote Time 的模拟时间一致性。
- 更新架构文档，纠正历史状态描述，明确固定步接入已实现、验证仍待执行。

### 代码核对
- `createCampusEngine` 在 blank-sandbox 初始化阶段先创建 `PhysicsRuntime`，同步沙盒物理世界，再创建 InputController 并绑定 runtime。
- 普通运行与楼梯过渡的 physics step 均传入 Motor 前后回调。
- `CollisionWorld` 不仅承载旧角色移动，也被部分校园/资产放置及空间查询逻辑使用；本轮只隔离角色移动后端，不删除整个模块。

### 验证边界
- 新增单测尚未在本地执行；本轮无本地 checkout 可运行 Vitest / Vite Build。
- 尚未完成真实浏览器验收：持续 W、W+Shift、W+Shift+Space、短按跳跃、离地边缘 Coyote Time、斜坡/台阶、碰撞阻挡、重置/传送。
- 仍需验证 Rapier `computedGrounded()` 在起跳首步和落地首步的语义，以及不同 render cadence 下真实按键事件到 fixed tick 的输入连续性。
- GitHub Actions / CI 尚未确认；不能宣称测试通过。
- 本轮仅修改 `mvp`，未修改 `main`，未合并 PR。

### 本轮提交
- `54bbebdc` — InputController 显式移动后端隔离
- `681d06cf` — blank-sandbox 强制 Rapier 后端
- `afdfd6e7` — 后端隔离回归测试
- `6ef16f6b` — 60/120/144Hz 固定步 cadence 测试
- `7f49409e` — 更新角色控制架构文档


## 2026-11-11 — Rapier 接触快照与 Motor 垂直速度反馈修正

### 本轮发现
- PhysicsRuntime 的 `getKinematicCharacterState().velocity` 实际是兼容字段，来源为 `desiredVelocity`，不是碰撞修正后的实际位移速度。
- CharacterMotor 在 `afterFixedStep()` 中原先读取该字段作为下一固定步的垂直速度，会忽略天花板/地面等碰撞对角色实际位移的修正。
- PhysicsRuntime 的 grounded 来源是 CharacterController `computedGrounded()`：在 `computeColliderMovement()` 后、`world.step()` 前计算；Runtime 在完成 `world.step()` 后才将 pending 结果发布到状态快照。

### 本轮修正
- CharacterMotor 改为优先读取 `actualVelocity.y`，使用碰撞修正后的位移速度作为下一固定步垂直运动状态；保留旧字段 fallback 仅用于兼容旧测试替身/适配器。
- PhysicsRuntime 明确 grounded 快照语义，并新增 `groundedStepCount`，标识该接触结果对应的已完成固定步。
- PhysicsRuntime mock 支持可控的 computedGrounded 结果。
- 新增 Motor 测试：碰撞修正后的垂直速度优先级、落地状态收敛。
- 新增 PhysicsRuntime 测试：beforeFixedStep 读取上一完成步状态，afterFixedStep 读取本次已完成步状态；验证离地和重新接地状态发布顺序。
- 更新架构文档，明确 commanded velocity、actual velocity、computed grounded 的职责边界。

### 验证边界
- 仅完成远端代码写入与文件内容核对；未在本地运行 Vitest / Vite Build。
- 尚未用真实 Rapier 场景验收天花板碰撞、斜坡边缘、台阶自动跨越、起跳首步和落地首步。
- `computedGrounded()` 代表 Rapier CharacterController 对本次计算位移的 grounded 结果，不应描述成独立的物理接触流/接触流形查询。
- 本轮仅修改 `mvp`，未修改 `main`，未合并 PR。

### 本轮提交
- `b359f655` — Motor 使用碰撞修正后的垂直速度
- `43b3cf98` — Motor 速度反馈与落地状态测试
- `e269aef5` — PhysicsRuntime 明确 grounded 快照语义
- `330dc9c8` — PhysicsRuntime 接触状态时序测试
- `1688f54e` — 更新架构文档

## 2026-11-11 — 沙盒黑屏诊断可观测性补强（待浏览器验收）

### 本轮调整
- 为引擎初始化增加阶段标记；初始化任意步骤抛错时统一输出 `[CampusRenderFailure]`，包含失败阶段、异常堆栈、Canvas 挂载/尺寸、WebGL context 状态、绘制缓冲区、场景对象/Mesh 数量和相机状态。
- 为渲染帧增加异常边界；帧内更新或 renderer.render 抛错时输出同一份现场诊断，不静默吞掉异常，也不对确定性错误无限自动重试。
- 首次成功执行 renderer.render 后立即输出 `[CampusRenderDiagnostics]`，之后每 120 帧输出一次，避免此前必须等待 120 帧才获得渲染数据的问题。
- 监听 WebGL context lost/restored 事件；丢失时记录现场，恢复时请求重新绘制。
- 不改动沙盒空间数据、模型实例、物理碰撞、角色控制和持久化数据。

### 验证边界
- 已完成远端源码结构修改与提交；尚未在用户本地执行 Vitest、Vite build 或浏览器验收。
- 下一次打开 `/world-sandbox-mvp?render-debug=1` 后，优先查看 Console 中的 `[CampusRenderFailure]`、`[CampusRenderDiagnostics]`。
- 若初始化失败，诊断会给出具体阶段和异常堆栈；若首帧成功，则会给出 draw calls、Mesh 数量、相机状态和绘制缓冲区信息。需据此定位实际黑屏根因，不能将增加日志等同于黑屏已修复。
- 仅修改 `mvp`，未修改 `main`，未合并 PR。

## 2026-11-11 — 修复 InputController 构造顺序导致的场景初始化中断

### 根因
- 浏览器诊断确认初始化停在 `camera-created`，异常为 `Cannot read properties of undefined (reading 'setPhysicsRuntime')`。
- `InputController` 构造函数在创建 `CharacterMotor` 之前，对访问器属性 `physicsRuntime` / `physicsCharacterId` 赋初值；赋值触发 setter，访问尚未初始化的 `this.motor`，导致引擎初始化失败、首帧渲染从未执行。

### 修复
- 移除构造函数中对两个访问器属性的冗余初始赋值。它们由 `CharacterMotor` 提供默认状态，后续通过现有 setter 正常更新。
- 保留 `CharacterMotor`、`PhysicsRuntime` 的职责边界与现有物理初始化流程；不增加兼容补丁，不修改场景或沙盒数据。

### 验证边界
- 已通过源码路径确认构造顺序缺陷；修复已提交到 `mvp`。
- 尚未在用户本地运行测试或浏览器验收。下一步需确认引擎初始化完成并出现 `first-render` 日志。
