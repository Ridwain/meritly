"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";

// The page an invited user lands on after clicking their email link.
// The link carries a one-time session (in the URL). We turn that into a real
// session, let them choose a password, then send them into the dashboard.
export default function AcceptInvitePage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const [status, setStatus] = useState("loading"); // loading | ready | invalid
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function init() {
      // ALWAYS process the invite tokens from the URL first. This link belongs
      // to the invitee — we must not reuse whatever session might already be in
      // this browser (e.g. an HR who clicked the link while logged in).
      const hash = window.location.hash.replace(/^#/, "");
      const params = new URLSearchParams(hash);
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        if (!error) {
          // scrub the tokens from the address bar
          window.history.replaceState({}, "", "/auth/accept");
          setStatus("ready");
          return;
        }
      }

      // No tokens in the URL (e.g. the page was reloaded after we already set
      // the session) — fall back to an existing session if there is one.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        setStatus("ready");
        return;
      }
      setStatus("invalid");
    }
    init();
  }, [supabase]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-sm">
        <p className="text-center text-sm font-semibold uppercase tracking-widest text-blue-600">
          Meritly
        </p>

        {status === "loading" && (
          <p className="mt-6 text-center text-sm text-gray-500">
            Checking your invitation…
          </p>
        )}

        {status === "invalid" && (
          <div className="mt-4 text-center">
            <h1 className="text-xl font-bold text-gray-900">
              Invitation invalid or expired
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              Please ask your HR or admin to send a new invitation.
            </p>
          </div>
        )}

        {status === "ready" && (
          <>
            <h1 className="mt-1 text-center text-2xl font-bold">
              Set your password
            </h1>
            <p className="mt-1 text-center text-sm text-gray-600">
              Choose a password to finish setting up your account.
            </p>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  New password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Set password & continue"}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
