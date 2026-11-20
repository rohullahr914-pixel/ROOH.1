import asyncio, hashlib, hmac, ipaddress, json, secrets, sqlite3, time
from pathlib import Path
from urllib.parse import urlparse
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from .config import get_settings
router=APIRouter(prefix='/api/whatsapp'); sessions={}; limits={}; lock=asyncio.Lock()
LOCAL_COOKIE='rooh_wa_owner'
LOCAL_SESSION_SECONDS=8*60*60

def loopback(host):
    if host=='localhost':return True
    try:return ipaddress.ip_address(host or '').is_loopback
    except ValueError:return False

def local_origin(origin):
    try:
        parsed=urlparse(origin)
        return parsed.scheme in ('http','https') and loopback(parsed.hostname) and parsed.username is None and parsed.password is None
    except (TypeError,ValueError):return False

def local_cookie_valid(value,secret):
    try:
        if len(value)>256:return False
        payload,signature=value.rsplit('.',1)
        issued=int(payload.rsplit('.',1)[1])
        expected=hmac.new(secret.encode(),('whatsapp-local:'+payload).encode(),hashlib.sha256).hexdigest()
        return 0<=time.time()-issued<LOCAL_SESSION_SECONDS and hmac.compare_digest(signature,expected)
    except (ValueError,AttributeError):return False

def require_local_browser(request):
    origin=request.headers.get('origin','')
    if (not request.client or not loopback(request.client.host)
        or not loopback(request.url.hostname)
        or not local_origin(origin)):
        raise HTTPException(403,'Automatic WhatsApp access is available only from ROOH on this computer.')

@router.post('/local-session')
async def local_session(request:Request,response:Response):
    require_local_browser(request)
    if request.headers.get('x-rooh-local')!='1':raise HTTPException(403,'Open WhatsApp from ROOH.')
    secret=get_settings().whatsapp_owner_token or ''
    if len(secret)<32:raise HTTPException(503,'Local WhatsApp access is not configured. Restart ROOH after setup.')
    payload=secrets.token_urlsafe(24)+'.'+str(int(time.time()))
    signature=hmac.new(secret.encode(),('whatsapp-local:'+payload).encode(),hashlib.sha256).hexdigest()
    response.set_cookie(LOCAL_COOKIE,payload+'.'+signature,max_age=LOCAL_SESSION_SECONDS,
                        httponly=True,samesite='strict',secure=request.url.scheme=='https',path='/api/whatsapp')
    response.headers['Cache-Control']='no-store'
    return {'ready':True}
def db():
    path=Path('.rooh-private');path.mkdir(mode=0o700,exist_ok=True)
    con=sqlite3.connect(path/'whatsapp.sqlite');con.row_factory=sqlite3.Row
    con.executescript('CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY,name TEXT,phone TEXT UNIQUE); CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY,owner TEXT,session TEXT,recipient TEXT,phone TEXT,message TEXT,state TEXT,expires REAL,token TEXT,result TEXT);')
    return con
async def owner(request:Request):
    s=get_settings();expected=s.whatsapp_owner_token or ''; supplied=request.headers.get('authorization','').removeprefix('Bearer ')
    if len(expected)<32:raise HTTPException(503,'Local WhatsApp access is not configured.')
    if not hmac.compare_digest(expected,supplied):
        if not local_cookie_valid(request.cookies.get(LOCAL_COOKIE,''),expected):
            raise HTTPException(401,'Open WhatsApp again to restore the local connection.')
        require_local_browser(request)
    if request.headers.get('origin') and not local_origin(request.headers['origin']):raise HTTPException(403,'Origin denied')
    key=hashlib.sha256(expected.encode()).hexdigest();now=time.time();start,count=limits.get(key,(now,0))
    if now-start>60:start,count=now,0
    if count>=180:raise HTTPException(429,'Too many requests')
    limits[key]=(start,count+1);return key
