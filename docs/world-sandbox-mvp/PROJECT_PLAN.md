# World Sandbox MVP 项目计划与架构基线

> 本文档是 `/world-sandbox-mvp` 的项目级计划与架构决策依据。每次讨论、设计、开发或调整前必须先读取本文及同目录的 `PROGRESS.md`。代码事实以目标分支当前源码为准；本文记录决策和计划，不替代代码核查。
>
> 最后更新：2026-11-07
> 当前跟踪分支：`feat/world-sandbox-conversational-model-editor`
> 最近一次代码审查基线：`7ac7cec975690e71c4a779e5093fd936a59cecca`（详见 `PROGRESS.md`；文档提交会继续推进分支 HEAD）

## 1. 产品定位

建设一个 AI 原生、可运行、可交互、可持续修改和保存的 Three.js 3D 世界沙盒（AI Native 3D World Engine），而不只是 AI 3D 模型展示器。

用户能够通过自然语言创建和修改模型/场景；模型作为世界对象进入沙盒；玩家角色能够在世界中移动并与对象交互；环境变化和玩家行为能够驱动世界状态；世界可保存并恢复。

## 2. 当前 MVP 目标与范围

### 2.1 必须打通的核心闭环

1. 创建独立 Three.js 沙盒场景，具有明确世界尺寸、坐标系和地面。
2. 通过 AI 文本（可选参考图）生成独立 Three.js 模型；模型是沙盒子对象/资产实例，不替换原校园建筑或底图。
3. 模型进入沙盒后可选择、移动、旋转、缩放、复制、删除；同一模板/模型定义可有多个独立实例。
4. 玩家角色能够在沙盒中移动，识别附近可交互对象并执行交互。
5. 环境支持时间、天气、风等状态，并由统一运行时驱动可见效果。
6. 沙盒保存与刷新恢复模型、变换、环境和必要的对象状态。
7. AI 能通过对话修改模型整体或部件，并可动态增加模型参数；参数定义与参数值分离，界面按元数据动态呈现。
8. 环境、交互、状态和运行时有清晰边界，允许后续扩展全局/局部环境、太阳光照、设备和房间交互。

### 2.2 MVP 非目标

- 不重建完整校园 GIS 编辑器，不替换校园现有地图/建筑数据。
- 不要求一次实现完整室内装修系统、NPC 自主智能、多玩家在线、语音、复杂经济系统。
- 不要求一次实现真实天文级太阳计算；先打通可验证的虚拟日周期，再扩展真实日期/地理位置。
- 不为每种模型类别硬编码一套专属交互 UI 或参数白名单。
- 不执行 AI 任意生成的 JavaScript/TypeScript 于主线程；代码执行必须隔离，世界配置与行为由受控运行时消费。
- 不为架构完整性一次性建设所有大型引擎子系统；先实现核心闭环。

## 3. 已确认的架构原则（决策基线）

### 3.1 世界对象不是单纯 Mesh

逻辑对象应逐步具备以下能力，具体能力按对象需要选择，不要求每个对象都实现全部字段：

- 几何/视觉表示（一个或多个 Three.js Object3D/Mesh）。
- 稳定唯一 ID、对象类型、版本与元数据。
- Transform（位置、旋转、缩放）。
- 自身状态（如门的 open、灯具的 enabled、设备的 running）。
- 可选交互入口（Interactable）。
- 可选环境响应/绑定（Environment Bindings）。
- 可选物理表示（碰撞体、质量、运动属性）。
- 可选空间归属和关系（World/Zone/Building/Floor/Room）。
- 生命周期与持久化数据。

Mesh 名称不得作为稳定身份；对象 ID、部件 ID、组件 ID 和关系 ID 应独立维护。模型定义与沙盒实例 Transform 分离；同一模型定义可以实例化多次。

### 3.2 四个核心系统

1. **Environment System**：管理环境定义、环境值、全局环境、局部环境区域及环境实体（太阳等）。
2. **Interaction System**：管理玩家/对象交互检测、交互入口、条件和动作请求。
3. **State System**：统一管理世界、区域、模型、部件和设备的状态及状态变更。
4. **Runtime System**：把状态和事件转换成 Three.js 光照、阴影、材质、动画、物理、音频等运行效果。

系统通过明确 API、状态更新和事件协作；避免交互系统直接修改任意 Mesh 材质，或环境系统直接耦合某个模型的内部实现。

### 3.3 全局环境与局部环境

环境变量不是固定的 `time/weather/wind` 三字段集合。变量定义与当前值分离，并由元数据驱动控制界面。

