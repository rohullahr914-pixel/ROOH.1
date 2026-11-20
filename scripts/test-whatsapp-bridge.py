"""Real local bridge smoke test. Never authenticates or sends. Uses temporary credentials."""
import json, os, secrets, subprocess, tempfile, time, urllib.request, urllib.error
from pathlib import Path
root=Path(__file__).resolve().parents[1]
secret=secrets.token_hex(32)
with tempfile.TemporaryDirectory(prefix="rooh-wa-smoke-",ignore_cleanup_errors=True) as data:
    env={**os.environ,"WHATSAPP_BRIDGE_SECRET":secret,"WHATSAPP_BRIDGE_PORT":"3019","WHATSAPP_DATA_DIR":data}
    flags={"creationflags":subprocess.CREATE_NO_WINDOW} if os.name=="nt" else {}
    proc=subprocess.Popen(["node","server.mjs"],cwd=root/"apps/whatsapp-bridge",env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,**flags)
    def call(path,body=None,auth=True):
        req=urllib.request.Request("http://127.0.0.1:3019/"+path,data=json.dumps(body).encode() if body is not None else None,headers={"Authorization":"Bearer "+secret if auth else "", "Content-Type":"application/json"})
        with urllib.request.urlopen(req,timeout=5) as r:return json.load(r),r.headers
    try:
        for _ in range(30):
            if proc.poll() is not None:raise RuntimeError("Bridge exited: "+proc.stderr.read().decode()[-1000:])
            try:state,headers=call("status");break
            except OSError:time.sleep(.5)
        else:raise RuntimeError("Bridge startup timeout")
        assert state["state"]=="DISCONNECTED" and headers.get("Cache-Control")=="no-store"
        print("PASS: bridge startup and no-store",flush=True)
        try:call("status",auth=False);raise AssertionError("Unauthenticated request accepted")
        except urllib.error.HTTPError as e:assert e.code==401
        print("PASS: unauthorized request rejected",flush=True)
        call("connect",{})
        seen=set();first=None;qr_count=0;deadline=time.time()+90
        while time.time()<deadline:
            state,_=call("status");seen.add(state["state"])
            if state.get("qr"):
                assert state["qr"].startswith("data:image/png;base64,")
                if first is None:first=state['qr'];qr_count=1;print("PASS: real QR generated (not logged)",flush=True)
                elif state['qr']!=first:qr_count=2;print("PASS: real QR refreshed",flush=True);break
            if state["state"]=="ERROR":raise RuntimeError(state["error"])
            time.sleep(1)
        print("Observed states:",sorted(seen),flush=True)
        if not first:raise RuntimeError("No real QR within 90 seconds; network may block WhatsApp Web")
        if qr_count<2:print("UNVERIFIED: real QR refresh not observed within timeout",flush=True)
        print("Phone linking, session restoration and message receipt require manual testing.",flush=True)
    finally:
        if proc.poll() is None:
            if os.name=="nt":subprocess.run(["taskkill","/PID",str(proc.pid),"/T","/F"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,**flags)
            else:proc.terminate()
            proc.wait(timeout=10)
