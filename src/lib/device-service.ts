import type { SupabaseClient } from '@supabase/supabase-js'
import {
  decryptRootKeyTransfer,
  encryptRootKeyTransfer,
  generateDeviceKeyPair,
  generateIdentityKeyPair,
  identityFingerprint,
  signDeviceCertificate,
  verifyDeviceCertificate,
  type DevicePublicKey,
  type KeyEnvelope
} from './crypto'
import { loadDeviceVault, saveDeviceVault, type DeviceVault } from './device-vault'

interface ProfileRow {
  identity_signing_public: JsonWebKey | null
}

interface StoredDevice {
  device_id: string
  label: string
  ecdh_public_key: JsonWebKey
  root_signature: string | null
  wrapped_root_private_key: (KeyEnvelope & { ephemeralPublicKey: JsonWebKey }) | null
  approved_at: string | null
  revoked_at: string | null
}

export type DeviceState =
  | { status: 'active'; vault: DeviceVault; pendingDevices: StoredDevice[]; trustedDevices: StoredDevice[] }
  | { status: 'pending'; vault: DeviceVault }

const activationLocks = new Map<string, Promise<DeviceState>>()

async function getProfile(client: SupabaseClient, userId: string): Promise<ProfileRow> {
  const { data, error } = await client
    .from('profiles')
    .select('identity_signing_public')
    .eq('id', userId)
    .single()
  if (error) {
    throw new Error(`Could not load your profile: ${error.message}`)
  }
  return data as ProfileRow
}

async function getStoredDevices(client: SupabaseClient): Promise<StoredDevice[]> {
  const { data, error } = await client.rpc('get_my_devices')
  if (error) {
    throw new Error(`Could not load trusted devices: ${error.message}`)
  }
  return (data ?? []) as StoredDevice[]
}

function publicDevice(
  userId: string,
  deviceId: string,
  username: string,
  identitySigningPublic: JsonWebKey,
  ecdhPublicKey: JsonWebKey,
  rootSignature: string
): DevicePublicKey {
  return { userId, deviceId, username, identitySigningPublic, ecdhPublicKey, rootSignature }
}

export async function activateOrRequestDevice(
  client: SupabaseClient,
  userId: string,
  username: string
): Promise<DeviceState> {
  const existingActivation = activationLocks.get(userId)
  if (existingActivation) {
    return existingActivation
  }
  const activation = typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request(`sloppy-device:${userId}`, { mode: 'exclusive' }, () => activateOrRequestDeviceOnce(client, userId, username))
    : activateOrRequestDeviceOnce(client, userId, username)
  activationLocks.set(userId, activation)
  try {
    return await activation
  } finally {
    if (activationLocks.get(userId) === activation) {
      activationLocks.delete(userId)
    }
  }
}

