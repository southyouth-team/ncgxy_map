# 沙盒天空环境（穹顶/日月/星空）设计文档

日期：2026-11-12（rev. 3，经 builder-check 审查、用户决策与地块扩建约束修订）
状态：已获用户批准（2026-11-12），进入实施计划阶段

## 1. 意图与背景

### 1.1 为什么做

模型动画 Runtime 上线后，生成提示契约（`PROCEDURAL_MODEL_BOUNDARY_CONTRACT`）向 AI 承诺：沙盒宿主拥有 sky、sun、moon、stars、clouds、sky dome 等全套环境，模型不得自建。但代码盘点表明宿主只实现了：

- `scene.background` 纯色（昼夜/雨天插值，`createCampusEngine.js:1771-1776`）
- 太阳**光照**（`DirectionalLight` 方位随 `getVirtualSunState(hour)` 变化，夜间反向当月灯），无可见太阳圆盘
- `HemisphereLight` 补光、雾、雨粒子（`world-rain-effect`）

全仓不存在天空穹顶、太阳/月亮可见天体、星空、云的任何实现。契约承诺超前于实现，本设计补齐标准档天空：**穹顶渐变 + 太阳 + 月亮 + 星空**，随昼夜与雨天联动。云属于完整档，本次不做。

### 1.2 目标

1. 玩家在沙盒中能看到太阳圆盘随时间划过天空、黄昏在黄昏地平线处淡出；夜间月亮自日落方向升起、午夜升至天顶、日出时落下，星空同步淡入淡出
2. 全部视觉元素与现有昼夜时间（`time` 0-24）和天气（`clear`/`rain`）自动联动，无需新 UI 控件
3. 全部程序化生成，不引入外部纹理、不新增依赖
4. 每帧开销可忽略：静态几何 + 少量 uniform/透明度更新，不产生阴影开销
5. 提示契约中关于宿主天空的承诺由此名副其实，AI 侧提示与 Worker 校验均不需要改动

### 1.3 非目标（Non-goals）

- 云层（程序化云、随风漂移）——完整档范围，另行立项
- 月亮相位/月牙造型、银河、流星、外部光晕纹理（辉光用程序化 GLSL 实现，不使用贴图）
- 真实天文星历与大气散射 PBR——现有 `getVirtualSunState` 明确是 lightweight virtual day cycle，延续该定位
- 编辑器预览（`ProceduralModelEditor.vue` 独立小场景）接入天空
- 任何新的用户控件或 UI；现有时间滑杆、天气开关就是驱动入口

### 1.4 反目标（Anti-goals）

- 不允许天空元素参与碰撞、拾取、射线检测
- 不允许天空元素被静态合批、不投射/接收阴影
- 不把天空做成 AI 可生成的模型部件——它是引擎级单例，与 `rainEffect` 同级
- 不为了视觉效果改动现有灯光强度/色温体系与 `solarPosition.js` 的任何现有输出，天空是纯叠加层

## 2. 现状依据（代码证据）

| 事实 | 位置 |
|---|---|
| 虚拟太阳状态（elevation、daylight、isNight、direction） | `src/three/engine/solarPosition.js`，6 点日出、12 点正午、18 点日落 |
| direction 的 y 分量被钳为 `max(0.015, elevation)`，夜间仅翻转 x/z | `solarPosition.js:18,23-25`（决定月亮不能简单取反，见 §3.2） |
| 昼夜背景色/雾/灯光更新 | `createCampusEngine.js` `setEnvironment()` 1745-1796 |
| 灯光创建 | `createCampusEngine.js:2178-2193`（init 内） |
| 主循环每帧更新 | `animate()` 内 3400 起；远景地面跟随相机先例 3415-3418 |
| 室内状态 | 模块级 `indoorGroup`，进入 3510 / 退出 3956；雨粒子先例 `rainEffect.visible = !indoorGroup && rainy`（1792） |
| 相机裁剪面与自由总览拉远上限 | `PerspectiveCamera(48, 1, 0.5, 3200)`（CameraRig.js:19）；`maxDistance=1200`（CameraRig.js:124） |
| 渲染色彩状态 | NoToneMapping + SRGBColorSpace（createCampusEngine.js:1928-1930） |
| dispose 模式 | `createCampusEngine.js:4103-4154`，含 scene 遍历兜底释放 |
| 引擎纯逻辑测试传统 | `src/three/engine/*.test.js`（solarPosition、waterVolumeRuntime 等 12 个测试文件），无 WebGL 组件测试设施 |

