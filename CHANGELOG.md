## 2026-11-05 — 重置视角遵循当前相机模式，手机端隐藏操作指南

- “重置视角”调整为当前模式内重置：2.5D/3D 总览按当前投影重新居中校园；跟随模式将角色恢复到默认出生点并保留跟随视角；第一人称恢复角色位置但保留第一人称模式与当前朝向。
- 重置操作不再强制切换到总览，也不再把 2.5D/3D 投影切换到其他模式。
- 手机端隐藏操作指南面板，避免占用地图画布；桌面端操作指南保持原有展示逻辑。

## 2026-11-05 — 总览重置入口与移动端控件布局优化

- 将“重置视角”从底部状态栏中独立出来，避免底部状态栏在校园探索/RPG 页面及移动端隐藏时连带隐藏重置入口。
- 桌面端重置按钮固定在画布右下角；移动端调整至左上方，避免与底部模式切换工具条重叠。
- 手机端 2.5D/3D 与总览/跟随/第一人称切换栏改为紧凑单行按钮，隐藏辅助描述文字并缩小间距、内边距，降低对地图可视区域的遮挡。
- 手机端隐藏“打开地图编辑器”入口；桌面端入口保持不变。
- 验收：桌面与手机端均可点击重置视角；手机端地图主体保持可见，2.5D/3D 与漫游模式按钮可正常切换，编辑器入口不显示。

## 2026-11-05 — 修复总览操作指南被样式隐藏

- 根因：总览模式样式将整个 `.control-card` 设置为 `display:none`；移动端媒体查询也隐藏该面板，导致模板中已存在的操作指南无法显示。
- 调整为总览仅隐藏装饰性介绍卡片，操作指南在桌面端正常显示；移动端增加紧凑布局、视口高度限制和独立滚动，避免遮挡主要地图操作区。
- 指南内容仍按 2.5D/3D 模式动态切换，不改变相机交互逻辑。
- 验收：桌面端进入总览可直接看到操作指南；移动端总览同样显示紧凑指南；切换 2.5D/3D 后内容同步更新。

## 2026-11-05 — 3D 总览改用独立指针平移

- 不再仅依赖 OrbitControls 的右键鼠标映射；在相机控制层直接处理 3D 总览右键/中键指针拖动。
- 拖动时临时停用 OrbitControls 输入，按相机水平朝向和视口像素比例同步平移相机与观察目标；松开后恢复旋转/缩放控制。
- 左键仍由 OrbitControls 负责旋转，滚轮仍负责缩放；2.5D 的平移交互保持不变。
- 浏览器验收：3D 总览右键或中键拖动必须移动观察中心；左键旋转与滚轮缩放不受影响。

## 2026-11-05 — 修复 3D 总览右键平移被浏览器菜单拦截

- 3D 总览保留左键旋转；右键拖动和中键拖动均执行平移，滚轮缩放不变。
- 在 WebGL 画布上阻止浏览器原生右键菜单，避免右键按下后菜单弹出并中断 OrbitControls 拖动。
- 2.5D 操作映射不变；本次仅修复 3D 总览平移输入，不改变相机状态隔离和场景数据。
- 浏览器验收：3D 总览右键拖动/中键拖动应平移观察中心，左键拖动应旋转；2.5D 左键拖动仍平移。

## 2026-11-05 — 修复 3D 总览左键拖动无法旋转

- 根因：OrbitControls 已启用 3D 旋转，但鼠标左键被绑定为 PAN，旋转仅绑定在右键，和常见三维地图的左键拖动操作不一致。
- 3D 总览调整为左键拖动旋转、右键拖动平移，滚轮缩放保持不变；2.5D 总览继续左右键拖动平移，固定地图方位不变。
- 触屏交互保持 3D 单指旋转、2.5D 单指平移，双指缩放/平移。
- 本次仅调整总览 OrbitControls 鼠标映射，不改变 3D 跟随、第一人称、2.5D 固定斜俯视和空间数据。
- 需在真实浏览器验收 3D 左键旋转、右键平移、滚轮缩放，以及 2.5D 不可旋转的边界。

## 2026-11-05 — 2.5D / 3D 相机交互规则分离

- 2.5D 总览固定地图方位，仅支持平移与缩放；鼠标右键拖动和单指触摸均映射为平移，不再旋转地图。
- 2.5D 跟随保持宝可梦式固定斜俯视，镜头随角色移动，不响应旋转手势；2.5D 模式隐藏第一人称入口并禁用 V 切换快捷键。
- 3D 总览保留 OrbitControls 角度调整；3D 跟随保留第三人称视角旋转与第一人称切换。
- 从 3D 第一人称切回 2.5D 时自动回到固定斜俯视跟随，避免第一人称状态跨模式残留。
- 自动化代码检查通过后仍需浏览器验收鼠标/触屏平移、3D 旋转和模式切换。

## 2026-11-05 — 2.5D 跟随相机改为经典宝可梦固定斜俯视

- 修正上一轮仍采用人物背后第三人称跟拍的问题。2.5D 跟随改为固定世界方位的正交斜俯视镜头：相机只跟随玩家位置，不根据人物朝向绕行或旋转到人物背后。
- 默认俯视约 62°，采用固定地图方位；人物在场景内移动时视口随人物平移，保持道路、建筑屋顶与立面同时可辨识。
- 默认纵向视野收敛到约 48 个世界单位，避免上一轮约 81 个单位导致人物和场景元素过小；滚轮缩放调整镜头距离并联动正交视野。
- 2.5D 拖动不再改变水平观察方位，垂直角度仅允许小范围微调；3D 透视跟随和第一人称保持独立。
- 浏览器验收需确认正式校园 2.5D 跟随具有经典 GBA 宝可梦地图的固定斜俯视观感，人物移动时镜头平滑跟随，人物不因转向改变镜头方位。


## 2026-11-05 — 修复 3D 建筑模型重复碰撞导致空地受阻

- 3D GLB 建筑模型此前在加载后再次按世界 AABB 注册碰撞；校园基础 Feature 已经注册精确墙段/footprint 碰撞，重复 AABB 会填满凹角和不规则 footprint 外侧的空地。
- 现在规范空间图层中已有建筑 footprint 的 GLB 只承担视觉替换，继续复用基础建筑碰撞；仅对空间图层中不存在 footprint 的独立模型保留 AABB 兜底。
- 本修复不放开建筑实体，不改变建筑门洞/墙段碰撞，也不修改空间数据和编辑器保存协议。
- 需在浏览器 3D 跟随模式验收不规则建筑边角、建筑之间空地及建筑墙体阻挡；CI 通过不替代实机移动验收。

## 2026-11-05 — 校园角色 3D 化与步行动画

- 新增共享角色工厂 `createCampusPlayer.js`，正式校园和 RPG 样板区统一使用低多边形像素风 3D 人物，不再使用始终面向相机的 Sprite 贴图。
- 人物拆分为头部、躯干、背包、左右手臂、左右腿和鞋子等独立体块，具备真实厚度、侧面轮廓、受光和投影。
- 行走动画改为基于关节的连续步态：左右腿交替摆动、双臂反向摆动、身体轻微起伏；人物根据移动方向转向。
- 编辑器 3D 预览复制完整角色层级，并隔离几何与材质资源，避免退出预览时释放正式场景资产。
- 人物根节点按当前楼层地面定位；第一人称模式隐藏整个人物模型，避免模型遮挡视野。
- 人物动画仍复用引擎现有帧循环，不额外创建独立动画定时器。
- 浏览器验收需检查静止姿态、四方向移动、转向、步态连贯性、地面接触、人物阴影、编辑预览和第一人称隐藏状态。

## 2026-11-05 — 渲染质量与闪烁修复

- 恢复 2.5D/3D 总览阴影；阴影贴图改为静态缓存，仅在建筑模型加载、编辑预览、室内楼层重建、对象几何更新等场景结构变化时标记重算，避免相机拖动/缩放时重复执行 shadow pass。
- 阴影使用 PCFSoftShadowMap、2048² 贴图与 normalBias，改善树木、建筑和地面的接触阴影质量。
- WebGL 开启 MSAA，并按视口面积和设备 DPR 自适应渲染倍率；像素纹理仍保持 NearestFilter，不改变像素素材的采样风格。
- 正交/透视相机裁剪范围由 0.1–20000 收紧为 0.5–3200，提升深度缓冲精度，降低远近表面重叠时的 Z-fighting 闪烁风险。
- 阴影缓存更新与相机按需渲染解耦；静止场景仍可休眠，不恢复无条件持续 requestAnimationFrame。
- 真实浏览器视觉回归仍需确认阴影边缘、编辑预览切换、室内楼层切换与局部闪烁表现；CI 通过不等于 GPU 画面验收完成。

## 2026-11-05 — 地图运行时与编辑器性能优化

- 3D 校园入口提示不再在每一帧遍历完整场景树；场景初始化时建立建筑入口索引，玩家移动达到阈值后才检查附近入口，静止时跳过距离计算。
- 2.5D/3D 总览改为按需渲染：静止时停止持续 requestAnimationFrame；相机阻尼、鼠标/滚轮操作、窗口尺寸变化和显式视角切换会唤醒渲染，阻尼结束后自动休眠。第三人称/第一人称仍保持连续帧更新，保证移动与相机跟随不受影响。
- 2.5D 总览不再预先下载和解析 GLB 建筑模型；用户切换校园 3D 或进入跟随视角时才动态导入加载器并加载模型；编辑器 3D 预览不加载未使用的基础校园 GLB。已加载模型在回到 2.5D 总览时隐藏，室内场景继续遵守原有可见性规则；页面销毁期间迟到的异步模型会被释放。
- 首页将 CampusPlanEditor、IndoorFloorPlanEditor、BuildingFootprintEditor 拆分为异步组件，用户打开编辑器/室内编辑面板时才下载对应代码分块，降低校园探索首屏 JavaScript 解析成本。
- 编辑器自动保存监听改为对空间数据集合进行 Vue 批处理深度监听，并在 1.5 秒防抖结束后才生成文档快照，避免拖动期间每个鼠标事件都同步序列化整份地图。
- 保存流程复用同一次构建的文档对象，消除重复构建/序列化。
- 本次不改变空间数据结构、绘制结果、撤销重做和自动保存时序；仍需通过 CI 与浏览器拖动/移动场景验收确认收益。

