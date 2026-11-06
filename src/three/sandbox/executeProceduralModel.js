import * as THREE from 'three'

const MAX_SOURCE_LENGTH = 120000

/**
 * Run generated Three.js code in a dedicated module Worker, never in the
 * page's Window context. The Worker has no DOM or direct scene access.
 *
 * A MessageChannel is used for the task protocol: the worker receives port2,
 * and the page listens on port1. Worker messages and task results are separate
 * channels so worker startup errors remain observable on the Worker itself.
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

  // Model source generation happens on the backend before this function runs.
  // This timeout only covers browser Worker startup, execution and serialization.
  const timeoutMs = Math.min(120000, Math.max(5000, Number(options.timeoutMs) || 60000))

  return new Promise((resolve, reject) => {
    let settled = false
    let timer
    const channel = new MessageChannel()
    const resultPort = channel.port1

    const worker = new Worker(
      new URL('./proceduralModel.worker.js', import.meta.url),
      { type: 'module', name: 'ncgxy-procedural-model' },
    )

    const cleanup = () => {
      clearTimeout(timer)
      resultPort.removeEventListener('message', onMessage)
      resultPort.removeEventListener('messageerror', onMessageError)
      worker.removeEventListener('error', onError)
      worker.removeEventListener('messageerror', onWorkerMessageError)
      resultPort.close()
      channel.port2.close()
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
        const detail = data.stack ? `\\n${data.stack}` : ''
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

    const onWorkerMessageError = () => {
      fail(new Error('模型执行 Worker 无法解析主线程发送的任务'))
    }

    resultPort.addEventListener('message', onMessage)
    resultPort.addEventListener('messageerror', onMessageError)
    resultPort.start()
    worker.addEventListener('error', onError)
    worker.addEventListener('messageerror', onWorkerMessageError)

    timer = setTimeout(() => {
      fail(new Error(`模型代码执行超时（${Math.round(timeoutMs / 1000)} 秒，Worker 已终止）`))
    }, timeoutMs)

    try {
      // IMPORTANT: transfer port2. The worker responds through this port,
      // not through the Worker global message channel.
      worker.postMessage({ type: 'run', source }, [channel.port2])
    } catch (error) {
      fail(error)
    }
  })
}
