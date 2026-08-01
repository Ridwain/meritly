import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export const metadata: Metadata = {
  title: "Upload Meritly file",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function MessageCard({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-xl p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">
          Meritly
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-3 text-sm text-slate-600">{message}</p>
      </Card>
    </main>
  );
}

export default async function McpUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) {
    return <MessageCard title="Upload unavailable" message="This upload link is invalid." />;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const next = `/mcp/upload?token=${encodeURIComponent(token)}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const { data, error } = await supabase.rpc("get_mcp_upload", {
    p_upload_token: token,
  });
  const upload = data?.[0];
  if (error || !upload) {
    return (
      <MessageCard
        title="Upload unavailable"
        message="This upload is inaccessible, revoked, or no longer available."
      />
    );
  }

  if (upload.state === "uploaded") {
    return (
      <MessageCard
        title="File uploaded"
        message="Return to ChatGPT or Claude and continue with the same upload token."
      />
    );
  }
  if (upload.state === "consumed") {
    return (
      <MessageCard
        title="File already used"
        message="This file has already been attached to its Meritly action."
      />
    );
  }
  if (upload.state === "expired" || new Date(upload.expires_at).getTime() <= Date.now()) {
    return (
      <MessageCard
        title="Upload expired"
        message="Ask the assistant to create a new upload link."
      />
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-xl p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">
          Meritly
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          Upload {upload.purpose === "submission" ? "submitted work" : "task attachment"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {upload.client_name} requested one private file. Choose a supported file up to 10 MB.
          The link expires at {new Date(upload.expires_at).toLocaleString()}.
        </p>

        <form
          action="/api/mcp/upload"
          method="POST"
          encType="multipart/form-data"
          className="mt-6 space-y-4"
        >
          <input type="hidden" name="token" value={token} />
          <input
            required
            name="file"
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.zip"
            className="block w-full text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700"
          />
          <p className="text-xs leading-5 text-slate-500">
            Meritly checks the extension, MIME type, and file signature. Production use also requires an external malware scanner.
          </p>
          <button
            type="submit"
            className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Upload privately
          </button>
        </form>
      </Card>
    </main>
  );
}
