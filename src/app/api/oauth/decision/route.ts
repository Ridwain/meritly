import { NextResponse, type NextRequest } from "next/server";
import { isTrustedSameOrigin } from "@/lib/sameOriginRequest";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export async function POST(request: NextRequest) {
  // Same-origin POSTs stop another website from silently approving a Meritly
  // connection using the user's existing browser session.
  if (!isTrustedSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const formData = await request.formData();
  const authorizationId = formData.get("authorization_id");
  const decision = formData.get("decision");

  if (
    typeof authorizationId !== "string" ||
    !authorizationId ||
    (decision !== "approve" && decision !== "deny")
  ) {
    return NextResponse.json({ error: "Invalid OAuth decision" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const next = `/oauth/consent?authorization_id=${encodeURIComponent(
      authorizationId
    )}`;
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(next)}`, request.url),
      303
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("accepted_at, deleted_at")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !profile.accepted_at || profile.deleted_at) {
    return NextResponse.json({ error: "Account inactive" }, { status: 403 });
  }

  // Re-read the authorization details on POST so the decision is bound to
  // this user and to a still-valid, single-use Supabase authorization request.
  const { data: details, error: detailsError } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (
    detailsError ||
    !details ||
    !("authorization_id" in details) ||
    details.user.id !== user.id
  ) {
    return NextResponse.json(
      { error: "Authorization request expired or invalid" },
      { status: 400 }
    );
  }

  const result =
    decision === "approve"
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, {
          skipBrowserRedirect: true,
        })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, {
          skipBrowserRedirect: true,
        });

  if (result.error || !result.data?.redirect_url) {
    return NextResponse.json(
      { error: "Unable to complete authorization" },
      { status: 400 }
    );
  }

  // The external URL comes from Supabase after it validates the registered
  // OAuth client and redirect URI; it never comes directly from form input.
  return NextResponse.redirect(result.data.redirect_url, 303);
}
