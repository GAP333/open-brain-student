
// LLM Gateway — to switch providers, change LLM_PROVIDER in Supabase secrets.
// Add the new provider's API key. No other code changes needed.

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const PROVIDER = Deno.env.get("LLM_PROVIDER") ?? "openai";
const MODEL = Deno.env.get("LLM_MODEL") ?? "gpt-4o-mini";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { prompt, systemPrompt, maxTokens } = await req.json();

    let text = "";

    if (PROVIDER === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + OPENAI_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: maxTokens || 500,
          messages: [
            ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
            { role: "user", content: prompt },
          ],
        }),
      });
      const data = await res.json();
      text = data.choices?.[0]?.message?.content ?? "";
    } else if (PROVIDER === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: maxTokens || 500,
          messages: [{ role: "user", content: prompt }],
          ...(systemPrompt ? { system: systemPrompt } : {}),
        }),
      });
      const data = await res.json();
      text = data.content?.[0]?.text ?? "";
    }

    return new Response(JSON.stringify({ text }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS });
  }
});