## 3. 架构

### 3.1 文件结构

| 文件 | 职责 |
|---|---|
| `src/three/engine/skyVisualState.js`（新增） | 纯函数：太阳状态 + 天气 + 引擎注入的地平线色 → 天空视觉状态数据。无 THREE 依赖，可完整单测 |
| `src/three/engine/skyVisualState.test.js`（新增） | 纯逻辑 TDD 测试 |
| `src/three/engine/skyRuntime.js`（新增） | Three.js 对象工厂：构建穹顶/太阳/月亮/星空，消费视觉状态，提供 update/followCamera/setIndoor/dispose |
| `src/three/engine/rainFieldRuntime.js`（新增，Task 4 缺陷修复） | 雨粒子独立模块：粒子本地盒子循环 + 雨场 X/Z 跟随相机，提供 update/followCamera/setVisible/dispose |
| `src/three/camera/CameraRig.js`（修改，Task 4 反馈） | 第一人称仰视上限 1.25→1.5 rad；第三人称维持 -0.05 rad |
| `src/three/engine/createCampusEngine.js`（修改） | init 创建、setEnvironment 驱动、animate 跟随相机与室内可见性、dispose 释放 |

分层理由与 `solarPosition.js`（纯数据）+ 引擎（对象装配）一致：所有可判定对错的逻辑（透明度、颜色、天体轨道）集中在纯函数并被单测钉住；Three.js 装配部分仓库无 GL 测试环境，靠生产构建与浏览器清单验证。

### 3.2 视觉状态数据契约

```js
// skyVisualState.js
export function getSkyVisualState(sunState, weather = 'clear', horizonColor = null)
// sunState: getVirtualSunState(hour) 的返回值
// weather: 'clear' | 'rain'（其他值按 'clear' 归一化）
// horizonColor: 可选 { r, g, b }（0..1），由引擎把当前 scene.background 同值注入；
//               为 null 时纯函数用内置调色板派生（供独立测试与离线调用）
// 返回（全部普通数值，无 THREE 对象）：
{
  sun:         { direction: [x, y, z], opacity: Number },
  moon:        { direction: [x, y, z], opacity: Number },
  starsOpacity: Number,
  skyTop:      { r, g, b },   // 各分量 0..1 有限数
  skyHorizon:  { r, g, b },
}
```

#### 天体方向（rev. 2 核心修订）

`solarPosition.js` 输出的是**灯光方向**而非连续几何太阳方向：y 恒 ≥0.015，夜间整体翻转 x/z。因此：

1. `sun.direction`：直接取 `sunState.direction`（单位向量，y 恒正）。太阳圆盘仅在白天 opacity>0 时可见，黄昏贴地平线淡出，夜间 opacity=0 方向无视觉意义
2. `moon.direction`：**独立月亮弧**（用户 2026-11-12 决策），不与夜间灯光方向绑定，纯三角推导、不复制 0.92/0.28 等魔法常数：
   - 月亮仰角 `α = asin(clamp(-sunState.sunElevation, -1, 1))`：午夜太阳仰角 -1 → 月亮在天顶（+90°）；正午 → 地平线下（-90°）
   - 水平方位取反太阳方位：以 `sunState.direction` 的 (x,z) 归一化，白天取负（反太阳方位），夜间 `direction` 已翻转故取正；水平模长接近 0（天体近天顶/天底）时水平分量置 0
   - `moon.direction = [mx·cosα, sinα, mz·cosα]`，构造即单位向量
   - 自验效果：18 点日落时月亮 y≈0 且位于反太阳侧（升起），6 点日出时 y≈0（落下），午夜 y≈1（天顶）
3. 月亮圆盘**故意不与**夜间 `DirectionalLight` 方向对齐——这是用户确认接受的取舍：灯光体系一行不动，换取月亮整夜高悬、不被建筑遮挡

#### 透明度、地平淡出带与颜色

