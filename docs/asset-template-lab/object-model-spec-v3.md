# ObjectModelSpec 3.0 架构基线

## 决策

研发阶段直接切换到 ObjectModelSpec 3.0，不保留 ObjectSculptSpec 2.0 的兼容分支。生成、修复、局部修改、参数设计和 Three.js Runtime 统一以 `schemaVersion: "3.0"` 为唯一协议入口。

不允许 AI 输出可执行 JavaScript/TypeScript。AI 只输出受约束的数据结构和表达式 AST，由服务端校验，再由确定性 Runtime 执行。

## 协议边界

| 字段 | 职责 |
|---|---|
| `materials` | 材质定义 |
| `componentTree` | 原始组件树、层级和局部变换 |
| `parameterSchema` | 参数值、范围、类型和目标绑定 |
| `operations` | 声明式结构运算；当前执行器实现通用 `instance` 运算 |

重复、旋转、螺旋和非均匀分布通过 `instance` 的 position/rotation/scale 表达式实现，不再使用 `repeat` / `grid` 生成器类型。

表达式 AST 当前支持常量、参数引用、实例索引、实例总数、加减乘除、sin、cos 和 negate。表达式必须有深度、数值范围、数量和展开组件预算限制。

参数目标使用真实数据路径，由目标当前值决定数据类型；禁止访问原型链和结构身份字段。数量或表达式控制参数可以使用空 targets，由 operations 引用。

## 执行链路

1. AI 生成完整 ObjectModelSpec 3.0。
2. 服务端校验根节点、组件 ID、层级、几何描述符、operations、表达式和参数绑定。
3. `compileObjectModelSpec` 将 operations 展开为确定性的组件实例，实例 ID 可重复计算。
4. Three.js Runtime 只接收 3.0 编译结果，校验组件树并创建真实 Mesh/Group。
5. 参数修改从不可变基线重新计算，避免累计数值漂移。

## 已完成的迁移边界

- 生成、修复和局部修改只接受 3.0。
- 参数设计只接受 3.0，按 operations 引用参数。
- Three.js Runtime 只接受 3.0；旧 generator/constraint 扩展器已从 Runtime 移除。
- 移除旧版 BuildingDesignController 中与 ImageGenerationController 重复的重建/修改路由。
- 删除旧版 2.0 资产重建、审核和局部修改服务链路。
- 前后端 CI 已覆盖协议拒绝、表达式编译、旋转阵列、几何描述符参数、operation 数量参数重建，以及 operation 数据的保存/读取往返。\n- 资产保存和读取接口均只接受 3.0；旧 2.0 数据不做兼容。\n- **校验闭环正在统一**：公共 Validator 已覆盖组件/参数/Operations 结构，并统一 Polygon、Tube、Lathe、Sweep、Loft 的几何描述符规则；AI 生成链路与资产保存链路已移除重复的描述符协议校验。Runtime 仍保留执行器级几何构建安全检查，资产保存仍保留组件 ID/尺寸/层级等局部防御检查，尚未达到所有边界完全复用单一校验源。

## 当前能力边界与后续工作

- 当前 `operations` 只有通用 `instance` 运算；路径采样、布尔几何、曲面拓扑等不属于已完成能力。
- 参数目标支持动态数据路径，但完整依赖图、派生参数、局部增量重建尚未完成。
- 目前参数变更采用基线重算，不应宣称已实现局部 Mesh 增量更新。
- 保存/恢复完整闭环、真实 Provider 多物体回归和浏览器端体验验收仍需完成。\n- **阶段判断口径**：CI 通过仅代表自动化测试通过；真实 Provider、实际模型 Mesh 参数联动、浏览器交互和视觉还原必须单独验收，不得由 Mock/CI 结果替代。
- 旧 2.0 模板不做迁移或兼容；研发阶段可直接重建测试资产。

## 阶段状态

| 阶段 | 状态 | 说明 |
|---|---|---|
| P0 架构盘点与协议边界 | 第一轮审计完成 | 已定位重复控制器、旧生成器执行器和校验重复 |
| P1 新协议切换 | 进行中 | 3.0 入口已统一；公共几何描述符校验第一轮接入，保存/参数设计仍有重复局部规则 |
| P2 通用几何运算 | 进行中 | instance + bounded expression 已执行；还需扩展通用操作并验证复杂阵列 |
| P3 参数绑定与依赖引擎 | 进行中 | 动态路径和 operation 参数可用；依赖图与增量更新未完成 |
| P4 编辑器闭环 | 进行中 | 已有保存/读取 operation 往返测试；仍需真实 Provider 与浏览器端综合验收 |
