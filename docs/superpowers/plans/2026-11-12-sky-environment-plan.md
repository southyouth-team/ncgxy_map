# 沙盒天空环境 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为沙盒引擎新增程序化天空层（渐变穹顶、太阳圆盘、独立轨道月亮、星空），随昼夜/雨天/室内联动，且天体永不与地块穿插。

**Architecture:** 纯函数模块 `skyVisualState.js` 承载全部可判定逻辑（天体轨道、地平淡出带、透明度、颜色派生），无 THREE 依赖、完整单测；`skyRuntime.js` 是 three 对象工厂，消费视觉状态并管理穹顶/日月/星空的生命周期；`createCampusEngine.js` 四处接线（init/setEnvironment/animate/dispose），现有灯光、雾、雨、背景调色逻辑一行不改。

**Tech Stack:** three ^0.180.0、vitest 2.1.x（ESM，`npm test` = `vitest run`）、vite 6（`npm run build`）

**Spec:** `docs/superpowers/specs/2026-11-12-sandbox-sky-environment-design.md`（rev.3，已批准；计划与 spec 冲突时以 spec 为准并记 Ruling）

## Global Constraints

- 不新增 npm 依赖；全部程序化生成，无外部纹理
- 不修改 `solarPosition.js`、灯光参数、雾、雨粒子与 setEnvironment 既有调色计算；天空是纯叠加层
- 断言抛错一律用字符串/正则 `toThrow`，本仓库 vitest 2.1.9 不支持函数谓词（无 prototype 的箭头函数会炸）
- 提交/推送：未经用户当轮明确授权不得 `git commit`、不得 `git push`；任务末尾的提交步骤是**待授权检查点**，默认停在未提交状态
- commit message 末尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`
- 浏览器视觉效果未人工实测前，不得宣称视觉成功；自动化只证明逻辑与装配
- 既有 9 个红测试（PhysicsRuntime/CharacterMotor/InputController/PlayerCharacterRuntime）为基线，允许存在但不得新增失败
- 命名常量（穹顶半径、天体半径、淡出角、轨道半径、星数）集中在 `skyVisualState.js` 导出，skyRuntime 与测试共享同一份，禁止复制魔法数

## Review Focus

spec 与任务测试未覆盖、但最可能咬人的 5 个失效模式：

1. **时间滑杆高速拖动**：setEnvironment 一秒内被调多次。纯函数无状态、update 幂等是防线——Task 1 确定性测试钉死同输入同输出；Task 4 浏览器清单实际狂拖验证无 NaN/跳变。
2. **雨天 × 室内组合状态**：rain 把 opacity 归零、setIndoor 隐藏 group，切回晴天/出室后不得残留隐藏或零透明度——Task 2 的 setIndoor 测试 + Task 4 组合切换清单。
3. **ShaderMaterial 色彩空间接缝**：引擎是 NoToneMapping + SRGBColorSpace（createCampusEngine.js:1928-1930），自定义 shader 不自动做输出转换，穹顶 horizon 色可能与 scene.background 色差。无自动化可覆盖——Task 4 平视接缝专项肉眼核对。
4. **沙盒页 dispose 后重进**：工厂重建不得产生重复对象或显存泄漏——Task 2 dispose 幂等测试 + Task 4 进出沙盒页两次后观察。
5. **自由总览 maxDistance=1200 俯视**：XYZ 全跟随在构造上保证相机恒在球心，但 group 每帧位移与 frustumCulled=false 的实际表现需肉眼复核——Task 4 极端拉远清单。

---

### Task 1: skyVisualState 纯函数模块（轨道/淡出带/透明度/颜色）

**Files:**
- Create: `src/three/engine/skyVisualState.js`
- Test: `src/three/engine/skyVisualState.test.js`

**Interfaces:**
- Consumes: `getVirtualSunState(hour)` 的返回 `{ hour, sunElevation, daylight, isNight, direction:[x,y,z] }`（`./solarPosition.js`）
- Produces:
  - 导出常量 `HORIZON_FADE_ANGLE`（弧度，默认 6°=π/30）、`SKY_DOME_RADIUS=400`、`CELESTIAL_ORBIT_RADIUS=SKY_DOME_RADIUS*0.92`、`SUN_DISK_RADIUS=14`、`MOON_DISK_RADIUS=10`、`STAR_COUNT=600`、`STAR_SHELL_RADIUS=380`
  - `getSkyVisualState(sunState, weather = 'clear', horizonColor = null)` → `{ sun:{direction,opacity}, moon:{direction,opacity}, starsOpacity, skyTop:{r,g,b}, skyHorizon:{r,g,b} }`，direction 为三元素普通数组
  - 内部辅助（不导出或导出均可）：`moonDirection(sunState)`、`applyHorizonFade(direction, baseOpacity)`

- [ ] **Step 1: 写失败测试——昼夜透明度与日月方向（spec §4.1 测试 1-3、7）**

`skyVisualState.test.js` 先写这一簇，断言要点：
```js
import { describe, expect, it } from 'vitest'
import { getVirtualSunState } from './solarPosition.js'
import { getSkyVisualState, HORIZON_FADE_ANGLE, CELESTIAL_ORBIT_RADIUS, SUN_DISK_RADIUS, MOON_DISK_RADIUS } from './skyVisualState.js'

