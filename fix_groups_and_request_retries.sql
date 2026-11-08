begin;

create or replace function public.create_conversation(
  participant_ids uuid[],
  conversation_kind text,
  conversation_title text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  all_participants uuid[];
  participant_count integer;
  resolved_kind text;
  resolved_direct_key text;
  created_conversation_id uuid;
  invalid_participant uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select array_agg(distinct people.participant_id order by people.participant_id)
  into all_participants
  from unnest(coalesce(participant_ids, array[]::uuid[]) || array[auth.uid()]) as people(participant_id)
  where people.participant_id is not null;

  participant_count := coalesce(cardinality(all_participants), 0);
  if participant_count < 2 or participant_count > 20 then
    raise exception 'Conversations require between 2 and 20 members';
  end if;
  if (select count(*) from public.profiles where id = any(all_participants)) <> participant_count then
    raise exception 'One or more users could not be found';
  end if;

  resolved_kind := case when participant_count = 2 then 'direct' else 'group' end;
  if conversation_kind is distinct from resolved_kind then
    raise exception 'Conversation type does not match member count';
  end if;

  if resolved_kind = 'direct' then
    resolved_direct_key := all_participants[1]::text || ':' || all_participants[2]::text;
    select conversation.id into created_conversation_id
    from public.conversations as conversation
    where conversation.kind = 'direct'
      and conversation.direct_key = resolved_direct_key;
    if created_conversation_id is null then
      raise exception 'Direct conversations require recipient approval. Send a message request instead.';
    end if;
    if not public.is_conversation_member(created_conversation_id, auth.uid()) then
      raise exception 'This direct conversation is blocked or unavailable';
    end if;
    return created_conversation_id;
  end if;

  select participant.user_id into invalid_participant
  from unnest(all_participants) as participant(user_id)
  where participant.user_id <> auth.uid()
    and (
      exists (
        select 1
        from public.user_blocks as user_block
        where (user_block.blocker_id = auth.uid() and user_block.blocked_id = participant.user_id)
          or (user_block.blocker_id = participant.user_id and user_block.blocked_id = auth.uid())
      )
      or not exists (
        select 1
        from public.conversations as accepted_direct
        where accepted_direct.kind = 'direct'
          and accepted_direct.direct_key = least(auth.uid()::text, participant.user_id::text) || ':' ||
            greatest(auth.uid()::text, participant.user_id::text)
      )
    )
  limit 1;

  if invalid_participant is not null then
    if exists (
      select 1 from public.user_blocks as user_block
      where (user_block.blocker_id = auth.uid() and user_block.blocked_id = invalid_participant)
        or (user_block.blocker_id = invalid_participant and user_block.blocked_id = auth.uid())
    ) then
      raise exception 'A blocked user cannot be added to this group';
    end if;
    raise exception 'Every group member must first accept a direct message request';
  end if;

  if exists (
    select 1
    from public.user_blocks as user_block
    where exists (
      select 1 from unnest(all_participants) as left_member(user_id)
      where left_member.user_id = user_block.blocker_id
    )
      and exists (
        select 1 from unnest(all_participants) as right_member(user_id)
        where right_member.user_id = user_block.blocked_id
      )
  ) then
    raise exception 'Blocked users cannot be added to the same group';
  end if;

  insert into public.conversations (kind, title, created_by)
  values ('group', nullif(btrim(conversation_title), ''), auth.uid())
  returning id into created_conversation_id;

  insert into public.conversation_members (conversation_id, user_id)
  select created_conversation_id, participant_id
  from unnest(all_participants) as people(participant_id);

  return created_conversation_id;
end;
$$;

create or replace function public.add_group_members(
  target_conversation_id uuid,
  requested_user_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  conversation_size integer;
  members_to_add uuid[];
  total_members uuid[];
  invalid_participant uuid;
  added_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication is required';
  end if;
  if not exists (
    select 1 from public.conversations as conversation
    where conversation.id = target_conversation_id
      and conversation.kind = 'group'
  ) then
    raise exception 'This group could not be found';
  end if;
  if not public.is_conversation_member(target_conversation_id, current_user_id) then
    raise exception 'Only an unblocked group member can add people';
  end if;

  select array_agg(distinct candidate.user_id order by candidate.user_id)
  into members_to_add
  from unnest(coalesce(requested_user_ids, array[]::uuid[])) as candidate(user_id)
  where candidate.user_id is not null
    and candidate.user_id <> current_user_id
    and not exists (
      select 1 from public.conversation_members as member
      where member.conversation_id = target_conversation_id
        and member.user_id = candidate.user_id
    );

  if coalesce(cardinality(members_to_add), 0) = 0 then
    raise exception 'Choose at least one new group member';
  end if;
  if exists (
    select 1 from unnest(members_to_add) as candidate(user_id)
    where not exists (select 1 from public.profiles where id = candidate.user_id)
  ) then
    raise exception 'One or more users could not be found';
  end if;

  select count(*) into conversation_size
  from public.conversation_members
  where conversation_id = target_conversation_id;
  if conversation_size + cardinality(members_to_add) > 20 then
    raise exception 'Groups are limited to 20 members';
  end if;

  select candidate.user_id into invalid_participant
  from unnest(members_to_add) as candidate(user_id)
  where exists (
    select 1 from public.user_blocks as user_block
    where (user_block.blocker_id = current_user_id and user_block.blocked_id = candidate.user_id)
      or (user_block.blocker_id = candidate.user_id and user_block.blocked_id = current_user_id)
  )
  or not exists (
    select 1 from public.conversations as accepted_direct
    where accepted_direct.kind = 'direct'
      and accepted_direct.direct_key = least(current_user_id::text, candidate.user_id::text) || ':' ||
        greatest(current_user_id::text, candidate.user_id::text)
  )
  limit 1;

  if invalid_participant is not null then
    if exists (
      select 1 from public.user_blocks as user_block
      where (user_block.blocker_id = current_user_id and user_block.blocked_id = invalid_participant)
        or (user_block.blocker_id = invalid_participant and user_block.blocked_id = current_user_id)
    ) then
      raise exception 'A blocked user cannot be added to this group';
    end if;
    raise exception 'Each new member must first accept a direct message request';
  end if;

  select array_agg(member.user_id order by member.user_id)
  into total_members
  from public.conversation_members as member
  where member.conversation_id = target_conversation_id;
  total_members := total_members || members_to_add;

  if exists (
    select 1
    from public.user_blocks as user_block
    where (
      exists (select 1 from unnest(members_to_add) as member(user_id) where member.user_id = user_block.blocker_id)
      and exists (select 1 from unnest(total_members) as member(user_id) where member.user_id = user_block.blocked_id)
    ) or (
      exists (select 1 from unnest(members_to_add) as member(user_id) where member.user_id = user_block.blocked_id)
      and exists (select 1 from unnest(total_members) as member(user_id) where member.user_id = user_block.blocker_id)
    )
  ) then
    raise exception 'These members cannot share a group because of a block';
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  select target_conversation_id, candidate.user_id
  from unnest(members_to_add) as candidate(user_id)
  on conflict do nothing;
  get diagnostics added_count = row_count;
  return added_count;
end;
$$;

create or replace function public.create_message_request(
  requested_id uuid,
  recipient_username text,
  requested_device_id uuid,
  requested_sender_signature text,
  requested_ciphertext text,
  requested_iv text,
  requested_ephemeral_public_key jsonb,
  requested_key_envelopes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient uuid;
  conversation_key text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select profile.id into recipient
  from public.profiles as profile
  where profile.username = lower(trim(recipient_username))
    and profile.id <> auth.uid();
  if recipient is null then
    raise exception 'No Sloppy user was found for that handle';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'sloppy:message-request:' || least(auth.uid()::text, recipient::text) || ':' || greatest(auth.uid()::text, recipient::text),
    0
  ));

  if not public.is_approved_device(requested_device_id, auth.uid())
    or requested_sender_signature is null
    or length(requested_sender_signature) not between 80 and 100
    or requested_ciphertext is null
    or octet_length(requested_ciphertext) > 24000
    or requested_iv is null
    or octet_length(requested_iv) > 32
    or requested_ephemeral_public_key is null
    or octet_length(requested_ephemeral_public_key::text) > 1000
    or requested_key_envelopes is null
    or octet_length(requested_key_envelopes::text) > 100000
    or not (requested_key_envelopes ? requested_device_id::text)
    or not exists (
      select 1 from public.devices as target_device
      where target_device.user_id = recipient
        and target_device.approved_at is not null
        and target_device.revoked_at is null
        and requested_key_envelopes ? target_device.device_id::text
    )
    or exists (
      select 1 from public.devices as target_device
      where target_device.user_id = recipient
        and target_device.approved_at is not null
        and target_device.revoked_at is null
        and not (requested_key_envelopes ? target_device.device_id::text)
    ) then
    raise exception 'A valid encrypted request for an approved browser is required';
  end if;

  if exists (
    select 1 from public.user_blocks as user_block
    where (user_block.blocker_id = auth.uid() and user_block.blocked_id = recipient)
      or (user_block.blocker_id = recipient and user_block.blocked_id = auth.uid())
  ) then
    raise exception 'This user is blocked or is not accepting message requests';
  end if;

  conversation_key := least(auth.uid()::text, recipient::text) || ':' || greatest(auth.uid()::text, recipient::text);
  if exists (
    select 1 from public.conversations as conversation
    where conversation.direct_key = conversation_key
  ) then
    raise exception 'You already have an accepted conversation with this user';
  end if;

  if exists (
    select 1 from public.message_requests as existing_request
    where existing_request.sender_id = auth.uid()
      and existing_request.recipient_id = recipient
      and existing_request.status = 'pending'
  ) then
    raise exception 'A message request is already pending for this user';
  end if;

  insert into public.message_requests (
    id, sender_id, recipient_id, sender_device_id, sender_signature,
    ciphertext, iv, ephemeral_public_key, key_envelopes
  ) values (
    requested_id, auth.uid(), recipient, requested_device_id, requested_sender_signature,
    requested_ciphertext, requested_iv, requested_ephemeral_public_key, requested_key_envelopes
  );

  return requested_id;
end;
$$;

revoke all on function public.create_conversation(uuid[], text, text) from public, anon;
grant execute on function public.create_conversation(uuid[], text, text) to authenticated;
revoke all on function public.add_group_members(uuid, uuid[]) from public, anon;
grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;
revoke all on function public.create_message_request(uuid, text, uuid, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_message_request(uuid, text, uuid, text, text, text, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
