   // Multi-Source 3D Model Search for ROOH
// منابع: Sketchfab, Khronos, Poly Haven, Smithsonian, Wikimedia
// این ماژول abstraction جستجو و دریافت مدل سه‌بعدی از منابع مختلف را فراهم می‌کند.

import { ModelItem } from "./types";

export type ModelSource = "sketchfab" | "khronos" | "polyhaven" | "smithsonian" | "wikimedia";

export interface ModelSearchResult extends Omit<ModelItem,"source"> {
  source: ModelSource;
  asset_url?: string;
  viewer_url?: string;
  license?: string;
  thumbnail?: string;
  author: string;
}

const API_BASE=process.env.NEXT_PUBLIC_API_URL||"http://localhost:8000";

// The backend searches licensed Sketchfab embeds when configured and falls
// back to the reliable Khronos registry. Keeping this behind one endpoint
// avoids advertising browser routes that do not exist.
async function searchBackend(query: string): Promise<ModelSearchResult[]> {
  try {
    const res = await fetch(`${API_BASE}/api/models/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error("Model search API error");
    const data = await res.json();
    return (data.items || []).map((item: any):ModelSearchResult => ({
      uid: item.uid,
      name: item.name,
      author: item.author || "Model contributor",
      thumbnail: item.thumbnail,
      viewer_url: item.viewer_url,
      license: item.license,
      source: item.source==="sketchfab"?"sketchfab":"khronos",
      asset_url: item.asset_url,
    }));
  } catch {
    return [];
  }
}

// --- Khronos (local registry) ---
import { findModelAsset } from "./asset-registry";
function searchKhronos(query: string): ModelSearchResult[] {
  const asset = findModelAsset(query);
  if (!asset) return [];
  return [{
    uid: asset.id,
    name: asset.nameFa||asset.name,
    author: asset.attribution,
    license: asset.license,
    asset_url: asset.url,
    source: "khronos",
    thumbnail: asset.thumbnail,
  }];
}

// --- Multi-Source Search ---
export async function multiSourceModelSearch(query: string): Promise<ModelSearchResult[]> {
  const local=searchKhronos(query);
  if(local.length)return local;
  return searchBackend(query);
}

// اگر هیچ نتیجه‌ای نبود، نزدیک‌ترین مدل Khronos را برگردان (در صورت وجود)
export async function findClosestModel(query: string): Promise<ModelSearchResult | undefined> {
  const results=await searchBackend(query);
  return results[0];
}
