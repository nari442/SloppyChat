import { describe, expect, it } from 'vitest'
import { conversationTitle } from './conversation-label'
import type { Conversation } from './chat-service'

const directConversation: Conversation = {
  id: 'direct',
  kind: 'direct',
  title: null,
  created_at: '',
  conversation_members: [
    { user_id: 'me', profiles: { username: 'currentuser12' } },
    { user_id: 'peer', profiles: { username: 'jtlnyv67k3ej' } }
  ]
}

const groupConversation: Conversation = {
  id: 'group',
  kind: 'group',
  title: 'Weekend plans',
  created_at: '',
  conversation_members: [
    { user_id: 'me', profiles: { username: 'currentuser12' } },
    { user_id: 'first', profiles: { username: 'jtlnyv67k3ej' } },
    { user_id: 'second', profiles: { username: 'abc234def567' } }
  ]
}

describe('conversationTitle', () => {
  it('shows a direct conversation nickname with the original handle', () => {
    expect(conversationTitle(directConversation, 'me', 'Marcel')).toBe('Marcel (jtlnyv67k3ej)')
  })

  it('keeps the handle visible when a direct conversation has no nickname', () => {
    expect(conversationTitle(directConversation, 'me')).toBe('jtlnyv67k3ej')
  })

  it('shows a group name with its members', () => {
    expect(conversationTitle(groupConversation, 'me', 'Groupname')).toBe(
      'Groupname (Group with jtlnyv67k3ej, abc234def567)'
    )
  })
})
