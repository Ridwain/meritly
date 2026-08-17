// POST /api/ai-task-description
// Generates a short, simple, human-readable task description with Gemini.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export async function POST(req: Request) {
  try {
    // 1. Check login
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not logged in." }, { status: 401 });
    }

    // 2. Check permission
    const { data: canCreate } = await supabase.rpc("has_permission", {
      perm: "task.create",
    });

    if (!canCreate) {
      return NextResponse.json(
        { error: "Permission denied." },
        { status: 403 }
      );
    }

    // 3. Check Gemini API key
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not set." },
        { status: 500 }
      );
    }

    // 4. Read request body
    const body = (await req.json()) as {
      title?: string;
      priority?: string;
    };

    const title = body.title?.trim();

    if (!title) {
      return NextResponse.json(
        { error: "Please enter a task title first." },
        { status: 400 }
      );
    }

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

    const headers = {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    };

    // Clean Gemini's answer without accidentally deleting the real sentence.
    function cleanDescription(text: string) {
      let result = text
        .replace(/\*\*/g, "")
        .replace(/\*/g, "")
        .replace(/`/g, "")
        .replace(/#+\s*/g, "")
        .replace(/^[-•]\s*/gm, "")
        .replace(/\r?\n+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      // Remove unwanted labels Gemini may put before the real answer.
      // Examples: "Goal. Prepare...", "Description: Prepare..."
      result = result.replace(
        /^(?:goal|description|answer|task|objective|result|output)\s*[:.\-–—]*\s*/i,
        ""
      );

      // Remove wrapping quotes.
      result = result.replace(/^["']+|["']+$/g, "").trim();

      // If Gemini still added another label, remove it once more.
      result = result.replace(
        /^(?:goal|description|answer|task|objective|result|output)\s*[:.\-–—]*\s*/i,
        ""
      );

      // Keep it short, but DON'T cut at the first period.
      const words = result.split(/\s+/).filter(Boolean);
      if (words.length > 22) {
        result = words.slice(0, 22).join(" ");
      }

      // Remove trailing punctuation before adding one clean period.
      result = result.replace(/[\s,;:\-–—]+$/, "").trim();

      if (result && !/[.!?]$/.test(result)) {
        result += ".";
      }

      return result;
    }

    function isBadDescription(text: string) {
      const normalized = text
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, "")
        .trim();

      const badWords = [
        "goal",
        "description",
        "answer",
        "task",
        "objective",
        "result",
        "output",
      ];

      const wordCount = normalized.split(/\s+/).filter(Boolean).length;

      return (
        !normalized ||
        wordCount < 4 ||
        badWords.includes(normalized)
      );
    }

    async function generateDescription(extraInstruction = "") {
      const prompt = `
You create very short task descriptions for employees.

Task title: "${title}"

Write exactly ONE short and natural sentence that explains what the employee should do.

Rules:
- Use very simple everyday English.
- Keep it around 8 to 18 words.
- Make the meaning clear to a normal person.
- Do not write "Goal", "Description", "Task", "Objective", "Answer", or any heading.
- Do not use bullet points or markdown.
- Do not repeat the title word-for-word if a clearer sentence is possible.
- Do not invent deadlines, names, numbers, tools, or requirements.
- Return ONLY the description sentence.
${extraInstruction}

Examples:
Title: prepare pdf about AI
Prepare a short PDF that clearly explains the basic ideas of artificial intelligence.

Title: fix login button
Fix the login button so users can sign in without problems.

Title: check employee attendance
Review the employee attendance records and make sure the information is correct.
`.trim();

      const payload = {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.15,
          maxOutputTokens: 80,
        },
      };

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error("Gemini API error:", errorText);
        throw new Error("Could not generate a description.");
      }

      const data = await res.json();

      const rawText: string =
        data?.candidates?.[0]?.content?.parts
          ?.map((part: { text?: string }) => part.text ?? "")
          .join(" ") ?? "";

      return cleanDescription(rawText);
    }

    // 5. First AI attempt
    let description = await generateDescription();

    // 6. Retry once if Gemini returned something useless like "Goal."
    if (isBadDescription(description)) {
      description = await generateDescription(
        "IMPORTANT: Your previous type of response was too short or only a label. Write the actual action sentence now."
      );
    }

    // 7. Final safety check
    if (isBadDescription(description)) {
      return NextResponse.json(
        { error: "AI did not return a useful description. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ description });
  } catch (err) {
    console.error("AI task description error:", err);

    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Something went wrong.",
      },
      { status: 500 }
    );
  }
}
