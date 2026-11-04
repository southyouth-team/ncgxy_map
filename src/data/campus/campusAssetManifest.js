/**
 * Campus visual asset manifest contract.
 *
 * Spatial Features remain authoritative for placement, footprint, collision and
 * walkability. This module only resolves visual assets for a Feature and view.
 */

const ASSET_ROOTS = ['/assets/campus/', '/models/buildings/', '/api/v1/assets/visual-assets/'];
const VIEW_MODES = ['2.5d', '3d', 'shared'];
const SOURCES = ['ai_generated', 'manual_model', 'procedural', 'external'];
const STATUSES = ['draft', 'review', 'ready', 'archived'];
const CATEGORIES = ['building', 'vegetation', 'facility', 'road', 'area', 'character', 'decoration', 'other'];
const MEDIA_TYPES = ['image', 'spritesheet', 'texture', 'glb'];
const FILE_ROLES = ['primary', 'thumbnail', 'albedo', 'normal', 'roughness', 'emissive'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeAssetPath(value) {
  return isNonEmptyString(value)
    && !value.includes('..')
    && !value.includes('\\')
    && ASSET_ROOTS.some(root => value.startsWith(root));
}

/**
 * Validate a manifest without loading media or changing spatial Features.
 * knownFeatureIds is optional; pass canonical Feature IDs to validate bindings.
 */
export function validateCampusAssetManifest(manifest, knownFeatureIds = null) {
  const errors = [];
  const warnings = [];
  const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];
  const bindings = Array.isArray(manifest?.bindings) ? manifest.bindings : [];
  const assetById = new Map();
  const featureIds = knownFeatureIds ? new Set(Array.from(knownFeatureIds, String)) : null;
  const push = (code, path, message) => errors.push({ code, path, message });

  if (manifest?.schemaVersion !== 1) {
    push('ASSET_SCHEMA_VERSION_UNSUPPORTED', 'schemaVersion', '资产清单 schemaVersion 必须为 1');
  }
  if (!Array.isArray(manifest?.assets)) {
    push('ASSET_LIST_INVALID', 'assets', 'assets 必须是数组');
  }
  if (!Array.isArray(manifest?.bindings)) {
    push('ASSET_BINDINGS_INVALID', 'bindings', 'bindings 必须是数组');
  }

  for (const [index, asset] of assets.entries()) {
    const path = `assets[${index}]`;
    if (!isNonEmptyString(asset?.assetId)) {
      push('ASSET_ID_MISSING', path, '资产缺少稳定 assetId');
      continue;
    }
    if (assetById.has(asset.assetId)) {
      push('ASSET_ID_DUPLICATE', path, `assetId 重复：${asset.assetId}`);
      continue;
    }
    assetById.set(asset.assetId, asset);

    if (!CATEGORIES.includes(asset.category)) push('ASSET_CATEGORY_INVALID', path, '资产 category 不在支持范围内');
    if (!SOURCES.includes(asset.sourceType)) push('ASSET_SOURCE_INVALID', path, 'sourceType 不在支持范围内');
    if (!STATUSES.includes(asset.status)) push('ASSET_STATUS_INVALID', path, 'status 不在支持范围内');
    if (!isNonEmptyString(asset.name)) push('ASSET_NAME_MISSING', path, '资产缺少可读名称');
    if (!Array.isArray(asset.files) || asset.files.length === 0) {
      if (asset.status === 'ready') push('ASSET_READY_WITHOUT_FILES', path, 'ready 资产至少需要一个文件');
      else warnings.push({ code: 'ASSET_FILES_PENDING', path, message: '资产尚未登记文件' });
      continue;
    }

    const fileKeys = new Set();
    let hasPrimary = false;
    for (const [fileIndex, file] of asset.files.entries()) {
      const filePath = `${path}.files[${fileIndex}]`;
      if (!VIEW_MODES.includes(file?.viewMode)) push('ASSET_FILE_VIEW_INVALID', filePath, '文件 viewMode 必须是 2.5d、3d 或 shared');
      if (!MEDIA_TYPES.includes(file?.mediaType)) push('ASSET_FILE_MEDIA_INVALID', filePath, '文件 mediaType 不受支持');
      if (!FILE_ROLES.includes(file?.role)) push('ASSET_FILE_ROLE_INVALID', filePath, '文件 role 不受支持');
      if (!isSafeAssetPath(file?.url)) push('ASSET_FILE_PATH_INVALID', filePath, '文件路径必须位于受控资产目录，且不能包含路径穿越');
      if (file?.role === 'primary') hasPrimary = true;
      const key = `${file?.viewMode}:${file?.role}`;
      if (fileKeys.has(key)) push('ASSET_FILE_VARIANT_DUPLICATE', filePath, '同一视角不能重复登记相同 role');
      fileKeys.add(key);
      if (file?.mediaType === 'glb' && file?.viewMode === '2.5d') {
        push('ASSET_FILE_VIEW_MEDIA_MISMATCH', filePath, 'GLB 不应作为 2.5D 图片素材直接使用');
      }
      if (file?.mediaType === 'image' && file?.viewMode === '3d' && file?.role === 'primary') {
        warnings.push({ code: 'ASSET_3D_IMAGE_FALLBACK', path: filePath, message: '3D 主素材使用平面图片，需确认是否为预期 billboard/贴花' });
      }
    }
    if (asset.status === 'ready' && !hasPrimary) {
      push('ASSET_READY_WITHOUT_PRIMARY', path, 'ready 资产至少需要一个 primary 视觉文件');
    }
    if (asset.sourceType === 'ai_generated'
      && (!isNonEmptyString(asset.provenance?.provider) || !isNonEmptyString(asset.provenance?.prompt))) {
      warnings.push({ code: 'ASSET_AI_PROVENANCE_INCOMPLETE', path, message: 'AI 生成资产建议记录 provider 和 prompt，便于追溯与复现' });
    }
  }

  const bindingKeys = new Set();
  for (const [index, binding] of bindings.entries()) {
    const path = `bindings[${index}]`;
    if (!isNonEmptyString(binding?.featureId)) {
      push('ASSET_BINDING_FEATURE_MISSING', path, '绑定缺少空间 Feature ID');
      continue;
    }
    if (!isNonEmptyString(binding?.assetId)) {
      push('ASSET_BINDING_ASSET_MISSING', path, '绑定缺少 assetId');
      continue;
    }
    const key = String(binding.featureId);
    if (bindingKeys.has(key)) push('ASSET_BINDING_DUPLICATE', path, `Feature 存在重复资产绑定：${key}`);
    bindingKeys.add(key);
    if (!assetById.has(binding.assetId)) push('ASSET_BINDING_TARGET_UNKNOWN', path, `绑定引用不存在的资产：${binding.assetId}`);
    if (featureIds && !featureIds.has(key)) push('ASSET_BINDING_FEATURE_UNKNOWN', path, `绑定引用不存在的空间 Feature：${key}`);
    const asset = assetById.get(binding.assetId);
    if (asset && asset.status !== 'ready') {
      warnings.push({ code: 'ASSET_BINDING_NOT_READY', path, message: `绑定资产 ${binding.assetId} 尚未 ready，不会参与运行时解析` });
    }
  }

  return {
    valid: errors.length === 0,
    errorCount: errors.length,
    errors,
    warnings,
    summary: {
      assetCount: assets.length,
      bindingCount: bindings.length,
      readyAssetCount: assets.filter(asset => asset?.status === 'ready').length,
      pendingAssetCount: assets.filter(asset => asset && asset.status !== 'ready').length,
    },
  };
}