async def bridge(path,body=None):
    s=get_settings()
    if not s.whatsapp_bridge_secret:raise HTTPException(503,'Bridge secret is missing')
    try:
        async with httpx.AsyncClient(timeout=30, trust_env=False) as c:
            url=f'http://127.0.0.1:{s.whatsapp_bridge_port}/{path}';headers={'Authorization':f'Bearer {s.whatsapp_bridge_secret}'}
            r=await c.get(url,headers=headers) if body is None else await c.post(url,headers=headers,json=body)
            if r.status_code in (401,403):
                raise HTTPException(503,'WhatsApp bridge authentication failed. Restart ROOH so both services load the same local secret.')
            if r.status_code==409:
                raise HTTPException(409,'WhatsApp is not connected yet. Connect and scan the QR first.')
            if r.status_code==429:
                raise HTTPException(429,'Too many WhatsApp requests. Wait a minute before trying again.')
            if r.status_code>=400:
                raise HTTPException(503,'WhatsApp bridge could not complete the request. Check its connection status and reconnect.')
            return r.json()
    except httpx.TimeoutException:
        raise HTTPException(504,'WhatsApp bridge timed out. Check the connection status before trying again.')
    except httpx.HTTPError:
        raise HTTPException(503,'WhatsApp bridge is not running or could not be reached. Restart ROOH with npm run dev.')
class Contact(BaseModel):
    name:str=Field(min_length=1,max_length=80)
    phone:str=Field(pattern=r'^\+[1-9]\d{7,14}$')
class Draft(BaseModel):
    recipient:str=Field(min_length=1,max_length=80)
    message:str=Field(min_length=1,max_length=4000)
    session:str
class Confirmation(BaseModel):
    session:str
    token:str
    approval:str

def active(user,session):
    if sessions.get(user)!=session:raise HTTPException(409,'Session changed. Prepare another draft')
def row(con,id,user,c):
    active(user,c.session);r=con.execute('SELECT * FROM drafts WHERE id=? AND owner=? AND session=?',(id,user,c.session)).fetchone()
    if not r:raise HTTPException(404,'Draft missing')
    if r['expires']<time.time():
        if r['state'] in ('DRAFT_PREPARED','AWAITING_CONFIRMATION'):con.execute("UPDATE drafts SET state='EXPIRED',token='' WHERE id=?",(id,));con.commit()
        raise HTTPException(409,'Draft expired')
    if not hmac.compare_digest(r['token'],hashlib.sha256(c.token.encode()).hexdigest()):raise HTTPException(409,'Token consumed or invalid')
    return r
@router.post('/session')
async def session(user=Depends(owner)):
    sid=secrets.token_hex(16);sessions[user]=sid
    with db() as con:con.execute("UPDATE drafts SET state='CANCELLED',token='' WHERE owner=? AND state IN ('DRAFT_PREPARED','AWAITING_CONFIRMATION')",(user,))
    return {'session':sid}
@router.get('/status')
async def status(user=Depends(owner)):return await bridge('status')
@router.post('/connect')
async def connect(user=Depends(owner)):return await bridge('connect',{})
@router.post('/cancel')
async def cancel(user=Depends(owner)):
    with db() as con:con.execute("UPDATE drafts SET state='CANCELLED',token='' WHERE owner=? AND state IN ('DRAFT_PREPARED','AWAITING_CONFIRMATION')",(user,))
    return {'cancelled':True}
@router.post('/disconnect')
async def disconnect(user=Depends(owner)):
    await cancel(user);return await bridge('disconnect',{})
@router.get('/contacts')
async def contacts(user=Depends(owner)):
    with db() as con:return [dict(r) for r in con.execute('SELECT * FROM contacts')]
@router.post('/contacts')
async def add_contact(c:Contact,user=Depends(owner)):
    if not c.name.strip():raise HTTPException(400,'Name required')
    if not (await bridge('validate',{'phone':c.phone}))['valid']:raise HTTPException(400,'Not a registered WhatsApp number')
    with db() as con:
        try:con.execute('INSERT INTO contacts VALUES(?,?,?)',(secrets.token_hex(16),c.name.strip(),c.phone))
        except sqlite3.IntegrityError:raise HTTPException(409,'Contact already exists')
    return {'approved':True}
@router.post('/drafts')
async def prepare(d:Draft,user=Depends(owner)):
    active(user,d.session)
    if not d.message.strip():raise HTTPException(400,'Message required')
    if (await bridge('status'))['state']!='CONNECTED':raise HTTPException(409,'Connect first')
    with db() as con:
        matches=[r for r in con.execute('SELECT * FROM contacts') if r['name'].casefold()==d.recipient.strip().casefold() or r['phone']==d.recipient]
        if len(matches)!=1:return {'prepared':False,'clarification':'Choose an approved contact by exact name or number','matches':[{'name':r['name'],'phone':r['phone']} for r in matches]}
        c=matches[0];id=secrets.token_hex(16);token=secrets.token_urlsafe(32);expires=time.time()+60
        con.execute("UPDATE drafts SET state='CANCELLED',token='' WHERE owner=? AND state IN ('DRAFT_PREPARED','AWAITING_CONFIRMATION')",(user,))
        con.execute('INSERT INTO drafts VALUES(?,?,?,?,?,?,?,?,?,?)',(id,user,d.session,c['name'],c['phone'],d.message,'DRAFT_PREPARED',expires,hashlib.sha256(token.encode()).hexdigest(),None))
    return {'prepared':True,'id':id,'recipient':c['name'],'phone':c['phone'],'message':d.message,'expires':expires,'confirmation_token':token}
