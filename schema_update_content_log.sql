-- ============================================================
-- 상담내용 "이력(일지)" 기능용 마이그레이션
-- Supabase 웹사이트 → SQL Editor 에서 실행 (터미널 아님)
-- ============================================================

-- 1) 상담내용 이력을 날짜·시간과 함께 쌓을 컬럼 추가
alter table consultations
  add column if not exists content_log jsonb not null default '[]'::jsonb;

-- 2) 지금까지 써둔 기존 상담내용(content)을
--    '최초 상담일' 날짜의 첫 이력으로 편입 (내용 보존)
update consultations
set content_log = jsonb_build_array(
  jsonb_build_object(
    'at',   to_char(consult_date, 'YYYY-MM-DD') || 'T00:00:00+09:00',
    'body', content
  )
)
where content is not null
  and btrim(content) <> ''
  and content_log = '[]'::jsonb;