const isUnit = (v) => expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 6)

it('正午：太阳全显、月星隐藏，月亮位于地平线下', () => {
  const s = getSkyVisualState(getVirtualSunState(12))
  expect(s.sun.opacity).toBeGreaterThan(0.95)
  expect(s.moon.opacity).toBe(0)
  expect(s.starsOpacity).toBe(0)
  expect(s.moon.direction[1]).toBeLessThan(0)
  isUnit(s.sun.direction); isUnit(s.moon.direction)
})

it('午夜：月亮近天顶、星空显现、太阳隐藏', () => {
  const s = getSkyVisualState(getVirtualSunState(0))
  expect(s.moon.opacity).toBeGreaterThan(0.9)
  expect(s.starsOpacity).toBeGreaterThan(0)
  expect(s.sun.opacity).toBe(0)
  expect(s.moon.direction[1]).toBeGreaterThan(0.9)
})

it.each([6, 18])('小时 %s：日月透明度都在开区间，月亮贴地平线且水平方位与太阳相反', (hour) => {
  const solar = getVirtualSunState(hour)
  const s = getSkyVisualState(solar)
  expect(s.sun.opacity).toBeGreaterThan(0); expect(s.sun.opacity).toBeLessThan(1)
  expect(s.moon.opacity).toBeGreaterThan(0); expect(s.moon.opacity).toBeLessThan(1)
  expect(Math.abs(s.moon.direction[1])).toBeLessThan(0.05)
  // 水平方位相反（y≈0 时方向即水平方向）
  expect(s.moon.direction[0]).toBeCloseTo(-s.sun.direction[0], 1)
  expect(s.moon.direction[2]).toBeCloseTo(-s.sun.direction[2], 1)
})

it('sun.direction 与 sunState.direction 逐分量相等', () => {
  const solar = getVirtualSunState(14)
  expect(getSkyVisualState(solar).sun.direction).toEqual(solar.direction)
})
```

- [ ] **Step 2: 跑测试亲见 RED**

Run: `npx vitest run src/three/engine/skyVisualState.test.js`
Expected: FAIL，模块无法解析（`Failed to resolve import` 或 does not provide export）

- [ ] **Step 3: 实现轨道与透明度骨架使本簇转绿**

`skyVisualState.js` 实现要点（签名与算法是计划决定的，照此写）：
- `moonDirection(sunState)`：`moonElevation = -asin(clamp(sunState.sunElevation,-1,1))`；取 `sunState.direction` 的 (x,z) 归一化为太阳水平方位，`flip = sunState.isNight ? 1 : -1` 后取反得月亮水平方位；水平模长 <1e-6（近天顶/天底）时水平分量置 0；返回 `[mx·cos(moonElevation), sin(moonElevation), mz·cos(moonElevation)]` 并归一化兜底
- 基础透明度：sun 用 daylight 平滑映射（daylight≥阈值趋近 1，isNight 为 0）；moon/stars 用同族夜间量映射，stars 峰值乘 0.85 左右
- 颜色字段本步先返回合法占位（{r:0,g:0,b:0} 之外的有限值），下一簇再钉

- [ ] **Step 4: 跑测试亲见 GREEN**

Run: `npx vitest run src/three/engine/skyVisualState.test.js`
Expected: 本簇 4 个 it 全 PASS

- [ ] **Step 5: 写失败测试——地平淡出带（spec §4.1 测试 11-12，rev.3 地块约束）**

追加：
```js
it('仰角 ≤0 的天体 opacity 严格为 0', () => {
  const noon = getSkyVisualState(getVirtualSunState(12))   // 月亮在天底
  expect(noon.moon.opacity).toBe(0)
  const sunset = getSkyVisualState(getVirtualSunState(18)) // 月亮 y≈0；若浮点微正也必须被闸门压到 0 或断言 < 极小值
  expect(sunset.moon.direction[1] <= 0 ? sunset.moon.opacity : sunset.moon.opacity).toBeLessThanOrEqual(1)
})

