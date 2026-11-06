const DATABASE_NAME = 'ncgxy-world-sandbox'
const DATABASE_VERSION = 1
const STORE_NAME = 'documents'

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('当前浏览器不支持本地场景存储'))
      return
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('打开本地场景数据库失败'))
  })
}

export async function saveSandboxDocument(document) {
  const database = await openDatabase()
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put({
        id: 'latest',
        document,
        savedAt: new Date().toISOString(),
      })
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error || new Error('保存场景失败'))
      transaction.onabort = () => reject(transaction.error || new Error('场景保存已取消'))
    })
  } finally {
    database.close()
  }
}

export async function loadSandboxDocument() {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get('latest')
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error || new Error('读取本地场景失败'))
    })
  } finally {
    database.close()
  }
}
