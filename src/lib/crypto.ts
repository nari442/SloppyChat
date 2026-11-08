const encoder = new TextEncoder()
const decoder = new TextDecoder()

export interface DevicePublicKey {
  userId: string
  deviceId: string
  username: string
  identitySigningPublic: JsonWebKey
  ecdhPublicKey: JsonWebKey
  rootSignature: string
}

export interface KeyEnvelope {
  salt: string
  iv: string
  ciphertext: string
}

export interface EncryptedMessage {
  id: string
  senderId: string
  senderDeviceId: string
  senderSignature: string
  ciphertext: string
  iv: string
  ephemeralPublicKey: JsonWebKey
  keyEnvelopes: Record<string, KeyEnvelope>
}

export interface DeviceKeyPair {
  privateKey: CryptoKey
  publicKey: JsonWebKey
}

export interface IdentityKeyPair {
  privateKey: CryptoKey
  publicKey: JsonWebKey
}

function bytesToBase64(bytes: Uint8Array<ArrayBufferLike>): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export async function identityFingerprint(publicKey: JsonWebKey): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonicalize(publicKey))))
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return hex.match(/.{1,4}/g)?.join(' ') ?? hex
}

function deviceCertificate(device: Pick<DevicePublicKey, 'userId' | 'deviceId' | 'ecdhPublicKey'>): Uint8Array<ArrayBuffer> {
  return encoder.encode(canonicalize({
    userId: device.userId,
    deviceId: device.deviceId,
    ecdhPublicKey: device.ecdhPublicKey
  }))
}

function wrappingInfo(
  conversationId: string,
  messageId: string,
  senderId: string,
  senderDeviceId: string,
  recipientDeviceId: string
): Uint8Array<ArrayBuffer> {
  return encoder.encode(`sloppy-message-key-v1:${conversationId}:${messageId}:${senderId}:${senderDeviceId}:${recipientDeviceId}`)
}

function messageSignaturePayload(conversationId: string, message: Omit<EncryptedMessage, 'senderSignature'>): Uint8Array<ArrayBuffer> {
  return encoder.encode(canonicalize({
    version: 1,
    conversationId,
    id: message.id,
    senderId: message.senderId,
    senderDeviceId: message.senderDeviceId,
    ciphertext: message.ciphertext,
    iv: message.iv,
    ephemeralPublicKey: message.ephemeralPublicKey,
    keyEnvelopes: message.keyEnvelopes
  }))
}

export async function verifyMessageSignature(
  conversationId: string,
  message: EncryptedMessage,
  senderIdentityPublic: JsonWebKey
): Promise<boolean> {
  const senderIdentityKey = await crypto.subtle.importKey(
    'jwk',
    senderIdentityPublic,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  )
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    senderIdentityKey,
    base64ToBytes(message.senderSignature),
    messageSignaturePayload(conversationId, message)
  )
}

async function deriveWrappingKey(
  sharedSecret: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function generateDeviceKeyPair(): Promise<DeviceKeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  )
  return {
    privateKey: pair.privateKey,
    publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey)
  }
}

export async function generateIdentityKeyPair(): Promise<IdentityKeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )
  return {
    privateKey: pair.privateKey,
    publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey)
  }
}

export async function signDeviceCertificate(
  identityPrivateKey: CryptoKey,
  device: Pick<DevicePublicKey, 'userId' | 'deviceId' | 'ecdhPublicKey'>
): Promise<string> {
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    identityPrivateKey,
    deviceCertificate(device)
  )
  return bytesToBase64(new Uint8Array(signature))
}

export async function verifyDeviceCertificate(device: DevicePublicKey): Promise<boolean> {
  const identityPublicKey = await crypto.subtle.importKey(
    'jwk',
    device.identitySigningPublic,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  )
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    identityPublicKey,
    base64ToBytes(device.rootSignature),
    deviceCertificate(device)
  )
}

export async function encryptMessage(
  conversationId: string,
  senderId: string,
  senderDeviceId: string,
  plaintext: string,
  recipients: DevicePublicKey[],
  identityPrivateKey: CryptoKey,
  messageId = crypto.randomUUID()
): Promise<EncryptedMessage> {
  if (recipients.length === 0) {
    throw new Error('No approved devices are available for this conversation.')
  }
  const id = messageId
  const messageKeyBytes = crypto.getRandomValues(new Uint8Array(32))
  try {
    const messageKey = await crypto.subtle.importKey('raw', messageKeyBytes, { name: 'AES-GCM' }, false, ['encrypt'])
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const bodyAad = encoder.encode(`sloppy-message-v1:${conversationId}:${id}:${senderId}:${senderDeviceId}`)
    const plaintextBytes = encoder.encode(plaintext)
    let ciphertext: ArrayBuffer
    try {
      ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: bodyAad },
        messageKey,
        plaintextBytes
      )
    } finally {
      plaintextBytes.fill(0)
    }
    const ephemeralPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits']
    )
    const ephemeralPublicKey = await crypto.subtle.exportKey('jwk', ephemeralPair.publicKey)
    const keyEnvelopes: Record<string, KeyEnvelope> = {}

    for (const recipient of recipients) {
      if (!(await verifyDeviceCertificate(recipient))) {
        throw new Error('An unverified trusted device was found.')
      }
      const recipientPublicKey = await crypto.subtle.importKey(
        'jwk',
        recipient.ecdhPublicKey,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        []
      )
      const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
        { name: 'ECDH', public: recipientPublicKey },
        ephemeralPair.privateKey,
        256
      ))
      try {
        const salt = crypto.getRandomValues(new Uint8Array(16))
        const info = wrappingInfo(conversationId, id, senderId, senderDeviceId, recipient.deviceId)
        const wrappingKey = await deriveWrappingKey(sharedSecret, salt, info)
        const envelopeIv = crypto.getRandomValues(new Uint8Array(12))
        const wrappedKey = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: envelopeIv, additionalData: info },
          wrappingKey,
          messageKeyBytes
        )
        keyEnvelopes[recipient.deviceId] = {
          salt: bytesToBase64(salt),
          iv: bytesToBase64(envelopeIv),
          ciphertext: bytesToBase64(new Uint8Array(wrappedKey))
        }
      } finally {
        sharedSecret.fill(0)
      }
    }

    const unsignedMessage = {
      id,
      senderId,
      senderDeviceId,
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
      iv: bytesToBase64(iv),
      ephemeralPublicKey,
      keyEnvelopes
    }
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      identityPrivateKey,
      messageSignaturePayload(conversationId, unsignedMessage)
    )
    return { ...unsignedMessage, senderSignature: bytesToBase64(new Uint8Array(signature)) }
  } finally {
    messageKeyBytes.fill(0)
  }
}

