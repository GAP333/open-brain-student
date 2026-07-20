Deno.serve(async (req) => {
  const T = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const U = Deno.env.get("SUPABASE_URL") ?? "";
  const K = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  let body;
  try { body = await req.json(); } catch(e) { return new Response("ok"); }
  const msg = body && body.message;
  if (!msg || (!msg.text && !msg.photo)) return new Response("ok");
  const chatId = msg.chat.id;
  const h = { apikey: K, Authorization: "Bearer " + K };
  const send = async (s) => {
    await fetch("https://api.telegram.org/bot" + T + "/sendMessage", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({chat_id: chatId, text: s}),
    });
  };
  if (msg.photo) {
    // Telegram sends several sizes; the last is the largest
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const fr = await fetch("https://api.telegram.org/bot" + T + "/getFile?file_id=" + fileId);
    const fj = await fr.json();
    if (!fj.ok) { await send("Couldn't fetch that photo from Telegram."); return new Response("ok"); }
    const dl = await fetch("https://api.telegram.org/file/bot" + T + "/" + fj.result.file_path);
    const bytes = await dl.arrayBuffer();
    const ext = fj.result.file_path.split(".").pop() || "jpg";
    const name = Date.now() + "-" + fileId.slice(-8) + "." + ext;
    const up = await fetch(U + "/storage/v1/object/brain-images/" + name, {
      method: "POST",
      headers: Object.assign({}, h, {"Content-Type": "image/" + (ext === "jpg" ? "jpeg" : ext)}),
      body: bytes,
    });
    if (!up.ok) { await send("Photo upload failed: " + (await up.text()).slice(0, 200)); return new Response("ok"); }
    const publicUrl = U + "/storage/v1/object/public/brain-images/" + name;
    const caption = (msg.caption || "").trim();
    await fetch(U + "/rest/v1/thoughts", {
      method: "POST",
      headers: Object.assign({}, h, {"Content-Type": "application/json", "Prefer": "return=minimal"}),
      body: JSON.stringify({content: caption || "📷 Photo from Telegram", image_url: publicUrl, type: "photo"}),
    });
    await send("📷 Photo saved to your brain" + (caption ? " with your caption." : "."));
    return new Response("ok");
  }
  const text = msg.text.trim();
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