## 2026-11-05 — 修复编辑器遗漏基础湖泊区域

- 根因：基础校园 GeoJSON 将水域编码为 featureType=area、category=water；编辑器 FeatureCollection 适配器只识别 water 等直接类型，未识别 area，导致基础区域在投影到编辑器数组时被丢弃。
- fromCampusFeatureCollection 现在同时兼容基础数据的 area + category 与编辑器新增区域的直接类型，并以 category 还原真实区域类型。
- 增加回归测试，验证中央湖区和西侧湖区均能从基础 FeatureCollection 加载到编辑器。
- 不修改湖泊几何、首页渲染、服务端数据或保存协议；修复的是编辑器数据适配层。

## 2026-11-05 — 修复室外第一人称相机投影与输入控制

- 第一人称模式固定使用透视相机，不再继承 2.5D 总览的正交相机；无论当前首页视图是 2.5D 还是 3D，切换第一人称后均进入真实透视人物视角。
- 第一人称切换时将相机直接定位到玩家眼部坐标并同步视线目标，避免从总览高空镜头缓慢飞向地面的过渡造成“不是人物视角”的观感。
- 切换 2.5D/3D 展示模式时，第一人称继续保持透视相机，不被重新切回正交投影。
- 第一人称 WASD/方向键输入阻止浏览器默认滚动；输入焦点位于表单或可编辑区域时不抢占按键；窗口失焦时清空持续按压状态。
- 增加第一人称移动方向、浏览器默认行为、表单输入隔离和窗口失焦回归测试。
- 保留既有 Pointer Lock 鼠标视线控制、碰撞移动和室外玩家坐标；不修改空间数据、编辑器或保存机制。
- 代码级回归测试已补充；仍需真实浏览器验收鼠标锁定、视线旋转、WASD、碰撞和模式切换。

## 2026-11-05 — 修复撤销/重做后建筑渲染异常

- 历史快照从规范 FeatureCollection 投影回旧版编辑器建筑数组时，原适配器未重建 `rect` 边界字段；画布标签渲染读取 `rect[0]` 时触发运行时异常。
- `fromCampusFeatureCollection` 现在根据 Polygon 外环计算并补齐兼容 `rect`，保证撤销/重做恢复的数据满足现有编辑器视图契约。
- 编辑器历史恢复入口额外执行 `normalizeBuilding`，作为旧文档和历史快照的防御性归一化。
- 增加回归测试，覆盖 FeatureCollection → undo snapshot → restore 后建筑 `rect` 与 footprint 的一致性。
- 本次不改变规范 GeoJSON geometry、Feature properties、metadata、tombstone 或服务端保存协议。

## 2026-11-05 — 修复 2D 编辑器刷新时空间对象闪现

- 编辑器原先在服务端文档 GET 完成前就渲染本地基础建筑、道路和区域；随后再替换为基础数据与服务端 FeatureCollection 合并结果，刷新时会出现首屏闪现/消失。
- 空间对象图层统一受 `documentLoaded` 控制，仅在服务端文档读取及 FeatureCollection 合并完成后显示；画布背景仍可先行显示。
- 参考底图资源改为后台异步加载，不再阻塞空间数据就绪和首屏显示。
- 保存 API、文档结构、FeatureCollection 合并规则及 revision 乐观锁不变。

## 2026-11-05 — 修复 NestJS body parser 注册的 TypeScript 编译错误

- `INestApplication` 不提供 `useBodyParser()` 方法；此前关闭默认 parser 后调用该方法会触发 TS2339。
- 改为从 Express 导入 `json` / `urlencoded` 中间件，并通过 `app.use()` 显式注册；JSON 请求体上限仍为 16 MiB，URL-encoded 请求体上限仍为 1 MiB。
- 不改变 15 MiB 空间文档业务校验、GeoJSON 校验及 revision 乐观锁；需通过 Backend CI 和本地构建确认。

## 2026-11-05 — 修复平面地图保存请求体超限

- 浏览器联调日志确认，Express 默认 JSON body-parser 上限为 100 KiB；实际平面编辑文档请求体为 187,529 字节（约 183.1 KiB），在进入 ScenesController/ScenesService 前即触发 PayloadTooLargeError。
- `server/src/main.ts` 关闭 Nest 默认 body parser，显式注册 JSON parser 上限 16 MiB，并为 URL-encoded 请求保留 1 MiB 上限，避免默认 100 KiB parser 先行拦截。
- 16 MiB 请求上限与 ScenesService 当前 15 MiB 平面文档校验上限对齐；业务层文档大小校验、GeoJSON 结构校验和 revision 乐观锁保持不变。
- 需通过 Backend CI，并在本地重启 API 后验证 PUT /scene/plan 返回成功、revision 增长、GET 回读完整 FeatureCollection。不得仅凭 HTTP 413 消失就判定持久化验收通过。

## 2026-11-05 — 补齐父子组件异步初始化时序

- 进一步核查 Vue 生命周期，发现 CampusPlanEditor 的 onMounted 早于 App 父组件的 onMounted；首次调用 loadEditorDocument 时 campusId/mapId 仍为空。
- 即使父组件随后写入 sceneDocument 标识，编辑器原先也没有监听 props 变化，因此不会重新加载文档，documentLoaded 仍保持 false。
- CampusPlanEditor 现在监听 campusId/mapId：首次挂载时若 ID 未就绪，待两个标识注入后自动加载；若初始 props 已完整，则仍由原 onMounted 流程加载，避免重复请求。
- 与首页注入 ID 的修复共同解决编辑器初始化链路；仍需通过 CI 和真实浏览器持久化验收。

## 2026-11-05 — 修复编辑器缺少校园/地图 ID 导致保存入口不可用

- 浏览器验收发现，新建建筑后状态始终停留在“等待修改”，立即保存按钮不可用。
- 沿组件 props 追踪发现，首页读取编辑器文档时只更新 campusPlanDocument，没有将已查询到的校园 ID、地图 ID 写入 sceneDocument；CampusPlanEditor 因此接收空 ID，loadEditorDocument 提前返回，documentLoaded 永远为 false。
- 在首页解析出校园与地图后立即写入 sceneDocument.campusId/mapId，再读取编辑器文档；即使尚无编辑文档，空文档也能使用正确的服务端标识初始化并保存。
- 编辑器缺少 ID 或读取编辑文档 API 失败时，均明确进入错误状态并提供原因，不再静默停留在“等待修改”。
- 需通过前后端 CI，并在真实浏览器确认新建建筑后状态进入“有未保存修改”、手动保存成功、刷新后 GET 回读恢复建筑。

## 2026-11-04 — 属性面板编辑纳入撤销/重做快照

- **修改文件**：`src/editor/CampusPlanEditor.vue`。
- **实际完成**：建筑名称/模板/楼层/高度/窗户/入口/屋顶、区域名称/类型、对象名称/类型/朝向/缩放、道路宽度等属性控件在获得焦点时先创建 undo 快照，避免直接 v-model 修改绕过历史记录。
- **验证状态**：前端 CI 最新提交 `65dff73` 测试与构建通过；本次快照改动等待新 CI。真实浏览器端交互仍需验收。
## 2026-11-04 — 统一编辑器与基础数据质量字段契约

- **修改文件**：`src/editor/campusFeatureCollection.js`、`src/data/campus/campusGeoJSON.test.js`。
- **实际完成**：
  - 编辑器 Feature 序列化时保留 `qualityStatus`，同时规范化输出 `confidence` 与 `verificationStatus`。
- 进一步修正点对象的规范类型：GeoJSON `featureType` 固定为 `object`，树木/座椅/路灯等具体类别写入 `objectType`。此前把 tree 直接作为 featureType 与统一 Point 对象契约不一致，现已对齐基础数据模型。
  - 旧编辑器文档缺少标准字段时使用保守默认值 low / unverified；已核验状态映射为 medium / verified。
  - 增加端到端适配器单测：编辑器建筑、道路、区域和点对象生成的 FeatureCollection 必须通过统一空间数据质检。
- **验证状态**：代码与测试已提交，等待最新 CI。
- **已知限制**：默认置信度只是数据治理初值，不代表真实精度；后续需由可靠来源逐对象校准。
## 2026-11-04 — 修复区域删除绕过统一删除契约

- **修改文件**：`src/editor/CampusPlanEditor.vue`。
- **实际完成**：区域属性面板原先直接过滤数组，绕过基础 Feature tombstone 写入；现统一调用 `deleteSelected()`，复用图层锁、撤销快照、基础对象删除标记和选中状态清理。
- **验证状态**：修复已提交，等待 CI；真实浏览器端删除/刷新回归尚未执行。
- **下一步**：检查其余编辑器入口是否存在绕过统一删除、撤销或自动保存流程的直接数组修改。
## 2026-11-04 — 扩展空间数据类型与几何一致性质检

- **修改文件**：`src/data/campus/campusGeoJSON.js`、`src/data/campus/campusGeoJSON.test.js`。
- **实际完成**：
  - 将所有当前业务 Feature 类型映射到明确几何契约：区域/建筑使用 Polygon，道路使用 LineString，出入口/POI/设施对象使用 Point。
  - 校验集合成员必须为 Feature，并拒绝缺失或未知的 featureType。
  - 增加错误用例，覆盖水域 Point、树木 Polygon、未知业务类型。
- **验证状态**：代码和测试已提交，等待最新 CI；尚未进行真实浏览器验收。
- **已知限制**：目前几何契约不支持 MultiPolygon/MultiLineString；后续如需复杂边界，应先扩展渲染适配器和测试。
- **下一步**：验证 CI，再检查建筑/道路/区域属性编辑 UI 是否完整写入 Feature.properties。
## 2026-11-04 — 完整基础校园数据合并与编辑器底集补齐

- **修改文件**：`src/data/campus/campusGeoJSON.js`、`src/data/campus/campusGeoJSON.test.js`、`src/editor/CampusPlanEditor.vue`。
- **实际完成**：
  - 首页合并函数改为将全部基础 Feature 作为底集，不再只合并校界、出入口和点对象。
  - 编辑器同 ID Feature 覆盖基础 Feature；新增 Feature 保留；tombstone 在最终阶段过滤。
  - 编辑器首次打开/加载稀疏旧文档时补齐基础建筑、道路、区域及 96 个基础环境对象，编辑器已保存数据按 ID 覆盖。
  - 单项和批量删除任何基础对象都会记录删除标记。
  - 保存文档时将 `deletedFeatureIds` 写入顶层兼容字段和 FeatureCollection，修复此前构建保存文档时遗漏删除标记的问题。
