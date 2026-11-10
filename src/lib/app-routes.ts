import { isValidUsername, normalizeUsername } from './auth'

export type AppRoute =
  | { type: 'home' }
  | { type: 'direct-chat'; handle: string }
  | { type: 'group-chat'; conversationId: string }

export function appRouteFromPath(pathname: string): AppRoute {
  const segments = pathname.split('/').filter(Boolean)

  if (segments.length === 0 || (segments.length === 1 && segments[0] === 'app')) {
    return { type: 'home' }
  }

  if (segments.length === 3 && segments[0] === 'app' && segments[1] === 'chat') {
    let handle: string
    try {
      handle = normalizeUsername(decodeURIComponent(segments[2]))
    } catch {
      return { type: 'home' }
    }
    if (isValidUsername(handle)) return { type: 'direct-chat', handle }
  }

  if (segments.length === 4 && segments[0] === 'app' && segments[1] === 'chat' && segments[2] === 'group') {
    try {
      const conversationId = decodeURIComponent(segments[3])
      if (/^[\da-f-]{36}$/i.test(conversationId)) {
        return { type: 'group-chat', conversationId }
      }
    } catch {
      return { type: 'home' }
    }
  }

  if (segments.length === 1) {
    try {
      const legacyHandle = decodeURIComponent(segments[0]).replace(/^@/, '')
      const handle = normalizeUsername(legacyHandle)
      if (isValidUsername(handle)) return { type: 'direct-chat', handle }
    } catch {
      return { type: 'home' }
    }
  }

  return { type: 'home' }
}

export function pathForAppRoute(route: AppRoute): string {
  switch (route.type) {
    case 'home':
      return '/app/'
    case 'direct-chat':
      return `/app/chat/${encodeURIComponent(normalizeUsername(route.handle))}`
    case 'group-chat':
      return `/app/chat/group/${encodeURIComponent(route.conversationId)}`
  }
}

export function canonicalAppPath(pathname: string): string {
  return pathForAppRoute(appRouteFromPath(pathname))
}
