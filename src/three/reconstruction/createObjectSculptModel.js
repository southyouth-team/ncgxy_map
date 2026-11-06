import { OBJECT_MODEL_GEOMETRY_CAPABILITIES, getObjectModelGeometryCapability, validateObjectModelSpecV3 } from '../../../server/src/shared/object-model-spec-v3.ts';
import { normalizeObjectModelMaterialParameterAliases, normalizeObjectModelMaterialParameterProperty } from '../../../server/src/shared/object-model-parameter-schema.ts';
import { resolveObjectModelParameterTarget } from '../../../server/src/shared/object-model-property-resolver.ts';
import { compileObjectModelSpec } from './objectModelSpecV3.js';
import { auditGeometryCapabilityCoverage, createGeometryCapabilityRegistry } from './geometryCapabilityRegistry.js';
/**
 * Bounded ObjectSculptSpec -> Three.js runtime adapter.
 *
 * This is the first integration seam for img2threejs-style component-tree specs.
 * It interprets declarative geometry only; it never evaluates model-generated JavaScript.
 */
const MAX_DIMENSION = 100;
const MAX_SEGMENTS = 48;
const DEFAULT_MATERIAL = Object.freeze({ color: '#b8b8b8', roughness: 0.82, metalness: 0 });

function finiteVector(value, fallback, label) {
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value) || value.length !== 3 || value.some(item => !Number.isFinite(Number(item)))) {
    throw new TypeError(label + ' 必须是三个有限数值');
  }
  return value.map(Number);
}

function stableObjectJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableObjectJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableObjectJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function disposeComponentGroup(group) {
  group?.traverse?.(item => { item.geometry?.dispose?.(); if (Array.isArray(item.material)) item.material.forEach(material => material?.dispose?.()); else item.material?.dispose?.(); });
}

function boundedNumber(value, fallback, min, max, label) {
  const number = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new RangeError(label + ' 超出允许范围');
  }
  return number;
}

function normalizeMaterial(THREE, source = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) source = DEFAULT_MATERIAL;
  const color = typeof source.color === 'string' && /^#[0-9a-f]{6}$/i.test(source.color)
    ? source.color : DEFAULT_MATERIAL.color;
  const roughness = boundedNumber(source.roughness, DEFAULT_MATERIAL.roughness, 0, 1, '材质 roughness');
  const metalness = boundedNumber(source.metalness, DEFAULT_MATERIAL.metalness, 0, 1, '材质 metalness');
  const opacity = boundedNumber(source.opacity, 1, 0.05, 1, '材质 opacity');
  return new THREE.MeshStandardMaterial({
    color, roughness, metalness, opacity,
    transparent: opacity < 1,
  });
}

export function createPolygonOutlineGeometry(THREE,points,width,height,depth,segments=16){if(!Array.isArray(points)||points.length<3||points.length>32)throw new RangeError('polygon points 必须包含 3 到 32 个轮廓点');points.forEach((point,index)=>{if(!Array.isArray(point)||point.length!==2||point.some(value=>!Number.isFinite(Number(value))||Number(value)<-.5||Number(value)>.5))throw new TypeError('polygon points['+index+'] 必须位于 [-0.5,0.5]')});const area=points.reduce((sum,point,index)=>{const next=points[(index+1)%points.length];return sum+Number(point[0])*Number(next[1])-Number(next[0])*Number(point[1])},0)/2;if(Math.abs(area)<.0001)throw new RangeError('polygon 轮廓面积不能为零');const shape=new THREE.Shape();shape.moveTo(Number(points[0][0])*width,Number(points[0][1])*height);for(const point of points.slice(1))shape.lineTo(Number(point[0])*width,Number(point[1])*height);shape.closePath();const geometry=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:segments});geometry.translate(0,0,-depth/2);return geometry}
function validateSimpleProfile(points, label) {
  if (!Array.isArray(points) || points.length < 3) throw new RangeError(label + ' 至少需要 3 个轮廓点');
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const onSegment = (a, b, p) => Math.abs(cross(a, b, p)) < 0.000001
    && p[0] >= Math.min(a[0], b[0]) - 0.000001 && p[0] <= Math.max(a[0], b[0]) + 0.000001
    && p[1] >= Math.min(a[1], b[1]) - 0.000001 && p[1] <= Math.max(a[1], b[1]) + 0.000001;
  const intersects = (a, b, c, d) => {
    const abC = cross(a, b, c), abD = cross(a, b, d);
    const cdA = cross(c, d, a), cdB = cross(c, d, b);
    if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
      && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
    return (Math.abs(abC) < 0.000001 && onSegment(a, b, c))
      || (Math.abs(abD) < 0.000001 && onSegment(a, b, d))
      || (Math.abs(cdA) < 0.000001 && onSegment(c, d, a))
      || (Math.abs(cdB) < 0.000001 && onSegment(c, d, b));
  };
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    if (Math.hypot(points[i][0] - next[0], points[i][1] - next[1]) < 0.0001) {
      throw new RangeError(label + ' 存在重复或零长度边');
    }
    area += points[i][0] * next[1] - next[0] * points[i][1];
  }
  if (Math.abs(area) < 0.0001) throw new RangeError(label + ' 轮廓面积不能为零');
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j += 1) {
      if (j === i || j === (i + 1) % points.length || i === (j + 1) % points.length) continue;
      if (intersects(a, b, points[j], points[(j + 1) % points.length])) {
        throw new RangeError(label + ' 存在自相交边');
      }
    }
  }
}



function validateSweepPathCurvature(points, label) {
  const maxTurnRadians = Math.PI * (150 / 180);
  for (let index = 1; index < points.length - 1; index += 1) {
    const incoming = points[index].clone().sub(points[index - 1]).normalize();
    const outgoing = points[index + 1].clone().sub(points[index]).normalize();
    const turnRadians = Math.acos(Math.max(-1, Math.min(1, incoming.dot(outgoing))));
    if (turnRadians > maxTurnRadians) {
      throw new RangeError(label + ' 存在超过 150° 的急转弯，可能导致扫掠截面翻转或自相交');
    }
  }
}