- 读取删除记录时合并顶层兼容字段与 FeatureCollection 内的 `deletedFeatureIds`，避免任一旧格式字段存在空数组时覆盖另一处有效删除记录。
  - 扩展合并测试，覆盖基础建筑/区域保留和基础道路删除优先级。
- **验证状态**：最新修复提交 `74d3120` 的 Frontend CI 与 Backend CI 均通过（Frontend 测试与构建成功，Backend CI 成功）；此前首次前端 CI 仅因测试预期未同步增加的删除 ID 而失败，已修正。未进行真实浏览器验收。
- **已知限制**：删除后恢复对象的 UI 操作尚未实现；编辑冲突仍依赖现有文档 revision 机制。
- **下一步**：验证 CI；继续检查编辑器属性保存与首页渲染的完整字段映射。
## 2026-11-04 — 修复共享场景适配器的属性丢失

- **修改文件**：`src/data/campus/campusGeoJSON.js`、`src/three/world/campus/campusSceneData.js`、`src/three/world/campus/campusSceneData.test.js`。
- **实际完成**：
  - 建筑、道路、区域标准图层保留原 Feature 的完整 properties。
  - 编辑器预览文档将完整属性透传，保留屋顶样式、入口边、窗户密度、门宽、车道数、路面材质等扩展字段。
  - 增加测试验证建筑、道路和水域属性从 FeatureCollection 到预览输入的保真。
- **验证状态**：修复代码和测试已提交，等待最新前端/后端 CI；未进行真实浏览器验收。
- **已知限制**：属性保真只解决数据适配层丢字段问题，不代表首页渲染器已经解释所有扩展属性；仍需逐个补充 renderer capability 和真实数据核验。
- **下一步**：验证 CI，继续审查基础数据覆盖策略与场景渲染输入；完成第三阶段验收后进入双引擎阶段。
## 2026-11-04 — 首页与编辑器预览共用场景数据适配器

- **新增文件**：`src/three/world/campus/campusSceneData.js`、`src/three/world/campus/campusSceneData.test.js`。
- **修改文件**：`src/three/world/campus/createCampusScene.js`、`src/three/engine/createCampusEngine.js`。
- **实际完成**：
  - 新增共享适配器，从统一 FeatureCollection 派生标准空间图层与编辑器预览兼容文档。
  - 首页场景通过共享适配器读取建筑、道路、区域和点对象图层。
  - 编辑器预览优先消费规范 FeatureCollection；旧版数组文档先转换为 FeatureCollection，再进入同一适配器。
  - 新增测试验证建筑 footprint、道路中心线、区域几何、点对象坐标和属性由同一输入派生。
- **验证状态**：首次前端 CI 暴露共享适配器导入路径少一级目录，已修正为从 campus 目录正确回到 src/data；修复提交 CI 待回收。未进行浏览器人工验收。
- **边界说明**：当前完成的是共享数据适配层，不是独立双引擎；首页和编辑器预览仍由 Three.js 渲染。第四阶段仍需建立真正的 2.5D/3D 双 renderer 契约。
- **下一步**：回收 CI；检查场景预览与首页的坐标校准差异；继续补齐基础建筑/道路/区域来源合并与数据覆盖语义。
## 2026-11-04 — 统一校园目录与空间 Feature 的数据边界

- **修改文件**：`src/data/campus/campusGeoJSON.js`、`src/data/campus/campusGeoJSON.test.js`。
- **实际完成**：
  - 基础 FeatureCollection 的 metadata 增加 `catalogue`，集中保存未定位 POI、场地台账和建筑身份元数据。
  - `getCampusSpatialLayers` 优先从当前 FeatureCollection catalogue 读取 POI/场地目录。
  - 首页 Feature 合并函数保留基础 metadata，避免目录数据在合并时丢失。
  - 增加测试验证目录可从统一数据集读取，未定位 POI 不会被伪造成 GeoJSON Feature。
- **验证状态**：代码与测试已提交，等待 CI；未进行浏览器端到端验收。
- **已知限制**：目录中的 POI/场地多数仍待定位，建筑身份和 footprint 仍有待核验状态；尚未统一编辑器预览与首页场景构建流程。
- **下一步**：验证 CI，随后抽取共享场景 Feature 适配器，避免首页与编辑器预览分别转换同一空间数据。
## 2026-11-04 — 抽取首页 Feature 合并契约

- **修改文件**：`src/data/campus/campusGeoJSON.js`、`src/data/campus/campusGeoJSON.test.js`、`src/App.vue`。
- **实际完成**：
  - 新增纯函数 `mergeCampusSceneFeatureCollections`，集中处理基础边界/出入口/环境对象与编辑器 FeatureCollection 的合并。
  - 同 ID 编辑器 Feature 覆盖基础 Feature；编辑器新增 Feature 保留；删除标记在合并末端统一过滤。
  - 首页初始化改为调用统一合并函数，移除 Vue 生命周期中的临时 Map 合并逻辑。
  - 增加覆盖、追加、删除优先级单元测试。
- **验证状态**：首次前端 CI 发现测试文件遗漏合并函数导入，已补齐 import 并触发新一轮 CI；当前修复提交结果待回收。未进行真实浏览器验收。
- **已知限制**：基础校园建筑/道路/区域的完整权威数据源仍未统一；未定位 POI 和场地记录暂不生成伪造几何。
- **下一步**：梳理基础 POI、场地台账与 FeatureCollection 的关系，明确未定位记录模型；随后统一首页与编辑器预览的场景构建适配器。
## 2026-11-04 — 编辑器基础对象删除同步

- **修改文件**：`src/editor/CampusPlanEditor.vue`、`src/editor/campusFeatureCollection.js`、`src/editor/campusFeatureCollection.test.js`、`src/App.vue`。
- **实际完成**：
  - FeatureCollection 增加迁移期 `deletedFeatureIds`，正向/反向适配器保留删除标记。
  - 编辑器删除历史场景装饰对象时记录稳定 ID；单选删除和批量删除均覆盖。
  - 删除标记进入自动保存文档，并纳入 undo/redo 快照。
  - 首页合并基础环境 Feature 与编辑器 Feature 后按删除标记过滤，避免基础对象被重新合并出来。
  - 增加适配器删除标记往返测试。
- **验证状态**：代码已提交；首次前端 CI 暴露新增测试遗漏反向适配器导入，已补齐 import 并重新触发 CI；此前 Backend CI 已通过。当前修复提交的 CI 结果待回收；未进行真实浏览器端到端验收。
- **已知限制**：当前 tombstone 仅针对来源为 `legacy-scene-decoration` 的基础环境对象；其他基础数据删除策略、恢复对象、服务端冲突解决和审计仍需设计。
- **下一步**：验证 CI，补充首页合并行为测试；随后统一编辑器预览和首页的场景构建入口，继续完成第三阶段数据契约。

## 2026-11-04 — 环境装饰对象纳入统一空间数据

- **修改文件**：`src/data/campus/campusGeoJSON.js`、`src/data/campus/campusGeoJSON.test.js`、`src/three/world/campus/createCampusScene.js`、`src/App.vue`。
- **实际完成**：
  - 将原场景内树木、花卉、长椅、路灯共 96 个对象迁移为 Point Feature。
  - 每个对象拥有稳定 ID、类型、坐标、来源、置信度和未核验状态。
  - 首页把基础装饰 Feature 与编辑器 FeatureCollection 合并，同 ID 编辑对象覆盖基础对象。
  - 主场景从统一对象图层生成树木、花卉、座椅和路灯，删除了渲染脚本内对应的独立坐标数组。
  - 增加 96 个对象的 FeatureCollection 数据回归测试，并修正基础 Feature 数量断言；首次 CI 暴露数量断言误差，已按实际 Feature 数修正。
- **数据质量说明**：坐标从旧场景装饰数组迁移，属于历史视觉占位坐标，全部标记未核验；不能作为真实校园设施测绘成果。
- **已知限制**：基础对象删除的 tombstone/同步语义尚未定义；其他 POI 和环境细节仍有独立数据源；尚未完成真实浏览器验收。
- **下一步**：补齐对象编辑删除同步语义和场景交互回归，再统一编辑器预览与首页渲染适配器。

## 2026-11-04 — 首页场景初始化接入统一 FeatureCollection

- **修改文件**：`src/App.vue`、`src/three/engine/createCampusEngine.js`、`src/three/world/campus/createCampusScene.js`。
- **实际完成**：
  - 首页在创建引擎前读取已保存的编辑器文档；优先使用其 FeatureCollection，没有时从现有编辑器文档结构转换。
  - 将基础校园数据中的 boundary/gate 与编辑器可编辑要素组合，作为单一 FeatureCollection 注入校园场景初始化。
  - `createCampusScene` 从注入集合派生建筑、道路、区域和 Point 设施，不再在初始化后额外调用 `previewCampusPlan` 覆盖首页地图。
  - 道路宽度参与场景道路铺装；区域 Polygon/holes 进入场景构建；树木、路灯、座椅等 Point Feature 在主场景中生成对应资产并保留 ID、名称、朝向和缩放。
- **已知限制**：旧场景中的部分树木、花卉、长椅、路灯仍以程序化装饰坐标存在，尚未全部迁移为 Feature；编辑器独立 3D 预览尚未统一到同一 renderer adapter；真实浏览器体验未验收。
- **验证状态**：本轮修改已提交，CI 正在触发；不能将提交成功视为测试通过。
- **下一步**：补充场景初始化集成测试，处理静态装饰对象数据化；随后统一 2.5D/3D 的 FeatureCollection 渲染适配器。

## 2026-11-04 — 空间数据：统一 FeatureCollection 渲染图层适配

