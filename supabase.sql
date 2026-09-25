-- AUM Content Engine: memory layer.
-- Paste into Supabase > SQL Editor > New query > Run.
-- Nothing here is ever deleted. Rejected notes and rejected drafts are the
-- record of where the engine is weak.

create table if not exists notes (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  chat_id       text        not null,
  source        text        not null,           -- voice | text
  transcript    text        not null,
  score         int         not null,
  breakdown     jsonb,
  core_insight  text,
  reason        text,
  search_phrase text,
  status        text        not null default 'drafting'   -- drafting | rejected
);

create table if not exists drafts (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  chat_id         text        not null,
  note_id         bigint      references notes(id),
  linkedin        text,
  x_post          text,
  x_thread        jsonb,
  hook_title      text,
  hook_source     text,
  hook_url        text,
  guardrail_flags jsonb,
  model           text,
  version         int         not null default 1,
  status          text        not null default 'pending'  -- pending | approved | rejected
);

-- Telegram retries a webhook it believes failed. This makes each update
-- process exactly once, so one note never becomes three drafts.
create table if not exists processed_updates (
  update_id  bigint primary key,
  created_at timestamptz not null default now()
);

create index if not exists drafts_pending_idx
  on drafts (chat_id, status, created_at desc);

-- The engine connects with the service key and bypasses RLS. Enable RLS anyway
-- so that the anon key, if it ever leaks, reads nothing.
alter table notes             enable row level security;
alter table drafts            enable row level security;
alter table processed_updates enable row level security;
