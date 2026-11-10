import { describe, expect, it } from 'vitest'
import { appRouteFromPath, canonicalAppPath, pathForAppRoute } from './app-routes'

describe('app routes', () => {
  it('uses the app root as the home route', () => {
    expect(appRouteFromPath('/app/')).toEqual({ type: 'home' })
    expect(canonicalAppPath('/')).toBe('/app/')
    expect(canonicalAppPath('/app')).toBe('/app/')
  })

  it('resolves direct chat URLs using a normalized public handle', () => {
    expect(appRouteFromPath('/app/chat/FGIP2Z3JGX3F')).toEqual({
      type: 'direct-chat',
      handle: 'fgip2z3jgx3f'
    })
    expect(pathForAppRoute({ type: 'direct-chat', handle: 'fgip2z3jgx3f' }))
      .toBe('/app/chat/fgip2z3jgx3f')
  })

  it('supports group chat URLs using the conversation id', () => {
    const route = { type: 'group-chat', conversationId: '01234567-89ab-cdef-0123-456789abcdef' } as const
    expect(appRouteFromPath(pathForAppRoute(route))).toEqual(route)
  })

  it('normalizes old shared-handle links and rejects invalid paths', () => {
    expect(canonicalAppPath('/@fgip2z3jgx3f')).toBe('/app/chat/fgip2z3jgx3f')
    expect(appRouteFromPath('/app/chat/invalid')).toEqual({ type: 'home' })
    expect(appRouteFromPath('/app/chat/fgip2z3jgx3f/extra')).toEqual({ type: 'home' })
  })
})
