import { getObjectModelGeometryCapability, validateObjectModelSpecV3 } from '../../../server/src/shared/object-model-spec-v3.ts';
import { compileObjectModelSpec } from './objectModelSpecV3.js';
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

function createGeometry(THREE, node) {
  if (!getObjectModelGeometryCapability(node.primitive)) {
    throw new TypeError('不支持的重建几何 primitive：' + node.primitive);
  }
  const dimensions = node.dimensions || {};
  const width = boundedNumber(dimensions.width, 1, 0.02, MAX_DIMENSION, node.id + '.width');
  const height = boundedNumber(dimensions.height, 1, 0.02, MAX_DIMENSION, node.id + '.height');
  const depth = boundedNumber(dimensions.depth, 1, 0.02, MAX_DIMENSION, node.id + '.depth');
  const descriptor = node.geometryDescriptor || {};
  const segments = Math.round(boundedNumber(descriptor.segments, 16, 3, MAX_SEGMENTS, node.id + '.segments'));
  if (String(node.primitive || '').toLowerCase() === 'tube') {
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

  if (String(node.primitive || '').toLowerCase() === 'sweep') {
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

  if (String(node.primitive || '').toLowerCase() === 'loft') {
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

  switch (String(node.primitive || 'box').toLowerCase()) {
    case 'polygon': {
      const points = descriptor.points;
      if (!Array.isArray(points) || points.length < 3 || points.length > 32) throw new RangeError(node.id + '.points 必须包含 3 到 32 个轮廓点');
      const normalized = points.map((point, index) => {
        if (!Array.isArray(point) || point.length !== 2 || point.some(value => !Number.isFinite(Number(value)) || Number(value) < -0.5 || Number(value) > 0.5)) {
          throw new TypeError(node.id + '.points[' + index + '] 必须是 [-0.5,0.5] 范围内的二维坐标');
        }
        return [Number(point[0]) * width, Number(point[1]) * height];
      });
      const area = normalized.reduce((sum, point, index) => {
        const next = normalized[(index + 1) % normalized.length];
        return sum + point[0] * next[1] - next[0] * point[1];
      }, 0) / 2;
      if (Math.abs(area) < 0.0001) throw new RangeError(node.id + '.points 轮廓面积不能为零');
      const shape = new THREE.Shape();
      shape.moveTo(normalized[0][0], normalized[0][1]);
      for (const point of normalized.slice(1)) shape.lineTo(point[0], point[1]);
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: segments });
      geometry.translate(0, 0, -depth / 2);
      return geometry;
    }
    case 'wedge': {
      const shape = new THREE.Shape();
      shape.moveTo(-width / 2, -height / 2);
      shape.lineTo(width / 2, -height / 2);
      shape.lineTo(0, height / 2);
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: segments });
      geometry.translate(0, 0, -depth / 2);
      return geometry;
    }
    case 'arch': {
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
    case 'box':
    case 'cuboid': {
      const openings = Array.isArray(descriptor.openings) ? descriptor.openings : [];
      if (!openings.length) return new THREE.BoxGeometry(width, height, depth);
      // 轴对齐盒体沿 Z 轴贯穿的矩形开口：使用真实 ExtrudeGeometry 洞口拓扑。
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
    case 'cylinder':
      return new THREE.CylinderGeometry(width / 2, depth / 2, height, segments);
    case 'cone':
      return new THREE.ConeGeometry(Math.max(width, depth) / 2, height, segments);
    case 'sphere':
    case 'ellipsoid': {
      const geometry = new THREE.SphereGeometry(0.5, segments, Math.max(4, Math.floor(segments * 0.66)));
      geometry.scale(width, height, depth);
      return geometry;
    }
    case 'torus': {
      const radius = Math.max(width, depth) / 2;
      const tube = boundedNumber(descriptor.tube, Math.min(width, depth) * 0.12, 0.01, radius * 0.45, node.id + '.tube');
      return new THREE.TorusGeometry(radius - tube, tube, Math.min(16, segments), segments);
    }
    case 'lathe': {
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
    default:
      throw new TypeError('不支持的重建几何 primitive：' + node.primitive);
  }
}

/**
 * Validate the transferable, renderer-independent subset of ObjectSculptSpec.
 * The upstream spec may contain richer fields; this adapter intentionally consumes only
 * a bounded subset and preserves the original spec outside the runtime object.
 */
export function resolveEditableParameterTarget(node, materials, property) {
  if (!node || typeof property !== 'string' || property.length > 160) return null;
  const parts = property.split('.');
  if (parts.some(part => !/^(?:[a-zA-Z][a-zA-Z0-9_]{0,39}|0|[1-9][0-9]{0,2})$/.test(part) || ['__proto__','prototype','constructor'].includes(part))) return null;
  if (property === 'visibility.visible') return { value: node.hidden !== true, kind: 'boolean' };
  if (property === 'geometry.primitive') return typeof node.primitive === 'string' ? { value: node.primitive, kind: 'select' } : null;
  const root = parts[0];
  if (root === 'material' && parts.length === 2 && typeof node.material === 'string') {
    const material = materials?.[node.material];
    if (!material || !Object.prototype.hasOwnProperty.call(material, parts[1])) return null;
    const value = material[parts[1]];
    if (value === null || typeof value === 'object') return null;
    return { value, kind: typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? 'color' : typeof value };
  }
  if (root === 'transform' && ['position','rotation','scale'].includes(parts[1]) && parts.length === 3 && ['x','y','z'].includes(parts[2])) {
    const index = 'xyz'.indexOf(parts[2]);
    const value = node.transform?.[parts[1]]?.[index] ?? (parts[1] === 'scale' ? 1 : 0);
    return Number.isFinite(Number(value)) ? { value: Number(value), kind: 'number' } : null;
  }
  if (!['dimensions','geometryDescriptor'].includes(root) || parts.length < 2 || parts.length > 4) return null;
  let value = node[root];
  for (const part of parts.slice(1)) {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= value.length || index > 127) return null;
      value = value[index];
    } else {
      if (!Object.prototype.hasOwnProperty.call(value, part)) return null;
      value = value[part];
    }
  }
  if (value === null || typeof value === 'object') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return { value, kind: 'number' };
  if (typeof value === 'boolean') return { value, kind: 'boolean' };
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return { value, kind: 'color' };
  if (typeof value === 'string') return { value, kind: 'select' };
  return null;
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
 * Build a real THREE.Group from a validated component tree.
 * Material keys resolve through spec.materials; missing keys use a neutral fallback.
 */
export function createObjectSculptModel(THREE, spec, options = {}) {
  if (!THREE?.Group || !THREE?.Mesh || !THREE?.MeshStandardMaterial) {
    throw new TypeError('Three.js runtime is required');
  }
  validateObjectModelSpecV3(spec);
  // 3.0 is the canonical declarative protocol. Compile it into the bounded
  // component-tree execution form only at the runtime adapter boundary.
  const parameterizedSpec = applyObjectModelParameterValues(spec);
  const effectiveSpec = compileObjectModelSpec(parameterizedSpec);
  validateObjectSculptSpec(effectiveSpec);
  const renderSpec = effectiveSpec;
  const validation = validateObjectSculptSpec(renderSpec);
  const root = new THREE.Group();
  root.name = String(effectiveSpec.targetName || effectiveSpec.name || 'reconstructed-object').slice(0, 120);
  const groups = new Map();
  const materialSpecs = renderSpec.materials && typeof renderSpec.materials === 'object' ? renderSpec.materials : {};
  const resolveMaterial = key => {
    const materialKey = typeof key === 'string' ? key : 'default';
    return normalizeMaterial(THREE, Object.prototype.hasOwnProperty.call(materialSpecs, materialKey) ? materialSpecs[materialKey] : DEFAULT_MATERIAL);
  };
  const ordered = [...renderSpec.componentTree].sort((a, b) => {
    const depth = node => {
      let value = 0, parent = node.parent;
      while (parent) { value += 1; parent = validation.nodes.get(parent)?.parent; }
      return value;
    };
    return depth(a) - depth(b);
  });
  for (const node of ordered) {
    const group = new THREE.Group();
    group.name = String(node.name || node.id).slice(0, 120);
    group.userData.componentId = node.id;
    group.userData.componentSourceId = node.operationInstance?.sourceNodeId || node.id;
    group.userData.componentRole = String(node.role || 'component').slice(0, 80);
    group.userData.componentRelations = Array.isArray(node.relations) ? JSON.parse(JSON.stringify(node.relations)) : [];
    group.userData.componentHidden = node.hidden === true;
    group.userData.componentLocked = node.locked === true;
    group.visible = node.hidden !== true;
    if ((node.kind || 'mesh') === 'mesh' && !node.structuralCutter) {
      const geometry = createGeometry(THREE, node);
      const mesh = new THREE.Mesh(geometry, resolveMaterial(node.material));
      mesh.name = node.id + ':mesh';
      mesh.userData.componentId = node.id;
      mesh.userData.componentSourceId = node.operationInstance?.sourceNodeId || node.id;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
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
    const parent = node.parent ? groups.get(node.parent) : root;
    if (!parent) throw new TypeError('组件父节点尚未构建：' + node.id);
    parent.add(group);
    groups.set(node.id, group);
  }
  root.userData.componentGroups = groups;
  // Keep the editable declarative state separate from the immutable baseline.
  // The public spec reflects parameter values applied to component data; the
  // baseline retains original component data so subsequent edits never drift.
  root.userData.objectSculptSpec = JSON.parse(JSON.stringify(parameterizedSpec));
  root.userData.parameterBaseSpec = JSON.parse(JSON.stringify(spec));
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
export function applyObjectSculptParameter(THREE, root, parameterId, nextValue) {
  if (!root?.userData?.parameterBaseSpec || !root.userData?.componentGroups) throw new TypeError('目标不是可编辑的 ObjectModelSpec 3.0 资产');
  const baseline = root.userData.parameterBaseSpec;
  const parameter = (baseline.parameterSchema || []).find(item => item.id === parameterId);
  if (!parameter) throw new TypeError('未声明可编辑参数：' + parameterId);
  let value = nextValue;
  if (parameter.type === 'number') {
    value = Number(value);
    if (!Number.isFinite(value) || value < parameter.min || value > parameter.max) throw new RangeError('参数值超出范围：' + parameterId);
  } else if (parameter.type === 'color') {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new TypeError('颜色参数格式无效：' + parameterId);
  } else if (parameter.type === 'boolean') {
    if (typeof value !== 'boolean') throw new TypeError('布尔参数格式无效：' + parameterId);
  } else if (parameter.type === 'select' && !parameter.options.some(option => option.value === value)) {
    throw new TypeError('枚举参数值无效：' + parameterId);
  }
  const activeSchema = root.userData.objectSculptSpec?.parameterSchema || baseline.parameterSchema || [];
  const activeValues = new Map(activeSchema.map(item => [item.id, item.value]));
  activeValues.set(parameterId, value);
  const spec = JSON.parse(JSON.stringify(baseline));
  for (const item of spec.parameterSchema || []) {
    if (activeValues.has(item.id)) item.value = activeValues.get(item.id);
  }
  const rebuilt = createObjectSculptModel(THREE, spec, { source: 'object-model-parameter' });
  for (const child of [...root.children]) {
    root.remove(child);
    child.traverse?.(item => {
      item.geometry?.dispose?.();
      if (Array.isArray(item.material)) item.material.forEach(material => material.dispose?.());
      else item.material?.dispose?.();
    });
  }
  for (const child of [...rebuilt.children]) root.add(child);
  root.userData = {
    ...root.userData,
    ...rebuilt.userData,
    objectSculptSpec: rebuilt.userData.objectSculptSpec,
    parameterBaseSpec: baseline,
  };
  return root.userData.objectSculptSpec;
}
