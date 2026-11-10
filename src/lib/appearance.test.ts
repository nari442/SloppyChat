import { describe, expect, it } from 'vitest'
import { accentColorPresets, accentForeground, contrastRatio, defaultAccentColor, normalizeAccentColor } from './appearance'
import { brandIconForAccent } from './brand-icons'

describe('appearance helpers', () => {
  it('uses the default accent for invalid saved colors', () => {
    expect(normalizeAccentColor(null)).toBe(defaultAccentColor)
    expect(normalizeAccentColor('purple')).toBe(defaultAccentColor)
    expect(normalizeAccentColor('#6fffae')).toBe('#6fffae')
    expect(normalizeAccentColor('#6fc6ff')).toBe('#aee8e7')
    expect(normalizeAccentColor('#abcdef')).toBe(defaultAccentColor)
  })

  it('exposes only the supported named accent colors', () => {
    expect(accentColorPresets.map(({ name }) => name)).toEqual(['Purple', 'Mint', 'Gray', 'Light Blue', 'Red'])
    expect(accentColorPresets.map(({ value }) => value)).toEqual(['#7c3aed', '#6fffae', '#282828', '#aee8e7', '#ff6f6f'])
  })

  it('keeps every preset foreground readable in light and dark themes', () => {
    expect(accentForeground('#000000')).toBe('#ffffff')
    expect(accentForeground('#282828')).toBe('#ffffff')
    for (const preset of accentColorPresets) {
      expect(contrastRatio(preset.value, accentForeground(preset.value))).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(preset.darkValue, accentForeground(preset.darkValue))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('selects a dedicated icon asset for each accent color', () => {
    const icons = accentColorPresets.map(({ value }) => brandIconForAccent(value))
    expect(new Set(icons).size).toBe(accentColorPresets.length)
    expect(brandIconForAccent('#6fffae')).toBe(brandIconForAccent('#6fffae'))
    expect(brandIconForAccent('#abcdef')).toBe(brandIconForAccent(defaultAccentColor))
  })
})
