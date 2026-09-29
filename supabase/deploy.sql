-- ============================================================
-- OfficeFlow — single-file deploy
-- Paste this entire file into the Supabase SQL Editor and run.
-- Safe to re-run (idempotent tables, drop-if-exists policies).
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists companies (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  slug                text not null unique,
  industry            text,
  start_minute        int  not null default 540,
  end_minute          int  not null default 1050,
  late_grace_minutes  int  not null default 10,
  work_days           int[] not null default '{1,2,3,4,5}',
  geo_enabled         boolean not null default false,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now()
);

create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  created_at timestamptz not null default now()
);

create table if not exists employees (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  user_id        uuid references auth.users(id),
  email          text not null,
  name           text not null,
  employee_code  text not null,
  role           text not null default 'employee'
                   check (role in ('company_admin','hr_admin','manager','employee')),
  department_id  uuid,
  branch_id      uuid,
  position       text,
  manager_email  text,
  joined_at      timestamptz default now(),
  active         boolean not null default true,
  deleted_at     timestamptz,
  unique (company_id, email),
  unique (company_id, employee_code)
);

create table if not exists departments (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name       text not null,
  unique (company_id, name)
);

create table if not exists branches (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  name               text not null,
  address            text,
  latitude           double precision,
  longitude          double precision,
  geofence_radius_m  int default 200,
  unique (company_id, name)
);

-- Add FK constraints from employees → departments/branches only if not already there
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_employees_department'
  ) then
    alter table employees
      add constraint fk_employees_department
      foreign key (department_id) references departments(id) on delete set null;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_employees_branch'
  ) then
    alter table employees
      add constraint fk_employees_branch
      foreign key (branch_id) references branches(id) on delete set null;
  end if;
end $$;

create table if not exists registered_devices (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  employee_id           uuid not null references employees(id) on delete cascade,
  label                 text not null,
  platform              text not null default 'iOS',
  public_key_fingerprint text not null,
  status                text not null default 'active'
                          check (status in ('active','pending_replacement','revoked')),
  registered_at         timestamptz not null default now(),
  revoked_at            timestamptz
);

create table if not exists device_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  device_id   uuid references registered_devices(id) on delete cascade,
  employee_id uuid references employees(id) on delete cascade,
  type        text not null check (type in (
                'registered','replacement_requested','replacement_approved',
                'revoked','scan_rejected')),
  detail      text,
  actor       text,
  at          timestamptz not null default now()
);

create table if not exists qr_displays (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  branch_id  uuid references branches(id) on delete set null,
  label      text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists qr_tokens (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  display_id  uuid not null references qr_displays(id) on delete cascade,
  token_hash  text not null,
  nonce       text not null,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references employees(id)
);
create index if not exists idx_qr_tokens_hash    on qr_tokens(token_hash);
create index if not exists idx_qr_tokens_display on qr_tokens(display_id, issued_at desc);

create table if not exists attendance_sessions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  employee_id         uuid not null references employees(id) on delete cascade,
  day_key             date not null,
  clock_in_at         timestamptz not null,
  clock_out_at        timestamptz,
  break_minutes       int not null default 0,
  status              text not null default 'ongoing'
                        check (status in ('present','late','half_day','ongoing',
                                          'holiday','weekend','on_leave','absent')),
  late_minutes        int not null default 0,
  early_leave_minutes int not null default 0,
  overtime_minutes    int not null default 0,
  worked_minutes      int,
  clock_in_device_id  uuid references registered_devices(id),
  clock_in_display_id uuid references qr_displays(id),
  clock_out_device_id uuid references registered_devices(id),
  geo_verified        boolean not null default false,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now(),
  unique (employee_id, day_key)
);
create index if not exists idx_sessions_company_day on attendance_sessions(company_id, day_key desc);
create index if not exists idx_sessions_employee    on attendance_sessions(employee_id, clock_in_at desc);

create table if not exists attendance_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  session_id  uuid references attendance_sessions(id) on delete cascade,
  kind        text not null check (kind in (
                'clock_in','clock_out','break_start','break_end','auto_clock_out')),
  at          timestamptz not null default now(),
  day_key     date not null,
  device_id   uuid references registered_devices(id),
  display_id  uuid references qr_displays(id),
  geo_verified boolean
);
create index if not exists idx_events_company on attendance_events(company_id, at desc);

create table if not exists correction_requests (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies(id) on delete cascade,
  employee_id            uuid not null references employees(id) on delete cascade,
  session_date           date not null,
  requested_clock_in_at  timestamptz,
  requested_clock_out_at timestamptz,
  reason                 text not null,
  status                 text not null default 'pending'
                           check (status in ('pending','approved','rejected')),
  reviewer_note          text,
  reviewed_by            text,
  reviewed_at            timestamptz,
  created_at             timestamptz not null default now()
);

create table if not exists leave_types (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  name             text not null,
  annual_quota_days int not null default 20,
  paid             boolean not null default true,
  unique (company_id, name)
);

create table if not exists leave_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  employee_id   uuid not null references employees(id) on delete cascade,
  leave_type_id uuid not null references leave_types(id),
  start_date    date not null,
  end_date      date not null,
  reason        text not null,
  status        text not null default 'pending'
                  check (status in ('pending','approved','rejected','cancelled')),
  decided_by    text,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_leave_company on leave_requests(company_id, status);

create table if not exists leave_balances (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  employee_id   uuid not null references employees(id) on delete cascade,
  leave_type_id uuid not null references leave_types(id) on delete cascade,
  year          int not null,
  used_days     numeric not null default 0,
  unique (employee_id, leave_type_id, year)
);

create table if not exists public_holidays (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  date       date not null,
  name       text not null,
  unique (company_id, date)
);

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  for_user_id uuid references auth.users(id),
  audience   text not null default 'admins'
               check (audience in ('user','admins','employee')),
  type       text not null,
  title      text not null,
  body       text not null,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_audience
  on notifications(company_id, audience, created_at desc);

create table if not exists audit_logs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references companies(id) on delete cascade,
  actor_email text not null,
  action      text not null,
  detail      text,
  at          timestamptz not null default now()
);
create index if not exists idx_audit_company on audit_logs(company_id, at desc);

create table if not exists company_settings (
  company_id          uuid primary key references companies(id) on delete cascade,
  qr_rotation_seconds int not null default 30,
  require_geo         boolean not null default false,
  auto_clock_out_hours int not null default 14,
  retention_days      int not null default 730
);

-- ============================================================
-- HELPER FUNCTIONS (needed before RLS policies reference them)
-- ============================================================

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
  on conflict (id) do update
    set email = excluded.email, full_name = excluded.full_name;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.touch_profile();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table companies           enable row level security;
alter table profiles            enable row level security;
alter table employees           enable row level security;
alter table departments         enable row level security;
alter table branches            enable row level security;
alter table registered_devices  enable row level security;
alter table device_events       enable row level security;
alter table qr_displays         enable row level security;
alter table qr_tokens           enable row level security;
alter table attendance_sessions enable row level security;
alter table attendance_events   enable row level security;
alter table correction_requests enable row level security;
alter table leave_types         enable row level security;
alter table leave_requests      enable row level security;
alter table leave_balances      enable row level security;
alter table public_holidays     enable row level security;
alter table notifications       enable row level security;
alter table audit_logs          enable row level security;
alter table company_settings    enable row level security;

-- companies
drop policy if exists companies_read   on companies;
drop policy if exists companies_insert on companies;
drop policy if exists companies_update on companies;
create policy companies_read   on companies for select using (id = my_company_id());
create policy companies_insert on companies for insert with check (created_by = auth.uid());
create policy companies_update on companies for update using (can('manage_settings')) with check (true);

-- profiles
drop policy if exists profiles_self     on profiles;
drop policy if exists profiles_self_upd on profiles;
create policy profiles_self     on profiles for select using (id = auth.uid());
create policy profiles_self_upd on profiles for update using (id = auth.uid());

-- employees
drop policy if exists employees_read         on employees;
drop policy if exists employees_admin_insert on employees;
drop policy if exists employees_admin_update on employees;
drop policy if exists employees_self_update  on employees;
drop policy if exists employees_admin_delete on employees;
create policy employees_read         on employees for select using (company_id = my_company_id());
create policy employees_admin_insert on employees for insert with check (company_id = my_company_id() and can('manage_employees'));
create policy employees_admin_update on employees for update using (company_id = my_company_id() and can('manage_employees'));
create policy employees_self_update  on employees for update using (user_id = auth.uid());
create policy employees_admin_delete on employees for delete using (company_id = my_company_id() and can('manage_employees'));

-- departments
drop policy if exists dept_read  on departments;
drop policy if exists dept_write on departments;
create policy dept_read  on departments for select using (company_id = my_company_id());
create policy dept_write on departments for all
  using (company_id = my_company_id() and can('manage_employees'))
  with check (company_id = my_company_id() and can('manage_employees'));

