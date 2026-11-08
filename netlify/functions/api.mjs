// Netlify Function (v2) - ප්‍රතිඵල ගබඩා කිරීම සහ කියවීම
import { getStore } from "@netlify/blobs";
import children from "./children.json";

export const config = { path: "/api/*" };

const REGS = new Map(children.map((c) => [c.n, c]));
const VALUES = new Set(["P", "1", "2", "3"]); // P = සහභාගී වී ඇත
const GENDERS = new Set(["බාලක", "බාලිකා"]);

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// ඉසව් යතුර (blob key)
function hash16(s) {
  const b = new TextEncoder().encode(s);
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  for (const x of b) {
    h1 ^= x; h1 = Math.imul(h1, 16777619) >>> 0;
    h2 ^= x; h2 = Math.imul(h2, 0x85ebca6b) >>> 0; h2 ^= h2 >>> 13;
  }
  return h1.toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}
const keyOf = (a, t, e) => "ev-" + hash16(a + "|" + t + "|" + e);

// ළමයින් අතර ඉසව්ව සැබවින්ම තියෙනවාද?
const kidsOf = (a, t, e) => children.filter((c) => String(c.a) === String(a) && c.t === t && c.e.includes(e));

export default async (req) => {
  const judgePin = process.env.JUDGE_PIN;
  const adminPin = process.env.ADMIN_PIN;
  const judgesCanEdit = String(process.env.JUDGES_CAN_EDIT || "").toLowerCase() === "true";
  if (!judgePin || !adminPin) {
    return json({ error: "Netlify හි JUDGE_PIN සහ ADMIN_PIN සකසා නැත" }, 500);
  }

  const pin = req.headers.get("x-pin") || "";
  const role = pin === adminPin ? "admin" : pin === judgePin ? "judge" : null;
  if (!role) return json({ error: "PIN අංකය වැරදියි" }, 401);

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const store = getStore({ name: "results", consistency: "strong" });

  try {
    if (path === "login") return json({ role, judgesCanEdit });
    if (path === "data") return json(children);

    if (path === "event") {
      const q = url.searchParams;
      let body = null;
      if (req.method === "PUT") body = await req.json();
      const age = body ? body.age : q.get("age");
      const type = body ? body.type : q.get("type");
      const event = body ? body.event : q.get("event");
      const gender = body ? body.gender : q.get("gender");
      const kids = kidsOf(age, type, event);
      if (!age || !type || !event || !kids.length) return json({ error: "ඉසව්ව හඳුනාගත නොහැක" }, 400);
      const key = keyOf(age, type, event);
      const doc = (await store.get(key, { type: "json" })) || { entries: {}, saved: {} };
      doc.entries = doc.entries || {};
      doc.saved = doc.saved || {};

      if (req.method === "GET") {
        const g = gender || "";
        const locked = role !== "admin" && !judgesCanEdit && !!doc.saved[g];
        return json({ entries: doc.entries, saved: doc.saved, locked, updatedAt: doc.saved[g] || null });
      }

      if (!GENDERS.has(gender)) return json({ error: "බාලක / බාලිකා තෝරන්න" }, 400);
      const ofGender = new Set(kids.filter((c) => c.g === gender).map((c) => c.n));

      if (req.method === "PUT") {
        if (role !== "admin" && !judgesCanEdit && doc.saved[gender]) {
          return json({ error: "මෙය දැනටමත් සුරකා ඇත. වෙනස් කිරීමට ඇඩ්මින්ට පමණක් හැකිය" }, 403);
        }
        const incoming = body.entries && typeof body.entries === "object" ? body.entries : {};
        for (const [regStr, val] of Object.entries(incoming)) {
          const reg = Number(regStr);
          if (!ofGender.has(reg)) return json({ error: "වැරදි ලියාපදිංචි අංකයක්: " + regStr }, 400);
          if (val === null) delete doc.entries[reg];
          else if (VALUES.has(String(val))) doc.entries[reg] = String(val);
          else return json({ error: "වැරදි අගයක්" }, 400);
        }
        const now = new Date().toISOString();
        doc.saved[gender] = now;
        const saved = { label: { age: String(age), type, event }, entries: doc.entries, saved: doc.saved, updatedAt: now, by: role };
        await store.setJSON(key, saved);
        return json({ ok: true, updatedAt: now });
      }

      if (req.method === "DELETE") {
        if (role !== "admin") return json({ error: "ඇඩ්මින් සඳහා පමණි" }, 403);
        for (const reg of ofGender) delete doc.entries[reg];
        delete doc.saved[gender];
        if (!Object.keys(doc.saved).length && !Object.keys(doc.entries).length) {
          await store.delete(key);
        } else {
          await store.setJSON(key, { label: { age: String(age), type, event }, entries: doc.entries, saved: doc.saved, updatedAt: new Date().toISOString(), by: role });
        }
        return json({ ok: true });
      }
    }

    if (path === "all") {
      if (role !== "admin") return json({ error: "ඇඩ්මින් සඳහා පමණි" }, 403);
      const { blobs } = await store.list();
      const out = [];
      await Promise.all(
        blobs.map(async (b) => {
          const d = await store.get(b.key, { type: "json" });
          if (d && d.label) out.push(d);
        })
      );
      return json(out);
    }

    return json({ error: "හමු වුණේ නැහැ" }, 404);
  } catch (e) {
    return json({ error: "සේවාදායකයේ දෝෂයකි: " + (e && e.message ? e.message : e) }, 500);
  }
};
