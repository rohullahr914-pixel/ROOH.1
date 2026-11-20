import { createV0Client, fetchPreview } from "v0";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cache = new Map<string, {url:string;token:string;expiresAt:Date}>();

function serverKey() {
  if (process.env.V0_API_KEY) return process.env.V0_API_KEY;
  try {
    const env = readFileSync(resolve(process.cwd(), "../../.env"), "utf8");
    return env.match(/^V0_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  } catch { return undefined; }
}

async function handler(request:Request, {params}:{params:{chatId:string;path?:string[]}}) {
  const chatId=params.chatId;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(chatId)) return new Response("Invalid chat ID",{status:400});
  if (params.path?.[0]==="loading") return new Response(`<html><meta http-equiv="refresh" content="3;url=/api/v0-preview/${chatId}/"><body>Preparing website preview…</body></html>`,{headers:{"Content-Type":"text/html"}});
  const key=serverKey();
  if (!key) return new Response("V0_API_KEY is not configured",{status:503});
  try {
    const ownership=await fetch(`${process.env.ROOH_API_INTERNAL_URL||"http://localhost:8000"}/api/website/projects/${chatId}`,{cache:"no-store"});
    if (!ownership.ok) return new Response("Website project not found",{status:404});
    let preview=cache.get(chatId);
    if (!preview || new Date(preview.expiresAt).getTime()-Date.now()<60_000) {
      const result=await createV0Client({auth:key}).chats.getPreview({chatId});
      preview=result.data ?? undefined;
      if (preview) cache.set(chatId,preview); else cache.delete(chatId);
    }
    return fetchPreview({request,preview:preview??null,path:params.path??[],fallbackUrl:`/api/v0-preview/${chatId}/loading`,onPreviewRefresh:()=>{cache.delete(chatId)}});
  } catch (error) {
    return new Response(error instanceof Error?error.message:"Preview unavailable",{status:502});
  }
}
export {handler as GET,handler as POST};
