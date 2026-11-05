/**
 * Adapts the existing campus generators into independently instantiable templates.
 * The sandbox receives fresh Object3D instances; editor spatial data remains external.
 */
import { createThreeAssetTemplateRuntime } from './threeAssetTemplateRuntime.js';
import { createSceneAssetGeneratorRegistry, SCENE_ASSET_GENERATOR_CATALOG } from './sceneAssetGeneratorRegistry.js';
import {
  CAMPUS_BUILDING_ASSET_CATALOG,
  createCampusMaterials,
  createPixelBuilding,
} from './campusAssetLibrary.js';

// 模板 ID 使用稳定机器标识；展示名称中的空白统一转换为连字符。
function toTemplateId(value) {
  return String(value || '').trim().replace(/\s+/g, '-');
}

export function createCampusAssetTemplateRuntime(THREE) {
  const templates = createThreeAssetTemplateRuntime(THREE);
  const generators = createSceneAssetGeneratorRegistry(THREE);

  for (const definition of SCENE_ASSET_GENERATOR_CATALOG) {
    for (const objectType of definition.objectTypes) {
      const id = definition.category + ':' + objectType;
      templates.register({
        id,
        version: 1,
        category: definition.category,
        objectType,
        name: objectType,
        factory: (_THREE, parameters) => generators.generate({
          ...parameters,
          category: definition.category,
          objectType,
        }),
      });
    }
  }

  const buildingMaterials = createCampusMaterials(THREE);
  for (const definition of CAMPUS_BUILDING_ASSET_CATALOG) {
    templates.register({
      id: toTemplateId('building:' + definition.id),
      version: 1,
      category: 'building',
      objectType: definition.template,
      name: definition.label,
      factory: (_THREE, parameters) => createPixelBuilding(THREE, {
        ...parameters,
        template: definition.template,
        materials: buildingMaterials,
        label: parameters.label || definition.label,
      }),
    });
  }

  return Object.freeze({
    templates,
    generators,
    createSandboxScene() {
      const scene = new THREE.Scene();
      scene.name = 'campus-asset-template-sandbox';
      scene.add(new THREE.HemisphereLight(0xffffff, 0x73836a, 1.8));
      const light = new THREE.DirectionalLight(0xffffff, 2.0);
      light.position.set(35, 60, 25);
      light.castShadow = true;
      scene.add(light);
      return scene;
    },
  });
}
