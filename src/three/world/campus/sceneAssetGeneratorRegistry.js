/**
 * 通用场景资产参数化生成器注册表。
 *
 * 资产模板负责描述对象；生成器负责把描述转换为真实 Three.js Mesh。
 * 地图空间实例（Feature geometry / transform / collision）不属于本模块。
 * 未注册的 category/objectType 必须明确报错，禁止回退成其他类别的几何。
 */

const STYLE_PALETTES = Object.freeze({
  'anime-painted': { primary: '#e6a66f', secondary: '#75a9b7', accent: '#f2d47d', dark: '#594b50', leaf: '#69a65e' },
  'hand-painted': { primary: '#bd956d', secondary: '#829c83', accent: '#d9bd86', dark: '#514b43', leaf: '#63845b' },
  'low-poly': { primary: '#c69a70', secondary: '#8aa7a0', accent: '#e4c77f', dark: '#55565a', leaf: '#5f965c' },
  realistic: { primary: '#8e9692', secondary: '#687b80', accent: '#d0b987', dark: '#42494b', leaf: '#47734c' },
  'pixel-art': { primary: '#c69a70', secondary: '#789b9b', accent: '#e4c77f', dark: '#4e514d', leaf: '#5e9254' },
  stylized: { primary: '#d1a078', secondary: '#7eaaa4', accent: '#edcb7b', dark: '#57505a', leaf: '#69a05b' },
  toon: { primary: '#e0aa78', secondary: '#83b6c1', accent: '#f1d278', dark: '#45434b', leaf: '#65a35b' },
  'chinese-traditional': { primary: '#a95c4e', secondary: '#d5c49b', accent: '#c9a34c', dark: '#51443c', leaf: '#54734d' },
  'european-classical': { primary: '#d6c5a5', secondary: '#8798a1', accent: '#b77a54', dark: '#55515a', leaf: '#62865b' },
  futuristic: { primary: '#849aa8', secondary: '#527f98', accent: '#8dd4d0', dark: '#34424f', leaf: '#5e9e9b' },
});

const normalize = value => String(value || '').trim().toLowerCase();
const dimensionsOf = input => ({
  width: Math.max(0.2, Number(input.dimensions?.width) || 2),
  height: Math.max(0.2, Number(input.dimensions?.height) || 2),
  depth: Math.max(0.2, Number(input.dimensions?.depth) || 2),
});

function createMesh(THREE, geometry, material, name, parent, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createMaterials(THREE, style, overrides = {}) {
  const palette = { ...(STYLE_PALETTES[style] || STYLE_PALETTES.stylized), ...overrides };
  const make = (color, extra = {}) => new THREE.MeshStandardMaterial({
    color, roughness: 0.88, metalness: 0, flatShading: true, ...extra,
  });
  return {
    primary: make(palette.primary),
    secondary: make(palette.secondary),
    accent: make(palette.accent),
    dark: make(palette.dark),
    leaf: make(palette.leaf),
    glass: make(palette.secondary, { roughness: 0.3, metalness: 0.08 }),
  };
}

function createVegetationGenerator(THREE, input, materials) {
  const group = new THREE.Group();
  const { width, height, depth } = dimensionsOf(input);
  const type = normalize(input.objectType);
  const geometry = input.design?.geometry || {};
  const tree = ['tree', '乔木', '香樟树', '树木', '大树'].includes(type);
  const shrub = ['shrub', '灌木', '绿篱', '灌木丛'].includes(type);
  const flower = ['flower', '花卉', '花坛', '花丛'].includes(type);
  if (!tree && !shrub && !flower) throw new Error('植被生成器暂不支持该对象类型：' + input.objectType);

  if (tree) {
    const trunkHeight = height * Math.max(0.2, Math.min(0.7, Number(geometry.trunkRatio) || 0.42));
    createMesh(THREE, new THREE.CylinderGeometry(width * 0.075, width * 0.1, trunkHeight, 6), materials.dark,
      'vegetation-trunk', group, [0, trunkHeight / 2, 0]);
    const crownRadius = Math.max(width, depth) * 0.34;
    const crownLayers = Math.max(1, Math.min(6, Math.round(Number(geometry.crownLayers) || 1)));
    for (let layer = 0; layer < crownLayers; layer += 1) {
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(crownRadius * (1 - layer * 0.1), 1), layer % 2 ? materials.secondary : materials.leaf);
      crown.name = 'vegetation-crown-' + layer;
      crown.position.y = trunkHeight + height * 0.18 + layer * height * 0.1;
      crown.scale.y = Math.max(0.55, height / Math.max(width, depth) * 0.7);
      crown.castShadow = true;
      group.add(crown);
    }
    const secondary = new THREE.Mesh(new THREE.IcosahedronGeometry(Math.max(width, depth) * 0.22, 0), materials.secondary);
    secondary.name = 'vegetation-crown-highlight';
    secondary.position.set(width * 0.13, trunkHeight + height * 0.28, depth * 0.1);
    group.add(secondary);
  } else if (shrub) {
    for (let i = 0; i < 5; i += 1) {
      const angle = i * Math.PI * 2 / 5;
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(Math.min(width, depth) * 0.24, 0), i % 2 ? materials.leaf : materials.secondary);
      crown.position.set(Math.cos(angle) * width * 0.22, height * 0.25 + (i % 2) * height * 0.08, Math.sin(angle) * depth * 0.22);
      crown.castShadow = true;
      group.add(crown);
    }
  } else {
    const count = Math.max(3, Math.min(12, Math.floor(width * 2)));
    for (let i = 0; i < count; i += 1) {
      const x = ((i % 4) - 1.5) * width / 5;
      const z = (Math.floor(i / 4) - 1) * depth / 4;
      createMesh(THREE, new THREE.CylinderGeometry(0.025, 0.035, height * 0.55, 5), materials.leaf,
        'flower-stem-' + i, group, [x, height * 0.275, z]);
      const bloom = new THREE.Mesh(new THREE.IcosahedronGeometry(Math.max(0.08, width * 0.055), 0), i % 2 ? materials.accent : materials.primary);
      bloom.position.set(x, height * 0.58, z);
      group.add(bloom);
    }
  }
  return group;
}

