// Open Brain MCP Server v3 — structured memory + semantic search + Outlook calendar
// Tools: search_brain (alias: search_thoughts), list_recent, add_thought,
//        get_contact, update_contact, get_state, update_state, log_session,
//        get_upcoming_meetings, add_task, list_tasks, complete_task
//
// Secrets required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MCP_ACCESS_KEY,
//                   OPENAI_API_KEY, OUTLOOK_ICS_URL

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY") ?? "";
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OUTLOOK_ICS_URL = Deno.env.get("OUTLOOK_ICS_URL") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type": "application/json",
};

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: "Bearer " + SUPABASE_KEY,
  "Content-Type": "application/json",
};

const TOOLS = [
  {
    name: "search_brain",
    description: "Semantic search across all saved thoughts, notes, contacts, projects, and transcripts. Finds by meaning, not just keywords. Optionally filter by type: thought, contact, project, state, session. Optionally filter by bucket (life compartment): gcu, legacy, school, personal.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, type: { type: "string" }, bucket: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
  },
  {
    name: "search_thoughts",
    description: "Alias of search_brain. Semantic search across saved thoughts, notes, transcripts, and PDFs.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, type: { type: "string" }, bucket: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
  },
  {
    name: "list_recent",
    description: "Get the most recently saved entries, optionally filtered by type (thought, contact, project, session, digest) and/or bucket (gcu, legacy, school, personal).",
    inputSchema: { type: "object", properties: { limit: { type: "number" }, type: { type: "string" }, bucket: { type: "string" } } },
  },
  {
    name: "add_thought",
    description: "Save a new entry to the brain. Optionally set a type (thought, contact, project), a short title, and a bucket — the life compartment it belongs to: gcu (GCU Development job), legacy (Legacy Development Partners job), school, or personal.",
    inputSchema: { type: "object", properties: { content: { type: "string" }, type: { type: "string" }, title: { type: "string" }, bucket: { type: "string" } }, required: ["content"] },
  },
  {
    name: "get_contact",
    description: "Look up a contact card by name. Returns everything known about that person.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "update_contact",
    description: "Create or update a contact card. Pass the person's name and the FULL updated card content (this replaces the existing card, so include everything worth keeping).",
    inputSchema: { type: "object", properties: { name: { type: "string" }, content: { type: "string" } }, required: ["name", "content"] },
  },
  {
    name: "get_state",
    description: "Read the current state file — active projects, open loops, and what matters right now. Call this at the start of a work session.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "update_state",
    description: "Overwrite the current state file with updated content. Include all active projects and open loops, not just changes.",
    inputSchema: { type: "object", properties: { content: { type: "string" } }, required: ["content"] },
  },
  {
    name: "log_session",
    description: "Save a summary of what was accomplished in this work session (decisions made, emails sent, next steps).",
    inputSchema: { type: "object", properties: { content: { type: "string" }, title: { type: "string" } }, required: ["content"] },
  },
  {
    name: "get_thought",
    description: "Get the FULL content of one entry by its id. Use after search_brain when a truncated result needs to be read in full.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "get_upcoming_meetings",
    description: "Get upcoming meetings from the connected Outlook (GCU) calendar. Optionally set days ahead to look (default 7).",
    inputSchema: { type: "object", properties: { days: { type: "number" } } },
  },
  {
    name: "add_task",
    description: "Add a to-do task. Optionally set the bucket (life compartment): gcu, legacy, school, or personal (default personal).",
    inputSchema: { type: "object", properties: { content: { type: "string" }, bucket: { type: "string" } }, required: ["content"] },
  },
  {
    name: "list_tasks",
    description: "List open (not yet completed) tasks, newest first, with their bucket. Pass include_done=true to also include completed tasks, or bucket to filter to one compartment.",
    inputSchema: { type: "object", properties: { include_done: { type: "boolean" }, bucket: { type: "string" }, limit: { type: "number" } } },
  },
  {
    name: "complete_task",
    description: "Mark a task as done by its id (from list_tasks).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

async function embed(text: string): Promise<number[] | null> {
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Authorization": "Bearer " + OPENAI_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 30000) }),
    });
    const data = await res.json();
    return data.data?.[0]?.embedding ?? null;
  } catch (_e) {
    return null;
  }
}

function strip(rows: any[]) {
  if (!Array.isArray(rows)) return rows;
  return rows.map(({ embedding, ...rest }) => rest);
}

const PREVIEW_CHARS = 1500;
function preview(rows: any[]) {
  if (!Array.isArray(rows)) return rows;
  return rows.map(({ embedding, content, ...rest }) => {
    const full = content ?? "";
    if (full.length <= PREVIEW_CHARS) return { ...rest, content: full };
    return {
      ...rest,
      content: full.slice(0, PREVIEW_CHARS),
      truncated: true,
      full_length: full.length,
      note: "Truncated. Call get_thought with this id for the full content.",
    };
  });
}

