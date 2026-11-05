/**
 * 通用场景资产模板分类。
 *
 * category 表示资产所属业务域，objectType 表示具体对象类型，
 * visualStyle 表示独立视觉风格。三者不得混用。
 */
export const SCENE_ASSET_CATEGORIES = Object.freeze([
  { value: 'building', label: '建筑', description: '教学楼、宿舍、图书馆、城堡、住宅等建筑主体' },
  { value: 'structure', label: '构筑物', description: '桥梁、门楼、牌坊、围墙、廊架、亭子、楼梯等' },
  { value: 'vegetation', label: '植被生态', description: '乔木、灌木、花卉、草丛、藤蔓、水生植物等' },
  { value: 'road', label: '道路交通', description: '道路、人行道、路缘、斑马线、停车位、交通标志等' },
  { value: 'water', label: '水体', description: '湖泊、河流、水渠、喷泉、瀑布及岸线结构等' },
  { value: 'terrain', label: '地形', description: '地面、山坡、台地、台阶地形、岩石地貌等' },
  { value: 'facility', label: '公共设施', description: '长椅、路灯、垃圾桶、公告栏、指示牌等' },
  { value: 'decoration', label: '景观装饰', description: '雕塑、假山、花坛、景观石、灯饰、装置艺术等' },
  { value: 'sports', label: '运动设施', description: '球场、篮球架、球门、健身器材、舞台等' },
  { value: 'indoor', label: '室内设施', description: '教室桌椅、实验台、货架、门窗、室内楼梯等' },
  { value: 'vehicle', label: '交通工具', description: '自行车、汽车、校车及其他可复用载具模型' },
  { value: 'character', label: '人物角色', description: '行人、NPC、校园角色及其动作模型' },
  { value: 'effect', label: '动态效果', description: '动态水面、喷泉粒子、灯光、天气及环境特效' },
]);

export const SCENE_ASSET_VISUAL_STYLES = Object.freeze([
  { value: 'anime-painted', label: '动漫彩绘' },
  { value: 'hand-painted', label: '手绘' },
  { value: 'low-poly', label: '低多边形' },
  { value: 'realistic', label: '写实' },
  { value: 'pixel-art', label: '像素风' },
  { value: 'stylized', label: '风格化' },
  { value: 'toon', label: '卡通描边' },
  { value: 'chinese-traditional', label: '中式传统' },
  { value: 'european-classical', label: '欧式古典' },
  { value: 'futuristic', label: '未来科技' },
]);

export const SCENE_ASSET_GENERATION_MODES = Object.freeze([
  { value: 'procedural', label: '参数化生成' },
  { value: 'glb', label: 'GLB 模型导入' },
]);

export function getSceneAssetCategory(category) {
  return SCENE_ASSET_CATEGORIES.find(item => item.value === category) || null;
}
