# 空间数据模型与数据库设计（V1）

## 1. 约束
PostgreSQL 16+ / PostGIS 3.4+。BIGINT ID 在 API 中用字符串。API 使用 GeoJSON，DB 使用 PostGIS Geometry。当前 campus-local/SRID 0 是局部平面坐标，不代表经纬度或米。业务实体、地图 Feature、三维资产分离。

## 2. 现有地图域
保留 campus、campus_member、campus_map、campus_layer、campus_feature、campus_asset、campus_version。

## 3. 现实空间域

| 表 | 关键字段 | 用途/约束 |
|---|---|---|
| campus_area | id,campus_id,parent_id,name,area_type,geometry,quality_status | 校园分区；几何 GiST |
| campus_building | id,campus_id,code,name,building_type,floors_count,footprint,status,quality_status | 现实建筑；UNIQUE(campus_id,code) |
| campus_floor | id,campus_id,building_id,floor_number,name,elevation,coordinate_config,status | 楼层；UNIQUE(building_id,floor_number) |
| campus_space | id,campus_id,building_id,floor_id,parent_id,code,name,space_type,geometry,access_policy,quality_status | 房间/走廊/楼梯/电梯 |
| campus_space_connection | id,campus_id,from_space_id,to_space_id,connection_type,bidirectional,accessibility,status | 通行图边；禁止自连接 |
| campus_feature_binding | id,campus_id,feature_id,entity_type,entity_id | 地图要素绑定现实实体 |

area_type：teaching、residential、administrative、sports、landscape、other。building_type：teaching、library、dormitory、administration、laboratory、sports、commercial、other。space_type：classroom、office、laboratory、library_area、corridor、staircase、elevator、hall、rest_area、public_area、other。quality_status：unverified、needs_review、verified、rejected。access_policy：public、campus_member、invited、restricted。

## 4. 三维场景域

| 表 | 关键字段 | 用途 |
|---|---|---|
| campus_scene | id,campus_id,scene_key,name,version,status,coordinate_config | 场景元数据 |
| campus_scene_asset | id,campus_id,scene_id,asset_id,asset_role | 引用 campus_asset |
| campus_scene_binding | id,campus_id,scene_id,entity_type,entity_id,asset_id,transform | 模型映射 |
| campus_scene_spawn_point | id,campus_id,scene_id,space_id,position,rotation,is_default | 进入出生点 |

JSONB 的 transform/position/rotation 必须带 schema 版本，明确单位、轴向和原点。

## 5. 隐私与互动域

| 表 | 关键字段 | 用途 |
|---|---|---|
| user_privacy_setting | user_id,location_visibility,online_visibility,updated_at | 用户授权偏好，默认 hidden |
| user_block | user_id,blocked_user_id,created_at | 屏蔽关系，禁止自我屏蔽 |
| user_space_presence | user_id,campus_id,building_id,floor_id,space_id,visibility,expires_at | 可选短时快照，不是轨迹表 |
| space_session | id,campus_id,space_id,session_type,title,visibility,status,created_by | 会话容器 |
| space_session_member | session_id,user_id,role,joined_at,left_at,status | 会话成员 |
| space_message | id,campus_id,session_id,user_id,message_type,content,moderation_status,created_at,deleted_at | 持久化消息 |
| space_message_attachment | id,message_id,asset_id | 附件 |
| space_activity | id,campus_id,space_id,session_id,creator_id,title,start_at,end_at,status | 活动 |
| space_activity_member | activity_id,user_id,status,joined_at | 活动参与 |

在线心跳、实时位置和 Avatar 高频状态以 Redis 为主，设置 TTL；不逐帧写 PostgreSQL。消息按 session_id、created_at、id 建索引并游标分页。

## 6. 关系与索引
- building/floor/space/connection/scene/session 均校验 campus 归属；推荐复合外键或服务层事务校验。
- floor 同时带 campus_id、building_id，确保建筑属于同校。
- space 同时带 campus_id、building_id、floor_id。
- connection 两端必须同校且不能自连接。
- feature_binding 的 entity_type 使用服务端白名单，校验目标实体存在且同校。
- scene binding 的场景和实体必须同校。
- 几何列建立 GiST；业务外键建立 B-tree。
- campus_space 建 (campus_id,building_id,floor_id,space_type) 索引。
- space_message 建 (session_id,created_at DESC,id DESC)。
- session_member 建 UNIQUE(session_id,user_id) 并索引 user_id/status。

## 7. 坐标体系
校园级沿用 campus_map.coordinate_system/unit。楼层级有独立局部坐标系，配置 coordinate_system_key、unit、origin/axis、transform_to_campus、source_asset_id。楼层间通过 connection 建图，不假设坐标天然可比。Three.js 坐标转换由统一适配层完成。

## 8. 数据质量
关键实体记录 source、source_asset_id、quality_status、verified_by、verified_at。未核验空间不参与正式导航。配准结果应保存控制点、算法版本、residual/RMSE 和核验状态。

## 9. 迁移拆分
A：area/building；B：floor/space；C：connection/feature_binding；D：scene；E：privacy/presence；F：session/message/activity。每批包含回滚策略、外键范围测试、跨校园访问测试和索引验证。先做空间域，不一次性引入完整社交域。
