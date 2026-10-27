// Netlify Functions: /.netlify/functions/claude（netlify.toml で /api/claude から転送）
import { handle, CORS } from "../../lib/core.mjs";

export const handler = async (event) => {
  const r = await handle(event.httpMethod, event.body, process.env, 25000);
  return { statusCode: r.status, headers: CORS, body: r.body };
};
