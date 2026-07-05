import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8 text-center">
      <div className="max-w-xl">
        <p className="text-sm font-semibold uppercase tracking-widest text-blue-600">
          Meritly
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Employee Work Monitoring &amp; Performance Management
        </h1>
        <p className="mt-4 text-base text-gray-600">
          Assign tasks, submit work, track deadlines, and review performance —
          with AI-assisted ratings. A CSE327 software engineering project.
        </p>
      </div>

      <Link
        href="/login"
        className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
      >
        Get started &rarr;
      </Link>
    </main>
  );
}