const COLS = "id,content,title,type,tags,category,summary,bucket,created_at";

async function getThought(id: string) {
  const res = await fetch(
    SUPABASE_URL + "/rest/v1/thoughts?select=" + COLS + "&id=eq." + encodeURIComponent(id) + "&limit=1",
    { headers: HEADERS }
  );
  return await res.json();
}

async function searchBrain(query: string, type?: string, limit?: number, bucket?: string) {
  const emb = await embed(query);
  if (emb) {
    const res = await fetch(SUPABASE_URL + "/rest/v1/rpc/match_thoughts", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ query_embedding: emb, match_count: limit || 10, filter_type: type || null, filter_bucket: bucket || null }),
    });
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length) return rows;
  }
  let url = SUPABASE_URL + "/rest/v1/thoughts?select=" + COLS + "&content=ilike.*" + encodeURIComponent(query) + "*&order=created_at.desc&limit=" + (limit || 10);
  if (type) url += "&type=eq." + encodeURIComponent(type);
  if (bucket) url += "&bucket=eq." + encodeURIComponent(bucket);
  const res = await fetch(url, { headers: HEADERS });
  return await res.json();
}

async function listRecent(limit?: number, type?: string, bucket?: string) {
  let url = SUPABASE_URL + "/rest/v1/thoughts?select=" + COLS + "&order=created_at.desc&limit=" + (limit || 10);
  if (type) url += "&type=eq." + encodeURIComponent(type);
  if (bucket) url += "&bucket=eq." + encodeURIComponent(bucket);
  const res = await fetch(url, { headers: HEADERS });
  return await res.json();
}

async function addEntry(content: string, type?: string, title?: string, bucket?: string) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/thoughts", {
    method: "POST",
    headers: { ...HEADERS, Prefer: "return=representation" },
    body: JSON.stringify({ content, type: type || "thought", title: title || null, bucket: bucket || null }),
  });
  const rows = await res.json();
  return strip(Array.isArray(rows) ? rows : [rows]);
}

async function getByTitle(type: string, title: string) {
  const res = await fetch(
    SUPABASE_URL + "/rest/v1/thoughts?select=" + COLS + "&type=eq." + type + "&title=ilike.*" + encodeURIComponent(title) + "*&order=created_at.desc&limit=5",
    { headers: HEADERS }
  );
  return await res.json();
}

async function upsertByTitle(type: string, title: string, content: string) {
  const res = await fetch(
    SUPABASE_URL + "/rest/v1/thoughts?select=id&type=eq." + type + "&title=eq." + encodeURIComponent(title) + "&limit=1",
    { headers: HEADERS }
  );
  const existing = await res.json();
  if (Array.isArray(existing) && existing.length) {
    const emb = await embed(title + "\n" + content);
    await fetch(SUPABASE_URL + "/rest/v1/thoughts?id=eq." + existing[0].id, {
      method: "PATCH",
      headers: { ...HEADERS, Prefer: "return=minimal" },
      body: JSON.stringify({ content, embedding: emb }),
    });
    return { updated: true, id: existing[0].id, title };
  }
  const created = await addEntry(content, type, title);
  return { created: true, entry: created[0] };
}

// --- Outlook ICS calendar ---
function parseICSDate(v: string): Date | null {
  // Handles 20260701T140000Z, 20260701T140000, 20260701
  const m = v.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return new Date(Date.UTC(+y, +mo - 1, +d));
  if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  return new Date(+y, +mo - 1, +d, +h, +mi, +s);
}

async function getUpcomingMeetings(days?: number) {
  if (!OUTLOOK_ICS_URL) return { error: "OUTLOOK_ICS_URL secret is not set" };
  const res = await fetch(OUTLOOK_ICS_URL);
  if (!res.ok) return { error: "Calendar fetch failed: " + res.status };
  const ics = (await res.text()).replace(/\r\n[ \t]/g, ""); // unfold wrapped lines

  const now = new Date();
  const horizon = new Date(now.getTime() + (days || 7) * 24 * 60 * 60 * 1000);
  const events: { title: string; start: string; end?: string; location?: string }[] = [];

  const blocks = ics.split("BEGIN:VEVENT").slice(1);
  for (const block of blocks) {
    const get = (key: string) => {
      const m = block.match(new RegExp("^" + key + "[^:]*:(.*)$", "m"));
      return m ? m[1].trim() : "";
    };
    const start = parseICSDate(get("DTSTART"));
    if (!start || start < now || start > horizon) continue;
    const end = parseICSDate(get("DTEND"));
    events.push({
      title: get("SUMMARY") || "(no title)",
      start: start.toISOString(),
      end: end ? end.toISOString() : undefined,
      location: get("LOCATION") || undefined,
    });
  }
  events.sort((a, b) => a.start.localeCompare(b.start));
  return { count: events.length, days: days || 7, events: events.slice(0, 50) };
}

