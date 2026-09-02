/* ============================================================
   태양광 영업 상담일지 대시보드 — 앱 로직
   ============================================================ */
"use strict";

const CFG = window.APP_CONFIG || {};
const CONFIGURED = CFG.SUPABASE_URL && !/YOUR-PROJECT/.test(CFG.SUPABASE_URL)
                   && CFG.SUPABASE_ANON_KEY && !/YOUR-ANON/.test(CFG.SUPABASE_ANON_KEY);

let sb = null;
if (CONFIGURED) sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

// ---- 전역 상태 ----
const S = {
  profile: null,          // {id, role, branch_id, display_name}
  branches: [],           // [{id,name}]
  promotions: [],         // [{id,title,channel,...}]
  page: "dashboard",
  rtChannel: null,
};
const STAGES = ["신규","상담중","견적","계약","보류","종결"];
const STAGE_COLOR = {신규:"#2176ae",상담중:"#e67e22",견적:"#7860c8",계약:"#2e7d32",보류:"#9aa2a4",종결:"#6e7678"};
const CHANNELS = ["유튜브","네이버","인스타","블로그","지역광고","지인소개","기타"];

// 기억하기 쉬운 아이디(지사 이름) → 실제 로그인 이메일 매핑
const LOGIN_DOMAIN = "example.com";
const LOGIN_MAP = {
  "master":"master", "마스터":"master",
  "관리자":"admin", "admin":"admin", "본사":"hq", "본사(광주)":"hq", "광주":"hq", "hq":"hq",
  "장흥":"jangheung", "jangheung":"jangheung",
  "영암":"yeongam", "yeongam":"yeongam",
  "평택":"pyeongtaek", "pyeongtaek":"pyeongtaek",
  "파주":"paju", "paju":"paju",
  "영상팀":"video", "영상":"video", "video":"video",
};
function resolveLoginEmail(raw){
  const v = (raw||"").trim();
  if(v.includes("@")) return v;                 // 이메일 그대로 입력 시
  const key = LOGIN_MAP[v] || LOGIN_MAP[v.toLowerCase()];
  return key ? `${key}@${LOGIN_DOMAIN}` : v;
}

// ---- DOM ----
const $ = (s)=>document.querySelector(s);
const el = (id)=>document.getElementById(id);

// ---- 유틸 ----
function esc(v){ return (v==null?"":String(v)).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function toast(msg){ const t=el("toast"); t.textContent=msg; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),1900); }
function tint(hex){ // 옅은 배경색
  const n=parseInt(hex.slice(1),16), r=n>>16,g=(n>>8)&255,b=n&255;
  const m=v=>Math.round(v+(255-v)*0.82); return `rgb(${m(r)},${m(g)},${m(b)})`;
}
function stagePill(s){ const c=STAGE_COLOR[s]||"#6e7678"; return `<span class="pill" style="background:${tint(c)};color:${c}">${esc(s)}</span>`; }
function ymNow(){ const d=new Date(); return {y:d.getFullYear(), m:d.getMonth()}; }
function isThisMonth(dateStr){ if(!dateStr) return false; const d=new Date(dateStr), n=ymNow(); return d.getFullYear()===n.y && d.getMonth()===n.m; }
function branchName(id){ const b=S.branches.find(x=>x.id===id); return b?b.name:"-"; }
function won(n){ n=Number(n)||0; return n.toLocaleString("ko-KR")+"원"; }
function profitOf(r){ if(r.revenue==null||r.profit_rate==null) return null; return Math.round(Number(r.revenue)*Number(r.profit_rate)/100); }
function roleLabel(){ if(S.profile.protected) return "Master"; if(S.profile.role==="admin") return "전체관리자"; if(S.profile.role==="video") return "영상팀"; return branchName(S.profile.branch_id); }

/* ============================================================
   로그인
   ============================================================ */
function showLoginError(msg){ el("loginErr").textContent = msg||""; }

async function doLogin(e){
  e.preventDefault();
  if(!CONFIGURED){ showLoginError("아직 서버(Supabase) 접속 정보가 설정되지 않았습니다. config.js를 확인하세요."); return; }
  const email=resolveLoginEmail(el("email").value), password=el("password").value;
  const btn=el("loginBtn"); btn.disabled=true; btn.textContent="로그인 중…"; showLoginError("");
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled=false; btn.textContent="로그인";
  if(error){ showLoginError("아이디 또는 비밀번호를 확인하세요."); return; }
  await enterApp();
}

async function enterApp(){
  // 프로필(역할/지사) 로드
  const { data:{ user } } = await sb.auth.getUser();
  const { data:prof, error } = await sb.from("profiles").select("*").eq("id", user.id).single();
  if(error || !prof){ showLoginError("이 계정에 권한 정보가 없습니다. 관리자에게 문의하세요."); await sb.auth.signOut(); return; }
  S.profile = prof;
  const { data:branches } = await sb.from("branches").select("*").order("id");
  S.branches = branches||[];
  el("login").style.display="none";
  el("app").style.display="flex";
  el("who").innerHTML = `<b>${esc(roleLabel())}</b>`;
  renderNav();
  subscribeRealtime();
  go(defaultPage());
}

async function doLogout(){
  if(S.rtChannel){ sb.removeChannel(S.rtChannel); S.rtChannel=null; }
  await sb.auth.signOut();
  location.reload();
}

/* ============================================================
   내비게이션 (역할별)
   ============================================================ */
