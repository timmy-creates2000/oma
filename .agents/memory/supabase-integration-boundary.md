---
name: Supabase integration boundary
description: Replit connector proxy behavior and live database migration requirements for this project.
---

The app uses a same-origin Vite proxy backed by the connected Supabase integration instead of exposing connection credentials in browser code. The live project can have tables and helper functions without having the business RPCs from the second SQL migration applied.

**Why:** The connected project's PostgREST endpoint returned the tables and helper functions, but reported `PGRST202` for business functions such as `auto_clockout_sweep` and `mark_notifications_read`. Client-side replacements would bypass the intended security and attendance rules.

**How to apply:** Keep application writes behind the Supabase RPCs defined in `supabase/functions.sql`. For a new or incomplete Supabase project, apply `supabase/schema.sql` first and `supabase/functions.sql` second, then verify representative RPCs through PostgREST before testing onboarding or authenticated workflows.