-- =====================================================================
-- 태양광 영업 상담일지 대시보드 — 데이터베이스 스키마
-- Supabase SQL Editor 에 통째로 붙여넣고 [Run] 하세요. (한 번만 실행)
-- 테이블 + 지사별 접근제어(RLS) + 홍보 성과 집계 뷰를 모두 생성합니다.
-- =====================================================================

-- ---------- 1) 지사(branch) ----------
create table if not exists public.branches (
  id   smallint primary key,
  name text not null unique
);
insert into public.branches(id, name) values
  (1,'본사(광주)'), (2,'장흥'), (3,'영암'), (4,'평택'), (5,'파주')
on conflict (id) do nothing;

-- ---------- 2) 사용자 프로필 (로그인 계정 ↔ 역할/지사) ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  role         text not null check (role in ('admin','branch','video')),
  branch_id    smallint references public.branches(id),
  display_name text
);

-- ---------- 3) 홍보 건 (영상팀이 등록) ----------
create table if not exists public.promotions (
  id          bigint generated always as identity primary key,
  title       text not null,
  channel     text,
  posted_date date,
  status      text not null default '진행중' check (status in ('진행중','종료')),
  created_by  uuid references auth.users(id),
  created_at  timestamptz default now()
);

-- ---------- 4) 상담 기록 ----------
create table if not exists public.consultations (
  id            bigint generated always as identity primary key,
  customer_name text not null,
  phone         text,
  region        text,
  customer_type text,                                   -- 주택/축사/공장/토지/지붕 등
  promotion_id  bigint references public.promotions(id),-- 유입경로(홍보 출처)
  consult_date  date not null default current_date,
  content       text,
  stage         text not null default '신규'
                check (stage in ('신규','상담중','견적','계약','보류','종결')),
  next_date     date,
  branch_id     smallint not null references public.branches(id),
  created_by    uuid references auth.users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists idx_cons_branch    on public.consultations(branch_id);
create index if not exists idx_cons_promotion on public.consultations(promotion_id);
create index if not exists idx_cons_date       on public.consultations(consult_date);

-- updated_at 자동 갱신
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_cons_touch on public.consultations;
create trigger trg_cons_touch before update on public.consultations
  for each row execute function public.touch_updated_at();

-- =====================================================================
-- 로그인 사용자의 역할/지사를 안전하게 읽는 헬퍼 (RLS 재귀 방지: security definer)
-- =====================================================================
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;
create or replace function public.my_branch() returns smallint
language sql stable security definer set search_path = public as $$
  select branch_id from public.profiles where id = auth.uid()
$$;

-- =====================================================================
-- 행 수준 보안 (RLS) — 지사 계정은 "자기 지사"만, 관리자는 전체
-- =====================================================================
alter table public.branches      enable row level security;
alter table public.profiles      enable row level security;
alter table public.promotions    enable row level security;
alter table public.consultations enable row level security;

-- branches: 로그인 사용자 모두 읽기 가능
drop policy if exists branches_read on public.branches;
create policy branches_read on public.branches
  for select to authenticated using (true);

-- profiles: 본인 것만(관리자는 전체) 읽기
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.my_role() = 'admin');

-- promotions: 모두 읽기 / 관리자·영상팀만 등록·수정
drop policy if exists promotions_read  on public.promotions;
drop policy if exists promotions_write on public.promotions;
create policy promotions_read on public.promotions
  for select to authenticated using (true);
create policy promotions_write on public.promotions
  for all to authenticated
  using      (public.my_role() in ('admin','video'))
  with check (public.my_role() in ('admin','video'));

-- consultations: 관리자=전체, 지사=자기 지사만 (영상팀은 원본 접근 없음 → 아래 집계 뷰만)
drop policy if exists cons_select on public.consultations;
drop policy if exists cons_insert on public.consultations;
drop policy if exists cons_update on public.consultations;
drop policy if exists cons_delete on public.consultations;
create policy cons_select on public.consultations
  for select to authenticated using (
    public.my_role() = 'admin'
    or (public.my_role() = 'branch' and branch_id = public.my_branch())
  );
create policy cons_insert on public.consultations
  for insert to authenticated with check (
    public.my_role() = 'admin'
    or (public.my_role() = 'branch' and branch_id = public.my_branch())
  );
create policy cons_update on public.consultations
  for update to authenticated using (
    public.my_role() = 'admin'
    or (public.my_role() = 'branch' and branch_id = public.my_branch())
  ) with check (
    public.my_role() = 'admin'
    or (public.my_role() = 'branch' and branch_id = public.my_branch())
  );
create policy cons_delete on public.consultations
  for delete to authenticated using (
    public.my_role() = 'admin'
    or (public.my_role() = 'branch' and branch_id = public.my_branch())
  );

-- =====================================================================
-- 홍보 성과 집계 뷰 (영상팀 피드백용) — 개인정보 없이 "건수"만 집계
-- security definer 뷰: 원본 상담 접근권이 없어도 집계 결과는 볼 수 있음
-- =====================================================================
create or replace view public.promotion_stats
with (security_invoker = false) as
  select
    p.id            as promotion_id,
    p.title,
    p.channel,
    p.status,
    count(c.id)                                   as inquiry_count,   -- 문의 수
    count(c.id) filter (where c.stage = '계약')    as contract_count,  -- 계약 수
    round(
      (count(c.id) filter (where c.stage = '계약'))::numeric
      / nullif(count(c.id), 0) * 100, 1)          as conversion_rate  -- 전환율(%)
  from public.promotions p
  left join public.consultations c on c.promotion_id = p.id
  group by p.id, p.title, p.channel, p.status;

-- 홍보별 지사 분포 (예: 장흥3·영암1)
create or replace view public.promotion_branch_stats
with (security_invoker = false) as
  select c.promotion_id, b.name as branch_name, count(*) as cnt
  from public.consultations c
  join public.branches b on b.id = c.branch_id
  where c.promotion_id is not null
  group by c.promotion_id, b.name;

grant select on public.promotion_stats        to authenticated;
grant select on public.promotion_branch_stats to authenticated;

-- =====================================================================
-- 실시간(Realtime) 반영 대상 등록 — 지사장이 즉시 확인 (재실행해도 안전)
-- =====================================================================
do $$ begin
  alter publication supabase_realtime add table public.consultations;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.promotions;
exception when duplicate_object then null; end $$;

-- 완료. 다음: seed_users.mjs 로 로그인 계정 7개를 생성하세요.
