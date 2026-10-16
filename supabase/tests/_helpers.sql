-- =============================================================================
-- Helpers de aserción para los tests SQL de la Fase 0
-- =============================================================================
-- NO es un test. Cada test lo incluye con \ir DENTRO de su transacción, así el
-- ROLLBACK final se lleva el esquema `test` y no queda nada en la base.
--
-- Contrato: una aserción que falla lanza una excepción. Con `ON_ERROR_STOP=1`
-- eso corta el archivo y psql sale con código distinto de cero, que es lo que
-- lee el runner (scripts/run-sql-tests.sh).
-- =============================================================================

-- Las aserciones se reportan por NOTICE; el resultado de cada SELECT sobra.
\pset tuples_only on
\pset format unaligned

set client_min_messages = warning;   -- el "does not exist, skipping" sobra
drop schema if exists test cascade;
set client_min_messages = notice;

create schema test;
grant usage on schema test to public;

create table test.contador (n integer not null);
insert into test.contador values (0);

-- El test 04 corre parte de sus aserciones bajo un rol sin privilegios, que
-- también tiene que poder llevar la cuenta.
grant select, update on test.contador to public;

create function test._pass(p_label text) returns void
language plpgsql as $$
begin
  update test.contador set n = n + 1;
  raise notice '  ok   %', p_label;
end;
$$;

-- Afirma que una condición es verdadera.
create function test.ok(p_cond boolean, p_label text) returns void
language plpgsql as $$
begin
  if p_cond is not true then
    raise exception 'FALLO: %', p_label;
  end if;
  perform test._pass(p_label);
end;
$$;

-- Afirma que una sentencia FALLA, y opcionalmente con qué SQLSTATE.
-- El EXECUTE va en su propio bloque: al capturar la excepción, Postgres
-- deshace solo esa subtransacción y el test puede seguir.
create function test.throws(p_sql text, p_sqlstate text, p_label text) returns void
language plpgsql as $$
declare
  v_state text;
  v_msg   text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if p_sqlstate is not null and v_state <> p_sqlstate then
      raise exception 'FALLO: % — esperaba SQLSTATE %, obtuvo % (%)',
        p_label, p_sqlstate, v_state, v_msg;
    end if;
    perform test._pass(p_label || '  [' || v_state || ']');
    return;
  end;
  raise exception 'FALLO: % — se esperaba un error y la sentencia funcionó', p_label;
end;
$$;

-- Afirma que una sentencia FUNCIONA.
create function test.succeeds(p_sql text, p_label text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise exception 'FALLO: % — % (%)', p_label, sqlerrm, sqlstate;
  end;
  perform test._pass(p_label);
end;
$$;

create function test.resumen() returns void
language plpgsql as $$
declare v_n integer;
begin
  select n into v_n from test.contador;
  raise notice '  → % aserciones OK', v_n;
end;
$$;