function menuByRole(){
  const r=S.profile.role;
  if(r==="admin")  return [["dashboard","대시보드"],["consultations","상담 목록"],["promo-stats","홍보 성과"],["promotions","홍보 관리"],["accounts","계정 관리"]];
  if(r==="video")  return [["dashboard","대시보드"],["promo-stats","홍보 성과"],["promotions","홍보 관리"]];
  return [["dashboard","대시보드"],["consultations","상담 목록"]]; // branch
}
function defaultPage(){ return "dashboard"; }
function renderNav(){
  el("sidebar").innerHTML = menuByRole().map(([key,label])=>
    `<button class="nav-item ${key===S.page?"active":""}" data-page="${key}"><span class="ic"></span>${label}</button>`
  ).join("")
    + `<a class="manual-side" href="manual.html" target="_blank">📖 사용 안내</a>`
    + `<a class="manual-side" href="install.html" target="_blank">📱 홈 화면에 추가</a>`
    + `<a class="manual-side" id="navPwChange">🔑 비밀번호 변경</a>`;
  el("sidebar").querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>{ go(b.dataset.page); closeNav(); });
  const pw=el("navPwChange"); if(pw) pw.onclick=()=>{ closeNav(); openPasswordChange(); };
}
function openPasswordChange(){
  openModal("비밀번호 변경", `
    <p style="color:var(--gray);font-size:13.5px;margin:0 0 14px">현재 로그인된 계정(<b>${esc(roleLabel())}</b>)의 비밀번호를 바꿉니다.</p>
    <div class="form-grid">
      <div class="full"><label class="req">새 비밀번호</label><input id="pw1" type="password" class="input" placeholder="6자 이상"></div>
      <div class="full"><label class="req">새 비밀번호 확인</label><input id="pw2" type="password" class="input" placeholder="다시 입력"></div>
    </div>`,
    async ()=>{
      const p1=el("pw1").value, p2=el("pw2").value;
      if((p1||"").length<6){ toast("비밀번호는 6자 이상이어야 합니다"); return false; }
      if(p1!==p2){ toast("두 비밀번호가 서로 다릅니다"); return false; }
      const { error }=await sb.auth.updateUser({ password:p1 });
      if(error){ toast("변경 실패: "+error.message); return false; }
      toast("✅ 비밀번호가 변경되었습니다"); return true;
    });
}
function toggleNav(){ const open=el("sidebar").classList.toggle("open"); el("navBackdrop").classList.toggle("show",open); }
function closeNav(){ el("sidebar").classList.remove("open"); el("navBackdrop").classList.remove("show"); }
function go(page){ S.page=page; renderNav(); render(); }

/* ============================================================
   데이터 로더
   ============================================================ */
async function loadConsultations(){
  const { data, error } = await sb.from("consultations")
    .select("*, promotions(title,channel)")
    .order("consult_date",{ascending:false}).order("created_at",{ascending:false});
  if(error){ console.error(error); return []; }
  return data||[];
}
async function loadPromotions(){
  const { data } = await sb.from("promotions").select("*").order("id",{ascending:false});
  S.promotions = data||[]; return S.promotions;
}
async function loadPromoStats(){
  const { data } = await sb.from("promotion_stats").select("*").order("inquiry_count",{ascending:false});
  return data||[];
}
async function loadPromoBranchStats(){
  const { data } = await sb.from("promotion_branch_stats").select("*");
  const map={}; (data||[]).forEach(r=>{ (map[r.promotion_id]=map[r.promotion_id]||[]).push(`${r.branch_name}${r.cnt}`); });
  return map;
}

/* ============================================================
   렌더 라우터
   ============================================================ */
async function render(){
  const m=el("main");
  if(S.page==="dashboard")      return renderDashboard(m);
  if(S.page==="consultations")  return renderConsultations(m);
  if(S.page==="promotions")     return renderPromotions(m);
  if(S.page==="promo-stats")    return renderPromoStats(m);
  if(S.page==="accounts")       return renderAccounts(m);
}

/* ---------- 대시보드 ---------- */
async function renderDashboard(m){
  m.innerHTML = `<div class="page-head"><h1>대시보드</h1></div><div id="dashBody" class="empty">불러오는 중…</div>`;
  if(S.profile.role==="video") return renderVideoDashboard();

  const rows = await loadConsultations();
  await loadPromotions();
  const monthCount = rows.filter(r=>isThisMonth(r.consult_date)).length;
  const cnt = (f)=>rows.filter(f).length;
  const 신규=cnt(r=>r.stage==="신규"), 진행중=cnt(r=>["상담중","견적"].includes(r.stage)), 계약=cnt(r=>r.stage==="계약");
  const total=rows.length, rate= total? (계약/total*100).toFixed(1):"0.0";

  // 진행단계 분포
  const stageDist = STAGES.map(s=>[s, cnt(r=>r.stage===s)]);
  const stageMax = Math.max(1,...stageDist.map(x=>x[1]));
  // 지사별 (관리자만)
  const isAdmin=S.profile.role==="admin";
  const byBranch = S.branches.map(b=>[b.name, rows.filter(r=>r.branch_id===b.id).length]);
  const brMax=Math.max(1,...byBranch.map(x=>x[1]));

  const kpis=`<div class="kpis">
    ${kpi("이번 달 상담",monthCount,"전체 "+total+"건","")}
    ${kpi("신규 고객",신규,"신규 단계","")}
    ${kpi("진행 중",진행중,"상담·견적 단계","g")}
    ${kpi("계약 완료",계약,"전환율 "+rate+"%","o")}
  </div>`;

  const panelBranch = isAdmin ? `<div class="panel"><h3>지사별 상담 현황</h3><p class="desc">전 지사 누적 상담 건수</p>
      ${byBranch.map(([n,v])=>barRow(n,v,brMax,"#2e7d32")).join("")}</div>` : "";
  const panelStage = `<div class="panel"><h3>진행 단계 분포</h3><p class="desc">현재 단계별 상담 수</p>
      ${stageDist.map(([n,v])=>barRow(n,v,stageMax,STAGE_COLOR[n])).join("")}</div>`;
  const instTypes=["햇빛소득마을","영농형","일반부지","축사 및 건물","기타"];
  const instDist=instTypes.map(t=>[t, rows.filter(r=>r.install_type===t).length]);
  const instMax=Math.max(1,...instDist.map(x=>x[1]));
  const panelInstall = `<div class="panel wide-labels${isAdmin?' span2':''}"><h3>설치유형 분포</h3><p class="desc">설치유형별 상담 수</p>
      ${instDist.map(([n,v])=>barRow(n,v,instMax,"#7860c8")).join("")}</div>`;
  const panels = `<div class="panels">${isAdmin? panelBranch+panelStage+panelInstall : panelStage+panelInstall+recentMini(rows)}</div>`;

  const recent = recentTable(rows.slice(0,8));
  let promoBlock="";
  if(isAdmin){
    const stats=await loadPromoStats(); const dist=await loadPromoBranchStats();
    promoBlock = promoStatsTable(stats,dist,true);
  }
  const revBlock = sectionTitle("지사별 예상 매출·실행이익",
    "지사별 · 상담 기재 금액 기준 (실행이익 = 예상매출 × 실행이익률)")
    + branchRevenueSection(rows);
  const repPerf = sectionTitle("영업자별 실적","영업담당자별 상담·계약 현황") + repPerformanceTable(rows);
  el("dashBody").outerHTML = `<div id="dashBody">${kpis}${panels}${revBlock}${repPerf}${isAdmin?sectionTitle("최근 상담","최근 입력된 상담 이력")+recent:""}${promoBlock}</div>`;
  drawRevChart();
  wireRecentActions();
}