it('同一通道低仰角 opacity 严格小于高仰角 opacity', () => {
  const rising = getSkyVisualState(getVirtualSunState(19)) // 月亮初升
  const high = getSkyVisualState(getVirtualSunState(0))    // 月亮天顶
  expect(high.moon.direction[1]).toBeGreaterThan(rising.moon.direction[1])
  expect(high.moon.opacity).toBeGreaterThan(rising.moon.opacity)
})

it('全显天体几何余量：圆盘最低点离地至少一个安全边距', () => {
  for (const hour of [0, 21, 3]) {
    const s = getSkyVisualState(getVirtualSunState(hour))
    if (s.moon.opacity > 0) {
      expect(s.moon.direction[1] * CELESTIAL_ORBIT_RADIUS).toBeGreaterThan(MOON_DISK_RADIUS + 8)
    }
  }
  const day = getSkyVisualState(getVirtualSunState(12))
  expect(day.sun.direction[1] * CELESTIAL_ORBIT_RADIUS).toBeGreaterThan(SUN_DISK_RADIUS + 8)
})

it('HORIZON_FADE_ANGLE 为正且小于 15 度', () => {
  expect(HORIZON_FADE_ANGLE).toBeGreaterThan(0)
  expect(HORIZON_FADE_ANGLE).toBeLessThan(15 * Math.PI / 180)
})
```
注意第 1 个 it 第二行是兜底写法；实现完成后若 18 点月亮 y 严格为 0（期望如此），直接断言 `opacity === 0` 并删掉三元分支。

- [ ] **Step 6: 跑测试亲见 RED，再实现 `applyHorizonFade`**

Expected RED: 淡出带断言失败（当前骨架无闸门）。
实现：`elevation = asin(clamp(direction[1],-1,1))`；≤0 返回 0；≥HORIZON_FADE_ANGLE 返回 baseOpacity；之间乘 `smoothstep(0, HORIZON_FADE_ANGLE, elevation)`（smoothstep 与 solarPosition 同款实现，本文件自带小工具）。sun/moon 两个圆盘通道过此闸门；stars 是整个上半球壳层、无单一方向，其透明度只走过昼夜+雨天映射（白天 0、夜间趋近峰值），不套仰角闸门。
再跑至 GREEN。

- [ ] **Step 7: 写失败测试——雨天、颜色、注入、容错、确定性（spec §4.1 测试 4-6、9-10）**

追加：
```js
it.each([0, 12, 18])('雨天小时 %s：日月星 opacity 全为 0', (hour) => {
  const s = getSkyVisualState(getVirtualSunState(hour), 'rain')
  expect(s.sun.opacity).toBe(0); expect(s.moon.opacity).toBe(0); expect(s.starsOpacity).toBe(0)
})

it('雨天天空色比晴天偏灰蓝且两色不同', () => {
  const solar = getVirtualSunState(14)
  const clear = getSkyVisualState(solar, 'clear')
  const rain = getSkyVisualState(solar, 'rain')
  expect(rain.skyHorizon).not.toEqual(clear.skyHorizon)
  // 灰化：rain 的 r/g/b 通道极差更小
  const spread = (c) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)
  expect(spread(rain.skyHorizon)).toBeLessThan(spread(clear.skyHorizon))
})

it('所有颜色分量为 [0,1] 有限数，天顶亮度低于地平线', () => {
  for (const hour of [0, 6, 12, 18, 22]) {
    const s = getSkyVisualState(getVirtualSunState(hour))
    for (const c of [s.skyTop, s.skyHorizon]) for (const k of ['r','g','b']) {
      expect(Number.isFinite(c[k])).toBe(true)
      expect(c[k]).toBeGreaterThanOrEqual(0); expect(c[k]).toBeLessThanOrEqual(1)
    }
    const lum = (c) => 0.2126*c.r + 0.7152*c.g + 0.0722*c.b
    expect(lum(s.skyTop)).toBeLessThan(lum(s.skyHorizon))
  }
})

