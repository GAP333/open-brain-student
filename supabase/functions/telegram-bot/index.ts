Deno.serve(async (req) => {
  const T = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const U = Deno.env.get("SUPABASE_URL") ?? "";
  const K = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  let body;
  try { body = await req.json(); } catch(e) { return new Response("ok"); }
  const msg = body && body.message;
  if (!msg || !msg.text) return new Response("ok");
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const h = { apikey: K, Authorization: "Bearer " + K };
  const send = async (s) => {
    await fetch("https://api.telegram.org/bot" + T + "/sendMessage", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({chat_id: chatId, text: s}),
    });
  };
  if (text.startsWith("/recent")) {
    const r = await fetch(U + "/rest/v1/thoughts?order=created_at.desc&limit=5", {headers: h});
    const rows = await r.json();
    const out = rows.map((x, i) => (i+1) + ". " + x.content.slice(0, 150)).join("\n\n");
    await send(out || "No thoughts yet");
  } else if (text.startsWith("/search") || text.startsWith("?")) {
    const q = text.startsWith("/search") ? text.slice(7).trim() : text.slice(1).trim();
    const r = await fetch(U + "/rest/v1/thoughts?content=ilike.*" + encodeURIComponent(q) + "*&limit=5", {headers: h});
    const rows = await r.json();
    await send(rows.length ? rows.map((x, i) => (i+1) + ". " + x.content.slice(0, 150)).join("\n\n") : "Nothing found: " + q);
  } else {
    await fetch(U + "/rest/v1/thoughts", {
      method: "POST",
      headers: Object.assign({}, h, {"Content-Type": "application/json", "Prefer": "return=minimal"}),
      body: JSON.stringify({content: text}),
    });
    await send("Saved to your brain.");
  }
  return new Response("ok");
});