function createStructureGenerator(THREE, input, materials) {
  const group = new THREE.Group();
  const { width, height, depth } = dimensionsOf(input);
  const type = normalize(input.objectType);
  const geometry = input.design?.geometry || {};
  if (!['bridge', '拱桥', '桥梁', '人行桥', '廊架', 'pergola', '亭子', 'pavilion'].includes(type)) {
    throw new Error('构筑物生成器暂不支持该对象类型：' + input.objectType);
  }
  if (['bridge', '拱桥', '桥梁', '人行桥'].includes(type)) {
    createMesh(THREE, new THREE.BoxGeometry(width, height * 0.12, depth), materials.primary,
      'bridge-deck', group, [0, height * 0.32, 0]);
    for (const side of [-1, 1]) {
      createMesh(THREE, new THREE.BoxGeometry(width, height * 0.08, 0.12), materials.secondary,
        'bridge-railing', group, [0, height * 0.62, side * depth * 0.43]);
      for (let x = -width * 0.42; x <= width * 0.42; x += Math.max(0.5, width / 5)) {
        createMesh(THREE, new THREE.BoxGeometry(0.1, height * 0.3, 0.1), materials.dark,
          'bridge-baluster', group, [x, height * 0.46, side * depth * 0.43]);
      }
    }
    const supportCount = Math.max(2, Math.min(16, Math.round(Number(geometry.supportCount) || 2)));
    for (let index = 0; index < supportCount; index += 1) {
      const x = -width * 0.42 + (supportCount === 1 ? 0 : index * width * 0.84 / (supportCount - 1));
      createMesh(THREE, new THREE.BoxGeometry(width * 0.07, height * 0.3, depth * 0.88), materials.dark,
        'bridge-pier', group, [x, height * 0.12, 0]);
    }
  } else {
    const post = Math.max(0.12, width * 0.045);
    for (const x of [-width / 2 + post, width / 2 - post]) {
      for (const z of [-depth / 2 + post, depth / 2 - post]) {
        createMesh(THREE, new THREE.BoxGeometry(post, height, post), materials.primary,
          'pavilion-post', group, [x, height / 2, z]);
      }
    }
    createMesh(THREE, new THREE.BoxGeometry(width * 1.08, post * 1.2, depth * 1.08), materials.secondary,
      'pavilion-roof', group, [0, height, 0]);
    createMesh(THREE, new THREE.BoxGeometry(width * 0.92, post * 0.55, depth * 0.92), materials.accent,
      'pavilion-roof-cap', group, [0, height + post * 0.85, 0]);
  }
  return group;
}

