// Cloudflare Pages Functions: /api/claude
// Set GEMINI_API_KEY in the Pages project's environment variables (Settings → Variables and Secrets).
import { handle, CORS } from "../../lib/core.mjs";

export async function onRequest({ request, env }) {
  const body = request.method === "POST" ? await request.text() : "";
  // Cloudflare はリクエストの待ち時間に30秒の打ち切りがないので、長い生成も待てるよう50秒にする。
  const r = await handle(request.method, body, env, 50000);
  return new Response(r.body || null, { status: r.status, headers: CORS });
}
