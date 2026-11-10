export const defaultAccentColor = '#7c3aed'
export const accentColorPresets = [
  { name: 'Purple', value: defaultAccentColor, darkValue: '#a78bfa' },
  { name: 'Mint', value: '#6fffae', darkValue: '#6fffae' },
  { name: 'Gray', value: '#282828', darkValue: '#b8b8b8' },
  { name: 'Light Blue', value: '#aee8e7', darkValue: '#aee8e7' },
  { name: 'Red', value: '#ff6f6f', darkValue: '#ff8585' }
] as const
export type AccentColor = typeof accentColorPresets[number]['value']
const hexColorPattern = /^#[\da-f]{6}$/i

function linearizeChannel(value: number): number {
  const channel = value / 255
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(color: string): number {
  const channels = color.slice(1).match(/.{2}/g)
  if (!channels) return 0
  const [red, green, blue] = channels.map((channel) => linearizeChannel(Number.parseInt(channel, 16)))
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

export function normalizeAccentColor(color: string | null): AccentColor {
  const normalized = color?.toLowerCase() === '#6fc6ff' ? '#aee8e7' : color?.toLowerCase()
  const preset = accentColorPresets.find((candidate) => candidate.value === normalized)
  return preset?.value ?? defaultAccentColor
}

export function accentForeground(color: string): string {
  const luminance = relativeLuminance(hexColorPattern.test(color) ? color : defaultAccentColor)
  const whiteContrast = 1.05 / (luminance + 0.05)
  const darkContrast = (luminance + 0.05) / 0.05
  return whiteContrast >= darkContrast ? '#ffffff' : '#18121f'
}

export function darkAccentColor(color: string): string {
  const normalized = normalizeAccentColor(color)
  return accentColorPresets.find((preset) => preset.value === normalized)?.darkValue ?? '#a78bfa'
}

export function contrastRatio(firstColor: string, secondColor: string): number {
  const firstLuminance = relativeLuminance(firstColor)
  const secondLuminance = relativeLuminance(secondColor)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}
