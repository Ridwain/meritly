// POST /api/invite-user  { email, fullName, departmentId }
// Creates a new (employee) account by invitation and emails them a link to
// set their password. This route uses the service-role key, so its FIRST job
// is to prove the caller is allowed to invite — never trust the request alone.
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { isValidEmail } from "@/lib/validation";

type InviteBody = {
  email?: string;
  fullName?: string;
  departmentId?: number;
};

export async function POST(request: NextRequest) {
  const { email, fullName, departmentId }: InviteBody = await request.json();

  if (
    !email ||
    !fullName ||
    typeof departmentId !== "number" ||
    !Number.isInteger(departmentId)
  ) {
    return NextResponse.json(
      { error: "Email, full name, and department are required." },
      { status: 400 }
    );
  }

  // The UI checks this too (instant feedback), but that check can be
  // bypassed by calling this route directly — so it must be re-checked here.
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Invalid email." }, { status: 400 });
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

  // A global manager can invite into any department. Other inviters are
  // limited to their own department, which mirrors the database scope.
  const [{ data: canManageAll }, { data: callerProfile }] = await Promise.all([
    supabase.rpc("has_permission", { perm: "user.manage_all" }),
    supabase
      .from("profiles")
      .select("department_id")
      .eq("id", user.id)
      .single(),
  ]);
  if (!callerProfile) {
    return NextResponse.json(
      { error: "Your department could not be verified." },
      { status: 403 }
    );
  }
  // Never trust a scoped inviter's submitted department. A crafted request is
  // silently forced back to the caller's own department.
  const effectiveDepartmentId = canManageAll
    ? departmentId
    : callerProfile.department_id;

  // 3) Now (and only now) use the privileged client to create + email the invite.
  // The invite link will send them to /auth/accept to choose a password.
  const admin = createSupabaseAdminClient();
  const { data: token, error: provisionError } = await admin.rpc(
    "prepare_user_invite",
    {
      p_email: email,
      p_full_name: fullName,
      p_department_id: effectiveDepartmentId,
      p_created_by: user.id,
    }
  );
  if (provisionError || !token) {
    return NextResponse.json(
      { error: provisionError?.message ?? "Could not prepare the invitation." },
      { status: 400 }
    );
  }

  const redirectTo = `${request.nextUrl.origin}/auth/accept`;
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    email,
    {
      // The opaque token links Auth creation to trusted server-side state.
      data: { meritly_provisioning_token: token },
      redirectTo,
    }
  );

  if (inviteError) {
    // Do not leave a stale reservation when Auth rejects the invite.
    await admin.rpc("cancel_user_invite_provisioning", { p_token: token });
    // Most common: the email already has an account.
    return NextResponse.json({ error: inviteError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
