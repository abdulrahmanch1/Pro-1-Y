# Subtitle AI — Design-Only (Day 1)

Static, modern, and library-free (CSS-only UI) Next.js app skeleton in English. Today is design and layout only; no business logic or external UI libs were used. The interface now ships with the **Hyperwave** aesthetic — dark/light dual themes, neon gradients, holographic panels, and hover micro-motions crafted for creators.

## Run locally
- Requirements: Node 18+
- Install deps: `npm i`
- Copy `.env.example` → `.env.local` and add Supabase credentials
- Dev server: `npm run dev`

## Backend wiring
The frontend is now backed by Supabase for auth, wallet, and project persistence.

1. **Create the Supabase project** and add the SQL from `docs/backend-plan.md` to provision tables, views, and RLS policies.
2. **Storage bucket** — create a bucket named `captions` (or update `SUPABASE_STORAGE_BUCKET`). Grant authenticated users read/write.
3. **Environment variables** — set:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_STORAGE_BUCKET`
4. **Auth URL configuration** — add `http(s)://localhost:3000/auth/callback` to Supabase redirect URLs.
5. Seed your wallet with a positive transaction to enable exports, or top-up via the wallet screen once signed in.

See `docs/backend-plan.md` for schema details, API endpoints, and future AI integration notes.

## Pages
- `app/page.jsx` — Landing with animated hero, features, and CTA.
- `app/upload/page.jsx` — Upload SRT/VTT (UI only, dropzone + continue).
- `app/review/page.jsx` — Review queue with accept-by-default toggles, inline editing, mock download.
- `app/wallet/page.jsx` — Wallet balance, top-up amounts ($5, $10, $50, $100), sample history.
- `app/auth/sign-in/page.jsx` — Sign in + Google button (UI only).
- `app/auth/sign-up/page.jsx` — Sign up + Google button (UI only).
- `app/auth/verify/page.jsx` — Account confirmed screen with Sign in button.
- `app/auth/forgot-password/page.jsx` — Request reset link (UI only).
- `app/auth/reset-password/page.jsx` — Create new password (UI only).
- `app/components/page.jsx` — Small component gallery (buttons/inputs/badges/toggle).

## Design highlights
- `app/globals.css` — Hyperwave design system: holographic panels, neon gradients, glass depth, dual themes.
- Landing hero now features bento-style previews, timeline snippets, and wallet metrics to signal product value.
- Review flow redesigned with cinematic toolbar, glowing toggles, inline editable mono lines, and polished badges.
- Upload, wallet, and auth routes share a cohesive creator-first grid with cards, panels, and callouts.

## Tomorrow (Day 2) — Suggested scope
- Wire Supabase: auth (email + Google), profiles, wallet tables, transactions.
- Upload parsing: SRT/VTT to normalized structure.
- AI integration: send lines to LLM, return improved text with rationale, and stream suggestions.
- Persist review state and generate downloadable SRT/VTT.
- Payments/top-up flow and balance checks before download.

> Branding/colors are placeholders. Share your brand name/palette and I’ll apply them precisely.