function createFacilityGenerator(THREE, input, materials) {
  const group = new THREE.Group();
  const { width, height, depth } = dimensionsOf(input);
  const type = normalize(input.objectType);
  const geometry = input.design?.geometry || {};
  if (['bench', '长椅', '座椅'].includes(type)) {
    const seatCount = Math.max(1, Math.min(5, Math.round(Number(geometry.seatCount) || 1)));
    for (let seat = 0; seat < seatCount; seat += 1) {
      const seatWidth = width / seatCount;
      createMesh(THREE, new THREE.BoxGeometry(seatWidth * 0.96, height * 0.12, depth), materials.primary,
        'bench-seat-' + seat, group, [-width / 2 + seatWidth * (seat + 0.5), height * 0.38, 0]);
    }
    createMesh(THREE, new THREE.BoxGeometry(width, height * 0.48, depth * 0.1), materials.secondary,
      'bench-back', group, [0, height * 0.68, -depth * 0.42]);
    for (const x of [-width * 0.34, width * 0.34]) {
      createMesh(THREE, new THREE.BoxGeometry(width * 0.08, height * 0.38, depth * 0.7), materials.dark,
        'bench-leg', group, [x, height * 0.18, 0]);
    }
  } else if (['lamp', '路灯', '庭院灯'].includes(type)) {
    createMesh(THREE, new THREE.CylinderGeometry(width * 0.035, width * 0.05, height * 0.88, 6), materials.dark,
      'lamp-pole', group, [0, height * 0.44, 0]);
    createMesh(THREE, new THREE.BoxGeometry(width * 0.42, height * 0.12, depth * 0.42), materials.accent,
      'lamp-head', group, [0, height * 0.92, 0]);
    createMesh(THREE, new THREE.BoxGeometry(width * 0.28, height * 0.04, depth * 0.28),
      new THREE.MeshBasicMaterial({ color: '#ffe8a3' }), 'lamp-emitter', group, [0, height * 0.84, 0]);
  } else if (['bin', '垃圾桶'].includes(type)) {
    createMesh(THREE, new THREE.BoxGeometry(width * 0.72, height * 0.82, depth * 0.72), materials.secondary,
      'bin-body', group, [0, height * 0.41, 0]);
    createMesh(THREE, new THREE.BoxGeometry(width * 0.82, height * 0.1, depth * 0.82), materials.dark,
      'bin-lid', group, [0, height * 0.88, 0]);
  } else if (['sign', '指示牌', '公告栏'].includes(type)) {
    createMesh(THREE, new THREE.CylinderGeometry(width * 0.035, width * 0.045, height * 0.65, 6), materials.dark,
      'sign-post', group, [0, height * 0.325, 0]);
    createMesh(THREE, new THREE.BoxGeometry(width, height * 0.32, depth * 0.12), materials.primary,
      'sign-board', group, [0, height * 0.78, 0]);
  } else {
    throw new Error('公共设施生成器暂不支持该对象类型：' + input.objectType);
  }
  return group;
}

function createDecorationGenerator(THREE, input, materials) {
  const group = new THREE.Group();
  const { width, height, depth } = dimensionsOf(input);
  const type = normalize(input.objectType);
  const geometry = input.design?.geometry || {};
  if (['rock', '景观石', '假山'].includes(type)) {
    const rockCount = Math.max(1, Math.min(8, Math.round(Number(geometry.rockCount) || 1)));
    for (let index = 0; index < rockCount; index += 1) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(Math.max(width, height, depth) * (0.24 + (index % 3) * 0.06), 0), materials.primary);
      rock.scale.set(width / Math.max(width, height, depth) * 0.72, height / Math.max(width, height, depth), depth / Math.max(width, height, depth) * 0.72);
      rock.position.set((index % 3 - 1) * width * 0.22, height * (0.22 + (index % 2) * 0.12), (Math.floor(index / 3) - 1) * depth * 0.2);
      rock.castShadow = true;
      group.add(rock);
    }
  } else if (['flowerbed', '花坛'].includes(type)) {
    createMesh(THREE, new THREE.BoxGeometry(width, height * 0.18, depth), materials.dark,
      'flowerbed-border', group, [0, height * 0.09, 0]);
    createMesh(THREE, new THREE.BoxGeometry(width * 0.86, height * 0.12, depth * 0.84), materials.leaf,
      'flowerbed-soil', group, [0, height * 0.19, 0]);
    for (let i = 0; i < 7; i += 1) {
      const flower = new THREE.Mesh(new THREE.IcosahedronGeometry(Math.min(width, depth) * 0.055, 0), i % 2 ? materials.accent : materials.primary);
      flower.position.set((i - 3) * width / 9, height * 0.4, (i % 2 ? 1 : -1) * depth * 0.18);
      group.add(flower);
    }
  } else {
    throw new Error('景观装饰生成器暂不支持该对象类型：' + input.objectType);
  }
  return group;
}

