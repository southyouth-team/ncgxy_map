import { getCampusSpatialLayers } from '../../../data/campus/campusGeoJSON.js'

/**
 * Shared normalization boundary for the homepage renderer and editor preview.
 * Both renderers consume the same FeatureCollection-derived spatial layers.
 */
export function createCampusSceneRenderData(featureCollection) {
  const layers = getCampusSpatialLayers(featureCollection)
  return {
    featureCollection,
    layers,
    previewDocument: {
      buildings: layers.buildings.map(building => ({
        ...(building.properties || {}),
        id: building.id,
        label: building.label,
        footprint: building.polygon,
        floors: building.floors,
        height: building.height,
        template: building.template,
        walkable: building.walkable,
        confidence: building.confidence,
        source: building.source,
        qualityStatus: building.qualityStatus,
      })),
      roads: layers.roads.map(road => ({
        ...(road.properties || {}),
        id: road.id,
        name: road.name,
        points: road.points,
        width: road.width,
        walkable: road.walkable,
        confidence: road.confidence,
      })),
      areas: layers.areas.map(area => ({
        ...(area.properties || {}),
        id: area.id,
        name: area.name,
        type: area.type,
        polygon: area.polygon,
        holes: area.holes,
        walkable: area.walkable,
        rect: area.rect,
        confidence: area.confidence,
      })),
      objects: layers.objects.map(object => ({
        id: object.id,
        type: object.type,
        name: object.name,
        geometry: { type: 'Point', coordinates: object.position },
        properties: { ...object.properties, rotation: object.rotation, scale: object.scale, walkable: object.walkable },
        source: object.source,
        qualityStatus: object.qualityStatus,
      })),
    },
  }
}
