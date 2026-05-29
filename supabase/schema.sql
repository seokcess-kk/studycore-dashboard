-- ============================================================
-- 스터디코어 학습 리포트 — Supabase 스키마
-- 기존 studycore.kr Supabase 프로젝트에 함께 사용 (rpt_ 접두어로 격리)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
-- ============================================================

-- 1) 관리자(원장) 화이트리스트 ------------------------------------------------
--    여기에 등록된 이메일로 Supabase Auth 로그인한 사람만 업로드/보정 가능.
create table if not exists public.rpt_admins (
  email text primary key
);
-- ▼▼▼ 원장님 로그인용 이메일로 바꿔주세요 (Supabase Auth에 같은 이메일로 계정 생성) ▼▼▼
insert into public.rpt_admins (email) values ('admin@studycore.kr')
  on conflict (email) do nothing;

-- 2) 데이터셋 메타 (싱글톤): 월 목록 / 개원일 / 반평균(익명) -------------------
create table if not exists public.rpt_meta (
  id int primary key default 1 check (id = 1),
  months jsonb not null default '[]'::jsonb,
  open_days jsonb not null default '{}'::jsonb,
  class_averages jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 3) 학생별 데이터 ------------------------------------------------------------
create table if not exists public.rpt_students (
  key text primary key,            -- 이름 또는 '이름#좌석'(동명이인)
  name text not null,
  phone4 text not null,            -- 전화번호 뒷 4자리
  seat int,
  data jsonb not null,             -- { months: { 'YYYY-MM': { className, openDays, days{...} } } }
  updated_at timestamptz not null default now()
);
create index if not exists rpt_students_login_idx on public.rpt_students (name, phone4);

-- 4) 보정값 -------------------------------------------------------------------
create table if not exists public.rpt_corrections (
  student_key text not null references public.rpt_students(key) on delete cascade,
  date text not null,              -- 'YYYY-MM-DD'
  payload jsonb not null,          -- { netSec, totalSec, excludedSec, outings, firstIn, lastOut, events[] }
  updated_at timestamptz not null default now(),
  primary key (student_key, date)
);

-- ============================================================
-- RLS (행 단위 보안) — 기본은 전면 차단, 관리자만 직접 접근 허용
-- ============================================================
alter table public.rpt_admins      enable row level security;
alter table public.rpt_meta        enable row level security;
alter table public.rpt_students    enable row level security;
alter table public.rpt_corrections enable row level security;

-- 관리자 판별 헬퍼
create or replace function public.rpt_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rpt_admins a where a.email = (auth.jwt() ->> 'email'));
$$;

-- 관리자(원장)만 읽기/쓰기 (학부모=익명은 정책 없음 → 직접 접근 전면 차단)
do $$ begin
  -- meta
  create policy rpt_meta_admin on public.rpt_meta
    for all to authenticated using (public.rpt_is_admin()) with check (public.rpt_is_admin());
  -- students
  create policy rpt_students_admin on public.rpt_students
    for all to authenticated using (public.rpt_is_admin()) with check (public.rpt_is_admin());
  -- corrections
  create policy rpt_corrections_admin on public.rpt_corrections
    for all to authenticated using (public.rpt_is_admin()) with check (public.rpt_is_admin());
exception when duplicate_object then null; end $$;

-- ============================================================
-- 학부모 로그인 = 이 함수 하나로만 (본인 데이터만 반환, 목록 조회 불가)
-- SECURITY DEFINER 라 RLS를 우회하지만, 이름+전화뒷4 일치 1명만 돌려줌.
-- ============================================================
create or replace function public.rpt_get_report(p_name text, p_phone4 text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_student public.rpt_students;
  v_meta public.rpt_meta;
  v_corr jsonb;
begin
  select * into v_student from public.rpt_students
    where name = p_name and phone4 = p_phone4
    limit 1;
  if not found then
    return null;   -- 불일치 (어느 쪽이 틀렸는지 노출하지 않음)
  end if;

  select * into v_meta from public.rpt_meta where id = 1;

  select coalesce(jsonb_object_agg(c.date, c.payload), '{}'::jsonb) into v_corr
    from public.rpt_corrections c where c.student_key = v_student.key;

  return jsonb_build_object(
    'student', jsonb_build_object(
      'key', v_student.key, 'name', v_student.name,
      'phoneLast4', v_student.phone4, 'seat', v_student.seat,
      'months', coalesce(v_student.data -> 'months', '{}'::jsonb)
    ),
    'months', coalesce(v_meta.months, '[]'::jsonb),
    'openDays', coalesce(v_meta.open_days, '{}'::jsonb),
    'classAverages', coalesce(v_meta.class_averages, '{}'::jsonb),
    'corrections', v_corr
  );
end;
$$;

-- 익명(학부모) + 관리자 모두 이 함수는 호출 가능
grant execute on function public.rpt_get_report(text, text) to anon, authenticated;

-- (선택) 무차별 대입 완화를 위해 PostgREST 노출 최소화: 위 테이블들은 RLS로 막혀 있어
--        anon 키로는 select 불가, rpt_get_report 만 통함.