- **Global Environment**：默认作用于整个世界，例如时间、天气、全局风场、重力、基础温度。
- **Local Environment**：作用于区域、建筑、楼层、房间或指定对象，例如局部风、局部降雨、室内温度、局部湿度。
- **继承与覆盖**：局部环境默认继承全局值；只有显式覆盖的变量才采用局部值。应定义覆盖优先级与恢复继承行为。
- **动态注册**：AI/用户可创建、修改、删除环境变量定义；变量类型和 UI 控件由元数据决定。至少考虑 number、boolean、enum、color、vector 等类型。
- **模型响应规则**：模型/部件可订阅环境变量并声明效果，例如树冠随风摆动、表面受雨湿润。规则不是环境变量本身。

### 3.3.1 环境变量开关、参数与作用范围

每个环境变量至少区分三个维度，不能用数值为 0 代替禁用状态：

- **Enabled**：该变量/效果是否参与运行；关闭不应清空用户设置的参数值。
- **Parameters**：该变量的业务参数，例如小时、天气类型、风速、风向、降雨强度。
- **Scope / Override**：变量作用于全局还是局部区域/对象；局部未声明时继承全局，显式 enabled=false 必须覆盖全局，不能被继承逻辑重新打开。

组合开关需要有明确的父子语义：天气总开关关闭时，所有天气子效果均不生效；天气总开关开启时，降雨等子效果可独立启停；风力开关关闭时不施加风场，但保留用户配置的风速/风向值。

当前 M0 只实现已有 Runtime 能力对应的开关：时间光照联动、天气总开关、降雨子开关、风力开关。温度、湿度、重力等在尚无对应模拟 Runtime 前不伪装成可用功能；后续注册变量时再提供相应开关和参数元数据。

持久化必须保存开关本身和参数值。旧版 v1 存档迁移时，缺少的 enabled 字段按 true 处理，以保持旧存档原有环境表现。

### 3.4 太阳与全局光照

太阳是世界级环境实体/天体系统，不是普通模型绑定，也不是一个孤立的 AI 模型。

- 时间系统提供时间输入；后续可加入日期、时区、纬度、经度。
- Solar System 计算太阳方向/高度角。
- Lighting Runtime 管理 DirectionalLight、天空/环境光、阴影和昼夜色彩。
- 全局太阳光照统一影响所有符合投影/接收规则的对象；对象通过 castShadow/receiveShadow 等能力参与阴影。
- 第一阶段先做可调时间驱动的虚拟日周期；真实太阳轨迹作为后续增强。
- 需要考虑阴影相机范围、bias、阴影分辨率、更新频率和性能分级。

### 3.5 人物交互与对象状态

“开灯”这类人为行为由 Interaction System 发起，而不是把“开灯”硬编码为环境变量。

标准链路：

玩家输入 → 交互检测 → 交互动作请求 → 条件/权限判断 → State System 更新对象状态 → 事件通知 → Runtime 更新光照/动画/音频/UI。

示例：墙壁开关是 Interactable；灯具维护 enabled 状态；开关动作切换灯具状态；Lighting Runtime 根据灯具状态更新实际光源。开关与灯具通过稳定对象 ID/关系配置关联。

交互动作应是可扩展的受控能力（如 toggle、set、open、close、use、pickup、drop、enter、activate），由对象配置声明，不为每个模型写专用业务分支。AI 可以生成对象交互配置，但不能提供任意可执行代码。

### 3.6 事件系统

State System 的状态变更应能够发出事件，让 Lighting、Animation、Audio、UI、AI 等订阅者解耦响应。事件至少覆盖玩家交互、对象状态变化、环境变化、物理碰撞、对象生命周期。高频帧数据不得逐帧持久化。

### 3.7 世界数据与渲染对象分离

Three.js Object3D 是渲染/运行时载体，不是唯一权威世界数据。应逐步建立可序列化的 World Document / World Object 数据结构，包含对象身份、实例变换、状态、绑定、交互和空间关系；渲染对象可从数据恢复。不要把完整业务状态只塞在 Mesh.userData 或仅依赖 Object3D.toJSON()。

### 3.8 物理、空间、导航

- 视觉网格与碰撞表示分离；优先使用简单碰撞体。
- 明确可行走地面、阻挡体、门/楼梯/电梯等空间连接。
- 空间层级预留 World → Zone → Building → Floor → Room。
- MVP 先保证基础地面移动、碰撞和对象交互范围；复杂导航后续扩展。

### 3.9 生命周期、持久化与版本

- 对象生命周期至少覆盖创建、加载、启用/禁用、更新/替换、删除、卸载、恢复。
- 模型替换/AI 修改时，稳定对象 ID、状态、Transform 和关系应按策略保留；不能依赖 Mesh 名称。
- 存档应有版本号与迁移策略，逐步保存世界对象、Transform、环境定义/值、对象状态、交互配置、环境绑定和空间关系。
- 本地存储可作为 MVP 持久化方式；后续再评估服务端同步。
- 旧版 v1 存档需要迁移到后续 World Document 版本，不能直接丢弃。

