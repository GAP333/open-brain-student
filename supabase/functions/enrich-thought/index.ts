
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
    const payload = await req.json();
    const record = payload.record;

    if (!record || !record.content || record.content.length < 20) {
      return new Response(JSON.stringify({ skipped: true }), { headers: CORS });
    }

    const prompt = "Analyze this text and respond with ONLY valid JSON in this exact format: {" +
      '"tags": ["tag1", "tag2", "tag3"], ' +
      '"category": "learning", ' +
      '"summary": "One sentence summary."' +
      "} Category must be one of: idea, learning, question, reference, plan, reflection. Tags should be 3-5 short keywords. Text to analyze: " + record.content;

    const llmRes = await fetch(SUPABASE_URL + "/functions/v1/call-llm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + SUPABASE_KEY,
      },
      body: JSON.stringify({ prompt }),
    });

    const llmData = await llmRes.json();
    const text = llmData.text ?? "";

    let enrichment = { tags: [], category: null, summary: null };
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) enrichment = JSON.parse(match[0]);
    } catch (e) {
      console.error("Parse error:", e);
    }

    await fetch(SUPABASE_URL + "/rest/v1/thoughts?id=eq." + record.id, {
      method: "PATCH",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        tags: enrichment.tags || [],
        category: enrichment.category || null,
        summary: enrichment.summary || null,
        enriched_at: new Date().toISOString(),
      }),
    });

    return new Response(JSON.stringify({ success: true }), { headers: CORS });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 200, headers: CORS });
  }
});
