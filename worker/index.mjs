// Cloudflare Workers（静的ファイル＋/api/claude）。設定は wrangler.jsonc。
// 画面（public/）はそのまま配信し、/api/claude だけここで処理する。
// GEMINI_API_KEY は Worker の Settings → Variables and Secrets に Secret で入れる。
import { handle, CORS } from "../lib/core.mjs";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/claude") {
      const body = request.method === "POST" ? await request.text() : "";
      // Workers は待ち時間に30秒の打ち切りがないので、長い生成も待てるよう50秒にする。
      const r = await handle(request.method, body, env, 50000);
      return new Response(r.body || null, { status: r.status, headers: CORS });
    }
    return env.ASSETS.fetch(request);
  },
};
