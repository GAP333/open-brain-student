
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type": "application/json",
};

const TOOLS = [
  {
    name: "search_kic_people",
    description: "Search Kingdom Impact Council contacts by name, role, organization, or notes",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "list_kic_people",
    description: "List all Kingdom Impact Council contacts, optionally filtered by organization or relationship",
    inputSchema: { type: "object", properties: { organization: { type: "string" }, relationship: { type: "string" } } },
  },
  {
    name: "add_kic_person",
    description: "Add a new person to the Kingdom Impact Council contacts",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        role: { type: "string" },
        organization: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        notes: { type: "string" },
        relationship: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "update_kic_person",
    description: "Update notes, role, or relationship for a KIC contact by their name",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        notes: { type: "string" },
        role: { type: "string" },
        relationship: { type: "string" },
        last_contact: { type: "string" },
      },
      required: ["name"],
    },
  },
];

async function searchPeople(query) {
  const q = encodeURIComponent("*" + query + "*");
  const res = await fetch(
    SUPABASE_URL + "/rest/v1/kic_people?or=(name.ilike." + q + ",role.ilike." + q + ",organization.ilike." + q + ",notes.ilike." + q + ")&limit=10",
    { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY } }
  );
  return await res.json();
}

async function listPeople(organization, relationship) {
  let url = SUPABASE_URL + "/rest/v1/kic_people?order=name.asc&limit=50";
  if (organization) url += "&organization=ilike.*" + encodeURIComponent(organization) + "*";
  if (relationship) url += "&relationship=ilike.*" + encodeURIComponent(relationship) + "*";
  const res = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY } });
  return await res.json();
}

async function addPerson(data) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/kic_people", {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(data),
  });
  return await res.json();
}

async function updatePerson(name, updates) {
  const q = encodeURIComponent(name);
  const res = await fetch(SUPABASE_URL + "/rest/v1/kic_people?name=ilike." + q, {
    method: "PATCH",
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(updates),
  });
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace("Bearer ", "").trim();
  if (token !== ACCESS_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
  }

  const body = await req.json();
  const { method, id, params } = body;
  let result;

  if (method === "tools/list") {
    result = { tools: TOOLS };
  } else if (method === "tools/call") {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    if (name === "search_kic_people") {
      result = { content: [{ type: "text", text: JSON.stringify(await searchPeople(args.query || ""), null, 2) }] };
    } else if (name === "list_kic_people") {
      result = { content: [{ type: "text", text: JSON.stringify(await listPeople(args.organization, args.relationship), null, 2) }] };
    } else if (name === "add_kic_person") {
      result = { content: [{ type: "text", text: "Added: " + JSON.stringify(await addPerson(args)) }] };
    } else if (name === "update_kic_person") {
      const { name: personName, ...updates } = args;
      result = { content: [{ type: "text", text: "Updated: " + JSON.stringify(await updatePerson(personName, updates)) }] };
    } else {
      result = { content: [{ type: "text", text: "Unknown tool: " + name }] };
    }
  } else if (method === "initialize") {
    result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "kic-brain", version: "1.0.0" } };
  } else {
    result = { error: "Unknown method: " + method };
  }

  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: CORS });
});
