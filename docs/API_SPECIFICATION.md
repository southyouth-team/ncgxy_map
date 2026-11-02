# 南昌工学院数字校园 API 规范（V1 规划）

## 1. 通用约定
统一前缀 /api/v1；JSON + GeoJSON；BIGINT ID 用字符串。操作者 ID 从认证上下文获取。错误码：400/401/403/404/409。列表采用 limit + cursor。写操作校验 campus、资源归属和角色，防止 IDOR。更新采用 revision 乐观锁。

## 2. 空间管理
| 方法 | 路径 | 用途 |
|---|---|---|
| GET/POST | /campuses/:campusId/buildings | 建筑列表/创建 |
| GET/PATCH | /campuses/:campusId/buildings/:buildingId | 建筑详情/更新 |
| GET/POST | /buildings/:buildingId/floors | 楼层列表/创建 |
| PATCH | /floors/:floorId | 更新楼层 |
| GET/POST | /floors/:floorId/spaces | 空间列表/创建 |
| GET/PATCH | /spaces/:spaceId | 空间详情/更新 |
| POST | /spaces/:spaceId/connections | 创建通行连接 |
| DELETE | /connections/:connectionId | 删除连接 |
| GET | /spaces/:spaceId/connections | 查询邻接空间 |

创建空间的 geometry 属于 floor.coordinate_config 声明的楼层局部坐标系，不能默认解释为校园坐标。

## 3. Feature 绑定
- POST/GET/PUT/DELETE /campuses/:campusId/maps/:mapId/features/:featureId/binding
- 校验 feature、map、campus 与目标实体归属一致；entity_type 必须白名单。

## 4. 三维场景
- GET /campuses/:campusId/scenes：场景列表。
- GET /scenes/:sceneId：场景详情和资源清单。
- POST /scenes/:sceneId/enter：校验权限并返回 spawn point。
- GET /spaces/:spaceId/scene-binding：空间模型绑定。
私有资源返回受控地址或资源 ID，不暴露存储凭证。

## 5. 隐私与 Presence
- GET/PATCH /users/me/privacy：读取/更新隐私设置。
- PUT/DELETE /users/me/presence：发布/关闭当前 presence。
- GET /spaces/:spaceId/presence：查询当前用户有权看到的成员。
可见性枚举 hidden（默认）、building、space。space 只展示空间身份，不展示精确坐标。服务端必须从认证上下文获取 user_id，校验进入空间权限和用户授权；Redis 保存短 TTL，心跳续期；关闭/退出/登出/超时清理。查询必须过滤屏蔽关系、校园成员关系和空间访问权限。禁止按任意 user_id 查询隐藏位置。

## 6. 会话与消息
- GET/POST /spaces/:spaceId/sessions：会话列表/创建。
- POST /sessions/:sessionId/join、/leave：加入/离开。
- GET/POST /sessions/:sessionId/messages：游标分页/发送。
- DELETE /sessions/:sessionId/messages/:messageId：按策略删除/撤回。
- POST /messages/:messageId/report：举报。
所有操作校验空间访问策略和会话成员资格。

## 7. WebSocket 事件
presence.updated/expired、space.member.joined/left、chat.message.created/deleted、avatar.pose.updated、activity.updated。payload 包含 event_id、occurred_at、campus_id、resource_id、schema_version。avatar.pose.updated 是虚拟状态，不能复用现实 presence。高频移动事件节流并广播，不逐帧持久化。

## 8. 安全治理
生产环境必须正式认证，禁止 DevIdentityGuard。WebSocket 握手认证，每个事件校验资源权限或可靠授权缓存。社交上线前必须具备限流、附件校验、内容审核、举报、屏蔽和管理审计。
