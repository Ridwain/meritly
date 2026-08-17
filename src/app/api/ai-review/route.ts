// POST /api/ai-review
// HR calls this to get an AI-drafted review for a submitted task.
// Gemini reads the task info + submission note and returns:
//   { feedback: string, decision: "completed" | "needs_revision" }
// HR can then edit the draft and approve it — it is NEVER sent automatically.
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();

  // Auth guard — only submission.review holders (HR/admin) may call this.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const { data: canReview } = await supabase.rpc("has_permission", {
    perm: "submission.review",
  });
  if (!canReview) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  const body = await req.json();
  const { taskTitle, taskDescription, submissionNote, priority, deadline } =
    body as {
      taskTitle: string;
      taskDescription: string | null;
      submissionNote: string;
      priority: string;
      deadline: string;
    };

  if (!taskTitle || !submissionNote) {
    return NextResponse.json(
      { error: "taskTitle and submissionNote are required." },
      { status: 400 }
    );
  }

  const deadlineFormatted = new Date(deadline).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const now = new Date();
  const deadlineDate = new Date(deadline);
  const isLate = now > deadlineDate;

  // Build the prompt.
  const prompt = `You are an HR manager reviewing an employee's submitted work.

TASK DETAILS
Title: ${taskTitle}
${taskDescription ? `Description: ${taskDescription}` : ""}
Priority: ${priority}
Deadline: ${deadlineFormatted}${isLate ? " (LATE — submitted after deadline)" : ""}

EMPLOYEE'S SUBMISSION NOTE
${submissionNote}

YOUR JOB
1. Write a concise, professional feedback comment (2–4 sentences) for the employee.
   - Be constructive and specific.
   - If submitted late, acknowledge it briefly but fairly.
   - Focus on the quality/completeness implied by the submission note.
2. Recommend a decision: either "completed" (approve the work) or "needs_revision" (ask them to redo/improve it).

Respond with ONLY valid JSON in this exact shape — no markdown, no extra text:
{"feedback":"<your feedback here>","decision":"completed"}
or
{"feedback":"<your feedback here>","decision":"needs_revision"}`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 512,
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return NextResponse.json(
        { error: `Gemini API error: ${errText}` },
        { status: 502 }
      );
    }

    const geminiData = await geminiRes.json();
    const rawText: string =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Strip markdown code fences if Gemini wraps the JSON.
    const cleaned = rawText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned) as {
      feedback: string;
      decision: "completed" | "needs_revision";
    };

    if (
      typeof parsed.feedback !== "string" ||
      !["completed", "needs_revision"].includes(parsed.decision)
    ) {
      throw new Error("Unexpected shape from Gemini");
    }

    return NextResponse.json(parsed);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to parse Gemini response.",
      },
      { status: 500 }
    );
  }
}
