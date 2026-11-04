/**
 * CampusPlanEditor legacy collections -> canonical GeoJSON FeatureCollection.
 *
 * The editor may keep type-specific arrays as an interaction-friendly working
 * model during migration, but every save/preview boundary can consume this
 * normalized collection. Geometry remains authoritative in each Feature.
 */
const AREA_FEATURE_TYPES = Object.freeze({
  vegetation: 'green',
  water: 'water',
  sports: 'sports',
  plaza: 'plaza',
  parking: 'parking',
});

function cloneCoordinates(points) {
  return points.map(point => [Number(point[0]), Number(point[1])]);
}

function closeRing(points) {
  const ring = cloneCoordinates(points);
  if (ring.length < 3) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  return ring;
}

function createFeature(id, featureType, name, geometry, properties = {}, source = 'manual', qualityStatus = 'unverified') {
  // 置信度与核验状态是两个独立维度，禁止互相覆盖或混用。
  const normalizedQualityStatus = ['verified', 'unverified'].includes(qualityStatus)
    ? qualityStatus
    : 'unverified'
  const confidence = ['low', 'medium', 'high'].includes(properties.confidence)
    ? properties.confidence
    : normalizedQualityStatus === 'verified' ? 'medium' : 'low'
  const verificationStatus = ['verified', 'unverified'].includes(properties.verificationStatus)
    ? properties.verificationStatus
    : normalizedQualityStatus

  return {
    type: 'Feature',
    id: String(id),
    geometry,
    properties: {
      ...properties,
      featureType,
      name: name || '未命名要素',
      source,
      qualityStatus: normalizedQualityStatus,
      confidence,
      verificationStatus,
    },
  };
}

/**
 * Convert current editor document collections into one GeoJSON FeatureCollection.
 * Road width and point-object semantics are stored as properties, not baked
 * into geometry; Polygon rings are closed per GeoJSON.
 */
export function toCampusFeatureCollection(document = {}) {
  const features = [];

  for (const building of document.buildings || []) {
    const footprint = building.footprint || [];
    if (!building.id || footprint.length < 3) continue;
    const { id, footprint: _footprint, rect: _rect, label, template, ...properties } = building;
    features.push(createFeature(
      id,
      'building',
      label || building.name || template,
      { type: 'Polygon', coordinates: [closeRing(footprint)] },
      { ...properties, template: template || null },
      building.source || 'campus-layout',
      building.qualityStatus || 'unverified',
    ));
  }

  for (const road of document.roads || []) {
    if (!road.id || !Array.isArray(road.points) || road.points.length < 2) continue;
    const { id, points, width, name, label, ...properties } = road;
    features.push(createFeature(
      id,
      'road',
      name || label || '校园道路',
      { type: 'LineString', coordinates: cloneCoordinates(points) },
      { ...properties, width: Number(width) > 0 ? Number(width) : 12 },
      road.source || 'campus-layout',
      road.qualityStatus || 'unverified',
    ));
  }

  for (const area of document.areas || []) {
    const footprint = area.footprint || area.polygon || [];
    if (!area.id || footprint.length < 3) continue;
    const { id, footprint: _footprint, polygon: _polygon, rect: _rect, holes, name, type, ...properties } = area;
    const featureType = AREA_FEATURE_TYPES[type] || type || 'green';
    const coordinates = [closeRing(footprint)];
    for (const hole of holes || []) if (Array.isArray(hole) && hole.length >= 3) coordinates.push(closeRing(hole));
    features.push(createFeature(
      id,
      featureType,
      name,
      { type: 'Polygon', coordinates },
      { ...properties, areaType: type || featureType },
      area.source || 'campus-layout',
      area.qualityStatus || 'unverified',
    ));
  }

  for (const object of document.objects || []) {
    const coordinates = object.geometry?.coordinates;
    if (!object.id || object.geometry?.type !== 'Point' || !Array.isArray(coordinates) || coordinates.length < 2) continue;
    const { id, geometry, type, name, properties = {}, source, qualityStatus, ...metadata } = object;
    features.push(createFeature(
      id,
      'object',
      name,
      { type: 'Point', coordinates: [Number(coordinates[0]), Number(coordinates[1])] },
      { ...metadata, ...properties, objectType: type || 'facility' },
      source || 'manual',
      qualityStatus || 'unverified',
    ));
  }

  return { type: 'FeatureCollection', features, deletedFeatureIds: [...new Set((document.deletedFeatureIds || []).map(String))] };
}