4. 基础昼夜透明度：`sun.opacity` 由 `sunState.daylight` 平滑映射，白天趋近 1、夜间为 0；`moon.opacity` 与 `starsOpacity` 由夜间程度（1-daylight 同族平滑）映射，白天为 0、夜间趋近 1，星星峰值略低于月亮
5. **地平淡出带（rev.3，地块扩建约束）**：在昼夜透明度之上再乘一个仰角闸门。命名常量 `HORIZON_FADE_ANGLE`（默认约 6°，实现期可调）：天体仰角 `α = asin(clamp(direction.y, -1, 1))`，`α ≤ 0` 时 opacity 强制为 0；`0 < α < HORIZON_FADE_ANGLE` 时乘以 `smoothstep(0, HORIZON_FADE_ANGLE, α)`；之上不衰减。几何验证：轨道半径 368 × sin6° ≈ 38.5，远大于太阳圆盘半径 14/月亮 10，全显时整个圆盘离地至少约 24 单位，与地面或任何地块在数学上不可能穿插。太阳（最低仰角约 0.9°）与月亮（18 点/6 点 α=0）都受此闸门约束，呈现"贴近地平前淡出、再从地平光带淡入"而非半埋落地
6. `weather === 'rain'`：三个天体透明度全部归零；天空两色向灰蓝（沿用现有雨天灰 `#788894` 系）插值
7. `skyHorizon`：注入了 `horizonColor` 时原样采用（钳制到 [0,1]），保证与 `scene.background` 同值、接缝在构造上不可能发生；未注入时按现有背景调色板（nightSky `#111d31` / dawnSky `#e4a77e` / daySky `#b9d0c2` / 雨天 `#788894`）派生
8. `skyTop`：以 horizon 色为基础按 daylight 向天顶深蓝/天蓝色系加深派生。具体色值是实现期调参项，测试只钉有限数、值域与"天顶亮度低于地平线"关系，不钉死 hex
9. 纯函数确定性：同输入必同输出，不读全局状态
10. **与地块扩建解耦**：天体方向是相机空间单位向量、穹顶恒以相机为球心，天体位置不引用任何世界坐标或地块尺寸；地块扩建、平移、抬高都不改变轨道与淡出规则。近处高地对低角度天体的视线遮挡（depthTest 保留）是唯一交互，而淡出带保证遮挡发生前天体已不可见

### 3.3 skyRuntime 对象契约

```js
export function createSkyRuntime(THREE)
// 返回 { group, update(state), followCamera(position), setIndoor(boolean), dispose() }
```

装配参数（默认值，实现期可调，命名常量集中在文件顶部）：

| 元素 | 实现 | 关键参数（默认） |
|---|---|---|
| 穹顶 | `SphereGeometry` + `BackSide` `ShaderMaterial`，天顶→地平线渐变由世界方向 y 分量 mix | 半径 400；`depthWrite=false`、`fog=false`、`frustumCulled=false`、低 renderOrder |
| 太阳 | `PlaneGeometry` 广告牌 + `ShaderMaterial`（白炽核心 + 双层暖色辉光，`AdditiveBlending`、transparent、`depthWrite=false`、`fog=false`、不投影、uOpacity uniform） | 平面边长 96（核心主体半径约 14），置于穹顶半径 × 0.92 处 |
| 月亮 | `PlaneGeometry` 广告牌 + `ShaderMaterial`（柔边圆盘 + fbm 程序化月海暗斑 + 淡蓝白辉光，`NormalBlending`，其余属性同太阳） | 平面边长 44（主体半径约 10） |
| 星空 | `BufferGeometry` 随机球面方向 + `Points`/`PointsMaterial`（白色、transparent、`depthWrite=false`、`fog=false`） | 600 颗，分布半径 380 |

- `update(state)`：写穹顶两个颜色 uniform、按方向重定位日月、写日月 shader 的 uOpacity uniform 与星星 PointsMaterial.opacity
- `followCamera(position)`：**XYZ 三轴全跟随**（rev. 2 修订）：`group.position` 完整复制相机位置，相机恒位于球心，任何拉远/俯视都不可能穿出穹顶；日月星辰相对相机的方向由局部坐标保证，与 group 位移无关，无 parallax 问题。半径 400 无需放大，远小于相机 far=3200
- `setIndoor(flag)`：`group.visible = !flag`
- `dispose()`：释放全部 geometry 与 material（含 ShaderMaterial）
- 深度策略（rev.3）：穹顶与星空 `depthWrite=false`；日月圆盘同样 `depthWrite=false` 但**保留 `depthTest=true`**——不向深度缓冲写任何东西（杜绝天空在地面/建筑上留深度），同时近处不透明建筑仍能正常遮挡低角度天体；"不埋进地块"由 §3.2 淡出带在透明度层面保证，而不是关闭深度测试（关闭会导致天体画在建筑前面，更违和）
- 星空只在上半天球生成（方向 y 大于小阈值），下半球不布点，避免星点贴近地面
- 色彩空间注意：引擎为 NoToneMapping + SRGBColorSpace，自定义 ShaderMaterial 不会自动做输出转换，片元色须按 three r180 的 colorspace 输出惯例处理后才能与 `scene.background` 颜色一致；浏览器清单专项核对接缝