- **修改文件**：`src/data/campus/campusGeoJSON.js`、`src/data/campus/campusGeoJSON.test.js`、`docs/architecture/CAMPUS_SPATIAL_ARCHITECTURE.md`。
- **实际完成**：
  - `getCampusSpatialLayers(collection)` 可直接接收编辑器保存的 GeoJSON FeatureCollection，不再只识别基础数据的 `area + category` 格式。
  - 统一归一化建筑 Polygon、道路 LineString、绿地/水域/运动场/广场/停车场 Polygon，以及树木/路灯/座椅/雕塑等 Point。
  - 保留道路宽度、建筑楼层/高度/模板、区域内环、点对象朝向/缩放、稳定 ID 和来源/质量状态。
  - 置信度字段兼容基础数据 `confidence` 与编辑器 `qualityStatus`。
  - 增加编辑器 FeatureCollection -> 渲染图层的转换测试。
- **验证边界**：自动化测试已补充；本提交前端 CI 尚在执行。此提交建立了渲染适配层，但首页启动尚未完全改为注入编辑器 FeatureCollection，2.5D/3D 所有路径仍需后续统一和验收。
- **下一步**：将编辑器 FeatureCollection 作为首页场景启动数据源，避免静态底图与编辑器预览叠加两份空间对象；随后把同一 FeatureCollection 接入独立的 2.5D/3D 渲染适配器。

## 2026-11-04 — 空间数据：建立统一 GeoJSON FeatureCollection 交换层

- **修改文件**：`src/editor/campusFeatureCollection.js`、`src/editor/campusFeatureCollection.test.js`、`src/editor/CampusPlanEditor.vue`、`src/three/engine/createCampusEngine.js`、`docs/architecture/CAMPUS_SPATIAL_ARCHITECTURE.md`。
- **实际完成**：
  - 新增 `toCampusFeatureCollection`，将建筑 Polygon、道路 LineString + width、区域 Polygon（含 holes）、树木/设施 Point 统一转换为 GeoJSON FeatureCollection。
  - 每个 Feature 统一保留稳定 id、featureType、name、source、qualityStatus；道路宽度、建筑属性、设施朝向/缩放保留在 properties。
  - 编辑器保存文档新增 schemaVersion 3 的 `featureCollection`；加载时优先读取 FeatureCollection，并通过兼容适配器恢复现有编辑交互集合。
  - Three.js 编辑器预览优先从 FeatureCollection 还原渲染输入，确保预览读取与保存相同的几何内容。
  - 新增几何闭合、内环保留、类型映射、异常记录过滤和往返转换测试。
- **架构边界**：当前 FeatureCollection 是统一交换/保存契约；编辑器交互仍保留旧集合，文档暂时同时包含兼容字段。服务端 canonical-only 存储、探索首页所有渲染路径统一消费 FeatureCollection 尚未完成，不能宣称第三阶段完成。
- **验证边界**：已增加 Vitest 单元测试；提交后的前端/后端 CI 待执行。尚未完成浏览器端编辑、保存、刷新和 2.5D/3D 同源数据验收。
- **下一步**：CI 通过后，继续让首页校园探索加载统一 FeatureCollection，逐步移除旧数组作为第二数据源；随后建立 2.5D/3D 共用渲染适配器。

## 2026-11-04 — 编辑器：增加连续线/面几何绘制

- **修改文件**：`src/editor/CampusPlanEditor.vue`。
- **实际完成**：
  - 建筑、道路、区域工具改为逐点采集几何，不再点击一次就生成固定矩形/预制折线。
  - 道路使用至少 2 个顶点生成 LineString，并保留道路宽度属性。
  - 建筑与绿地、水域、操场、广场、停车场等区域使用至少 3 个顶点生成 Polygon；闭合环由几何工具统一处理，编辑器 footprint 保留非重复末点的顶点环。
  - 绘制过程显示临时几何和顶点数量；通过“完成绘制”提交，通过“取消绘制”或 Esc 放弃。
  - 完成的要素进入既有建筑/道路/区域集合，沿用属性面板、撤销/重做与自动保存机制。
  - 建筑资产库点击现在只切换建筑绘制工具，不再绕过画布直接生成固定矩形。
- **验证边界**：
  - 使用现有 `createDraftGeometry` 处理 LineString/Polygon，并已有单元测试覆盖闭合、顶点数和坐标合法性。
  - 尚未在真实浏览器完成连续点击、绘制完成/取消、吸附、自动保存与三维预览端到端验收；本提交 CI 待执行。
  - 旧的单击放置辅助函数暂时保留但不再由主画布入口调用，后续清理前需确认无其他引用。
- **下一步**：运行前端 CI；继续完善绘制时的顶点吸附、道路/建筑/区域绘制体验及空间对象统一序列化。

## 2026-11-04 — 编辑器：修复点对象重做快照遗漏

- **修改文件**：`src/editor/CampusPlanEditor.vue`。
- **实际完成**：
  - 修复 redo 将当前状态压入 history 时遗漏 `objects` 集合的问题。
  - 现在 undo/redo 两个方向的快照都包含建筑、道路、区域和点对象，避免撤销后重做时树木、路灯、座椅、雕塑等对象状态丢失。
- **验证边界**：
  - 已完成代码路径检查；该提交的前端 CI 尚待执行。
  - 尚未进行真实浏览器的对象放置、撤销、重做、刷新持久化端到端验收。
- **下一步**：继续审查编辑器 Point/LineString/Polygon 的绘制与持久化闭环，并完成第一阶段浏览器入口验收。

## 2026-11-04 — 第一阶段：清理旧 showcase 查询参数

- **修改文件**：`src/App.vue`。
- **实际完成**：
  - 从进入室内建筑的跳转 URL 中移除旧的 `view=showcase` 参数，改为仅通过 `buildingId` 表达目标建筑。
  - 进入建筑时显式清理旧 `view` 参数，避免历史场景入口语义残留在 URL 中。
  - 校正注释：校园探索统一使用 `campus` 场景，室内入口不再依赖 showcase 查询参数。
- **验证边界**：
  - 本次为路由语义清理；需通过后续前端 CI 验证构建。
  - 室内建筑入口仍需浏览器端验证，不能仅凭 URL 改动认定室内流程验收通过。
- **下一步**：继续完成第一阶段路由/相机/移动端回归；验收后进入第二阶段绘制交互闭环。

## 2026-11-04 — 第一阶段：保持 2.5D / 3D 切换时的总览取景

- **修改文件**：`src/three/camera/CameraRig.js`。
- **实际完成**：
  - 总览模式切换时，使用 OrbitControls 的实时观察目标，而不是可能滞后的 `currentTarget`。
  - 正交投影与透视投影之间按垂直视场高度换算相机距离/正交视野，降低切换时校园突然放大、缩小或偏移的风险。
  - 跟随与第一人称仍由角色位置和相机控制模式驱动，不把展示投影与操控模式重新耦合。
- **验证边界**：
  - 代码已提交；实际视觉取景仍需浏览器端验证，不能仅凭公式认定体验验收通过。
  - 本次不改变校园空间数据、对象几何或编辑器保存逻辑。
- **下一步**：检查新提交的前后端 CI；浏览器验收继续覆盖 2.5D/3D 反复切换、总览拖拽后切换、跟随/第一人称切换和移动端布局。

## 2026-11-04 — 第一阶段：补齐浏览器历史导航与编辑器路由状态

- **修改文件**：`src/App.vue`。
- **实际完成**：
  - 增加 `popstate` 路由同步：浏览器前进/后退时，按当前 URL 在校园探索与地图编辑器之间切换。
  - 浏览器后退离开编辑器时重新加载首页地图文档，并清理编辑器预览/室内临时场景，恢复 2.5D 总览。
  - 浏览器前进进入 `/editor` 或兼容的 `?view=editor` 时，切换到编辑器平面工作区。
  - 点击“返回校园探索”使用 `replaceState` 更新当前历史项，避免随后按浏览器后退重新进入刚关闭的编辑器。
  - 组件卸载时移除 `popstate` 监听，避免重复监听。
- **验证边界**：
  - 代码路径已补齐；真实浏览器前进/后退、直接访问 `/editor`、刷新和部署服务器 SPA fallback 仍需在浏览器/部署环境验收。
  - 本次不改变校园空间数据、相机投影或编辑器数据结构。
- **下一步**：完成入口路由的浏览器验收，再处理第一阶段剩余的 3D 全景取景和移动端控件回归。

## 2026-11-04 — 第一阶段：拆分 2.5D/3D 展示模式与相机控制

- **补充修正**：初始化 CameraRig 时直接按 `viewMode` 选择正交/透视相机，并为当前相机创建 OrbitControls；避免以 3D 初始状态加载时内部仍持有正交相机。

- **修改文件**：`src/App.vue`、`src/three/camera/CameraRig.js`、`src/three/engine/createCampusEngine.js`。
- **实际完成**：
  - 校园探索增加独立的 2.5D / 3D 展示切换：2.5D 使用正交投影，3D 使用透视投影。
  - 相机控制独立为总览、跟随、第一人称，不再把第一人称直接标记为 3D。
  - 视图切换在同一场景和同一引擎实例内完成，保留角色坐标及当前相机朝向/目标，不重载另一份校园数据。
  - 地图编辑器入口改为 `/editor` 路径，同时兼容旧 `?view=editor` 入口；退出编辑器返回 `/`。
  - 3D 预览初始化时显式使用 3D 投影。
- **验证与限制**：
  - 首轮 Frontend CI 在生产构建阶段发现 `/editor` 路径判断正则转义错误；已按构建日志修正。
  - 展示模式栏与相机控制栏分开定位，避免两组控件重叠，并为窄屏设置独立垂直间距。
  - 修正后的前后端 CI 需以最新提交的 GitHub Actions 结果为准。
  - 尚未完成真实浏览器运行时验收；透视投影下的校园取景、移动端布局及旧的室内/样板入口仍需回归检查。
  - 本次完成的是同一场景相机投影切换，不代表已完成独立 2.5D/3D 资产渲染适配器；双引擎仍属于第四阶段。
- **下一步**：在本阶段浏览器验收通过后，继续完善统一编辑器工具与点/线/面绘制工作流。

## 2026-11-04 — 第三阶段：点/实例对象进入统一编辑文档

- **修改文件**：
  - `src/editor/CampusPlanEditor.vue`
  - `src/three/engine/createCampusEngine.js`