export async function decryptMessage(
  conversationId: string,
  recipientDeviceId: string,
  recipientPrivateKey: CryptoKey,
  message: EncryptedMessage,
  senderIdentityPublic: JsonWebKey
): Promise<string | null> {
  if (!(await verifyMessageSignature(conversationId, message, senderIdentityPublic))) {
    throw new Error('The message identity signature is invalid.')
  }
  const envelope = message.keyEnvelopes[recipientDeviceId]
  if (!envelope) {
    return null
  }
  const ephemeralPublicKey = await crypto.subtle.importKey(
    'jwk',
    message.ephemeralPublicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: ephemeralPublicKey },
    recipientPrivateKey,
    256
  ))
  let messageKeyBytes: Uint8Array<ArrayBuffer> | undefined
  try {
    const salt = base64ToBytes(envelope.salt)
    const actualInfo = wrappingInfo(conversationId, message.id, message.senderId, message.senderDeviceId, recipientDeviceId)
    const wrappingKey = await deriveWrappingKey(sharedSecret, salt, actualInfo)
    messageKeyBytes = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(envelope.iv), additionalData: actualInfo },
      wrappingKey,
      base64ToBytes(envelope.ciphertext)
    ))
    const messageKey = await crypto.subtle.importKey('raw', messageKeyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
    const bodyAad = encoder.encode(`sloppy-message-v1:${conversationId}:${message.id}:${message.senderId}:${message.senderDeviceId}`)
    const plaintext = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(message.iv), additionalData: bodyAad },
      messageKey,
      base64ToBytes(message.ciphertext)
    ))
    try {
      return decoder.decode(plaintext)
    } finally {
      plaintext.fill(0)
    }
  } finally {
    messageKeyBytes?.fill(0)
    sharedSecret.fill(0)
  }
}

export async function encryptRootKeyTransfer(
  userId: string,
  recipientDeviceId: string,
  recipientPublicKey: JsonWebKey,
  identityPrivateKey: CryptoKey
): Promise<KeyEnvelope & { ephemeralPublicKey: JsonWebKey }> {
  const ephemeralPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  )
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    recipientPublicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    ephemeralPair.privateKey,
    256
  ))
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const info = encoder.encode(`sloppy-device-root-v1:${userId}:${recipientDeviceId}`)
    const wrappingKey = await deriveWrappingKey(sharedSecret, salt, info)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const privateJwk = await crypto.subtle.exportKey('jwk', identityPrivateKey)
    const privateJwkBytes = encoder.encode(JSON.stringify(privateJwk))
    let ciphertext: ArrayBuffer
    try {
      ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: info },
        wrappingKey,
        privateJwkBytes
      )
    } finally {
      privateJwkBytes.fill(0)
    }
    return {
      ephemeralPublicKey: await crypto.subtle.exportKey('jwk', ephemeralPair.publicKey),
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext))
    }
  } finally {
    sharedSecret.fill(0)
  }
}

export async function decryptRootKeyTransfer(
  userId: string,
  deviceId: string,
  devicePrivateKey: CryptoKey,
  envelope: KeyEnvelope & { ephemeralPublicKey: JsonWebKey }
): Promise<CryptoKey> {
  const ephemeralPublicKey = await crypto.subtle.importKey(
    'jwk',
    envelope.ephemeralPublicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: ephemeralPublicKey },
    devicePrivateKey,
    256
  ))
  const info = encoder.encode(`sloppy-device-root-v1:${userId}:${deviceId}`)
  let privateJwkBytes: Uint8Array<ArrayBuffer> | undefined
  try {
    const wrappingKey = await deriveWrappingKey(sharedSecret, base64ToBytes(envelope.salt), info)
    privateJwkBytes = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(envelope.iv), additionalData: info },
      wrappingKey,
      base64ToBytes(envelope.ciphertext)
    ))
    const privateJwk = JSON.parse(decoder.decode(privateJwkBytes)) as JsonWebKey
    return await crypto.subtle.importKey(
      'jwk',
      privateJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign']
    )
  } finally {
    privateJwkBytes?.fill(0)
    sharedSecret.fill(0)
  }
}
