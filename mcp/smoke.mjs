// Throwaway stdio smoke test: spawn the MCP server, initialize, list tools, and
// call ONE deterministic tool (meta_analysis -> /api/synthesis, no Claude spend).
import { spawn } from "node:child_process";

const child = spawn("node", ["dist/server.js"], { stdio: ["pipe", "pipe", "inherit"] });

let buf = "";
const pending = new Map();
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function send(obj) { child.stdin.write(JSON.stringify(obj) + "\n"); }
function rpc(id, method, params) {
  return new Promise((resolve) => { pending.set(id, resolve); send({ jsonrpc: "2.0", id, method, params }); });
}

const fail = (m) => { console.error("SMOKE FAIL:", m); child.kill(); process.exit(1); };
setTimeout(() => fail("timeout"), 40000);

const init = await rpc(1, "initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});
if (!init.result?.serverInfo) fail("no serverInfo from initialize");
console.log("initialize OK ->", init.result.serverInfo.name, init.result.serverInfo.version);

send({ jsonrpc: "2.0", method: "notifications/initialized" });

const list = await rpc(2, "tools/list", {});
const tools = list.result?.tools ?? [];
console.log("tools/list OK ->", tools.length, "tools");
if (tools.length < 40) fail("expected >=40 tools, got " + tools.length);
const names = tools.map((t) => t.name);
for (const need of ["verify_claim", "meta_analysis", "bio_safety_signal", "match_patient_to_trials"]) {
  if (!names.includes(need)) fail("missing tool " + need);
}
console.log("sample tools:", names.slice(0, 6).join(", "), "...");

const call = await rpc(3, "tools/call", {
  name: "meta_analysis",
  arguments: {
    claim: "Drug X reduces major cardiovascular events",
    studies: [
      { label: "Trial A", measure: "RR", point: 0.72, ci_lower: 0.60, ci_upper: 0.86 },
      { label: "Trial B", measure: "RR", point: 0.68, ci_lower: 0.51, ci_upper: 0.90 },
    ],
  },
});
const text = call.result?.content?.[0]?.text ?? "";
if (call.result?.isError) fail("meta_analysis returned isError: " + text.slice(0, 300));
if (!text || text.length < 20) fail("meta_analysis empty payload");
console.log("tools/call meta_analysis OK -> payload", text.length, "chars");
console.log("--- first 240 chars ---\n" + text.slice(0, 240));

console.log("\nSMOKE PASS");
child.kill();
process.exit(0);