-- branches
drop policy if exists branch_read  on branches;
drop policy if exists branch_write on branches;
create policy branch_read  on branches for select using (company_id = my_company_id());
create policy branch_write on branches for all
  using (company_id = my_company_id() and can('manage_company'))
  with check (company_id = my_company_id() and can('manage_company'));

-- registered_devices
drop policy if exists dev_read  on registered_devices;
drop policy if exists dev_write on registered_devices;
create policy dev_read  on registered_devices for select using (company_id = my_company_id());
create policy dev_write on registered_devices for all
  using (company_id = my_company_id()) with check (company_id = my_company_id());

-- device_events
drop policy if exists devev_read  on device_events;
drop policy if exists devev_write on device_events;
create policy devev_read  on device_events for select using (company_id = my_company_id());
create policy devev_write on device_events for all
  using (company_id = my_company_id()) with check (company_id = my_company_id());

-- qr_displays
drop policy if exists qrdisp_read  on qr_displays;
drop policy if exists qrdisp_write on qr_displays;
create policy qrdisp_read  on qr_displays for select using (company_id = my_company_id());
create policy qrdisp_write on qr_displays for all
  using (company_id = my_company_id() and can('manage_qr'))
  with check (company_id = my_company_id() and can('manage_qr'));

-- qr_tokens: no direct client access
drop policy if exists qrtok_none on qr_tokens;
create policy qrtok_none on qr_tokens for select using (false);

-- attendance_sessions
drop policy if exists sess_read  on attendance_sessions;
drop policy if exists sess_write on attendance_sessions;
create policy sess_read  on attendance_sessions for select using (company_id = my_company_id());
create policy sess_write on attendance_sessions for all
  using (company_id = my_company_id()) with check (company_id = my_company_id());

-- attendance_events
drop policy if exists ev_read  on attendance_events;
drop policy if exists ev_write on attendance_events;
create policy ev_read  on attendance_events for select using (company_id = my_company_id());
create policy ev_write on attendance_events for all
  using (company_id = my_company_id()) with check (company_id = my_company_id());

-- correction_requests
drop policy if exists corr_read  on correction_requests;
drop policy if exists corr_write on correction_requests;
create policy corr_read  on correction_requests for select using (company_id = my_company_id());
create policy corr_write on correction_requests for all
  using (company_id = my_company_id()) with check (company_id = my_company_id());

-- leave_types
drop policy if exists lt_read  on leave_types;
drop policy if exists lt_write on leave_types;
create policy lt_read  on leave_types for select using (company_id = my_company_id());
create policy lt_write on leave_types for all
  using (company_id = my_company_id() and can('manage_settings'))
  with check (company_id = my_company_id() and can('manage_settings'));

-- leave_requests
drop policy if exists lr_read  on leave_requests;
drop policy if exists lr_write on leave_requests;
create policy lr_read  on leave_requests for select using (company_id = my_company_id());
create policy lr_write on leave_requests for all
  using (company_id = my_company_id()) with check (company_id = my_company_id());

-- leave_balances
drop policy if exists lb_read  on leave_balances;
drop policy if exists lb_write on leave_balances;
create policy lb_read  on leave_balances for select using (company_id = my_company_id());
create policy lb_write on leave_balances for all
  using (company_id = my_company_id()) with check (company_id = my_company_id());

-- public_holidays
drop policy if exists hol_read  on public_holidays;
drop policy if exists hol_write on public_holidays;
create policy hol_read  on public_holidays for select using (company_id = my_company_id());
create policy hol_write on public_holidays for all
  using (company_id = my_company_id() and can('manage_settings'))
  with check (company_id = my_company_id() and can('manage_settings'));

-- notifications
drop policy if exists notif_read on notifications;
drop policy if exists notif_upd  on notifications;
drop policy if exists notif_ins  on notifications;
create policy notif_read on notifications for select
  using (company_id = my_company_id()
    and (audience <> 'user' or for_user_id = auth.uid() or is_admin()));
create policy notif_upd on notifications for update
  using (company_id = my_company_id()) with check (company_id = my_company_id());
create policy notif_ins on notifications for insert
  with check (company_id = my_company_id());

-- audit_logs
drop policy if exists audit_read on audit_logs;
drop policy if exists audit_ins  on audit_logs;
create policy audit_read on audit_logs for select
  using (company_id = my_company_id() and can('view_audit'));
create policy audit_ins on audit_logs for insert
  with check (company_id = my_company_id());

-- company_settings
drop policy if exists cs_read  on company_settings;
drop policy if exists cs_write on company_settings;
create policy cs_read  on company_settings for select using (company_id = my_company_id());
create policy cs_write on company_settings for all
  using (company_id = my_company_id() and can('manage_settings'))
  with check (company_id = my_company_id() and can('manage_settings'));

-- ============================================================
-- BUSINESS FUNCTIONS
-- (employees table exists here so row-type vars work)
-- ============================================================

