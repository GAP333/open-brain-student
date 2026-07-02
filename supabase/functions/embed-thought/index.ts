// Embed Thought — generates a vector embedding for each saved thought.
// Two modes:
//   1. Webhook mode: Supabase calls this on every INSERT into thoughts (payload has .record)
//   2. Backfill mode: POST { "backfill": true } to embed everything that has no embedding yet
//
// Requires secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY (already set)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type": "application/json",
};

async function embed(text: string): Promise<number[] | null> {
  // text-embedding-3-small handles ~8k tokens; truncate long transcripts safely
  const input = text.slice(0, 30000);
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": "Bearer " + OPENAI_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input }),
  });
  const data = await res.json();
  return data.data?.[0]?.embedding ?? null;
}

async function saveEmbedding(id: string, embedding: number[]) {
  await fetch(SUPABASE_URL + "/rest/v1/thoughts?id=eq." + id, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ embedding }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const payload = await req.json();

    // --- Backfill mode ---
    if (payload.backfill) {
      const res = await fetch(
        SUPABASE_URL + "/rest/v1/thoughts?embedding=is.null&select=id,content,title&order=created_at.asc&limit=50",
        { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY } }
      );
      const rows = await res.json();
      let done = 0;
      for (const row of rows) {
        const text = (row.title ? row.title + "\n" : "") + (row.content ?? "");
        if (!text.trim()) continue;
        const emb = await embed(text);
        if (emb) { await saveEmbedding(row.id, emb); done++; }
      }
      // If exactly 50 came back there may be more — call backfill again.
      return new Response(JSON.stringify({ embedded: done, remaining_possible: rows.length === 50 }), { headers: CORS });
    }

    // --- Webhook mode ---
    const record = payload.record;
    if (!record || !record.content) {
      return new Response(JSON.stringify({ skipped: true }), { headers: CORS });
    }
    const text = (record.title ? record.title + "\n" : "") + record.content;
    const emb = await embed(text);
    if (emb) await saveEmbedding(record.id, emb);

    return new Response(JSON.stringify({ success: !!emb }), { headers: CORS });
  } catch (e) {
    console.error("Embed error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 200, headers: CORS });
  }
});