### 3.10 性能与安全

- 模型代码隔离执行；禁止 AI 生成源码直接在主线程执行。
- 对象资源必须可释放；删除/替换模型要处理 Geometry、Material、Texture、监听器和运行时订阅的生命周期。
- 后续按需引入 LOD、视锥剔除、实例化渲染、区域加载、阴影分级和非活动区域降频。
- AI 生成的数据需要基础结构/资源边界处理，但不要建立会阻止合理新部件和新参数的僵化业务白名单。

### 3.11 AI 模型能力与环境绑定协议

模型生成和模型能力不是同一件事。模型定义负责描述几何、材质和部件；能力声明负责描述模型/部件能响应哪些环境变量、提供哪些控制入口；Runtime 负责把环境值映射为实际运行效果。

- AI 程序化模型模块应导出 `environmentBindings` 数据数组；Worker 将其复制到模型根节点的序列化元数据中。模型没有环境响应能力时导出空数组。
- 每条绑定使用稳定的 `targetPartId` 指向真实部件的 `userData.componentId`，并声明 `variable`、`property`、默认值及开/关映射。Mesh 名称、显示名称不能作为关联主键。
- 环境变量采用命名空间标识，例如 `lighting.artificial.enabled`。变量定义和值属于 Environment System；模型只声明订阅关系，不拥有全局环境值。
- Runtime 只消费数据声明，不执行 AI 返回的任意行为代码。第一阶段支持 `visible`、`intensity`、`emissiveIntensity` 三种受控渲染属性；新增运行属性需由 Runtime 明确实现。
- 全局环境值默认作用于所有已注册绑定；对象级 `environmentOverrides` 对同名变量具有更高优先级。局部显式 false 必须覆盖全局 true；清除局部覆盖后恢复继承。
- 新模型在加入沙盒时自动注册并应用当前环境值；环境变化时 Runtime 更新所有已注册模型；保存/恢复时保留绑定和局部覆盖。
- AI 微调必须接收当前模型源码、部件元数据和已有环境绑定。用户可用自然语言要求旧模型接入新能力；AI 优先复用现有部件，只在缺少必要组件时做最小结构增量，并保留无关几何、模型身份、Transform、对象状态和局部覆盖。
- 绑定是开放的数据协议，不按教学楼、路灯、树木等对象类别建立业务白名单。Runtime 属性映射属于执行安全边界，不等同于限制模型类别或部件命名。
- 旧模型如果保留了可编辑程序化源码，可以通过 AI 微调升级；没有可编辑源码的模型不能承诺仅靠一句话无损升级，需要先重建可编辑定义或进行人工/AI 结构转换。

### 3.12 模型固有参数、世界环境变量与运行状态（三层数据边界）

必须将模型自身的定义、沙盒提供的外部环境，以及模型实例运行时发生的变化分开存储。三者有关联，但不能混成一个参数集合。

#### A. 模型固有定义（Model Definition）

模型固有定义由 AI 在建模/重建时声明，随模型定义保存。它描述“这个模型是什么、具备什么结构和能力、如何参与世界”，不是某一时刻的世界状态。

包括：

- **几何与材质定义**：模型部件、尺寸、材质、层级和稳定部件 ID。
- **可编辑参数（Model Parameters）**：如宽度、高度、深度、楼层数、颜色、房间数量等。参数定义与当前参数值分离；AI 可按用户指令动态增加、修改或删除，不建立固定业务参数白名单。
- **空间/物理属性（Spatial Properties）**：碰撞体、阻挡/可穿越区域、入口/出口、可进入声明、空间连接和内部空间结构。是否可穿越应精确到部件或区域；不能把“建筑可进入”解释为整栋建筑无碰撞。
- **环境响应声明（Environment Bindings）**：模型/部件订阅哪些世界环境变量，以及变量如何影响其表现。声明属于模型固有定义，环境变量的实际值不属于模型。
- **交互能力声明（Interaction Capabilities）**：模型提供哪些交互入口、动作、条件和目标关系。例如开关关联灯具、门提供 open/close/enter。它描述可执行能力，不代表当前动作状态。
- **内部空间结构（Interior Definition）**：模型确实包含内部空间时，才声明楼层、房间、走廊、楼梯、门洞和空间连接；普通模型无需伪造这些字段。

以上能力按模型实际情况选择性声明。字段缺失表示模型未声明该能力，不要求每个模型都具有碰撞、内部空间、灯具或交互入口。AI 可通过自然语言增量修改这些定义；修改应尽量保留无关几何、稳定 ID 和实例状态。

