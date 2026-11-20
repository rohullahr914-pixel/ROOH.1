"""Download the curated RooH gallery; retain upstream notices and validate each GLB."""
import concurrent.futures, hashlib, json, re, struct, time, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "apps/web/public/models"
BASE = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/"

def get(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url.replace("https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/", "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@"), timeout=60) as response:
                return response.read()
        except Exception:
            if attempt == 2: raise
            time.sleep(1 + attempt)

def download(item):
    folder = DEST / item["id"]
    folder.mkdir(parents=True, exist_ok=True)
    base = BASE + item["revision"] + "/Models/" + item["upstream"] + "/"
    glb_path = folder / "model.glb"
    if not glb_path.exists(): glb_path.write_bytes(get(base + "glTF-Binary/" + item["upstream"] + ".glb"))
    data = glb_path.read_bytes()
    magic, version, length = struct.unpack_from("<4sII", data)
    assert magic == b"glTF" and version == 2 and length == len(data), item["id"]
    json_size, kind = struct.unpack_from("<II", data, 12)
    document = json.loads(data[20:20+json_size])
    assert document.get("meshes"), item["id"]
    for resource in document.get("buffers", []) + document.get("images", []):
        assert "uri" not in resource or resource["uri"].startswith("data:"), "External resource: " + item["id"]
    notice_path = folder / "SOURCE.md"
    if not notice_path.exists(): notice_path.write_bytes(get(base + "README.md"))
    notice = notice_path.read_text(encoding="utf-8")
    legal = notice.split("## Legal")[-1]
    assert "creativecommons.org" in legal, item["id"]
    licenses = re.findall(r"\[([^\]]+)\]\(([^)]+)\)", legal)
    item["license"] = "; ".join(dict.fromkeys(label for label, url in licenses))
    item["attribution"] = "Khronos glTF Sample Assets / " + "; ".join(re.findall(r" - (.+)", legal))
    for label, url in licenses:
        if url.startswith("../../LICENSES/"):
            target = folder / url.split("/")[-1]
            if not target.exists(): target.write_bytes(get(BASE + item["revision"] + "/LICENSES/" + target.name))
    shot = folder / ("preview" + Path(item["screenshot"]).suffix)
    if not shot.exists(): shot.write_bytes(get(base + item["screenshot"]))
    item.update(url="/models/"+item["id"]+"/model.glb", thumbnail="/models/"+item["id"]+"/"+shot.name,
        source="khronos", sourceUrl="https://github.com/KhronosGroup/glTF-Sample-Assets/tree/"+item["revision"]+"/Models/"+item["upstream"],
        bytes=len(data), sha256=hashlib.sha256(data).hexdigest(), animated=bool(document.get("animations")))
    print(item["id"], len(data), "verified", flush=True)
    return item

if __name__ == "__main__":
    manifest = ROOT / "apps/web/src/lib/downloaded-models.json"
    items = json.loads(manifest.read_text(encoding="utf-8"))
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        results = list(executor.map(download, items))
    manifest.write_text(json.dumps(results, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print("Downloaded", len(results), "models;", round(sum(x["bytes"] for x in results)/1048576,1), "MiB")
