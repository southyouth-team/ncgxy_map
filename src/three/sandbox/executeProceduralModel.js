import * as THREE from 'three'
import threeModuleSource from 'three?raw'

const RESULT_CHANNEL = 'ncgxy-procedural-model-result'
const MAX_SOURCE_LENGTH = 120000

/**
 * Execute AI-authored Three.js source in a sandboxed opaque-origin iframe and
 * a terminable module Worker. The worker has no DOM/storage and its CSP blocks
 * network connections. Only Object3D.toJSON() crosses back to the host; the
 * host rebuilds a real THREE.Group with ObjectLoader (no GLB conversion).
 */
export async function executeProceduralModel(source, options = {}) {
  if (typeof source !== 'string' || !source.trim()) {
    throw new TypeError('AI 未返回 Three.js 程序化源码')
  }
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new RangeError('Three.js 程序化源码超过 120 KB')
  }

  const timeoutMs = Math.min(60000, Math.max(5000, Number(options.timeoutMs) || 25000))
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('')
  const workerSource = `
const threeSource = ${JSON.stringify(threeModuleSource)};
const modelSource = ${JSON.stringify(source)};
self.addEventListener('message', async (event) => {
  const port = event.ports && event.ports[0];
  if (event.data?.type !== 'run' || !port) return;
  const threeUrl = URL.createObjectURL(new Blob([threeSource], { type: 'text/javascript' }));
  const modelUrl = URL.createObjectURL(new Blob([modelSource], { type: 'text/javascript' }));
  try {
    const THREE = await import(threeUrl);
    const modelModule = await import(modelUrl);
    if (typeof modelModule.createModel !== 'function') throw new Error('源码必须导出 createModel(THREE)');
    const root = modelModule.createModel(THREE);
    if (!root || root.isGroup !== true) throw new Error('createModel(THREE) 必须返回 THREE.Group');
    if (root.parent) throw new Error('模型根节点不能预先挂载到其他对象');
    root.updateMatrixWorld(true);
    port.postMessage({ ok: true, serialized: root.toJSON(), name: root.userData?.assetName || root.name || 'AI 生成模型' });
  } catch (error) {
    port.postMessage({ ok: false, error: error?.message || String(error) });
  } finally {
    URL.revokeObjectURL(threeUrl);
    URL.revokeObjectURL(modelUrl);
    port.close();
  }
}, { once: true });
`

  const frameBootstrap = `
const nonce = ${JSON.stringify(nonce)};
const workerSource = ${JSON.stringify(workerSource)};
const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
const worker = new Worker(workerUrl, { type: 'module' });
const channel = new MessageChannel();
let finished = false;
const finish = (result) => {
  if (finished) return;
  finished = true;
  worker.terminate();
  URL.revokeObjectURL(workerUrl);
  channel.port1.close();
  parent.postMessage({ channel: ${JSON.stringify(RESULT_CHANNEL)}, nonce, ...result }, '*');
};
channel.port1.onmessage = (event) => finish(event.data || { ok: false, error: '模型执行器返回空结果' });
worker.addEventListener('error', (event) => finish({ ok: false, error: event.message || '模型执行 Worker 异常' }));
worker.postMessage({ type: 'run' }, [channel.port2]);
setTimeout(() => finish({ ok: false, error: '模型代码执行超时' }), ${timeoutMs - 1000});
`

  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:-10px;border:0;opacity:0;pointer-events:none'
  const safeFrameBootstrap = frameBootstrap.replaceAll('</script', '<\\/script')
  frame.srcdoc = `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; navigate-to 'none'">
<script>${safeFrameBootstrap}</script>`

  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(parentTimer)
      frame.remove()
    }
    const fail = error => {
      if (settled) return
      settled = true
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    const onMessage = event => {
      if (event.source !== frame.contentWindow || event.origin !== 'null') return
      const data = event.data
      if (data?.channel !== RESULT_CHANNEL || data?.nonce !== nonce) return
      if (!data.ok) {
        fail(new Error(data.error || '程序化模型执行失败'))
        return
      }
      try {
        const root = new THREE.ObjectLoader().parse(data.serialized)
        if (!root?.isGroup) throw new Error('模型序列化结果无法还原为 THREE.Group')
        root.name = data.name || root.name || 'AI 生成模型'
        root.traverse(object => {
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
    const parentTimer = setTimeout(() => fail(new Error('程序化模型执行器响应超时')), timeoutMs)
    window.addEventListener('message', onMessage)
    document.body.append(frame)
  })
}
