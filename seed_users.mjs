// =====================================================================
// 로그인 계정 7개 생성 스크립트 (전체관리자 · 5개 지사 · 영상팀)
// 실행:  SUPABASE_URL=... SERVICE_ROLE_KEY=... node seed_users.mjs
//   SUPABASE_URL      : 프로젝트 URL
//   SERVICE_ROLE_KEY  : service_role 키 (비공개! Project Settings→API)
//   (선택) DOMAIN     : 이메일 도메인 (기본 example.com)
//   (선택) PASSWORD   : 초기 비밀번호 (기본 solar1234!)
// schema.sql 을 먼저 실행한 뒤 돌리세요.
// =====================================================================
const URL  = process.env.SUPABASE_URL;
const KEY  = process.env.SERVICE_ROLE_KEY;
const DOMAIN   = process.env.DOMAIN   || "example.com";
const PASSWORD = process.env.PASSWORD || "solar1234!";
if (!URL || !KEY) { console.error("❌ SUPABASE_URL, SERVICE_ROLE_KEY 환경변수가 필요합니다."); process.exit(1); }

const H = { "apikey": KEY, "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" };

// id(이메일 앞부분), 역할, 지사id, 표시이름
const ACCOUNTS = [
  { user:"admin",      role:"admin",  branch:null, name:"전체관리자" },
  { user:"hq",         role:"branch", branch:1,    name:"본사(광주)" },
  { user:"jangheung",  role:"branch", branch:2,    name:"장흥지사" },
  { user:"yeongam",    role:"branch", branch:3,    name:"영암지사" },
  { user:"pyeongtaek", role:"branch", branch:4,    name:"평택지사" },
  { user:"paju",       role:"branch", branch:5,    name:"파주지사" },
  { user:"video",      role:"video",  branch:null, name:"영상팀" },
];

async function listUsers() {
  const r = await fetch(`${URL}/auth/v1/admin/users?per_page=200`, { headers:H });
  const j = await r.json();
  return j.users || j || [];
}
async function createUser(email) {
  const r = await fetch(`${URL}/auth/v1/admin/users`, {
    method:"POST", headers:H,
    body: JSON.stringify({ email, password:PASSWORD, email_confirm:true }),
  });
  if (r.ok) return (await r.json()).id;
  const t = await r.text();               // 이미 있으면 목록에서 찾기
  if (/registered|exists|already/i.test(t)) {
    const users = await listUsers();
    const u = users.find(x => x.email === email);
    if (u) return u.id;
  }
  throw new Error(`user 생성 실패(${email}): ${t}`);
}
async function upsertProfile(id, role, branch, name) {
  const r = await fetch(`${URL}/rest/v1/profiles`, {
    method:"POST",
    headers:{ ...H, "Prefer":"resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id, role, branch_id:branch, display_name:name }),
  });
  if (!r.ok) throw new Error(`profile 저장 실패(${name}): ${await r.text()}`);
}

(async () => {
  console.log(`\n▶ 계정 생성 시작 — 도메인 @${DOMAIN}, 초기 비밀번호 "${PASSWORD}"\n`);
  for (const a of ACCOUNTS) {
    const email = `${a.user}@${DOMAIN}`;
    const id = await createUser(email);
    await upsertProfile(id, a.role, a.branch, a.name);
    console.log(`  ✅ ${a.name.padEnd(10)}  ${email}`);
  }
  console.log(`\n완료! 아래 계정으로 로그인하세요. (로그인 후 비밀번호 변경 권장)\n`);
  console.table(ACCOUNTS.map(a => ({ 계정:a.name, 이메일:`${a.user}@${DOMAIN}`, 비밀번호:PASSWORD })));
})().catch(e => { console.error("\n❌", e.message); process.exit(1); });
