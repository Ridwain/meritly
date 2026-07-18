"use client"; // interactive form => must run in the browser

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";

// Sign-in only. Accounts are created by invitation (HR/admin), never by public
// signup — so there is no "create account" option here.
export default function LoginPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  // useState infers the type from the initial value ("" -> string), so these
  // don't need explicit annotations.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [deactivated, setDeactivated] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("deactivated") === "1") setDeactivated(true);
  }, []);

  // FormEvent<HTMLFormElement> is the type of a form's submit event.
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
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
        <h1 className="mt-1 text-center text-2xl font-semibold tracking-tight text-slate-900">
          Sign in
        </h1>

        {deactivated && (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
            Your account has been deactivated. Please contact your HR or admin.
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label>Password</Label>
            <Input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Please wait…" : "Sign in"}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-500">
          Accounts are created by invitation. Contact your HR or admin to get
          access.
        </p>
      </Card>
    </main>
  );
}