/**
 * Transitional adapter for existing editor/rendering consumers.
 * New persistence and renderer boundaries should prefer FeatureCollection;
 * this adapter keeps older UI controls operational during phased migration.
 */
export function fromCampusFeatureCollection(collection = {}) {
  const result = { buildings: [], roads: [], areas: [], objects: [], deletedFeatureIds: [...new Set((collection.deletedFeatureIds || []).map(String))] };
  for (const feature of collection.features || []) {
    const properties = { ...(feature.properties || {}) };
    const type = properties.featureType;
    const name = properties.name || '未命名要素';
    const source = properties.source || 'manual';
    const qualityStatus = properties.qualityStatus || 'unverified';
    delete properties.featureType;
    delete properties.name;
    delete properties.source;
    delete properties.qualityStatus;

    if (type === 'building' && feature.geometry?.type === 'Polygon') {
      const footprint = (feature.geometry.coordinates?.[0] || []).slice(0, -1);
      result.buildings.push({ ...properties, id: String(feature.id), label: name, footprint, confidence: properties.confidence || 'low', qualityStatus, source });
    } else if (type === 'road' && feature.geometry?.type === 'LineString') {
      result.roads.push({ ...properties, id: String(feature.id), name, points: feature.geometry.coordinates, width: properties.width, confidence: properties.confidence || 'low', qualityStatus, source });
    } else if (['green', 'water', 'sports', 'plaza', 'parking'].includes(type) && feature.geometry?.type === 'Polygon') {
      const areaType = properties.areaType || ({ green: 'vegetation' }[type] || type);
      delete properties.areaType;
      const polygon = (feature.geometry.coordinates?.[0] || []).slice(0, -1)
      result.areas.push({ ...properties, id: String(feature.id), name, type: areaType, polygon, footprint: polygon, holes: (feature.geometry.coordinates || []).slice(1), confidence: properties.confidence || 'low', qualityStatus, source });
    } else if (feature.geometry?.type === 'Point') {
      const objectType = properties.objectType || type || 'facility';
      delete properties.objectType;
      result.objects.push({
        id: String(feature.id),
        type: objectType,
        name,
        geometry: { type: 'Point', coordinates: feature.geometry.coordinates },
        properties,
        source,
        qualityStatus,
      });
    }
  }
  return result;
}


/**
 * Canonical undo/redo snapshot. The FeatureCollection is the only spatial
 * payload stored in history; legacy arrays are reconstructed on restore.
 */
export function createCampusFeatureSnapshot(document = {}) {
  const converted = document.featureCollection?.type === 'FeatureCollection'
    ? document.featureCollection
    : toCampusFeatureCollection(document)
  const deletedFeatureIds = [...new Set([
    ...(converted.deletedFeatureIds || []),
    ...(document.deletedFeatureIds || []),
  ].map(String))]
  return {
    type: 'CampusFeatureSnapshot',
    version: 1,
    featureCollection: {
      type: 'FeatureCollection',
      features: converted.features || [],
      deletedFeatureIds,
    },
  }
}

export function restoreCampusFeatureSnapshot(snapshot = {}) {
  if (snapshot?.type !== 'CampusFeatureSnapshot' || snapshot.version !== 1) {
    throw new Error('不支持的校园空间历史快照版本')
  }
  return fromCampusFeatureCollection(snapshot.featureCollection || {})
}
