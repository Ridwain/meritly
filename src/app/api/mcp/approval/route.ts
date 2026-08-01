import { NextResponse, type NextRequest } from "next/server";
import { isTrustedSameOrigin } from "@/lib/sameOriginRequest";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export async function POST(request: NextRequest) {
  if (!isTrustedSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const formData = await request.formData();
  const token = formData.get("token");
  const decision = formData.get("decision");
  if (
    typeof token !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(token) ||
    (decision !== "approve" && decision !== "deny")
  ) {
    return NextResponse.json({ error: "Invalid approval decision" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const next = `/mcp/approve?token=${encodeURIComponent(token)}`;
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(next)}`, request.url),
      303
    );
  }

  const { error } = await supabase.rpc("decide_mcp_approval", {
    p_approval_token: token,
    p_decision: decision,
  });
  if (error) {
    return NextResponse.json(
      { error: "Approval is expired, inaccessible, or already decided" },
      { status: 400 }
    );
  }

  return NextResponse.redirect(
    new URL(`/mcp/approve?token=${encodeURIComponent(token)}`, request.url),
    303
  );
}
