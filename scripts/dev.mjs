import {spawn,spawnSync} from "node:child_process";
import {parseEnv} from "node:util";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
try { require.resolve("whatsapp-web.js"); require.resolve("express"); require.resolve("qrcode"); }
catch { console.error("WhatsApp dependencies missing. Run npm install at the repository root."); process.exit(1); }
const pythonCheck=spawnSync("python",["-c","import uvicorn, fastapi, httpx, pydantic_settings"],{stdio:"ignore"});
if(pythonCheck.status!==0){console.error("Python API dependencies missing. Run python -m pip install -r apps/api/requirements.txt");process.exit(1)}

// Keep every service attached to the terminal that launched `npm run dev`.
// `detached` creates the separate Node/Python console windows seen on Windows.
const serviceOptions={windowsHide:true,detached:false};
const bridgeChild=spawn(process.execPath,["--env-file=../../.env","server.mjs","--prewarm"],{...serviceOptions,cwd:new URL("../apps/whatsapp-bridge/",import.meta.url),stdio:["ignore","inherit","inherit","ipc"]});
const rootEnv=parseEnv(readFileSync(new URL("../.env",import.meta.url),"utf8"));
const webEnv={...process.env,NEXT_PUBLIC_COMPRESSED_VOICE:process.env.NEXT_PUBLIC_COMPRESSED_VOICE??rootEnv.NEXT_PUBLIC_COMPRESSED_VOICE??"false"};
const children=[
  bridgeChild,
  spawn(process.execPath,[require.resolve("next/dist/bin/next"),"dev"],{...serviceOptions,cwd:new URL("../apps/web/",import.meta.url),env:webEnv,stdio:"inherit"}),
  spawn("python",["-m","uvicorn","app.main:app","--reload","--reload-dir","apps/api","--port","8000","--app-dir","apps/api"],{...serviceOptions,stdio:"inherit"}),
];

let closing=false;
async function close(code=0){
  if(closing)return;
  closing=true;
  if(bridgeChild.connected){
    bridgeChild.send({type:"shutdown"},()=>{});
    await Promise.race([new Promise(resolve=>bridgeChild.once("exit",resolve)),new Promise(resolve=>setTimeout(resolve,4000))]);
  }
  for(const child of children){
    if(child.killed||child.exitCode!==null)continue;
    if(process.platform==="win32")spawnSync("taskkill",["/pid",String(child.pid),"/t","/f"],{stdio:"ignore"});
    else child.kill("SIGTERM");
  }
  setTimeout(()=>process.exit(code),250);
}
for(const [index,child] of children.entries()){
  child.on("error",error=>{console.error(error);close(1)});
  child.on("exit",code=>{if(!closing){console.error(`${["WhatsApp bridge","Next.js","FastAPI"][index]} stopped (exit ${code}). Restart ROOH to restore all services.`);close(code||1)}});
}
process.on("SIGINT",()=>close());
process.on("SIGTERM",()=>close());
