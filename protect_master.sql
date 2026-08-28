-- =====================================================================
-- 마스터(개인) 계정 보호·숨김
-- Supabase SQL Editor 에 붙여넣고 Run. (한 번만, 재실행해도 안전)
-- ① protected 컬럼 추가  ② 마스터 계정을 protected=true 로 표시
-- ③ 조회 정책 변경: 보호된 계정은 "본인" 외 다른 관리자에게 안 보이게
-- =====================================================================
alter table public.profiles add column if not exists protected boolean default false;

update public.profiles set protected = true
where id = '5489866c-3c0e-4cc1-932d-939b22b88d09';   -- 마스터(개인) 계정

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated
  using (
    id = auth.uid()                                             -- 본인은 항상 조회
    or (public.my_role() = 'admin' and coalesce(protected, false) = false)  -- 관리자는 '보호 안 된' 계정만
  );

-- 완료. (Success. No rows returned 이 뜨면 정상)
