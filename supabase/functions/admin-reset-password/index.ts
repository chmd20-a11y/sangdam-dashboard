// =====================================================================
// Edge Function: admin-reset-password
// 관리자(role=admin)만 호출 가능. 대상 계정의 비밀번호를 임시비번으로 초기화.
// 관리자 키(service_role)는 이 서버함수 안에서만 사용됨(웹페이지에 노출 X).
// Supabase 대시보드 → Edge Functions → 새 함수 'admin-reset-password' 에
// 이 코드를 붙여넣고 Deploy 하세요. (SUPABASE_URL / ANON / SERVICE_ROLE 는 자동 주입)
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    // 1) 호출자(로그인 사용자) 확인
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: uerr } = await userClient.auth.getUser();
    if (uerr || !user) return json({ error: "로그인이 필요합니다." }, 401);

    // 2) 관리자 권한 확인 (service_role 로 profiles 조회)
    const admin = createClient(url, serviceKey);
    const { data: prof } = await admin
      .from("profiles").select("role").eq("id", user.id).single();
    if (!prof || prof.role !== "admin") {
      return json({ error: "관리자만 비밀번호를 초기화할 수 있습니다." }, 403);
    }

    // 3) 대상 계정 비밀번호 초기화
    const { userId, newPassword } = await req.json().catch(() => ({}));
    if (!userId) return json({ error: "초기화할 계정이 지정되지 않았습니다." }, 400);
    const temp = (typeof newPassword === "string" && newPassword.length >= 6)
      ? newPassword : "solar1234!";
    const { error: rerr } = await admin.auth.admin.updateUserById(userId, { password: temp });
    if (rerr) return json({ error: rerr.message }, 400);

    return json({ ok: true, tempPassword: temp });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
