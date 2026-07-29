// Authenticated private-file download. The database row is fetched with the
// caller's session, so department RLS decides whether a signed URL is issued.
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get("kind");
  const id = request.nextUrl.searchParams.get("id");
  if (!id || (kind !== "task" && kind !== "submission")) {
    return NextResponse.json({ error: "Invalid file request." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let bucket: "task-attachments" | "submissions";
  let path: string | null;
  let downloadName: string | boolean = true;

  if (kind === "task") {
    const { data } = await supabase
      .from("tasks")
      .select("attachment_path, attachment_name")
      .eq("id", id)
      .maybeSingle();
    bucket = "task-attachments";
    path = data?.attachment_path ?? null;
    // Keep user-supplied filenames out of response-header control characters.
    downloadName =
      data?.attachment_name?.replace(/[\r\n"]/g, "_").slice(0, 180) ?? true;
  } else {
    const { data } = await supabase
      .from("submissions")
      .select("file_path")
      .eq("id", id)
      .maybeSingle();
    bucket = "submissions";
    path = data?.file_path ?? null;
  }

  // Use one generic response so callers cannot probe inaccessible row IDs.
  if (!path) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60, { download: downloadName });
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl);
}
