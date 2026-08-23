import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

// Active Gemini models for text generation
const MODELS_TO_TRY = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-3.6-flash",
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(
  model: string,
  contents: any[],
  apiKey: string,
  maxRetries = 2
) {
  let lastError: string | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({ contents }),
        }
      );

      const data = await response.json();

      if (response.ok) {
        return { success: true, data, model };
      }

      lastError = data.error?.message || `HTTP ${response.status}`;

      // If model is busy (503) or rate-limited (429), wait and retry
      if (response.status === 503 || response.status === 429) {
        const backoffMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        console.warn(
          `[${model}] Rate limited (${response.status}). Retrying in ${Math.round(backoffMs)}ms...`
        );
        await wait(backoffMs);
        continue;
      }

      // If model is retired, not found (404), or unavailable, skip retrying this model
      if (
        response.status === 404 ||
        response.status === 400 ||
        lastError?.toLowerCase().includes("not found") ||
        lastError?.toLowerCase().includes("no longer available")
      ) {
        console.warn(`[${model}] Unavailable: ${lastError}. Trying next model...`);
        break;
      }
    } catch (err: any) {
      lastError = err.message;
      await wait(1000);
    }
  }

  return { success: false, error: lastError };
}

export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseServerClient();

    // 1. Authenticate user session
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse user payload
    const body = await req.json();
    const question = body.message || body.question;

    if (!question) {
      return NextResponse.json(
        { error: "Question/message is required." },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is missing in .env.local" },
        { status: 500 }
      );
    }

    // 3. Fetch ALL documents from database via Supabase Admin Client
    const supabaseAdmin = createSupabaseAdminClient();
    const { data: docs, error: dbError } = await supabaseAdmin
      .from("documents")
      .select("id, title, content, created_at");

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    // 4. Format all documents into prompt context
    const documentContext = (docs || [])
      .map((doc, idx) => {
        const cleanContent = doc.content
          ? doc.content.replace(/<[^>]*>?/gm, "").trim()
          : "No text content available.";

        return `--- DOCUMENT ${idx + 1} ---
Title: ${doc.title}
Created Date: ${new Date(doc.created_at).toLocaleDateString()}
Content:
${cleanContent}`;
      })
      .join("\n\n");

    const systemPrompt = `You are an intelligent AI Document Assistant built into our document management system.
You have full access to all official internal documents listed below.

Instructions:
- Answer the user's question clearly, concisely, and accurately based strictly on the provided document context.
- Explicitly cite the document title(s) where you found the information.
- If the answer cannot be found in the document context, politely let the user know.

=== START OF ALL DOCUMENTS ===
${documentContext || "No documents currently exist in the system."}
=== END OF ALL DOCUMENTS ===`;

    const contents = [
      {
        role: "user",
        parts: [{ text: `${systemPrompt}\n\nUser Question: ${question}` }],
      },
    ];

    let lastError = "";

    // 5. Sequence through candidate models
    for (const model of MODELS_TO_TRY) {
      const result = await fetchWithRetry(model, contents, apiKey);

      if (result.success) {
        const aiReply =
          result.data.candidates?.[0]?.content?.parts?.[0]?.text ||
          "I couldn't process that question. Please try again.";

        return NextResponse.json({ reply: aiReply, modelUsed: result.model });
      }

      lastError = result.error || "Unknown error";
    }

    return NextResponse.json(
      { error: `All candidate models failed. Last error: ${lastError}` },
      { status: 503 }
    );
  } catch (error: any) {
    console.error("Server Error in /api/documents/chat:", error);
    return NextResponse.json(
      { error: error.message || "Failed to communicate with Gemini AI." },
      { status: 500 }
    );
  }
}