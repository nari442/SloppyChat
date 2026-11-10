import purpleIcon from '../assets/sloppychat-purple.svg'
import mintIcon from '../assets/sloppychat-mint.svg'
import grayIcon from '../assets/sloppychat-gray.svg'
import lightBlueIcon from '../assets/sloppychat-light-blue.svg'
import redIcon from '../assets/sloppychat-red.svg'
import { normalizeAccentColor } from './appearance'

const icons = {
  '#7c3aed': purpleIcon,
  '#6fffae': mintIcon,
  '#282828': grayIcon,
  '#aee8e7': lightBlueIcon,
  '#ff6f6f': redIcon
} as const

export function brandIconForAccent(color: string): string {
  const accent = normalizeAccentColor(color)
  return icons[accent]
}
