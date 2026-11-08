import type { SupabaseClient } from '@supabase/supabase-js'
import {
  decryptMessage,
  encryptMessage,
  identityFingerprint,
  verifyDeviceCertificate,
  verifyMessageSignature,
  type DevicePublicKey,
  type EncryptedMessage
} from './crypto'
import type { DeviceVault } from './device-vault'
import { loadConversationDevices } from './device-service'

export interface ConversationMember {
  user_id: string
  profiles: { username: string; display_name?: string | null } | { username: string; display_name?: string | null }[] | null
}

export interface Conversation {
  id: string
  kind: 'direct' | 'group'
  title: string | null
  created_at: string
  conversation_members: ConversationMember[]
}

export interface IncomingMessageRequest {
  request_id: string
  sender_id: string
  sender_username: string
  created_at: string
}

export function memberUsername(member: ConversationMember): string | undefined {
  const profile = member.profiles
  return Array.isArray(profile) ? profile[0]?.username : profile?.username
}

export function memberDisplayName(member: ConversationMember): string | undefined {
  const profile = member.profiles
  const displayName = Array.isArray(profile) ? profile[0]?.display_name : profile?.display_name
  return displayName?.trim() || memberUsername(member)
}

export interface ChatMessage {
  id: string
  sender_id: string
  sender_device_id: string
  sender_signature: string
  ciphertext: string
  iv: string
  ephemeral_public_key: JsonWebKey
  key_envelopes: EncryptedMessage['keyEnvelopes']
  created_at: string
  text: string | null
  untrusted: boolean
}

type StoredMessage = Omit<ChatMessage, 'text' | 'untrusted'>

export async function loadConversations(client: SupabaseClient): Promise<Conversation[]> {
  const { data, error } = await client
    .from('conversations')
    .select('id, kind, title, created_at, conversation_members(user_id, profiles(username, display_name))')
    .order('created_at', { ascending: false })
  if (error) {
    throw new Error(`Could not load conversations: ${error.message}`)
  }
  return (data ?? []) as Conversation[]
}

export async function findUser(client: SupabaseClient, username: string): Promise<{ id: string; username: string }> {
  const { data, error } = await client.rpc('find_profile_by_username', {
    candidate: username.trim().toLowerCase()
  })
  if (error) {
    throw new Error(`Could not search for that Sloppy handle: ${error.message}`)
  }
  const match = (data ?? [])[0] as { id: string; username: string } | undefined
  if (!match) {
    throw new Error('No Sloppy user was found for that handle.')
  }
  return match
}

export async function createConversation(
  client: SupabaseClient,
  usernames: string[],
  title: string
): Promise<string> {
  if (usernames.length < 1 || usernames.length > 19) {
    throw new Error('Choose between 1 and 19 other users.')
  }
  const matches = await Promise.all(usernames.map((username) => findUser(client, username)))
  const distinctUsers = [...new Map(matches.map((match) => [match.id, match])).values()]
  if (distinctUsers.length !== matches.length) {
    throw new Error('Each conversation member must be unique.')
  }
  const kind = distinctUsers.length === 1 ? 'direct' : 'group'
  const { data, error } = await client.rpc('create_conversation', {
    participant_ids: distinctUsers.map((match) => match.id),
    conversation_kind: kind,
    conversation_title: kind === 'group' ? title.trim() || null : null
  })
  if (error) {
    throw new Error(`Could not create the conversation: ${error.message}`)
  }
  if (typeof data !== 'string') {
    throw new Error('The conversation could not be created.')
  }
  return data
}

export async function loadIncomingMessageRequests(client: SupabaseClient): Promise<IncomingMessageRequest[]> {
  const { data, error } = await client.rpc('list_message_requests')
  if (error) {
    throw new Error(`Could not load message requests: ${error.message}`)
  }
  return (data ?? []) as IncomingMessageRequest[]
}

