# 地图数据契约 V1

本文件定义二维编辑器、NestJS API、PostGIS 与 Three.js 之间的数据边界。数据库是线上事实源；API 以 GeoJSON Geometry 传输空间要素。

## 1. 坐标规范

- 当前坐标系为 `campus-local`，坐标顺序 `[x,y]`，x 向右、y 向下。
- 单位由地图元数据声明：pixel、meter 或 local-unit。pixel/local-unit 不代表真实距离。
- PostGIS Geometry 使用 SRID 0 存储校园局部平面坐标；不可把它标注为 EPSG:4326。
- GeoJSON 坐标为二维；Polygon 线性环必须闭合。
- 只有在具备控制点、坐标参考系统和转换参数时，才可转换到真实地理坐标。

## 2. MapDocument 示例

```json
{
  "schemaVersion": "1.0.0",
  "campus": {"id": "campus_ncgxy", "slug": "ncgxy", "name": "南昌工学院"},
  "map": {
    "id": "map_main",
    "name": "主校区",
    "coordinateSystem": "campus-local",
    "coordinateUnit": "pixel",
    "canvas": {"width": 640, "height": 480},
    "revision": 1
  },
  "layers": [{
    "id": "layer_buildings",
    "key": "buildings",
    "name": "建筑",
    "type": "building",
    "visible": true,
    "locked": false,
    "features": [{
      "id": "feature_001",
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[100,100],[160,100],[160,145],[100,145],[100,100]]]
      },
      "properties": {
        "name": "教学楼示例",
        "buildingCode": "B-001",
        "floors": 5,
        "height": 18,
        "heightUnit": "meter",
        "confidence": "unverified"
      }
    }]
  }]
}
```

## 3. Geometry 类型

首期支持 Point、LineString、Polygon、MultiPolygon。空间几何写入前必须校验类型、二维坐标、坐标范围和拓扑合法性；不能未经校验直接持久化绘图库输出。

## 4. Three.js 适配

- Three.js 不直接读取数据库表结构。
- API 将实体组装为 MapDocument。
- 统一适配器将地图坐标映射到 Three.js XZ 平面，例如 `worldX=x, worldZ=-y`。
- 建筑 footprint 决定平面轮廓；高度、楼层和模型资源来自 properties。
- 未核实高度和模型必须明确标记为占位数据。
- 渲染对象保留 featureId，以支持拾取和属性面板联动。

## 5. 并发控制

Map 与 Feature 均维护 revision。更新必须携带客户端读取时的 revision；匹配则递增，不匹配返回 HTTP 409。禁止无条件最后写入覆盖。

## 6. 导入导出

ZIP 项目包包含 manifest、GeoJSON 和 assets。导入时校验 schemaVersion、文件大小、MIME、geometry 合法性和资源引用；先进入临时草稿，校验通过后再提交。ZIP 是交换格式，不是线上主存储。
