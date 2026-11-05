/**
 * Versioned Three.js asset-template runtime.
 *
 * Templates are trusted, statically bundled factory modules. AI output must never be
 * passed here as executable source; AI-generated designs are normalized data consumed
 * by reviewed factories/adapters.
 */
const TEMPLATE_ID = /^[\p{L}\p{N}][\p{L}\p{N}:._/-]{0,119}$/u;

function vector(value, fallback, label, min, max, allowZero = true) {
  const result = value === undefined ? [...fallback] : value;
  if (!Array.isArray(result) || result.length !== 3 || result.some(v => !Number.isFinite(Number(v)))) {
    throw new TypeError(label + ' 必须是三个有限数值');
  }
  const normalized = result.map(Number);
  if (normalized.some(v => v < min || v > max || (!allowZero && Math.abs(v) < 0.0001))) {
    throw new RangeError(label + ' 超出允许范围');
  }
  return normalized;
}

export function createThreeAssetTemplateRuntime(THREE) {
  if (!THREE?.Group || !THREE?.Scene || !THREE?.Object3D) {
    throw new TypeError('Three.js runtime is required');
  }
  const definitions = new Map();

  function register(definition, options = {}) {
    if (!definition || typeof definition !== 'object' || !TEMPLATE_ID.test(String(definition.id || '')) ||
      typeof definition.factory !== 'function' || !Number.isInteger(definition.version) || definition.version < 1) {
      throw new TypeError('资产模板定义无效：需要合法 id、正整数 version 和 factory');
    }
    if (definitions.has(definition.id) && options.replace !== true) {
      throw new Error('资产模板重复注册：' + definition.id);
    }
    const stored = Object.freeze({
      id: definition.id,
      version: definition.version,
      category: String(definition.category || 'other'),
      objectType: String(definition.objectType || definition.id),
      name: String(definition.name || definition.objectType || definition.id).slice(0, 120),
      factory: definition.factory,
    });
    definitions.set(stored.id, stored);
    return () => {
      if (definitions.get(stored.id) === stored) definitions.delete(stored.id);
    };
  }

  function create(templateId, options = {}) {
    const definition = definitions.get(String(templateId));
    if (!definition) throw new Error('未注册资产模板：' + templateId);
    const object = definition.factory(THREE, options.parameters || {}, definition);
    if (!object?.isObject3D) throw new TypeError('资产模板 factory 必须返回 THREE.Object3D：' + templateId);
    if (object.parent) throw new Error('资产模板 factory 返回的对象已经挂载到其他父节点');
    const transform = options.transform || {};
    const position = vector(transform.position, [0, 0, 0], 'position', -100000, 100000);
    const rotation = vector(transform.rotation, [0, 0, 0], 'rotation', -Math.PI * 200, Math.PI * 200);
    const scale = vector(transform.scale, [1, 1, 1], 'scale', 0.001, 100, false);
    object.name = String(options.name || definition.name).slice(0, 120);
    object.position.set(...position);
    object.rotation.set(...rotation);
    object.scale.set(...scale);
    object.userData = {
      ...object.userData,
      assetTemplate: {
        id: definition.id,
        version: definition.version,
        category: definition.category,
        objectType: definition.objectType,
      },
      assetInstanceId: options.instanceId || null,
    };
    object.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    if (options.scene) {
      if (!options.scene.isScene && !options.scene.isObject3D) throw new TypeError('scene 必须是 THREE.Scene 或 THREE.Object3D');
      options.scene.add(object);
    }
    return object;
  }

  return Object.freeze({
    register,
    has: id => definitions.has(String(id)),
    list: () => [...definitions.values()].map(({ factory, ...metadata }) => metadata),
    create,
    createInto: (scene, templateId, options = {}) => create(templateId, { ...options, scene }),
  });
}
