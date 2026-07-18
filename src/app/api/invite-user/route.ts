// POST /api/invite-user  { email, fullName }
// Creates a new (employee) account by invitation and emails them a link to
// set their password. This route uses the service-role key, so its FIRST job
// is to prove the caller is allowed to invite — never trust the request alone.
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

type InviteBody = {
  email?: string;
  fullName?: string;
};

export async function POST(request: NextRequest) {
  const { email, fullName }: InviteBody = await request.json();

  if (!email || !fullName) {
    return NextResponse.json(
      { error: "Email and full name are required." },
      { status: 400 }
    );
  }

  // 1) Who is calling? (server client = the logged-in user's session)
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // 2) Are they allowed to invite? Ask the database (RBAC), not the request.
  const { data: allowed, error: permError } = await supabase.rpc(
    "has_permission",
    { perm: "user.invite" }
  );
  if (permError || !allowed) {
    return NextResponse.json(
      { error: "You do not have permission to invite users." },
      { status: 403 }
    );
  }

  // 3) Now (and only now) use the privileged client to create + email the invite.
  // The invite link will send them to /auth/accept to choose a password.
  const admin = createSupabaseAdminClient();
  const redirectTo = `${request.nextUrl.origin}/auth/accept`;
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    email,
    { data: { full_name: fullName }, redirectTo }
  );

  if (inviteError) {
    // Most common: the email already has an account.
    return NextResponse.json({ error: inviteError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
