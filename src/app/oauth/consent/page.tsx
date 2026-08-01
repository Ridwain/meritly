import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

function ErrorCard({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-lg p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">
          Meritly
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          Connection unavailable
        </h1>
        <p className="mt-3 text-sm text-slate-600">{message}</p>
      </Card>
    </main>
  );
}

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string | string[] }>;
}) {
  const params = await searchParams;
  const authorizationId = Array.isArray(params.authorization_id)
    ? params.authorization_id[0]
    : params.authorization_id;

  if (!authorizationId) {
    return <ErrorCard message="The OAuth authorization request is missing." />;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const next = `/oauth/consent?authorization_id=${encodeURIComponent(
      authorizationId
    )}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("accepted_at, deleted_at")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !profile.accepted_at || profile.deleted_at) {
    return (
      <ErrorCard message="This Meritly account is not active and cannot connect external applications." />
    );
  }

  const { data, error } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

  if (error || !data) {
    return (
      <ErrorCard message="This authorization request is invalid, expired, or already used." />
    );
  }

  // Supabase may auto-approve a grant that the user already accepted.
  if (!("authorization_id" in data)) redirect(data.redirect_url);

  const scopes = data.scope
    .split(" ")
    .map((scope) => scope.trim())
    .filter(Boolean);

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-lg p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">
          Meritly
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
          Connect {data.client.name}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          This application will act as your Meritly account. It can only see and
          perform actions currently allowed by your role, department, task
          ownership, and database security policies.
        </p>

        <dl className="mt-6 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <div>
            <dt className="font-medium text-slate-900">Application</dt>
            <dd className="mt-1 break-all text-slate-600">{data.client.name}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">Requested access</dt>
            <dd className="mt-1 text-slate-600">
              {scopes.length ? scopes.join(", ") : "Basic account access"}
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-xs leading-5 text-slate-500">
          Meritly never gives this application an admin service key. You can
          revoke the connection later.
        </p>

        <form action="/api/oauth/decision" method="POST" className="mt-6 flex gap-3">
          <input type="hidden" name="authorization_id" value={authorizationId} />
          <button
            type="submit"
            name="decision"
            value="deny"
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Deny
          </button>
          <button
            type="submit"
            name="decision"
            value="approve"
            className="flex-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Allow connection
          </button>
        </form>
      </Card>
    </main>
  );
}
