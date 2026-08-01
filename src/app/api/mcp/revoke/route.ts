import { NextResponse, type NextRequest } from "next/server";
import { isTrustedSameOrigin } from "@/lib/sameOriginRequest";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export async function POST(request: NextRequest) {
  if (!isTrustedSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const formData = await request.formData();
  const connectionId = formData.get("connection_id");
  if (typeof connectionId !== "string" || !/^[0-9a-f-]{36}$/i.test(connectionId)) {
    return NextResponse.json({ error: "Invalid connection" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const { error } = await supabase.rpc("revoke_mcp_connection", {
    p_connection_id: connectionId,
  });
  if (error) {
    return NextResponse.json({ error: "Unable to revoke connection" }, { status: 400 });
  }
  return NextResponse.redirect(new URL("/dashboard/connected-apps", request.url), 303);
}