async function activateOrRequestDeviceOnce(
  client: SupabaseClient,
  userId: string,
  username: string
): Promise<DeviceState> {
  const profile = await getProfile(client, userId)
  let vault = await loadDeviceVault(userId)

  if (!vault) {
    const device = await generateDeviceKeyPair()
    vault = {
      userId,
      deviceId: crypto.randomUUID(),
      ecdhPrivateKey: device.privateKey,
      ecdhPublicKey: device.publicKey
    }
  }

  if (profile.identity_signing_public === null) {
    if (!vault.identityPrivateKey || !vault.identityPublicKey) {
      const identity = await generateIdentityKeyPair()
      vault.identityPrivateKey = identity.privateKey
      vault.identityPublicKey = identity.publicKey
    }
    await saveDeviceVault(vault)
    const rootSignature = await signDeviceCertificate(vault.identityPrivateKey, {
      userId,
      deviceId: vault.deviceId,
      ecdhPublicKey: vault.ecdhPublicKey
    })
    const { error } = await client.rpc('initialize_identity_device', {
      requested_device_id: vault.deviceId,
      requested_label: 'This browser',
      requested_ecdh_public_key: vault.ecdhPublicKey,
      requested_identity_signing_public: vault.identityPublicKey,
      requested_root_signature: rootSignature
    })
    if (error) {
      throw new Error(`Could not initialize this device: ${error.message}`)
    }
    const initializedDevices = await getStoredDevices(client)
    return {
      status: 'active',
      vault,
      pendingDevices: initializedDevices.filter((device) => !device.approved_at),
      trustedDevices: initializedDevices.filter((device) => device.approved_at && !device.revoked_at)
    }
  }

  if (vault.identityPrivateKey && vault.identityPublicKey) {
    const storedFingerprint = await identityFingerprint(vault.identityPublicKey)
    const serverFingerprint = await identityFingerprint(profile.identity_signing_public)
    if (storedFingerprint !== serverFingerprint) {
      delete vault.identityPrivateKey
    }
  }
  vault.identityPublicKey = profile.identity_signing_public
  const storedDevices = await getStoredDevices(client)
  const storedDevice = storedDevices.find((device) => device.device_id === vault.deviceId)

  if (!storedDevice) {
    if (vault.identityPrivateKey) {
      throw new Error('This browser key is no longer registered. Sign out and request device approval again.')
    }
    await saveDeviceVault(vault)
    const { error } = await client.rpc('request_device_enrollment', {
      requested_device_id: vault.deviceId,
      requested_label: 'New browser',
      requested_ecdh_public_key: vault.ecdhPublicKey
    })
    if (error) {
      throw new Error(`Could not request device approval: ${error.message}`)
    }
    return { status: 'pending', vault }
  }

  if (storedDevice.revoked_at) {
    throw new Error('This browser has been revoked. Sign out and request approval from another browser.')
  }

  if (!storedDevice.approved_at || !storedDevice.root_signature) {
    await saveDeviceVault(vault)
    return { status: 'pending', vault }
  }

  if (!vault.identityPrivateKey) {
    if (!storedDevice.wrapped_root_private_key) {
      throw new Error('Device approval is missing its encrypted identity key.')
    }
    vault.identityPrivateKey = await decryptRootKeyTransfer(
      userId,
      vault.deviceId,
      vault.ecdhPrivateKey,
      storedDevice.wrapped_root_private_key
    )
  }

  const trustedDevice = publicDevice(
    userId,
    vault.deviceId,
    username,
    profile.identity_signing_public,
    storedDevice.ecdh_public_key,
    storedDevice.root_signature
  )
  if (!(await verifyDeviceCertificate(trustedDevice))) {
    throw new Error('This device failed its identity signature check.')
  }
  await saveDeviceVault(vault)
  return {
    status: 'active',
    vault,
    pendingDevices: storedDevices.filter((device) => !device.approved_at),
    trustedDevices: storedDevices.filter((device) => device.approved_at && !device.revoked_at)
  }
}

export async function approveDevice(
  client: SupabaseClient,
  vault: DeviceVault,
  target: StoredDevice
): Promise<void> {
  if (!vault.identityPrivateKey) {
    throw new Error('This device does not hold the account identity key.')
  }
  const rootSignature = await signDeviceCertificate(vault.identityPrivateKey, {
    userId: vault.userId,
    deviceId: target.device_id,
    ecdhPublicKey: target.ecdh_public_key
  })
  const wrappedRootPrivateKey = await encryptRootKeyTransfer(
    vault.userId,
    target.device_id,
    target.ecdh_public_key,
    vault.identityPrivateKey
  )
  const { error } = await client.rpc('approve_device_enrollment', {
    requested_device_id: target.device_id,
    requested_signer_device_id: vault.deviceId,
    requested_root_signature: rootSignature,
    requested_wrapped_root_private_key: wrappedRootPrivateKey
  })
  if (error) {
    throw new Error(`Could not approve this device: ${error.message}`)
  }
}

export async function revokeDevice(
  client: SupabaseClient,
  vault: DeviceVault,
  targetDeviceId: string
): Promise<void> {
  const { error } = await client.rpc('revoke_trusted_device', {
    requested_device_id: targetDeviceId,
    requested_signer_device_id: vault.deviceId
  })
  if (error) {
    throw new Error(`Could not revoke this device: ${error.message}`)
  }
}

export async function loadConversationDevices(
  client: SupabaseClient,
  conversationId: string
): Promise<DevicePublicKey[]> {
  const { data, error } = await client.rpc('get_conversation_devices', {
    target_conversation_id: conversationId
  })
  if (error) {
    throw new Error(`Could not load conversation devices: ${error.message}`)
  }
  const devices = (data ?? []) as Array<{
    user_id: string
    device_id: string
    username: string
    identity_signing_public: JsonWebKey
    ecdh_public_key: JsonWebKey
    root_signature: string
  }>
  const verified: DevicePublicKey[] = []
  for (const device of devices) {
    const candidate = publicDevice(
      device.user_id,
      device.device_id,
      device.username,
      device.identity_signing_public,
      device.ecdh_public_key,
      device.root_signature
    )
    if (!(await verifyDeviceCertificate(candidate))) {
      throw new Error('A trusted device identity signature is invalid.')
    }
    verified.push(candidate)
  }
  return verified
}

export type { StoredDevice }
