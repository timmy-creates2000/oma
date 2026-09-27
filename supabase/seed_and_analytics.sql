-- ============================================================
-- OfficeFlow — part 3: demo seed + analytics RPCs
-- Run after schema.sql + functions.sql in the Supabase SQL editor.
-- ============================================================

-- ==================== demo seed ====================

create or replace function public.seed_demo(p_company uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  co companies;
  founder employees;
  main uuid;
  d_eng uuid; d_des uuid; d_ppl uuid; d_sal uuid;
  type_annual uuid;
  type_sick uuid;
  rec record;
  emp record;
  emp_id uuid;
  dev_id uuid;
  i int;
  names text[] := array['Amara Okafor','Liam Chen','Sofia Reyes','Noah Kimura','Priya Sharma',
    'Mateo Alvarez','Zara Ahmed','Ethan Brooks','Mia Novak','Kenji Sato',
    'Lena Fischer','Omar Haddad','Grace Mwangi','Tomas Novotny','Ivy Laurent',
    'Ravi Patel','Hana Yoshida','Diego Morales','Nora Lindqvist','Sam Osei'];
  positions text[] := array['Engineering Manager','Senior Engineer','Product Designer','People Partner',
    'Data Analyst','Account Executive','Support Lead','QA Engineer'];
  r double precision;
  late boolean;
  in_min int; out_min int;
  clock_in timestamptz; clock_out timestamptz;
  brk int; worked int; scheduled int; late_m int; early_m int; ot_m int;
  day date;
  sess uuid;
  cur_status text;
begin
  select * into co from companies where id = p_company;
  if co.id is null then raise exception 'Company not found'; end if;
  select * into founder from employees where company_id = p_company and role = 'company_admin' limit 1;
  scheduled := greatest(1, co.end_minute - co.start_minute);

  -- branches
  insert into branches (company_id, name, address, latitude, longitude, geofence_radius_m)
  values (p_company, 'HQ — Main Campus', '1 Harbor Way', 37.7749, -122.4194, 150) returning id into main;
  insert into branches (company_id, name, address, latitude, longitude, geofence_radius_m)
  values (p_company, 'Riverside Office', '88 River Rd', 37.785, -122.405, 120);

  -- departments
  insert into departments (company_id, name) values (p_company, 'Engineering') returning id into d_eng;
  insert into departments (company_id, name) values (p_company, 'Design') returning id into d_des;
  insert into departments (company_id, name) values (p_company, 'People Ops') returning id into d_ppl;
  insert into departments (company_id, name) values (p_company, 'Sales') returning id into d_sal;

  -- 20 extra employees (skip device for i=7)
  for i in 1..20 loop
    insert into employees (company_id, email, name, employee_code, role, department_id, branch_id, position, joined_at)
    values (p_company,
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
      values (p_company, dev_id, emp_id, 'registered', 'Device registered during onboarding',
              lower(replace(names[i], ' ', '.')) || '@demo.officeflow.app',
              now() - (i * interval '1 day'));
    end if;
  end loop;

  select id into type_annual from leave_types where company_id = p_company and name = 'Annual Leave';
  select id into type_sick from leave_types where company_id = p_company and name = 'Sick Leave';

  -- balances for everyone incl founder
  for rec in select id from employees where company_id = p_company loop
    insert into leave_balances (company_id, employee_id, leave_type_id, year, used_days)
    values (p_company, rec.id, type_annual, extract(year from now())::int, 0),
           (p_company, rec.id, type_sick, extract(year from now())::int, 0);
  end loop;

  -- holidays
  insert into public_holidays (company_id, date, name) values
    (p_company, current_date - 12, 'Founders Day'),
    (p_company, current_date + 9, 'Wellness Day'),
    (p_company, current_date + 24, 'Summer Festival');

  -- leave requests (k = employee number: 2=EMP-002 etc.)
  insert into leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, reason, status, decided_by, decided_at, created_at)
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

  -- deduct approved balances
  update leave_balances b set used_days = sub.days
  from (
    select lr.employee_id, lr.leave_type_id,
      greatest(1, (select count(*) from generate_series(lr.start_date, lr.end_date, interval '1 day') g(d)
        where extract(dow from g.d)::int = any(co.work_days))) as days
    from leave_requests lr
    where lr.company_id = p_company and lr.status = 'approved'
  ) sub
  where b.employee_id = sub.employee_id and b.leave_type_id = sub.leave_type_id
    and b.year = extract(year from now())::int;

  -- QR displays
  insert into qr_displays (company_id, branch_id, label, active, created_at)
  values (p_company, main, 'Lobby Kiosk — Main', true, now() - interval '30 days'),
         (p_company, main, 'Elevator Bank — Floor 3', true, now() - interval '30 days'),
         (p_company, null, 'Riverside Reception', false, now() - interval '5 days');

  -- 30 days of history
  for day in select generate_series(current_date - 30, current_date - 1, interval '1 day')::date loop
    if not (extract(dow from day)::int = any(co.work_days)) then continue; end if;
    if exists (select 1 from public_holidays where company_id = p_company and date = day) then continue; end if;

    for emp in select e.id from employees e where e.company_id = p_company and e.active loop
      if exists (select 1 from leave_requests lr
                 where lr.employee_id = emp.id and lr.status = 'approved'
                   and lr.start_date <= day and day <= lr.end_date) then
        insert into attendance_sessions (company_id, employee_id, day_key, clock_in_at, status)
        values (p_company, emp.id, day, day + make_interval(mins => co.start_minute), 'on_leave');
        continue;
      end if;

      r := random();
      if r < 0.06 then continue; end if; -- absent

      late := random() < 0.14;
      in_min := co.start_minute + (case when late then 15 + floor(random() * 60)::int else -14 + floor(random() * 20)::int end);
      out_min := co.end_minute + (case when random() < 0.18 then 20 + floor(random() * 90)::int else -10 + floor(random() * 25)::int end);
      clock_in := day + make_interval(mins => in_min);
      clock_out := day + make_interval(mins => out_min);
      brk := 45 + floor(random() * 30)::int;
      worked := greatest(0, round(extract(epoch from (clock_out - clock_in)) / 60)::int - brk);
      late_m := greatest(0, in_min - (co.start_minute + co.late_grace_minutes));
      early_m := greatest(0, co.end_minute - out_min);
      ot_m := greatest(0, worked - scheduled);

      insert into attendance_sessions (company_id, employee_id, day_key, clock_in_at, clock_out_at,
        break_minutes, status, late_minutes, early_leave_minutes, overtime_minutes, worked_minutes)
      values (p_company, emp.id, day, clock_in, clock_out, brk,
        case when worked < scheduled / 2 then 'half_day' when late then 'late' else 'present' end,
        late_m, early_m, ot_m, worked)
      returning id into sess;

      insert into attendance_events (company_id, employee_id, session_id, kind, at, day_key)
      values (p_company, emp.id, sess, 'clock_in', clock_in, day),
             (p_company, emp.id, sess, 'clock_out', clock_out, day);
    end loop;
  end loop;

  -- today: staggered arrivals
  for emp in select e.id from employees e where e.company_id = p_company and e.active loop
    if exists (select 1 from leave_requests lr
               where lr.employee_id = emp.id and lr.status = 'approved'
                 and lr.start_date <= current_date and current_date <= lr.end_date) then
      insert into attendance_sessions (company_id, employee_id, day_key, clock_in_at, status)
      values (p_company, emp.id, current_date, current_date + make_interval(mins => co.start_minute), 'on_leave');
      continue;
    end if;
    i := (i + 1) % 100;
    if i % 7 = 6 then continue; end if; -- a few not arrived / absent today
    late := random() < 0.14;
    in_min := co.start_minute + (case when late then 12 + floor(random() * 40)::int else -18 + floor(random() * 25)::int end);
    clock_in := current_date + make_interval(mins => greatest(0, in_min));
    if clock_in > now() then continue; end if;
    late_m := greatest(0, in_min - (co.start_minute + co.late_grace_minutes));
    cur_status := case when late then 'late' else 'present' end;

    insert into attendance_sessions (company_id, employee_id, day_key, clock_in_at, status, late_minutes)
    values (p_company, emp.id, current_date, clock_in, cur_status, late_m)
    returning id into sess;
    insert into attendance_events (company_id, employee_id, session_id, kind, at, day_key)
    values (p_company, emp.id, sess, 'clock_in', clock_in, current_date);

    -- some already clocked out
    if random() < 0.5 and (current_date + make_interval(mins => co.end_minute - 15)) < now() then
      clock_out := current_date + make_interval(mins => co.end_minute - 15);
      worked := greatest(0, round(extract(epoch from (clock_out - clock_in)) / 60)::int - 45);
      update attendance_sessions set clock_out_at = clock_out, worked_minutes = worked,
        status = case when worked < scheduled / 2 then 'half_day' else cur_status end
      where id = sess;
      insert into attendance_events (company_id, employee_id, session_id, kind, at, day_key)
      values (p_company, emp.id, sess, 'clock_out', clock_out, current_date);
    end if;
  end loop;

  -- correction requests
  insert into correction_requests (company_id, employee_id, session_date, requested_clock_in_at, reason)
  select p_company, e.id, current_date - 3, (current_date - 3) + make_interval(mins => co.start_minute - 5),
    'Forgot to scan at the door — badge log confirms 8:55 arrival.'
  from employees e where e.company_id = p_company and e.employee_code = 'EMP-005';

  insert into correction_requests (company_id, employee_id, session_date, reason)
  select p_company, e.id, current_date - 5,
    'Attended offsite client meeting, clock-in not possible.'
  from employees e where e.company_id = p_company and e.employee_code = 'EMP-008';

  -- notifications
  insert into notifications (company_id, audience, type, title, body) values
    (p_company, 'admins', 'leave_pending', 'Leave requests awaiting review', 'Several leave requests are pending approval.'),
    (p_company, 'admins', 'device_pending', 'Device replacement requested', 'Mia Novak requested a device replacement.');

  insert into audit_logs (company_id, actor_email, action, detail)
  values (p_company, founder.email, 'demo.seeded', 'Demo dataset generated');
end;
$$;

-- ==================== analytics ====================

create or replace function public.dashboard_data()
returns json
language sql stable security definer set search_path = public as $$
  with me as (select * from my_employee()),
  co as (select c.* from companies c join me on c.id = me.company_id),
  emps as (select * from employees where company_id = (select company_id from me) and active and deleted_at is null),
  today as (select * from attendance_sessions
            where company_id = (select company_id from me)
              and day_key = (now() at time zone 'utc')::date and deleted_at is null),
  stats as (
    select
      (select count(*) from emps) as total_employees,
      (select count(*) from today where status = 'present') as present,
      (select count(*) from today where status = 'late') as late,
      (select count(*) from today where status = 'half_day') as half_day,
      (select count(*) from today where status = 'on_leave') as on_leave,
      (select count(*) from today where clock_out_at is null and status not in ('on_leave')) as ongoing,
      greatest(0, (select count(*) from emps)
        - (select count(*) from today where status <> 'on_leave')
        - (select count(*) from today where status = 'on_leave')) as absent,
      (select count(*) from attendance_sessions s
        where s.company_id = (select company_id from me) and s.clock_out_at is null
          and s.status not in ('on_leave') and s.day_key >= current_date - 7 and s.day_key < current_date) as missing_out
  ),
  trend as (
    select to_char(d, 'YYYY-MM-DD') as day,
      (select count(*) from attendance_sessions s
        where s.company_id = (select company_id from me) and s.day_key = d::date
          and s.status in ('present','ongoing')) as present,
      (select count(*) from attendance_sessions s
        where s.company_id = (select company_id from me) and s.day_key = d::date
          and s.status = 'late') as late,
      greatest(0, (select count(*) from emps)
        - (select count(*) from attendance_sessions s
            where s.company_id = (select company_id from me) and s.day_key = d::date
              and s.status <> 'on_leave')
        - (select count(*) from attendance_sessions s
            where s.company_id = (select company_id from me) and s.day_key = d::date
              and s.status = 'on_leave')) as absent
    from generate_series(current_date - 13, current_date, interval '1 day') d
  ),
  dept_rows as (
    select dp.name,
      (select count(*) from emps e where e.department_id = dp.id) as total,
      (select count(*) from today t join emps e on e.id = t.employee_id
        where e.department_id = dp.id and t.status not in ('on_leave','late')) as present,
      (select count(*) from today t join emps e on e.id = t.employee_id
        where e.department_id = dp.id and t.status = 'late') as late,
      greatest(0, (select count(*) from emps e where e.department_id = dp.id)
        - (select count(*) from today t join emps e on e.id = t.employee_id
            where e.department_id = dp.id and t.status <> 'on_leave')) as absent
    from departments dp where dp.company_id = (select company_id from me)
  ),
  recent as (
    select ev.id, ev.kind, ev.at, to_char(ev.day_key, 'YYYY-MM-DD') as day_key,
           coalesce(e.name, 'Unknown') as employee_name
    from attendance_events ev
    left join employees e on e.id = ev.employee_id
    where ev.company_id = (select company_id from me)
    order by ev.at desc limit 12
  )
  select json_build_object(
    'counts', to_jsonb(stats.*),
    'trend', (select json_agg(t order by t.day) from trend t),
    'deptRows', (select json_agg(dr order by dr.name) from dept_rows dr),
    'recentEvents', (select json_agg(r order by r.at desc) from recent r),
    'pendingLeave', (select count(*) from leave_requests
      where company_id = (select company_id from me) and status = 'pending'),
    'pendingCorrections', (select count(*) from correction_requests
      where company_id = (select company_id from me) and status = 'pending'),
    'myRole', (select role from me)
  );
$$;

create or replace function public.analytics_range(p_from date, p_to date,
  p_department uuid default null, p_branch uuid default null, p_employee uuid default null)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  me employees;
  co companies;
  v json;
begin
  select * into me from my_employee();
  if me.id is null then return null; end if;
  select * into co from companies where id = me.company_id;

  with scoped as (
    select * from employees
    where company_id = me.company_id and active and deleted_at is null
      and (p_department is null or department_id = p_department)
      and (p_branch is null or branch_id = p_branch)
      and (p_employee is null or id = p_employee)
  ),
  days as (select generate_series(p_from, p_to, interval '1 day')::date as d),
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
    where s.company_id = me.company_id and s.day_key between p_from and p_to
      and s.deleted_at is null
  ),
  worked as (select * from sess where status <> 'on_leave'),
  closed as (select * from worked where clock_out_at is not null),
  per_emp as (
    select sc.id as employee_id, sc.name, sc.employee_code as code,
      coalesce(dp.name, '—') as department,
      (select count(*) from closed c where c.employee_id = sc.id and c.status = 'present') as present_days,
      (select count(*) from worked w where w.employee_id = sc.id and w.status = 'late') as late_days,
      (select count(*) from worked w where w.employee_id = sc.id and w.status = 'half_day') as half_days,
      greatest(0, (select n from expected) / greatest(1, (select count(*) from scoped))
        - (select count(*) from worked w where w.employee_id = sc.id)) as absent_days,
      (select count(*) from sess s where s.employee_id = sc.id and s.status = 'on_leave') as leave_days,
      round(coalesce((select sum(worked_minutes) from closed c where c.employee_id = sc.id), 0) / 60.0, 1) as worked_hours,
      round(coalesce((select sum(overtime_minutes) from closed c where c.employee_id = sc.id), 0) / 60.0, 1) as overtime_hours,
      coalesce((select sum(late_minutes) from worked w where w.employee_id = sc.id), 0) as late_minutes
    from scoped sc left join departments dp on dp.id = sc.department_id
  ),
  daily as (
    select to_char(d.d, 'YYYY-MM-DD') as day,
      (select count(*) from worked w where w.day_key = d.d and w.status in ('present','late','half_day','ongoing')) as present,
      (select count(*) from worked w where w.day_key = d.d and w.status = 'late') as late,
      greatest(0, (select count(*) from scoped)
        - (select count(*) from worked w where w.day_key = d.d)
        - (select count(*) from sess s where s.day_key = d.d and s.status = 'on_leave')) as absent
    from days d
  ),
  avgs as (
    select
      coalesce((select round(avg(extract(hour from clock_in_at at time zone 'utc') * 60
        + extract(minute from clock_in_at at time zone 'utc'))) from closed), 0) as avg_in_min,
      coalesce((select round(avg(extract(hour from clock_out_at at time zone 'utc') * 60
        + extract(minute from clock_out_at at time zone 'utc'))) from closed), 0) as avg_out_min
  )
  select json_build_object(
    'totals', json_build_object(
      'employeeCount', (select count(*) from scoped),
      'attendanceRate', case when (select n from expected) > 0
        then round((select count(*) from worked) * 100.0 / (select n from expected), 1) else 0 end,
      'punctualityRate', case when (select count(*) from worked) > 0
        then round(((select count(*) from worked) - (select count(*) from worked where status = 'late')) * 100.0
                   / (select count(*) from worked), 1) else 0 end,
      'avgArrival', to_char(make_interval(mins => (select avg_in_min from avgs)::int), 'HH24:MI'),
      'avgDeparture', to_char(make_interval(mins => (select avg_out_min from avgs)::int), 'HH24:MI'),
      'avgWorkedHours', case when (select count(*) from closed) > 0
        then round((select avg(worked_minutes) from closed) / 60.0, 1) else 0 end,
      'totalLateMinutes', coalesce((select sum(late_minutes) from worked), 0),
      'totalOvertimeHours', round(coalesce((select sum(overtime_minutes) from worked), 0) / 60.0, 1),
      'earlyDepartures', (select count(*) from worked where early_leave_minutes > 15),
      'absenceDays', greatest(0, (select n from expected) - (select count(*) from worked) - (select count(*) from sess where status = 'on_leave')),
      'leaveDays', (select count(*) from sess where status = 'on_leave')
    ),
    'perEmployee', (select json_agg(x order by x.name) from per_emp x),
    'daily', (select json_agg(x order by x.day) from daily x)
  )
  into v;

  return v;
end;
$$;
