/**
 * 南昌工学院校园平面图第一版空间标注。
 *
 * 坐标来源：用户提供的《南昌工学院平面图》（640 × 480 示意图）。
 * pixel 坐标以原图左上角为原点；不是 GIS 测绘坐标。
 * 当前建筑仅标注可辨识的轮廓/区域，名称不清晰的暂用功能区编号。
 *
 * 校准策略：
 * - mapBounds：校园主体图框在原图中的像素范围。
 * - worldWidth：将图框映射到 Three.js XZ 平面的宽度（演示比例，非真实米制）。
 * - mapPixelToWorld：统一执行像素坐标到世界坐标转换，避免各模块重复计算。
 */

export const CAMPUS_PLAN_REFERENCE = {
  image: {
    width: 640,
    height: 480,
    source: '南昌工学院平面图（用户提供）',
  },
  mapBounds: {
    left: 36,
    top: 92,
    right: 612,
    bottom: 460,
  },
  worldWidth: 150,
  // 图框宽高比约 1.565；按同一比例计算深度，保持平面图不变形。
  get worldDepth() {
    return this.worldWidth
      * (this.mapBounds.bottom - this.mapBounds.top)
      / (this.mapBounds.right - this.mapBounds.left)
  },
}

const bounds = CAMPUS_PLAN_REFERENCE.mapBounds
const scale = CAMPUS_PLAN_REFERENCE.worldWidth / (bounds.right - bounds.left)

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
 * 第一批可辨识的校园空间要素。
 * polygon 使用原图像素坐标；暂不把模糊文字强行识别成正式建筑名称。
 */
export const CAMPUS_AREAS = [
  {
    id: 'central-lake',
    name: '中心湖区',
    type: 'water',
    confidence: 'medium',
    polygon: [[177, 194], [205, 185], [250, 188], [280, 207], [290, 238], [276, 267], [289, 300], [270, 336], [235, 351], [190, 337], [165, 306], [165, 255]],
  },
  {
    id: 'north-east-sports-field',
    name: '东北侧运动场',
    type: 'sports',
    confidence: 'high',
    rect: [535, 111, 601, 220],
  },
  {
    id: 'south-west-sports-field',
    name: '西南侧运动场',
    type: 'sports',
    confidence: 'high',
    rect: [105, 390, 177, 463],
  },
  {
    id: 'north-west-residential-zone',
    name: '西北建筑组团',
    type: 'building-cluster',
    confidence: 'high',
    rect: [39, 99, 190, 190],
  },
  {
    id: 'west-central-building-zone',
    name: '西侧建筑组团',
    type: 'building-cluster',
    confidence: 'high',
    rect: [39, 283, 177, 389],
  },
  {
    id: 'north-central-building-zone',
    name: '北部中央建筑组团',
    type: 'building-cluster',
    confidence: 'medium',
    rect: [207, 99, 349, 191],
  },
  {
    id: 'north-east-building-zone',
    name: '东北建筑组团',
    type: 'building-cluster',
    confidence: 'medium',
    rect: [383, 99, 525, 187],
  },
  {
    id: 'east-building-zone',
    name: '东侧建筑组团',
    type: 'building-cluster',
    confidence: 'medium',
    rect: [385, 220, 550, 365],
  },
  {
    id: 'south-central-building-zone',
    name: '南部建筑组团',
    type: 'building-cluster',
    confidence: 'medium',
    rect: [185, 370, 535, 454],
  },
]

/**
 * 道路/通道控制点，按图面中心线粗略标注。
 * 目前作为路径骨架，不代表可直接用于导航的精确路网。
 */
export const CAMPUS_ROAD_CENTERLINES = [
  {
    id: 'north-perimeter-road',
    confidence: 'medium',
    points: [[44, 95], [190, 95], [350, 95], [520, 95], [604, 110]],
  },
  {
    id: 'west-perimeter-road',
    confidence: 'medium',
    points: [[40, 105], [40, 210], [40, 330], [40, 450]],
  },
  {
    id: 'east-perimeter-road',
    confidence: 'medium',
    points: [[606, 110], [606, 230], [606, 350], [600, 450]],
  },
  {
    id: 'south-perimeter-road',
    confidence: 'medium',
    points: [[45, 455], [180, 455], [340, 455], [500, 455], [600, 455]],
  },
  {
    id: 'central-campus-road',
    confidence: 'low',
    points: [[180, 365], [235, 355], [300, 365], [370, 385], [450, 405], [530, 410]],
  },
  {
    id: 'lake-north-walkway',
    confidence: 'low',
    points: [[165, 190], [205, 180], [250, 184], [290, 205], [330, 210], [375, 205]],
  },
  {
    id: 'lake-east-walkway',
    confidence: 'low',
    points: [[290, 238], [315, 260], [330, 290], [320, 330], [300, 350]],
  },
  {
    id: 'east-campus-connector',
    confidence: 'low',
    points: [[375, 205], [380, 245], [385, 290], [405, 335], [450, 380]],
  },
  {
    id: 'west-campus-connector',
    confidence: 'low',
    points: [[165, 255], [150, 285], [150, 325], [175, 355], [220, 375]],
  },
]

/**
 * 可辨识建筑矩形的第一批粗略标注。
 * label 暂用区域编号，待高清图/实地照片核实后再绑定正式楼栋名称。
 */
export const CAMPUS_BUILDING_FOOTPRINTS = [
  { id: 'zone-nw-01', label: '西北组团 01', rect: [43, 102, 129, 116], floors: null, confidence: 'medium' },
  { id: 'zone-nw-02', label: '西北组团 02', rect: [43, 124, 129, 138], floors: null, confidence: 'medium' },
  { id: 'zone-nw-03', label: '西北组团 03', rect: [43, 146, 129, 160], floors: null, confidence: 'medium' },
  { id: 'zone-nw-04', label: '西北组团 04', rect: [43, 168, 129, 182], floors: null, confidence: 'medium' },
  { id: 'zone-nw-05', label: '西北组团 05', rect: [139, 102, 183, 116], floors: null, confidence: 'medium' },
  { id: 'zone-nw-06', label: '西北组团 06', rect: [139, 124, 183, 138], floors: null, confidence: 'medium' },
  { id: 'zone-west-01', label: '西侧组团 01', rect: [43, 289, 127, 303], floors: null, confidence: 'medium' },
  { id: 'zone-west-02', label: '西侧组团 02', rect: [43, 311, 127, 325], floors: null, confidence: 'medium' },
  { id: 'zone-west-03', label: '西侧组团 03', rect: [43, 333, 127, 347], floors: null, confidence: 'medium' },
  { id: 'zone-west-04', label: '西侧组团 04', rect: [43, 355, 127, 369], floors: null, confidence: 'medium' },
  { id: 'zone-north-01', label: '北部组团 01', rect: [216, 103, 267, 117], floors: null, confidence: 'low' },
  { id: 'zone-north-02', label: '北部组团 02', rect: [278, 103, 323, 117], floors: null, confidence: 'low' },
  { id: 'zone-east-01', label: '东侧组团 01', rect: [393, 103, 462, 117], floors: null, confidence: 'low' },
  { id: 'zone-east-02', label: '东侧组团 02', rect: [393, 126, 462, 140], floors: null, confidence: 'low' },
  { id: 'zone-east-03', label: '东侧组团 03', rect: [475, 125, 520, 139], floors: null, confidence: 'low' },
]
