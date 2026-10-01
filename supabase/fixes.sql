-- ============================================================
-- OfficeFlow fixes  (run AFTER supabase/deploy.sql, safe to re-run)
-- deploy.sql is the single source of truth. schema.sql and
-- functions.sql are older and do not contain the early clock-out
-- feature, so do not use them for a new project.
-- ============================================================

-- 1. company timezone (lateness and early-leave were computed in UTC)
alter table companies add column if not exists timezone text not null default 'Africa/Lagos';

-- 2. qr_tokens.consumed_by blocked deleting employees who had scanned
alter table qr_tokens drop constraint if exists qr_tokens_consumed_by_fkey;
alter table qr_tokens add constraint qr_tokens_consumed_by_fkey
  foreign key (consumed_by) references employees(id) on delete set null;

-- 3. notifications: only admins/approvers see admin notifications,
--    everyone else only sees their own
drop policy if exists notif_read on notifications;
create policy notif_read on notifications for select
  using (company_id = my_company_id() and (
    for_user_id = auth.uid()
    or (audience = 'admins' and (is_admin() or can('approve_leave') or can('approve_corrections') or can('view_reports')))
  ));
drop policy if exists notif_upd on notifications;
create policy notif_upd on notifications for update
  using (company_id = my_company_id() and (
    for_user_id = auth.uid()
    or (audience = 'admins' and (is_admin() or can('approve_leave') or can('approve_corrections') or can('view_reports')))
  ));