#### B. 世界环境变量（World Environment）

世界环境由沙盒统一管理，是模型之外的输入，例如时间/太阳、天气/降雨、风向/风速、重力和全局人工照明。

- 环境变量的定义、启用开关、参数值和全局/局部作用范围归 Environment System 管理。
- 模型通过 Environment Bindings 选择性订阅环境变量；模型不能自行拥有或覆盖全局环境真值。
- 全局环境值可以被区域/对象级显式覆盖；局部覆盖优先级由 Environment Runtime 统一解释。
- 模型没有声明某项环境绑定时，不应因为环境变量存在就自动产生效果。

#### C. 模型实例运行状态（Model Instance State）

运行状态描述“这个实例此刻是什么状态”，由玩家交互、模拟或世界事件改变，并随世界存档保存。例如：

- 灯当前开/关、门当前开/关、窗户当前开/关。
- 电梯当前楼层、设备运行/停止、房间当前占用状态。
- 运行时临时启用/禁用的设备状态。

运行状态不能反向覆盖模型固有定义。例如灯具当前关闭，不代表模型定义中的灯具能力或环境绑定被删除；门当前打开，也不代表门洞/碰撞结构被永久改写。

#### 三层数据流

`Model Definition` 声明结构和能力 → `World Environment` 提供外部变量 → `Model Runtime` 根据绑定和当前状态产生实际表现。

玩家交互通过 Interaction/State Runtime 修改实例状态，再由 Runtime 更新视觉、碰撞或设备表现；AI 对话修改的是模型定义/能力声明，除非用户明确要求改变某个实例当前状态。

#### 建议的数据组织（协议方向，不要求一次性创建同名文件）

```js
{
  modelDefinition: {
    version: 1,
    parameters: [],
    capabilities: {
      spatial: {},
      interior: {},
      environmentBindings: [],
      interactions: []
    }
  },
  instance: {
    id: "stable-instance-id",
    transform: {},
    state: {}
  },
  worldEnvironment: {
    values: {}
  }
}
```

这是职责边界示意，不是本轮已经落地的运行时 Schema。实际协议应允许 capabilities 下的能力段缺省，并为未来版本迁移保留 version。

#### 实施约束

- 不按建筑、树、灯具等模型类别写死能力模板；能力由 AI 根据实际模型结构声明。
- 不把“可穿越”简化成根对象 boolean。应支持部件级碰撞/通行描述，以及入口/通道等空间区域。
- 不把环境绑定与环境变量值放在同一数据源；绑定是模型定义，值由世界环境管理。
- 不把灯具 enabled、门 open 等动态值存入模型定义；它们属于实例运行状态。
- Runtime 只执行已实现的受控能力协议，不执行 AI 任意 JavaScript。未知能力声明可保存在模型定义中，但未有对应 Runtime 时不得伪称已生效；应记录为待支持能力，而不是因模型类别未知就拒绝整个模型。
- 老模型若保留可编辑程序化源码，可由 AI 增量补充能力声明；只有静态图像或不可编辑网格时，无法保证无损补齐隐藏内部结构。

### 3.13 Model Capability Manifest v1（第一阶段数据协议）

程序化模型以 `modelCapabilityManifest` 作为模型固有能力的主声明。Manifest 是模型定义的一部分，不包含世界环境当前值，也不包含某个实例此刻的开关/门状态。

#### 协议结构

```js
export const modelCapabilityManifest = {
  version: 1,
  parameters: [
    // 模型固有的可编辑参数定义；与当前参数值分离
  ],
  capabilities: {
    // 按实际模型选择性声明；不存在的能力段直接省略
    spatial: {
      // 部件/区域级 colliders、traversalZones、enterable 等声明
    },
    interior: {
      // floors、spaces、connections 等室内结构声明
    },
    environmentBindings: [
      // 模型/部件对世界环境变量的订阅与响应声明
    ],
    interactions: [
      // 交互入口、动作、稳定目标关系等数据声明
    ]
  }
};
```

以上是结构约定。除 `version`、`parameters`、`capabilities` 外，Manifest 和 capability section 可扩展；未实现的能力声明可以保存和往返传递，但 Runtime 不得假装已经执行。

#### 与现有字段的兼容规则