/**
 * Resolve a ready visual asset for a canonical spatial Feature.
 * Exact view variant wins; shared is the only implicit fallback.
 */
export function resolveCampusVisualAsset(manifest, featureId, viewMode) {
  if (!['2.5d', '3d'].includes(viewMode)) {
    return { resolved: false, reason: 'unsupported-view-mode', featureId: String(featureId) };
  }
  const binding = (manifest?.bindings || []).find(item => String(item?.featureId) === String(featureId));
  if (!binding) return { resolved: false, reason: 'binding-not-found', featureId: String(featureId) };

  const asset = (manifest?.assets || []).find(item => item?.assetId === binding.assetId);
  if (!asset) return { resolved: false, reason: 'asset-not-found', featureId: String(featureId), assetId: binding.assetId };
  if (asset.status !== 'ready') {
    return { resolved: false, reason: 'asset-not-ready', featureId: String(featureId), assetId: asset.assetId };
  }

  const files = Array.isArray(asset.files) ? asset.files : [];
  const primary = files.find(file => file.viewMode === viewMode && file.role === 'primary')
    || files.find(file => file.viewMode === 'shared' && file.role === 'primary');
  if (!primary) {
    return { resolved: false, reason: 'view-variant-not-found', featureId: String(featureId), assetId: asset.assetId, viewMode };
  }
  return {
    resolved: true,
    featureId: String(featureId),
    assetId: asset.assetId,
    category: asset.category,
    sourceType: asset.sourceType,
    viewMode,
    file: primary,
    asset,
  };
}

