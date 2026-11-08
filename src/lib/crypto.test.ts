import { describe, expect, it } from 'vitest'
import { authEmailForUsername, generateUsername, getPasswordRequirements, isValidUsername, registrationErrorMessage, validatePassword } from './auth'
import {
  decryptMessage,
  decryptRootKeyTransfer,
  encryptMessage,
  encryptRootKeyTransfer,
  generateDeviceKeyPair,
  generateIdentityKeyPair,
  identityFingerprint,
  signDeviceCertificate,
  verifyDeviceCertificate,
  type DevicePublicKey
} from './crypto'

async function createTrustedDevice(userId: string, username: string): Promise<{
  privateKey: CryptoKey
  identityPrivateKey: CryptoKey
  device: DevicePublicKey
}> {
  const identity = await generateIdentityKeyPair()
  const deviceKeyPair = await generateDeviceKeyPair()
  const deviceId = crypto.randomUUID()
  const rootSignature = await signDeviceCertificate(identity.privateKey, {
    userId,
    deviceId,
    ecdhPublicKey: deviceKeyPair.publicKey
  })
  return {
    privateKey: deviceKeyPair.privateKey,
    identityPrivateKey: identity.privateKey,
    device: {
      userId,
      deviceId,
      username,
      identitySigningPublic: identity.publicKey,
      ecdhPublicKey: deviceKeyPair.publicKey,
      rootSignature
    }
  }
}

describe('username authentication helpers', () => {
  it('generates searchable 12-character usernames and maps them to synthetic aliases', () => {
    const username = generateUsername()
    expect(username).toHaveLength(12)
    expect(isValidUsername(username)).toBe(true)
    expect(authEmailForUsername(username)).toBe(`${username}@auth.sloppy.chat`)
  })

  it('rejects malformed usernames before building an auth alias', () => {
    expect(() => authEmailForUsername('not-a-handle')).toThrow('Enter a valid Sloppy username.')
  })

  it('requires a long password with mixed case, a number, and a special character', () => {
    expect(validatePassword('StrongPassword1!')).toBeNull()
    expect(validatePassword('short1!')).toBe('Use a password with at least 12 characters.')
    expect(validatePassword('lowercasepassword1!')).toBe('Add at least one uppercase letter.')
    expect(validatePassword('UPPERCASEPASSWORD1!')).toBe('Add at least one lowercase letter.')
    expect(validatePassword('StrongPassword!!')).toBe('Add at least one number.')
    expect(validatePassword('StrongPassword12')).toBe('Add at least one special character.')
  })

  it('enforces the Supabase password byte limit', () => {
    const oversizedPassword = 'Aa1!'.repeat(19)
    expect(getPasswordRequirements(oversizedPassword).maximumBytes).toBe(false)
    expect(validatePassword(oversizedPassword)).toBe('Use a password no longer than 72 bytes.')
  })

  it('explains how to resolve Supabase email-confirmation registration errors', () => {
    expect(registrationErrorMessage('email rate limit exceeded')).toContain('Turn off Confirm email')
    expect(registrationErrorMessage('Email address is invalid')).toContain('Turn off Confirm email')
    expect(registrationErrorMessage('Password is too weak')).toBe('Password is too weak')
  })
})

describe('encrypted message envelopes', () => {
  it('encrypts to trusted devices and decrypts only for included devices', async () => {
    const sender = await createTrustedDevice('user-a', 'aaaa2222bbbb')
    const receiver = await createTrustedDevice('user-b', 'cccc2222dddd')
    const lateDevice = await generateDeviceKeyPair()
    const message = await encryptMessage(
      'conversation-a',
      sender.device.userId,
      sender.device.deviceId,
      'Only the recipient can read this.',
      [sender.device, receiver.device],
      sender.identityPrivateKey
    )

    await expect(decryptMessage(
      'conversation-a',
      receiver.device.deviceId,
      receiver.privateKey,
      message,
      sender.device.identitySigningPublic
    )).resolves.toBe('Only the recipient can read this.')
    await expect(decryptMessage(
      'conversation-a',
      crypto.randomUUID(),
      lateDevice.privateKey,
      message,
      sender.device.identitySigningPublic
    )).resolves.toBeNull()
  })

  it('supports a request id as both the future conversation and message id', async () => {
    const sender = await createTrustedDevice('user-a', 'aaaa2222bbbb')
    const receiver = await createTrustedDevice('user-b', 'cccc2222dddd')
    const requestId = crypto.randomUUID()
    const message = await encryptMessage(
      requestId,
      sender.device.userId,
      sender.device.deviceId,
      'Request message.',
      [receiver.device],
      sender.identityPrivateKey,
      requestId
    )

    expect(message.id).toBe(requestId)
    await expect(decryptMessage(
      requestId,
      receiver.device.deviceId,
      receiver.privateKey,
      message,
      sender.device.identitySigningPublic
    )).resolves.toBe('Request message.')
  })

  it('rejects an invalid device identity signature', async () => {
    const trusted = await createTrustedDevice('user-a', 'aaaa2222bbbb')
    const altered = {
      ...trusted.device,
      ecdhPublicKey: (await generateDeviceKeyPair()).publicKey
    }
    await expect(verifyDeviceCertificate(altered)).resolves.toBe(false)
  })

  it('authenticates sender and conversation metadata before decrypting', async () => {
    const sender = await createTrustedDevice('user-a', 'aaaa2222bbbb')
    const receiver = await createTrustedDevice('user-b', 'cccc2222dddd')
    const message = await encryptMessage(
      'conversation-a',
      sender.device.userId,
      sender.device.deviceId,
      'Authenticated content.',
      [receiver.device],
      sender.identityPrivateKey
    )
    await expect(decryptMessage(
      'conversation-b',
      receiver.device.deviceId,
      receiver.privateKey,
      message,
      sender.device.identitySigningPublic
    )).rejects.toThrow('message identity signature is invalid')
    await expect(decryptMessage(
      'conversation-a',
      receiver.device.deviceId,
      receiver.privateKey,
      { ...message, senderId: 'user-c' },
      sender.device.identitySigningPublic
    )).rejects.toThrow('message identity signature is invalid')
  })

  it('produces stable safety fingerprints for the same public identity key', async () => {
    const identity = await generateIdentityKeyPair()
    const first = await identityFingerprint(identity.publicKey)
    const reordered = Object.fromEntries(Object.entries(identity.publicKey).reverse()) as JsonWebKey
    await expect(identityFingerprint(reordered)).resolves.toBe(first)
  })

  it('transfers the signing identity only inside an encrypted device envelope', async () => {
    const identity = await generateIdentityKeyPair()
    const newDevice = await generateDeviceKeyPair()
    const transfer = await encryptRootKeyTransfer(
      'user-a',
      'device-b',
      newDevice.publicKey,
      identity.privateKey
    )
    const importedIdentity = await decryptRootKeyTransfer(
      'user-a',
      'device-b',
      newDevice.privateKey,
      transfer
    )
    const device = await generateDeviceKeyPair()
    const deviceId = crypto.randomUUID()
    const rootSignature = await signDeviceCertificate(importedIdentity, {
      userId: 'user-a',
      deviceId,
      ecdhPublicKey: device.publicKey
    })
    await expect(verifyDeviceCertificate({
      userId: 'user-a',
      deviceId,
      username: 'aaaa2222bbbb',
      identitySigningPublic: identity.publicKey,
      ecdhPublicKey: device.publicKey,
      rootSignature
    })).resolves.toBe(true)
  })
})
