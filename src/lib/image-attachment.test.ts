import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  decryptImageAttachment,
  MAX_IMAGE_BYTES,
  parseImageAttachment,
  uploadEncryptedImage,
  validateImageFile
} from './image-attachment'

function fileWith(type: string, bytes: number[], size = bytes.length): File {
  const content = Uint8Array.from(bytes)
  return {
    type,
    size,
    arrayBuffer: async () => content.slice().buffer
  } as File
}

describe('image attachment validation', () => {
  it('accepts a correctly typed PNG within the 2 MB limit', async () => {
    const png = fileWith('image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await expect(validateImageFile(png)).resolves.toBeUndefined()
    expect(MAX_IMAGE_BYTES).toBe(2 * 1024 * 1024)
  })

  it('rejects files larger than 2 MB before reading their content', async () => {
    const oversized = fileWith('image/png', [], MAX_IMAGE_BYTES + 1)
    await expect(validateImageFile(oversized)).rejects.toThrow('smaller than 2 MB')
  })

  it('rejects unsupported SVG and mismatched image data', async () => {
    await expect(validateImageFile(fileWith('image/svg+xml', [0x3c, 0x73, 0x76, 0x67])))
      .rejects.toThrow('SVG files are not supported')
    await expect(validateImageFile(fileWith('image/jpeg', [0x89, 0x50, 0x4e, 0x47])))
      .rejects.toThrow('does not match its file type')
  })

  it('rejects a truncated or incomplete file read', async () => {
    const truncated = fileWith('image/png', [0x89, 0x50, 0x4e, 0x47], 8)
    await expect(validateImageFile(truncated)).rejects.toThrow('could not be read completely')
  })

  it('encrypts image bytes before upload and decrypts them from the signed message payload', async () => {
    const storedObjects = new Map<string, Blob>()
    const client = {
      storage: {
        from: () => ({
          upload: async (path: string, value: Blob) => {
            storedObjects.set(path, value)
            return { data: { path }, error: null }
          },
          download: async (path: string) => ({ data: storedObjects.get(path) ?? null, error: null })
        })
      }
    } as unknown as SupabaseClient
    const imageBytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]
    const payload = await uploadEncryptedImage(
      client,
      'conversation-id',
      'user-id',
      fileWith('image/png', imageBytes),
      'A small image'
    )
    const attachment = parseImageAttachment(payload)
    expect(attachment).not.toBeNull()
    const uploaded = storedObjects.get(attachment!.path)
    expect(uploaded).toBeDefined()
    expect(Array.from(new Uint8Array(await uploaded!.arrayBuffer()))).not.toEqual(imageBytes)

    const decrypted = await decryptImageAttachment(client, 'conversation-id', attachment!)
    expect(Array.from(new Uint8Array(await decrypted.arrayBuffer()))).toEqual(imageBytes)
    expect(attachment?.caption).toBe('A small image')
  })
})