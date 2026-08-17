// POST /api/ai-task-description
//
// HR types a short task title and clicks "Generate Description".
// This route sends that title to Google Gemini (our AI) and gets back
// a full, clear description of what the employee needs to do.
//
// Think of it like this:
//   HR types:  "monthly sales report"
//   AI writes: "Prepare a detailed monthly sales report covering revenue,
//               top-performing products, and regional breakdowns. Include
//               a short summary of key insights and export the final file
//               as a PDF before the deadline."
//
// The description is just a SUGGESTION — HR can edit it before saving.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export async function POST(req: Request) {
  // ── Step 1: Make sure the person is logged in ──────────────────────────────
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Not logged in → refuse the request
    return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  }

  // ── Step 2: Make sure the person is allowed to create tasks (HR only) ──────
  const { data: canCreate } = await supabase.rpc("has_permission", {
    perm: "task.create",
  });

  if (!canCreate) {
    return NextResponse.json(
      { error: "You do not have permission to create tasks." },
      { status: 403 }
    );
  }

  // ── Step 3: Check the AI key is configured on the server ──────────────────
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "The AI service is not configured. Ask your admin to add GEMINI_API_KEY." },
      { status: 500 }
    );
  }

  // ── Step 4: Read the title, priority, and deadline sent by the browser ──────
  const body = await req.json();
  const { title, priority, deadline } = body as {
    title: string;
    priority: string;
    deadline: string; // may be empty string if HR hasn't filled it yet
  };

  // Title is required — we can't generate a description for nothing
  if (!title || !title.trim()) {
    return NextResponse.json(
      { error: "Please fill in the task title first." },
      { status: 400 }
    );
  }

  // Format the deadline nicely for the AI prompt, e.g. "Aug 20, 2026, 5:00 PM"
  // If no deadline is set yet, just say "not specified"
  let deadlineText = "not specified";
  if (deadline) {
    deadlineText = new Date(deadline).toLocaleString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  // ── Step 5: Build the instructions we send to Gemini ──────────────────────
  // The "prompt" is like a text message to the AI telling it exactly what to do.
  const prompt = `You are an HR manager writing a task description for an employee.

TASK INFORMATION
Title: ${title.trim()}
Priority: ${priority}
Deadline: ${deadlineText}

YOUR JOB
Write a clear, friendly task description (2 to 4 sentences) that tells the employee:
1. What they need to do
2. What the final result should look like
3. Any quality bar or format to follow (e.g. PDF, spreadsheet, summary)

Rules:
- Keep it simple and professional
- Do not use bullet points — write it as plain sentences
- Do not repeat the title word for word
- Do not include a deadline sentence (the deadline is shown separately)

Respond with ONLY valid JSON in this exact shape — no markdown, no extra text:
{"description":"<your description here>"}`;

  // ── Step 6: Send the prompt to Google Gemini and wait for the answer ───────
  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.5,  // 0 = very predictable, 1 = very creative
            maxOutputTokens: 256, // short descriptions only
          },
        }),
      }
    );

    // If Gemini itself returned an error, pass it along
    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return NextResponse.json(
        { error: `AI service error: ${errText}` },
        { status: 502 }
      );
    }

    // ── Step 7: Pull the text out of Gemini's response ─────────────────────
    const geminiData = await geminiRes.json();

    // Gemini wraps its answer in a nested structure — we dig in to get the text
    const rawText: string =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Sometimes Gemini wraps the JSON in ```json ... ``` — strip that off
    const cleaned = rawText.replace(/```json|```/g, "").trim();

    // Turn the text into a real JavaScript object
    const parsed = JSON.parse(cleaned) as { description: string };

    // Make sure the AI actually gave us a description string
    if (typeof parsed.description !== "string" || !parsed.description.trim()) {
      throw new Error("AI returned an unexpected format.");
    }

    // ── Step 8: Send the description back to the browser ───────────────────
    return NextResponse.json({ description: parsed.description.trim() });

  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Something went wrong with the AI. Please try again.",
      },
      { status: 500 }
    );
  }
}
