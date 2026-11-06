# Three.js 独立素材模板与沙盒组合 POC

日期：2026-11-05

## 目标

把“一个完整校园模型”拆成可复用的独立 Three.js 素材模板，再由一个统一 Scene 容器组合多个实例。模板生产与沙盒消费解耦；现有编辑器、Feature 空间数据、放置/碰撞/保存机制不在本 POC 修改范围内。

## 本轮实现

- `threeAssetTemplateRuntime.js`：提供版本化模板注册、查询、实例化和挂载到统一 Scene 的运行时。
- `createCampusAssetTemplateRuntime.js`：把现有建筑模板目录与八类场景资产生成器适配成独立模板；每次实例化都调用工厂创建新的 Object3D，不共享模型实例。
- 模板实例携带 `userData.assetTemplate`（模板 ID、版本、分类、对象类型）和 `userData.assetInstanceId`，可供后续编辑器拾取和持久化引用。
- 每个模板由受信任、静态打包的 JS 模块工厂实现；AI 产出的结构化设计数据传给工厂，不直接 eval/Function 执行 AI 源码。
- 模板实例的 position / rotation / scale 在运行时做数值和范围校验；实例支持直接加入现有 THREE.Scene 或 Group。

## 使用方式

```js
const runtime = createCampusAssetTemplateRuntime(THREE);
const sandboxScene = runtime.createSandboxScene();

const building = runtime.templates.createInto(sandboxScene, 'building:building-教学楼', {
  instanceId: 'building-instance-001',
  parameters: { width: 12, depth: 8, height: 16 },
  transform: { position: [0, 0, 0] },
});

const tree = runtime.templates.createInto(sandboxScene, 'vegetation:香樟树', {
  instanceId: 'tree-instance-001',
  parameters: { dimensions: { width: 3, height: 5, depth: 3 } },
  transform: { position: [12, 0, 0] },
});
```

## 重要边界

- 一个模板定义对应一份可版本化的 factory 模块；一个场景包含多个独立实例。相同模板可以生成多个互不共享 Object3D/Geometry 的实例。
- 道路、水体、地形等空间型模板仍需要由地图空间数据提供中心线、多边形、holes 或高程网格；模板只负责把这些输入渲染成 Mesh。
- 该 POC 不替换 ObjectSculptSpec，也不改变 GLB 导入。后续可增加 `object-sculpt`、`three-factory`、`glb` 等模板实现类型，由统一加载器分发。
- AI 直接生成的任意 JS/TS 不进入浏览器主线程执行。当前工厂是仓库内受信任模块；若未来支持外部代码包，必须独立隔离执行、静态分析和资源限额。
- 当前只完成运行时和单测层组合验证，不代表已接入生产沙盒场景或完成浏览器真实交互验收。

## 验收

- 同一 Scene 中至少组合建筑、树木、道路三种不同模板。
- 同一模板多次实例化得到不同 Object3D 与独立几何。
- 模板元数据能定位模板 ID/版本/实例 ID。
- 非法模板、非法变换和未知模板必须明确失败。
- 现有编辑器、Feature 坐标、碰撞与场景文档行为保持不变。


## 浏览器验收入口（新增）

开发服务器启动后访问 `http://localhost:5173/asset-template-lab`（以 Vite 实际端口为准）。

- 左侧按类别筛选模板并选择目标模板。
- 点击“添加到场景”，右侧实例列表应新增实例，中间画布显示模型。
- 可连续添加建筑、植被、道路等模板，验证多个不同模板处于同一个 Scene。
- 同一模板可重复添加；实例应有独立位置和 Object3D。
- 点击实例可聚焦；可调整选中实例缩放、删除实例或清空场景。
- 此页面独立于首页校园探索和地图编辑器，不会写入正式场景数据。

注意：此验收台调用当前仓库内的受信任工厂模块。AI 自由生成代码、模型外观还原质量、正式沙盒生产接入均不在本轮验收范围。
