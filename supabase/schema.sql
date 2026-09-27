-- ============================================================
-- OfficeFlow — complete Supabase backend (part 1: schema + RLS)
-- Run this whole file once in the Supabase SQL editor.
-- ============================================================

create extension if not exists pgcrypto;

-- ============================ TABLES =========================

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  industry text,
  start_minute int not null default 540,
  end_minute int not null default 1050,
  late_grace_minutes int not null default 10,
  work_days int[] not null default '{1,2,3,4,5}',
  geo_enabled boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid references auth.users(id),
  email text not null,
  name text not null,
  employee_code text not null,
  role text not null default 'employee'
    check (role in ('company_admin','hr_admin','manager','employee')),
  department_id uuid,
  branch_id uuid,
  position text,
  manager_email text,
  joined_at timestamptz default now(),
  active boolean not null default true,
  deleted_at timestamptz,
  unique (company_id, email),
  unique (company_id, employee_code)
);

create table if not exists departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  unique (company_id, name)
);

create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  address text,
  latitude double precision,
  longitude double precision,
  geofence_radius_m int default 200,
  unique (company_id, name)
);

alter table employees
  add constraint fk_employees_department foreign key (department_id) references departments(id) on delete set null,
  add constraint fk_employees_branch foreign key (branch_id) references branches(id) on delete set null;

create table if not exists registered_devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  label text not null,
  platform text not null default 'iOS',
  public_key_fingerprint text not null,
  status text not null default 'active'
    check (status in ('active','pending_replacement','revoked')),
  registered_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists device_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  device_id uuid references registered_devices(id) on delete cascade,
  employee_id uuid references employees(id) on delete cascade,
  type text not null check (type in ('registered','replacement_requested','replacement_approved','revoked','scan_rejected')),
  detail text,
  actor text,
  at timestamptz not null default now()
);

create table if not exists qr_displays (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  label text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists qr_tokens (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  display_id uuid not null references qr_displays(id) on delete cascade,
  token_hash text not null,
  nonce text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references employees(id)
);
create index if not exists idx_qr_tokens_hash on qr_tokens(token_hash);
create index if not exists idx_qr_tokens_display on qr_tokens(display_id, issued_at desc);

create table if not exists attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  day_key date not null,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  break_minutes int not null default 0,
  status text not null default 'ongoing'
    check (status in ('present','late','half_day','ongoing','holiday','weekend','on_leave','absent')),
  late_minutes int not null default 0,
  early_leave_minutes int not null default 0,
  overtime_minutes int not null default 0,
  worked_minutes int,
  clock_in_device_id uuid references registered_devices(id),
  clock_in_display_id uuid references qr_displays(id),
  clock_out_device_id uuid references registered_devices(id),
  geo_verified boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  -- one active session per employee per day (partial unique index below)
  unique (employee_id, day_key)
);
create index if not exists idx_sessions_company_day on attendance_sessions(company_id, day_key desc);
create index if not exists idx_sessions_employee on attendance_sessions(employee_id, clock_in_at desc);

create table if not exists attendance_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  session_id uuid references attendance_sessions(id) on delete cascade,
  kind text not null check (kind in ('clock_in','clock_out','break_start','break_end','auto_clock_out')),
  at timestamptz not null default now(),
  day_key date not null,
  device_id uuid references registered_devices(id),
  display_id uuid references qr_displays(id),
  geo_verified boolean
);
create index if not exists idx_events_company on attendance_events(company_id, at desc);

create table if not exists correction_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  session_date date not null,
  requested_clock_in_at timestamptz,
  requested_clock_out_at timestamptz,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewer_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists leave_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  annual_quota_days int not null default 20,
  paid boolean not null default true,
  unique (company_id, name)
);

create table if not exists leave_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  leave_type_id uuid not null references leave_types(id),
  start_date date not null,
  end_date date not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_leave_company on leave_requests(company_id, status);

create table if not exists leave_balances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  leave_type_id uuid not null references leave_types(id) on delete cascade,
  year int not null,
  used_days numeric not null default 0,
  unique (employee_id, leave_type_id, year)
);

create table if not exists public_holidays (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  date date not null,
  name text not null,
  unique (company_id, date)
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  for_user_id uuid references auth.users(id),
  audience text not null default 'admins' check (audience in ('user','admins','employee')),
  type text not null,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_audience on notifications(company_id, audience, created_at desc);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  actor_email text not null,
  action text not null,
  detail text,
  at timestamptz not null default now()
);
create index if not exists idx_audit_company on audit_logs(company_id, at desc);