function createParallelTransportSweepGeometry(THREE, curve, profilePoints, steps, label) {
  if (curve.closed) throw new RangeError(label + ' 暂不支持闭合扫掠路径；闭合路径需要额外的截面接缝扭转校正');
  const centers = curve.getSpacedPoints(steps);
  const tangents = centers.map((_, index) => curve.getTangentAt(index / steps).normalize());
  const frames = [];
  const referenceAxes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const firstTangent = tangents[0];
  const reference = referenceAxes.slice().sort((a, b) => Math.abs(firstTangent.dot(a)) - Math.abs(firstTangent.dot(b)))[0];
  let normal = new THREE.Vector3().crossVectors(firstTangent, reference).normalize();
  let binormal = new THREE.Vector3().crossVectors(firstTangent, normal).normalize();
  frames.push({ normal: normal.clone(), binormal: binormal.clone() });
  for (let index = 1; index < tangents.length; index += 1) {
    if (tangents[index - 1].dot(tangents[index]) < Math.cos(Math.PI * (150 / 180))) {
      throw new RangeError(label + ' 插值曲线存在超过 150° 的急转弯，无法稳定传递截面方向');
    }
    const rotation = new THREE.Quaternion().setFromUnitVectors(tangents[index - 1], tangents[index]);
    normal.applyQuaternion(rotation);
    normal.addScaledVector(tangents[index], -normal.dot(tangents[index])).normalize();
    binormal.crossVectors(tangents[index], normal).normalize();
    frames.push({ normal: normal.clone(), binormal: binormal.clone() });
  }
  // Normalize the profile winding so side faces and caps have deterministic orientation.
  const profile = profilePoints.map(point => new THREE.Vector2(point[0], point[1]));
  let area = 0;
  for (let index = 0; index < profile.length; index += 1) {
    const next = profile[(index + 1) % profile.length];
    area += profile[index].x * next.y - next.x * profile[index].y;
  }
  if (area < 0) profile.reverse();
  const triangles = THREE.ShapeUtils.triangulateShape(profile, []).map(([a, b, c]) => {
    const abX = profile[b].x - profile[a].x;
    const abY = profile[b].y - profile[a].y;
    const acX = profile[c].x - profile[a].x;
    const acY = profile[c].y - profile[a].y;
    // Earcut triangle winding is normalized independently; never assume all
    // returned triangles share the same orientation.
    return abX * acY - abY * acX >= 0 ? [a, b, c] : [a, c, b];
  });
  if (!triangles.length) throw new RangeError(label + ' 无法三角化截面轮廓');
  const positions = [];
  const indices = [];
  const ringSize = profile.length;
  centers.forEach((center, ringIndex) => {
    const frame = frames[ringIndex];
    for (let edge = 0; edge < ringSize; edge += 1) {
      for (const point of [profile[edge], profile[(edge + 1) % ringSize]]) {
        const vertex = center.clone().addScaledVector(frame.normal, point.x).addScaledVector(frame.binormal, point.y);
        positions.push(vertex.x, vertex.y, vertex.z);
      }
    }
  });
  for (let ring = 0; ring < centers.length - 1; ring += 1) {
    for (let edge = 0; edge < ringSize; edge += 1) {
      const a = ring * ringSize * 2 + edge * 2;
      const b = a + 1, c = (ring + 1) * ringSize * 2 + edge * 2, d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  // Each cap triangle owns three vertices, keeping cap normals independent from side normals.
  for (const [ringIndex, reverse] of [[0, true], [centers.length - 1, false]]) {
    const frame = frames[ringIndex];
    for (const [a, b, c] of triangles) {
      const triangleIndices = [];
      for (const pointIndex of (reverse ? [a, c, b] : [a, b, c])) {
        const point = profile[pointIndex];
        const vertex = centers[ringIndex].clone().addScaledVector(frame.normal, point.x).addScaledVector(frame.binormal, point.y);
        triangleIndices.push(positions.length / 3);
        positions.push(vertex.x, vertex.y, vertex.z);
      }
      indices.push(...triangleIndices);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function validateGeneratedGeometry(geometry, label) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  if (!position || position.count < 3 || !normal || normal.count !== position.count) {
    throw new RangeError(label + ' 生成了不完整的顶点或法线数据');
  }
  for (let index = 0; index < position.count; index += 1) {
    const values = [position.getX(index), position.getY(index), position.getZ(index),
      normal.getX(index), normal.getY(index), normal.getZ(index)];
    if (values.some(value => !Number.isFinite(value))) {
      throw new RangeError(label + ' 包含非有限顶点或法线');
    }
    const normalLength = Math.hypot(values[3], values[4], values[5]);
    if (normalLength < 0.5 || normalLength > 1.5) {
      throw new RangeError(label + ' 包含长度异常的法线');
    }
  }
  const index = geometry.getIndex();
  const triangleCount = index ? index.count / 3 : position.count / 3;
  if (!Number.isInteger(triangleCount) || triangleCount < 1) {
    throw new RangeError(label + ' 没有有效三角形');
  }
  // Use scalar reads rather than relying on a specific typed-array implementation.
  const readIndex = offset => index ? index.getX(offset) : offset;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const ia = readIndex(triangle * 3), ib = readIndex(triangle * 3 + 1), ic = readIndex(triangle * 3 + 2);
    if (![ia, ib, ic].every(value => Number.isInteger(value) && value >= 0 && value < position.count)) {
      throw new RangeError(label + ' 包含无效或越界三角形索引');
    }
    const ax = position.getX(ia), ay = position.getY(ia), az = position.getZ(ia);
    const bx = position.getX(ib), by = position.getY(ib), bz = position.getZ(ib);
    const cx = position.getX(ic), cy = position.getY(ic), cz = position.getZ(ic);
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const bcx = cx - bx, bcy = cy - by, bcz = cz - bz;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const areaVectorSquared = nx * nx + ny * ny + nz * nz;
    const maxEdgeSquared = Math.max(
      abx * abx + aby * aby + abz * abz,
      acx * acx + acy * acy + acz * acz,
      bcx * bcx + bcy * bcy + bcz * bcz,
    );
    // Relative degeneracy test: stable across tiny and large model dimensions.
    if (maxEdgeSquared < 1e-24 || areaVectorSquared <= maxEdgeSquared * maxEdgeSquared * 1e-12) {
      throw new RangeError(label + ' 包含退化或近似退化三角形');
    }
  }
  return geometry;
}

function validateBoxGeometryDescriptor({ node, descriptor }) {
  if (descriptor.openings === undefined) return;
  if (!Array.isArray(descriptor.openings) || descriptor.openings.length > 24) {
    throw new TypeError(node.id + '.geometryDescriptor.openings 必须是最多 24 项的数组');
  }
  descriptor.openings.forEach((opening, index) => {
    if (!opening || typeof opening !== 'object' || Array.isArray(opening)) {
      throw new TypeError(node.id + '.geometryDescriptor.openings[' + index + '] 必须是对象');
    }
    for (const key of ['width', 'height']) {
      if (!Number.isFinite(Number(opening[key]))) {
        throw new TypeError(node.id + '.geometryDescriptor.openings[' + index + '].' + key + ' 必须是有限数值');
      }
    }
    if (opening.center !== undefined && (!Array.isArray(opening.center) || opening.center.length !== 2
      || opening.center.some(value => !Number.isFinite(Number(value))))) {
      throw new TypeError(node.id + '.geometryDescriptor.openings[' + index + '].center 必须是两个有限数值');
    }
  });
}

function createBoxGeometry({ THREE, node, width, height, depth, segments, descriptor }) {
  const openings = Array.isArray(descriptor.openings) ? descriptor.openings : [];
  if (!openings.length) return new THREE.BoxGeometry(width, height, depth);
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -height / 2);
  shape.lineTo(width / 2, -height / 2);
  shape.lineTo(width / 2, height / 2);
  shape.lineTo(-width / 2, height / 2);
  shape.closePath();
  for (const opening of openings) {
    const openingWidth = boundedNumber(opening.width, 0, 0.02, width, node.id + '.opening.width');
    const openingHeight = boundedNumber(opening.height, 0, 0.02, height, node.id + '.opening.height');
    const centerX = boundedNumber(opening.center?.[0], 0, -width / 2, width / 2, node.id + '.opening.centerX');
    const centerY = boundedNumber(opening.center?.[1], 0, -height / 2, height / 2, node.id + '.opening.centerY');
    if (Math.abs(centerX) + openingWidth / 2 > width / 2 + 0.0001
      || Math.abs(centerY) + openingHeight / 2 > height / 2 + 0.0001) {
      throw new RangeError(node.id + '.opening 超出目标 Mesh 边界');
    }
    const hole = new THREE.Path();
    hole.moveTo(centerX - openingWidth / 2, centerY - openingHeight / 2);
    hole.lineTo(centerX - openingWidth / 2, centerY + openingHeight / 2);
    hole.lineTo(centerX + openingWidth / 2, centerY + openingHeight / 2);
    hole.lineTo(centerX + openingWidth / 2, centerY - openingHeight / 2);
    hole.closePath();
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: segments });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function createCylinderGeometry({ THREE, width, height, depth, segments }) {
  return new THREE.CylinderGeometry(width / 2, depth / 2, height, segments);
}

function createConeGeometry({ THREE, width, height, depth, segments }) {
  return new THREE.ConeGeometry(Math.max(width, depth) / 2, height, segments);
}

function createSphereGeometry({ THREE, width, height, depth, segments }) {
  const geometry = new THREE.SphereGeometry(0.5, segments, Math.max(4, Math.floor(segments * 0.66)));
  geometry.scale(width, height, depth);
  return geometry;
}

function createTorusGeometry({ THREE, node, width, height, depth, segments, descriptor }) {
  const radius = Math.max(width, depth) / 2;
  const tube = boundedNumber(
    descriptor.tube,
    Math.min(width, depth) * 0.12,
    0.01,
    radius * 0.45,
    node.id + '.tube',
  );
  return new THREE.TorusGeometry(radius - tube, tube, Math.min(16, segments), segments);
}

function validatePolygonGeometryDescriptor({ node, descriptor }) {
  const points = descriptor.points;
  if (!Array.isArray(points) || points.length < 3 || points.length > 32) {
    throw new RangeError(node.id + '.points 必须包含 3 到 32 个轮廓点');
  }
  const normalized = points.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 2
      || point.some(value => !Number.isFinite(Number(value)) || Number(value) < -0.5 || Number(value) > 0.5)) {
      throw new TypeError(node.id + '.points[' + index + '] 必须是 [-0.5,0.5] 范围内的二维坐标');
    }
    return [Number(point[0]), Number(point[1])];
  });
  validateSimpleProfile(normalized, node.id + '.points');
}