function recentMini(rows){
  const r=rows.slice(0,6);
  const body = r.length? r.map(x=>`<div class="bar-row" style="grid-template-columns:1fr auto;">
      <div class="name">${esc(x.customer_name)} <span style="color:var(--lgray);font-weight:400">· ${esc(x.region||"")}</span></div>
      <div>${stagePill(x.stage)}</div></div>`).join("")
    : `<div class="empty">상담 기록이 없습니다.</div>`;
  return `<div class="panel"><h3>최근 상담</h3><p class="desc">최근 입력된 상담</p>${body}</div>`;
}

async function renderVideoDashboard(){
  await loadPromotions();
  const stats=await loadPromoStats(); const dist=await loadPromoBranchStats();
  const totalInq=stats.reduce((a,b)=>a+Number(b.inquiry_count||0),0);
  const totalCon=stats.reduce((a,b)=>a+Number(b.contract_count||0),0);
  const rate= totalInq? (totalCon/totalInq*100).toFixed(1):"0.0";
  const kpis=`<div class="kpis">
    ${kpi("등록 홍보",S.promotions.length,"진행중 "+S.promotions.filter(p=>p.status==="진행중").length+"건","")}
    ${kpi("총 문의",totalInq,"홍보 유입 상담","")}
    ${kpi("총 계약",totalCon,"홍보 → 계약","g")}
    ${kpi("평균 전환율",rate+"%","문의 대비 계약","o")}
  </div>`;
  el("dashBody").outerHTML = `<div id="dashBody">${kpis}${promoStatsTable(stats,dist,true)}</div>`;
}

/* ---------- 상담 목록 ---------- */
let CONS_CACHE=[];
async function renderConsultations(m){
  const canPickBranch = S.profile.role==="admin";
  m.innerHTML = `<div class="page-head"><h1>상담 목록</h1>
    <div class="tools">
      <input id="q" class="chip" placeholder="고객명·연락처·지역·담당자 검색" style="min-width:200px">
      <select id="fRep" class="chip"><option value="">전체 담당자</option></select>
      <select id="fStage" class="chip"><option value="">전체 단계</option>${STAGES.map(s=>`<option>${s}</option>`).join("")}</select>
      <button class="btn" id="backupCsv">⬇ 엑셀 백업</button>
      <button class="btn green" id="addCons">+ 새 상담</button>
    </div></div>
    <div class="list-hint">💡 고객(행)을 클릭하면 <b>상세 내용</b>을 볼 수 있어요. 수정은 상세 화면 아래 [수정]에서.</div>
    <div id="consBody" class="empty">불러오는 중…</div>`;
  await loadPromotions();
  CONS_CACHE = await loadConsultations();
  const reps=[...new Set(CONS_CACHE.map(r=>r.rep_name).filter(Boolean))].sort();
  el("fRep").innerHTML = `<option value="">전체 담당자</option>` + reps.map(n=>`<option>${esc(n)}</option>`).join("");
  el("addCons").onclick=()=>openConsultForm(null);
  el("backupCsv").onclick=exportConsultationsCSV;
  el("q").oninput=drawConsTable; el("fStage").onchange=drawConsTable; el("fRep").onchange=drawConsTable;
  drawConsTable();
}
function drawConsTable(){
  const q=(el("q").value||"").trim().toLowerCase(), fs=el("fStage").value, fr=el("fRep").value;
  let rows=CONS_CACHE.filter(r=>{
    if(fs && r.stage!==fs) return false;
    if(fr && (r.rep_name||"")!==fr) return false;
    if(q){ const s=`${r.customer_name} ${r.phone||""} ${r.region||""} ${r.rep_name||""}`.toLowerCase(); if(!s.includes(q)) return false; }
    return true;
  });
  const isAdmin=S.profile.role==="admin";
  const head=`<thead><tr><th>고객명</th><th>영업담당자</th><th>연락처</th><th>지역</th><th>주소</th><th>상담내용</th><th>유입경로(홍보)</th><th>진행단계</th><th>예상매출</th><th>실행이익률</th>${isAdmin?"<th>지사</th>":""}<th>상담일</th><th>다음예정</th><th></th></tr></thead>`;
  const body = rows.length? rows.map(r=>`<tr data-detail="${r.id}" title="클릭하면 상세보기">
      <td class="cust" data-label="고객명">${esc(r.customer_name)}</td>
      <td data-label="영업담당자">${esc(r.rep_name||"-")}</td>
      <td data-label="연락처">${esc(r.phone||"-")}</td>
      <td data-label="지역">${esc(r.region||"-")}</td>
      <td data-label="주소">${esc(r.address||"-")}</td>
      <td class="consum" data-label="상담내용"><div class="clamp2" title="${esc(r.content||"")}">${r.content? esc(r.content) : "-"}</div></td>
      <td data-label="유입경로">${esc(r.promotions? r.promotions.title : "-")}</td>
      <td data-label="진행단계">${stagePill(r.stage)}</td>
      <td data-label="예상매출">${r.revenue!=null? esc(won(r.revenue)) : "-"}</td>
      <td data-label="실행이익률">${r.profit_rate!=null? esc(r.profit_rate)+"%" : "-"}</td>
      ${isAdmin?`<td data-label="지사"><span class="badge">${esc(branchName(r.branch_id))}</span></td>`:""}
      <td data-label="상담일">${esc(r.consult_date||"")}</td>
      <td data-label="다음예정">${esc(r.next_date||"-")}</td>
      <td class="row-actions" style="white-space:nowrap">
        <button class="del" data-del="${r.id}">삭제</button></td>
    </tr>`).join("") : `<tr><td colspan="15" class="empty">표시할 상담이 없습니다. [+ 새 상담]으로 기록을 추가하세요.</td></tr>`;
  el("consBody").innerHTML = `<div class="card-table mobilecards"><table>${head}<tbody>${body}</tbody></table></div>`;
  el("consBody").querySelectorAll("tbody tr[data-detail]").forEach(tr=>{
    tr.style.cursor="pointer";
    tr.addEventListener("click",()=>{ const row=CONS_CACHE.find(x=>String(x.id)===tr.dataset.detail); if(row) openConsultDetail(row); });
  });
  el("consBody").querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",(e)=>{ e.stopPropagation(); delConsult(b.dataset.del); }));
}

