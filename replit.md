# Running OfficeFlow on Replit

This app is a Vite/React frontend backed entirely by Supabase for authentication, database access, row-level security, and business logic. Use Node.js 22 and npm for this import: the committed Bun lockfile is not readable by the available Bun version, while `package-lock.json` has been refreshed against `package.json`.

Run `npm install` to install dependencies, then start the **Start application** workflow. It runs `npm run dev -- --host 0.0.0.0 --port 5000 --strictPort`; use `npm run build` to check the TypeScript build.

The browser uses the connected Supabase integration through the same-origin `/api/supabase` proxy defined in `vite.config.ts`. If direct Supabase environment variables are supplied later, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` take precedence. Do not commit credentials.

The SQL under `supabase/` defines the complete schema, RLS policies, attendance engine, onboarding, leave, device, QR, settings, and reporting functions. The connected Supabase project already exposes the core tables through PostgREST. If a fresh project is used, apply `supabase/schema.sql` followed by `supabase/functions.sql`.