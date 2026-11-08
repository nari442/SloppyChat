import type { SupabaseClient } from '@supabase/supabase-js'

export interface ConversationPreference {
  conversation_id: string
  hidden_at: string | null
  cleared_at: string | null
}

export interface BlockedUser {
  user_id: string
  username: string
  created_at: string
}

export async function loadConversationPreferences(client: SupabaseClient): Promise<ConversationPreference[]> {
  const { data, error } = await client
    .from('conversation_preferences')
    .select('conversation_id, hidden_at, cleared_at')
  if (error) {
    throw new Error(`Could not load conversation settings: ${error.message}`)
  }
  return (data ?? []) as ConversationPreference[]
}

async function callConversationAction(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  description: string
): Promise<unknown> {
  const { data, error } = await client.rpc(name, args)
  if (error) {
    throw new Error(`Could not ${description}: ${error.message}`)
  }
  return data
}

export async function hideConversation(client: SupabaseClient, conversationId: string): Promise<void> {
  await callConversationAction(client, 'set_conversation_hidden', {
    target_conversation_id: conversationId,
    should_hide: true
  }, 'hide this conversation')
}

export async function clearConversation(client: SupabaseClient, conversationId: string): Promise<string> {
  const clearedAt = await callConversationAction(client, 'clear_conversation_history', {
    target_conversation_id: conversationId
  }, 'clear this conversation')
  if (typeof clearedAt !== 'string') {
    throw new Error('The conversation was cleared but its cutoff could not be loaded.')
  }
  return clearedAt
}

export async function deleteDirectConversationForEveryone(client: SupabaseClient, conversationId: string): Promise<void> {
  await callConversationAction(client, 'delete_direct_conversation_for_everyone', {
    target_conversation_id: conversationId
  }, 'delete this conversation for everyone')
}

export async function blockUser(client: SupabaseClient, userId: string): Promise<void> {
  await callConversationAction(client, 'set_user_block', { target_user_id: userId }, 'block this user')
}

export async function loadBlockedUsers(client: SupabaseClient): Promise<BlockedUser[]> {
  const { data, error } = await client.rpc('get_my_blocked_users')
  if (error) {
    throw new Error(`Could not load blocked users: ${error.message}`)
  }
  return (data ?? []) as BlockedUser[]
}

export async function unblockUser(client: SupabaseClient, userId: string): Promise<void> {
  await callConversationAction(client, 'remove_user_block', { target_user_id: userId }, 'unblock this user')
}

export async function addGroupMembers(client: SupabaseClient, conversationId: string, userIds: string[]): Promise<number> {
  if (userIds.length === 0) {
    throw new Error('Choose at least one member to add.')
  }
  const { data, error } = await client.rpc('add_group_members', {
    target_conversation_id: conversationId,
    requested_user_ids: userIds
  })
  if (error) {
    throw new Error(`Could not add group members: ${error.message}`)
  }
  if (typeof data !== 'number') {
    throw new Error('The group membership update did not return a result.')
  }
  return data
}
