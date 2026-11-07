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
