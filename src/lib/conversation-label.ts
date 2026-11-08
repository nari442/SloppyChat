import { memberUsername, type Conversation } from './chat-service'

export function conversationMemberNames(conversation: Conversation, currentUserId: string): string[] {
  return conversation.conversation_members
    .filter((member) => member.user_id !== currentUserId)
    .map((member) => memberUsername(member) ?? 'Sloppy user')
}

export function conversationTitle(conversation: Conversation, currentUserId: string, nickname?: string): string {
  const names = conversationMemberNames(conversation, currentUserId)
  const cleanNickname = nickname?.trim()
  if (conversation.kind === 'group') {
    const title = cleanNickname || conversation.title || 'Group chat'
    return `${title} (Group with ${names.join(', ') || 'no other members'})`
  }
  const handle = names[0] ?? 'Direct conversation'
  return cleanNickname ? `${cleanNickname} (${handle})` : handle
}
