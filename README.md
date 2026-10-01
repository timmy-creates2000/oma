# OfficeFlow

OfficeFlow is a QR-based attendance and HR workspace for modern teams.

## Stack

- Vite + React 19 + TypeScript
- React Router
- Tailwind CSS and shadcn/ui
- Supabase Auth, Postgres, Row Level Security, and Postgres RPCs
- Framer Motion, Recharts, and Lucide

## Run locally

Use Node.js 22 and npm:

```bash
npm install
npm run dev
```

## Supabase setup

Run these two files in the Supabase SQL editor, in this order:

1. `supabase/deploy.sql` (the full database: tables, policies, functions, early clock-out)
2. `supabase/fixes.sql` (bug fixes: approvals, QR, employee delete, notifications, timezone)

`supabase/schema.sql` and `supabase/functions.sql` are older split copies and do not contain the early clock-out feature. Do not use them for a new project.

For a pilot, turn off "Confirm email" in Supabase, Authentication, Providers, Email. Otherwise new employees cannot sign in until they click a confirmation email, which is the most common reason people cannot log in.

The app uses Supabase Auth with email/password sign-in. The auth trigger creates a profile row, and the onboarding flow calls `create_company` or `join_company` after authentication.

Create a `.env.local` file (see `.env.example`) with:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

Never commit service-role keys or other private credentials.

## Checks

```bash
npm run build
npm run lint
```

The app keeps the existing feature structure under `src/pages`, while Supabase queries and RPC calls are shared through `src/lib/sb.ts` and `src/hooks`.