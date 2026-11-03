/**
 * 南昌工学院像素校园主空间底图。
 *
 * 空间参考：南昌工学院《2026级新生报到指南》校园平面图。
 * 参考图按 1000 × 500 图像像素建立坐标，图框范围为 mapBounds。
 * 当前坐标为人工数字化近似值，不是测绘坐标；楼栋编号为视觉对象 ID，
 * 未核实的楼栋名称、尺寸和层数不在此处伪造。
 *
 * 原图仅用于空间结构参考，不作为公开项目贴图再分发。
 */

export const CAMPUS_PLAN_REFERENCE = {
  image: {
    width: 1000,
    height: 500,
    source: '南昌工学院2026级新生报到指南·校园平面图（reference-only）',
  },
  mapBounds: {
    left: 153,
    top: 49,
    right: 844,
    bottom: 466,
  },
  // 仅为 Three.js 场景比例单位，不代表真实米制距离。
  worldWidth: 150,
  get worldDepth() {
    return this.worldWidth
      * (this.mapBounds.bottom - this.mapBounds.top)
      / (this.mapBounds.right - this.mapBounds.left)
  },
}

const bounds = CAMPUS_PLAN_REFERENCE.mapBounds
const scale = CAMPUS_PLAN_REFERENCE.worldWidth / (bounds.right - bounds.left)

/** 将道路/路径中心线转换为 Three.js 地面坐标点列。 */
export function mapPolylineToWorld(points) {
  if (!Array.isArray(points)) return []
  return points.map(([x, y]) => mapPixelToWorld(x, y))
}

/** 将道路中心线及宽度转换为统一世界空间数据，供 3D 渲染、碰撞和寻路复用。 */
export function mapRoadToWorld(road) {
  if (!road || !Array.isArray(road.points)) return null
  return {
    id: road.id,
    confidence: road.confidence,
    points: mapPolylineToWorld(road.points),
    width: (CAMPUS_ROAD_WIDTHS[road.id] || 12) * scale,
  }
}

