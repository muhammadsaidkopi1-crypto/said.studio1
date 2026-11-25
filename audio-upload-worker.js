// SAID STUDIO - Audio Upload Worker (Cloudflare Workers)
//
// Menerima 1 file audio dari tab "Audio Uploader", mengunggahnya ke Roblox lewat
// Open Cloud Assets API, lalu mengembalikan Asset ID.
//
// Secrets / variables yang harus diisi di Cloudflare (Settings > Variables):
//   ROBLOX_API_KEY  (Secret)  API key Open Cloud dengan izin asset:read dan asset:write
//   CREATOR_ID      (Text)    ID user atau ID group pemilik aset
//   CREATOR_TYPE    (Text)    "User" atau "Group"  (default: User)
//   ALLOWED_ORIGIN  (Text)    origin situs kamu, misal https://saidstudio.pages.dev
//                             (isi "*" hanya untuk uji coba)
//
// API key TIDAK PERNAH ditaruh di index.html. Ia hanya ada di Worker ini.

const MAX_BYTES = 20 * 1024 * 1024;
const MIME = { mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", flac: "audio/flac" };

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const allow = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": allow,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return json({ error: "Method tidak didukung." }, 405, cors);
    if (allow !== "*" && origin !== allow) return json({ error: "Origin tidak diizinkan." }, 403, cors);
    if (!env.ROBLOX_API_KEY || !env.CREATOR_ID) return json({ error: "Worker belum dikonfigurasi (ROBLOX_API_KEY / CREATOR_ID)." }, 500, cors);

    let form;
    try { form = await req.formData(); } catch { return json({ error: "Form tidak valid." }, 400, cors); }

    const file = form.get("file");
    const name = String(form.get("name") || "").trim().slice(0, 50) || "Audio";
    if (!file || typeof file === "string") return json({ error: "File tidak ditemukan." }, 400, cors);
    if (file.size > MAX_BYTES) return json({ error: "File lebih dari 20 MB." }, 413, cors);

    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!MIME[ext]) return json({ error: "Format harus MP3, OGG, WAV, atau FLAC." }, 415, cors);

    const creator = env.CREATOR_TYPE === "Group"
      ? { groupId: String(env.CREATOR_ID) }
      : { userId: String(env.CREATOR_ID) };

    const body = new FormData();
    body.append("request", JSON.stringify({
      assetType: "Audio",
      displayName: name,
      description: "Diunggah lewat SAID STUDIO",
      creationContext: { creator },
    }));
    body.append("fileContent", new Blob([await file.arrayBuffer()], { type: MIME[ext] }), file.name);

    const headers = { "x-api-key": env.ROBLOX_API_KEY };
    const r = await fetch("https://apis.roblox.com/assets/v1/assets", { method: "POST", headers, body });
    const op = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json({ error: op.message || ("Roblox menolak unggahan (" + r.status + ").") }, 502, cors);
    }

    // Unggahan Roblox berjalan sebagai operasi async: tunggu sampai selesai.
    const opId = String(op.path || "").split("/").pop();
    for (let i = 0; i < 20; i++) {
      await new Promise((ok) => setTimeout(ok, 1000));
      const pr = await fetch("https://apis.roblox.com/assets/v1/operations/" + opId, { headers });
      const pj = await pr.json().catch(() => ({}));
      if (pj.done) {
        if (pj.response && pj.response.assetId) {
          return json({ ok: true, assetId: String(pj.response.assetId) }, 200, cors);
        }
        const msg = pj.error && pj.error.message ? pj.error.message : "Roblox gagal memproses audio.";
        return json({ error: msg }, 502, cors);
      }
    }
    return json({ error: "Roblox masih memproses. Cek di Creator Hub, audio mungkin sudah masuk." }, 504, cors);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