- **实际完成**：
  - 编辑器增加点对象放置工具，支持树木、路灯、座椅、雕塑四类实例。
  - 点对象使用 GeoJSON Point 几何，属性保留名称、类型、朝向、缩放、来源和质量状态。
  - 点对象支持画布放置、拖动、选择、属性修改、删除、复制/粘贴。
  - 点对象纳入编辑文档 `objects` 字段，修复保存时强制写入空数组的问题；服务端加载、自动保存、导出均保留对象数据。
  - 撤销/重做快照纳入点对象集合，新增独立点对象图层。
  - Three.js 校园平面方案预览读取相同 Point Feature，按类型生成树木、路灯、座椅和雕塑程序化模型。
  - 移除编辑器中原先硬编码的树木装饰点，避免装饰数据与正式空间对象重复。
- **边界与风险**：
  - 本阶段渲染接入的是当前校园平面方案预览路径；尚未完成独立、完整的 3D 渲染适配器，也未完成真实校园全量对象迁移。
  - 点对象的 2D 编辑符号目前是简化圆形标记；树木等视觉符号后续可升级为统一资产图标。
  - 多对象框选/批量拖动对 Point 几何的适配仍需专项验证。
  - 当前页面的 2.5D/第一人称相机控制尚未等同于真正独立的 2.5D/3D 视图模式。
- **验证**：
  - 前端/后端 CI 已对上一阶段通过；本阶段提交后的 CI 尚待运行完成。
  - 未完成浏览器端放置、刷新重载、撤销重做及 2.5D/3D 端到端验收。
- **下一步**：
  1. 补齐统一 Feature 数据契约与所有几何类型的编辑操作（Point/LineString/Polygon）。
  2. 实现明确的 2.5D 与 3D 展示模式，不再将第一人称相机直接标注为 3D。
  3. 将编辑器中的点/线/面对象统一送入两个渲染适配器。
  4. 清理旧的 `view=showcase` 路由语义并验证首页/编辑器入口。

# 开发变更记录

本文件只记录已经提交的事实。计划事项不得写成已完成。

## 2026-11-04 — 第二阶段：校园区域对象类型化绘制

- **变更类型**：编辑器对象工具与场景预览。
- **修改文件**：
  - `src/editor/CampusPlanEditor.vue`
  - `src/three/engine/createCampusEngine.js`
- **实际完成**：
  - 编辑器新增区域绘制工具，可在平面画布点击放置区域占地轮廓。
  - 区域类型可选：绿地/草坪、水体/湖泊、操场/运动场、广场/铺装、停车场。
  - 选中区域后可修改名称、类型，并继续使用现有顶点编辑、移动、撤销/重做和自动保存机制。
  - 2.5D/场景预览按区域类型使用不同地表材质；水体使用较低粗糙度材质。
  - 区域仍以统一 `areas` Feature 集合持久化，未新增独立的第二份地图数据。
- **限制**：
  - 区域工具当前采用点击位置生成初始矩形，再通过顶点编辑调整轮廓；尚未实现鼠标连续绘制多边形。
  - 树木、路灯、座椅等点/实例对象尚未实现为可编辑持久化对象；画布上现存的树木装饰仍有硬编码数据，不能视为正式空间数据。
  - 3D 当前仍是第一人称相机模式，尚未提供完整的第三人称透视 3D 渲染档位；需后续拆分投影模式与相机控制模式。
- **验证**：
  - 第一阶段入口重构对应 Frontend CI、Backend CI 均通过（commit `ff4d3fb`）。
  - 本阶段代码已提交；本阶段 Frontend CI / Backend CI 正在运行，结果未出炉。
  - 未完成浏览器交互验收。
- **下一步**：
  1. 实现点/实例类对象（树木、路灯、座椅），接入保存和两种渲染器。
  2. 将 2.5D/3D 视图切换与总览/跟随/第一人称相机控制解耦。
  3. 将区域矩形放置升级为连续多边形绘制。
  4. 在浏览器验证默认入口、编辑器区域绘制、自动保存和 2.5D 预览一致性。

## 2026-11-04 — 第一阶段：默认入口切换为 2.5D 校园探索

- **变更类型**：入口与场景初始化重构。
- **修改文件**：
  - `src/App.vue`
  - `src/three/engine/createCampusEngine.js`
- **实际完成**：
  - 根路径不再挂载 Canvas 2D `CampusPixelMap`，改为启动 Three.js 校园场景并应用当前平面编辑文档预览。
  - 根路径默认展示 2.5D 等距校园探索；原 `?view=editor` 仍进入平面地图编辑器。
  - 校园探索增加“打开地图编辑器”入口；编辑器 3D 预览与探索使用同一引擎实例。
  - 将等距 RPG 相机能力与虚构 RPG 样板场景类型解耦；真实校园场景可以使用等距相机，不必加载虚构样板校园。
  - 视角标签明确为“2.5D 总览 / 2.5D 探索 / 3D 视角”。
- **重要边界**：当前 3D 视角是同一场景的第一人称透视相机模式；尚未完成独立的完整 3D 建筑资产/细节升级。当前阶段也未改变平面编辑器对象类型能力。
- **验证状态**：已提交代码；等待 GitHub Actions 构建结果。尚未进行浏览器运行时验收。
- **已知风险/后续验证**：需确认默认场景中校园数据预览成功、场景 Canvas 尺寸正常、编辑器打开/关闭不丢失引擎状态；检查首页进入时的实际地面/建筑/道路可见性。
- **下一步**：补齐 2.5D 与 3D 显式切换体验及编辑器入口路由状态，再统一编辑器对象类型和几何绘制工具。

## 2026-11-04 — 建立产品目标与架构基线

- **变更类型**：文档/产品决策固化。
- **正式目标**：两个一级入口——校园探索、地图编辑器。
- **校园探索**：默认 2.5D，可切换 3D；两种视图共用同一校园空间数据。
- **地图编辑器**：以平面底图绘制建筑、道路、树木、水域、绿地、广场及设施；按对象语义选择点/线/面/实例工具；保存为统一空间模型并预览 2.5D/3D。
- **架构原则**：一套权威空间数据、多个渲染适配器；平面图是数据生产工具，不是独立权威地图。
- **代码状态**：本次只建立规范文档，尚未完成入口代码重构；当前 `src/App.vue` 默认仍挂载 `CampusPixelMap`，2.5D Three.js 入口仍依赖旧的 `?view=showcase` 逻辑。
- **验证**：已读取开发分支最新 `src/App.vue`、`CampusPixelMap.vue`、Three.js 引擎及现有产品/空间数据文档；本次没有运行构建，因为未改动运行时代码。
- **下一步**：将首页入口改为真正的 2.5D 校园探索；明确 2.5D/3D 同场景视图切换；将平面编辑器作为独立入口；移除 `isRpgSample` 同时承担样板与真实校园入口的语义混用。


## 2026-11-04 — 第三阶段：拆分置信度与核验状态

- **变更类型**：统一空间数据适配器修复与回归测试。
- **修改文件**：
  - `src/editor/campusFeatureCollection.js`
  - `src/editor/campusFeatureCollection.test.js`
  - `src/data/campus/campusGeoJSON.test.js`
  - `docs/architecture/CAMPUS_SPATIAL_ARCHITECTURE.md`
- **实际完成**：
  - 编辑器 Feature 正向序列化时，`confidence` 只表示 low / medium / high；`verificationStatus` 只表示 verified / unverified；`qualityStatus` 保留编辑器历史核验状态。
  - 不再把旧字段 `confidence` 当作 `qualityStatus` 传入，避免 high / medium 被错误解释为核验状态。
  - FeatureCollection 反向转换时分别恢复置信度、核验状态和编辑器质量状态，不再用 `qualityStatus` 覆盖置信度。
  - 新增正向/反向适配器回归测试，以及编辑器 FeatureCollection 直接进入 `validateCampusGeoJSON` 的集成质检测试。
- **验证**：
  - 已通过代码级检查确认新增断言覆盖 building、road、water 三类对象。
  - GitHub Actions 将在提交后执行；本记录不提前宣称 CI 通过。
  - 尚未进行真实浏览器端保存/刷新验收。
- **未解决事项**：
  - 仍需核对所有旧文档中 `qualityStatus` 的历史取值，确认没有超出 verified / unverified 的业务状态。
  - 仍需执行浏览器端保存、回读、首页与编辑器预览一致性验收。
- **下一步**：等待前后端 CI；通过后继续第三阶段完整 FeatureCollection 合并与持久化验收，不提前进入第四阶段。


### 统一图层置信度回退规则补充

- 修正 `getCampusSpatialLayers` 的置信度读取：只接受 low / medium / high；缺失或非法值回退为 low，不再把 `qualityStatus: unverified` 当作置信度。
- 修正旧测试中将 `confidence: medium` 错误断言为 `qualityStatus: medium` 的语义混淆，改为分别断言三个字段。


### 点对象质量元数据回读修复

- 修复编辑器初始化基础点对象时将 `confidence` 从业务属性中剥离的问题。
- `qualityStatus` 不再回退读取 `confidence`；优先使用历史质量状态，其次使用 `verificationStatus`，最终保守回退为 unverified。
- 增加点对象往返转换测试，确保 confidence、verificationStatus、rotation、scale 均保留。


- 统一质检集成用例进一步覆盖 Point 树木对象，检查其 objectType、confidence、verificationStatus 与 qualityStatus 同时符合契约。


## 2026-11-04 — 第三阶段数据一致性复核

- **CI 验证结果**：提交 `cb408078260a4ecd5e6ce7e637d8662c7a0e021c` 对应 Frontend CI 与 Backend CI 均通过。前端 npm install / npm test / npm run build 成功；后端 NestJS build、PostGIS migrations、API integration tests、PostGIS schema verification 成功。
- **本轮审查确认**：
  - 基础 FeatureCollection 已包含 boundary、gate、building、road、area、object；建筑、道路、区域和点对象通过稳定 ID 与编辑器数据合并。
  - 编辑器保存时生成 FeatureCollection；首页和编辑器三维预览均通过共享空间图层适配器派生渲染输入。
  - 质量字段 confidence、verificationStatus、qualityStatus 已分离，并覆盖 building、road、water、tree 的回归测试。
- **尚未完成的架构迁移**：
  - `CampusPlanEditor.vue` 仍以 buildings / roads / areas / objects 四组响应式数组作为交互工作模型。
  - FeatureCollection 目前是持久化与渲染边界的规范交换格式，并非编辑器内部唯一权威状态。
  - 因此第三阶段只能判定为“统一数据契约和共享渲染适配已建立，编辑器内部单一数据源迁移未完成”，不得宣布阶段验收通过。
