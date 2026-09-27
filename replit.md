# Running OfficeFlow on Replit

This imported app is a Vite/React frontend with Convex for its primary backend and auth. It also contains some Supabase-backed pages. Use Node.js 22 and npm for this import: the committed Bun lockfile is not readable by the available Bun version, while `package-lock.json` has been refreshed against `package.json`.

Run `npm install` to install dependencies, then start the **Start application** workflow. It runs `npm run dev -- --host 0.0.0.0 --port 5000 --strictPort`; use `npm run build` to check the TypeScript build.

The frontend uses `VITE_CONVEX_URL` if set, otherwise it uses the Convex deployment URL already committed in `src/lib/convex.ts`. This does **not** establish ownership or backend deployment access for this Replit workspace. To use your own Convex deployment, configure `VITE_CONVEX_URL` and `CONVEX_DEPLOYMENT` and deploy the functions under `convex/`. Convex Auth also needs its backend-side auth configuration (including `JWKS`, `JWT_PRIVATE_KEY`, and `SITE_URL`) on that deployment. Do not commit credentials.

Some pages additionally use `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Those values are not configured here. To use those pages, connect the intended Supabase project and apply the SQL under `supabase/` as appropriate; do not assume it is the same database as Convex. The public Supabase anon key belongs in the project's environment settings, not source code.