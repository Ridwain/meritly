import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { MAX_FILE_BYTES, validateMcpFile } from "@/lib/mcpFileValidation";
import { isTrustedSameOrigin } from "@/lib/sameOriginRequest";

export async function POST(request: NextRequest) {
  if (!isTrustedSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_FILE_BYTES + 1_000_000) {
    return NextResponse.json({ error: "File is too large" }, { status: 413 });
  }

  const formData = await request.formData();
  const token = formData.get("token");
  const file = formData.get("file");
  if (
    typeof token !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(token) ||
    !(file instanceof File)
  ) {
    return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const next = `/mcp/upload?token=${encodeURIComponent(token)}`;
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(next)}`, request.url),
      303
    );
  }

  const { data: sessions, error: sessionError } = await supabase.rpc(
    "get_mcp_upload",
    { p_upload_token: token }
  );
  const session = sessions?.[0];
  if (
    sessionError ||
    !session ||
    session.state !== "pending" ||
    new Date(session.expires_at).getTime() <= Date.now()
  ) {
    return NextResponse.json({ error: "Upload is unavailable" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let validated;
  try {
    validated = validateMcpFile(file.name, file.type, bytes);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid file" },
      { status: 400 }
    );
  }

  const bucket =
    session.purpose === "submission" ? "submissions" : "task-attachments";
  const objectPath = `${user.id}/${token}/${Date.now()}-${validated.safeName}`;
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(objectPath, bytes, {
      contentType: validated.contentType,
      upsert: false,
    });
  if (uploadError) {
    return NextResponse.json({ error: "Private upload failed" }, { status: 400 });
  }

  const { error: completeError } = await supabase.rpc("mcp_complete_upload", {
    p_upload_token: token,
    p_object_path: objectPath,
    p_original_filename: validated.safeName,
    p_content_type: validated.contentType,
    p_byte_size: bytes.byteLength,
  });
  if (completeError) {
    // The authenticated session was validated above. Admin is used only to
    // remove this exact newly-created orphan if finalization fails.
    await createSupabaseAdminClient().storage.from(bucket).remove([objectPath]);
    return NextResponse.json({ error: "Upload finalization failed" }, { status: 400 });
  }

  return NextResponse.redirect(
    new URL(`/mcp/upload?token=${encodeURIComponent(token)}`, request.url),
    303
  );
}