- `modelCapabilityManifest.parameters` 是模型参数定义；现有命名导出 `modelParameters` 暂作为兼容别名。当前参数值仍由现有 `proceduralModelParameterValues` 保存，不把实例当前值塞进能力定义。
- `modelCapabilityManifest.capabilities.environmentBindings` 是主声明；现有命名导出 `environmentBindings` 和根节点 `userData.proceduralModelEnvironmentBindings` 暂作为 Runtime 兼容别名。第一阶段 Runtime 仍从兼容字段读取人工灯光绑定。
- `modelParts` 仍是部件选择/编辑 UI 的兼容元数据，不等同于空间、碰撞或交互能力。
- Worker 读取 AI 模块的 Manifest；旧模型没有 Manifest 时，根据旧 `modelParameters` / `environmentBindings` 合成 v1 兼容 Manifest。
- Worker 将 Manifest 保存到根节点 `userData.proceduralModelCapabilityManifest`。现有 Object3D JSON 存档会随模型 userData 保存该声明。
- AI 微调请求携带当前 Manifest；AI 返回完整更新 Manifest。服务端兼容旧模型：若 AI 未返回 Manifest，则沿用旧 Manifest/旧绑定并构造兼容结果。
- 模型替换和撤销历史保留 Manifest；Manifest 中的环境绑定与旧字段必须同步，避免 Runtime 读取到过期绑定。

#### 安全与演进边界

- Manifest 是纯数据，不允许函数、可执行源码、eval 字符串或任意运行时代码。
- 第一阶段不对未知 capability key 做业务白名单校验；Worker/页面保留未知声明字段，供后续 Runtime 版本解释。
- 当前没有 Spatial/Interior/通用 Interaction Manifest Runtime；这些字段即使已保存，也只代表模型声明，不代表碰撞、室内导航或交互已生效。
- 后续版本通过 `version` 演进，并以显式迁移处理旧字段；不要在这一阶段一次性迁移全部 World Document。

### 3.14 Spatial Runtime v1 — 部件级地面移动碰撞

第一阶段只实现可验证的地面移动阻挡，不把 Manifest 中所有空间声明都视为已支持。

#### 当前执行协议

`modelCapabilityManifest.capabilities.spatial.colliders` 可声明部件级碰撞体：

```js
{
  id: "wall-collider",
  targetPartId: "wall-part",
  shape: "box",
  center: { x: 0, y: 1, z: 0 },
  size: { x: 4, y: 2, z: 0.3 },
  blocksMovement: true,
  enabled: true
}
```

- `targetPartId` 必须对应模型部件的稳定 `userData.componentId`。
- `center` / `size` 使用目标部件局部坐标；Runtime 根据部件世界矩阵转换为世界空间 AABB。
- 当前玩家控制器在 XZ 平面移动；只注册与地面站立高度区间相交的碰撞体。
- 仅 `shape: "box"` 且未显式禁用、未显式设为非阻挡的声明参与当前 Runtime。
- 碰撞体按模型实例 ID 归属；模型移动/旋转/缩放、替换和删除时更新或清理对应障碍。
- 门洞通过墙体分段/独立部件表达：墙体有碰撞声明，门洞本身不生成碰撞体。不得用整栋建筑根对象碰撞体封死入口，也不得用根对象可穿透来绕过墙体碰撞。
- 缺少 spatial.colliders 的旧模型继续保持原有行为，不自动推断碰撞。

#### 当前未实现

- 圆形/胶囊/多边形/网格碰撞体。
- traversalZones、可行走面、门/楼梯/电梯连接、室内楼层导航。
- 动态门开关对碰撞体启停的状态绑定。
- 垂直方向完整胶囊体物理、重力、跳跃和刚体模拟。

以上字段即使被 Manifest 保存，也不代表当前 Runtime 已执行。


### 3.14 通用对象能力：AI 推理、用户控制与 Runtime 执行

本节适用于**所有世界对象及其部件/区域**，不是墙体碰撞专用协议，也不按建筑、树木、家具、设备等对象类别建立固定能力模板。对象可以是实体模型、部件、空间区域、环境实体或运行设备；能力由对象实际结构、用户意图和世界上下文决定。

#### 核心职责分离

1. **AI Capability Reasoning（推理层）**：读取模型几何/部件层级、已有能力、用户指令及必要的世界上下文，自主推断对象具备的能力、约束和依赖关系；用户未明确提出的部分由 AI 自动补全，不逐项请求确认。推断结果进入自动解析流程，但在 Runtime 编译/执行前仍不代表已生效。
2. **User Capability Control（控制层）**：用户通过自然语言、参数化控制和对象/部件/区域局部覆盖随时调整结果；用户本轮明确指令优先于已保存覆盖、模型定义和 AI 推断。AI 后续编辑不得静默覆盖用户明确设置。
3. **Capability Resolver / Compiler（解析编译层）**：合并模型定义、用户覆盖和运行时上下文，检查引用、冲突和依赖，再将可执行部分编译为 Runtime 能消费的声明。
4. **Capability Runtime（执行层）**：只执行当前确实实现且通过编译的能力；未实现或无法解析的能力保留在数据中并报告状态，不得显示为已生效。
5. **Diagnostics / Repair Loop（诊断修复层）**：Runtime 回报缺失部件、无效引用、几何冲突、不支持的执行器和执行失败；AI 可基于诊断提出局部修复，用户仍可审阅和控制。

