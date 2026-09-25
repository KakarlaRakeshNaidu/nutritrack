CREATE TABLE chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES nutritrack_users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_conversations_title_nonblank
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 120)
);

CREATE INDEX chat_conversations_user_order_idx
  ON chat_conversations (user_id, updated_at DESC, id DESC);

CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES nutritrack_users(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL,
  content VARCHAR(4000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_messages_role_valid CHECK (role IN ('user', 'assistant')),
  CONSTRAINT chat_messages_content_nonblank
    CHECK (char_length(btrim(content)) BETWEEN 1 AND 4000)
);

CREATE INDEX chat_messages_conversation_order_idx
  ON chat_messages (conversation_id, user_id, created_at DESC, id DESC);

CREATE TABLE chat_action_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES nutritrack_users(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  outcome JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_action_kind_valid CHECK (
    kind IN ('meal_create', 'meal_update', 'meal_delete', 'goals_replace')
  ),
  CONSTRAINT chat_action_version_positive CHECK (version > 0),
  CONSTRAINT chat_action_status_valid CHECK (
    status IN ('pending', 'confirmed', 'canceled', 'expired')
  ),
  CONSTRAINT chat_action_outcome_consistent CHECK (
    (status = 'confirmed' AND outcome IS NOT NULL)
    OR (status <> 'confirmed' AND outcome IS NULL)
  )
);

CREATE INDEX chat_action_proposals_user_status_idx
  ON chat_action_proposals (user_id, status, created_at DESC, id DESC);
CREATE INDEX chat_action_proposals_conversation_idx
  ON chat_action_proposals (conversation_id, user_id, created_at DESC);