it('注入 horizonColor 时 skyHorizon 同值（钳制到 [0,1]）', () => {
  const s = getSkyVisualState(getVirtualSunState(12), 'clear', { r: 0.2, g: 0.4, b: 0.6 })
  expect(s.skyHorizon).toEqual({ r: 0.2, g: 0.4, b: 0.6 })
})

it('非法 weather 按 clear 归一化；非法 sunState 不产生 NaN', () => {
  const solar = getVirtualSunState(12)
  expect(getSkyVisualState(solar, 'snow')).toEqual(getSkyVisualState(solar, 'clear'))
  const broken = getSkyVisualState({ sunElevation: NaN, daylight: NaN, isNight: false, direction: [NaN, NaN, NaN] })
  const allFinite = (v) => [v.sun.direction, v.moon.direction].flat().every(Number.isFinite)
    && [broken.sun.opacity, broken.moon.opacity, broken.starsOpacity].every(Number.isFinite)
  expect(allFinite(broken)).toBe(true)
})

it('同输入两次调用深相等', () => {
  const solar = getVirtualSunState(17.5)
  expect(getSkyVisualState(solar, 'rain', {r:0.1,g:0.2,b:0.3}))
    .toEqual(getSkyVisualState(solar, 'rain', {r:0.1,g:0.2,b:0.3}))
})
```

- [ ] **Step 8: RED 后实现颜色/天气/注入/容错至全绿**

Expected RED: 雨天与颜色断言失败。
实现要点：
- weather 归一化：`const rainy = weather === 'rain'`，其他值等同 clear；rainy 时三个 opacity 直接置 0（闸门之后取与）
- 未注入 horizonColor 的兜底派生：复刻 setEnvironment 调色板（nightSky `#111d31`、dawnSky `#e4a77e`、daySky `#b9d0c2`、rain 灰 `#788894` lerp 0.55），写成 0..1 普通对象而非 THREE.Color（模块禁 THREE 依赖）
- skyTop：在 horizon 色上按 daylight 向深蓝/天蓝加深，保证 luminance 严格更小；rainy 两色都向灰蓝收敛
- 容错：入口对 sunState 字段做 Number.isFinite 兜底（sunElevation→0、daylight→0、direction 非法→[0,1,0]）
- 跑至全绿

- [ ] **Step 9: 任务级回归**

Run: `npx vitest run src/three/engine/`
Expected: 新文件全部 PASS，engine 目录既有用例零新增失败

- [ ] **Step 10: 提交检查点（待用户授权，默认不执行）**

授权后：`git add src/three/engine/skyVisualState.js src/three/engine/skyVisualState.test.js`，message 用 `feat(mvp): add pure sky visual state with celestial orbit and horizon fade`

---

### Task 2: skyRuntime three 对象工厂（穹顶/日月/星空/生命周期）

**Files:**
- Create: `src/three/engine/skyRuntime.js`
- Test: `src/three/engine/skyRuntime.test.js`

**Interfaces:**
- Consumes: `getSkyVisualState` 的返回结构；Task 1 导出的尺寸常量；`import * as THREE from 'three'`（由引擎传入，与 worker 风格一致：`createSkyRuntime(THREE)`）
- Produces: `createSkyRuntime(THREE)` → `{ group, update(state), followCamera(position), setIndoor(flag), dispose() }`

- [ ] **Step 1: 写失败测试——工厂结构与生命周期（vitest 可直接实例化 three 对象，先例 modelSubtreePolicy.test.js）**