function openConsultForm(row){
  const isNew=!row; const isAdmin=S.profile.role==="admin";
  const promoOpts = `<option value="">— 선택 안 함 —</option>` +
    S.promotions.map(p=>`<option value="${p.id}" ${row&&row.promotion_id===p.id?"selected":""}>${esc(p.title)}</option>`).join("");
  const branchOpts = S.branches.map(b=>`<option value="${b.id}" ${ (row?row.branch_id:S.profile.branch_id)===b.id?"selected":""}>${esc(b.name)}</option>`).join("");
  const typeOpts = ["","주택","축사","공장","토지","지붕","햇빛소득마을","영농형태양광","마을태양광","기타"].map(t=>`<option ${row&&row.customer_type===t?"selected":""}>${t}</option>`).join("");
  const installOpts = ["","햇빛소득마을","영농형","일반부지","축사 및 건물","기타"].map(t=>`<option ${row&&row.install_type===t?"selected":""}>${t}</option>`).join("");
  const repNames = [...new Set((CONS_CACHE||[]).map(r=>r.rep_name).filter(Boolean))].sort();
  const repList = `<datalist id="repList">${repNames.map(n=>`<option value="${esc(n)}"></option>`).join("")}</datalist>`;
  openModal(`${isNew?"새 상담 기록":"상담 수정"}`, `${repList}
    <div class="form-grid">
      <div><label class="req">고객명</label><input id="f_name" class="input" value="${row?esc(row.customer_name):""}"></div>
      <div><label>영업담당자</label><input id="f_rep" class="input" list="repList" value="${row?esc(row.rep_name||""):""}" placeholder="담당 영업자 이름"></div>
      <div><label>연락처</label><input id="f_phone" class="input" value="${row?esc(row.phone||""):""}" placeholder="010-0000-0000"></div>
      <div><label>지역</label><input id="f_region" class="input" value="${row?esc(row.region||""):""}" placeholder="전남 장흥군"></div>
      <div><label>고객 유형</label><select id="f_type" class="input">${typeOpts}</select></div>
      <div><label>설치유형</label><select id="f_install" class="input">${installOpts}</select></div>
      <div class="full"><label>주소</label><input id="f_addr" class="input" value="${row?esc(row.address||""):""}" placeholder="상세 주소 (예: 전남 장흥군 ○○면 ○○리 123-4)"></div>
      <div class="full"><label>유입경로 (어떤 홍보를 보고 왔는지)</label><select id="f_promo" class="input">${promoOpts}</select></div>
      <div><label class="req">상담일</label><input id="f_date" type="date" class="input" value="${row?esc(row.consult_date):new Date().toISOString().slice(0,10)}"></div>
      <div><label class="req">진행 단계</label><select id="f_stage" class="input">${STAGES.map(s=>`<option ${ (row?row.stage:"신규")===s?"selected":""}>${s}</option>`).join("")}</select></div>
      <div class="full"><label>상담 내용</label><textarea id="f_content" class="input" placeholder="상담한 내용을 짧게 메모">${row?esc(row.content||""):""}</textarea></div>
      <div class="full"><label>특이사항</label><textarea id="f_note" class="input" placeholder="특이사항·요청사항·주의점 등">${row?esc(row.note||""):""}</textarea></div>
      <div><label>예상 매출액 (원)</label><input id="f_revenue" type="text" inputmode="numeric" class="input" value="${row&&row.revenue!=null? Number(row.revenue).toLocaleString("ko-KR") : ""}" placeholder="예: 30,000,000"></div>
      <div><label>실행이익률 (%)</label><input id="f_profit" type="number" step="0.1" min="0" class="input" value="${row&&row.profit_rate!=null?esc(row.profit_rate):""}" placeholder="예: 12.5"></div>
      <div><label>다음 예정일</label><input id="f_next" type="date" class="input" value="${row&&row.next_date?esc(row.next_date):""}"></div>
      ${isAdmin?`<div><label>담당 지사</label><select id="f_branch" class="input">${branchOpts}</select></div>`:""}
    </div>`,
    async ()=>{
      const name=el("f_name").value.trim();
      if(!name){ toast("고객명을 입력하세요"); return false; }
      const payload={
        customer_name:name, phone:val("f_phone"), region:val("f_region"),
        address:val("f_addr")||null, note:val("f_note")||null, rep_name:val("f_rep")||null,
        revenue: numFromComma("f_revenue"),
        profit_rate: el("f_profit").value!==""? Number(el("f_profit").value):null,
        customer_type:val("f_type")||null, install_type:val("f_install")||null, promotion_id: el("f_promo").value? Number(el("f_promo").value):null,
        consult_date:el("f_date").value, content:val("f_content"), stage:el("f_stage").value,
        next_date: el("f_next").value||null,
        branch_id: isAdmin? Number(el("f_branch").value) : S.profile.branch_id,
      };
      let res;
      if(isNew){ payload.created_by=S.profile.id; res=await sb.from("consultations").insert(payload); }
      else res=await sb.from("consultations").update(payload).eq("id",row.id);
      if(res.error){ toast("저장 실패: "+res.error.message); return false; }
      toast(isNew?"상담이 등록되었습니다":"수정되었습니다");
      CONS_CACHE=await loadConsultations(); drawConsTable(); return true;
    });
  commaInput("f_revenue");
}
// ---------- 상담 상세보기 (읽기 전용 → 수정/삭제/닫기) ----------
function openConsultDetail(row){
  const root=el("modalRoot");
  const P=(row.promotions&&row.promotions.title)?row.promotions.title:"";
  const items=[
    ["영업담당자", row.rep_name],
    ["연락처", row.phone],
    ["지역", row.region],
    ["주소", row.address],
    ["고객 유형", row.customer_type],
    ["설치유형", row.install_type],
    ["유입경로(홍보)", P],
    ["예상 매출액", row.revenue!=null? won(row.revenue):""],
    ["실행이익률", row.profit_rate!=null? row.profit_rate+"%" : ""],
    ["실행이익", profitOf(row)!=null? won(profitOf(row)):""],
    ["담당 지사", branchName(row.branch_id)],
    ["상담일", row.consult_date],
    ["다음 예정일", row.next_date],
  ];
  const stageRow=`<div class="detail-row"><div class="dl">진행 단계</div><div class="dv">${stagePill(row.stage)}</div></div>`;
  const grid=items.map(([l,v])=>`<div class="detail-row"><div class="dl">${esc(l)}</div><div class="dv">${v?esc(v):'<span class="dv-empty">-</span>'}</div></div>`).join("");
  const blocks=[["상담 내용",row.content],["특이사항",row.note]].map(([l,v])=>
    `<div class="detail-block"><div class="dl">${esc(l)}</div><div class="dv-long">${v?esc(v):'<span class="dv-empty">- 없음 -</span>'}</div></div>`).join("");
  const created=(row.created_at||"").replace("T"," ").slice(0,16);
  root.innerHTML=`<div class="modal-back"><div class="modal detail-modal">
    <h2>${esc(row.customer_name)} <span class="detail-sub">· 상담 상세</span></h2>
    <div class="detail-grid">${stageRow}${grid}</div>
    ${blocks}
    <div class="detail-created">등록일시 ${esc(created)}</div>
    <div class="modal-actions">
      <button class="btn red-out" id="dDel">삭제</button>
      <span style="flex:1"></span>
      <button class="btn" id="dClose">닫기</button>
      <button class="btn green" id="dEdit">수정</button>
    </div>
  </div></div>`;
  const close=()=>root.innerHTML="";
  el("dClose").onclick=close;
  root.querySelector(".modal-back").onclick=(e)=>{ if(e.target.classList.contains("modal-back")) close(); };
  el("dEdit").onclick=()=>{ close(); openConsultForm(row); };
  el("dDel").onclick=async()=>{ close(); await delConsult(row.id); };
}

