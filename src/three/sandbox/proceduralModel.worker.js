import * as THREE from 'three'
import { normalizeModelCapabilityManifest } from './modelCapabilityManifest.js'
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

self.addEventListener('message', async (event) => {
  const port = event.ports?.[0]
  if (event.data?.type !== 'run' || !port) return

  const source = event.data.source
  let modelUrl

  try {
    if (typeof source !== 'string' || !source.trim()) {
      throw new TypeError('AI 未返回 Three.js 程序化源码')
    }

    modelUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    const modelModule = await import(modelUrl)

    if (typeof modelModule.createModel !== 'function') {
      throw new Error('源码必须导出 createModel(THREE)')
    }

    const parameters = event.data?.parameters && typeof event.data.parameters === 'object' ? event.data.parameters : {}
    const root = modelModule.createModel(THREE, parameters)
    if (!root || root.isGroup !== true) {
      throw new Error('createModel(THREE) 必须返回 THREE.Group')
    }
    if (root.parent) {
      throw new Error('模型根节点不能预先挂载到其他对象')
    }

    const modelCapabilityManifest = normalizeModelCapabilityManifest(
      modelModule.modelCapabilityManifest,
      modelModule.modelParameters,
      modelModule.environmentBindings,
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
      proceduralModelEnvironmentBindings: manifestEnvironmentBindings,
      proceduralModelCapabilityManifest: modelCapabilityManifest,
      proceduralModelCapabilityControlDocument: capabilityControlDocument,
      proceduralModelParameterValues: parameters,
    }
    root.updateMatrixWorld(true)
    root.userData.proceduralModelGeometryDiagnostics = collectProceduralModelGeometryDiagnostics(THREE, root)
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
