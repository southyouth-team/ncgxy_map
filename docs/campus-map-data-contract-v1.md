# 地图数据契约 V1

本文件定义二维编辑器、Node API 与 Three.js 之间的数据边界。数据库是线上数据事实源；此 JSON 结构用于 API 传输、版本快照和 ZIP 导入导出。

## 1. Campus Map 示例

```json
{
  "schemaVersion": "1.0.0",
  "campus": {
    "id": "campus_ncgxy",
    "slug": "ncgxy",
    "name": "南昌工学院"
  },
  "map": {
    "id": "map_main",
    "name": "主校区",
    "coordinateSystem": "campus-local",
    "coordinateUnit": "pixel",
    "canvas": { "width": 640, "height": 480 },
    "background": {
      "assetId": "asset_base_map",
      "opacity": 1,
      "fit": "contain"
    },
    "revision": 1
  },
  "layers": [
    {
      "id": "layer_buildings",
      "key": "buildings",
      "name": "建筑",
      "type": "building",
      "visible": true,
      "locked": false,
      "style": {
        "fill": "#c8a66e",
        "stroke": "#765d4a"
      },
      "features": [
        {
          "id": "feature_building_001",
          "type": "Feature",
          "geometry": {
            "type": "Polygon",
            "coordinates": [[[100, 100], [160, 100], [160, 145], [100, 145], [100, 100]]]
          },
          "properties": {
            "name": "教学楼示例",
            "category": "teaching",
            "buildingCode": "B-001",
            "floors": 5,
            "height": 18,
            "heightUnit": "meter",
            "modelAssetId": null,
            "confidence": "unverified"
          }
        }
      ]
    }
  ]
}
```

## 2. Geometry 约束

- 遵循 GeoJSON Feature / Geometry 的基本结构。
- 当前支持 Point、LineString、Polygon、MultiPolygon。
- Polygon 的每个线性环必须闭合；首尾坐标必须相同。
- 当前坐标顺序固定为 [x, y]，x 向右、y 向下。
- 坐标系和单位必须从 map.coordinateSystem / coordinateUnit 读取。
- 不允许把 pixel 或 local-unit 坐标误标成 WGS84 经纬度。
- 复杂 geometry 的拓扑合法性在 API 层校验；前端绘制库的输出不能未经校验直接持久化。

## 3. Feature 属性建议

### 建筑 building
`name`、`buildingCode`、`category`、`floors`、`height`、`heightUnit`、`modelAssetId`、`entrance`、`confidence`。

### 道路 road
`name`、`roadType`、`width`、`widthUnit`、`surface`、`walkable`。

### 水域 water
`name`、`waterType`、`depth`（可选）。

### 绿地 green
`name`、`greenType`、`planting`（可选）。

### POI poi
POI 建议使用 Point geometry；属性包括 `name`、`category`、`buildingId`、`floor`、`description`、`icon`、`openingHours`（按业务需要）。

## 4. Three.js 适配规则

- Three.js 不直接读取 MySQL 结构，也不直接读取 campus_feature 行。
- API 层将数据库记录组装成 MapDocument。
- 渲染适配器接收 MapDocument，并根据 geometry + properties 生成 Mesh / Line / Sprite。
- 统一坐标转换函数：`mapToWorld([x, y]) => { x, z: -y }` 或项目选定的固定变换；禁止在各图层重复实现坐标翻转。
- building footprint 决定建筑平面轮廓；高度、楼层和模型资源来自 properties。
- 没有真实高度/模型时，使用明确标记的占位高度，不将其当作真实建筑测绘信息。
- 渲染对象保存 featureId，供点击拾取后定位属性面板。

## 5. 自动保存与并发控制

每个 map 有递增 revision；每个 feature 也有独立 revision。

更新请求必须携带客户端读取时的 revision：
- revision 匹配：保存成功并递增 revision。
- revision 不匹配：返回 HTTP 409，响应当前服务端 revision 和冲突对象摘要。
- 不允许“最后写入者无条件覆盖”。

## 6. ZIP 项目包

建议包结构：

```text
campus-map-project.zip
├── manifest.json
├── data/
│   ├── layers.geojson
│   └── features/
│       ├── buildings.geojson
│       ├── roads.geojson
│       ├── water.geojson
│       └── poi.geojson
└── assets/
    ├── base-map/
    ├── images/
    ├── textures/
    └── models/
```

导入时校验 schemaVersion、文件大小、MIME、geometry 合法性和 asset 引用；导入操作先进入临时草稿，校验通过后再写入正式数据。导出包不包含用户密码、访问令牌或其他认证信息。
