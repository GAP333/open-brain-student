
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { subject, body, from, receivedAt } = await req.json();

    if (!subject && !body) {
      return new Response(JSON.stringify({ skipped: true, reason: "empty" }), { headers: CORS });
    }

    const emailText = "FROM: " + (from || "unknown") + "\nSUBJECT: " + (subject || "") + "\n\n" + (body || "").slice(0, 2000);

    // Ask LLM if this email is worth saving
    const scorePrompt = "You are deciding if an email is worth saving to a personal knowledge brain. " +
      "Rate it 1-10. Save if score >= 6. Reasons to save: contains decisions, action items, important information, learning, meeting notes, key contacts, project updates. " +
      "Do NOT save: newsletters, marketing, notifications, automated emails, short replies, FYI forwards with no substance. " +
      "Respond with ONLY valid JSON: {\"score\": 7, \"save\": true, \"reason\": \"one sentence why\"}\n\nEmail:\n" + emailText;

    const llmRes = await fetch(SUPABASE_URL + "/functions/v1/call-llm", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + SUPABASE_KEY },
      body: JSON.stringify({ prompt: scorePrompt, maxTokens: 150 }),
    });

    const llmData = await llmRes.json();
    const llmText = llmData.text ?? "";

    let decision = { score: 0, save: false, reason: "" };
    try {
      const match = llmText.match(/\{[\s\S]*\}/);
      if (match) decision = JSON.parse(match[0]);
    } catch (e) {
      console.error("Parse error:", e);
    }

    console.log("Email score:", decision.score, "| Save:", decision.save, "| Reason:", decision.reason);

    if (!decision.save) {
      return new Response(JSON.stringify({ saved: false, score: decision.score, reason: decision.reason }), { headers: CORS });
    }

    // Save to brain
    const content = "EMAIL CAPTURE\n\nFrom: " + (from || "unknown") + "\nSubject: " + (subject || "") + "\nReceived: " + (receivedAt || new Date().toISOString()) + "\n\n" + (body || "").slice(0, 3000);

    await fetch(SUPABASE_URL + "/rest/v1/thoughts", {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + SUPABASE_KEY,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        content,
        category: "reference",
        summary: "Email: " + (subject || "").slice(0, 100),
        tags: ["email", "outlook"],
      }),
    });

    return new Response(JSON.stringify({ saved: true, score: decision.score, reason: decision.reason }), { headers: CORS });

  } catch (e) {
    console.error("Email capture error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 200, headers: CORS });
  }
});