@router.post('/drafts/{id}/arm')
async def arm(id:str,c:Confirmation,user=Depends(owner)):
    with db() as con:
        r=row(con,id,user,c)
        if r['state']!='DRAFT_PREPARED':raise HTTPException(409,'Draft cannot be armed')
        con.execute("UPDATE drafts SET state='AWAITING_CONFIRMATION' WHERE id=?",(id,))
    return {'awaiting_confirmation':True}
@router.post('/drafts/{id}/confirm')
async def confirm(id:str,c:Confirmation,user=Depends(owner)):
    async with lock:
        with db() as con:
            r=row(con,id,user,c)
            if r['state']!='AWAITING_CONFIRMATION':raise HTTPException(409,'Not awaiting confirmation')
            if c.approval.strip().casefold().rstrip('.!?؟') not in ('yes, send it','yes send it','بله ارسال کن','بفرست'):raise HTTPException(400,'Explicit approval required')
            con.execute("UPDATE drafts SET state='CONFIRMED',token='' WHERE id=?",(id,));con.commit()
            con.execute("UPDATE drafts SET state='SENDING' WHERE id=?",(id,));con.commit()
        try:result=await bridge('send',{'id':id,'phone':r['phone'],'message':r['message']})
        except HTTPException:result={'status':'UNCERTAIN','detail':'Check WhatsApp before creating another draft. No retry performed.'}
        with db() as con:con.execute("UPDATE drafts SET state=?,result=? WHERE id=?",("FAILED" if result.get("status")=="FAILED" else "RESULT",json.dumps(result),id))
        return result
@router.get('/events')
async def events(request:Request,user=Depends(owner)):
    async def stream():
        s=get_settings()
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(45, connect=5), trust_env=False) as c:
                async with c.stream('GET',f'http://127.0.0.1:{s.whatsapp_bridge_port}/events',headers={'Authorization':f'Bearer {s.whatsapp_bridge_secret}'}) as r:
                    if r.status_code!=200:yield 'event: failure\ndata: {}\n\n';return
                    async for line in r.aiter_lines():
                        if await request.is_disconnected():break
                        yield line+'\n'
        except httpx.HTTPError:yield 'event: failure\ndata: {}\n\n'
    return StreamingResponse(stream(),media_type='text/event-stream',headers={'Cache-Control':'no-store','X-Accel-Buffering':'no'})

@router.get('/drafts/{id}')
async def result(id:str,user=Depends(owner)):
    with db() as con:
        r=con.execute('SELECT id,state,expires,result FROM drafts WHERE id=? AND owner=?',(id,user)).fetchone()
        if not r:raise HTTPException(404,'Draft missing')
        data=dict(r)
        if data['state'] in ('DRAFT_PREPARED','AWAITING_CONFIRMATION') and data['expires']<time.time():data['state']='EXPIRED'
        if data['state']=='SENDING':data['result']={'status':'UNCERTAIN'}
        elif data['result']:data['result']=json.loads(data['result'])
        return data

@router.post('/contacts/{id}/remove')
async def remove_contact(id:str,user=Depends(owner)):
    with db() as con:
        r=con.execute('SELECT phone FROM contacts WHERE id=?',(id,)).fetchone()
        if not r:raise HTTPException(404,'Contact missing')
        con.execute('DELETE FROM contacts WHERE id=?',(id,))
        con.execute("UPDATE drafts SET state='CANCELLED',token='' WHERE phone=? AND state IN ('DRAFT_PREPARED','AWAITING_CONFIRMATION')",(r['phone'],))
    return {'removed':True}

@router.get('/directory')
async def directory(user=Depends(owner)):return await bridge('contacts')

@router.get('/chats')
async def chats(user=Depends(owner)):return await bridge('chats')

@router.get('/messages')
async def messages(chat:str,user=Depends(owner)):
    import re
    if not re.fullmatch(r'\d+@c\.us',chat):raise HTTPException(400,'Invalid chat')
    return await bridge('messages?chat='+chat)