export async function sendMessageRequest(
  client: SupabaseClient,
  recipientUsername: string,
  senderId: string,
  senderUsername: string,
  vault: DeviceVault,
  plaintext: string
): Promise<void> {
  if (!vault.identityPrivateKey || !vault.identityPublicKey) {
    throw new Error('This browser is missing its account identity key.')
  }
  if (new TextEncoder().encode(plaintext).byteLength > 12000) {
    throw new Error('This message is too long to encrypt.')
  }
  const { data: recipientData, error: recipientError } = await client.rpc('get_message_request_devices', {
    target_username: recipientUsername
  })
  if (recipientError) {
    throw new Error(`Could not prepare the message request: ${recipientError.message}`)
  }
  const recipientDevices = ((recipientData ?? []) as StoredRequestDevice[]).map(mapRequestDevice)
  const { data: ownData, error: ownError } = await client.rpc('get_my_devices')
  if (ownError) {
    throw new Error(`Could not load this account's trusted devices: ${ownError.message}`)
  }
  const ownDevices = (ownData ?? []) as Array<{
    device_id: string
    ecdh_public_key: JsonWebKey
    root_signature: string | null
    approved_at: string | null
    revoked_at: string | null
  }>
  const senders: DevicePublicKey[] = ownDevices
    .filter((device) => device.approved_at && !device.revoked_at && device.root_signature)
    .map((device) => ({
      userId: senderId,
      deviceId: device.device_id,
      username: senderUsername,
      identitySigningPublic: vault.identityPublicKey!,
      ecdhPublicKey: device.ecdh_public_key,
      rootSignature: device.root_signature!
    }))
  if (!senders.some((device) => device.deviceId === vault.deviceId)) {
    throw new Error('This browser is not listed as a trusted device.')
  }
  const devices = [...senders, ...recipientDevices]
  const requestId = crypto.randomUUID()
  const encrypted = await encryptMessage(
    requestId,
    senderId,
    vault.deviceId,
    plaintext,
    devices,
    vault.identityPrivateKey,
    requestId
  )
  const { error } = await client.rpc('create_message_request', {
    requested_id: requestId,
    recipient_username: recipientUsername.trim().toLowerCase(),
    requested_device_id: vault.deviceId,
    requested_sender_signature: encrypted.senderSignature,
    requested_ciphertext: encrypted.ciphertext,
    requested_iv: encrypted.iv,
    requested_ephemeral_public_key: encrypted.ephemeralPublicKey,
    requested_key_envelopes: encrypted.keyEnvelopes
  })
  if (error) {
    throw new Error(`Could not send the message request: ${error.message}`)
  }
}

export async function decryptIncomingMessageRequest(
  client: SupabaseClient,
  requestId: string,
  senderUsername: string,
  vault: DeviceVault
): Promise<string> {
  const { data: requestData, error: requestError } = await client.rpc('get_message_request_message', {
    target_request_id: requestId
  })
  if (requestError) {
    throw new Error(`Could not open this message request: ${requestError.message}`)
  }
  const row = ((requestData ?? []) as StoredMessage[])[0]
  if (!row) {
    throw new Error('This message request is no longer available.')
  }
  const { data: deviceData, error: deviceError } = await client.rpc('get_message_request_devices', {
    target_username: senderUsername
  })
  if (deviceError) {
    throw new Error(`Could not verify the request sender: ${deviceError.message}`)
  }
  const devices = ((deviceData ?? []) as StoredRequestDevice[]).map(mapRequestDevice)
  const senderDevices = devices.filter((device) => device.userId === row.sender_id)
  if (senderDevices.length === 0) {
    throw new Error('The request sender has no available trusted device.')
  }
  for (const device of senderDevices) {
    if (!(await verifyDeviceCertificate(device))) {
      throw new Error('The request sender device identity is invalid.')
    }
  }
  const fingerprints = await Promise.all(senderDevices.map((device) => identityFingerprint(device.identitySigningPublic)))
  if (new Set(fingerprints).size !== 1) {
    throw new Error('The request sender devices have conflicting identity keys.')
  }
  const encrypted: EncryptedMessage = {
    id: row.id,
    senderId: row.sender_id,
    senderDeviceId: row.sender_device_id,
    senderSignature: row.sender_signature,
    ciphertext: row.ciphertext,
    iv: row.iv,
    ephemeralPublicKey: row.ephemeral_public_key,
    keyEnvelopes: row.key_envelopes
  }
  if (!(await verifyMessageSignature(requestId, encrypted, senderDevices[0].identitySigningPublic))) {
    throw new Error('The request message identity signature is invalid.')
  }
  const plaintext = await decryptMessage(
    requestId,
    vault.deviceId,
    vault.ecdhPrivateKey,
    encrypted,
    senderDevices[0].identitySigningPublic
  )
  if (plaintext === null) {
    throw new Error('This request was not encrypted for this browser. Ask the sender to retry from a trusted device.')
  }
  return plaintext
}

interface StoredRequestDevice {
  user_id: string
  device_id: string
  username: string
  identity_signing_public: JsonWebKey
  ecdh_public_key: JsonWebKey
  root_signature: string
}

function mapRequestDevice(device: StoredRequestDevice): DevicePublicKey {
  return {
    userId: device.user_id,
    deviceId: device.device_id,
    username: device.username,
    identitySigningPublic: device.identity_signing_public,
    ecdhPublicKey: device.ecdh_public_key,
    rootSignature: device.root_signature
  }
}

export async function respondToMessageRequest(
  client: SupabaseClient,
  requestId: string,
  action: 'accept' | 'deny' | 'block'
): Promise<void> {
  const { error } = await client.rpc('respond_to_message_request', {
    target_request_id: requestId,
    requested_action: action
  })
  if (error) {
    throw new Error(`Could not ${action} this message request: ${error.message}`)
  }
}

function messagePayload(message: EncryptedMessage) {
  return {
    id: message.id,
    sender_id: message.senderId,
    sender_device_id: message.senderDeviceId,
    sender_signature: message.senderSignature,
    ciphertext: message.ciphertext,
    iv: message.iv,
    ephemeral_public_key: message.ephemeralPublicKey,
    key_envelopes: message.keyEnvelopes
  }
}

