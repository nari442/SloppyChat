export interface DeviceVault {
  userId: string
  deviceId: string
  ecdhPrivateKey: CryptoKey
  ecdhPublicKey: JsonWebKey
  identityPrivateKey?: CryptoKey
  identityPublicKey?: JsonWebKey
  peerPins?: Record<string, string>
}

function openVaultDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('sloppy-private-vault', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('devices', { keyPath: 'userId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to open the local key vault.'))
  })
}

export async function loadDeviceVault(userId: string): Promise<DeviceVault | undefined> {
  const database = await openVaultDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('devices', 'readonly')
    const request = transaction.objectStore('devices').get(userId) as IDBRequest<DeviceVault | undefined>
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to read the local key vault.'))
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error('Unable to read the local key vault.'))
    }
  })
}

export async function saveDeviceVault(vault: DeviceVault): Promise<void> {
  const database = await openVaultDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('devices', 'readwrite')
    transaction.objectStore('devices').put(vault)
    transaction.oncomplete = () => {
      database.close()
      resolve()
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error('Unable to save the local key vault.'))
    }
    transaction.onabort = () => {
      database.close()
      reject(transaction.error ?? new Error('Saving the local key vault was cancelled.'))
    }
  })
}