create or replace function public.create_company(
  p_name text, p_industry text default null,
  p_start int default 540, p_end int default 1050,
  p_grace int default 10, p_work_days int[] default '{1,2,3,4,5}'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c_id    uuid;
  co_slug text;
  me      employees;
begin
  if p_end <= p_start then raise exception 'End time must be after start time'; end if;
  select * into me from my_employee();
  if me.id is not null then raise exception 'You already belong to a company'; end if;

  co_slug := lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g'));
  co_slug := btrim(co_slug, '-');
  if co_slug = '' then co_slug := 'company'; end if;
  if exists (select 1 from companies where companies.slug = co_slug) then
    co_slug := co_slug || '-' || substr(md5(random()::text), 1, 4);
  end if;

  insert into companies (name, slug, industry, start_minute, end_minute,
                         late_grace_minutes, work_days, created_by)
  values (p_name, co_slug, p_industry, p_start, p_end, p_grace, p_work_days, auth.uid())
  returning id into c_id;

  insert into company_settings (company_id) values (c_id);

  insert into employees (company_id, user_id, email, name, employee_code, role, position)
  values (c_id, auth.uid(),
    (select email from auth.users where id = auth.uid()),
    coalesce((select raw_user_meta_data->>'full_name' from auth.users where id = auth.uid()),
             split_part((select email from auth.users where id = auth.uid()), '@', 1)),
    'EMP-001', 'company_admin', 'Founder / Admin');

  insert into leave_types (company_id, name, annual_quota_days, paid) values
    (c_id, 'Annual Leave', 20, true),
    (c_id, 'Sick Leave',   10, true),
    (c_id, 'Unpaid Leave', 30, false);

  insert into audit_logs (company_id, actor_email, action, detail)
  values (c_id, (select email from auth.users where id = auth.uid()),
          'company.created', 'Company ' || p_name || ' created');

  return c_id;
end;
$$;

create or replace function public.join_company(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c_id   uuid;
  target employees;
  u_email text;
begin
  u_email := (select email from auth.users where id = auth.uid());
  if u_email is null then raise exception 'Not authenticated'; end if;

  if position(':' in p_code) > 0 then
    c_id := (select id from companies where companies.slug = split_part(p_code, ':', 1));
    if c_id is null then raise exception 'No company found for that code'; end if;
    select * into target from employees
    where company_id = c_id
      and upper(employee_code) = upper(split_part(p_code, ':', 2))
      and active and deleted_at is null
    limit 1;
    if target.id is null then raise exception 'No seat with that employee code'; end if;
    if target.user_id is not null then raise exception 'That seat already belongs to another user'; end if;
  else
    select * into target from employees
    where lower(email) = lower(u_email) and active and deleted_at is null
    limit 1;
    if target.id is null then
      raise exception 'No pending seat for your email — ask HR for the full code';
    end if;
    c_id := target.company_id;
  end if;

  update employees set user_id = auth.uid() where id = target.id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (c_id, u_email, 'employee.joined', u_email || ' claimed seat ' || target.employee_code);
  return c_id;
end;
$$;

-- -------------------- devices --------------------

create or replace function public.register_device(p_label text, p_platform text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me   employees;
  fp   text;
  d_id uuid;
begin
  select * into me from my_employee();
  fp := encode(digest(me.email || ':' || p_label || ':' || extract(epoch from now())::text, 'sha256'), 'hex');
  if (select count(*) from registered_devices
      where employee_id = me.id and status = 'active') >= 2 then
    raise exception 'Device policy: max 2 active devices per employee';
  end if;
  insert into registered_devices (company_id, employee_id, label, platform, public_key_fingerprint)
  values (me.company_id, me.id, p_label, p_platform, left(fp, 32))
  returning id into d_id;
  insert into device_events (company_id, device_id, employee_id, type, detail, actor)
  values (me.company_id, d_id, me.id, 'registered', p_platform || ' · ' || p_label, me.email);
  insert into notifications (company_id, audience, type, title, body)
  values (me.company_id, 'admins', 'device_registered', 'New device registered',
          me.name || ' registered ' || p_label || ' (' || p_platform || ').');
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'device.registered', me.email || ': ' || p_label);
  return d_id;
end;
$$;

create or replace function public.request_device_replacement(p_device uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  me employees;
  d  registered_devices;
begin
  select * into me from my_employee();
  select * into d from registered_devices where id = p_device and employee_id = me.id;
  if d.id is null then raise exception 'Device not found'; end if;
  update registered_devices set status = 'pending_replacement' where id = p_device;
  insert into device_events (company_id, device_id, employee_id, type, detail, actor)
  values (me.company_id, p_device, me.id, 'replacement_requested', p_reason, me.email);
  insert into notifications (company_id, audience, type, title, body)
  values (me.company_id, 'admins', 'device_pending', 'Device replacement requested',
          me.name || ': ' || p_reason);
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'device.replacement_requested', p_reason);
end;
$$;

create or replace function public.decide_device_replacement(p_device uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  me employees;
  d  registered_devices;
begin
  select * into me from my_employee();
  if not can('approve_devices') then raise exception 'Forbidden'; end if;
  select * into d from registered_devices where id = p_device and company_id = me.company_id;
  if d.id is null then raise exception 'Device not found'; end if;
  if d.status <> 'pending_replacement' then raise exception 'No pending replacement on this device'; end if;

  if p_approve then
    update registered_devices set status = 'revoked', revoked_at = now() where id = p_device;
    insert into device_events (company_id, device_id, employee_id, type, detail, actor)
    values (me.company_id, p_device, d.employee_id, 'replacement_approved',
            'Old device revoked — employee can register a new one', me.email);
  else
    update registered_devices set status = 'active' where id = p_device;
    insert into device_events (company_id, device_id, employee_id, type, detail, actor)
    values (me.company_id, p_device, d.employee_id, 'replacement_requested',
            'Replacement rejected — device stays active', me.email);
  end if;

  insert into notifications (company_id, for_user_id, audience, type, title, body)
  select me.company_id, e.user_id, 'employee',
    case when p_approve then 'Device replacement approved' else 'Device replacement rejected' end,
    case when p_approve
      then 'Your old device was revoked. You can now register a replacement.'
      else 'Your replacement request was rejected; keep using your current device.' end
  from employees e where e.id = d.employee_id;

  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email,
    case when p_approve then 'device.replacement_approved' else 'device.replacement_rejected' end,
    d.label);
end;
$$;

create or replace function public.revoke_device(p_device uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  me employees;
  d  registered_devices;
begin
  select * into me from my_employee();
  if not can('manage_devices') then raise exception 'Forbidden'; end if;
  select * into d from registered_devices where id = p_device and company_id = me.company_id;
  if d.id is null then raise exception 'Device not found'; end if;
  update registered_devices set status = 'revoked', revoked_at = now() where id = p_device;
  insert into device_events (company_id, device_id, employee_id, type, detail, actor)
  values (me.company_id, p_device, d.employee_id, 'revoked', p_reason, me.email);
  insert into notifications (company_id, for_user_id, audience, type, title, body)
  select me.company_id, e.user_id, 'employee', 'Device revoked',
         'Your device "' || d.label || '" was revoked by HR.'
  from employees e where e.id = d.employee_id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'device.revoked', d.label || ' — ' || p_reason);
end;
$$;

create or replace function public.reactivate_device(p_device uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare me employees;
begin
  select * into me from my_employee();
  if not can('manage_devices') then raise exception 'Forbidden'; end if;
  update registered_devices set status = 'active', revoked_at = null
  where id = p_device and company_id = me.company_id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'device.reactivated', p_device::text);
end;
$$;

-- -------------------- QR engine --------------------

create or replace function public.issue_qr_token(p_display uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare
  me   employees;
  disp qr_displays;
  ttl  int;
  raw  text;
  v    json;
begin
  select * into me from my_employee();
  select * into disp from qr_displays where id = p_display;
  if disp.id is null then raise exception 'Display not found'; end if;
  if disp.company_id <> me.company_id then raise exception 'Forbidden'; end if;

  select least(120, greatest(10, qr_rotation_seconds)) into ttl
  from company_settings where company_id = me.company_id;
  if ttl is null then ttl := 30; end if;

  raw := encode(gen_random_bytes(32), 'hex');
  insert into qr_tokens (company_id, display_id, token_hash, nonce, expires_at)
  values (me.company_id, p_display,
          encode(digest(raw, 'sha256'), 'hex'),
          left(raw, 16),
          now() + make_interval(secs => ttl));

  select json_build_object(
    'raw', raw,
    'expiresAt', extract(epoch from (now() + make_interval(secs => ttl))) * 1000,
    'ttlSeconds', ttl
  ) into v;
  return v;
end;
$$;

create or replace function public.scan_qr(
  p_raw    text,
  p_device uuid,
  p_lat    double precision default null,
  p_lng    double precision default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  me         employees;
  co         companies;
  st         company_settings;
  tok        qr_tokens;
  disp       qr_displays;
  dev        registered_devices;
  office     branches;
  dist       double precision;
  open_sess  attendance_sessions;
  arr_min    int;
  now_ts     timestamptz := now();
  late_m     int;
  worked     int;
  scheduled  int;
  early      int;
  ot         int;
  geo_ok     boolean := false;
begin
  select * into me from my_employee();
  if me.id is null then raise exception 'No active employee profile'; end if;
  select * into co from companies where id = me.company_id;
  select * into st from company_settings where company_id = me.company_id;

  select * into tok from qr_tokens
  where token_hash = encode(digest(p_raw, 'sha256'), 'hex')
  order by issued_at desc limit 1 for update;
  if tok.id is not null and tok.consumed_at is not null then
    raise exception 'This QR code was already used. Scan the current code.';
  end if;
  if tok.id is not null and tok.expires_at < now_ts then
    raise exception 'This QR code has expired. Scan the current code.';
  end if;
  if tok.id is null then raise exception 'Invalid QR code.'; end if;

  select * into disp from qr_displays where id = tok.display_id;
  if disp.company_id <> me.company_id then
    raise exception 'QR code does not belong to your company.';
  end if;

  select * into dev from registered_devices where id = p_device and employee_id = me.id;
  if dev.id is null then raise exception 'Device is not registered to you.'; end if;
  if dev.status <> 'active' then
    insert into device_events (company_id, device_id, employee_id, type, detail, actor)
    values (me.company_id, dev.id, me.id, 'scan_rejected',
            'Scan attempted with non-active device', me.email);
    raise exception 'This device is not active. Contact HR.';
  end if;

  if coalesce(st.require_geo, false) and co.geo_enabled then
    select * into office from branches
    where id = me.branch_id and latitude is not null and longitude is not null;
    if office.id is null then
      select * into office from branches
      where company_id = me.company_id and latitude is not null and longitude is not null limit 1;
    end if;
    if office.id is not null then
      if p_lat is null or p_lng is null then
        raise exception 'Location is required for this office. Enable location and try again.';
      end if;
      dist := 6371000 * 2 * asin(sqrt(
        power(sin(radians(office.latitude - p_lat) / 2), 2) +
        cos(radians(office.latitude)) * cos(radians(p_lat)) *
        power(sin(radians(office.longitude - p_lng) / 2), 2)));
      if dist > coalesce(office.geofence_radius_m, 200) then
        raise exception 'You appear to be %m from % — outside the office geofence.',
          round(dist)::text, office.name;
      end if;
      geo_ok := true;
    end if;
  end if;

  update qr_tokens set consumed_at = now_ts, consumed_by = me.id where id = tok.id;

  select * into open_sess from attendance_sessions
  where employee_id = me.id and day_key = (now_ts at time zone 'utc')::date
  order by clock_in_at desc limit 1;

  if open_sess.id is null or open_sess.clock_out_at is not null then
    if open_sess.id is not null then
      raise exception 'You have already completed attendance for today.';
    end if;
    arr_min := extract(hour   from now_ts at time zone 'utc') * 60
             + extract(minute from now_ts at time zone 'utc');
    late_m  := greatest(0, arr_min - (co.start_minute + co.late_grace_minutes));
    insert into attendance_sessions (company_id, employee_id, day_key, clock_in_at,
      status, late_minutes, clock_in_device_id, clock_in_display_id, geo_verified)
    values (me.company_id, me.id, (now_ts at time zone 'utc')::date, now_ts,
      case when late_m > 0 then 'late' else 'present' end,
      late_m, dev.id, disp.id, geo_ok)
    returning * into open_sess;
    insert into attendance_events (company_id, employee_id, session_id, kind, at, day_key,
      device_id, display_id, geo_verified)
    values (me.company_id, me.id, open_sess.id, 'clock_in', now_ts,
      (now_ts at time zone 'utc')::date, dev.id, disp.id, geo_ok);
    if late_m > 0 then
      insert into notifications (company_id, audience, type, title, body)
      values (me.company_id, 'admins', 'employee_late', 'Late arrival',
              me.name || ' clocked in ' || late_m || 'm late.');
    end if;
    insert into audit_logs (company_id, actor_email, action, detail)
    values (me.company_id, me.email, 'attendance.clock_in',
            me.name || ' at ' || to_char(now_ts, 'HH24:MI'));
    return json_build_object('action', 'clock_in',
      'message', case when late_m > 0
        then 'Clocked in — marked LATE by ' || late_m || ' min.'
        else 'Clocked in. Have a great day!' end);
  end if;

  worked    := greatest(0,
    round(extract(epoch from (now_ts - open_sess.clock_in_at)) / 60)::int
    - open_sess.break_minutes);
  scheduled := greatest(1, co.end_minute - co.start_minute);
  early     := greatest(0, co.end_minute -
    (extract(hour from now_ts at time zone 'utc') * 60
     + extract(minute from now_ts at time zone 'utc')));
  ot        := greatest(0, worked - scheduled);

  update attendance_sessions set
    clock_out_at        = now_ts,
    worked_minutes      = worked,
    early_leave_minutes = early,
    overtime_minutes    = ot,
    clock_out_device_id = dev.id,
    status = case when worked < scheduled / 2 then 'half_day' else open_sess.status end
  where id = open_sess.id;

  insert into attendance_events (company_id, employee_id, session_id, kind, at, day_key,
    device_id, display_id, geo_verified)
  values (me.company_id, me.id, open_sess.id, 'clock_out', now_ts,
    (now_ts at time zone 'utc')::date, dev.id, disp.id, geo_ok);
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'attendance.clock_out',
    me.name || ' at ' || to_char(now_ts, 'HH24:MI') || ' (' || worked || 'm)');

  return json_build_object('action', 'clock_out',
    'message', 'Clocked out — ' || round((worked / 60.0)::numeric, 1) || 'h worked today.'
               || case when ot > 0 then ' (' || ot || 'm overtime)' else '' end);
end;
$$;

create or replace function public.auto_clockout_sweep() returns int
language plpgsql security definer set search_path = public as $$
declare
  me     employees;
  co     companies;
  st     company_settings;
  cutoff timestamptz;
  closed int := 0;
  s      record;
begin
  select * into me from my_employee();
  if me.id is null then return 0; end if;
  select * into co from companies where id = me.company_id;
  select * into st from company_settings where company_id = me.company_id;
  cutoff := now() - make_interval(hours => coalesce(st.auto_clock_out_hours, 14));

  for s in
    select * from attendance_sessions
    where company_id = me.company_id and clock_out_at is null
      and status not in ('on_leave') and clock_in_at < cutoff
  loop
    update attendance_sessions set
      clock_out_at   = s.clock_in_at + make_interval(hours => coalesce(st.auto_clock_out_hours, 14)),
      worked_minutes = greatest(0, coalesce(st.auto_clock_out_hours, 14) * 60 - s.break_minutes),
      status         = 'half_day'
    where id = s.id;
    insert into attendance_events (company_id, employee_id, session_id, kind, at, day_key)
    values (me.company_id, s.employee_id, s.id, 'auto_clock_out',
      s.clock_in_at + make_interval(hours => coalesce(st.auto_clock_out_hours, 14)), s.day_key);
    closed := closed + 1;
  end loop;
  return closed;
end;
$$;

-- -------------------- leave --------------------

create or replace function public.work_days_between(p_start date, p_end date, p_company uuid)
returns int
language plpgsql stable security definer set search_path = public as $$
declare wd int[]; d date; n int := 0;
begin
  select work_days into wd from companies where id = p_company;
  d := p_start;
  while d <= p_end and n < 400 loop
    if extract(dow from d)::int = any(wd) then n := n + 1; end if;
    d := d + 1;
  end loop;
  return greatest(1, n);
end;
$$;

create or replace function public.request_leave(
  p_type uuid, p_start date, p_end date, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  me  employees;
  lt  leave_types;
  bal leave_balances;
  need int;
  y    int := extract(year from p_start)::int;
begin
  select * into me from my_employee();
  if p_end < p_start then raise exception 'End date must be on or after start date'; end if;
  if btrim(p_reason) = '' then raise exception 'A reason is required'; end if;
  if exists (select 1 from leave_requests
             where employee_id = me.id and status in ('pending','approved')
               and start_date <= p_end and p_start <= end_date) then
    raise exception 'You already have a request overlapping these dates';
  end if;
  select * into lt from leave_types where id = p_type and company_id = me.company_id;
  if lt.id is null then raise exception 'Leave type not found'; end if;
  need := work_days_between(p_start, p_end, me.company_id);
  select * into bal from leave_balances
  where employee_id = me.id and leave_type_id = p_type and year = y;
  if bal.id is not null and bal.used_days + need > lt.annual_quota_days then
    raise exception 'Insufficient balance: only % day(s) left of %.',
      greatest(0, lt.annual_quota_days - bal.used_days)::text, lt.name;
  end if;
  insert into leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, reason)
  values (me.company_id, me.id, p_type, p_start, p_end, btrim(p_reason));
  insert into notifications (company_id, audience, type, title, body)
  values (me.company_id, 'admins', 'leave_pending', 'New leave request',
          me.name || ' requested ' || p_start || ' → ' || p_end || '.');
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'leave.requested',
          me.email || ' ' || p_start || '→' || p_end);
end;
$$;

create or replace function public.decide_leave(
  p_request uuid, p_approve boolean, p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  me   employees;
  r    leave_requests;
  lt   leave_types;
  days int;
begin
  select * into me from my_employee();
  if not can('approve_leave') then raise exception 'Forbidden'; end if;
  select * into r from leave_requests where id = p_request and company_id = me.company_id;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then raise exception 'Already decided'; end if;

  update leave_requests set
    status        = case when p_approve then 'approved' else 'rejected' end,
    decided_by    = me.email,
    decided_at    = now(),
    decision_note = p_note
  where id = p_request;

  if p_approve then
    select * into lt from leave_types where id = r.leave_type_id;
    days := work_days_between(r.start_date, r.end_date, me.company_id);
    insert into leave_balances (company_id, employee_id, leave_type_id, year, used_days)
    values (me.company_id, r.employee_id, r.leave_type_id,
            extract(year from r.start_date)::int, days)
    on conflict (employee_id, leave_type_id, year)
    do update set used_days = leave_balances.used_days + excluded.used_days;
  end if;

  insert into notifications (company_id, for_user_id, audience, type, title, body)
  select me.company_id, e.user_id, 'employee',
    case when p_approve then 'Leave approved' else 'Leave rejected' end,
    'Your leave ' || r.start_date || ' → ' || r.end_date || ' was ' ||
      case when p_approve then 'approved' else 'rejected' end ||
      coalesce(': ' || p_note, '.')
  from employees e where e.id = r.employee_id;

  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email,
    case when p_approve then 'leave.approved' else 'leave.rejected' end,
    r.employee_id::text || ' ' || r.start_date || '→' || r.end_date);
end;
$$;

create or replace function public.cancel_leave(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me employees;
begin
  select * into me from my_employee();
  update leave_requests set status = 'cancelled'
  where id = p_request and employee_id = me.id and status = 'pending';
  if not found then raise exception 'Only your own pending requests can be cancelled'; end if;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'leave.cancelled', p_request::text);
end;
$$;

-- -------------------- corrections --------------------

create or replace function public.request_correction(
  p_date date, p_in timestamptz default null,
  p_out  timestamptz default null, p_reason text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare me employees;
begin
  select * into me from my_employee();
  if btrim(p_reason) = '' then raise exception 'A reason is required'; end if;
  insert into correction_requests (company_id, employee_id, session_date,
    requested_clock_in_at, requested_clock_out_at, reason)
  values (me.company_id, me.id, p_date, p_in, p_out, btrim(p_reason));
  insert into notifications (company_id, audience, type, title, body)
  values (me.company_id, 'admins', 'correction_pending', 'Attendance correction requested',
          me.name || ' requested a correction for ' || p_date || '.');
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'correction.requested', me.email || ' for ' || p_date);
end;
$$;

create or replace function public.decide_correction(
  p_request uuid, p_approve boolean, p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  me  employees;
  r   correction_requests;
  co  companies;
  s   attendance_sessions;
  arr int; late_m int; worked int; scheduled int; early int; ot int;
begin
  select * into me from my_employee();
  if not can('approve_corrections') then raise exception 'Forbidden'; end if;
  select * into r from correction_requests where id = p_request and company_id = me.company_id;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then raise exception 'Already reviewed'; end if;
  select * into co from companies where id = me.company_id;

  update correction_requests set
    status        = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by   = me.email,
    reviewed_at   = now(),
    reviewer_note = p_note
  where id = p_request;

  if p_approve then
    select * into s from attendance_sessions
    where employee_id = r.employee_id and day_key = r.session_date limit 1;
    if s.id is not null then
      arr    := extract(hour from coalesce(r.requested_clock_in_at, s.clock_in_at) at time zone 'utc') * 60
              + extract(minute from coalesce(r.requested_clock_in_at, s.clock_in_at) at time zone 'utc');
      late_m := greatest(0, arr - (co.start_minute + co.late_grace_minutes));
      worked := case when coalesce(r.requested_clock_out_at, s.clock_out_at) is null then null
        else greatest(0,
          round(extract(epoch from
            (coalesce(r.requested_clock_out_at, s.clock_out_at)
             - coalesce(r.requested_clock_in_at, s.clock_in_at))) / 60)::int
          - s.break_minutes) end;
      scheduled := greatest(1, co.end_minute - co.start_minute);
      early  := case when coalesce(r.requested_clock_out_at, s.clock_out_at) is null then 0
        else greatest(0, co.end_minute -
          (extract(hour   from coalesce(r.requested_clock_out_at, s.clock_out_at) at time zone 'utc') * 60
           + extract(minute from coalesce(r.requested_clock_out_at, s.clock_out_at) at time zone 'utc'))) end;
      ot     := greatest(0, coalesce(worked, 0) - scheduled);
      update attendance_sessions set
        clock_in_at         = coalesce(r.requested_clock_in_at,  s.clock_in_at),
        clock_out_at        = coalesce(r.requested_clock_out_at, s.clock_out_at),
        worked_minutes      = worked,
        late_minutes        = late_m,
        early_leave_minutes = early,
        overtime_minutes    = ot,
        status = case
          when worked is not null and worked < scheduled / 2 then 'half_day'
          when late_m > 0 then 'late'
          else 'present' end
      where id = s.id;
    elsif r.requested_clock_in_at is not null then
      arr    := extract(hour   from r.requested_clock_in_at at time zone 'utc') * 60
              + extract(minute from r.requested_clock_in_at at time zone 'utc');
      late_m := greatest(0, arr - (co.start_minute + co.late_grace_minutes));
      insert into attendance_sessions (company_id, employee_id, day_key, clock_in_at,
        clock_out_at, status, late_minutes)
      values (me.company_id, r.employee_id, r.session_date, r.requested_clock_in_at,
        r.requested_clock_out_at,
        case when late_m > 0 then 'late' else 'present' end, late_m);
      insert into attendance_events (company_id, employee_id, session_id, kind, at, day_key)
      values (me.company_id, r.employee_id,
        (select id from attendance_sessions
         where employee_id = r.employee_id and day_key = r.session_date limit 1),
        'clock_in', r.requested_clock_in_at, r.session_date);
    end if;
  end if;

  insert into notifications (company_id, for_user_id, audience, type, title, body)
  select me.company_id, e.user_id, 'employee',
    case when p_approve then 'Correction approved' else 'Correction rejected' end,
    'Your correction for ' || r.session_date || ' was ' ||
      case when p_approve then 'approved' else 'rejected' end || '.'
  from employees e where e.id = r.employee_id;

  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email,
    case when p_approve then 'correction.approved' else 'correction.rejected' end,
    r.session_date::text);
end;
$$;

-- -------------------- employees / org --------------------

create or replace function public.add_employee(
  p_name       text,
  p_email      text,
  p_code       text,
  p_role       text,
  p_position   text    default null,
  p_department uuid    default null,
  p_branch     uuid    default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me   employees;
  e_id uuid;
begin
  select * into me from my_employee();
  if not can('manage_employees') then raise exception 'Forbidden'; end if;
  if p_role not in ('company_admin','hr_admin','manager','employee') then
    raise exception 'Invalid role';
  end if;
  insert into employees (company_id, email, name, employee_code, role,
                         position, department_id, branch_id)
  values (me.company_id, lower(btrim(p_email)), btrim(p_name), upper(btrim(p_code)),
          p_role, p_position, p_department, p_branch)
  returning id into e_id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'employee.added', p_email || ' (' || p_code || ')');
  return e_id;
end;
$$;

create or replace function public.deactivate_employee(p_employee uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me employees;
begin
  select * into me from my_employee();
  if not can('manage_employees') then raise exception 'Forbidden'; end if;
  if p_employee = me.id then raise exception 'You cannot deactivate yourself'; end if;
  update employees set active = false, deleted_at = now()
  where id = p_employee and company_id = me.company_id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'employee.deactivated', p_employee::text);
end;
$$;

create or replace function public.add_department(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me   employees;
  d_id uuid;
begin
  select * into me from my_employee();
  if not can('manage_employees') then raise exception 'Forbidden'; end if;
  insert into departments (company_id, name)
  values (me.company_id, btrim(p_name)) returning id into d_id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'department.added', p_name);
  return d_id;
end;
$$;

create or replace function public.add_branch(
  p_name    text,
  p_address text            default null,
  p_lat     double precision default null,
  p_lng     double precision default null,
  p_radius  int             default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me   employees;
  b_id uuid;
begin
  select * into me from my_employee();
  if not can('manage_company') then raise exception 'Forbidden'; end if;
  insert into branches (company_id, name, address, latitude, longitude, geofence_radius_m)
  values (me.company_id, btrim(p_name), p_address, p_lat, p_lng, p_radius)
  returning id into b_id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'branch.added', p_name);
  return b_id;
end;
$$;

create or replace function public.update_settings(
  p_name        text     default null,
  p_industry    text     default null,
  p_start       int      default null,
  p_end         int      default null,
  p_grace       int      default null,
  p_work_days   int[]    default null,
  p_qr_rotation int      default null,
  p_require_geo boolean  default null,
  p_geo_enabled boolean  default null,
  p_auto_out    int      default null,
  p_retention   int      default null
) returns void
language plpgsql security definer set search_path = public as $$
declare me employees;
begin
  select * into me from my_employee();
  if not can('manage_settings') then raise exception 'Forbidden'; end if;
  update companies set
    name               = coalesce(p_name,        name),
    industry           = coalesce(p_industry,    industry),
    start_minute       = coalesce(p_start,        start_minute),
    end_minute         = coalesce(p_end,          end_minute),
    late_grace_minutes = coalesce(p_grace,        late_grace_minutes),
    work_days          = coalesce(p_work_days,    work_days),
    geo_enabled        = coalesce(p_geo_enabled,  geo_enabled)
  where id = me.company_id;
  update company_settings set
    qr_rotation_seconds  = coalesce(p_qr_rotation, qr_rotation_seconds),
    require_geo          = coalesce(p_require_geo,  require_geo),
    auto_clock_out_hours = coalesce(p_auto_out,     auto_clock_out_hours),
    retention_days       = coalesce(p_retention,    retention_days)
  where company_id = me.company_id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'settings.updated', 'company settings changed');
end;
$$;

create or replace function public.add_holiday(p_date date, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare me employees;
begin
  select * into me from my_employee();
  if not can('manage_settings') then raise exception 'Forbidden'; end if;
  insert into public_holidays (company_id, date, name)
  values (me.company_id, p_date, btrim(p_name));
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'holiday.added', p_date || ' ' || p_name);
end;
$$;

create or replace function public.remove_holiday(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me employees;
begin
  select * into me from my_employee();
  if not can('manage_settings') then raise exception 'Forbidden'; end if;
  delete from public_holidays where id = p_id and company_id = me.company_id;
end;
$$;

create or replace function public.add_leave_type(p_name text, p_quota int, p_paid boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare me employees;
begin
  select * into me from my_employee();
  if not can('manage_settings') then raise exception 'Forbidden'; end if;
  insert into leave_types (company_id, name, annual_quota_days, paid)
  values (me.company_id, btrim(p_name), p_quota, p_paid);
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'leave_type.added', p_name);
end;
$$;

create or replace function public.create_qr_display(p_label text, p_branch uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me   employees;
  d_id uuid;
begin
  select * into me from my_employee();
  if not can('manage_qr') then raise exception 'Forbidden'; end if;
  insert into qr_displays (company_id, branch_id, label)
  values (me.company_id, p_branch, btrim(p_label)) returning id into d_id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'qr_display.created', p_label);
  return d_id;
end;
$$;

create or replace function public.toggle_qr_display(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me employees;
begin
  select * into me from my_employee();
  if not can('manage_qr') then raise exception 'Forbidden'; end if;
  update qr_displays set active = not active
  where id = p_id and company_id = me.company_id;
end;
$$;

create or replace function public.delete_qr_display(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me employees;
begin
  select * into me from my_employee();
  if not can('manage_qr') then raise exception 'Forbidden'; end if;
  delete from qr_displays where id = p_id and company_id = me.company_id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'qr_display.deleted', p_id::text);
end;
$$;

create or replace function public.mark_notifications_read(
  p_all boolean default true, p_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare me employees;
begin
  select * into me from my_employee();
  if me.id is null then return; end if;
  if p_all then
    update notifications set read_at = now()
    where company_id = me.company_id and read_at is null
      and (audience in ('admins','employee') or for_user_id = auth.uid());
  elsif p_id is not null then
    update notifications set read_at = now()
    where id = p_id and company_id = me.company_id;
  end if;
end;
$$;

-- ============================================================
-- ANALYTICS RPCs
-- ============================================================

create or replace function public.dashboard_data()
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  me        employees;
  c_id      uuid;
  v         json;
begin
  select * into me from my_employee();
  if me.id is null then return null; end if;
  c_id := me.company_id;

  with emps as (
    select * from employees
    where company_id = c_id and active and deleted_at is null
  ),
  today as (
    select * from attendance_sessions
    where company_id = c_id
      and day_key = (now() at time zone 'utc')::date
      and deleted_at is null
  ),
  trend as (
    select
      to_char(d, 'YYYY-MM-DD') as day,
      (select count(*) from attendance_sessions s
        where s.company_id = c_id and s.day_key = d::date
          and s.status in ('present','ongoing')) as present,
      (select count(*) from attendance_sessions s
        where s.company_id = c_id and s.day_key = d::date
          and s.status = 'late') as late,
      greatest(0,
        (select count(*) from emps)
        - (select count(*) from attendance_sessions s
            where s.company_id = c_id and s.day_key = d::date and s.status <> 'on_leave')
        - (select count(*) from attendance_sessions s
            where s.company_id = c_id and s.day_key = d::date and s.status = 'on_leave')
      ) as absent
    from generate_series(current_date - 13, current_date, interval '1 day') d
  ),
  dept_rows as (
    select dp.name,
      (select count(*) from emps e where e.department_id = dp.id) as total,
      (select count(*) from today t join emps e on e.id = t.employee_id
        where e.department_id = dp.id and t.status not in ('on_leave','late')) as present,
      (select count(*) from today t join emps e on e.id = t.employee_id
        where e.department_id = dp.id and t.status = 'late') as late,
      greatest(0,
        (select count(*) from emps e where e.department_id = dp.id)
        - (select count(*) from today t join emps e on e.id = t.employee_id
            where e.department_id = dp.id and t.status <> 'on_leave')
      ) as absent
    from departments dp where dp.company_id = c_id
  ),
  recent as (
    select ev.id, ev.kind, ev.at,
           to_char(ev.day_key, 'YYYY-MM-DD') as day_key,
           coalesce(e.name, 'Unknown') as employee_name
    from attendance_events ev
    left join employees e on e.id = ev.employee_id
    where ev.company_id = c_id
    order by ev.at desc limit 12
  )
  select json_build_object(
    'counts', json_build_object(
      'total_employees', (select count(*) from emps),
      'present',         (select count(*) from today where status = 'present'),
      'late',            (select count(*) from today where status = 'late'),
      'half_day',        (select count(*) from today where status = 'half_day'),
      'on_leave',        (select count(*) from today where status = 'on_leave'),
      'ongoing',         (select count(*) from today where clock_out_at is null and status not in ('on_leave')),
      'absent',          greatest(0,
                           (select count(*) from emps)
                           - (select count(*) from today where status <> 'on_leave')
                           - (select count(*) from today where status = 'on_leave')),
      'missing_out',     (select count(*) from attendance_sessions s
                           where s.company_id = c_id and s.clock_out_at is null
                             and s.status not in ('on_leave')
                             and s.day_key >= current_date - 7
                             and s.day_key <  current_date),
      'missing_devices', 0
    ),
    'trend',              (select json_agg(t order by t.day)    from trend t),
    'deptRows',           (select json_agg(dr order by dr.name) from dept_rows dr),
    'recentEvents',       (select json_agg(r order by r.at desc) from recent r),
    'pendingLeave',       (select count(*) from leave_requests
                            where company_id = c_id and status = 'pending'),
    'pendingCorrections', (select count(*) from correction_requests
                            where company_id = c_id and status = 'pending'),
    'myRole',             me.role
  ) into v;

  return v;
end;
$$;

create or replace function public.analytics_range(
  p_from       date,
  p_to         date,
  p_department uuid default null,
  p_branch     uuid default null,
  p_employee   uuid default null
) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  me employees;
  co companies;
  v  json;
begin
  select * into me from my_employee();
  if me.id is null then return null; end if;
  select * into co from companies where id = me.company_id;

  with scoped as (
    select * from employees
    where company_id = me.company_id and active and deleted_at is null
      and (p_department is null or department_id = p_department)
      and (p_branch     is null or branch_id     = p_branch)
      and (p_employee   is null or id            = p_employee)
  ),
  days as (
    select generate_series(p_from, p_to, interval '1 day')::date as d
  ),
  expected as (
    select (select count(*) from scoped) * (
      select count(*) from days
      where extract(dow from d)::int = any(co.work_days)
        and not exists (select 1 from public_holidays h
                        where h.company_id = me.company_id and h.date = d)
    ) as n
  ),
  sess as (
    select s.* from attendance_sessions s
    join scoped sc on sc.id = s.employee_id
    where s.company_id = me.company_id
      and s.day_key between p_from and p_to
      and s.deleted_at is null
  ),
  worked as (select * from sess where status <> 'on_leave'),
  closed as (select * from worked where clock_out_at is not null),
  per_emp as (
    select
      sc.id             as employee_id,
      sc.name,
      sc.employee_code  as code,
      coalesce(dp.name, '—') as department,
      (select count(*) from closed c  where c.employee_id = sc.id and c.status = 'present')  as present_days,
      (select count(*) from worked w  where w.employee_id = sc.id and w.status = 'late')      as late_days,
      (select count(*) from worked w  where w.employee_id = sc.id and w.status = 'half_day')  as half_days,
      greatest(0,
        (select n from expected) / greatest(1, (select count(*) from scoped))
        - (select count(*) from worked w where w.employee_id = sc.id)
      ) as absent_days,
      (select count(*) from sess s    where s.employee_id  = sc.id and s.status = 'on_leave') as leave_days,
      round(coalesce((select sum(worked_minutes) from closed c where c.employee_id = sc.id), 0) / 60.0, 1) as worked_hours,
      round(coalesce((select sum(overtime_minutes) from closed c where c.employee_id = sc.id), 0) / 60.0, 1) as overtime_hours,
      coalesce((select sum(late_minutes) from worked w where w.employee_id = sc.id), 0) as late_minutes
    from scoped sc
    left join departments dp on dp.id = sc.department_id
  ),
  daily as (
    select
      to_char(d.d, 'YYYY-MM-DD') as day,
      (select count(*) from worked w
        where w.day_key = d.d
          and w.status in ('present','late','half_day','ongoing')) as present,
      (select count(*) from worked w where w.day_key = d.d and w.status = 'late') as late,
      greatest(0,
        (select count(*) from scoped)
        - (select count(*) from worked w where w.day_key = d.d)
        - (select count(*) from sess  s where s.day_key = d.d and s.status = 'on_leave')
      ) as absent
    from days d
  ),
  avgs as (
    select
      coalesce((select round(avg(
        extract(hour   from clock_in_at at time zone 'utc') * 60
        + extract(minute from clock_in_at at time zone 'utc')))
        from closed), 0) as avg_in_min,
      coalesce((select round(avg(
        extract(hour   from clock_out_at at time zone 'utc') * 60
        + extract(minute from clock_out_at at time zone 'utc')))
        from closed), 0) as avg_out_min
  )
  select json_build_object(
    'totals', json_build_object(
      'employeeCount',    (select count(*) from scoped),
      'attendanceRate',   case when (select n from expected) > 0
        then round((select count(*) from worked) * 100.0 / (select n from expected), 1)
        else 0 end,
      'punctualityRate',  case when (select count(*) from worked) > 0
        then round(
          ((select count(*) from worked)
           - (select count(*) from worked where status = 'late')) * 100.0
          / (select count(*) from worked), 1)
        else 0 end,
      'avgArrival',       to_char(make_interval(mins => (select avg_in_min  from avgs)::int), 'HH24:MI'),
      'avgDeparture',     to_char(make_interval(mins => (select avg_out_min from avgs)::int), 'HH24:MI'),
      'avgWorkedHours',   case when (select count(*) from closed) > 0
        then round((select avg(worked_minutes) from closed) / 60.0, 1) else 0 end,
      'totalLateMinutes', coalesce((select sum(late_minutes)     from worked), 0),
      'totalOvertimeHours', round(coalesce((select sum(overtime_minutes) from worked), 0) / 60.0, 1),
      'earlyDepartures',  (select count(*) from worked where early_leave_minutes > 15),
      'absenceDays',      greatest(0,
        (select n from expected)
        - (select count(*) from worked)
        - (select count(*) from sess where status = 'on_leave')),
      'leaveDays',        (select count(*) from sess where status = 'on_leave')
    ),
    'perEmployee', (select json_agg(x order by x.name) from per_emp x),
    'daily',       (select json_agg(x order by x.day)  from daily x)
  )
  into v;

  return v;
end;
$$;

-- ============================================================
-- DEMO SEED (optional — call select seed_demo('<company_id>'))
-- ============================================================

create or replace function public.seed_demo(p_company uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  co         companies;
  founder    employees;
  main       uuid;
  d_eng      uuid; d_des uuid; d_ppl uuid; d_sal uuid;
  type_annual uuid; type_sick uuid;
  rec        record;
  emp        record;
  emp_id     uuid;
  dev_id     uuid;
  i          int;
  names      text[] := array[
    'Amara Okafor','Liam Chen','Sofia Reyes','Noah Kimura','Priya Sharma',
    'Mateo Alvarez','Zara Ahmed','Ethan Brooks','Mia Novak','Kenji Sato',
    'Lena Fischer','Omar Haddad','Grace Mwangi','Tomas Novotny','Ivy Laurent',
    'Ravi Patel','Hana Yoshida','Diego Morales','Nora Lindqvist','Sam Osei'];
  positions  text[] := array[
    'Engineering Manager','Senior Engineer','Product Designer','People Partner',
    'Data Analyst','Account Executive','Support Lead','QA Engineer'];
  r          double precision;
  late       boolean;
  in_min     int; out_min int;
  clock_in   timestamptz; clock_out timestamptz;
  brk        int; worked int; scheduled int; late_m int; early_m int; ot_m int;
  day        date;
  sess       uuid;
  cur_status text;
begin
  select * into co from companies where id = p_company;
  if co.id is null then raise exception 'Company not found'; end if;
  select * into founder from employees
  where company_id = p_company and employees.role = 'company_admin' limit 1;
  scheduled := greatest(1, co.end_minute - co.start_minute);

  insert into branches (company_id, name, address, latitude, longitude, geofence_radius_m)
  values (p_company, 'HQ — Main Campus', '1 Harbor Way', 37.7749, -122.4194, 150)
  returning id into main;
  insert into branches (company_id, name, address, latitude, longitude, geofence_radius_m)
  values (p_company, 'Riverside Office', '88 River Rd', 37.785, -122.405, 120);

  insert into departments (company_id, name) values (p_company, 'Engineering') returning id into d_eng;
  insert into departments (company_id, name) values (p_company, 'Design')      returning id into d_des;
  insert into departments (company_id, name) values (p_company, 'People Ops')  returning id into d_ppl;
  insert into departments (company_id, name) values (p_company, 'Sales')       returning id into d_sal;

  for i in 1..20 loop
    insert into employees (company_id, email, name, employee_code, role,
                           department_id, branch_id, position, joined_at)
    values (
      p_company,
      lower(replace(names[i], ' ', '.')) || '@demo.officeflow.app',
      names[i],
      'EMP-' || lpad((i + 1)::text, 3, '0'),
      case i when 1 then 'hr_admin' when 2 then 'manager' else 'employee' end,
      (array[d_eng, d_des, d_ppl, d_sal])[1 + (i % 4)],
      case when i % 5 = 0 then null else main end,
      positions[1 + (i % 8)],
      now() - (i * 37) * interval '1 day')
    returning id into emp_id;

    if i <> 7 then
      insert into registered_devices (company_id, employee_id, label, platform, public_key_fingerprint)
      values (p_company, emp_id,
        (array['iPhone 15','Pixel 8','Galaxy S24'])[1 + (i % 3)],
        (array['iOS','Android','Android'])[1 + (i % 3)],
        left(encode(digest(names[i] || ':device', 'sha256'), 'hex'), 32))
      returning id into dev_id;
      insert into device_events (company_id, device_id, employee_id, type, detail, actor, at)
      values (p_company, dev_id, emp_id, 'registered',
              'Device registered during onboarding',
              lower(replace(names[i], ' ', '.')) || '@demo.officeflow.app',
              now() - (i * interval '1 day'));
    end if;
  end loop;

  select id into type_annual from leave_types where company_id = p_company and leave_types.name = 'Annual Leave';
  select id into type_sick   from leave_types where company_id = p_company and leave_types.name = 'Sick Leave';

  for rec in select id from employees where company_id = p_company loop
    insert into leave_balances (company_id, employee_id, leave_type_id, year, used_days)
    values
      (p_company, rec.id, type_annual, extract(year from now())::int, 0),
      (p_company, rec.id, type_sick,   extract(year from now())::int, 0);
  end loop;

  insert into public_holidays (company_id, date, name) values
    (p_company, current_date - 12, 'Founders Day'),
    (p_company, current_date + 9,  'Wellness Day'),
    (p_company, current_date + 24, 'Summer Festival');

  insert into leave_requests (company_id, employee_id, leave_type_id,
    start_date, end_date, reason, status, decided_by, decided_at, created_at)
  select p_company, e.id,
    case when g.k in (4, 9) then type_sick else type_annual end,
    current_date + g.off, current_date + g.off + g.days - 1,
    case when g.k in (4, 9) then 'Flu' else 'Vacation' end,
    case when g.k in (7, 9, 11) then 'pending' else 'approved' end,
    case when g.k in (7, 9, 11) then null else 'hr@demo.officeflow.app' end,
    case when g.k in (7, 9, 11) then null else now() - interval '2 days' end,
    now() - interval '3 days'
  from (values (2,-6,3),(4,0,1),(5,4,2),(7,2,5),(9,1,1),(11,10,4),(13,-20,2)) as g(k, off, days)
  join employees e on e.company_id = p_company
    and e.employee_code = 'EMP-' || lpad(g.k::text, 3, '0');

  update leave_balances b set used_days = sub.days
  from (
    select lr.employee_id, lr.leave_type_id,
      greatest(1, (select count(*) from generate_series(lr.start_date, lr.end_date, interval '1 day') g(d)
        where extract(dow from g.d)::int = any(co.work_days))) as days
    from leave_requests lr
    where lr.company_id = p_company and lr.status = 'approved'
  ) sub
  where b.employee_id = sub.employee_id
    and b.leave_type_id = sub.leave_type_id
    and b.year = extract(year from now())::int;

  insert into qr_displays (company_id, branch_id, label, active, created_at) values
    (p_company, main, 'Lobby Kiosk — Main',          true,  now() - interval '30 days'),
    (p_company, main, 'Elevator Bank — Floor 3',     true,  now() - interval '30 days'),
    (p_company, null, 'Riverside Reception',          false, now() - interval '5 days');

  for day in
    select generate_series(current_date - 30, current_date - 1, interval '1 day')::date
  loop
    if not (extract(dow from day)::int = any(co.work_days)) then continue; end if;
    if exists (select 1 from public_holidays where company_id = p_company and date = day) then
      continue;
    end if;

    for emp in select e.id from employees e where e.company_id = p_company and e.active loop
      if exists (select 1 from leave_requests lr
                 where lr.employee_id = emp.id and lr.status = 'approved'
                   and lr.start_date <= day and day <= lr.end_date) then
        insert into attendance_sessions (company_id, employee_id, day_key, clock_in_at, status)
        values (p_company, emp.id, day,
                day + make_interval(mins => co.start_minute), 'on_leave');
        continue;
      end if;

      r := random();
      if r < 0.06 then continue; end if;

      late    := random() < 0.14;
      in_min  := co.start_minute + (case when late
        then 15 + floor(random() * 60)::int
        else -14 + floor(random() * 20)::int end);
      out_min := co.end_minute + (case when random() < 0.18
        then 20 + floor(random() * 90)::int
        else -10 + floor(random() * 25)::int end);
      clock_in  := day + make_interval(mins => in_min);
      clock_out := day + make_interval(mins => out_min);
      brk     := 45 + floor(random() * 30)::int;
      worked  := greatest(0,
        round(extract(epoch from (clock_out - clock_in)) / 60)::int - brk);
      late_m  := greatest(0, in_min  - (co.start_minute + co.late_grace_minutes));
      early_m := greatest(0, co.end_minute - out_min);
      ot_m    := greatest(0, worked - scheduled);

      insert into attendance_sessions (company_id, employee_id, day_key,
        clock_in_at, clock_out_at, break_minutes, status,
        late_minutes, early_leave_minutes, overtime_minutes, worked_minutes)
      values (p_company, emp.id, day, clock_in, clock_out, brk,
        case when worked < scheduled / 2 then 'half_day'
             when late then 'late' else 'present' end,
        late_m, early_m, ot_m, worked)
      returning id into sess;

      insert into attendance_events (company_id, employee_id, session_id, kind, at, day_key)
      values (p_company, emp.id, sess, 'clock_in',  clock_in,  day),
             (p_company, emp.id, sess, 'clock_out', clock_out, day);
    end loop;
  end loop;

  -- today: staggered arrivals (reset i so it doesn't carry garbage from the 30-day history loop)
  i := 0;
  for emp in select e.id from employees e where e.company_id = p_company and e.active loop
    if exists (select 1 from leave_requests lr
               where lr.employee_id = emp.id and lr.status = 'approved'
                 and lr.start_date <= current_date and current_date <= lr.end_date) then
      insert into attendance_sessions (company_id, employee_id, day_key, clock_in_at, status)
      values (p_company, emp.id, current_date,
              current_date + make_interval(mins => co.start_minute), 'on_leave');
      continue;
    end if;
    i := (i + 1) % 100;
    if i % 7 = 6 then continue; end if;
    late    := random() < 0.14;
    in_min  := co.start_minute + (case when late
      then 12 + floor(random() * 40)::int
      else -18 + floor(random() * 25)::int end);
    clock_in := current_date + make_interval(mins => greatest(0, in_min));
    if clock_in > now() then continue; end if;
    late_m := greatest(0, in_min - (co.start_minute + co.late_grace_minutes));
    cur_status := case when late then 'late' else 'present' end;

    insert into attendance_sessions (company_id, employee_id, day_key,
      clock_in_at, status, late_minutes)
    values (p_company, emp.id, current_date, clock_in, cur_status, late_m)
    returning id into sess;
    insert into attendance_events (company_id, employee_id, session_id, kind, at, day_key)
    values (p_company, emp.id, sess, 'clock_in', clock_in, current_date);

    if random() < 0.5
      and (current_date + make_interval(mins => co.end_minute - 15)) < now() then
      clock_out := current_date + make_interval(mins => co.end_minute - 15);
      worked    := greatest(0,
        round(extract(epoch from (clock_out - clock_in)) / 60)::int - 45);
      update attendance_sessions set
        clock_out_at   = clock_out,
        worked_minutes = worked,
        status = case when worked < scheduled / 2 then 'half_day' else cur_status end
      where id = sess;
      insert into attendance_events (company_id, employee_id, session_id, kind, at, day_key)
      values (p_company, emp.id, sess, 'clock_out', clock_out, current_date);
    end if;
  end loop;

  insert into correction_requests (company_id, employee_id, session_date,
    requested_clock_in_at, reason)
  select p_company, e.id,
    current_date - 3,
    (current_date - 3) + make_interval(mins => co.start_minute - 5),
    'Forgot to scan at the door — badge log confirms 8:55 arrival.'
  from employees e
  where e.company_id = p_company and e.employee_code = 'EMP-005';

  insert into correction_requests (company_id, employee_id, session_date, reason)
  select p_company, e.id, current_date - 5,
    'Attended offsite client meeting, clock-in not possible.'
  from employees e
  where e.company_id = p_company and e.employee_code = 'EMP-008';

  insert into notifications (company_id, audience, type, title, body) values
    (p_company, 'admins', 'leave_pending',  'Leave requests awaiting review',
     'Several leave requests are pending approval.'),
    (p_company, 'admins', 'device_pending', 'Device replacement requested',
     'Mia Novak requested a device replacement.');

  insert into audit_logs (company_id, actor_email, action, detail)
  values (p_company, founder.email, 'demo.seeded', 'Demo dataset generated');
end;
$$;

-- ============================================================
-- EARLY CLOCK-OUT REQUESTS
-- Employees can request to leave before closing hour.
-- HR/admin approves → session is auto clocked-out immediately.
-- ============================================================

create table if not exists early_clockout_requests (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  employee_id  uuid not null references employees(id) on delete cascade,
  session_id   uuid not null references attendance_sessions(id) on delete cascade,
  reason       text not null,
  status       text not null default 'pending'
                 check (status in ('pending','approved','rejected')),
  reviewed_by  text,
  reviewed_at  timestamptz,
  reviewer_note text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_early_clockout_company
  on early_clockout_requests(company_id, status, created_at desc);

alter table early_clockout_requests enable row level security;

drop policy if exists eco_read  on early_clockout_requests;
drop policy if exists eco_write on early_clockout_requests;
-- employees can see their own; admins/hr can see all in company
create policy eco_read on early_clockout_requests for select
  using (
    company_id = my_company_id()
    and (
      employee_id = (my_employee()).id
      or can('approve_corrections')
    )
  );
create policy eco_write on early_clockout_requests for all
  using (company_id = my_company_id())
  with check (company_id = my_company_id());

-- ---- request_early_clockout ----
-- Called by the employee from My Workspace.
-- Only allowed when they have an open session today.
create or replace function public.request_early_clockout(p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me      employees;
  sess    attendance_sessions;
  req_id  uuid;
begin
  select * into me from my_employee();
  if me.id is null then raise exception 'Not authenticated'; end if;
  if btrim(p_reason) = '' then raise exception 'A reason is required'; end if;

  -- must have an open (not yet clocked out) session today
  select * into sess
  from attendance_sessions
  where employee_id = me.id
    and day_key = current_date
    and clock_out_at is null
    and status not in ('on_leave','absent')
  limit 1;

  if sess.id is null then
    raise exception 'You do not have an active clock-in for today.';
  end if;

  -- prevent duplicate pending requests
  if exists (
    select 1 from early_clockout_requests
    where employee_id = me.id
      and session_id  = sess.id
      and status      = 'pending'
  ) then
    raise exception 'You already have a pending early clock-out request for today.';
  end if;

  insert into early_clockout_requests
    (company_id, employee_id, session_id, reason)
  values
    (me.company_id, me.id, sess.id, btrim(p_reason))
  returning id into req_id;

  -- notify HR / admins
  insert into notifications (company_id, audience, type, title, body)
  values (
    me.company_id,
    'admins',
    'early_clockout_pending',
    'Early clock-out requested',
    me.name || ' is requesting to leave early. Reason: ' || btrim(p_reason)
  );

  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'early_clockout.requested', btrim(p_reason));

  return req_id;
end;
$$;

-- ---- decide_early_clockout ----
-- Called by HR/admin. On approval the session is clocked out immediately.
create or replace function public.decide_early_clockout(
  p_request     uuid,
  p_approve     boolean,
  p_note        text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  me        employees;
  req       early_clockout_requests;
  sess      attendance_sessions;
  co        companies;
  now_ts    timestamptz := now();
  worked    int;
  scheduled int;
  early_m   int;
  ot        int;
begin
  select * into me from my_employee();
  if not can('approve_corrections') then raise exception 'Forbidden'; end if;

  select * into req
  from early_clockout_requests
  where id = p_request and company_id = me.company_id;

  if req.id is null then raise exception 'Request not found'; end if;
  if req.status <> 'pending' then raise exception 'Already reviewed'; end if;

  -- mark request
  update early_clockout_requests set
    status        = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by   = me.email,
    reviewed_at   = now_ts,
    reviewer_note = p_note
  where id = p_request;

  if p_approve then
    select * into sess
    from attendance_sessions
    where id = req.session_id;

    if sess.id is null or sess.clock_out_at is not null then
      raise exception 'Session no longer open — employee may have already clocked out.';
    end if;

    select * into co from companies where id = me.company_id;
    scheduled := greatest(1, co.end_minute - co.start_minute);
    worked    := greatest(0,
      round(extract(epoch from (now_ts - sess.clock_in_at)) / 60)::int
      - sess.break_minutes);
    early_m   := greatest(0, co.end_minute -
      (extract(hour   from now_ts at time zone 'utc') * 60
       + extract(minute from now_ts at time zone 'utc')));
    ot        := greatest(0, worked - scheduled);

    update attendance_sessions set
      clock_out_at        = now_ts,
      worked_minutes      = worked,
      early_leave_minutes = early_m,
      overtime_minutes    = ot,
      status = case
        when worked < scheduled / 2 then 'half_day'
        else sess.status
      end
    where id = sess.id;

    insert into attendance_events
      (company_id, employee_id, session_id, kind, at, day_key)
    values
      (me.company_id, sess.employee_id, sess.id, 'clock_out', now_ts, sess.day_key);
  end if;

  -- notify the employee of the decision
  insert into notifications (company_id, for_user_id, audience, type, title, body)
  select
    me.company_id,
    e.user_id,
    'employee',
    case when p_approve then 'early_clockout_approved' else 'early_clockout_rejected' end,
    case when p_approve then 'Early clock-out approved'  else 'Early clock-out rejected' end,
    case when p_approve
      then 'Your early clock-out request was approved. You have been clocked out.'
      else 'Your early clock-out request was rejected.' ||
           coalesce(' Note: ' || p_note, '')
    end
  from employees e where e.id = req.employee_id;

  insert into audit_logs (company_id, actor_email, action, detail)
  values (
    me.company_id, me.email,
    case when p_approve then 'early_clockout.approved' else 'early_clockout.rejected' end,
    req.employee_id::text || ' — ' || coalesce(p_note, req.reason)
  );
end;
$$;
