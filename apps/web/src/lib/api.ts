const BASE=process.env.NEXT_PUBLIC_API_URL||"http://localhost:8000";
async function get<T>(path:string):Promise<T>{const r=await fetch(`${BASE}${path}`);if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.detail||`Request failed (${r.status})`)}return r.json()}
import { multiSourceModelSearch } from "./multi-source-models";
export const api={
	base: BASE,
	youtube: (q: string) => get<{ items: import("./types").YouTubeItem[] }>(`/api/youtube/search?q=${encodeURIComponent(q)}`),
	models: async (q: string) => {
		const items = await multiSourceModelSearch(q);
		return { items };
	},
	profile: (q: string, lang = "en") => get<import("./types").Profile>(`/api/knowledge/profile?q=${encodeURIComponent(q)}&lang=${lang}`)
};