create table if not exists company_settings (
  company_id uuid primary key references companies(id) on delete cascade,
  qr_rotation_seconds int not null default 30,
  require_geo boolean not null default false,
  auto_clock_out_hours int not null default 14,
  retention_days int not null default 730
);

-- ============================ HELPERS ========================

-- my employee row + company for the current JWT
create or replace function public.my_employee()
returns employees
language sql stable security definer set search_path = public as $$
  select * from employees
  where user_id = auth.uid() and active and deleted_at is null
  limit 1;
$$;

create or replace function public.my_company_id()
returns uuid
language sql stable as $$
  select (my_employee()).company_id;
$$;

create or replace function public.my_role()
returns text
language sql stable as $$
  select (my_employee()).role;
$$;

create or replace function public.is_admin()
returns boolean
language sql stable as $$
  select coalesce(my_role() in ('company_admin','hr_admin'), false);
$$;

create or replace function public.can(perm text)
returns boolean
language plpgsql stable as $$
declare r text := my_role();
begin
  return case r
    when 'company_admin' then perm in (
      'manage_company','manage_employees','manage_attendance','manage_leave',
      'manage_devices','manage_qr','view_reports','view_audit','manage_settings',
      'approve_leave','approve_corrections','approve_devices')
    when 'hr_admin' then perm in (
      'manage_employees','manage_attendance','manage_leave','manage_devices',
      'manage_qr','view_reports','approve_leave','approve_corrections','approve_devices')
    when 'manager' then perm in ('view_reports','approve_leave','review_corrections')
    else false
  end;
end;
$$;

create or replace function public.touch_profile()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), new.raw_user_meta_data->>'full_name')
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.touch_profile();

-- ============================ RLS ============================

alter table companies            enable row level security;
alter table profiles             enable row level security;
alter table employees            enable row level security;
alter table departments          enable row level security;
alter table branches             enable row level security;
alter table registered_devices   enable row level security;
alter table device_events        enable row level security;
alter table qr_displays          enable row level security;
alter table qr_tokens            enable row level security;
alter table attendance_sessions  enable row level security;
alter table attendance_events    enable row level security;
alter table correction_requests  enable row level security;
alter table leave_types          enable row level security;
alter table leave_requests       enable row level security;
alter table leave_balances       enable row level security;
alter table public_holidays      enable row level security;
alter table notifications        enable row level security;
alter table audit_logs           enable row level security;
alter table company_settings     enable row level security;

-- companies: members can read their own company; creators can insert
drop policy if exists companies_read on companies;
create policy companies_read on companies for select
  using (id = my_company_id());

drop policy if exists companies_insert on companies;
create policy companies_insert on companies for insert
  with check (created_by = auth.uid());

drop policy if exists companies_update on companies;
create policy companies_update on companies for update
  using (can('manage_settings')) with check (true);

-- profiles: self only
drop policy if exists profiles_self on profiles;
create policy profiles_self on profiles for select using (id = auth.uid());
drop policy if exists profiles_self_upd on profiles;
create policy profiles_self_upd on profiles for update using (id = auth.uid());

-- employees: same-company read; self-update of profile fields; admins manage
drop policy if exists employees_read on employees;
create policy employees_read on employees for select
  using (company_id = my_company_id());

drop policy if exists employees_admin_insert on employees;
create policy employees_admin_insert on employees for insert
  with check (company_id = my_company_id() and can('manage_employees'));

drop policy if exists employees_admin_update on employees;
create policy employees_admin_update on employees for update
  using (company_id = my_company_id() and can('manage_employees'));

drop policy if exists employees_self_update on employees;
create policy employees_self_update on employees for update
  using (user_id = auth.uid());

drop policy if exists employees_admin_delete on employees;
create policy employees_admin_delete on employees for delete
  using (company_id = my_company_id() and can('manage_employees'));

-- generic tenant policies: read by company; write by admins (fine-grained in functions)
drop policy if exists dept_read on departments;
create policy dept_read on departments for select using (company_id = my_company_id());
drop policy if exists dept_write on departments;
create policy dept_write on departments for all
  using (company_id = my_company_id() and can('manage_employees'))
  with check (company_id = my_company_id() and can('manage_employees'));