function validateArchGeometryDescriptor({ node, width, height, descriptor }) {
  boundedNumber(descriptor.inset, Math.min(width, height) * 0.12, 0.02, Math.min(width, height) * 0.4, node.id + '.inset');
}

function createWedgeGeometry({ THREE, width, height, depth, segments }) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -height / 2);
  shape.lineTo(width / 2, -height / 2);
  shape.lineTo(0, height / 2);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: segments });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function createArchGeometry({ THREE, node, width, height, depth, segments, descriptor }) {
  const shape = new THREE.Shape();
  const spring = height * 0.08;
  shape.moveTo(-width / 2, -height / 2);
  shape.lineTo(-width / 2, spring);
  shape.quadraticCurveTo(-width / 2, height / 2, 0, height / 2);
  shape.quadraticCurveTo(width / 2, height / 2, width / 2, spring);
  shape.lineTo(width / 2, -height / 2);
  shape.closePath();
  const inset = boundedNumber(descriptor.inset, Math.min(width, height) * 0.12, 0.02, Math.min(width, height) * 0.4, node.id + '.inset');
  const opening = new THREE.Path();
  opening.moveTo(-width / 2 + inset, -height / 2);
  opening.lineTo(-width / 2 + inset, spring);
  opening.quadraticCurveTo(-width / 2 + inset, height / 2 - inset, 0, height / 2 - inset);
  opening.quadraticCurveTo(width / 2 - inset, height / 2 - inset, width / 2 - inset, spring);
  opening.lineTo(width / 2 - inset, -height / 2);
  opening.closePath();
  shape.holes.push(opening);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: segments });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function validateRuntimeGeometryDescriptor({ node }) {
  const runtimeNode = { ...node };
  delete runtimeNode.parent;
  validateObjectModelSpecV3({ schemaVersion: '3.0', componentTree: [runtimeNode] });
}

function createTubeGeometry({ THREE, node, width, height, depth, descriptor }) {
    const points = descriptor.path;
    if (!Array.isArray(points) || points.length < 2 || points.length > 32) {
      throw new RangeError(node.id + '.geometryDescriptor.path 必须包含 2 到 32 个路径点');
    }
    const vectors = points.map((point, index) => {
      if (!Array.isArray(point) || point.length !== 3
        || point.some(value => !Number.isFinite(Number(value)) || Number(value) < -0.5 || Number(value) > 0.5)) {
        throw new TypeError(node.id + '.geometryDescriptor.path[' + index + '] 必须是 [-0.5,0.5] 范围内的三维坐标');
      }
      return new THREE.Vector3(Number(point[0]) * width, Number(point[1]) * height, Number(point[2]) * depth);
    });
    const radius = boundedNumber(descriptor.radius, 0.08, 0.01, 10, node.id + '.geometryDescriptor.radius');
    const tubularSegments = Math.round(boundedNumber(descriptor.tubularSegments, 32, 3, 128, node.id + '.geometryDescriptor.tubularSegments'));
    const radialSegments = Math.round(boundedNumber(descriptor.radialSegments, 8, 3, 24, node.id + '.geometryDescriptor.radialSegments'));
    const curve = new THREE.CatmullRomCurve3(vectors, descriptor.closed === true, 'centripetal');
    return new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, descriptor.closed === true);
  
}

