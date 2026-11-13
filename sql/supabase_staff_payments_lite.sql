-- Atomic salary payout for Shibra Campus Lite.
-- Run after supabase_roles.sql and supabase_staff_attendance.sql.

begin;

create or replace function public.lite_pay_staff_salary(
    p_payroll_id bigint,
    p_amount numeric,
    p_payment_date date,
    p_payment_mode text,
    p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
    v_payroll public.payroll%rowtype;
    v_paid_before numeric;
    v_history_paid numeric;
    v_new_paid numeric;
    v_voucher text;
    v_attempt integer;
begin
    if not public.app_has_page_permission('staff', 'e') then
        raise exception 'Staff Edit permission is required to record a salary payment.'
            using errcode = '42501';
    end if;
    if p_amount is null or p_amount <= 0 or round(p_amount, 2) <> p_amount then
        raise exception 'Payment amount must be positive and have at most two decimal places.'
            using errcode = '22023';
    end if;
    if p_payment_date is null then
        raise exception 'Choose a payment date.' using errcode = '22023';
    end if;
    if lower(coalesce(p_payment_mode, '')) not in ('cash', 'bank', 'online') then
        raise exception 'Choose Cash, Bank or Online as the payment account.'
            using errcode = '22023';
    end if;
    if not public.app_can_change_day(p_payment_date) then
        raise exception 'This payment date is closed or unavailable for changes.'
            using errcode = '42501';
    end if;

    select * into v_payroll
    from public.payroll
    where id = p_payroll_id
    for update;
    if not found then
        raise exception 'The selected payroll record was not found.' using errcode = 'P0002';
    end if;

    select coalesce(sum(amount), 0) into v_history_paid
    from public.staff_payroll_payments
    where payroll_id = p_payroll_id;
    v_paid_before := greatest(coalesce(v_payroll.paid_amount, 0), v_history_paid);
    if p_amount > greatest(0, coalesce(v_payroll.net_salary, 0) - v_paid_before) then
        raise exception 'Payment exceeds the outstanding salary balance.'
            using errcode = '22023';
    end if;
    v_new_paid := v_paid_before + p_amount;

    for v_attempt in 1..10 loop
        v_voucher := 'PV-' || floor(100000 + random() * 900000)::text;
        exit when not exists (
            select 1 from public.accounts where voucher_id = v_voucher
        ) and not exists (
            select 1 from public.staff_payroll_payments where voucher_no = v_voucher
        );
    end loop;
    if exists (select 1 from public.accounts where voucher_id = v_voucher)
       or exists (select 1 from public.staff_payroll_payments where voucher_no = v_voucher) then
        raise exception 'Could not allocate a unique salary voucher number. Please retry.';
    end if;

    insert into public.accounts (
        voucher_id, from_account, to_account, description,
        amount_in, amount_out, date, remarks
    ) values (
        v_voucher, lower(p_payment_mode), 'Salaries',
        'Salary: ' || coalesce(nullif(btrim(v_payroll.staff_name), ''), v_payroll.staff_id)
            || ' - ' || v_payroll.month,
        0, p_amount, p_payment_date, nullif(btrim(coalesce(p_notes, '')), '')
    );

    insert into public.staff_payroll_payments (
        payroll_id, amount, payment_date, payment_mode, voucher_no, notes
    ) values (
        p_payroll_id, p_amount, p_payment_date, lower(p_payment_mode),
        v_voucher, nullif(btrim(coalesce(p_notes, '')), '')
    );

    update public.payroll
    set paid_amount = v_new_paid,
        status = case when v_new_paid >= coalesce(net_salary, 0) then 'Paid' else 'Unpaid' end,
        paid_date = p_payment_date,
        payment_mode = lower(p_payment_mode),
        voucher_no = v_voucher
    where id = p_payroll_id;

    return jsonb_build_object(
        'payroll_id', p_payroll_id,
        'voucher_no', v_voucher,
        'paid_amount', v_new_paid,
        'status', case when v_new_paid >= coalesce(v_payroll.net_salary, 0) then 'Paid' else 'Unpaid' end
    );
end;
$$;

revoke all on function public.lite_pay_staff_salary(bigint, numeric, date, text, text) from public, anon;
grant execute on function public.lite_pay_staff_salary(bigint, numeric, date, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
