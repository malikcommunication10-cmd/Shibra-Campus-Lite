-- Repair a sequence-backed primary key on public.accounts after imported rows
-- have advanced the table beyond its identity/serial sequence.
do $$
declare
    primary_key_column text;
    sequence_name text;
    maximum_id bigint;
begin
    select attribute.attname
      into primary_key_column
      from pg_index index_data
      join pg_class table_data on table_data.oid = index_data.indrelid
      join pg_namespace schema_data on schema_data.oid = table_data.relnamespace
      join pg_attribute attribute
        on attribute.attrelid = table_data.oid
       and attribute.attnum = index_data.indkey[0]
     where schema_data.nspname = 'public'
       and table_data.relname = 'accounts'
       and index_data.indisprimary
     limit 1;

    if primary_key_column is null then
        raise exception 'Could not find a primary key on public.accounts.';
    end if;

    sequence_name := pg_get_serial_sequence('public.accounts', primary_key_column);
    if sequence_name is null then
        raise notice 'The accounts primary key (%) has no backing sequence; no sequence was changed.', primary_key_column;
        return;
    end if;

    execute format('select max(%I)::bigint from public.accounts', primary_key_column)
       into maximum_id;

    if maximum_id is null then
        perform setval(sequence_name, 1, false);
    else
        perform setval(sequence_name, maximum_id, true);
    end if;

    raise notice 'Synchronized accounts primary key sequence (%) after value %.', sequence_name, maximum_id;
end;
$$;
