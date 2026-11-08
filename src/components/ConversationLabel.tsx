import { conversationMemberNames } from '../lib/conversation-label'
import type { Conversation } from '../lib/chat-service'
import { Handle } from './Handle'

export function ConversationLabel({
  conversation,
  currentUserId,
  nickname
}: {
  conversation: Conversation
  currentUserId: string
  nickname?: string
}) {
  const members = conversationMemberNames(conversation, currentUserId)
  if (conversation.kind === 'group') {
    return (
      <>
        <span>{nickname?.trim() || conversation.title || 'Group chat'} (Group with </span>
        {members.map((member, index) => (
          <span key={`${conversation.id}:${index}`}>
            {index > 0 && ', '}
            <Handle value={member} />
          </span>
        ))}
        <span>)</span>
      </>
    )
  }
  return (
    <>
      {nickname?.trim() ? <span>{nickname.trim()} (</span> : null}
      <Handle value={members[0] ?? 'Direct conversation'} />
      {nickname?.trim() ? <span>)</span> : null}
    </>
  )
}
