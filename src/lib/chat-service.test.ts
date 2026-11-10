import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { decryptRealtimeMessage, sendMessage, sendMessageRequest } from './chat-service'
import {
  encryptMessage,
  generateDeviceKeyPair,
  generateIdentityKeyPair,
  signDeviceCertificate,
  type DevicePublicKey
} from './crypto'
import { loadConversationDevices } from './device-service'

vi.mock('./device-service', () => ({ loadConversationDevices: vi.fn() }))

async function createTrustedDevice(userId: string, username: string) {
  const identity = await generateIdentityKeyPair()
  const keys = await generateDeviceKeyPair()
  const deviceId = crypto.randomUUID()
  const rootSignature = await signDeviceCertificate(identity.privateKey, {
    userId,
    deviceId,
    ecdhPublicKey: keys.publicKey
  })
  return {
    privateKey: keys.privateKey,
    identityPrivateKey: identity.privateKey,
    device: {
      userId,
      deviceId,
      username,
      identitySigningPublic: identity.publicKey,
      ecdhPublicKey: keys.publicKey,
      rootSignature
    } satisfies DevicePublicKey
  }
}

describe('message requests', () => {
  it('does not send a request when the recipient has no trusted devices', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
    const client = { rpc } as unknown as SupabaseClient
    const device = await generateDeviceKeyPair()
    const identity = await generateIdentityKeyPair()

    await expect(sendMessageRequest(
      client,
      'cccc2222dddd',
      'sender-id',
      'aaaa2222bbbb',
      {
        userId: 'sender-id',
        deviceId: 'sender-device',
        ecdhPrivateKey: device.privateKey,
        ecdhPublicKey: device.publicKey,
        identityPrivateKey: identity.privateKey,
        identityPublicKey: identity.publicKey
      },
      'Hello'
    )).rejects.toThrow('That user has no trusted devices yet.')

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('get_message_request_devices', {
      target_username: 'cccc2222dddd'
    })
  })

  it('sends encrypted messages without a saved safety-code comparison', async () => {
    const sender = await createTrustedDevice('sender-id', 'aaaa2222bbbb')
    const recipient = await createTrustedDevice('recipient-id', 'cccc2222dddd')
    vi.mocked(loadConversationDevices).mockResolvedValue([sender.device, recipient.device])

    let insertedMessage: Record<string, unknown> = {}
    const single = vi.fn(async () => ({
      data: { ...insertedMessage, created_at: '2026-11-10T00:00:00.000Z' },
      error: null
    }))
    const select = vi.fn(() => ({ single }))
    const insert = vi.fn((message: Record<string, unknown>) => {
      insertedMessage = message
      return { select }
    })
    const client = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient
    const vault = {
      userId: sender.device.userId,
      deviceId: sender.device.deviceId,
      ecdhPrivateKey: sender.privateKey,
      ecdhPublicKey: sender.device.ecdhPublicKey,
      identityPrivateKey: sender.identityPrivateKey,
      identityPublicKey: sender.device.identitySigningPublic
    }

    await expect(sendMessage(
      client,
      'conversation-id',
      sender.device.userId,
      [sender.device.userId, recipient.device.userId],
      vault,
      'Hello without safety-code setup'
    )).resolves.toMatchObject({ text: 'Hello without safety-code setup' })
    expect(insert).toHaveBeenCalledOnce()
  })

  it('decrypts signed messages without a saved safety-code comparison', async () => {
    const sender = await createTrustedDevice('sender-id', 'aaaa2222bbbb')
    const recipient = await createTrustedDevice('recipient-id', 'cccc2222dddd')
    const encrypted = await encryptMessage(
      'conversation-id',
      sender.device.userId,
      sender.device.deviceId,
      'Readable without safety-code setup',
      [recipient.device],
      sender.identityPrivateKey
    )

    await expect(decryptRealtimeMessage(
      'conversation-id',
      {
        userId: recipient.device.userId,
        deviceId: recipient.device.deviceId,
        ecdhPrivateKey: recipient.privateKey,
        ecdhPublicKey: recipient.device.ecdhPublicKey
      },
      {
        id: encrypted.id,
        sender_id: encrypted.senderId,
        sender_device_id: encrypted.senderDeviceId,
        sender_signature: encrypted.senderSignature,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        ephemeral_public_key: encrypted.ephemeralPublicKey,
        key_envelopes: encrypted.keyEnvelopes,
        created_at: '2026-11-10T00:00:00.000Z'
      },
      [sender.device, recipient.device]
    )).resolves.toMatchObject({ text: 'Readable without safety-code setup' })
  })
})