async function delConsult(id){
  const r=CONS_CACHE.find(x=>String(x.id)===String(id));
  const name=r? r.customer_name : "";
  const msg=`⚠️ 정말 삭제하시겠어요?\n\n"${name}" 고객의 상담 기록이 완전히 삭제되며, 되돌릴 수 없습니다.\n다시 한 번 확인하세요.\n\n삭제하려면 [확인]을 누르세요.`;
  if(!confirm(msg)) return;
  const { error }=await sb.from("consultations").delete().eq("id",id);
  if(error){ toast("삭제 실패"); return; }
  toast("삭제되었습니다"); CONS_CACHE=await loadConsultations(); drawConsTable();
}

// ---------- 오프라인 백업 (엑셀에서 열리는 CSV 다운로드) ----------
function exportConsultationsCSV(){
  const rows = CONS_CACHE || [];
  if(!rows.length){ toast("백업할 상담이 없습니다"); return; }
  const cols = [
    ["상담일", r=>r.consult_date], ["고객명", r=>r.customer_name], ["영업담당자", r=>r.rep_name], ["연락처", r=>r.phone],
    ["지역", r=>r.region], ["주소", r=>r.address], ["고객유형", r=>r.customer_type], ["설치유형", r=>r.install_type],
    ["유입경로(홍보)", r=> r.promotions? r.promotions.title : ""],
    ["진행단계", r=>r.stage], ["예상매출액(원)", r=>r.revenue], ["실행이익률(%)", r=>r.profit_rate],
    ["실행이익(원)", r=>profitOf(r)], ["다음예정일", r=>r.next_date],
    ["담당지사", r=> branchName(r.branch_id)],
    ["상담내용", r=>r.content], ["특이사항", r=>r.note],
    ["등록일시", r=> (r.created_at||"").replace("T"," ").slice(0,16)],
  ];
  const cell = v => `"${String(v==null?"":v).replace(/"/g,'""')}"`;
  const csv = "﻿" + [                                   // BOM → 엑셀에서 한글 안 깨짐
    cols.map(c=>cell(c[0])).join(","),
    ...rows.map(r=>cols.map(c=>cell(c[1](r))).join(",")),
  ].join("\r\n");
  const d=new Date(), pad=n=>String(n).padStart(2,"0");
  const fname=`상담일지_백업_${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}.csv`;
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=fname;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  toast(`${rows.length}건 백업 파일을 내려받았습니다`);
}