### 3.4 引擎接线（4 处）

1. **init**（2193 灯光创建后）：`skyRuntime = createSkyRuntime(THREE)`，`scene.add(skyRuntime.group)`，并用当前 `environmentConfig` 立即 update 一次
2. **setEnvironment**（1776 背景色更新旁）：背景色仍按现有逻辑算出并赋给 `scene.background`，然后把**同一个颜色值**作为 `horizonColor` 注入 `getSkyVisualState(getVirtualSunState(time), weather, horizonColor)`，再 `skyRuntime.update(state)`；现有背景/雾/灯光计算一行不改
3. **animate 主循环**（3415 地面跟随旁）：每帧 `followCamera(cameraRig.camera.position)`；`skyRuntime.setIndoor(Boolean(indoorGroup))` 每帧同步可见性（不依赖事件接线点，进出入室内不会漏）
4. **dispose**（4144 shadowSystem 释放旁）：`skyRuntime.dispose()` 后置空

### 3.5 与现有系统的相互作用

- **雾**：穹顶与天体材质 `fog=false`，不受场景雾影响；雾继续作用于地表物体，背景兜底色与穹顶 horizon 色同源
- **雨**：雨粒子的视觉参数（颜色、密度、下落速度）不动；Task 4 浏览器验收发现固定雨盒缺陷后，雨系统重构为独立 `rainFieldRuntime.js` 模块并新增相机 X/Z 跟随（见 §7 决策 9），粒子本身的循环/风偏算法逐行迁移、行为不变
- **灯光**：`DirectionalLight`/`HemisphereLight` 参数与 `solarPosition.js` 输出一行不动；太阳圆盘与其光照同源（都来自 `sunState.direction`）天然对齐；月亮圆盘按 §3.2 独立轨道运行，不对齐夜间灯光（已确认取舍）
- **合批/碰撞/拾取**：天空 group 不进 `staticModelBatcher`、不进 Rapier、不进 raycaster 交互列表（引擎级对象与沙盒模型分属不同 scene 子树，现有合批只遍历 `sandboxModels`）
- **模型边界契约**：AI 模型仍禁止自建天空/太阳（Worker 硬校验不变），宿主现在真正提供了这些元素
- **地块扩建（rev.3）**：天空层不持有任何地块引用，不读取地面尺寸或边界；穹顶以相机为球心、半径固定 400，远景地面从 12000 宽扩建到任意尺度都不影响天空。未来若出现高层建筑群遮挡低角度太阳，属正常视线行为；若产品上要求"天体永不被遮挡"，备选是对日月材质关闭 depthTest（代价：天体会画在楼体前面），本次不做，留作真实需求出现时的开关

## 4. 测试策略（TDD）

### 4.1 自动化（Vitest，纯函数层）

`skyVisualState.test.js` 先写失败测试，覆盖：