```js
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createSkyRuntime } from './skyRuntime.js'
import { getVirtualSunState } from './solarPosition.js'
import { getSkyVisualState, CELESTIAL_ORBIT_RADIUS, STAR_COUNT } from './skyVisualState.js'

function findByName(root, name) {
  let found = null
  root.traverse((o) => { if (o.name === name) found = o })
  return found
}

it('创建穹顶/太阳/月亮/星空四个命名成员且穹顶为 BackSide、不写深度', () => {
  const rt = createSkyRuntime(THREE)
  expect(rt.group).toBeInstanceOf(THREE.Group)
  const dome = findByName(rt.group, 'sky-dome')
  expect(dome).toBeTruthy()
  expect(dome.material.side).toBe(THREE.BackSide)
  expect(dome.material.depthWrite).toBe(false)
  expect(findByName(rt.group, 'sky-sun')).toBeTruthy()
  expect(findByName(rt.group, 'sky-moon')).toBeTruthy()
  expect(findByName(rt.group, 'sky-stars')).toBeTruthy()
})

it('update 后日月位置沿方向放到轨道半径、透明度同步', () => {
  const rt = createSkyRuntime(THREE)
  const state = getSkyVisualState(getVirtualSunState(12))
  rt.update(state)
  const sun = findByName(rt.group, 'sky-sun')
  expect(sun.position.distanceTo(new THREE.Vector3(...state.sun.direction).multiplyScalar(CELESTIAL_ORBIT_RADIUS))).toBeLessThan(1e-4)
  expect(sun.material.opacity).toBeCloseTo(state.sun.opacity, 6)
  expect(sun.material.depthWrite).toBe(false)
  expect(sun.material.fog).toBe(false)
})

it('followCamera 三轴复制相机位置；setIndoor 切换 visible', () => {
  const rt = createSkyRuntime(THREE)
  rt.followCamera(new THREE.Vector3(12, 88, -5))
  expect(rt.group.position.toArray()).toEqual([12, 88, -5])
  rt.setIndoor(true); expect(rt.group.visible).toBe(false)
  rt.setIndoor(false); expect(rt.group.visible).toBe(true)
})

it('dispose 释放资源且可重复调用不抛', () => {
  const rt = createSkyRuntime(THREE)
  expect(() => rt.dispose()).not.toThrow()
  expect(() => rt.dispose()).not.toThrow()
})

it('星空星数等于 STAR_COUNT 且只分布在上半天球', () => {
  const rt = createSkyRuntime(THREE)
  const stars = findByName(rt.group, 'sky-stars')
  expect(stars.geometry.attributes.position.count).toBe(STAR_COUNT)
  const arr = stars.geometry.attributes.position.array
  for (let i = 1; i < arr.length; i += 3) expect(arr[i]).toBeGreaterThan(0)
})
```

- [ ] **Step 2: 跑测试亲见 RED**

Run: `npx vitest run src/three/engine/skyRuntime.test.js`
Expected: FAIL，模块无法解析

- [ ] **Step 3: 实现 skyRuntime.js**

- 穹顶：`SphereGeometry(SKY_DOME_RADIUS, 32, 16)` + `ShaderMaterial({ side:BackSide, depthWrite:false, fog:false, uniforms:{ topColor, horizonColor }, vertexShader/fragmentShader })`，fragment 用归一化世界方向 y 做 mix（`smoothstep(-0.15, 0.35, normalize(vWorldPosition).y)` 量级，实现期微调）；`frustumCulled=false`、`renderOrder=-1`、name `sky-dome`
- 日月：`CircleGeometry(半径, 32)` + `MeshBasicMaterial({ transparent:true, depthWrite:false, fog:false })`，太阳暖黄、月亮淡蓝白；不设 castShadow/receiveShadow；name `sky-sun`/`sky-moon`
- 星空：600 个上半球方向（拒绝 y≤小阈值 的采样重投）乘 STAR_SHELL_RADIUS 写 BufferGeometry，`PointsMaterial({ size, transparent:true, depthWrite:false, fog:false })`，name `sky-stars`
- `update(state)`：写两个颜色 uniform（THREE.Color），日月 `position.set(...direction).multiplyScalar(CELESTIAL_ORBIT_RADIUS)`、material.opacity 同步，stars.material.opacity = starsOpacity
- `followCamera(p)`：`group.position.copy(p)`
- `setIndoor(flag)`：`group.visible = !flag`
- `dispose()`：traverse 释放 geometry/material（数组 material 兼容），幂等（disposed 标志）
- r180 色彩空间：ShaderMaterial 片元输出按 three 输出色彩空间惯例处理（`colorspace_fragment` chunk 或等价转换），与 scene.background 一致性留 Task 4 肉眼核对

- [ ] **Step 4: 跑测试亲见 GREEN**

Run: `npx vitest run src/three/engine/skyRuntime.test.js`
Expected: 5 个 it 全 PASS

