"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";

// The three states this page can be in. Typing it as a union means a typo like
// setStatus("redy") is a compile error.
type AcceptStatus = "loading" | "ready" | "invalid";

// The page an invited user lands on after clicking their email link.
// The link carries a one-time session (in the URL). We turn that into a real
// session, let them choose a password, then send them into the dashboard.
export default function AcceptInvitePage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const [status, setStatus] = useState<AcceptStatus>("loading");
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
          window.history.replaceState({}, "", "/auth/accept");
          setStatus("ready");
          return;
        }
      }

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

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
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
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-8 shadow-sm">
        <p className="text-center text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">
          Meritly
        </p>

        {status === "loading" && (
          <p className="mt-6 text-center text-sm text-slate-500">
            Checking your invitation…
          </p>
        )}

        {status === "invalid" && (
          <div className="mt-4 text-center">
            <h1 className="text-xl font-semibold text-slate-900">
              Invitation invalid or expired
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Please ask your HR or admin to send a new invitation.
            </p>
          </div>
        )}

        {status === "ready" && (
          <>
            <h1 className="mt-1 text-center text-2xl font-semibold tracking-tight text-slate-900">
              Set your password
            </h1>
            <p className="mt-1 text-center text-sm text-slate-500">
              Choose a password to finish setting up your account.
            </p>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <Label>New password</Label>
                <Input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <Button type="submit" disabled={saving} className="w-full">
                {saving ? "Saving…" : "Set password & continue"}
              </Button>
            </form>
          </>
        )}
      </Card>
    </main>
  );
}