function createSweepGeometry({ THREE, node, width, height, depth, descriptor }) {
    const path = descriptor.path;
    const profile = descriptor.profile;
    if (!Array.isArray(path) || path.length < 2 || path.length > 32) {
      throw new RangeError(node.id + '.geometryDescriptor.path 必须包含 2 到 32 个路径点');
    }
    const pathPoints = path.map((point, index) => {
      if (!Array.isArray(point) || point.length !== 3
        || point.some(value => !Number.isFinite(Number(value)) || Number(value) < -0.5 || Number(value) > 0.5)) {
        throw new TypeError(node.id + '.geometryDescriptor.path[' + index + '] 必须是 [-0.5,0.5] 范围内的三维坐标');
      }
      return new THREE.Vector3(Number(point[0]) * width, Number(point[1]) * height, Number(point[2]) * depth);
    });
    if (pathPoints.every((point, index) => index === 0 || point.distanceTo(pathPoints[index - 1]) < 0.0001)) {
      throw new RangeError(node.id + '.geometryDescriptor.path 不能全部重合');
    }
    if (!Array.isArray(profile) || profile.length < 3 || profile.length > 24) {
      throw new RangeError(node.id + '.geometryDescriptor.profile 必须包含 3 到 24 个截面轮廓点');
    }
    if (pathPoints.some((point, index) => index > 0 && point.distanceTo(pathPoints[index - 1]) < 0.0001)) {
      throw new RangeError(node.id + '.geometryDescriptor.path 存在重复或零长度路径段');
    }
    validateSweepPathCurvature(pathPoints, node.id + '.geometryDescriptor.path');
    const profilePoints = profile.map((point, index) => {
      if (!Array.isArray(point) || point.length !== 2
        || point.some(value => !Number.isFinite(Number(value)) || Number(value) < -0.5 || Number(value) > 0.5)) {
        throw new TypeError(node.id + '.geometryDescriptor.profile[' + index + '] 必须是 [-0.5,0.5] 范围内的二维坐标');
      }
      return [Number(point[0]) * width, Number(point[1]) * height];
    });
    validateSimpleProfile(profilePoints, node.id + '.geometryDescriptor.profile');
    const curve = new THREE.CatmullRomCurve3(pathPoints, descriptor.closed === true, 'centripetal');
    const steps = Math.round(boundedNumber(descriptor.steps, 32, 3, 128, node.id + '.geometryDescriptor.steps'));
    return validateGeneratedGeometry(
      createParallelTransportSweepGeometry(THREE, curve, profilePoints, steps, node.id + '.sweep'),
      node.id + '.sweep',
    );
  
}

