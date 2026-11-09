import * as THREE from 'three'
import { hasExplicitModelCapabilityManifest, normalizeModelCapabilityManifest, validateSpatialTraversability } from './modelCapabilityManifest.js'
import { createCapabilityControlDocument } from './capabilityControl.js'
import { collectProceduralModelGeometryDiagnostics } from './geometryDiagnostics.js'

/**
 * Dedicated module worker for generated model code.
 *
 * This keeps generated JavaScript out of the page's Window context. A Worker
 * has no DOM, document, localStorage, or direct access to the campus scene.
 * Network-facing APIs are disabled as a defense-in-depth measure; this is
 * not a hardened security boundary against deliberately hostile JavaScript.
 */
function disableNetworkApis() {
  const blocked = () => {
    throw new Error('AI 模型代码不能访问网络 API')
  }

  for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts']) {
    try {
      Object.defineProperty(self, key, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: undefined,
      })
    } catch {
      // Keep the worker usable in browsers that expose a non-configurable API.
      try { self[key] = blocked } catch { /* ignore */ }
    }
  }

  for (const key of ['caches', 'indexedDB']) {
    try {
      Object.defineProperty(self, key, {
        configurable: false,
        enumerable: false,
        get: blocked,
      })
    } catch {
      // Best-effort restriction only; Worker isolation remains the primary boundary.
    }
  }
}

disableNetworkApis()

async function reportProgress(port, stage, label, detail = '') {
  port.postMessage({ type: 'progress', stage, label, detail, timestamp: Date.now() })
  // Yield between real worker milestones so the host can paint the latest state.
  await new Promise(resolve => setTimeout(resolve, 0))
}

self.addEventListener('message', async (event) => {
  const port = event.ports?.[0]
  if (event.data?.type !== 'run' || !port) return

  const source = event.data.source
  let modelUrl

  try {
    await reportProgress(port, 'validating', '检查生成源码')
    if (typeof source !== 'string' || !source.trim()) {
      throw new TypeError('AI 未返回 Three.js 程序化源码')
    }

    await reportProgress(port, 'loading-module', '加载模型构建模块')
    modelUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    const modelModule = await import(/* @vite-ignore */ modelUrl)

    if (typeof modelModule.createModel !== 'function') {
      throw new Error('源码必须导出 createModel(THREE)')
    }

    const parameters = event.data?.parameters && typeof event.data.parameters === 'object' ? event.data.parameters : {}
    await reportProgress(port, 'building', '执行 Three.js 模型构建')
    const root = await modelModule.createModel(THREE, parameters)
    if (!root || root.isGroup !== true) {
      throw new Error('createModel(THREE) 必须返回 THREE.Group')
    }
    if (root.parent) {
      throw new Error('模型根节点不能预先挂载到其他对象')
    }

    await reportProgress(port, 'metadata', '整理模型参数与能力声明')
    const hasModuleManifest = hasExplicitModelCapabilityManifest(modelModule.modelCapabilityManifest)
    const modelCapabilityManifest = normalizeModelCapabilityManifest(
      modelModule.modelCapabilityManifest,
      modelModule.modelParameters,
      modelModule.environmentBindings,
    )
    const traversalValidation = validateSpatialTraversability(
      modelCapabilityManifest.capabilities.spatial?.traversability,
    )
    const capabilityControlDocument = createCapabilityControlDocument({
      manifest: modelCapabilityManifest,
      previousDocument: event.data?.capabilityControlDocument,
    })
    const manifestParameters = modelCapabilityManifest.parameters
    const manifestEnvironmentBindings = Array.isArray(modelCapabilityManifest.capabilities.environmentBindings)
      ? modelCapabilityManifest.capabilities.environmentBindings : []

    root.userData = {
      ...(root.userData || {}),
      proceduralModelParameters: manifestParameters,
      proceduralModelParts: Array.isArray(modelModule.modelParts) ? modelModule.modelParts : [],
      proceduralModelPartsSource: Array.isArray(modelModule.modelParts) ? 'module' : 'legacy',
      proceduralModelEnvironmentBindings: manifestEnvironmentBindings,
      proceduralModelCapabilityManifest: modelCapabilityManifest,
      proceduralModelTraversalValidation: traversalValidation,
      proceduralModelCapabilityManifestSource: hasModuleManifest ? 'module' : 'legacy',
      proceduralModelCapabilityControlDocument: capabilityControlDocument,
      proceduralModelParameterValues: parameters,
    }
    root.updateMatrixWorld(true)
    await reportProgress(port, 'diagnostics', '采集几何诊断信息')
    root.userData.proceduralModelGeometryDiagnostics = collectProceduralModelGeometryDiagnostics(THREE, root)
    await reportProgress(port, 'serializing', '序列化模型预览数据')
    port.postMessage({
      ok: true,
      serialized: root.toJSON(),
      name: root.userData?.assetName || root.name || 'AI 生成模型',
    })
  } catch (error) {
    port.postMessage({
      ok: false,
      error: error?.message || String(error),
      stack: error?.stack || '',
    })
  } finally {
    if (modelUrl) URL.revokeObjectURL(modelUrl)
    port.close()
  }
}, { once: true })
