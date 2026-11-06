import * as THREE from 'three'

const MAX_SOURCE_LENGTH = 120000

/**
 * Run generated Three.js code in a dedicated module Worker, never in the
 * page's Window context. The Worker has no DOM or direct scene access.
 *
 * The Worker is a containment boundary for ordinary generated model code,
 * not a hardened sandbox for adversarial JavaScript. Network APIs are
 * restricted in the Worker as defense in depth, but production deployments
 * should additionally enforce an appropriate CSP/isolated origin policy.
 *
 * Only Object3D.toJSON() crosses back to the page; ObjectLoader rebuilds a
 * real THREE.Group. No GLB conversion or legacy model-spec validation.
 */
export async function executeProceduralModel(source, options = {}) {
  if (typeof source !== 'string' || !source.trim()) {
    throw new TypeError('AI 未返回 Three.js 程序化源码')
  }
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new RangeError('Three.js 程序化源码超过 120 KB')
  }

  const timeoutMs = Math.min(60000, Math.max(5000, Number(options.timeoutMs) || 25000))

  return new Promise((resolve, reject) => {
    let settled = false
    let timer

    const worker = new Worker(
      new URL('./proceduralModel.worker.js', import.meta.url),
      { type: 'module', name: 'ncgxy-procedural-model' },
    )

    const cleanup = () => {
      clearTimeout(timer)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      worker.removeEventListener('messageerror', onMessageError)
      worker.terminate()
    }

    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    }

    const onMessage = (event) => {
      if (settled) return
      const data = event.data || {}
      if (!data.ok) {
        const detail = data.stack ? `\n${data.stack}` : ''
        fail(new Error((data.error || '程序化模型执行失败') + detail))
        return
      }

      try {
        const root = new THREE.ObjectLoader().parse(data.serialized)
        if (!root?.isGroup) {
          throw new Error('模型序列化结果无法还原为 THREE.Group')
        }

        root.name = data.name || root.name || 'AI 生成模型'
        root.traverse((object) => {
          if (object.isMesh) {
            object.castShadow = true
            object.receiveShadow = true
          }
        })

        settled = true
        cleanup()
        resolve(root)
      } catch (error) {
        fail(error)
      }
    }

    const onError = (event) => {
      fail(new Error(event.message || '模型执行 Worker 启动或运行失败'))
    }

    const onMessageError = () => {
      fail(new Error('模型执行 Worker 返回的数据无法解析'))
    }

    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.addEventListener('messageerror', onMessageError)

    timer = setTimeout(() => {
      fail(new Error('模型代码执行超时（Worker 已终止）'))
    }, timeoutMs)

    try {
      worker.postMessage({ type: 'run', source })
    } catch (error) {
      fail(error)
    }
  })
}