/**
 * Convert reviewed browser-workshop records into the deployable manifest.
 * Multiple view variants for one Feature are grouped under one stable assetId.
 */
export function createCampusAssetManifestFromWorkshopRecords(records, knownFeatureIds = null) {
  const groups = new Map();
  const skipped = [];
  for (const record of Array.isArray(records) ? records : []) {
    if (record?.status !== 'ready' || record?.deployedConfirmed !== true) continue;
    const url = record.publicPath;
    const is3d = record.viewMode === '3d';
    const validPath = isSafeAssetPath(url) && (is3d
      ? url.startsWith('/models/buildings/') && url.toLowerCase().endsWith('.glb')
      : record.viewMode === '2.5d' && url.startsWith('/assets/campus/') && /\.(png|webp|jpe?g)$/i.test(url));
    if (!validPath || !isNonEmptyString(record.featureId)) {
      skipped.push({ assetId: record.assetId || null, reason: 'invalid-path-or-feature', publicPath: url || null });
      continue;
    }
    const featureId = String(record.featureId);
    const asset = groups.get(featureId) || {
      assetId: 'campus-' + featureId,
      name: record.featureName || record.name || featureId,
      category: record.category || 'other',
      sourceType: SOURCES.includes(record.sourceType) ? record.sourceType : 'ai_generated',
      status: 'ready',
      files: [],
      provenance: {
        provider: record.sourceType === 'ai_generated' ? 'user-selected-ai-tool' : (record.sourceType || 'unknown'),
        prompt: record.prompt || '',
        createdAt: record.createdAt || null,
        notes: '由素材工坊人工审核并确认文件已放入项目 public 目录',
      },
    };
    asset.files.push({
      viewMode: record.viewMode,
      role: 'primary',
      mediaType: is3d ? 'glb' : 'image',
      format: is3d ? 'glb' : url.split('.').pop().toLowerCase(),
      url,
    });
    groups.set(featureId, asset);
  }

  const manifest = {
    schemaVersion: 1,
    idStrategy: 'stable-spatial-feature-id',
    assetRoots: ASSET_ROOTS,
    viewModes: VIEW_MODES,
    sourceTypes: SOURCES,
    statuses: STATUSES,
    assets: [...groups.values()],
    bindings: [...groups.entries()].map(([featureId, asset]) => ({ featureId, assetId: asset.assetId })),
  };
  return {
    manifest,
    report: validateCampusAssetManifest(manifest, knownFeatureIds),
    skipped,
  };
}