/* ---------- 홍보 관리 ---------- */
async function renderPromotions(m){
  m.innerHTML=`<div class="page-head"><h1>홍보 관리</h1>
    <div class="tools"><button class="btn green" id="addPromo">+ 새 홍보 등록</button></div></div>
    <div id="promoBody" class="empty">불러오는 중…</div>`;
  await loadPromotions();
  el("addPromo").onclick=()=>openPromoForm(null);
  drawPromoTable();
}
function drawPromoTable(){
  const rows=S.promotions;
  const body=rows.length? rows.map(p=>`<tr>
      <td class="cust" data-label="홍보 제목">${esc(p.title)}</td>
      <td data-label="채널">${esc(p.channel||"-")}</td>
      <td data-label="게시일">${esc(p.posted_date||"-")}</td>
      <td data-label="상태"><span class="pill" style="background:${p.status==="진행중"?tint("#2e7d32"):"#eee"};color:${p.status==="진행중"?"#2e7d32":"#888"}">${esc(p.status)}</span></td>
      <td class="row-actions"><button data-edit="${p.id}">수정</button></td>
    </tr>`).join("") : `<tr><td colspan="5" class="empty">등록된 홍보가 없습니다. [+ 새 홍보 등록]으로 추가하세요.</td></tr>`;
  el("promoBody").innerHTML=`<div class="card-table mobilecards"><table>
    <thead><tr><th>홍보 제목</th><th>채널</th><th>게시일</th><th>상태</th><th></th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
  el("promoBody").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openPromoForm(S.promotions.find(x=>String(x.id)===b.dataset.edit)));
}
function openPromoForm(row){
  const isNew=!row;
  openModal(isNew?"새 홍보 등록":"홍보 수정",`
    <div class="form-grid">
      <div class="full"><label class="req">홍보 제목</label><input id="p_title" class="input" value="${row?esc(row.title):""}" placeholder="예: 8월 지붕태양광 유튜브 영상"></div>
      <div><label>채널</label><select id="p_channel" class="input">${CHANNELS.map(c=>`<option ${row&&row.channel===c?"selected":""}>${c}</option>`).join("")}</select></div>
      <div><label>게시일</label><input id="p_date" type="date" class="input" value="${row&&row.posted_date?esc(row.posted_date):new Date().toISOString().slice(0,10)}"></div>
      <div><label>상태</label><select id="p_status" class="input"><option ${row&&row.status==="진행중"?"selected":""}>진행중</option><option ${row&&row.status==="종료"?"selected":""}>종료</option></select></div>
    </div>`,
    async ()=>{
      const title=el("p_title").value.trim();
      if(!title){ toast("홍보 제목을 입력하세요"); return false; }
      const payload={ title, channel:el("p_channel").value, posted_date:el("p_date").value||null, status:el("p_status").value };
      let res;
      if(isNew){ payload.created_by=S.profile.id; res=await sb.from("promotions").insert(payload); }
      else res=await sb.from("promotions").update(payload).eq("id",row.id);
      if(res.error){ toast("저장 실패: "+res.error.message); return false; }
      toast(isNew?"홍보가 등록되었습니다":"수정되었습니다");
      await loadPromotions(); drawPromoTable(); return true;
    });
}

/* ---------- 홍보 성과 ---------- */
async function renderPromoStats(m){
  m.innerHTML=`<div class="page-head"><h1>홍보 성과 피드백</h1></div><div id="psBody" class="empty">불러오는 중…</div>`;
  await loadPromotions();
  const stats=await loadPromoStats(); const dist=await loadPromoBranchStats();
  el("psBody").outerHTML=`<div id="psBody">${promoStatsTable(stats,dist,false)}</div>`;
}

/* ---------- 계정 관리 (관리자 전용) ---------- */
function loginIdOf(p){
  if(p.role==="admin") return "관리자";
  if(p.role==="video") return "영상팀";
  return {1:"본사",2:"장흥",3:"영암",4:"평택",5:"파주"}[p.branch_id] || "-";
}
async function renderAccounts(m){
  m.innerHTML=`<div class="page-head"><h1>계정 관리</h1></div>
    <div class="banner">비밀번호를 분실한 계정을 <b>임시 비밀번호(solar1234!)</b>로 초기화합니다. 해당 사용자는 로그인 후 [🔑 비밀번호 변경]에서 바로 새 비번으로 바꾸세요.</div>
    <div id="acctBody" class="empty">불러오는 중…</div>`;
  const { data:profs, error } = await sb.from("profiles").select("id,role,branch_id,display_name,protected");
  if(error){ el("acctBody").innerHTML=`<div class="empty">계정을 불러오지 못했습니다.</div>`; return; }
  const order={admin:0,branch:1,video:2};
  const list=(profs||[]).filter(p=>!p.protected).slice().sort((a,b)=>(order[a.role]-order[b.role])||((a.branch_id||9)-(b.branch_id||9)));
  const body=list.map(p=>`<tr>
      <td class="cust" data-label="계정">${esc(p.display_name||"-")}</td>
      <td data-label="로그인 아이디"><span class="badge">${esc(loginIdOf(p))}</span></td>
      <td data-label="역할">${p.role==="admin"?"전체관리자":(p.role==="video"?"영상팀":"지사")}</td>
      <td class="row-actions" data-label=" "><button class="btn red-out" data-reset="${p.id}" data-name="${esc(p.display_name||"")}">비밀번호 초기화</button></td>
    </tr>`).join("");
  el("acctBody").innerHTML=`<div class="card-table mobilecards"><table>
    <thead><tr><th>계정</th><th>로그인 아이디</th><th>역할</th><th></th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
  el("acctBody").querySelectorAll("[data-reset]").forEach(b=>b.onclick=()=>resetPw(b.dataset.reset,b.dataset.name));
}
async function resetPw(uid,name){
  if(!confirm(`"${name}" 계정의 비밀번호를 임시비번(solar1234!)으로 초기화할까요?\n\n초기화 후 해당 사용자는 solar1234! 로 로그인한 뒤 새 비밀번호로 바꿔야 합니다.`)) return;
  const { data, error }=await sb.functions.invoke("admin-reset-password",{ body:{ userId:uid } });
  if(error){ toast("초기화 실패: 서버함수가 배포됐는지 확인하세요"); return; }
  if(data && data.error){ toast("초기화 실패: "+data.error); return; }
  toast(`✅ "${name}" 초기화 완료 — 임시비번: ${(data&&data.tempPassword)||"solar1234!"}`);
}
function promoStatsTable(stats,dist,withTitle){
  const head = withTitle? sectionTitle("영상팀 홍보 성과 피드백","홍보별 문의·계약 자동 집계","orange") : "";
  const body = stats.length? stats.map(s=>`<tr>
      <td class="cust" data-label="홍보 건">${esc(s.title)}</td>
      <td data-label="채널">${esc(s.channel||"-")}</td>
      <td data-label="문의">${s.inquiry_count}</td>
      <td data-label="계약">${s.contract_count}</td>
      <td class="rate" data-label="전환율">${s.conversion_rate==null?"0.0":s.conversion_rate}%</td>
      <td data-label="지사 분포">${esc((dist[s.promotion_id]||[]).join("·")||"-")}</td>
    </tr>`).join("") : `<tr><td colspan="6" class="empty">등록된 홍보가 없습니다. '홍보 관리'에서 홍보를 먼저 등록하세요.</td></tr>`;
  return `${head}<div class="card-table mobilecards"><table class="orange-head">
    <thead><tr><th>홍보 건</th><th>채널</th><th>문의</th><th>계약</th><th>전환율</th><th>지사 분포</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

/* ============================================================
   공통 렌더 조각
   ============================================================ */
function kpi(lab,num,sub,cls){ return `<div class="kpi ${cls}"><div class="lab">${lab}</div><div class="num">${num}<small>${typeof num==="number"?"건":""}</small></div><div class="sub">${sub}</div></div>`; }
function barRow(name,val,max,color){ const w=Math.max(4,Math.round(val/max*100));
  return `<div class="bar-row"><div class="name">${esc(name)}</div><div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${color}"></div></div><div class="val">${val}</div></div>`; }
function sectionTitle(t,d,cls){ return `<div class="sec-title ${cls||""}"><h3>${esc(t)}</h3><span class="d">${esc(d||"")}</span></div>`; }
function recentTable(rows){
  const isAdmin=S.profile.role==="admin";
  const body=rows.length? rows.map(r=>`<tr>
      <td class="cust" data-label="고객명">${esc(r.customer_name)}</td><td data-label="영업담당자">${esc(r.rep_name||"-")}</td><td data-label="지역">${esc(r.region||"-")}</td>
      <td data-label="설치유형">${esc(r.install_type||"-")}</td>
      <td data-label="유입경로">${esc(r.promotions?r.promotions.title:"-")}</td><td data-label="진행단계">${stagePill(r.stage)}</td>
      ${isAdmin?`<td data-label="담당지사"><span class="badge">${esc(branchName(r.branch_id))}</span></td>`:""}
      <td data-label="상담일">${esc(r.consult_date||"")}</td></tr>`).join("")
    : `<tr><td colspan="8" class="empty">상담 기록이 없습니다.</td></tr>`;
  return `<div class="card-table mobilecards"><table><thead><tr><th>고객명</th><th>영업담당자</th><th>지역</th><th>설치유형</th><th>유입경로(홍보)</th><th>진행단계</th>${isAdmin?"<th>담당지사</th>":""}<th>상담일</th></tr></thead><tbody>${body}</tbody></table></div>`;
}
function repPerformanceTable(rows){
  const isAdmin=S.profile.role==="admin";
  const map={};
  rows.forEach(r=>{
    const rep=r.rep_name||"(미지정)";
    const key=isAdmin? branchName(r.branch_id)+" · "+rep : rep;
    const m=map[key]||(map[key]={label:key,n:0,ing:0,deal:0,ps:0,pc:0});
    m.n++;
    if(["상담중","견적"].includes(r.stage)) m.ing++;
    if(r.stage==="계약") m.deal++;
    if(r.profit_rate!=null){ m.ps+=Number(r.profit_rate); m.pc++; }
  });
  const list=Object.values(map).sort((a,b)=>b.n-a.n || b.deal-a.deal);
  const body=list.length? list.map(m=>`<tr>
      <td class="cust" data-label="영업담당자">${esc(m.label)}</td>
      <td data-label="상담">${m.n}</td>
      <td data-label="진행중">${m.ing}</td>
      <td data-label="계약">${m.deal}</td>
      <td class="rate" data-label="전환율">${m.n? (m.deal/m.n*100).toFixed(1):"0.0"}%</td>
      <td data-label="평균 실행이익률">${m.pc? (m.ps/m.pc).toFixed(1)+"%" : "-"}</td>
    </tr>`).join("") : `<tr><td colspan="6" class="empty">상담 기록이 없습니다. 상담 입력 시 '영업담당자'를 적어주세요.</td></tr>`;
  return `<div class="card-table mobilecards"><table>
    <thead><tr><th>영업담당자</th><th>상담</th><th>진행중</th><th>계약</th><th>전환율</th><th>평균 실행이익률</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}
let REV = null;
function branchRevenueSection(rows){
  const isAdmin=S.profile.role==="admin";
  const now=new Date(), Y=now.getFullYear(), M=now.getMonth();
  const map={};
  rows.forEach(r=>{
    if(r.revenue==null) return;
    const d=new Date(r.consult_date); if(isNaN(d)||d.getFullYear()!==Y) return;
    const rev=Number(r.revenue)||0, prof=profitOf(r)||0;
    const o=map[r.branch_id]||(map[r.branch_id]={mRev:0,mPro:0,yRev:0,yPro:0});
    o.yRev+=rev; o.yPro+=prof;
    if(d.getMonth()===M){ o.mRev+=rev; o.mPro+=prof; }
  });
  const ids = isAdmin ? S.branches.map(b=>b.id) : [S.profile.branch_id];
  REV = { period:"month", Y, Mn:M+1,
    branches: ids.map(id=>({ name:branchName(id), ...(map[id]||{mRev:0,mPro:0,yRev:0,yPro:0}) })) };
  return `<div class="rev-toggle">
      <button class="rev-btn on" data-p="month" onclick="toggleRevPeriod('month')">이번 달 (${M+1}월)</button>
      <button class="rev-btn" data-p="year" onclick="toggleRevPeriod('year')">올해 (${Y})</button>
    </div><div id="revChart"></div>`;
}
function toggleRevPeriod(p){
  if(!REV) return; REV.period=p;
  document.querySelectorAll(".rev-btn").forEach(b=>b.classList.toggle("on", b.dataset.p===p));
  drawRevChart();
}
function revBar(name,val,max,color){
  const w = val>0 ? Math.max(3,Math.round(val/max*100)) : 0;
  return `<div class="bar-row rev-bar"><div class="name">${esc(name)}</div>
    <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${color}"></div></div>
    <div class="rev-val">${wonShort(val)}</div></div>`;
}
function drawRevChart(){
  if(!REV || !el("revChart")) return;
  const isMonth = REV.period==="month";
  const rk = isMonth?"mRev":"yRev", pk = isMonth?"mPro":"yPro";
  const bs = REV.branches;
  const rMax = Math.max(1,...bs.map(b=>b[rk])), pMax = Math.max(1,...bs.map(b=>b[pk]));
  const rTot = bs.reduce((a,b)=>a+b[rk],0), pTot = bs.reduce((a,b)=>a+b[pk],0);
  const panel=(title,key,max,color,tot)=>`<div class="panel">
      <div class="rev-head"><h3>${title}</h3><div class="rev-total" style="color:${color}">${won(tot)}</div></div>
      ${bs.map(b=>revBar(b.name,b[key],max,color)).join("")}
    </div>`;
  el("revChart").innerHTML = `<div class="panels">
      ${panel("예상 매출",rk,rMax,"#2e7d32",rTot)}
      ${panel("실행이익",pk,pMax,"#e67e22",pTot)}
    </div>`;
}
function wonShort(n){
  n=Number(n)||0; if(n===0) return "0";
  if(n>=1e8){ const v=n/1e8; return (v>=10?Math.round(v):Number(v.toFixed(1)))+"억"; }
  if(n>=1e4){ return Math.round(n/1e4).toLocaleString("ko-KR")+"만"; }
  return n.toLocaleString("ko-KR");
}
function wireRecentActions(){}

function val(id){ const e=el(id); return e? e.value.trim():""; }

// 숫자 입력칸에 천단위 콤마 자동표시
function commaInput(id){
  const e=el(id); if(!e) return;
  e.addEventListener("input", ()=>{
    const before=e.value.length, pos=e.selectionStart||0;
    const d=e.value.replace(/[^\d]/g,"");
    e.value = d ? Number(d).toLocaleString("ko-KR") : "";
    const diff=e.value.length-before;
    const np=Math.max(0,pos+diff); try{ e.setSelectionRange(np,np); }catch(_){}
  });
}
function numFromComma(id){ const e=el(id); if(!e) return null; const d=e.value.replace(/[^\d]/g,""); return d!==""? Number(d):null; }

/* ---------- 모달 ---------- */
function openModal(title, inner, onSave){
  const root=el("modalRoot");
  root.innerHTML=`<div class="modal-back"><div class="modal">
    <h2>${esc(title)}</h2>${inner}
    <div class="modal-actions"><button class="btn" id="mCancel">취소</button><button class="btn green" id="mSave">저장</button></div>
  </div></div>`;
  const close=()=>root.innerHTML="";
  el("mCancel").onclick=close;
  root.querySelector(".modal-back").onclick=(e)=>{ if(e.target.classList.contains("modal-back")) close(); };
  el("mSave").onclick=async()=>{ const ok=await onSave(); if(ok!==false) close(); };
}

/* ============================================================
   실시간
   ============================================================ */
function subscribeRealtime(){
  if(S.rtChannel) return;
  S.rtChannel = sb.channel("rt-consult")
    .on("postgres_changes",{event:"*",schema:"public",table:"consultations"}, onDataChange)
    .on("postgres_changes",{event:"*",schema:"public",table:"promotions"}, onDataChange)
    .subscribe();
}
let rtTimer=null;
function onDataChange(){ clearTimeout(rtTimer); rtTimer=setTimeout(()=>{ render(); },400); }

/* ============================================================
   시작
   ============================================================ */
function boot(){
  el("loginForm").addEventListener("submit", doLogin);
  el("logoutBtn").addEventListener("click", doLogout);
  el("hamburger").addEventListener("click", toggleNav);
  el("navBackdrop").addEventListener("click", closeNav);
  if(!CONFIGURED){
    const err=el("loginErr");
    err.innerHTML="⚙️ 서버 접속 정보가 아직 설정되지 않았습니다. (config.js 입력 후 사용 가능)";
    return;
  }
  // 이미 로그인된 세션이면 바로 진입
  sb.auth.getSession().then(({data})=>{ if(data.session) enterApp(); });
}
boot();
