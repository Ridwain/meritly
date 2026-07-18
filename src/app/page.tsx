import Link from "next/link";
import { ArrowRight } from "lucide-react";
import AuthHashHandler from "./AuthHashHandler";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8 text-center">
      <AuthHashHandler />
      <div className="max-w-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">
          Meritly
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900">
          Employee work monitoring &amp; performance management
        </h1>
        <p className="mt-4 text-base text-slate-500">
          Assign tasks, submit work, track deadlines, and review performance —
          with AI-assisted ratings. A CSE327 software engineering project.
        </p>
      </div>

      <Link
        href="/login"
        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
      >
        Get started
        <ArrowRight className="h-4 w-4" />
      </Link>
    </main>
  );
}
