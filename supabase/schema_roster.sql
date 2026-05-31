-- ============================================================
-- 스터디코어1.0 학습 리포트 — 학생 명부(연락처·프로필) 지원 마이그레이션
-- 기존 schema.sql 을 먼저 실행한 프로젝트에 "추가로" 실행하세요. (idempotent)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행.
-- ============================================================

-- 1) rpt_students 에 명부 컬럼 추가 -------------------------------------------
--    phones  : 로그인 허용 뒷4자리 목록(학생·보호자). 둘 중 아무거나 일치 시 로그인.
--    profile : 학년·학교·상태·성별·생년월일·등록일·퇴원일·주소·연락처(원장 전용)
alter table public.rpt_students
  add column if not exists phones  jsonb not null default '[]'::jsonb,
  add column if not exists profile jsonb not null default '{}'::jsonb;

-- 둘 중 아무 번호로도 빠르게 조회되도록 phones 에 GIN 인덱스(? 연산자용)
create index if not exists rpt_students_phones_idx on public.rpt_students using gin (phones);

-- 2) 학부모 로그인 RPC 갱신 ---------------------------------------------------
--    - 이름 + (학생 또는 보호자 뒷4자리) 일치 1명만 반환
--    - 학부모에게는 프로필 중 안전한 항목(학년·학교·상태·등록일)만 노출
--      (생년월일·주소·원본 연락처 등 민감정보는 응답에서 제외)
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
    where name = p_name and (phone4 = p_phone4 or phones ? p_phone4)
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
      'profile', jsonb_build_object(
        'grade',      v_student.profile ->> 'grade',
        'school',     v_student.profile ->> 'school',
        'status',     v_student.profile ->> 'status',
        'enrolledAt', v_student.profile ->> 'enrolledAt'
      ),
      'months', coalesce(v_student.data -> 'months', '{}'::jsonb)
    ),
    'months', coalesce(v_meta.months, '[]'::jsonb),
    'openDays', coalesce(v_meta.open_days, '{}'::jsonb),
    'classAverages', coalesce(v_meta.class_averages, '{}'::jsonb),
    'corrections', v_corr
  );
end;
$$;

grant execute on function public.rpt_get_report(text, text) to anon, authenticated;