- **未完成的验证**：真实浏览器端保存、刷新、首页/编辑器一致性与移动端交互尚未人工验收。
- **下一步**：设计编辑器 FeatureCollection 单一状态迁移方案，先解决绘制、拖动、撤销重做、批量操作与属性面板对数据集合的写入边界，再分批迁移，保持旧文档兼容；完成后重新跑全量 CI 和浏览器验收。


## 2026-11-04 — 撤销/重做历史统一为 FeatureCollection 快照

- **代码变更**：
  - 新增 `createCampusFeatureSnapshot` / `restoreCampusFeatureSnapshot`，以版本化 FeatureCollection 作为空间历史快照的唯一载荷。
  - 编辑器 undo/redo 新历史不再分别序列化 buildings、roads、areas、objects 四组数组；恢复时通过统一反向适配器还原交互视图。
  - 保留旧版会话历史快照读取兼容，避免迁移过程中旧格式无法恢复。
  - 删除 ID 在快照中统一去重并保留。
- **测试覆盖**：新增快照往返测试，覆盖建筑、道路、水域、树木、confidence、rotation、scale 和删除标记；新增不支持版本拒绝测试。
- **架构边界**：本次统一的是 undo/redo 历史存储契约，不代表编辑器实时交互状态已迁移为 FeatureCollection 唯一数据源。四组数组仍是当前交互工作模型，第三阶段继续进行。
- **验证**：代码已提交；需以本次提交对应的 Frontend CI 结果作为自动化验证依据。真实浏览器交互尚未验收。


## 2026-11-04 — 建立按 Feature ID 操作的空间变更 API

- 新增不可变 FeatureCollection 变更函数：按稳定 ID 执行 upsert、properties 更新、geometry 更新和批量删除。
- 删除操作可选择写入 tombstone；重新 upsert 同 ID Feature 时自动清除对应删除标记。
- 所有函数返回新集合，不修改输入对象；不存在的 ID 和非法几何明确报错。
- 新增单元测试验证不可变性、稳定 ID 更新、删除标记和异常路径。
- **迁移边界**：本次建立统一 mutation API，但现有 CampusPlanEditor.vue 尚未全面改为调用该 API，实时交互仍有 legacy 数组写入。不得宣称编辑器已完成单一状态迁移。
- 前端 CI 需以本次提交对应的运行结果为准；浏览器人工验收未执行。


## 2026-11-04 — 属性检查器改为显式 Feature mutation

- 建筑、道路、区域和点对象的属性检查器不再通过 `v-model` 直接修改选中对象的嵌套引用。
- 属性变更改为按稳定 Feature ID 调用 `updateCampusFeatureProperties`，然后由兼容适配器刷新现有交互视图。
- 建筑名称/模板/楼层与立面参数、道路宽度、区域名称/类型、点对象名称/类型/朝向/缩放均改为显式提交。
- 新增检查器属性变更经 FeatureCollection 往返适配的测试。
- **迁移边界**：画布绘制、拖动、顶点编辑、复制粘贴和部分删除逻辑仍直接操作 legacy 数组；当前 mutation helper 是检查器写入路径，不代表所有编辑操作已统一。
- 真实浏览器验收尚未执行。


## 2026-11-04 — 新增与删除操作接入 Feature mutation

- 连续绘制新增建筑、道路、区域，点对象放置，快捷放置建筑/区域/道路，以及 AI 识图导入的建筑/道路/区域，统一经 `upsertCampusFeature` 写入 FeatureCollection mutation 流程。
- 单选删除和批量删除统一经 `removeCampusFeatures` 按稳定 ID 删除；基础校园对象删除继续写入 tombstone。
- mutation 后通过兼容适配器刷新当前编辑器交互集合，保留现有画布和渲染消费方式。
- 当前迁移范围覆盖属性检查器、新增/导入、删除；拖动、顶点编辑、道路控制点编辑、复制粘贴仍有 legacy 数组直接写入，尚未完成单一状态源迁移。
- 本轮未执行真实浏览器端到端验收。


## 2026-11-04 — 几何拖动编辑接入 FeatureCollection mutation

- 建筑/区域整体拖动、建筑/区域顶点拖动、道路整体拖动、道路节点拖动、点对象拖动和多选移动，改为按稳定 Feature ID 调用 `updateCampusFeatureGeometry`。
- 拖动过程每次指针更新都先基于当前 FeatureCollection 计算几何变更，再通过规范 mutation API 更新，并由兼容适配器刷新画布数据。
- 保留原有撤销快照入口、吸附计算、道路宽度及对象 properties；几何替换不覆盖 Feature properties 元数据。
- 初始化/加载/历史恢复和保存阶段仍保留 legacy 兼容数组投影；当前仍非 FeatureCollection 唯一实时状态源。
- 本轮未执行浏览器端到端验收，尤其需要验证高频 pointermove 下性能、拖动平滑度、撤销/重做和自动保存。


## 2026-11-04 — FeatureCollection 成为编辑器空间状态主源

- 新增编辑器级 `spatialFeatureCollection` 状态，空间 mutation 直接以该集合为输入并回写该集合。
- `buildDocument()`、自动保存、导出、撤销/重做快照和预览文档的空间部分改为从规范 FeatureCollection 派生；legacy 数组仅作为现有 SVG 模板和属性面板的兼容投影。
- 加载服务端文档后，将基础校园数据与已保存编辑数据合并，再初始化规范集合；历史恢复同步重建规范集合。
- 对齐/分布、多边形顶点增删、建筑尺寸调整/旋转、道路节点增删、复制粘贴等几何写入路径继续迁移到 Feature mutation API。
- 新增建筑、道路、水域、点对象几何变更往返测试，检查稳定 ID、道路宽度、建筑楼层、区域内环、来源、置信度和核验状态。
- 迁移仍有边界：部分编辑器界面仍读取兼容数组；初始化时仍需 legacy 基础数据转换。尚未进行浏览器端拖动/撤销/重做/保存验收。


## 2026-11-04 — 几何平移保留 Polygon 内环

- 建筑、区域、道路整体拖动改为直接变换规范 Feature geometry，不再将区域几何降级为仅含外环的 legacy footprint。
- 多选拖动、对齐和分布使用规范几何变换，Polygon 的外环和内环整体平移，LineString 保持道路中心线语义。
- 顶点编辑提交外环时保留已有 Polygon 内环，避免修改水域边界时意外删除岛洞/孔洞。
- 本轮修复基于代码审查发现的真实数据丢失风险；尚需浏览器验证水域孔洞拖动、对齐、顶点编辑，以及多选交互。


## 2026-11-04 — 统一空间几何平移工具

- 新增 `translateCampusFeatureGeometry`，在规范 GeoJSON 几何层统一支持 Point、LineString、Polygon、MultiPolygon 平移。
- Polygon/MultiPolygon 的全部 ring 均按同一位移变换，避免水域内环在拖动、多选、对齐和分布时丢失或错位。
- 编辑器拖动、对齐、分布统一复用该工具；新增单元测试覆盖几何类型、内环保留、原对象不可变和非法参数。
- 自动化验证以本次提交触发的 Frontend CI 为准；真实浏览器端交互仍待验收。


## 2026-11-04 — 服务端 FeatureCollection 直接合并基础校园数据

- 新增 `mergeCampusFeatureCollections`：以基础校园 FeatureCollection 为底座，保存文档中的同 ID Feature 覆盖基础对象，tombstone 优先删除。
- 编辑器加载服务端文档时，优先直接使用保存的 FeatureCollection 与基础集合合并，不再先反向转换 legacy 数组再重新构造规范集合。
- 迁移期间仍通过 `fromCampusFeatureCollection` 派生 SVG 编辑器兼容视图；规范集合保留未知 Feature 类型，避免较旧编辑器加载/保存时静默丢弃未来对象类型。
- 新增覆盖 ID 覆盖、tombstone 删除、未知 Feature 保留和输入不可变的合并测试。
- 当前基础集合来自编辑器已有校园基础数组；目录类 POI/门区等未纳入该编辑器集合的内容仍由首页校园数据目录处理。


## 2026-11-04 — 撤销/重做保留未知规范 Feature

- 修复历史恢复路径：此前 `restoreCampusFeatureSnapshot` 只返回 legacy 兼容数组，编辑器再从数组重建 FeatureCollection，会丢弃旧编辑器无法识别的 Feature 类型。
- 恢复结果现在同时返回兼容投影和原始规范 FeatureCollection；编辑器撤销/重做直接恢复规范集合。
- 新增测试覆盖：支持的树木对象正常投影，未知设施 Feature、扩展属性和 tombstone 在历史恢复后完整保留。
- 该修复与服务端加载的未知 Feature 保留规则一致；尚未完成浏览器端 undo/redo 与自动保存回读验收。


## 2026-11-04 — 复制粘贴改为规范 Feature 操作

- 复制时直接从规范 FeatureCollection 读取完整 Feature，不再从建筑/道路/区域/对象 legacy 数组提取数据。
- 新增 `duplicateCampusFeature`，生成新稳定 ID、平移规范几何，并保留 properties、来源、置信度、核验状态及扩展属性。
- 粘贴通过 `upsertCampusFeature` 写入规范集合；Point、LineString、Polygon、MultiPolygon 使用统一几何平移逻辑。
- 新增复制测试，覆盖 Polygon 内环、质量元数据、扩展属性和源对象不可变。
- 复制粘贴的实际画布交互、撤销/重做及保存回读仍需浏览器验收。


## 2026-11-04 — 复制粘贴与几何编辑全面接入规范集合

- 复制从规范 FeatureCollection 读取完整 Feature；粘贴使用 `duplicateCampusFeature` 生成新 ID、平移 geometry 并保留全部 properties。
- 建筑/区域顶点拖动、道路节点拖动、点对象拖动改为直接更新规范 geometry。
- 增加/删除 Polygon 顶点、建筑尺寸调整与旋转统一提交 Polygon 外环，同时保留现有内环。
- 道路节点增删直接提交 LineString coordinates，不再通过 legacy road points 数组重建。
- 编辑器空间几何更新已移除旧的 `commitFeatureGeometry(fragment)` 写入入口；legacy 数组仅作为兼容视图和交互派生数据。
- 本轮完成代码静态检查，确认编辑器不再存在直接写入 `footprint/points/coordinates` 的旧路径；CI 结果以最新提交工作流为准，浏览器端验收仍待完成。