export async function loadMessages(
  client: SupabaseClient,
  conversationId: string,
  vault: DeviceVault,
  devices: DevicePublicKey[],
  after?: string | null
): Promise<ChatMessage[]> {
  let query = client
    .from('messages')
    .select('id, sender_id, sender_device_id, sender_signature, ciphertext, iv, ephemeral_public_key, key_envelopes, created_at')
    .eq('conversation_id', conversationId)
  if (after) {
    query = query.gt('created_at', after)
  }
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) {
    throw new Error(`Could not load encrypted messages: ${error.message}`)
  }
  const rows = ((data ?? []) as StoredMessage[]).reverse()
  const messages: ChatMessage[] = []
  for (const row of rows) {
    messages.push(await decodeStoredMessage(conversationId, vault, row, devices))
  }
  return messages
}

export async function sendMessage(
  client: SupabaseClient,
  conversationId: string,
  senderId: string,
  expectedUserIds: string[],
  vault: DeviceVault,
  plaintext: string
): Promise<ChatMessage> {
  const devices = await loadConversationDevices(client, conversationId)
  if (new TextEncoder().encode(plaintext).byteLength > 12000) {
    throw new Error('This message is too long to encrypt.')
  }
  if (!devices.some((device) => device.deviceId === vault.deviceId)) {
    throw new Error('This device is missing from the trusted conversation directory.')
  }
  if (!vault.identityPublicKey) {
    throw new Error('This browser is missing its account identity key.')
  }
  if (!vault.identityPrivateKey) {
    throw new Error('This browser is missing its local signing key.')
  }
  const ownFingerprint = await identityFingerprint(vault.identityPublicKey)
  const availableUsers = new Set(devices.map((device) => device.userId))
  const missingUser = expectedUserIds.find((userId) => !availableUsers.has(userId))
  if (missingUser) {
    throw new Error('Every conversation member needs an approved device before messages can be sent.')
  }
  for (const device of devices) {
    if (device.userId === senderId) {
      if (await identityFingerprint(device.identitySigningPublic) !== ownFingerprint) {
        throw new Error('The account identity key for this device does not match the local identity.')
      }
      continue
    }
    const fingerprint = await identityFingerprint(device.identitySigningPublic)
    if (vault.peerPins?.[device.userId] !== fingerprint) {
      throw new Error('Verify this contact’s safety code before sending messages.')
    }
  }
  const encrypted = await encryptMessage(
    conversationId,
    senderId,
    vault.deviceId,
    plaintext,
    devices,
    vault.identityPrivateKey
  )
  const { data, error } = await client
    .from('messages')
    .insert({
      ...messagePayload(encrypted),
      conversation_id: conversationId,
      sender_id: senderId
    })
    .select('id, sender_id, sender_device_id, sender_signature, ciphertext, iv, ephemeral_public_key, key_envelopes, created_at')
    .single()
  if (error) {
    throw new Error(`Could not send the encrypted message: ${error.message}`)
  }
  return { ...(data as StoredMessage), text: plaintext, untrusted: false }
}

export async function decryptRealtimeMessage(
  conversationId: string,
  vault: DeviceVault,
  row: StoredMessage,
  devices: DevicePublicKey[]
): Promise<ChatMessage> {
  return decodeStoredMessage(conversationId, vault, row, devices)
}

async function decodeStoredMessage(
  conversationId: string,
  vault: DeviceVault,
  row: StoredMessage,
  devices: DevicePublicKey[]
): Promise<ChatMessage> {
  const senderDevices = devices.filter((device) => device.userId === row.sender_id)
  if (senderDevices.length === 0) {
    throw new Error('The sender identity is missing from this conversation.')
  }
  const identityFingerprints = await Promise.all(senderDevices.map((device) => identityFingerprint(device.identitySigningPublic)))
  if (new Set(identityFingerprints).size !== 1) {
    throw new Error('The sender devices have conflicting identity keys.')
  }
  const senderIdentityPublic = senderDevices[0].identitySigningPublic
  const encrypted: EncryptedMessage = {
    id: row.id,
    senderId: row.sender_id,
    senderDeviceId: row.sender_device_id,
    senderSignature: row.sender_signature,
    ciphertext: row.ciphertext,
    iv: row.iv,
    ephemeralPublicKey: row.ephemeral_public_key,
    keyEnvelopes: row.key_envelopes
  }
  if (!(await verifyMessageSignature(conversationId, encrypted, senderIdentityPublic))) {
    throw new Error('The message identity signature is invalid.')
  }
  const expectedFingerprint = row.sender_id === vault.userId && vault.identityPublicKey
    ? await identityFingerprint(vault.identityPublicKey)
    : vault.peerPins?.[row.sender_id]
  if (expectedFingerprint !== identityFingerprints[0]) {
    return { ...row, text: null, untrusted: true }
  }
  const text = await decryptMessage(
    conversationId,
    vault.deviceId,
    vault.ecdhPrivateKey,
    encrypted,
    senderIdentityPublic
  )
  return { ...row, text, untrusted: false }
}

export type { StoredMessage }
