import {describe,expect,it} from "vitest";
import {findModelAsset,MODEL_ASSETS} from "./asset-registry";

describe("3D asset registry",()=>{
  it("matches English and Persian aliases",()=>{
    expect(findModelAsset("show me planet Earth")?.id).toBe("earth");
    expect(findModelAsset("منظومه شمسی را نشان بده")?.id).toBe("solar-system");
    expect(findModelAsset("یک موتور جت نشان بده")?.id).toBe("jet-engine");
    expect(findModelAsset("یک موتر نشان بده")?.id).toBe("car-concept");
    expect(findModelAsset("show me a car")?.id).toBe("car-concept");
  });
  it("never returns the removed toy car",()=>expect(MODEL_ASSETS.some(asset=>asset.id==="toy-car"||asset.name==="Toy Car")).toBe(false));
  it("ships thirteen reliable offline models",()=>expect(MODEL_ASSETS.filter(asset=>asset.source==="procedural")).toHaveLength(13));
  it("matches the new useful offline models",()=>{
    expect(findModelAsset("لپ تاپ")?.id).toBe("laptop");
    expect(findModelAsset("پهپاد")?.id).toBe("drone");
    expect(findModelAsset("خانه هوشمند")?.id).toBe("smart-house");
    expect(findModelAsset("میکروسکوپ")?.id).toBe("microscope");
  });
  it("does not invent unavailable exact assets",()=>expect(findModelAsset("human cardiac anatomy")?.id).toBeUndefined());
  it("keeps provenance for every asset",()=>{
    for(const asset of MODEL_ASSETS){expect(asset.attribution).toBeTruthy();expect(asset.license).toBeTruthy()}
  });
});
