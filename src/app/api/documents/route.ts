import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"; // <-- Fixed named import

// GET: Fetch all documents
export async function GET() {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// POST: Create / Upload new document
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const supabaseAdmin = createSupabaseAdminClient(); // <-- Initialize Admin Client

  // 1. Authenticate user from session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Fetch user's role directly from database
  const { data: profile } = await supabase
    .from("profiles")
    .select("roles(name)")
    .eq("id", user.id)
    .single();

  const roleData = profile?.roles as { name: string } | null;
  const roleName = roleData?.name?.toLowerCase();

  if (roleName !== "hr" && roleName !== "admin") {
    return NextResponse.json(
      { error: "Forbidden: HR access required" },
      { status: 403 }
    );
  }

  // 3. Process form data
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const title = formData.get("title") as string | null;
  const initialContent = (formData.get("content") as string) || "";

  if (!title) {
    return NextResponse.json(
      { error: "Document title is required." },
      { status: 400 }
    );
  }

  let publicUrl = "";

  // Upload file if attached using Admin client (Bypasses RLS)
  if (file && file.size > 0) {
    const fileName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from("documents")
      .upload(fileName, file);

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: urlData } = supabaseAdmin.storage
      .from("documents")
      .getPublicUrl(fileName);
    publicUrl = urlData.publicUrl;
  }

  // Insert into DB using Admin client
  const { data, error: dbError } = await supabaseAdmin
    .from("documents")
    .insert([
      {
        title,
        file_url: publicUrl,
        content: initialContent,
        uploaded_by: user.id,
      },
    ])
    .select();

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// PUT: Edit existing document like Google Docs
export async function PUT(request: Request) {
  const supabase = await createSupabaseServerClient();
  const supabaseAdmin = createSupabaseAdminClient(); // <-- Initialize Admin Client

  // 1. Authenticate session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Authorization check
  const { data: profile } = await supabase
    .from("profiles")
    .select("roles(name)")
    .eq("id", user.id)
    .single();

  const roleData = profile?.roles as { name: string } | null;
  const roleName = roleData?.name?.toLowerCase();

  if (roleName !== "hr" && roleName !== "admin") {
    return NextResponse.json(
      { error: "Forbidden: HR access required to edit" },
      { status: 403 }
    );
  }

  // 3. Parse JSON body updates
  const body = await request.json();
  const { id, title, content } = body;

  if (!id || !title) {
    return NextResponse.json(
      { error: "Document ID and Title are required" },
      { status: 400 }
    );
  }

  // 4. Update existing row using Admin client
  const { data, error } = await supabaseAdmin
    .from("documents")
    .update({
      title,
      content,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}