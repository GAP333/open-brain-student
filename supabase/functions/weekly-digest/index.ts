
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
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const res = await fetch(
      SUPABASE_URL + "/rest/v1/thoughts?created_at=gte." + sevenDaysAgo + "&or=(category.neq.digest,category.is.null)&order=created_at.desc&limit=100",
      { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY } }
    );
    const thoughts = await res.json();

    if (!thoughts.length || thoughts.length < 5) {
      console.log("Not enough thoughts for digest:", thoughts.length);
      return new Response(JSON.stringify({ skipped: true, count: thoughts.length }), { headers: CORS });
    }

    const grouped = {};
    for (const t of thoughts) {
      const cat = t.category || "uncategorized";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(t.summary || t.content.slice(0, 200));
    }

    const groupedText = Object.entries(grouped)
      .map(([cat, items]) => cat.toUpperCase() + ":\n" + items.map(i => "- " + i).join("\n"))
      .join("\n\n");

    const prompt = "You are summarizing someone's personal knowledge brain for the past week. " +
      "Here are their captured thoughts grouped by category:\n\n" + groupedText +
      "\n\nWrite a weekly digest with: 1) A short summary of what they were focused on, " +
      "2) Key themes across categories, 3) One interesting question they seem to be exploring. " +
      "Keep it personal, insightful, and under 300 words.";

    const llmRes = await fetch(SUPABASE_URL + "/functions/v1/call-llm", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + SUPABASE_KEY },
      body: JSON.stringify({ prompt, maxTokens: 600 }),
    });

    const llmData = await llmRes.json();
    const digestText = llmData.text ?? "No digest generated.";

    await fetch(SUPABASE_URL + "/rest/v1/thoughts", {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + SUPABASE_KEY,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        content: "WEEKLY DIGEST\n\n" + digestText,
        category: "digest",
        summary: "Automated weekly brain digest",
        tags: ["digest", "weekly", "automated"],
        enriched_at: new Date().toISOString(),
      }),
    });

    console.log("Digest saved successfully");
    return new Response(JSON.stringify({ success: true, thoughtCount: thoughts.length }), { headers: CORS });

  } catch (e) {
    console.error("Digest error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 200, headers: CORS });
  }
});