#### 能力覆盖范围

能力不是预先封闭的枚举。AI 应根据实际对象判断是否需要声明，例如但不限于：

- 空间与物理：阻挡、穿越、站立、承载、移动、可进入、碰撞、破坏、附着、连接。
- 结构与拓扑：内部区域、房间、楼层、入口、通道、楼梯、电梯、邻接和包含关系。
- 环境响应：受时间、光照、天气、风、温度或其他环境变量影响。
- 交互与状态：可点击、可开关、可开合、可拾取、可放置、可使用、可激活，以及对应状态和状态转换。
- 运动与行为：摆动、旋转、流动、开合、周期行为、触发条件和约束。
- 视觉与音频：透明度、发光、材质变化、动画、声音及其触发条件。
- 资源与生命周期：启用/禁用、显示/隐藏、生成、销毁、替换和依赖关系。

上述清单用于说明适用面，不是必须字段清单或 Runtime 支持承诺。能力可以按模型、部件、区域或实例定义；不同能力可以有依赖、互斥、条件和作用范围。

#### 三类数据必须分开

- **AI 推断记录（Inference）**：记录 AI 提议的能力内容、目标范围、来源、置信度、依据/证据、生成时间及推断状态。置信度是供用户判断的元数据，不是 Runtime 自动启用能力的授权。
- **用户控制覆盖（Override）**：独立保存用户明确接受、修改、禁用或补充的内容，支持全对象、指定部件、指定区域和单项属性范围。清除覆盖后回到推断/定义结果；覆盖不能被后续 AI 自动重写。
- **Runtime 执行结果（Execution）**：记录编译结果、实际启用的执行器、诊断、支持状态和运行时句柄/派生数据。执行结果是派生数据，不应反向污染模型定义。

解析优先级：**用户本轮明确指令 > 已保存的用户覆盖 > 模型定义 > AI 最新推断 > Runtime 安全默认值**。AI 推断默认自动进入解析/编译流程，不设置逐项人工确认或置信度审批门槛；置信度只用于诊断和追溯，不决定是否需要用户批准。

#### 开放数据协议方向

Manifest 继续作为模型固有定义的入口，但不把所有职责塞进一个扁平 capabilities 字段。可逐步演进为以下职责分区（示意，不是要求一次性实现固定 schema）：

```js
{
  version: 2,
  parameters: [],
  capabilities: {
    // AI 对模型固有能力的声明；允许任意扩展命名空间与字段
  },
  reasoning: {
    // AI 推断记录：proposals、confidence、evidence、source、status
  },
  userOverrides: {
    // 用户接受/拒绝/修改的局部控制记录
  }
}
```

更稳妥的最终持久化边界是将 inference、userOverrides 和 runtime diagnostics 作为独立文档/记录保存，并通过稳定的 modelId、partId、regionId 和 capabilityId 关联；上面的嵌套结构只用于表达职责，不要求它们最终都物理存放在 Manifest 内。实例运行状态仍属于 Model Instance State，不能混入模型固有定义。

协议必须满足：
- 任意能力数据可扩展、可往返保存；不通过对象类别、部件名称或能力名称白名单限制 AI 表达。
- 所有目标使用稳定 ID 与明确 scope；显示名称和 Mesh.name 不作为主键。
- 推断来源、用户覆盖、编译结果和实例状态有不同来源标记，不能互相覆盖。
- 局部修改只影响指定目标及必要依赖，尽量保留无关几何、ID、Transform、实例状态和已有用户覆盖。
- 未知能力字段必须保留；没有 Runtime 执行器时标记 unsupported/uncompiled，而不是丢弃或假装生效。
- Manifest 只允许声明式数据，不包含任意函数、JS 源码、eval 字符串或可执行脚本。

#### 从意图到执行的标准链路

`Model Geometry / Context + User Intent → AI Capability Inference → Capability Resolver（用户指令/覆盖优先）→ Spatial/Behavior/Environment Compiler → Runtime Adapter → Diagnostics → AI Repair / Incremental Update`

编译器不是另一个模型类别白名单。它负责把通用能力意图映射到已实现的执行器；执行器能力可以逐步增加，但不能限制 AI 保存和表达未来能力。

例如，“这个玻璃隔断允许玩家穿过，但仍然显示玻璃材质”应被解释为对空间阻挡能力的局部覆盖，而不是删除玻璃模型；“树冠随风摆动”应分别涉及环境订阅、运动行为和部件范围；“按下按钮后电梯到三楼”涉及交互入口、状态转换、空间连接和运行时反馈。系统不应要求用户理解这些底层结构才可提出要求。