1. 正午（hour=12）：sun.opacity 接近 1、moon 与 stars 为 0；moon.direction.y < 0（地平线下）
2. 午夜（hour=0/24）：moon 与 stars 趋近 1、sun 为 0；moon.direction.y > 0.9（近天顶）
3. 日出/日落（6、18）：sun opacity 严格位于 (0, 1) 开区间；moon.direction.y 接近 0（容差 ±0.05），且月亮水平方位与太阳水平方位相反。该时刻月亮仰角≈0，由地平淡出带压至不可见（opacity≈0），其透明度过渡改用构造仰角的 sunState 输入在淡出带专用测试中验证（整数小时取不到开区间样本，见 §7 决策 6）
4. 雨天任意时刻：sun/moon/stars opacity 全为 0
5. 雨天与晴天同小时的天空色不同，且雨天偏向灰蓝
6. 所有颜色分量为有限数且在 [0,1]；skyTop 亮度严格低于 skyHorizon
7. `sun.direction` 与 `sunState.direction` 逐分量相等且为单位向量；`moon.direction` 恒为单位向量；午夜近天顶、正午地平线下（替代 rev.1 中"日月恒反向"的旧断言——独立月亮弧下两者不再严格反向）
8. 同输入两次调用结果深相等（确定性）
9. 非法 weather 值按 clear 归一化、非法 hour 不产生 NaN（沿用 solarPosition 的容错）
10. 注入 `horizonColor` 时返回的 `skyHorizon` 与其同值（接缝构造性保证）
11. 地平淡出带：构造方向 y≤0 的输入（午夜太阳/18 点月亮）断言其 opacity 严格为 0；同一昼夜通道内，低仰角 opacity 严格小于高仰角 opacity；雨天仍恒为 0（闸门与天气取与）
12. 几何余量：对所有输出 opacity>0 的天体，`direction.y × 轨道半径 ≥ 圆盘半径 + 安全边距`（用与 skyRuntime 共享的命名常量断言，保证全显圆盘不触地）

### 4.2 非自动化（仓库无浏览器测试设施，沿用上一轮 ruling）

生产构建通过后，浏览器人工验证清单：

- 正午：蓝天穹顶 + 暖色太阳，太阳方位与阴影方向一致
- 拖时间到黄昏：地平线暖色带、太阳在触地前淡出（无半埋）；月亮在反方向从地平光带淡入，看不到圆盘切入地面
- 夜晚：深蓝穹顶、月亮高悬（午夜近天顶）、星星淡入；人工灯开关不影响天空
- 站在地块边界与远景地面边缘、时间拖到日出/日落：天体不与任何地块/地面穿插（扩建约束专项）
- 切雨天：天体消失、穹顶变灰、雨粒子照常
- 进/出室内建筑：天空整体隐藏/恢复
- 自由总览拉远到 maxDistance=1200 并俯视：穹顶始终包裹、无穿出突变（XYZ 跟随后构造性保证，仍肉眼复核）
- 低角度平视：穹顶与背景色无缝、无色差（专项核对 ShaderMaterial 色彩空间输出）
- 长时运行无显存增长（dispose 检查在离开沙盒页时）

## 5. 风险与边界

| 风险 | 应对 |
|---|---|
| 月亮方向误用灯光方向取反导致钻地 | §3.2 明确独立轨道公式；测试 2/3/7 钉死天顶/地平线/单位向量 |
| 穹顶在自由总览极端拉远时被穿出 | XYZ 三轴全跟随，相机恒在球心，构造性消除；半径 400 维持不变 |
| 穹顶与背景色接缝 | horizonColor 由引擎同值注入，纯函数无第二套调色路径（未注入的内置派生仅供测试） |
| ShaderMaterial 色彩空间不一致 | r180 输出转换惯例处理；浏览器清单专项核对 |
| 穹顶遮挡场景物体 | depthWrite=false + 低 renderOrder，天体均不写深度 |
| ShaderMaterial 编译失败（低端 GPU） | GLSL 仅用最基础 varying/mix，无扩展依赖；失败影响仅限天空层，不阻断主循环 |
| 纯函数外的装配无单测 | 逻辑全部上移到纯函数；装配遵循 rainEffect/activeHorizonGround 先例，构建+浏览器清单兜底 |
| 月亮与夜间灯光方向不对齐 | 用户 2026-11-12 确认的取舍；夜间无可见"灯光来源"标记，风格化场景可接受 |
| 未来加云时的扩展点 | 视觉状态契约为 weather 留了归一化入口；云作为 skyRuntime 内新成员加入即可，不改引擎接线面 |

## 6. 实施轮廓（审批后细化为 writing-plans 计划）

1. TDD 实现 `skyVisualState.js`（RED→GREEN，约 10 个测试）
2. 实现 `skyRuntime.js` 装配（无单测，构建验证）
3. 引擎四处接线 + 生产构建
4. 前端全量测试回归（允许既有 9 个红，不新增失败）
5. 浏览器清单人工验证（用户侧）
6. 单独 `feat(mvp)` 提交，不与其他工作混合

## 7. 决策记录（builder-check 审查结论）

