// Parse `hc machine ls --json`. Real output with no machines: {"machines":[]}.
// Entry fields are not observable on this host, so be tolerant of name/online/agents spellings.

/** @returns {{name:string, online:boolean, agents:number}[]} */
export function parseMachines(stdout, code) {
  if (code !== 0 || !String(stdout ?? "").trim()) return [];
  let j;
  try { j = JSON.parse(stdout); } catch { return []; }
  const list = Array.isArray(j) ? j : Array.isArray(j?.machines) ? j.machines : [];
  return list.filter((m) => m && typeof m === "object").map((m) => {
    const name = String(m.name ?? m.host ?? m.alias ?? "");
    const st = String(m.status ?? m.state ?? "").toLowerCase();
    const online = typeof m.online === "boolean" ? m.online
      : typeof m.connected === "boolean" ? m.connected
      : st ? ["online", "connected", "ok", "up", "ready"].includes(st) : false;
    const a = m.agents ?? m.terminals ?? m.agent_count ?? 0;
    return { name, online, agents: Array.isArray(a) ? a.length : Number(a) || 0 };
  }).filter((m) => m.name);
}