create or replace function public.mark_notifications_read(p_all boolean default true, p_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare me employees;
begin
  select * into me from my_employee();
  if me.id is null then return; end if;
  if p_all then
    update notifications set read_at = now()
    where company_id = me.company_id and read_at is null
      and (for_user_id = auth.uid()
           or (audience = 'admins' and (is_admin() or can('approve_leave') or can('approve_corrections') or can('view_reports'))));
  elsif p_id is not null then
    update notifications set read_at = now()
    where id = p_id and company_id = me.company_id
      and (for_user_id = auth.uid()
           or (audience = 'admins' and (is_admin() or can('approve_leave') or can('approve_corrections') or can('view_reports'))));
  end if;
end;
$$;

-- 4. add_employee: clears leftovers from old soft-deleted rows, clear errors
create or replace function public.add_employee(
  p_name text, p_email text, p_code text, p_role text,
  p_position text default null, p_department uuid default null, p_branch uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me employees; e_id uuid;
  v_email text := lower(btrim(p_email));
  v_code  text := upper(btrim(p_code));
begin
  select * into me from my_employee();
  if me.id is null then raise exception 'No active employee profile'; end if;
  if not can('manage_employees') then raise exception 'Forbidden'; end if;
  if p_role not in ('company_admin','hr_admin','manager','employee') then
    raise exception 'Invalid role';
  end if;

  -- remove soft-deleted leftovers that would collide with this email or code
  delete from employees
  where company_id = me.company_id and deleted_at is not null
    and (lower(email) = v_email or upper(employee_code) = v_code);

  if exists (select 1 from employees where company_id = me.company_id and lower(email) = v_email) then
    raise exception 'An employee with email % already exists', v_email;
  end if;
  if exists (select 1 from employees where company_id = me.company_id and upper(employee_code) = v_code) then
    raise exception 'Employee code % is already in use', v_code;
  end if;

  insert into employees (company_id, email, name, employee_code, role, position, department_id, branch_id)
  values (me.company_id, v_email, btrim(p_name), v_code, p_role, p_position, p_department, p_branch)
  returning id into e_id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'employee.added', v_email || ' (' || v_code || ')');
  return e_id;
end;
$$;

-- 5. permanent delete (removes the row and all their data; optional login removal)
create or replace function public.delete_employee(p_employee uuid, p_delete_login boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare me employees; tgt employees;
begin
  select * into me from my_employee();
  if me.id is null then raise exception 'No active employee profile'; end if;
  if not can('manage_employees') then raise exception 'Forbidden'; end if;
  select * into tgt from employees where id = p_employee and company_id = me.company_id;
  if tgt.id is null then raise exception 'Employee not found'; end if;
  if tgt.id = me.id then raise exception 'You cannot delete yourself'; end if;
  if tgt.role = 'company_admin' and not exists (
       select 1 from employees where company_id = me.company_id and role = 'company_admin'
         and active and deleted_at is null and id <> tgt.id) then
    raise exception 'You cannot delete the last company admin';
  end if;

  update qr_tokens set consumed_by = null where consumed_by = tgt.id;
  if tgt.user_id is not null then
    delete from notifications where company_id = me.company_id and for_user_id = tgt.user_id;
  end if;
  delete from employees where id = tgt.id;   -- cascades sessions, events, devices, leave, corrections, early clock-outs

  if p_delete_login and tgt.user_id is not null
     and not exists (select 1 from employees where user_id = tgt.user_id) then
    delete from auth.users where id = tgt.user_id;
  end if;

  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'employee.deleted', tgt.email || ' (' || tgt.employee_code || ')');
end;
$$;

-- 6. delete departments, branches, leave types
create or replace function public.delete_department(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me employees;
begin
  select * into me from my_employee();
  if not can('manage_employees') then raise exception 'Forbidden'; end if;
  delete from departments where id = p_id and company_id = me.company_id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'department.deleted', p_id::text);
end;
$$;

create or replace function public.delete_branch(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me employees;
begin
  select * into me from my_employee();
  if not can('manage_employees') then raise exception 'Forbidden'; end if;
  delete from branches where id = p_id and company_id = me.company_id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'branch.deleted', p_id::text);
end;
$$;

create or replace function public.delete_leave_type(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me employees;
begin
  select * into me from my_employee();
  if not can('manage_settings') then raise exception 'Forbidden'; end if;
  delete from leave_types where id = p_id and company_id = me.company_id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'leave_type.deleted', p_id::text);
end;
$$;

-- 7. QR: token cleanup inside issue_qr_token; scan_qr uses company timezone
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
  if me.id is null then raise exception 'No active employee profile'; end if;
  if not can('manage_qr') then raise exception 'Forbidden'; end if;
  select * into disp from qr_displays where id = p_display;
  if disp.id is null then raise exception 'Display not found'; end if;
  if disp.company_id <> me.company_id then raise exception 'Forbidden'; end if;
  if not disp.active then raise exception 'Display is turned off'; end if;

  select least(120, greatest(10, qr_rotation_seconds)) into ttl
  from company_settings where company_id = me.company_id;
  if ttl is null then ttl := 10; end if;

  -- housekeeping: drop this display's tokens older than 1 hour
  delete from qr_tokens where display_id = p_display and issued_at < now() - interval '1 hour';

  raw := encode(extensions.gen_random_bytes(32), 'hex');
  insert into qr_tokens (company_id, display_id, token_hash, nonce, expires_at)
  values (me.company_id, p_display,
          encode(extensions.digest(raw, 'sha256'), 'hex'),
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
  tz         text;
  now_ts     timestamptz := now();
  late_m     int;
  worked     int;
  scheduled  int;
  early      int;
  ot         int;
  geo_ok     boolean := false;
  used_rows  int;
begin
  select * into me from my_employee();
  if me.id is null then raise exception 'No active employee profile'; end if;
  tz := coalesce((select timezone from companies where id = me.company_id), 'Africa/Lagos');
  select * into co from companies where id = me.company_id;
  select * into st from company_settings where company_id = me.company_id;

  select * into tok from qr_tokens
  where token_hash = encode(extensions.digest(p_raw, 'sha256'), 'hex')
  order by issued_at desc limit 1;
  if tok.id is null then raise exception 'Invalid QR code.'; end if;
  if tok.expires_at < now_ts then
    raise exception 'This QR code has expired. Scan the current code.';
  end if;

  select * into disp from qr_displays where id = tok.display_id;
  if disp.company_id <> me.company_id then
    raise exception 'QR code does not belong to your company.';
  end if;
  if not disp.active then
    raise exception 'This QR display is turned off. Ask HR to turn it on.';
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

  insert into qr_token_uses (token_id, employee_id) values (tok.id, me.id) on conflict do nothing;
  get diagnostics used_rows = row_count;
  if used_rows = 0 then
    raise exception 'You already used this QR code. Wait for the next one.';
  end if;

  select * into open_sess from attendance_sessions
  where employee_id = me.id and day_key = (now_ts at time zone 'utc')::date
  order by clock_in_at desc limit 1;

  if open_sess.id is null or open_sess.clock_out_at is not null then
    if open_sess.id is not null then
      raise exception 'You have already completed attendance for today.';
    end if;
    arr_min := extract(hour   from now_ts at time zone tz) * 60
             + extract(minute from now_ts at time zone tz);
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
    (extract(hour from now_ts at time zone tz) * 60
     + extract(minute from now_ts at time zone tz)));
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

-- 9. BUG FIX: approving or rejecting leave, corrections and device changes, and revoking a
--    device, all crashed with "INSERT has more target columns than expressions"
--    (the notification insert had no `type` value), so nothing could be approved.
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
    case when p_approve then 'leave_approved' else 'leave_rejected' end,
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
    case when p_approve then 'correction_approved' else 'correction_rejected' end,
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
    case when p_approve then 'device_change_approved' else 'device_change_rejected' end,
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
  select me.company_id, e.user_id, 'employee', 'security_alert', 'Device revoked',
         'Your device "' || d.label || '" was revoked by HR.'
  from employees e where e.id = d.employee_id;
  insert into audit_logs (company_id, actor_email, action, detail)
  values (me.company_id, me.email, 'device.revoked', d.label || ' — ' || p_reason);
end;
$$;

-- 8. One-time cleanup of old soft-deleted employees (removes them for good).
--    Uncomment and run once if you want the old deactivated test rows gone:
-- update qr_tokens set consumed_by = null where consumed_by in (select id from employees where deleted_at is not null);
-- delete from employees where deleted_at is not null;
