-- =====================================================================
-- 상담일지 업데이트 — 고객 정보에 '주소', '특이사항' 칸 추가
-- Supabase SQL Editor 에 붙여넣고 [Run] 하세요. (한 번만, 재실행해도 안전)
-- =====================================================================
alter table public.consultations add column if not exists address     text;     -- 주소
alter table public.consultations add column if not exists note        text;     -- 특이사항
alter table public.consultations add column if not exists profit_rate numeric;  -- 실행이익률(%)
alter table public.consultations add column if not exists rep_name    text;     -- 영업담당자
alter table public.consultations add column if not exists revenue      numeric;  -- 예상 매출액(원)
alter table public.consultations add column if not exists install_type text;     -- 설치유형

-- 완료. (Success. No rows returned 이 뜨면 정상)