## 2026-11-04 — 未知 Feature 连续变更与历史持久性回归测试

- 新增未知 Polygon Feature 的连续属性修改、几何修改、已知 Feature 新增、legacy 投影、历史快照恢复和删除 tombstone 测试。
- 验证未来类型 Feature 不会因为 legacy 投影无法识别而从规范集合消失。
- 验证 vendor 扩展属性、confidence、verificationStatus、Polygon 内环和多来源删除标记在历史恢复后保持。
- 保存文档仍以 `spatialFeatureCollection` 为权威空间 payload；服务端保存和刷新回读需结合实际浏览器环境验收。


## 2026-11-04 — 修复 schema v4 FeatureCollection 服务端持久化契约

- 修复前后端 schema 版本不一致：编辑器提交 schemaVersion 4，后端原先只接受 v2，导致规范空间文档无法保存。
- 后端现在接受 schema v2/v3/v4，v4 必须包含规范 FeatureCollection；保留 v2 旧文档保存兼容。
- 服务端校验 FeatureCollection 类型、Feature 稳定 ID 唯一性、geometry 结构、有限坐标、properties 对象、删除 tombstone 和文档体积。
- `campus_plan_document.schema_version` 现在存储实际文档版本，不再固定写入 2。
- 新增 PostGIS API 集成测试：v4 FeatureCollection 保存/回读、未知 Feature 与扩展属性保留、tombstone 保留、重复 ID 拒绝、版本冲突，以及旧 v2 文档兼容。
- 最新提交 `b315858` 的 Frontend CI 与 Backend CI 均 completed success；浏览器端真实自动保存和刷新验收仍未完成。


## 2026-11-04 — 核对 FeatureCollection 读取与首页消费链路

- 核对 `GET scene/plan`：服务端直接读取并返回 JSONB document，不经 legacy 数组白名单转换。
- 核对编辑器加载：优先读取服务端规范 FeatureCollection，与基础校园集合按稳定 ID 合并，tombstone 参与最终过滤。
- 核对首页加载：读取同一 `scene/plan` 文档，合并后将规范 FeatureCollection 传入 Three.js 主场景。
- 核对 2.5D 主场景和编辑器 3D 预览：均通过 `createCampusSceneRenderData` / `getCampusSpatialLayers` 派生可渲染图层；未识别 Feature 暂不渲染，但不会因图层适配而从原集合删除。
- 最新源码提交 `b315858` 的 Frontend CI 与 Backend CI 均成功；本次仅补充架构核对记录。
- 尚未完成真实浏览器自动保存、刷新回读和首页/编辑器预览一致性验收；legacy 数组仍保留为交互兼容投影。


## 2026-11-04 — 修复建筑 Polygon 内环双向投影

- 发现建筑 Feature 从规范 Polygon 投影到 legacy building 数组时只保留外环，导致兼容适配结果丢失中庭/镂空环。
- `toCampusFeatureCollection` 与 `fromCampusFeatureCollection` 现在双向保留建筑 `holes`。
- 新增建筑 Polygon 内环完整 round-trip 回归测试，验证所有 ring 坐标不变。
- CI 等待本次代码提交触发；浏览器端仍需执行实际编辑验收。


## 2026-11-04 — 修复首页场景合并时集合级 metadata 丢失

- 发现首页合并基础校园数据与编辑器 FeatureCollection 时，只返回基础数据 metadata，编辑器集合级扩展 metadata 会被丢弃。
- 合并策略调整为基础 metadata 提供默认值、编辑器 metadata 同名字段优先；双方 catalogue 按子键合并。
- 新增回归测试，覆盖基础目录与编辑器扩展目录同时保留。
- 更新空间架构文档第 40 节，明确首页合并的 metadata 保留契约。
- 本次修改的 CI 需以最新提交为准；浏览器端首页刷新和编辑器回读仍待真实环境验收。


## 2026-11-05 — 合并基础与编辑器空间数据时继承双方删除标记

- 进一步审查发现，首页场景合并此前只读取编辑器集合的 deletedFeatureIds，没有继承基础集合可能携带的删除标记。
- 修复为合并双方 tombstone 并稳定去重，再统一过滤 Feature，避免多来源数据合并时已删除对象复活。
- 新增回归测试，覆盖基础集合和编辑器集合分别携带删除标记的情况。
- 更新空间架构文档第 41 节。
- 最新提交 CI 尚待完成；浏览器端保存、刷新和首页同步仍待真实验收。


## 2026-11-05 — 修复编辑器加载时基础集合 metadata 丢失

- 编辑器加载服务端文档时改为直接使用 buildCampusGeoJSON() 的完整 FeatureCollection，不再从四组兼容数组重建基础集合。
- toCampusFeatureCollection() 现在透传 document.metadata，确保兼容数组转换不会丢失集合级目录信息。
- mergeCampusFeatureCollections() 合并基础与编辑器 metadata；编辑器同名字段优先，双方 catalogue 按子键合并。
- 新增回归测试覆盖 metadata 透传与 catalogue 合并。
- 更新空间架构文档第 42 节。
- CI 以本次最新 HEAD 结果为准；浏览器端真实加载、自动保存和刷新回读仍待验收。


## 2026-11-05 — 补充服务端集合级 metadata 持久化回归测试

- 核对 SaveRpgMapDto：document 是整体对象字段，未声明嵌套白名单 DTO；全局 ValidationPipe 不会递归剥离 document 内的未知 FeatureCollection properties/metadata。
- ScenesService 对规范文档执行结构校验后直接 JSON.stringify 写入 JSONB，读取时直接返回 document。
- 扩展 schema v4 API 集成测试，加入 metadata.dataset 与 metadata.catalogue（基础目录和编辑器扩展目录），验证 PUT/GET 完整对象相等。
- 更新空间架构文档第 43 节。
- 本次新增测试尚待 GitHub Actions 执行；浏览器端完整验收仍未完成。


## 2026-11-05 — 修复版本冲突恢复时的自动保存竞态

- 审查自动保存与 revision 冲突恢复流程，发现重新加载服务端版本前未清理可能仍待执行的自动保存定时器。
- 在 reloadEditorDocument() 开始时清除待执行 timer，并将 timer 句柄置空；若保存请求仍在进行则阻止并发重载。
- 更新空间架构文档第 44 节。
- 该变更尚待 CI 执行；浏览器端并发冲突恢复仍需实测。


## 2026-11-05 — 加强 schema v4 GeoJSON geometry 类型校验

- 服务端 FeatureCollection 校验由通用递归数字检查升级为按 GeoJSON geometry 类型校验。
- 覆盖 Point、MultiPoint、LineString、MultiLineString、Polygon、MultiPolygon 和 GeometryCollection；集合子 geometry 递归校验并限制深度。
- 校验 Position 有限坐标、LineString 最少两个点、Polygon LinearRing 至少四个点且首尾闭合；拒绝未知类型和错误嵌套。
- 扩展 API 集成测试，覆盖合法 MultiPolygon/GeometryCollection 保存回读，以及错误 MultiPolygon 嵌套、未闭合 Polygon ring、GeometryCollection 内非法坐标和未知 geometry 类型。
- 修正原 schema v4 测试中的 Polygon 内环样例，使其满足 LinearRing 闭合规则。
- 更新空间架构文档第 45 节。
- 最新变更尚未取得 CI 执行结果；需确认现有校园基础数据中的环均满足闭合约束，并完成浏览器端保存回读验收。


## 2026-11-05 — 修复自动保存失败时的无限重试

- 审查自动保存请求的 finally 分支，发现其按“当前文档是否不同于上次成功保存快照”决定补发请求。
- 当网络或服务端持续失败且用户没有继续编辑时，当前文档始终不同于上次成功快照，导致每 500ms 自动重试，形成无上限请求循环。
- 调整为仅当本次保存请求执行期间又发生了新编辑（当前快照不同于本次请求快照）时，才补发一次最新内容；同一内容保存失败后停止自动重试，保留错误状态，后续用户编辑仍可触发自动保存。
- 已核对平面文档唯一写入路由为 `PUT /campuses/:campusId/maps/:mapId/scene/plan`，控制器调用 `ScenesService.savePlan`，并在写入事务前统一执行 `validatePlanDocument`。
- 本轮代码已提交；CI 需以本次最新 HEAD 的前后端 workflow 结果为准。真实浏览器端保存失败、编辑中途变更和冲突恢复仍待验收。


## 2026-11-05 — 底图预览资源失败不再阻断空间文档加载

- 审查编辑器加载链路时发现：服务端空间文档已成功读取后，如果关联底图资产预览请求失败，原先外层 catch 会使 documentLoaded 保持 false。
- 这会导致 FeatureCollection 已进入编辑器，但自动保存 watcher 被关闭，用户后续修改无法自动持久化。
- 将底图预览加载改为独立的 best-effort 步骤：预览失败保留错误提示，但不阻断空间文档加载、revision 初始化和后续自动保存。
- 空间文档 API 本身失败时仍保持 documentLoaded=false，避免在未成功读取服务端版本时误覆盖数据。
- 代码已提交；需以本次最新 HEAD 的前后端 CI 为准。底图资源失效场景仍需浏览器验收。


## 2026-11-05 — 编辑器卸载时提交待保存修改

- 检查路由切换和编辑器关闭生命周期，发现 debounce 定时器可能在组件卸载时被清理，而对应修改尚未发起保存。
- 在卸载前检查文档是否已加载、当前是否没有保存请求/版本冲突，以及当前快照是否不同于最后成功保存快照；满足条件时立即启动一次保存，再清理定时器。
- 若已有保存请求正在进行，则不启动并发写入；该请求原有的请求期间变更检测仍负责补发最新内容。
- 此处理针对 SPA 组件卸载。浏览器整页关闭、强制刷新或进程终止时，网络请求仍可能被浏览器中断，不能视为离线可靠队列。
- 代码已提交；需以最新 HEAD CI 结果为准。


## 2026-11-05 — 修复撤销/重做快照丢失 FeatureCollection metadata