2026-11-12 全新上下文审查者以"开工工程师"视角试读 rev.1，提出 4 项，处置如下：

1. **月亮钻地（契约缺陷）**：rev.1 写 `moon.direction = -sun.direction`，但夜间灯光方向 y 为正、取反后月亮入地。处置：契约改为独立月亮弧（见 §3.2），并新增天顶/地平线测试
2. **月亮仰角只有 1–3°（产品取舍）**：用户在三方案中选定独立月亮弧（午夜天顶），放弃与夜间灯光对齐；不改 `solarPosition.js`、不触碰灯光行为
3. **穹顶半径 400 会被自由总览穿出**：处置为 followCamera 改 XYZ 全跟随（相机恒在球心），不放大半径、不重调天体尺寸
4. **背景色双路径手工同步风险**：处置为引擎注入同值 `horizonColor`，setEnvironment 现有逻辑保持唯一调色数据源，纯函数只负责天顶派生与透明度
5. **地块扩建与天体落地（用户 2026-11-12 追加约束）**：用户担心沙盒扩建后日月东升西落落进地块。处置：地平淡出带（仰角闸门，α≤0 必不可见、6° 内平滑淡出）+ 天体只存在于相机空间、不引用地块坐标 + 天体材质 depthWrite 关闭但保留 depthTest；测试 11/12 从透明度与几何余量两个层面钉死。"天体永不被遮挡"的 depthTest=false 备选明确留待真实需求
6. **测试 3 执行期修订（2026-11-12 TDD 实测）**：18 点月亮仰角≈0 被淡出带压到 ~1e-15，且月亮可见过渡窗口仅约 18:20-18:24 四个游戏分钟，整数小时取不到 opacity 开区间样本。测试 3 只对太阳保留开区间断言，月亮过渡改由构造仰角输入的专用测试精确覆盖；实际落地 23 个纯函数测试 + 6 个装配测试 + 3 个相机测试
7. **天体外观升级（用户 2026-11-12 实测反馈"不能只是一个圆盘"）**：日月从 CircleGeometry+MeshBasicMaterial 改为 PlaneGeometry 广告牌 + 自定义 ShaderMaterial。太阳加性混合辉光、月亮 fbm 程序化月海，仍零纹理；透明度改由 uOpacity uniform 驱动。装配测试同步钉死材质类型、混合模式与 uniform
8. **相机仰视限制修复（同批反馈"头抬不起来看不到头顶"，二次修订）**：根因是 CameraRig 两处硬 clamp——第一人称 firstPitch 上限 1.25 rad（71.6°）、第三人称 thirdPitch 仰视下限 -0.05 rad（2.9°）。最终修复：**第一人称**放宽到 1.5 rad（85.9°，留 4° 防朝向退化；相机位置固定眼高只转视线，抬头不移动相机，这是看天顶的正确机制，3D 视图按 V 键切换）；**第三人称维持 -0.05 rad 不变**——首轮曾放宽到 -0.2 rad，实测相机绕玩家下沉，拉远到 distance=32 时相机 y≈-2.66 钻入地面以下（遮挡射线列表不含地面，无拦截），用户反馈"看到底下"后回退；穿地保护由测试"最大仰视+最远相机距离下 desiredPosition.y>0"钉死。新增 `src/three/camera/CameraRig.test.js`（该目录首个测试，4 个用例），用 Object.create(prototype) 绕过 DOM 构造只测姿态数值
9. **固定雨盒缺陷修复（用户 Task 4 反馈"下雨只下了一块"）**：根因是旧 `ensureRainEffect/updateRainEffect` 闭包把 360 条雨丝写死在世界原点 60×60×24 的盒子里、无任何相机跟随，玩家走出盒子（尤其扩建后的大地块）雨就停了。处置：抽出 `src/three/engine/rainFieldRuntime.js`（与 skyRuntime 对称的独立模块），粒子循环/风偏算法逐行迁移不变，新增 `followCamera`——雨场 X/Z 跟随相机、y 恒 0 贴地；引擎 9 处引用改为模块 API，懒创建改为 init 显式创建并接入 dispose。7 个 vitest 用例钉死盒子边界、600 帧循环不越界、风偏、不可见早退、跟随语义与 dispose 幂等。调试中确认 three r180 的 `BufferAttribute.needsUpdate` 是只写 setter，断言须读 `version`
