// Open Brain MCP Server
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY") ?? "";
const CORS = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, content-type","Content-Type":"application/json"};
const TOOLS = [{name:"search_thoughts",description:"Search saved thoughts, notes, YouTube transcripts, and PDFs",inputSchema:{type:"object",properties:{query:{type:"string"}},required:["query"]}},{name:"list_recent",description:"Get the most recently saved thoughts",inputSchema:{type:"object",properties:{limit:{type:"number"}}}},{name:"add_thought",description:"Save a new thought to the brain",inputSchema:{type:"object",properties:{content:{type:"string"}},required:["content"]}}];
async function searchThoughts(query) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/thoughts?content=ilike.*" + encodeURIComponent(query) + "*&order=created_at.desc&limit=10", {headers:{apikey:SUPABASE_KEY,Authorization:"Bearer "+SUPABASE_KEY}});
  return await res.json();
}
async function listRecent(limit) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/thoughts?order=created_at.desc&limit=" + (limit||10), {headers:{apikey:SUPABASE_KEY,Authorization:"Bearer "+SUPABASE_KEY}});
  return await res.json();
}
async function addThought(content) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/thoughts", {method:"POST",headers:{apikey:SUPABASE_KEY,Authorization:"Bearer "+SUPABASE_KEY,"Content-Type":"application/json",Prefer:"return=representation"},body:JSON.stringify({content})});
  return await res.json();
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers:CORS});
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace("Bearer ","").trim();
  if (token !== ACCESS_KEY) return new Response(JSON.stringify({error:"Unauthorized"}), {status:401,headers:CORS});
  let body;
  try { body = await req.json(); } catch(e) { return new Response(JSON.stringify({error:"Bad JSON"}), {status:400,headers:CORS}); }
  const {method, id, params} = body;
  let result;
  if (method === "tools/list") {
    result = {tools:TOOLS};
  } else if (method === "tools/call") {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    if (name === "search_thoughts") result = {content:[{type:"text",text:JSON.stringify(await searchThoughts(args.query||""),null,2)}]};
    else if (name === "list_recent") result = {content:[{type:"text",text:JSON.stringify(await listRecent(args.limit),null,2)}]};
    else if (name === "add_thought") result = {content:[{type:"text",text:"Saved: "+JSON.stringify(await addThought(args.content||""))}]};
    else result = {content:[{type:"text",text:"Unknown tool: "+name}]};
  } else if (method === "initialize") {
    result = {protocolVersion:"2024-11-05",capabilities:{tools:{}},serverInfo:{name:"open-brain",version:"1.0.0"}};
  } else {
    result = {error:"Unknown method: "+method};
  }
  return new Response(JSON.stringify({jsonrpc:"2.0",id,result}), {headers:CORS});
});