drop policy if exists branch_read on branches;
create policy branch_read on branches for select using (company_id = my_company_id());
drop policy if exists branch_write on branches;
create policy branch_write on branches for all
  using (company_id = my_company_id() and can('manage_company'))
  with check (company_id = my_company_id() and can('manage_company'));

drop policy if exists dev_read on registered_devices;
create policy dev_read on registered_devices for select using (company_id = my_company_id());
drop policy if exists dev_write on registered_devices;
create policy dev_write on registered_devices for all
  using (company_id = my_company_id())
  with check (company_id = my_company_id());

drop policy if exists devev_read on device_events;
create policy devev_read on device_events for select using (company_id = my_company_id());
drop policy if exists devev_write on device_events;
create policy devev_write on device_events for all
  using (company_id = my_company_id()) with check (company_id = my_company_id());

drop policy if exists qrdisp_read on qr_displays;
create policy qrdisp_read on qr_displays for select using (company_id = my_company_id());
drop policy if exists qrdisp_write on qr_displays;
create policy qrdisp_write on qr_displays for all
  using (company_id = my_company_id() and can('manage_qr'))
  with check (company_id = my_company_id() and can('manage_qr'));

-- qr tokens: no direct client access at all (only security-definer functions)
drop policy if exists qrtok_none on qr_tokens;
create policy qrtok_none on qr_tokens for select using (false);

drop policy if exists sess_read on attendance_sessions;
create policy sess_read on attendance_sessions for select using (company_id = my_company_id());
drop policy if exists sess_write on attendance_sessions;
create policy sess_write on attendance_sessions for all
  using (company_id = my_company_id()) with check (company_id = my_company_id());

drop policy if exists ev_read on attendance_events;
create policy ev_read on attendance_events for select using (company_id = my_company_id());
drop policy if exists ev_write on attendance_events;
create policy ev_write on attendance_events for all
  using (company_id = my_company_id()) with check (company_id = my_company_id());

drop policy if exists corr_read on correction_requests;
create policy corr_read on correction_requests for select using (company_id = my_company_id());
drop policy if exists corr_write on correction_requests;
create policy corr_write on correction_requests for all
  using (company_id = my_company_id()) with check (company_id = my_company_id());

drop policy if exists lt_read on leave_types;
create policy lt_read on leave_types for select using (company_id = my_company_id());
drop policy if exists lt_write on leave_types;
create policy lt_write on leave_types for all
  using (company_id = my_company_id() and can('manage_settings'))
  with check (company_id = my_company_id() and can('manage_settings'));

drop policy if exists lr_read on leave_requests;
create policy lr_read on leave_requests for select using (company_id = my_company_id());
drop policy if exists lr_write on leave_requests;
create policy lr_write on leave_requests for all
  using (company_id = my_company_id()) with check (company_id = my_company_id());

drop policy if exists lb_read on leave_balances;
create policy lb_read on leave_balances for select using (company_id = my_company_id());
drop policy if exists lb_write on leave_balances;
create policy lb_write on leave_balances for all
  using (company_id = my_company_id()) with check (company_id = my_company_id());

drop policy if exists hol_read on public_holidays;
create policy hol_read on public_holidays for select using (company_id = my_company_id());
drop policy if exists hol_write on public_holidays;
create policy hol_write on public_holidays for all
  using (company_id = my_company_id() and can('manage_settings'))
  with check (company_id = my_company_id() and can('manage_settings'));

drop policy if exists notif_read on notifications;
create policy notif_read on notifications for select
  using (company_id = my_company_id() and (audience <> 'user' or for_user_id = auth.uid() or is_admin()));
drop policy if exists notif_upd on notifications;
create policy notif_upd on notifications for update
  using (company_id = my_company_id()) with check (company_id = my_company_id());
drop policy if exists notif_ins on notifications;
create policy notif_ins on notifications for insert
  with check (company_id = my_company_id());

drop policy if exists audit_read on audit_logs;
create policy audit_read on audit_logs for select
  using (company_id = my_company_id() and can('view_audit'));
drop policy if exists audit_ins on audit_logs;
create policy audit_ins on audit_logs for insert
  with check (company_id = my_company_id());

drop policy if exists cs_read on company_settings;
create policy cs_read on company_settings for select using (company_id = my_company_id());
drop policy if exists cs_write on company_settings;
create policy cs_write on company_settings for all
  using (company_id = my_company_id() and can('manage_settings'))
  with check (company_id = my_company_id() and can('manage_settings'));