- [ ] **Step 5: 任务级回归**

Run: `npx vitest run src/three/engine/`
Expected: 全部 PASS，无新增失败

- [ ] **Step 6: 提交检查点（待用户授权）**

`feat(mvp): add procedural sky runtime with dome, celestial bodies and stars`

---

### Task 3: createCampusEngine 四处接线与全量回归

**Files:**
- Modify: `src/three/engine/createCampusEngine.js`
  - import 区（:16 旁）、模块变量（:407 旁）、init 灯光后（:2193 后）、setEnvironment（:1776 后）、animate（:3418 后）、dispose（:4145 旁）
- Test: 无新测试文件；本任务是装配，靠 Task 1/2 测试 + 构建 + 全量回归守门

**Interfaces:**
- Consumes: Task 1/2 的两个模块
- Produces: 引擎运行时持有 `skyRuntime` 单例，每帧跟随相机、每次 setEnvironment 刷新视觉状态

- [ ] **Step 1: 加 import 与模块变量**

:16 旁加：
```js
import { getSkyVisualState } from './skyVisualState.js'
import { createSkyRuntime } from './skyRuntime.js'
```
:407 `let hemisphereLight = null` 旁加 `let skyRuntime = null`

- [ ] **Step 2: init 创建并首次刷新（:2193 `scene.add(directionalLight)` 之后）**

```js
skyRuntime = createSkyRuntime(THREE)
skyRuntime.group.name = 'world-sky-layer'
scene.add(skyRuntime.group)
const initialSolar = getVirtualSunState(environmentConfig.time)
skyRuntime.update(getSkyVisualState(initialSolar, environmentConfig.weather, null))
skyRuntime.setIndoor(Boolean(indoorGroup))
```
（首次无注入色可接受：第一次 setEnvironment 即会带注入色刷新；若 init 后首帧前有渲染，兜底调色板与旧背景同色系）

- [ ] **Step 3: setEnvironment 注入同值背景色（:1776 `scene.background = sky` 之后）**

```js
if (skyRuntime) {
  const skyState = getSkyVisualState(solar, weather, { r: sky.r, g: sky.g, b: sky.b })
  skyRuntime.update(skyState)
}
```
不动 :1771-1779 任何既有行；`sky` 是 THREE.Color，取其线性分量同值注入

- [ ] **Step 4: animate 每帧跟随与室内可见性（:3418 activeHorizonGround 块之后）**

```js
if (skyRuntime && cameraRig?.camera) {
  skyRuntime.followCamera(cameraRig.camera.position)
  skyRuntime.setIndoor(Boolean(indoorGroup))
}
```

- [ ] **Step 5: dispose 显式释放（:4145 `shadowSystem = null` 旁）**

```js
skyRuntime?.dispose()
skyRuntime = null
```
（:4146 scene.traverse 兜底仍保留，双保险）

- [ ] **Step 6: 生产构建**

Run: `npm run build`
Expected: exit 0，无新增告警（既有 TS6133 类基线告警与本任务无关可忽略，本仓库前端构建是 vite）

- [ ] **Step 7: 前端全量回归**

Run: `npm test`
Expected: 新两个测试文件全绿；失败列表与基线 9 个红测试同名同文件，零新增；记录实际通过/失败计数到 ledger

- [ ] **Step 8: 提交检查点（待用户授权）**

`feat(mvp): wire procedural sky layer into sandbox engine lifecycle`

---

### Task 4: 浏览器人工验证（用户侧，不自动化）

**Files:** 无代码改动；结果回填 ledger 与最终汇报

- [ ] **Step 1: 启动 dev 服务器，按 spec §4.2 八条清单逐项验证并记录**

正午太阳/黄昏淡出无半埋/夜晚月亮天顶星空/雨天天体消失穹顶压灰/室内隐藏恢复/自由总览 1200 拉远无穿出/平视接缝无色差（Review Focus #3）/进出沙盒页两次无显存异常（Review Focus #4）
- [ ] **Step 2: 扩建约束专项**——在地块边界与远景地面边缘分别拖到日出日落，确认无天体穿插（spec §4.2 新增条）
- [ ] **Step 3: 任一条目不达标即回 systematic-debugging，先定位根因再修，修复走 RED→GREEN；全部通过后由用户决定提交与后续**
