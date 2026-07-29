// Best-effort cleanup for an upload whose following database write failed.
// The service client is safe here because the caller may remove only an
// unreferenced object inside their own UUID folder.
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

type CleanupBody = {
  bucket?: string;
  path?: string;
};

export async function POST(request: NextRequest) {
  const { bucket, path }: CleanupBody = await request.json();
  const allowedBucket =
    bucket === "submissions" || bucket === "task-attachments";
  if (
    !allowedBucket ||
    !path ||
    path.length > 1024 ||
    path.includes("..") ||
    path.startsWith("/")
  ) {
    return NextResponse.json({ error: "Invalid upload path." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (path.split("/")[0] !== user.id) {
    return NextResponse.json({ error: "Upload path is not yours." }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  const reference =
    bucket === "submissions"
      ? await admin
          .from("submissions")
          .select("id")
          .eq("file_path", path)
          .maybeSingle()
      : await admin
          .from("tasks")
          .select("id")
          .eq("attachment_path", path)
          .maybeSingle();

  if (reference.data) {
    return NextResponse.json(
      { error: "Referenced files cannot be removed." },
      { status: 409 }
    );
  }

  const { error } = await admin.storage.from(bucket).remove([path]);
  if (error) {
    return NextResponse.json({ error: "Cleanup failed." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