- 对照 metadata 的保存、加载、首页合并和撤销/重做链路时，发现 createCampusFeatureSnapshot() 只保存 features 与 deletedFeatureIds，未保存 FeatureCollection.metadata。
- 这会导致用户执行撤销或重做后，metadata.dataset、metadata.catalogue 及其他集合级扩展字段从规范空间状态中丢失，并可能在下一次自动保存时被持久化删除。
- 现在历史快照完整保留 FeatureCollection.metadata；恢复时继续通过 snapshot 中的 FeatureCollection 返回原 metadata。
- 增加测试覆盖 dataset、catalogue 在创建快照、JSON 序列化和恢复后的完整往返。
- 本次代码和测试已提交，CI 尚待执行；此前同一 HEAD 的前后端 CI 已通过，但不代表本轮新增修改通过。


## 2026-11-05 — 修复建筑单击摆放与点对象拖动交互

- 用户浏览器验收发现：选择建筑摆放后按单点操作，画布只出现绘制点，未生成可见建筑；现有工具实际要求至少 3 个顶点并点击完成绘制，与资产库“点击放置”的交互文案不一致。
- 将“建筑摆放”调整为单击生成默认矩形建筑，创建后自动选中并切换到选择工具，可直接拖动、改名和编辑轮廓。
- 保留多边形能力，新增独立“建筑轮廓”工具，继续支持多点绘制并点击完成绘制。
- 点对象拖动改为由 SVG 根节点捕获指针事件，并清空旧多选状态；同时补齐对象图层可见性控制。
- 本次代码已提交；CI 与真实浏览器复测待完成。原先未成功创建的测试建筑不计入验收结果。


## 2026-11-05 — 明确自动保存状态并提供手动保存入口

- 浏览器验收反馈表明，用户无法判断自动保存是否真正成功；此前顶部状态在初始 idle 阶段显示“自动保存已开启”，容易被误认为数据已经落库，详细错误信息又仅显示在侧边栏。
- 顶部状态现在区分等待修改、有未保存修改、正在保存、已保存及版本冲突/保存失败；已保存状态显示服务端 revision，悬停可查看详细结果。
- 新增“立即保存”操作，复用同一保存接口、revision 校验和错误处理，不绕过自动保存机制。
- 加载已有服务端文档后明确显示已加载版本；加载空文档时不再伪装成已保存。
- 前后端 CI 与浏览器端刷新回读验收待完成。此次 UI 改进不能代替服务端持久化验证。


## 2026-11-05 — 编辑器历史操作统一为上一步/下一步

- 顶部历史操作与画布工具栏统一使用“上一步 / 下一步”文案，并通过悬浮提示展示 Ctrl/Cmd + Z、Ctrl/Cmd + Shift + Z 快捷键。
- 增加 Ctrl/Cmd + Z 撤销、Ctrl/Cmd + Shift + Z 重做；输入框、文本域、下拉框和可编辑区域内不拦截快捷键。
- 保持现有 FeatureCollection 历史快照、撤销/重做栈、按钮禁用条件和自动保存机制不变；撤销后新编辑清空重做栈的既有行为继续沿用。
- 本次仅调整编辑器操作入口与键盘映射，不改变空间数据模型。


## 2026-11-05 — 第二轮校园场景 GPU 性能优化

- 2.5D/总览模式关闭实时阴影 shadow pass；仅在 3D 跟随或第一人称模式启用，降低大量静态校园网格带来的额外 GPU 绘制开销。
- 根据视口面积动态限制 WebGL drawing buffer，目标不超过约 150 万像素；高分辨率屏幕自动降低渲染倍率，降低 GPU fill-rate 压力。
- 扩展 `?render-debug=1` 诊断信息，输出 draw calls、三角形数量、几何体/纹理数量、场景对象/网格数量及单帧 renderer.render 耗时，便于下一轮按实测瓶颈优化。
- 不改变空间 FeatureCollection、地图对象、几何数据、编辑器保存与撤销/重做语义。
- 本轮变更仍需 Frontend/Backend CI 与真实浏览器体验验证；渲染耗时日志只在显式开启 render-debug 时采集。


## 2026-11-05 — 修复人物脚底接触阴影跟随

- 人物移动时不再依赖静态缓存的 directional shadow map 投射自身阴影，避免阴影留在出生点或与当前人物位置错位。
- 为角色增加柔边径向渐变接触阴影，直接锚定角色根节点脚底，随人物移动、转向和楼层高度同步，不受身体呼吸/步态起伏影响。
- 接触阴影使用透明 CanvasTexture + MeshBasicMaterial，不参与动态 shadow pass；保留人物对场景光照的正常响应，避免为角色移动恢复高成本实时阴影重算。

- 编辑器预览克隆人物时同步克隆材质 map 贴图，退出预览释放副本资源不会误释放正式人物的接触阴影纹理。
- 需要浏览器验收人物静止、四方向移动、转向、上下楼层时阴影是否始终贴地且位于双脚下方，并检查阴影边缘是否过重或穿透地面。


## 2026-11-05 — 统一水域渲染与行走碰撞数据源

- 修复校园碰撞初始化仍从静态 `CAMPUS_AREAS` 读取湖泊，而首页场景已从编辑器 FeatureCollection 渲染的双数据源问题。
- 湖泊阻挡多边形现在从与场景渲染相同的 `createCampusSceneRenderData` 派生区域读取；移动、删除或新增水域后，画面与碰撞层使用同一份几何数据。
- 保留水域 Polygon 内环（holes）作为可通行岛屿，不改变建筑墙体、树木/设施碰撞和校园边界策略。
- 本次修复需要在浏览器验证此前无法行走的空地是否恢复通行，并确认湖面仍不可穿越、岛屿仍可行走。


## 2026-11-05 — 空间要素通行属性与默认碰撞策略

- 新增统一 `walkable` 布尔属性：普通地面、道路、绿地、广场、运动场等默认允许通行；建筑、水域、树木、长椅、路灯、雕塑等实体默认禁止通行；花卉/装饰默认允许通行。
- 类型默认值仅用于旧数据或新建要素缺少显式配置时；一旦 Feature.properties.walkable 存在，人工设置优先并随 FeatureCollection、保存、撤销/重做持久化。
- 编辑器属性检查器新增“允许通行 / 禁止通行”设置，适用于建筑、道路、区域和点对象。
- 漫游碰撞注册读取归一化后的 walkable：可通行建筑/实体不注册人物碰撞，不可通行区域按 Polygon 与洞区注册，不可通行道路按道路宽度生成面碰撞。
- 保留校园边界约束、建筑墙段/门洞几何和水域洞区语义。


## 2026-11-05 — 修复校园外围漫游范围过度收缩

- 根据用户反馈的“西侧湖区左边”和“整圈外围马路无法通行”定位到活动边界问题：旧 walkableBounds 比校园底图范围向内收缩 2 个世界单位，CollisionWorld 又按人物半径向内保留安全距离，导致西侧/南侧/北侧/东侧外围环线道路及其外侧区域被提前截断。
- 将人物活动边界扩展到校园底图外侧 12 个世界单位，覆盖外围道路和道路外侧缓冲区；建筑、水域、树木及人工设置的不可通行对象仍由独立碰撞体控制，不放宽实体碰撞。
- 本轮不修改湖泊 Polygon、区域 walkable 属性或道路几何，避免用关闭区域碰撞掩盖边界配置问题。
- 需要浏览器验收西侧湖区左边、四周外围环线道路及道路外侧；同时回归确认湖面、建筑和树木仍不可穿越。


## 2026-11-05 — 活动边界改为按全部校园空间内容动态计算

- 修正上一轮固定扩展底图矩形的方案：校园内容可能超出参考底图边框，固定以底图尺寸计算仍会把外围湖泊、操场或道路排除在活动范围之外。
- 活动边界现在从规范化校园空间层的区域 Polygon/holes、建筑 footprint、道路中心线、点对象、校园边界 Polygon 和出入口坐标汇总实际几何范围。
- 外围缓冲按道路宽度动态留边（最小 2.5 个世界单位），不再使用固定 12 单位扩展。
- 此边界仅限制漫游活动范围；建筑、水域、树木及不可通行对象仍由各自碰撞体控制。
- 浏览器验收需覆盖西侧湖区左侧、操场外缘、外围环线道路以及所有空间内容最外沿，确认边界仅落在全部内容之外少量距离。


## 2026-11-05 首页校园首屏构图居中

- 首页首次初始化不再把世界坐标原点固定当作校园视觉中心。
- 校园场景根据区域、建筑、道路、点对象、边界和出入口的实际空间坐标生成内容包络盒，并提供中心点、宽度和深度。
- 首屏相机按内容包络中心定位，并结合容器宽高比计算适配范围，避免校园整体落在背景底部或偏离画布。
- 初始聚焦仅在首次进入首页时执行；从建筑返回等显式延续场景的入口保留原有相机状态，不覆盖用户后续平移、缩放和旋转。


- 修复 2.5D/3D 总览相机姿态串扰：从 3D 切回 2.5D 时保留观察中心和视野尺度，但恢复固定北向上斜俯视，不再继承 3D 的旋转与俯仰角。
- 首页首屏构图继续以统一空间图层的内容包络中心为聚焦目标；本轮不改动已验收的漫游边界、碰撞和空间数据。


- 2.5D 与 3D 总览平移中心隔离：各自保存独立的 OrbitControls target；首次按校园内容包络聚焦时初始化两套中心，后续拖拽只更新当前视角，切换视角恢复各自上次查看位置。


## 2026-11-05 — 修复 3D 总览右键平移事件优先级

- 3D 总览自定义平移监听器改为在 DOM 捕获阶段接管右键/中键 `pointerdown`，并阻止后续监听器继续消费该手势，避免 OrbitControls 或页面其他监听器抢先处理右键。
- 指针移动仍由独立平移逻辑处理；中键、左键旋转、滚轮缩放和 2.5D 操作规则保持不变。
- 需在实际浏览器验证右键拖动；代码提交不等同于部署已更新或浏览器验收通过。


## 2026-11-05 — 补充总览模式操作指南

- 总览操作指南按 2.5D/3D 展示模式分别说明鼠标与触屏手势：2.5D 左/右键拖动平移；3D 左键旋转、右键/中键平移；滚轮缩放。
- 移动设备额外展示单指与双指操作说明，并明确“重置视角”用于恢复校园初始构图。
- 移除总览指南中未实现的“双击聚焦”说明，避免操作文案与实际交互不一致。
