# Backend Plan for Subtitle AI

## Overview
The UI is in place, but the app currently ships without data, auth, or persistence. We will introduce a Supabase-backed backend that covers:

- **Authentication** — email/password + OAuth via Supabase Auth.
- **Profiles** — basic metadata per user.
- **Projects & uploads** — store uploaded caption files and their parsed segments.
- **Review segments** — persistence for original/proposed caption lines and the accept/edit state.
- **Wallet** — balance derived from transaction ledger plus history records.
- **Exports** — metadata for generated downloads (AI integration lands later).

The goal is to have 80% of the flow functional (upload → review → export, wallet ledger, auth) with placeholders where AI logic will eventually plug in.

## Environment & Dependencies

- Install `@supabase/supabase-js` and `@supabase/ssr`.
- Copy `.env.example` → `.env.local` and provide:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_STORAGE_BUCKET=captions`
- Enable RLS on every custom table; policies mirror `auth.uid()`.
- Supabase storage bucket `captions` holds original uploads & generated exports.

## Database Schema

```sql
-- profiles extend auth.users
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- user projects = individual caption jobs
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  status text default 'review' check (status in ('uploaded','processing','review','completed','archived')),
  source_file_path text,
  source_file_name text,
  original_language text,
  duration_seconds integer,
  segments_count integer default 0,
  review_started_at timestamptz,
  review_completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- each caption line
create table public.review_segments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  index integer not null,
  ts_start_ms integer,
  ts_end_ms integer,
  original_text text not null,
  proposed_text text,
  accepted boolean default true,
  edited_text text,
  ai_rationale text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(project_id, index)
);

-- wallet ledger; balance = sum(amount_cents)
create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('top_up','charge','refund')),
  amount_cents integer not null,
  currency text not null default 'USD',
  description text,
  external_ref text,
  status text not null default 'succeeded' check (status in ('pending','succeeded','failed','refunded')),
  metadata jsonb,
  created_at timestamptz default now()
);

-- exports metadata (AI output placeholder)
create table public.exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  file_path text not null,
  type text default 'srt' check (type in ('srt','vtt')),
  created_at timestamptz default now()
);

create view public.wallet_balances as
select user_id,
       coalesce(sum(case when status = 'succeeded' then amount_cents else 0 end), 0) as balance_cents
from public.wallet_transactions
group by user_id;
```

### Row Level Security

Example policy (repeat per table):

```sql
alter table public.projects enable row level security;
create policy "Users access own projects" on public.projects
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

## Folder Structure Additions

```
lib/
  supabase/
    browser.js         // createBrowserClient
    server.js          // createServerClient with cookies
    service.js         // service-role client for internal calls
  parsers/
    srt.js             // parse SRT → segments
  api/
    project-transforms.js
app/
  api/
    auth/session/route.js
    projects/route.js
    projects/[id]/route.js
    projects/[id]/segments/route.js
    projects/[id]/segments/[segmentId]/route.js
    wallet/route.js
middleware.js             // keeps Supabase session alive
```

## High-Level Flows

1. **Auth**
   - Client components use `createSupabaseBrowserClient()` for sign in/up.
   - Server components/route handlers call `createSupabaseServerClient()`.
   - Middleware hydrates the session cookie for SSR routes.

2. **Upload → Project creation**
   - `UploadClient` (new) posts `FormData` with SRT file + title to `POST /api/projects`.
   - Route handler verifies auth, uploads raw file to storage, parses SRT via `lib/parsers/srt.js`, inserts project & segments, returns project id.
   - Redirect user to `/review?projectId=<id>`.

3. **Review**
   - `ReviewPage` (server component) fetches project+segments via Supabase and hydrates `ReviewClient`.
   - `ReviewClient` edits are persisted via `PATCH /api/projects/:id/segments/:segmentId`.
   - `Download` button hits `POST /api/projects/:id/export` which creates an SRT on the fly from accepted/edited lines and returns a signed storage URL.

4. **Wallet**
   - `WalletPage` becomes async server component fetching balance + transactions via Supabase.
   - Quick top-up buttons call `POST /api/wallet` to insert a ledger entry (mock immediate success). Later, integrate payment webhooks.

## Outstanding (Post-AI) Hooks

- AI suggestions populate `proposed_text` and `ai_rationale` columns.
- Review diffing, inline streaming, billing per AI token usage.
- Real payment providers + webhook ledger updates.

## Next Steps Checklist

1. [x] Add Supabase SDKs to the project.
2. [x] Create Supabase client helpers (`lib/supabase/*`).
3. [x] Wire middleware to keep sessions.
4. [x] Add `.env.example` with required env vars.
5. [x] Implement SRT parser utility.
6. [x] Build REST endpoints for projects (create, fetch, update segments, export).
7. [x] Build REST endpoints for wallet (fetch summary, add transaction, charge on export).
8. [x] Convert Upload/Review/Wallet pages to hit the new backend.
9. [x] Create reusable hooks/components for auth + session state.
10. [ ] Provide SQL migrations (Supabase Studio or CLI) for the schema above.

This roadmap unlocks 80% of the experience now, while keeping the AI workstream isolated for later.
