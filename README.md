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

The complete database implementation is in:

1. `supabase/schema.sql`
2. `supabase/functions.sql`

Run both files in the Supabase SQL editor for a new Supabase project. The schema includes tenant isolation, RLS policies, profiles, employees, attendance, devices, QR displays, leave, corrections, notifications, audit logs, and company settings.

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