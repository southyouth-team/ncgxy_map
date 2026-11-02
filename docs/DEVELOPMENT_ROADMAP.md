# 南昌工学院数字校园开发路线与验收标准（V1）

## 1. 原则
先准确空间数据，再空间体验；先南昌工学院闭环，再多校园抽象。现实空间、地图 Feature、三维模型、虚拟 Avatar 分离。位置默认隐藏。模块化单体优先。

## 2. 阶段与验收

### P0 工程基线与 CI
交付：修复当前集成测试失败；固化 migration/PostGIS schema；统一错误格式、ID 和 revision；同步文档。
验收：backend build、PostGIS migration、API integration tests 通过；最新 HEAD 对应 Actions 全部 completed/success。

### P1 真实二维地图
交付：可信底图来源登记；仿射配准（至少 3 个不共线控制点、6 参数）；residual/RMSE、控制点和算法版本；底图与要素统一坐标转换；基础矢量化和质量状态。
验收：少于 3 点、共线和数值异常输入拒绝；配准参数可恢复；未核验数据保持 unverified；关键建筑有资料或现场核验。

### P2 建筑与室内空间
交付：building/floor/space/connection/feature_binding；建筑、楼层、房间管理界面；楼层局部坐标和室内底图。
验收：二维建筑 Feature 可打开对应实体；楼层包含房间和通行空间；连接关系同校且有效；未核验空间不用于正式导航。

### P3 三维场景映射
交付：scene/asset/binding/spawn point；建筑模型映射；二维建筑入口与三维跳转；Avatar 基础移动。
验收：二维入口进入正确场景；绑定实体同校；Avatar 仅代表虚拟位置；缺少模型时二维功能仍可用。

### P4 身份、隐私与在线状态
交付：正式认证；privacy 默认 hidden；Redis TTL/心跳/退出清理；聚合在线人数；屏蔽和查询权限。
验收：默认无法被位置接口发现；授权后只展示所选精度；关闭/退出/超时后不可见；未授权或被屏蔽用户无法查询；REST/WebSocket 权限一致。

### P5 空间聊天与活动
交付：session/member/message/activity；游标分页；举报、审核、限流；多实例时启用 Socket.IO Redis Adapter。
验收：仅有权用户可加入；消息持久化可恢复；禁言/屏蔽/无权限用户不可发送；举报和审核有审计记录。

### P6 语音与沉浸协作
交付：WebRTC + SFU 评估接入；Avatar 动作；多人活动和虚拟展厅；室内导航优化。
验收：目标并发、网络质量和成本压测通过；语音权限和屏蔽有效；高频状态不逐帧写数据库。

## 3. 当前执行顺序
1. 修复 CI 红灯。
2. 完成 affine 配准工具。
3. 建筑实体表和 API。
4. 绑定现有地图建筑 Feature。
5. 楼层与室内空间。
6. 三维场景绑定。
7. Presence 和聊天。

## 4. 交付管理
每项任务记录目标/非目标、migration/API/UI 变更、权限隐私影响、测试、验收步骤和回滚策略。一次提交聚焦一个可审查变更。提交后检查对应 HEAD 的 CI；queued/in_progress 不等于成功；失败先定位根因，不在红灯上叠加未验证功能。