function createSportsGenerator(THREE, input, materials) {
  const group = new THREE.Group();
  const { width, height, depth } = dimensionsOf(input);
  const type = normalize(input.objectType);
  if (!['basketball-hoop', '篮球架', '篮球框'].includes(type)) {
    throw new Error('运动设施生成器暂不支持该对象类型：' + input.objectType);
  }
  createMesh(THREE, new THREE.BoxGeometry(width * 0.08, height * 0.78, depth * 0.08), materials.dark,
    'basketball-support', group, [0, height * 0.39, 0]);
  createMesh(THREE, new THREE.BoxGeometry(width * 0.62, height * 0.3, depth * 0.06), materials.glass,
    'basketball-backboard', group, [0, height * 0.78, depth * 0.12]);
  createMesh(THREE, new THREE.TorusGeometry(width * 0.16, 0.035, 5, 16), materials.accent,
    'basketball-rim', group, [0, height * 0.62, depth * 0.3], [Math.PI / 2, 0, 0]);
  return group;
}

export const SCENE_ASSET_GENERATOR_CATALOG = Object.freeze([
  { category: 'vegetation', objectTypes: ['tree', '乔木', '香樟树', '树木', '大树', 'shrub', '灌木', '绿篱', '灌木丛', 'flower', '花卉', '花坛', '花丛'] },
  { category: 'structure', objectTypes: ['bridge', '拱桥', '桥梁', '人行桥', '廊架', 'pergola', '亭子', 'pavilion'] },
  { category: 'facility', objectTypes: ['bench', '长椅', '座椅', 'lamp', '路灯', '庭院灯', 'bin', '垃圾桶', 'sign', '指示牌', '公告栏'] },
  { category: 'decoration', objectTypes: ['rock', '景观石', '假山', 'flowerbed', '花坛'] },
  { category: 'sports', objectTypes: ['basketball-hoop', '篮球架', '篮球框'] },
]);

export function createSceneAssetGeneratorRegistry(THREE) {
  if (!THREE?.Group || !THREE?.Mesh || !THREE?.MeshStandardMaterial) {
    throw new TypeError('Three.js runtime is required to create scene asset generators');
  }
  const generators = new Map();
  const categories = new Map();
  const register = (category, objectTypes, generator, options = {}) => {
    const normalizedCategory = normalize(category);
    if (!normalizedCategory || !Array.isArray(objectTypes) || !objectTypes.length || typeof generator !== 'function') {
      throw new TypeError('生成器注册参数无效');
    }
    const keys = objectTypes.map(normalize).filter(Boolean);
    if (!keys.length) throw new TypeError('生成器必须声明至少一个对象类型');
    for (const objectType of keys) {
      const key = normalizedCategory + ':' + objectType;
      if (generators.has(key) && options.replace !== true) throw new Error('场景资产生成器重复注册：' + key);
    }
    keys.forEach(objectType => generators.set(normalizedCategory + ':' + objectType, generator));
    if (!categories.has(normalizedCategory)) categories.set(normalizedCategory, new Set());
    keys.forEach(objectType => categories.get(normalizedCategory).add(objectType));
    return () => keys.forEach(objectType => {
      generators.delete(normalizedCategory + ':' + objectType);
      categories.get(normalizedCategory)?.delete(objectType);
    });
  };
  const handlers = {
    vegetation: createVegetationGenerator,
    structure: createStructureGenerator,
    facility: createFacilityGenerator,
    decoration: createDecorationGenerator,
    sports: createSportsGenerator,
  };

  for (const definition of SCENE_ASSET_GENERATOR_CATALOG) {
    const handler = handlers[definition.category];
    for (const objectType of definition.objectTypes) {
      // 内置与外部扩展走同一注册入口，避免两套路由规则。
      if (!generators.has(definition.category + ':' + normalize(objectType))) {
        register(definition.category, [objectType], handler);
      }
    }
  }

  return Object.freeze({
    register,
    list() {
      return [...categories.entries()].map(([category, objectTypes]) => ({
        category,
        objectTypes: [...objectTypes],
      }));
    },
    supports(category, objectType) {
      return generators.has(normalize(category) + ':' + normalize(objectType));
    },
    generate(input = {}) {
      const category = normalize(input.category);
      const objectType = normalize(input.objectType);
      const handler = generators.get(category + ':' + objectType);
      if (!handler) throw new Error('未注册场景资产生成器：' + category + '/' + objectType);
      const style = normalize(input.visualStyle) || 'stylized';
      const materials = createMaterials(THREE, style, input.materials || {});
      const root = handler(THREE, input, materials);
      root.name = input.name || category + '-' + objectType;
      root.userData.sceneAsset = {
        category,
        objectType,
        visualStyle: style,
        generator: 'procedural',
        schemaVersion: 1,
        dimensions: dimensionsOf(input),
      };
      root.traverse(object => {
        if (object.isMesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      return root;
    },
  });
}