/** 判断图像坐标点是否落在闭合环内（射线法）。 */
export function pointInCampusPolygon(point, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    const crosses = (yi > point[1]) !== (yj > point[1])
    if (crosses && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** 判断点是否位于区域主体内；holes 表示主体内部的可通行洞区/岛屿。 */
export function pointInCampusArea(point, area) {
  if (area?.rect) {
    const [left, top, right, bottom] = area.rect
    return point[0] >= left && point[0] <= right && point[1] >= top && point[1] <= bottom
  }
  if (!area?.polygon || !pointInCampusPolygon(point, area.polygon)) return false
  return !(area.holes || []).some(hole => pointInCampusPolygon(point, hole))
}

/** 原图像素坐标 -> Three.js 地面坐标（X、Z）。 */
export function mapPixelToWorld(pixelX, pixelY) {
  return {
    x: (pixelX - (bounds.left + bounds.right) / 2) * scale,
    z: (pixelY - (bounds.top + bounds.bottom) / 2) * scale,
  }
}

/** 像素矩形 -> 世界中心点、宽度和深度。 */
export function mapRectToWorld([left, top, right, bottom]) {
  const center = mapPixelToWorld((left + right) / 2, (top + bottom) / 2)
  return {
    ...center,
    width: (right - left) * scale,
    depth: (bottom - top) * scale,
  }
}

/**
 * 校园主要地理区域。多边形来自官方平面图的人工近似描绘，
 * 重点保证整体空间关系；后续可用现场核验数据逐项修正。
 */
export const CAMPUS_PLAYER_SPAWN_PIXEL = Object.freeze([420, 315])

export const CAMPUS_AREAS = [
  {
    id: 'central-lake',
    name: '中央湖区',
    type: 'water',
    confidence: 'medium',
    holes: [[
      [492, 178], [520, 158], [553, 158], [582, 178], [599, 207],
      [600, 244], [580, 274], [552, 294], [520, 298], [493, 280],
      [478, 250], [478, 214],
    ]],
    polygon: [
      [474, 132], [500, 116], [538, 112], [572, 124], [602, 150],
      [620, 184], [625, 222], [615, 260], [596, 294], [568, 322],
      [535, 340], [505, 329], [484, 304], [468, 270], [462, 230],
      [464, 190], [468, 157],
    ],
  },
  {
    id: 'west-lake',
    name: '西侧湖区',
    type: 'water',
    confidence: 'medium',
    polygon: [
      [164, 68], [190, 58], [222, 60], [250, 72], [271, 94],
      [283, 120], [275, 146], [252, 166], [222, 178],
      [192, 169], [171, 148], [160, 118],
    ],
  },
  {
    id: 'north-east-sports-field',
    name: '东北侧运动场',
    type: 'sports',
    confidence: 'high',
    rect: [770, 57, 834, 151],
  },
  {
    id: 'south-central-sports-field',
    name: '南部运动场',
    type: 'sports',
    confidence: 'high',
    rect: [432, 337, 519, 443],
  },
  {
    id: 'west-north-building-cluster',
    name: '西北建筑组团',
    type: 'building-cluster',
    confidence: 'medium',
    rect: [158, 132, 255, 302],
  },
  {
    id: 'west-south-building-cluster',
    name: '西南建筑组团',
    type: 'building-cluster',
    confidence: 'medium',
    rect: [160, 302, 270, 425],
  },
  {
    id: 'north-central-building-cluster',
    name: '北部中央建筑组团',
    type: 'building-cluster',
    confidence: 'medium',
    rect: [326, 54, 478, 148],
  },
  {
    id: 'north-east-building-cluster',
    name: '东北建筑组团',
    type: 'building-cluster',
    confidence: 'medium',
    rect: [606, 54, 770, 153],
  },
  {
    id: 'west-central-building-cluster',
    name: '西侧中央建筑组团',
    type: 'building-cluster',
    confidence: 'medium',
    rect: [326, 164, 449, 324],
  },
  {
    id: 'east-central-building-cluster',
    name: '东侧中央建筑组团',
    type: 'building-cluster',
    confidence: 'medium',
    rect: [655, 166, 807, 326],
  },
  {
    id: 'south-building-cluster',
    name: '南部建筑组团',
    type: 'building-cluster',
    confidence: 'medium',
    rect: [520, 337, 802, 448],
  },
]

/**
 * 主干道路与主要步行通道中心线。
 * 道路宽度按视觉比例渲染；道路控制点是图面近似，不用于精确导航。
 */
export const CAMPUS_ROAD_CENTERLINES = [
  {
    id: 'north-perimeter-road',
    confidence: 'medium',
    points: [[160, 76], [300, 54], [470, 52], [650, 52], [810, 62], [835, 100]],
  },
  {
    id: 'west-perimeter-road',
    confidence: 'medium',
    points: [[160, 76], [154, 180], [154, 300], [160, 420], [185, 455]],
  },
  {
    id: 'east-perimeter-road',
    confidence: 'medium',
    points: [[835, 100], [842, 205], [838, 320], [830, 420], [805, 455]],
  },
  {
    id: 'south-perimeter-road',
    confidence: 'medium',
    points: [[185, 455], [340, 462], [500, 462], [670, 458], [805, 455]],
  },
  {
    id: 'central-lake-loop-road',
    confidence: 'medium',
    points: [
      [450, 145], [465, 112], [500, 94], [545, 92], [588, 110],
      [620, 142], [642, 184], [650, 228], [638, 274], [610, 316],
      [570, 348], [525, 358], [480, 342], [448, 310], [430, 270],
      [426, 222], [432, 180], [450, 145],
    ],
  },
  {
    id: 'north-campus-connector',
    confidence: 'low',
    points: [[280, 150], [330, 150], [380, 150], [430, 150], [462, 165]],
  },
  {
    id: 'west-campus-connector',
    confidence: 'low',
    points: [[260, 205], [292, 205], [315, 230], [320, 275], [330, 320]],
  },
  {
    id: 'east-campus-connector',
    confidence: 'low',
    points: [[642, 315], [680, 328], [720, 330], [765, 330], [815, 315]],
  },
  {
    id: 'south-campus-connector',
    confidence: 'low',
    points: [[425, 315], [455, 335], [500, 337], [545, 337], [620, 337], [730, 337]],
  },
  {
    id: 'south-west-connector',
    confidence: 'low',
    points: [[270, 360], [315, 365], [360, 380], [400, 405], [430, 430]],
  },
]

/** 道路图面宽度（像素）；统一作为 2D 绘制与 3D 地面宽度的唯一数据源。 */
export const CAMPUS_ROAD_WIDTHS = Object.freeze(Object.fromEntries(
  CAMPUS_ROAD_CENTERLINES.map(road => [road.id, road.id.includes('perimeter') ? 15 : 12]),
))

/**
 * 从平面图中可辨识的建筑轮廓近似标注。
 * 采用区域编号，不将图面中无法确认的文字转成正式楼栋名称。
 */
export const CAMPUS_BUILDING_FOOTPRINTS = [
  // 西北侧组团
  { id: 'west-north-01', label: '西北组团 01', rect: [164, 137, 226, 151], confidence: 'medium' },
  { id: 'west-north-02', label: '西北组团 02', rect: [164, 165, 226, 179], confidence: 'medium' },
  { id: 'west-north-03', label: '西北组团 03', rect: [164, 193, 226, 207], confidence: 'medium' },
  { id: 'west-north-04', label: '西北组团 04', rect: [164, 221, 226, 235], confidence: 'medium' },
  { id: 'west-north-05', label: '西北组团 05', rect: [164, 249, 226, 263], confidence: 'medium' },
  { id: 'west-north-06', label: '西北组团 06', rect: [164, 277, 226, 291], confidence: 'medium' },
  // 西南侧组团
  { id: 'west-south-01', label: '西南组团 01', rect: [164, 307, 222, 321], confidence: 'medium' },
  { id: 'west-south-02', label: '西南组团 02', rect: [164, 334, 222, 348], confidence: 'medium' },
  { id: 'west-south-03', label: '西南组团 03', rect: [164, 361, 222, 375], confidence: 'medium' },
  { id: 'west-south-04', label: '西南组团 04', rect: [164, 388, 222, 402], confidence: 'medium' },
  // 北部中央组团
  { id: 'north-center-01', label: '北部组团 01', rect: [333, 62, 378, 76], confidence: 'medium' },
  { id: 'north-center-02', label: '北部组团 02', rect: [333, 87, 378, 101], confidence: 'medium' },
  { id: 'north-center-03', label: '北部组团 03', rect: [333, 112, 378, 126], confidence: 'medium' },
  { id: 'north-center-04', label: '北部组团 04', rect: [391, 62, 440, 76], confidence: 'medium' },
  { id: 'north-center-05', label: '北部组团 05', rect: [391, 87, 440, 101], confidence: 'medium' },
  { id: 'north-center-06', label: '北部组团 06', rect: [391, 112, 440, 126], confidence: 'medium' },
  { id: 'north-center-07', label: '北部组团 07', rect: [447, 62, 474, 76], confidence: 'low' },
  { id: 'north-center-08', label: '北部组团 08', rect: [447, 87, 474, 101], confidence: 'low' },
  // 西侧中央组团
  { id: 'west-center-01', label: '西侧组团 01', rect: [333, 174, 388, 188], confidence: 'medium' },
  { id: 'west-center-02', label: '西侧组团 02', rect: [333, 199, 388, 213], confidence: 'medium' },
  { id: 'west-center-03', label: '西侧组团 03', rect: [333, 224, 388, 238], confidence: 'medium' },
  { id: 'west-center-04', label: '西侧组团 04', rect: [333, 249, 388, 263], confidence: 'medium' },
  { id: 'west-center-05', label: '西侧组团 05', rect: [333, 274, 388, 288], confidence: 'medium' },
  { id: 'west-center-06', label: '西侧组团 06', rect: [397, 174, 440, 188], confidence: 'medium' },
  { id: 'west-center-07', label: '西侧组团 07', rect: [397, 199, 440, 213], confidence: 'medium' },
  { id: 'west-center-08', label: '西侧组团 08', rect: [397, 224, 440, 238], confidence: 'medium' },
  // 东北侧组团
  { id: 'east-north-01', label: '东北组团 01', rect: [615, 62, 666, 76], confidence: 'medium' },
  { id: 'east-north-02', label: '东北组团 02', rect: [615, 88, 666, 102], confidence: 'medium' },
  { id: 'east-north-03', label: '东北组团 03', rect: [615, 114, 666, 128], confidence: 'medium' },
  { id: 'east-north-04', label: '东北组团 04', rect: [678, 62, 731, 76], confidence: 'medium' },
  { id: 'east-north-05', label: '东北组团 05', rect: [678, 88, 731, 102], confidence: 'medium' },
  { id: 'east-north-06', label: '东北组团 06', rect: [678, 114, 731, 128], confidence: 'medium' },
  { id: 'east-north-07', label: '东北组团 07', rect: [738, 62, 766, 76], confidence: 'low' },
  { id: 'east-north-08', label: '东北组团 08', rect: [738, 88, 766, 102], confidence: 'low' },
  // 东侧中央组团
  { id: 'east-center-01', label: '东侧组团 01', rect: [674, 174, 721, 188], confidence: 'medium' },
  { id: 'east-center-02', label: '东侧组团 02', rect: [674, 200, 721, 214], confidence: 'medium' },
  { id: 'east-center-03', label: '东侧组团 03', rect: [674, 226, 721, 240], confidence: 'medium' },
  { id: 'east-center-04', label: '东侧组团 04', rect: [674, 252, 721, 266], confidence: 'medium' },
  { id: 'east-center-05', label: '东侧组团 05', rect: [737, 176, 786, 190], confidence: 'medium' },
  { id: 'east-center-06', label: '东侧组团 06', rect: [737, 202, 786, 216], confidence: 'medium' },
  { id: 'east-center-07', label: '东侧组团 07', rect: [737, 228, 786, 242], confidence: 'medium' },
  { id: 'east-center-08', label: '东侧组团 08', rect: [737, 254, 786, 268], confidence: 'medium' },
  // 南部组团
  { id: 'south-center-01', label: '南部组团 01', rect: [528, 350, 580, 364], confidence: 'medium' },
  { id: 'south-center-02', label: '南部组团 02', rect: [528, 376, 580, 390], confidence: 'medium' },
  { id: 'south-center-03', label: '南部组团 03', rect: [528, 402, 580, 416], confidence: 'medium' },
  { id: 'south-center-04', label: '南部组团 04', rect: [594, 350, 646, 364], confidence: 'medium' },
  { id: 'south-center-05', label: '南部组团 05', rect: [594, 376, 646, 390], confidence: 'medium' },
  { id: 'south-center-06', label: '南部组团 06', rect: [594, 402, 646, 416], confidence: 'medium' },
  { id: 'south-east-01', label: '东南组团 01', rect: [660, 350, 712, 364], confidence: 'medium' },
  { id: 'south-east-02', label: '东南组团 02', rect: [660, 376, 712, 390], confidence: 'medium' },
  { id: 'south-east-03', label: '东南组团 03', rect: [660, 402, 712, 416], confidence: 'medium' },
  { id: 'south-east-04', label: '东南组团 04', rect: [726, 350, 778, 364], confidence: 'medium' },
  { id: 'south-east-05', label: '东南组团 05', rect: [726, 376, 778, 390], confidence: 'medium' },
]
