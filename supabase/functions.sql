-- ============================================================
-- OfficeFlow — part 2: attendance engine + business functions
-- Run after schema.sql in the Supabase SQL editor.
-- ============================================================

-- ==================== company creation / joining ====================

create or replace function public.create_company(
  p_name text, p_industry text default null,
  p_start int default 540, p_end int default 1050,
  p_grace int default 10, p_work_days int[] default '{1,2,3,4,5}'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c_id uuid;
  slug text;
  me employees;
begin
  if p_end <= p_start then raise exception 'End time must be after start time'; end if;

  select * into me from my_employee();
  if me.id is not null then
    raise exception 'You already belong to a company';
  end if;

  slug := lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g'));
  slug := btrim(slug, '-');
  if slug = '' then slug := 'company'; end if;
  if exists (select 1 from companies where companies.slug = slug) then
    slug := slug || '-' || substr(md5(random()::text), 1, 4);
  end if;

  insert into companies (name, slug, industry, start_minute, end_minute,
                         late_grace_minutes, work_days, created_by)
  values (p_name, slug, p_industry, p_start, p_end, p_grace, p_work_days, auth.uid())
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
    (c_id, 'Sick Leave', 10, true),
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
  c_id uuid;
  target employees;
  u_email text;
begin
  u_email := (select email from auth.users where id = auth.uid());
  if u_email is null then raise exception 'Not authenticated'; end if;

  -- code format: "<slug>:<EMP-xxx>" or just "<slug>" when a seat exists for this email
  if position(':' in p_code) > 0 then
    c_id := (select id from companies where slug = split_part(p_code, ':', 1));
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
    if target.id is null then raise exception 'No pending seat for your email — ask HR for the full code'; end if;
    c_id := target.company_id;
  end if;

  update employees set user_id = auth.uid() where id = target.id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (c_id, u_email, 'employee.joined', u_email || ' claimed seat ' || target.employee_code);
  return c_id;
end;
$$;

-- ==================== devices ====================

create or replace function public.register_device(p_label text, p_platform text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me employees := my_employee();
  fp text;
  d_id uuid;
begin
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
declare me employees := my_employee(); d registered_devices;
begin
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
declare me employees := my_employee(); d registered_devices;
begin
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
         case when p_approve then 'Your old device was revoked. You can now register a replacement.'
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
declare me employees := my_employee(); d registered_devices;
begin
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
declare me employees := my_employee();
begin
  if not can('manage_devices') then raise exception 'Forbidden'; end if;
  update registered_devices set status = 'active', revoked_at = null
  where id = p_device and company_id = me.company_id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'device.reactivated', p_device::text);
end;
$$;

-- ==================== QR engine ====================

create or replace function public.issue_qr_token(p_display uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare
  me employees := my_employee();
  disp qr_displays;
  ttl int;
  raw text;
  v json;
begin
  select * into disp from qr_displays where id = p_display;
  if disp.id is null then raise exception 'Display not found'; end if;
  if disp.company_id <> me.company_id then raise exception 'Forbidden'; end if;

  select least(120, greatest(10, qr_rotation_seconds)) into ttl
  from company_settings where company_id = me.company_id;
  if ttl is null then ttl := 30; end if;

  raw := encode(gen_random_bytes(32), 'hex');
  insert into qr_tokens (company_id, display_id, token_hash, nonce, expires_at)
  values (me.company_id, p_display, encode(digest(raw, 'sha256'), 'hex'),
          left(raw, 16), now() + make_interval(secs => ttl));

  select json_build_object('raw', raw, 'expiresAt',
           extract(epoch from (now() + make_interval(secs => ttl))) * 1000,
           'ttlSeconds', ttl)
  into v;
  return v;
end;
$$;

create or replace function public.scan_qr(
  p_raw text, p_device uuid,
  p_lat double precision default null, p_lng double precision default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  me employees := my_employee();
  co companies;
  st company_settings;
  tok qr_tokens;
  disp qr_displays;
  dev registered_devices;
  office branches;
  dist double precision;
  open_sess attendance_sessions;
  arr_min int;
  now_ts timestamptz := now();
  v json;
  late_m int;
  worked int;
  scheduled int;
  early int;
  ot int;
  geo_ok boolean := false;
begin
  if me.id is null then raise exception 'No active employee profile'; end if;
  select * into co from companies where id = me.company_id;
  select * into st from company_settings where company_id = me.company_id;

  -- 1. token lookup (hash of raw) with single-use + expiry guard, row-locked
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
  if disp.company_id <> me.company_id then raise exception 'QR code does not belong to your company.'; end if;

  -- 2. device must be this employee's active device
  select * into dev from registered_devices where id = p_device and employee_id = me.id;
  if dev.id is null then raise exception 'Device is not registered to you.'; end if;
  if dev.status <> 'active' then
    insert into device_events (company_id, device_id, employee_id, type, detail, actor)
    values (me.company_id, dev.id, me.id, 'scan_rejected', 'Scan attempted with non-active device', me.email);
    raise exception 'This device is not active. Contact HR.';
  end if;

  -- 3. optional geofence
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

  -- consume token (single-use)
  update qr_tokens set consumed_at = now_ts, consumed_by = me.id where id = tok.id;

  -- 4. open session?
  select * into open_sess from attendance_sessions
  where employee_id = me.id and day_key = (now_ts at time zone 'utc')::date
  order by clock_in_at desc limit 1;

  if open_sess.id is null or open_sess.clock_out_at is not null then
    if open_sess.id is not null then
      raise exception 'You have already completed attendance for today.';
    end if;
    -- CLOCK IN
    arr_min := extract(hour from now_ts at time zone 'utc') * 60
             + extract(minute from now_ts at time zone 'utc');
    late_m := greatest(0, arr_min - (co.start_minute + co.late_grace_minutes));
    insert into attendance_sessions (company_id, employee_id, day_key, clock_in_at,
      status, late_minutes, clock_in_device_id, clock_in_display_id, geo_verified)
    values (me.company_id, me.id, (now_ts at time zone 'utc')::date, now_ts,
      case when late_m > 0 then 'late' else 'present' end, late_m, dev.id, disp.id, geo_ok)
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

  -- CLOCK OUT
  worked := greatest(0, round(extract(epoch from (now_ts - open_sess.clock_in_at)) / 60)::int
            - open_sess.break_minutes);
  scheduled := greatest(1, co.end_minute - co.start_minute);
  early := greatest(0, co.end_minute - (extract(hour from now_ts at time zone 'utc') * 60
            + extract(minute from now_ts at time zone 'utc')));
  ot := greatest(0, worked - scheduled);

  update attendance_sessions set
    clock_out_at = now_ts, worked_minutes = worked, early_leave_minutes = early,
    overtime_minutes = ot, clock_out_device_id = dev.id,
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

-- auto clock-out sweep: closes stale open sessions
create or replace function public.auto_clockout_sweep() returns int
language plpgsql security definer set search_path = public as $$
declare
  me employees := my_employee();
  co companies;
  st company_settings;
  cutoff timestamptz;
  closed int := 0;
  s record;
begin
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
      clock_out_at = s.clock_in_at + make_interval(hours => coalesce(st.auto_clock_out_hours, 14)),
      worked_minutes = greatest(0, coalesce(st.auto_clock_out_hours, 14) * 60 - s.break_minutes),
      status = 'half_day'
    where id = s.id;
    insert into attendance_events (company_id, employee_id, session_id, kind, at, day_key)
    values (me.company_id, s.employee_id, s.id, 'auto_clock_out',
            s.clock_in_at + make_interval(hours => coalesce(st.auto_clock_out_hours, 14)), s.day_key);
    closed := closed + 1;
  end loop;
  return closed;
end;
$$;

-- ==================== leave ====================

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
  me employees := my_employee();
  lt leave_types;
  bal leave_balances;
  need int;
  y int := extract(year from p_start)::int;
begin
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
  values (me.company_id, me.email, 'leave.requested', me.email || ' ' || p_start || '→' || p_end);
end;
$$;

create or replace function public.decide_leave(p_request uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  me employees := my_employee();
  r leave_requests;
  lt leave_types;
  days int;
begin
  if not can('approve_leave') then raise exception 'Forbidden'; end if;
  select * into r from leave_requests where id = p_request and company_id = me.company_id;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then raise exception 'Already decided'; end if;

  update leave_requests set
    status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = me.email, decided_at = now(), decision_note = p_note
  where id = p_request;

  if p_approve then
    select * into lt from leave_types where id = r.leave_type_id;
    days := work_days_between(r.start_date, r.end_date, me.company_id);
    insert into leave_balances (company_id, employee_id, leave_type_id, year, used_days)
    values (me.company_id, r.employee_id, r.leave_type_id, extract(year from r.start_date)::int, days)
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
declare me employees := my_employee();
begin
  update leave_requests set status = 'cancelled'
  where id = p_request and employee_id = me.id and status = 'pending';
  if not found then raise exception 'Only your own pending requests can be cancelled'; end if;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'leave.cancelled', p_request::text);
end;
$$;

-- ==================== corrections ====================

create or replace function public.request_correction(
  p_date date, p_in timestamptz default null, p_out timestamptz default null, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare me employees := my_employee();
begin
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

create or replace function public.decide_correction(p_request uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  me employees := my_employee();
  r correction_requests;
  co companies;
  s attendance_sessions;
  arr int; late_m int; worked int; scheduled int; early int; ot int;
begin
  if not can('approve_corrections') then raise exception 'Forbidden'; end if;
  select * into r from correction_requests where id = p_request and company_id = me.company_id;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then raise exception 'Already reviewed'; end if;
  select * into co from companies where id = me.company_id;

  update correction_requests set
    status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = me.email, reviewed_at = now(), reviewer_note = p_note
  where id = p_request;

  if p_approve then
    select * into s from attendance_sessions
    where employee_id = r.employee_id and day_key = r.session_date limit 1;
    if s.id is not null then
      arr := extract(hour from coalesce(r.requested_clock_in_at, s.clock_in_at) at time zone 'utc') * 60
           + extract(minute from coalesce(r.requested_clock_in_at, s.clock_in_at) at time zone 'utc');
      late_m := greatest(0, arr - (co.start_minute + co.late_grace_minutes));
      worked := case when coalesce(r.requested_clock_out_at, s.clock_out_at) is null then null
        else greatest(0, round(extract(epoch from
              (coalesce(r.requested_clock_out_at, s.clock_out_at) - coalesce(r.requested_clock_in_at, s.clock_in_at))) / 60)::int
              - s.break_minutes) end;
      scheduled := greatest(1, co.end_minute - co.start_minute);
      early := case when coalesce(r.requested_clock_out_at, s.clock_out_at) is null then 0
        else greatest(0, co.end_minute - (extract(hour from coalesce(r.requested_clock_out_at, s.clock_out_at) at time zone 'utc') * 60
              + extract(minute from coalesce(r.requested_clock_out_at, s.clock_out_at) at time zone 'utc'))) end;
      ot := greatest(0, coalesce(worked, 0) - scheduled);

      update attendance_sessions set
        clock_in_at = coalesce(r.requested_clock_in_at, s.clock_in_at),
        clock_out_at = coalesce(r.requested_clock_out_at, s.clock_out_at),
        worked_minutes = worked, late_minutes = late_m, early_leave_minutes = early,
        overtime_minutes = ot,
        status = case when worked is not null and worked < scheduled / 2 then 'half_day'
                      when late_m > 0 then 'late' else 'present' end
      where id = s.id;
    elsif r.requested_clock_in_at is not null then
      arr := extract(hour from r.requested_clock_in_at at time zone 'utc') * 60
           + extract(minute from r.requested_clock_in_at at time zone 'utc');
      late_m := greatest(0, arr - (co.start_minute + co.late_grace_minutes));
      insert into attendance_sessions (company_id, employee_id, day_key, clock_in_at,
        clock_out_at, status, late_minutes)
      values (me.company_id, r.employee_id, r.session_date, r.requested_clock_in_at,
        r.requested_clock_out_at, case when late_m > 0 then 'late' else 'present' end, late_m);
      insert into attendance_events (company_id, employee_id, session_id, kind, at, day_key)
      values (me.company_id, r.employee_id, (select id from attendance_sessions
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

-- ==================== employees / org ====================

create or replace function public.add_employee(
  p_name text, p_email text, p_code text, p_role text,
  p_position text default null, p_department uuid default null, p_branch uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare me employees := my_employee(); e_id uuid;
begin
  if not can('manage_employees') then raise exception 'Forbidden'; end if;
  if p_role not in ('company_admin','hr_admin','manager','employee') then
    raise exception 'Invalid role';
  end if;
  insert into employees (company_id, email, name, employee_code, role, position, department_id, branch_id)
  values (me.company_id, lower(btrim(p_email)), btrim(p_name), upper(btrim(p_code)), p_role,
          p_position, p_department, p_branch)
  returning id into e_id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'employee.added', p_email || ' (' || p_code || ')');
  return e_id;
end;
$$;

create or replace function public.deactivate_employee(p_employee uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me employees := my_employee();
begin
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
declare me employees := my_employee(); d_id uuid;
begin
  if not can('manage_employees') then raise exception 'Forbidden'; end if;
  insert into departments (company_id, name) values (me.company_id, btrim(p_name))
  returning id into d_id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'department.added', p_name);
  return d_id;
end;
$$;

create or replace function public.add_branch(
  p_name text, p_address text default null,
  p_lat double precision default null, p_lng double precision default null,
  p_radius int default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare me employees := my_employee(); b_id uuid;
begin
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
  p_name text default null, p_industry text default null,
  p_start int default null, p_end int default null, p_grace int default null,
  p_work_days int[] default null, p_qr_rotation int default null,
  p_require_geo boolean default null, p_geo_enabled boolean default null,
  p_auto_out int default null, p_retention int default null
) returns void
language plpgsql security definer set search_path = public as $$
declare me employees := my_employee();
begin
  if not can('manage_settings') then raise exception 'Forbidden'; end if;

  update companies set
    name = coalesce(p_name, name),
    industry = coalesce(p_industry, industry),
    start_minute = coalesce(p_start, start_minute),
    end_minute = coalesce(p_end, end_minute),
    late_grace_minutes = coalesce(p_grace, late_grace_minutes),
    work_days = coalesce(p_work_days, work_days),
    geo_enabled = coalesce(p_geo_enabled, geo_enabled)
  where id = me.company_id;

  update company_settings set
    qr_rotation_seconds = coalesce(p_qr_rotation, qr_rotation_seconds),
    require_geo = coalesce(p_require_geo, require_geo),
    auto_clock_out_hours = coalesce(p_auto_out, auto_clock_out_hours),
    retention_days = coalesce(p_retention, retention_days)
  where company_id = me.company_id;

  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'settings.updated', 'company settings changed');
end;
$$;

create or replace function public.add_holiday(p_date date, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare me employees := my_employee();
begin
  if not can('manage_settings') then raise exception 'Forbidden'; end if;
  insert into public_holidays (company_id, date, name) values (me.company_id, p_date, btrim(p_name));
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'holiday.added', p_date || ' ' || p_name);
end;
$$;

create or replace function public.remove_holiday(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me employees := my_employee();
begin
  if not can('manage_settings') then raise exception 'Forbidden'; end if;
  delete from public_holidays where id = p_id and company_id = me.company_id;
end;
$$;

create or replace function public.add_leave_type(p_name text, p_quota int, p_paid boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me employees := my_employee();
begin
  if not can('manage_settings') then raise exception 'Forbidden'; end if;
  insert into leave_types (company_id, name, annual_quota_days, paid)
  values (me.company_id, btrim(p_name), p_quota, p_paid);
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'leave_type.added', p_name);
end;
$$;

create or replace function public.create_qr_display(p_label text, p_branch uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me employees := my_employee(); d_id uuid;
begin
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
declare me employees := my_employee();
begin
  if not can('manage_qr') then raise exception 'Forbidden'; end if;
  update qr_displays set active = not active where id = p_id and company_id = me.company_id;
end;
$$;

create or replace function public.delete_qr_display(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me employees := my_employee();
begin
  if not can('manage_qr') then raise exception 'Forbidden'; end if;
  delete from qr_displays where id = p_id and company_id = me.company_id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'qr_display.deleted', p_id::text);
end;
$$;

create or replace function public.mark_notifications_read(p_all boolean default true, p_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare me employees := my_employee();
begin
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