#### Capability Control 数据协议第一阶段实现约定

第一阶段先建立不依赖 Three.js 的纯数据解析层，避免将推断、覆盖和执行耦合进当前碰撞代码：

- `capabilityControlDocument` 暂采用独立文档结构：`version`、`inference.proposals[]`、`overrides[]`、`diagnostics[]`。未知顶层字段和记录字段必须原样保留。该文档随模型根节点 `userData.proceduralModelCapabilityControlDocument` 进入 Object3D JSON，因此随模型复制/保存/恢复传递；Worker 根据 AI 输出的 Manifest capability namespaces 自动构建 inference proposals，模型替换时保留已有 overrides/diagnostics。
- 每条记录以 `capabilityId` 和 scope 定位；scope 可指向 model、part、region 或未来的其他稳定目标。能力 ID 不经过白名单校验。
- AI 推断记录携带 source、confidence、evidence、scope 和 value 等可追溯信息；不要求用户逐项确认。AI 推断默认自动进入解析结果，旧版 status=proposed 仅作为兼容输入，不再代表等待人工审批。
- 用户明确指令与已保存用户覆盖独立记录，支持 set、disable、reject 等控制语义；AI 后续推断/编辑不得静默覆盖用户明确设置。
- 解析优先级：Runtime fallback < AI inference < model definition < saved user override < current-turn explicit user instruction。当前纯数据 resolver 支持前四层；当前轮指令应在调用 resolver 前转成最高优先级的临时 override。
- AI 未提及某项能力时，由 AI 根据模型结构和上下文自主推断；若明确无法判断，应采用保守默认值并保留推断依据/不确定性，而不是要求用户确认。
- 解析器只产出解析记录，不调用 Three.js、不执行代码、不宣称 Runtime 已生效。后续需区分 resolved、compiled、applied，并由 Runtime adapter 确认执行后才能标记 applied。
- 显式 enabled=false、disable 或 reject 可关闭对应能力；AI 推断默认 enabled=true，但记录自身明确声明 enabled=false 时必须保留该值。
- Capability Control 文档已接入模型 Worker、模型根节点 userData、编辑替换/撤销及 Object3D JSON 保存恢复；该接入目前负责推断记录派生和文档生命周期，不代表 overrides 已有用户编辑 UI，也不代表 resolved capabilities 已接入各 Runtime。

#### 当前 Spatial Runtime 的定位

当前 `modelCapabilityManifest.capabilities.spatial.colliders` 和 `collectModelMovementObstacles` 是第一个底层执行切片：把明确声明的 box blocker 转换为 XZ 移动障碍。模型编辑器已提供能力概览，并允许用户对指定部件的 box collider 设置 `blocksMovement` 覆盖；Runtime 通过 Capability Resolver 合并模型定义与用户覆盖后重建障碍。该闭环不等于通用能力推理，也没有自动理解所有模型的穿越、承载、进入或连接能力。

能力面板按 Manifest 的能力命名空间展示能力声明，并标注当前 Runtime 接入范围。当前只有空间 box movement blocker 提供实际控制；其他能力只展示“未接入 Runtime”，不提供伪开关。用户覆盖写入独立的 `capabilityControlDocument.overrides`，不修改 AI 原始 Manifest；该文档随 Object3D JSON 存档、恢复和模型微调生命周期保留。

当前 Runtime 只执行 box movement blockers；其他空间/行为能力必须如实标记为未执行。后续增加能力时，沿用“声明 → 用户覆盖 → Resolver → 对应 Runtime adapter → 实际效果”的闭环，不按模型类别建立固定白名单。

## 4. 推荐系统边界

```text
AI World Builder
  └─ 生成/修改 World Document、Model Definition、Interaction/Binding 配置

World Core
  ├─ World System
  ├─ Model/Object System
  ├─ Spatial System
  ├─ State System
  ├─ Interaction System
  └─ Event System

Simulation Core
  ├─ Environment System
  │   ├─ Global Environment
  │   ├─ Local Environment / Zones
  │   └─ Solar System
  ├─ Physics System
  └─ Navigation System

Runtime Core
  ├─ Rendering Runtime
  ├─ Lighting & Shadow Runtime
  ├─ Animation Runtime
  ├─ Audio Runtime
  └─ Resource/Lifecycle Runtime

Persistence & Infrastructure
  ├─ World Document / Version Migration
  ├─ Save / Restore
  ├─ Resource Management
  └─ Diagnostics / Performance
```

以上是逻辑职责，不要求立即拆成大量独立 package 或文件。实施时优先保持最小可运行闭环，避免过度工程化。