// --- Tasks (type=task; category tracks open/done; bucket = life compartment) ---
const TASK_BUCKETS = ["gcu", "legacy", "school", "personal"];
async function addTask(content: string, bucket?: string) {
  const b = TASK_BUCKETS.includes((bucket || "").toLowerCase()) ? (bucket || "").toLowerCase() : "personal";
  const res = await fetch(SUPABASE_URL + "/rest/v1/thoughts", {
    method: "POST",
    headers: { ...HEADERS, Prefer: "return=representation" },
    body: JSON.stringify({ content, type: "task", bucket: b, category: "open" }),
  });
  const rows = await res.json();
  const task = strip(Array.isArray(rows) ? rows : [rows])[0];
  return { saved: !!task, task };
}
async function listTasks(includeDone?: boolean, bucket?: string, limit?: number) {
  let url = SUPABASE_URL + "/rest/v1/thoughts?select=" + COLS + "&type=eq.task&order=created_at.desc&limit=" + (limit || 200);
  if (bucket) url += "&bucket=eq." + encodeURIComponent(bucket.toLowerCase());
  const res = await fetch(url, { headers: HEADERS });
  const rows = await res.json();
  if (!Array.isArray(rows)) return rows;
  const tasks = strip(includeDone ? rows : rows.filter((r: { category?: string }) => r.category !== "done"));
  return { count: tasks.length, tasks };
}
async function completeTask(id: string) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/thoughts?id=eq." + encodeURIComponent(id), {
    method: "PATCH",
    headers: { ...HEADERS, Prefer: "return=minimal" },
    body: JSON.stringify({ category: "done" }),
  });
  return { done: res.ok, id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace("Bearer ", "").trim();
  if (token !== ACCESS_KEY) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });

  let body;
  try { body = await req.json(); } catch (_e) { return new Response(JSON.stringify({ error: "Bad JSON" }), { status: 400, headers: CORS }); }

  const { method, id, params } = body;
  let result;

  if (method === "tools/list") {
    result = { tools: TOOLS };
  } else if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    const text = (obj: unknown) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });

    if (name === "search_brain" || name === "search_thoughts") result = text(preview(await searchBrain(args.query || "", args.type, args.limit, args.bucket)));
    else if (name === "list_recent") result = text(preview(await listRecent(args.limit, args.type, args.bucket)));
    else if (name === "get_thought") result = text(strip(await getThought(args.id || "")));
    else if (name === "add_thought") result = text({ saved: await addEntry(args.content || "", args.type, args.title, args.bucket) });
    else if (name === "get_contact") result = text(strip(await getByTitle("contact", args.name || "")));
    else if (name === "update_contact") result = text(await upsertByTitle("contact", args.name || "", args.content || ""));
    else if (name === "get_state") result = text(strip(await getByTitle("state", "current")));
    else if (name === "update_state") result = text(await upsertByTitle("state", "current", args.content || ""));
    else if (name === "log_session") result = text({ saved: await addEntry(args.content || "", "session", args.title || "Session " + new Date().toISOString().slice(0, 10)) });
    else if (name === "get_upcoming_meetings") result = text(await getUpcomingMeetings(args.days));
    else if (name === "add_task") result = text(await addTask(args.content || "", args.bucket));
    else if (name === "list_tasks") result = text(await listTasks(args.include_done, args.bucket, args.limit));
    else if (name === "complete_task") result = text(await completeTask(args.id || ""));
    else result = text("Unknown tool: " + name);
  } else if (method === "capture") {
    // Flat, Shortcut-friendly capture: {"method":"capture","content":"...","bucket":"personal"}
    // Say "task: ..." at the start to save a task instead of a note.
    const raw = (body.content || "").trim();
    if (!raw) {
      result = { saved: false, error: "content is empty" };
    } else if (/^task[:,]?\s/i.test(raw)) {
      result = await addTask(raw.replace(/^task[:,]?\s+/i, ""), body.bucket);
    } else {
      result = { saved: await addEntry(raw, "thought", null, body.bucket) };
    }
  } else if (method === "initialize") {
    result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "open-brain", version: "3.3.0" } };
  } else {
    result = { error: "Unknown method: " + method };
  }

  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: CORS });
});
