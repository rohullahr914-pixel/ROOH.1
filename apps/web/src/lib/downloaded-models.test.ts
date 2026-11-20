import {describe,expect,it} from "vitest";
import {readFileSync,existsSync} from "node:fs";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {DOWNLOADED_MODELS,MODEL_CATALOG,findModelAsset} from "./asset-registry";
import {executeTool} from "./tool-executor";
import {useRooH} from "./store";

describe("downloaded 3D gallery",()=>{
  it("contains twenty distinct locally served models with previews and attribution",()=>{
    expect(MODEL_CATALOG).toHaveLength(20);
    expect(DOWNLOADED_MODELS.length).toBeGreaterThanOrEqual(14);
    expect(new Set(MODEL_CATALOG.map(x=>x.id)).size).toBe(20);
    for(const model of DOWNLOADED_MODELS){
      expect(model.url).toMatch(/^\/models\//);
      expect(model.nameFa).toBeTruthy();expect(model.license).toBeTruthy();expect(model.attribution).toBeTruthy();
      expect(existsSync(resolve("public",model.thumbnail!.slice(1)))).toBe(true);
      expect(existsSync(resolve("public",`models/${model.id}/SOURCE.md`))).toBe(true);
      const bytes=readFileSync(resolve("public",model.url!.slice(1)));
      expect(bytes.toString("ascii",0,4)).toBe("glTF");
      expect(bytes.readUInt32LE(8)).toBe(bytes.length);
      expect(bytes.length).toBe(model.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(model.sha256);
      const document=JSON.parse(bytes.toString("utf8",20,20+bytes.readUInt32LE(12)));
      expect(document.meshes.length).toBeGreaterThan(0);
      for(const resource of [...document.buffers||[],...document.images||[]]){
        expect(!resource.uri||resource.uri.startsWith("data:")).toBe(true);
      }
      expect(findModelAsset(model.id)?.id).toBe(model.id);
      expect(findModelAsset(model.nameFa!)?.id).toBe(model.id);
    }
  });
  it("opens every downloaded model through the voice tool without a backend search",async()=>{
    for(const model of DOWNLOADED_MODELS){
      useRooH.getState().clear();
      await executeTool("load_3d_model",{asset_id:model.id});
      expect(useRooH.getState().objects.at(-1)).toMatchObject({assetId:model.id,assetUrl:model.url});
    }
    useRooH.getState().clear();
  });
  it("opens the gallery when the user requests the available models",async()=>{
    await executeTool("list_3d_models",{});
    expect(useRooH.getState().panels.some(p=>p.kind==="models")).toBe(true);
    useRooH.getState().clear();
  });
});