function createLoftGeometry({ THREE, node, width, height, depth, descriptor }) {
    const sections = descriptor.sections;
    if (!Array.isArray(sections) || sections.length < 2 || sections.length > 12) {
      throw new RangeError(node.id + '.geometryDescriptor.sections 必须包含 2 到 12 个截面');
    }
    let profileCount = null;
    const normalizedSections = sections.map((section, sectionIndex) => {
      if (!section || typeof section !== 'object' || !Number.isFinite(Number(section.height))
        || Number(section.height) < -0.5 || Number(section.height) > 0.5
        || !Array.isArray(section.points) || section.points.length < 3 || section.points.length > 24) {
        throw new TypeError(node.id + '.geometryDescriptor.sections[' + sectionIndex + '] 格式无效');
      }
      if (profileCount === null) profileCount = section.points.length;
      if (section.points.length !== profileCount) {
        throw new RangeError(node.id + '.geometryDescriptor.sections 必须具有相同数量的轮廓点');
      }
      const points = section.points.map((point, pointIndex) => {
        if (!Array.isArray(point) || point.length !== 2
          || point.some(value => !Number.isFinite(Number(value)) || Number(value) < -0.5 || Number(value) > 0.5)) {
          throw new TypeError(node.id + '.geometryDescriptor.sections[' + sectionIndex + '].points[' + pointIndex + '] 坐标无效');
        }
        return new THREE.Vector2(Number(point[0]) * width, Number(point[1]) * depth);
      });
      return { height: Number(section.height) * height, points };
    });
    for (let index = 1; index < normalizedSections.length; index += 1) {
      if (normalizedSections[index].height <= normalizedSections[index - 1].height + 0.0001) {
        throw new RangeError(node.id + '.geometryDescriptor.sections 的 height 必须严格递增');
      }
    }
    let contourOrientation = 0;
    normalizedSections.forEach((section, index) => {
      const profile = section.points.map(point => [point.x, point.y]);
      validateSimpleProfile(profile, node.id + '.geometryDescriptor.sections[' + index + ']');
      const signedArea = profile.reduce((sum, point, pointIndex) => {
        const next = profile[(pointIndex + 1) % profile.length];
        return sum + point[0] * next[1] - next[0] * point[1];
      }, 0);
      const orientation = Math.sign(signedArea);
      if (contourOrientation && orientation !== contourOrientation) {
        throw new RangeError(node.id + '.geometryDescriptor.sections 必须保持一致的轮廓绕序');
      }
      contourOrientation = orientation;
    });
    // Normalize every ring together so corresponding vertices retain the same topology.
    if (contourOrientation < 0) normalizedSections.forEach(section => section.points.reverse());
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const indices = [];
    const ringSize = profileCount;

    // Each profile edge owns its side vertices. This keeps adjacent walls
    // from averaging normals across hard corners while preserving smoothing
    // along the loft direction between matching sections.
    normalizedSections.forEach(section => {
      for (let edgeIndex = 0; edgeIndex < ringSize; edgeIndex += 1) {
        const a = section.points[edgeIndex];
        const b = section.points[(edgeIndex + 1) % ringSize];
        positions.push(a.x, section.height, a.y, b.x, section.height, b.y);
      }
    });
    for (let sectionIndex = 0; sectionIndex < normalizedSections.length - 1; sectionIndex += 1) {
      const lower = sectionIndex * ringSize * 2;
      const upper = (sectionIndex + 1) * ringSize * 2;
      for (let edgeIndex = 0; edgeIndex < ringSize; edgeIndex += 1) {
        const a = lower + edgeIndex * 2;
        const b = a + 1;
        const c = upper + edgeIndex * 2;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    // Caps use independent vertices so their vertical normals do not blend
    // into the side-wall normals at the perimeter.
    const bottomCapOffset = positions.length / 3;
    normalizedSections[0].points.forEach(point => positions.push(point.x, normalizedSections[0].height, point.y));
    const topSection = normalizedSections[normalizedSections.length - 1];
    const topCapOffset = positions.length / 3;
    topSection.points.forEach(point => positions.push(point.x, topSection.height, point.y));
    const capTriangles = THREE.ShapeUtils.triangulateShape(normalizedSections[0].points, []);
    // The normalized X/Z contour is CCW: its natural 3D normal points down (-Y).
    capTriangles.forEach(triangle => indices.push(bottomCapOffset + triangle[0], bottomCapOffset + triangle[1], bottomCapOffset + triangle[2]));
    capTriangles.forEach(triangle => indices.push(topCapOffset + triangle[2], topCapOffset + triangle[1], topCapOffset + triangle[0]));
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return validateGeneratedGeometry(geometry, node.id + '.loft');
  
}

function createLatheGeometry({ THREE, node, width, height, depth, segments, descriptor }) {
      const profile = descriptor.profile;
      if (!Array.isArray(profile) || profile.length < 2 || profile.length > 32) {
        throw new RangeError(node.id + '.geometryDescriptor.profile 必须包含 2 到 32 个旋转截面点');
      }
      const points = profile.map((point, index) => {
        if (!Array.isArray(point) || point.length !== 2
          || !Number.isFinite(Number(point[0])) || Number(point[0]) < 0 || Number(point[0]) > 0.5
          || !Number.isFinite(Number(point[1])) || Number(point[1]) < -0.5 || Number(point[1]) > 0.5) {
          throw new TypeError(node.id + '.geometryDescriptor.profile[' + index + '] 必须是 [0,0.5] 半径与 [-0.5,0.5] 高度');
        }
        return new THREE.Vector2(Number(point[0]) * width, Number(point[1]) * height);
      });
      if (points.every((point, index) => index === 0 || point.distanceTo(points[index - 1]) < 0.0001)) {
        throw new RangeError(node.id + '.geometryDescriptor.profile 不能是重复点');
      }
      const geometry = new THREE.LatheGeometry(points, segments);
      geometry.scale(1, 1, depth / width);
      return geometry;
    
}

const noopGeometryDescriptorValidator = () => {};

const runtimeGeometryCapabilities = createGeometryCapabilityRegistry([
  { primitive: 'box', descriptor: 'optional', validateDescriptor: validateBoxGeometryDescriptor, createGeometry: createBoxGeometry },
  { primitive: 'cuboid', descriptor: 'optional', validateDescriptor: validateBoxGeometryDescriptor, createGeometry: createBoxGeometry },
  { primitive: 'polygon', descriptor: 'points', validateDescriptor: validatePolygonGeometryDescriptor, createGeometry: ({ THREE, descriptor, width, height, depth, segments }) => createPolygonOutlineGeometry(THREE, descriptor.points, width, height, depth, segments) },
  { primitive: 'wedge', descriptor: 'optional', validateDescriptor: noopGeometryDescriptorValidator, createGeometry: createWedgeGeometry },
  { primitive: 'arch', descriptor: 'optional', validateDescriptor: validateArchGeometryDescriptor, createGeometry: createArchGeometry },
  { primitive: 'cylinder', descriptor: 'optional', validateDescriptor: noopGeometryDescriptorValidator, createGeometry: createCylinderGeometry },
  { primitive: 'cone', descriptor: 'optional', validateDescriptor: noopGeometryDescriptorValidator, createGeometry: createConeGeometry },
  { primitive: 'sphere', descriptor: 'optional', validateDescriptor: noopGeometryDescriptorValidator, createGeometry: createSphereGeometry },
  { primitive: 'ellipsoid', descriptor: 'optional', validateDescriptor: noopGeometryDescriptorValidator, createGeometry: createSphereGeometry },
  { primitive: 'torus', descriptor: 'optional', validateDescriptor: noopGeometryDescriptorValidator, createGeometry: createTorusGeometry },
  { primitive: 'tube', descriptor: 'path-radius', validateDescriptor: validateRuntimeGeometryDescriptor, createGeometry: createTubeGeometry },
  { primitive: 'sweep', descriptor: 'path-profile', validateDescriptor: validateRuntimeGeometryDescriptor, createGeometry: createSweepGeometry },
  { primitive: 'loft', descriptor: 'sections', validateDescriptor: validateRuntimeGeometryDescriptor, createGeometry: createLoftGeometry },
  { primitive: 'lathe', descriptor: 'profile', validateDescriptor: validateRuntimeGeometryDescriptor, createGeometry: createLatheGeometry },
], getObjectModelGeometryCapability);

export function auditObjectModelGeometryCapabilityCoverage() {
  const protocolCapabilities = Object.entries(OBJECT_MODEL_GEOMETRY_CAPABILITIES).map(([primitive, capability]) => ({
    id: capability.id,
    primitive,
    descriptor: capability.descriptor,
  }));
  return auditGeometryCapabilityCoverage(protocolCapabilities, runtimeGeometryCapabilities.list());
}

function createGeometry(THREE, node) {
  if (node.geometry?.type === 'indexed-mesh') {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(node.geometry.positions, 3));
    geometry.setIndex(node.geometry.indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
  if (!getObjectModelGeometryCapability(node.primitive)) {
    throw new TypeError('不支持的重建几何 primitive：' + node.primitive);
  }
  const dimensions = node.dimensions || {};
  const width = boundedNumber(dimensions.width, 1, 0.02, MAX_DIMENSION, node.id + '.width');
  const height = boundedNumber(dimensions.height, 1, 0.02, MAX_DIMENSION, node.id + '.height');
  const depth = boundedNumber(dimensions.depth, 1, 0.02, MAX_DIMENSION, node.id + '.depth');
  const descriptor = node.geometryDescriptor || {};
  const segments = Math.round(boundedNumber(descriptor.segments, 16, 3, MAX_SEGMENTS, node.id + '.segments'));
  return runtimeGeometryCapabilities.create(node.primitive, { THREE, node, width, height, depth, segments, descriptor });
}

/**
 * Validate the transferable, renderer-independent subset of ObjectSculptSpec.
 * The upstream spec may contain richer fields; this adapter intentionally consumes only
 * a bounded subset and preserves the original spec outside the runtime object.
 */
export function resolveEditableParameterTarget(node, materials, property) {
  const resolved = resolveObjectModelParameterTarget(node, materials, normalizeObjectModelMaterialParameterProperty(property));
  return resolved ? { value: resolved.value, kind: resolved.kind } : null;
}

function setEditableParameterTarget(node, materials, property, value) {
  const parts = property.split('.');
  if (parts[0] === 'material') {
    const material = materials[node.material];
    material[parts[1]] = value;
    return;
  }
  if (parts[0] === 'transform') {
    const index = 'xyz'.indexOf(parts[2]);
    node.transform = node.transform || {};
    node.transform[parts[1]] = node.transform[parts[1]] || (parts[1] === 'scale' ? [1,1,1] : [0,0,0]);
    node.transform[parts[1]][index] = value;
    return;
  }
  let target = node[parts[0]];
  for (const part of parts.slice(1, -1)) target = target[part];
  target[parts[parts.length - 1]] = value;
}

function applyObjectModelParameterValues(input) {
  const spec = JSON.parse(JSON.stringify(input));
  for (const parameter of spec.parameterSchema || []) {
    for (const target of parameter.targets || []) {
      const node = spec.componentTree.find(item => item.id === target.nodeId);
      if (!node) throw new TypeError('参数目标组件不存在：' + target.nodeId);
      const binding = resolveEditableParameterTarget(node, spec.materials || {}, target.property);
      if (!binding) throw new TypeError('参数目标属性不存在或不可编辑：' + target.property);
      const mode = target.mode || 'set';
      const resolved = mode === 'multiply' ? Number(binding.value) * Number(parameter.value)
        : mode === 'add' ? Number(binding.value) + Number(parameter.value) : parameter.value;
      if (target.property === 'visibility.visible') {
        const threshold = Number(target.threshold ?? 1);
        node.hidden = mode === 'visible-from' ? Number(parameter.value) < threshold
          : mode === 'visible-through' ? Number(parameter.value) > threshold
            : !Boolean(parameter.value);
      } else if (target.property === 'geometry.primitive') {
        if (!getObjectModelGeometryCapability(resolved)) {
          throw new TypeError('参数指定了不支持的几何类型');
        }
        node.primitive = resolved;
      } else if (target.property.startsWith('material.')) {
        const previousMaterial = spec.materials[node.material] || DEFAULT_MATERIAL;
        const uniqueKey = 'parameter-' + node.id;
        if (node.material !== uniqueKey) spec.materials[uniqueKey] = { ...previousMaterial };
        node.material = uniqueKey;
        setEditableParameterTarget(node, spec.materials, target.property, resolved);
      } else {
        setEditableParameterTarget(node, spec.materials || {}, target.property, resolved);
      }
    }
  }
  return spec;
}

export function validateObjectSculptSpec(spec) {
  const validation = validateObjectModelSpecV3(spec, { mode: 'compiled' });
  // These are executor resource-safety limits, not protocol schema rules.
  for (const node of spec.componentTree) {
    const scale = finiteVector(node.transform?.scale, [1, 1, 1], node.id + '.scale');
    if (scale.some(value => Math.abs(value) < 0.001 || Math.abs(value) > 20)) {
      throw new RangeError(node.id + '.scale 超出允许范围');
    }
  }
  return validation;
}

/**
 * Build one component's Three.js Group without attaching it to a parent.
 * Full-model construction and incremental edits share this exact component
 * runtime path so geometry, material, metadata and transform behavior cannot drift.
 */
export function createObjectSculptComponentGroup(THREE, node, materialSpecs = {}) {
  const group = new THREE.Group();
  let pendingGeometry = null;
  let pendingMaterial = null;
  try {
    group.name = String(node.name || node.id).slice(0, 120);
    group.userData.componentId = node.id;
    group.userData.componentSourceId = node.operationInstance?.sourceNodeId || node.id;
    group.userData.componentRole = String(node.role || 'component').slice(0, 80);
    group.userData.componentRelations = Array.isArray(node.relations) ? JSON.parse(JSON.stringify(node.relations)) : [];
    group.userData.componentHidden = node.hidden === true;
    group.userData.componentLocked = node.locked === true;
    group.visible = node.hidden !== true;
    if ((node.kind || 'mesh') === 'mesh' && !node.structuralCutter) {
      pendingGeometry = createGeometry(THREE, node);
      const materialKey = typeof node.material === 'string' ? node.material : 'default';
      pendingMaterial = normalizeMaterial(THREE,
        Object.prototype.hasOwnProperty.call(materialSpecs, materialKey) ? materialSpecs[materialKey] : DEFAULT_MATERIAL);
      const mesh = new THREE.Mesh(pendingGeometry, pendingMaterial);
      mesh.name = node.id + ':mesh';
      mesh.userData.componentId = node.id;
      mesh.userData.componentSourceId = node.operationInstance?.sourceNodeId || node.id;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      // The group now owns these resources and its disposer will release them.
      pendingGeometry = null;
      pendingMaterial = null;
    }
    group.userData.componentKind = node.kind || 'mesh';
    const [px, py, pz] = finiteVector(node.transform?.position, [0, 0, 0], node.id + '.position');
    const [rx, ry, rz] = finiteVector(node.transform?.rotation, [0, 0, 0], node.id + '.rotation');
    const [sx, sy, sz] = finiteVector(node.transform?.scale, [1, 1, 1], node.id + '.scale');
    if ([sx, sy, sz].some(value => Math.abs(value) < 0.001 || Math.abs(value) > 20)) {
      throw new RangeError(node.id + '.scale 超出允许范围');
    }
    group.position.set(px, py, pz);
    group.rotation.set(rx, ry, rz);
    group.scale.set(sx, sy, sz);
    return group;
  } catch (error) {
    // Resources created before Mesh attachment are not reachable by traversal.
    pendingGeometry?.dispose();
    pendingMaterial?.dispose();
    // Release resources already attached to this incomplete group.
    disposeComponentGroup(group);
    throw error;
  }
}

/**
 * Build a real THREE.Group from a validated component tree.
 * Material keys resolve through spec.materials; missing keys use a neutral fallback.
 */
export function createObjectSculptModel(THREE, spec, options = {}) {
  if (!THREE?.Group || !THREE?.Mesh || !THREE?.MeshStandardMaterial) {
    throw new TypeError('Three.js runtime is required');
  }
  // Normalize supported legacy material aliases on a copy before validation
  // and execution. The caller's persisted object is never mutated.
  const compatibleSpec = {
    ...spec,
    parameterSchema: normalizeObjectModelMaterialParameterAliases(spec.parameterSchema),
  };
  validateObjectModelSpecV3(compatibleSpec);
  // 3.0 is the canonical declarative protocol. Compile it into the bounded
  // component-tree execution form only at the runtime adapter boundary.
  const parameterizedSpec = applyObjectModelParameterValues(compatibleSpec);
  const effectiveSpec = compileObjectModelSpec(parameterizedSpec);
  validateObjectSculptSpec(effectiveSpec);
  const renderSpec = effectiveSpec;
  const validation = validateObjectSculptSpec(renderSpec);
  const root = new THREE.Group();
  root.name = String(effectiveSpec.targetName || effectiveSpec.name || 'reconstructed-object').slice(0, 120);
  const groups = new Map();
  const materialSpecs = renderSpec.materials && typeof renderSpec.materials === 'object' ? renderSpec.materials : {};
  const ordered = [...renderSpec.componentTree].sort((a, b) => {
    const depth = node => {
      let value = 0, parent = node.parent;
      while (parent) { value += 1; parent = validation.nodes.get(parent)?.parent; }
      return value;
    };
    return depth(a) - depth(b);
  });
  for (const node of ordered) {
    const group = createObjectSculptComponentGroup(THREE, node, materialSpecs);
    const parent = node.parent ? groups.get(node.parent) : root;
    if (!parent) throw new TypeError('组件父节点尚未构建：' + node.id);
    parent.add(group);
    groups.set(node.id, group);
  }
  root.userData.componentGroups = groups;
  root.userData.renderObjectSculptSpec = JSON.parse(JSON.stringify(renderSpec));
  // Keep the editable declarative state separate from the immutable baseline.
  // The public spec reflects parameter values applied to component data; the
  // baseline retains original component data so subsequent edits never drift.
  root.userData.objectSculptSpec = JSON.parse(JSON.stringify(parameterizedSpec));
  root.userData.parameterBaseSpec = JSON.parse(JSON.stringify(compatibleSpec));
  root.userData.objectSculpt = {
    schemaVersion: spec.schemaVersion,
    targetName: root.name,
    componentCount: validation.componentCount,
    source: options.source || 'object-sculpt-spec',
  };
  return root;
}


/**
 * Apply one AI-declared parameter through a bounded property binding list.
 * Every edit starts from the immutable baseline spec to avoid cumulative drift.
 */
/**
 * Apply a server-validated indexed-mesh vertex ChangeSet result in place.
 * Only listed vertex positions are written; component groups and Mesh objects
 * remain stable, while normals and spatial bounds are refreshed for that mesh.
 */
/** Apply declarative changes and retain all unchanged component Group references. */
export function applyObjectSculptComponentChanges(THREE, root, nextSpecInput, changeSetResult = null) {
  if (!root?.userData?.componentGroups || !root.userData?.parameterBaseSpec || !root.userData?.renderObjectSculptSpec) throw new TypeError('目标不是支持组件级增量编辑的 ObjectModelSpec 3.0 资产');
  if (!THREE?.Group || !THREE?.Mesh || !THREE?.MeshStandardMaterial) throw new TypeError('Three.js runtime is required');
  if (changeSetResult && (!changeSetResult.objectModelSpec
    || stableObjectJson(changeSetResult.objectModelSpec) !== stableObjectJson(nextSpecInput)
    || !Array.isArray(changeSetResult.changes)
    || !Array.isArray(changeSetResult.affectedNodeIds)
    || !Array.isArray(changeSetResult.affectedMaterialIds))) {
    throw new TypeError('服务端结构 ChangeSet 与模型结果不一致');
  }
  const affectedMaterialIds = new Set(changeSetResult?.affectedMaterialIds || []);
  const candidate = JSON.parse(JSON.stringify(changeSetResult?.objectModelSpec || nextSpecInput));
  const compatibleSpec = { ...candidate, parameterSchema: normalizeObjectModelMaterialParameterAliases(candidate.parameterSchema) };
  // Compare uncompiled Specs: the render snapshot may contain parameterized/expanded data.
  // A parent-only replace is a hierarchy move, not a geometry replacement.
  const replacedNodeIds = new Set((changeSetResult?.changes || [])
    .filter(change => change?.type === 'replace-component' && typeof change.nodeId === 'string')
    .filter(change => {
      const before = root.userData.parameterBaseSpec.componentTree.find(node => node.id === change.nodeId);
      const after = compatibleSpec.componentTree.find(node => node.id === change.nodeId);
      if (!before || !after) return false;
      const { parent: beforeParent, ...beforeContent } = before;
      const { parent: afterParent, ...afterContent } = after;
      return stableObjectJson(beforeContent) !== stableObjectJson(afterContent);
    })
    .map(change => change.nodeId));
  validateObjectModelSpecV3(compatibleSpec);
  const parameterizedSpec = applyObjectModelParameterValues(compatibleSpec);
  const renderSpec = compileObjectModelSpec(parameterizedSpec);
  const validation = validateObjectSculptSpec(renderSpec);
  const previousRenderSpec = root.userData.renderObjectSculptSpec, previousGroups = root.userData.componentGroups;
  const previousNodes = new Map(previousRenderSpec.componentTree.map(node => [node.id, node]));
  const nextNodes = new Map(renderSpec.componentTree.map(node => [node.id, node]));
  const oldMaterials = previousRenderSpec.materials || {}, nextMaterials = renderSpec.materials || {};
  const nextGroups = new Map(), createdGroups = [];
  try {
    for (const node of renderSpec.componentTree) {
      const oldNode = previousNodes.get(node.id), oldGroup = previousGroups.get(node.id);
      if (!oldNode || !oldGroup) { const group = createObjectSculptComponentGroup(THREE,node,nextMaterials); nextGroups.set(node.id,group); createdGroups.push(group); continue; }
      const oldKey = typeof oldNode.material === 'string' ? oldNode.material : 'default';
      const newKey = typeof node.material === 'string' ? node.material : 'default';
      const { parent: oldParent, ...oldContent } = oldNode;
      const { parent: newParent, ...newContent } = node;
      const unchanged = !replacedNodeIds.has(node.id)
        && !affectedMaterialIds.has(oldKey) && !affectedMaterialIds.has(newKey)
        && stableObjectJson(oldContent) === stableObjectJson(newContent)
        && stableObjectJson(oldMaterials[oldKey] || DEFAULT_MATERIAL) === stableObjectJson(nextMaterials[newKey] || DEFAULT_MATERIAL);
      if (unchanged) nextGroups.set(node.id,oldGroup);
      else { const group = createObjectSculptComponentGroup(THREE,node,nextMaterials); nextGroups.set(node.id,group); createdGroups.push(group); }
    }
  } catch(error) { createdGroups.forEach(disposeComponentGroup); throw error; }
  for (const group of previousGroups.values()) group.parent?.remove(group);
  const retainedGroups = new Set(nextGroups.values());
  for (const group of previousGroups.values()) if (!retainedGroups.has(group)) disposeComponentGroup(group);
  const depthOf = node => { let depth=0, parent=node.parent; while(parent){depth+=1;parent=nextNodes.get(parent)?.parent;} return depth; };
  for (const node of [...renderSpec.componentTree].sort((a,b)=>depthOf(a)-depthOf(b))) {
    const parent = node.parent ? nextGroups.get(node.parent) : root;
    if (!parent) throw new TypeError('组件父节点尚未构建：'+node.id);
    parent.add(nextGroups.get(node.id));
  }
  root.name=String(renderSpec.targetName||renderSpec.name||root.name).slice(0,120);
  root.userData.componentGroups=nextGroups;
  root.userData.renderObjectSculptSpec=JSON.parse(JSON.stringify(renderSpec));
  root.userData.objectSculptSpec=JSON.parse(JSON.stringify(parameterizedSpec));
  root.userData.parameterBaseSpec=JSON.parse(JSON.stringify(compatibleSpec));
  root.userData.objectSculpt={...root.userData.objectSculpt,schemaVersion:compatibleSpec.schemaVersion,targetName:root.name,componentCount:validation.componentCount};
  return root.userData.objectSculptSpec;
}
export function applyObjectSculptMeshVertexUpdates(THREE, root, changeSetResult) {
  if (!root?.userData?.componentGroups || !root.userData?.parameterBaseSpec) {
    throw new TypeError('目标不是可编辑的 ObjectModelSpec 3.0 资产');
  }
  if (!changeSetResult || !changeSetResult.objectModelSpec
    || !Array.isArray(changeSetResult.geometryVertexUpdates)
    || changeSetResult.geometryVertexUpdates.length < 1) {
    throw new TypeError('ChangeSet 结果缺少有效的几何顶点更新');
  }
  const candidate = JSON.parse(JSON.stringify(changeSetResult.objectModelSpec));
  validateObjectModelSpecV3(candidate);
  const prepared = changeSetResult.geometryVertexUpdates.map(change => {
    if (!change || typeof change.nodeId !== 'string' || !Array.isArray(change.updates) || !change.updates.length) {
      throw new TypeError('几何顶点更新记录格式无效');
    }
    const node = candidate.componentTree.find(item => item.id === change.nodeId);
    const group = root.userData.componentGroups.get(change.nodeId);
    const mesh = group?.getObjectByName(change.nodeId + ':mesh');
    const position = mesh?.geometry?.getAttribute?.('position');
    const index = mesh?.geometry?.getIndex?.();
    if (!node || node.geometry?.type !== 'indexed-mesh' || !position || !index
      || position.count !== node.geometry.positions.length / 3
      || index.count !== node.geometry.indices.length) {
      throw new TypeError('目标组件运行时网格与 ChangeSet 结果不一致：' + change.nodeId);
    }
    for (let offset = 0; offset < index.count; offset += 1) {
      if (index.getX(offset) !== node.geometry.indices[offset]) {
        throw new TypeError('目标组件拓扑已变化，不能应用顶点局部更新：' + change.nodeId);
      }
    }
    const vertexIndices = new Set();
    for (const update of change.updates) {
      if (!update || !Number.isInteger(update.index) || update.index < 0 || update.index >= position.count
        || vertexIndices.has(update.index)) {
        throw new TypeError('顶点局部更新索引无效或重复：' + change.nodeId);
      }
      vertexIndices.add(update.index);
      const offset = update.index * 3;
      const expected = node.geometry.positions.slice(offset, offset + 3);
      if (!Array.isArray(update.position) || update.position.length !== 3
        || update.position.some((value, axis) => !Number.isFinite(value) || value !== expected[axis])) {
        throw new TypeError('顶点局部更新坐标与 ChangeSet 结果不一致：' + change.nodeId);
      }
    }
    return { nodeId: change.nodeId, node, mesh, position, vertexIndices };
  });

  for (const item of prepared) {
    for (const vertexIndex of item.vertexIndices) {
      const offset = vertexIndex * 3;
      item.position.setXYZ(
        vertexIndex,
        item.node.geometry.positions[offset],
        item.node.geometry.positions[offset + 1],
        item.node.geometry.positions[offset + 2],
      );
    }
    item.position.needsUpdate = true;
    item.mesh.geometry.computeVertexNormals();
    item.mesh.geometry.computeBoundingBox();
    item.mesh.geometry.computeBoundingSphere();
  }
  root.userData.objectSculptSpec = candidate;
  root.userData.parameterBaseSpec = JSON.parse(JSON.stringify(candidate));
  root.userData.renderObjectSculptSpec = JSON.parse(JSON.stringify(compileObjectModelSpec(applyObjectModelParameterValues({ ...candidate, parameterSchema: normalizeObjectModelMaterialParameterAliases(candidate.parameterSchema) }))));
  return root.userData.objectSculptSpec;
}

export function applyObjectSculptParameter(THREE, root, parameterId, nextValue) {
  if (!root?.userData?.parameterBaseSpec || !root.userData?.componentGroups) throw new TypeError('目标不是可编辑的 ObjectModelSpec 3.0 资产');
  const baseline=root.userData.parameterBaseSpec, parameter=(baseline.parameterSchema||[]).find(item=>item.id===parameterId);
  if(!parameter)throw new TypeError('未声明可编辑参数：'+parameterId);
  let value=nextValue;
  if(parameter.type==='number'){value=Number(value);if(!Number.isFinite(value)||value<parameter.min||value>parameter.max)throw new RangeError('参数值超出范围：'+parameterId);}
  else if(parameter.type==='color'){if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new TypeError('颜色参数格式无效：'+parameterId);}
  else if(parameter.type==='boolean'){if(typeof value!=='boolean')throw new TypeError('布尔参数格式无效：'+parameterId);}
  else if(parameter.type==='select'&&!parameter.options.some(option=>option.value===value))throw new TypeError('枚举参数值无效：'+parameterId);
  const activeSchema=root.userData.objectSculptSpec?.parameterSchema||baseline.parameterSchema||[],activeValues=new Map(activeSchema.map(item=>[item.id,item.value]));
  activeValues.set(parameterId,value);
  const spec=JSON.parse(JSON.stringify(baseline));
  for(const item of spec.parameterSchema||[])if(activeValues.has(item.id))item.value=activeValues.get(item.id);
  return applyObjectSculptComponentChanges(THREE,root,spec);
}
