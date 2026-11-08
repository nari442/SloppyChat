import type { SupabaseClient } from '@supabase/supabase-js'

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const IMAGE_BUCKET = 'encrypted-chat-images'
const IMAGE_PREFIX = 'sloppy-image:v1:'
const encoder = new TextEncoder()

export interface ImageAttachment {
  path: string
  key: string
  iv: string
  mediaType: string
  caption: string
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
}

export async function validateImageFile(file: Pick<File, 'size' | 'type' | 'arrayBuffer'>): Promise<void> {
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error('Choose an image smaller than 2 MB.')
  }
  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])
  if (!allowedTypes.has(file.type)) {
    throw new Error('Use a PNG, JPEG, WebP, GIF, or AVIF image. SVG files are not supported.')
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength !== file.size) {
    throw new Error('The image data could not be read completely.')
  }
  const isPng = startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const isJpeg = startsWith(bytes, [0xff, 0xd8, 0xff])
  const isGif = startsWith(bytes, [0x47, 0x49, 0x46, 0x38])
  const isWebp = startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  const avifBrand = String.fromCharCode(...bytes.slice(4, 12))
  const isAvif = avifBrand.startsWith('ftypavif') || avifBrand.startsWith('ftypavis')
  const matchesType = (file.type === 'image/png' && isPng)
    || (file.type === 'image/jpeg' && isJpeg)
    || (file.type === 'image/gif' && isGif)
    || (file.type === 'image/webp' && isWebp)
    || (file.type === 'image/avif' && isAvif)
  if (!matchesType) {
    throw new Error('The image data does not match its file type.')
  }
}

export async function uploadEncryptedImage(
  client: SupabaseClient,
  conversationId: string,
  userId: string,
  file: File,
  caption: string
): Promise<string> {
  await validateImageFile(file)
  const keyBytes = crypto.getRandomValues(new Uint8Array(32))
  const encodedKey = toBase64(keyBytes)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt'])
  const path = `${conversationId}/${userId}/${crypto.randomUUID()}`
  const additionalData = encoder.encode(`sloppy-image-v1:${conversationId}:${userId}`)
  let ciphertext: ArrayBuffer
  try {
    ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData },
      key,
      await file.arrayBuffer()
    )
  } finally {
    keyBytes.fill(0)
  }
  const { error } = await client.storage.from(IMAGE_BUCKET).upload(
    path,
    new Blob([new Uint8Array(ciphertext)], { type: 'application/octet-stream' }),
    { contentType: 'application/octet-stream', upsert: false }
  )
  if (error) throw new Error(`Could not upload the encrypted image: ${error.message}`)
  return IMAGE_PREFIX + JSON.stringify({
    path,
    key: encodedKey,
    iv: toBase64(iv),
    mediaType: file.type,
    caption: caption.trim()
  } satisfies ImageAttachment)
}

export function parseImageAttachment(value: string | null): ImageAttachment | null {
  if (!value?.startsWith(IMAGE_PREFIX)) return null
  try {
    const parsed: unknown = JSON.parse(value.slice(IMAGE_PREFIX.length))
    if (!parsed || typeof parsed !== 'object') return null
    const attachment = parsed as Partial<ImageAttachment>
    if (
      typeof attachment.path !== 'string'
      || typeof attachment.key !== 'string'
      || typeof attachment.iv !== 'string'
      || typeof attachment.mediaType !== 'string'
      || typeof attachment.caption !== 'string'
      || !/^image\/(png|jpeg|webp|gif|avif)$/.test(attachment.mediaType)
    ) return null
    return attachment as ImageAttachment
  } catch {
    return null
  }
}

export async function decryptImageAttachment(
  client: SupabaseClient,
  conversationId: string,
  attachment: ImageAttachment
): Promise<Blob> {
  const [pathConversationId, userId, objectId] = attachment.path.split('/')
  if (pathConversationId !== conversationId || !userId || !objectId || attachment.path.split('/').length !== 3) {
    throw new Error('The encrypted image reference is invalid.')
  }
  const { data, error } = await client.storage.from(IMAGE_BUCKET).download(attachment.path)
  if (error) throw new Error(`Could not load the encrypted image: ${error.message}`)
  const keyBytes = fromBase64(attachment.key)
  if (keyBytes.byteLength !== 32) throw new Error('The encrypted image key is invalid.')
  try {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64(attachment.iv),
        additionalData: encoder.encode(`sloppy-image-v1:${conversationId}:${userId}`)
      },
      key,
      await data.arrayBuffer()
    )
    return new Blob([new Uint8Array(plaintext)], { type: attachment.mediaType })
  } finally {
    keyBytes.fill(0)
  }
}

export async function removeUploadedImage(client: SupabaseClient, payload: string): Promise<void> {
  const attachment = parseImageAttachment(payload)
  if (!attachment) return
  const { error } = await client.storage.from(IMAGE_BUCKET).remove([attachment.path])
  if (error) throw new Error(`Could not remove the unused encrypted image: ${error.message}`)
}