## 5. 里程碑与验收标准

### M0 — 当前 MVP 基础闭环（优先）

- 独立沙盒、世界边界/地面、玩家移动。
- AI 模型生成、隔离执行、添加为独立实例。
- 选择、移动、旋转、缩放、复制、删除。
- 基础交互检测和至少一种可改变对象状态的交互。
- 时间/天气/风等环境控制与可见效果。
- 保存/刷新恢复模型、变换、环境、选中状态。
- AI 对话修改模型，支持动态参数定义和部件选择。
- 自动化测试通过；浏览器手工验收关键闭环。

验收场景建议：AI 创建一个可进入的房间，包含灯具、墙壁开关和门；玩家可以走入房间、开灯、开门；调整时间后室外太阳方向/阴影发生变化；刷新页面后模型和状态恢复。若其中某项尚未实现，必须在进度文档中标记为未完成，不得以架构设计代替实际交付。

#### M0 实施顺序（按可验证闭环推进）

1. **三层数据边界与 Model Capability Manifest**：正式区分模型固有定义、世界环境变量、实例运行状态；确定可选能力段、版本和稳定 ID 规则。
2. **模型能力声明链路**：AI 新建模型时输出模型固有能力声明；Worker 读取并随模型定义保存；沙盒实例化、存档恢复时保留定义；没有某项能力的模型允许省略该段。
3. **AI 增量编辑链路**：微调接口接收当前模型定义/能力声明；AI 可按自然语言增删模型参数、碰撞/通行描述、内部空间、环境绑定和交互声明；替换模型时保留实例 ID、Transform、运行状态和无关结构。
4. **Runtime 分能力接通**：先让空间/碰撞声明影响玩家通行，再接内部空间与连接关系，再接交互设备和对象状态，最后扩展更多环境绑定。每项都必须有端到端验收用例。
5. **World Document 与存档升级**：将模型定义、实例 Transform、实例状态和世界环境从 Object3D JSON 中逐步分离，提供旧版存档迁移。
6. **全局/局部环境扩展与生命周期**：补充 Environment Registry、区域继承/覆盖、对象删除/替换时的绑定和空间关系清理。

每一项先形成一个端到端可验收用例，不提前建设完整框架。

### M1 — 环境与交互基础设施

- Environment Registry / State：动态变量定义和值。
- Global / Local Environment：区域继承与覆盖。
- Interaction Registry：交互入口、动作、条件、目标引用。
- State/Event：统一状态更新与事件通知。
- Lighting/Solar Runtime：虚拟日周期、全局阴影、局部灯具开关。
- 存档版本升级与旧存档迁移。

### M2 — 空间与对象能力扩展

- World/Zone/Building/Floor/Room 层级。
- 门、楼梯、电梯等空间连接。
- 物理碰撞体与导航区域。
- 拾取/放置/使用/坐下等通用交互动作。
- 音频、更多环境效果和对象行为。

### M3 — AI 世界构建与规模化

- AI 从自然语言构建多对象、多房间场景和对象关系。
- AI 对话修改世界对象、交互关系和环境配置。
- NPC/自主行为。
- 大型场景资源流式加载、LOD、阴影分级。
- 多人同步作为独立阶段评估，不纳入当前 MVP。

## 6. 开发流程与文档纪律（强制）

每次项目工作必须按以下顺序：

1. 读取本文件 `PROJECT_PLAN.md`。
2. 读取同目录 `PROGRESS.md`。
3. 核对 GitHub 当前目标分支、HEAD、最近提交和相关源码；不能凭旧对话或旧 SHA 推断现状。
4. 明确本轮目标、非目标和验收标准，再开始实施。
5. 变更后更新 `PROGRESS.md`；如架构原则/路线发生变化，同时更新本文件。
6. 记录实际文件、提交 SHA、自动化测试/构建/CI 结果和浏览器验收状态。
7. 区分“已实现”“已提交”“CI 通过”“浏览器验收通过”。没有实际证据不得宣称通过。
8. 不擅自修改/合并 main，不擅自创建 PR；默认在当前功能分支工作。

每轮进度记录格式：

- 日期与目标分支/HEAD
- 本轮目标与原因
- 实际改动（文件/模块）
- 已实现能力
- 测试命令及真实结果
- CI 状态
- 浏览器验收状态
- 未解决问题/风险
- 下一步

## 7. 当前已知基线

截至 2026-11-07，本分支代码已存在沙盒场景、AI 程序化模型生成与隔离执行、模型编辑/参数、模型实例管理、基础玩家移动/附近模型交互回调、固定字段环境控制和 localStorage 保存恢复。具体事实、缺口和验证状态以 `PROGRESS.md` 的 2026-11-07 基线审查记录及最新源码为准。
