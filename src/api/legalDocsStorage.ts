// TODO: Replace IndexedDB blob storage with ERPNext File doctype
// (api/method/upload_file) so View/Download use a real ERPNext file_url
// instead of a local browser object URL. This makes documents accessible
// across devices/browsers, not just the one that uploaded them.

const DB_NAME = 'netlink_legal_docs'
const DB_VERSION = 1
const STORE_NAME = 'documents'

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export const storeFileBlob = async (key: string, file: File): Promise<void> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put({ key, blob: file, name: file.name, type: file.type, storedAt: new Date().toISOString() })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export const getFileBlob = async (key: string): Promise<{ blob: Blob; name: string; type: string } | null> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(key)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
  })
}

export const getFileObjectUrl = async (key: string): Promise<string | null> => {
  const result = await getFileBlob(key)
  if (!result) return null
  return URL.createObjectURL(result.blob)
}

export const deleteFileBlob = async (key: string): Promise<void> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
