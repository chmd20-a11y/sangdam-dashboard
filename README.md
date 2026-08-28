# 태양광 영업 상담일지 대시보드

전 지사(본사·장흥·영암·평택·파주)가 **같은 상담일지를 공유**하고, 지사장·관리자가 **실시간**으로 확인하며,
**영상팀 홍보 성과**까지 한 화면에서 피드백하는 웹 대시보드입니다.

- 진짜 로그인(계정별) · 지사별 데이터 분리 · 실시간 반영
- 저장소: **Supabase**(무료) / 화면: 정적 웹(어디든 배포 가능)

---

## 📁 파일 구성

| 파일 | 설명 |
|---|---|
| `index.html` `styles.css` `app.js` | 실제 화면(프론트엔드) |
| `config.js` | **Supabase 접속값 입력하는 곳** (URL + anon 키) |
| `schema.sql` | 데이터베이스 설계 — Supabase SQL Editor에 붙여넣고 실행 |
| `seed_users.mjs` | 로그인 계정 7개 자동 생성 스크립트 |

---

## 🚀 설치 순서 (약 10분, 한 번만)

### 1) Supabase 프로젝트 만들기 (무료)
1. https://supabase.com 접속 → 로그인(깃허브/구글/이메일)
2. **New project** → 이름/비밀번호(DB) 정하고 생성 (약 1~2분 대기)
3. 왼쪽 **Project Settings → API** 에서 아래 3개 값 복사
   - **Project URL**
   - **anon public** 키
   - **service_role** 키 (⚠️ 비공개 — 절대 웹/깃허브에 올리지 마세요)

### 2) 데이터베이스 만들기
- 왼쪽 **SQL Editor → New query** → `schema.sql` 내용을 통째로 붙여넣기 → **Run**
- "Success" 나오면 완료.

### 3) 로그인 계정 7개 만들기
터미널에서 이 폴더로 이동한 뒤:
```bash
SUPABASE_URL="여기에 Project URL" \
SERVICE_ROLE_KEY="여기에 service_role 키" \
node seed_users.mjs
```
- 완료되면 아래 7개 계정이 생성됩니다. (초기 비밀번호 `solar1234!` — 로그인 후 변경 권장)

| 역할 | 이메일 | 보이는 범위 |
|---|---|---|
| 전체관리자 | admin@example.com | 전 지사 + 홍보 성과 |
| 본사(광주) | hq@example.com | 본사 상담만 |
| 장흥지사 | jangheung@example.com | 장흥 상담만 |
| 영암지사 | yeongam@example.com | 영암 상담만 |
| 평택지사 | pyeongtaek@example.com | 평택 상담만 |
| 파주지사 | paju@example.com | 파주 상담만 |
| 영상팀 | video@example.com | 홍보 등록·성과 피드백 |

> 이메일 도메인을 바꾸려면 `DOMAIN="회사도메인.com"` 을 명령 앞에 추가하세요.

### 4) 접속값 연결
- `config.js` 를 열어 `SUPABASE_URL` 과 `SUPABASE_ANON_KEY` 두 값을 채웁니다.
  (service_role 키는 여기 넣지 않습니다!)

### 5) 배포
- 이 폴더를 GitHub Pages / Netlify 등 정적 호스팅에 올리면 끝. 링크 하나로 전 지사가 접속합니다.
- (로컬 확인: `python3 -m http.server` 후 브라우저에서 열기)

---

## 🔐 권한 요약
- **지사 계정**은 자기 지사 상담만 보고·씁니다. (데이터베이스 차원 RLS로 강제 — 화면만 가리는 게 아님)
- **전체관리자**만 전 지사 통합 조회.
- **영상팀**은 홍보 등록과 홍보별 성과(문의·계약·전환율)만 봅니다. 고객 개인정보(연락처 등) 원본은 접근 불가.

## 🔄 향후 확장
- 영업 담당자별 개별 계정(현재는 지사 단위) — `profiles`에 담당자 추가로 확장 가능
- 통계 리포트·엑셀 내보내기·후속 관리 알림 등
