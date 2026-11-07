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
