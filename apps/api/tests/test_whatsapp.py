import time
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app import whatsapp as wa
from app.config import Settings

@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(wa,'get_settings',lambda:Settings(whatsapp_owner_token='o'*32,whatsapp_bridge_secret='s'*32))
    wa.sessions.clear();wa.limits.clear()
    sent=[]
    async def bridge(path,body=None):
        if path=='status':return {'state':'CONNECTED'}
        if path=='validate':return {'valid':True}
        if path=='send':sent.append(body);return {'status':'SENT'}
        return {'accepted':True}
    monkeypatch.setattr(wa,'bridge',bridge)
    c=TestClient(app);h={'Authorization':'Bearer '+'o'*32}
    sid=c.post('/api/whatsapp/session',headers=h).json()['session']
    assert c.post('/api/whatsapp/contacts',headers=h,json={'name':'Ahmad','phone':'+14155552671'}).status_code==200
    return c,h,sid,sent

def make(c,h,sid):
    return c.post('/api/whatsapp/drafts',headers=h,json={'session':sid,'recipient':'Ahmad','message':"I'll arrive at 6 PM"}).json()
def payload(d,sid):return {'session':sid,'token':d['confirmation_token'],'approval':'yes, send it'}
def test_auth_and_validation(setup):
    c,h,sid,sent=setup
    assert c.get('/api/whatsapp/status').status_code==401
    assert c.get('/api/whatsapp/status',headers={**h,'Origin':'https://evil.example'}).status_code==403
    assert c.get('/api/whatsapp/status',headers=h).headers['cache-control']=='no-store'
    assert c.post('/api/whatsapp/contacts',headers=h,json={'name':'X','phone':'123'}).status_code==422
    assert c.post('/api/whatsapp/drafts',headers=h,json={'session':sid,'recipient':'Unknown','message':'hi'}).json()['prepared'] is False

def test_confirm_once_exact_message(setup):
    c,h,sid,sent=setup;d=make(c,h,sid);p=payload(d,sid);url='/api/whatsapp/drafts/'+d['id']
    assert c.post(url+'/confirm',headers=h,json=p).status_code==409
    assert c.post(url+'/arm',headers=h,json=p).status_code==200
    assert c.post(url+'/confirm',headers=h,json={**p,'approval':'maybe'}).status_code==400
    assert c.post(url+'/confirm',headers=h,json=p).json()['status']=='SENT'
    assert c.post(url+'/confirm',headers=h,json=p).status_code==409
    assert len(sent)==1 and sent[0]['message']=="I'll arrive at 6 PM"

def test_cancel_expire_and_session(setup):
    c,h,sid,sent=setup
    d=make(c,h,sid);p=payload(d,sid);c.post('/api/whatsapp/cancel',headers=h,json={})
    assert c.post('/api/whatsapp/drafts/'+d['id']+'/arm',headers=h,json=p).status_code==409
    d=make(c,h,sid)
    with wa.db() as con:con.execute('UPDATE drafts SET expires=? WHERE id=?',(time.time()-1,d['id']))
    assert c.post('/api/whatsapp/drafts/'+d['id']+'/arm',headers=h,json=payload(d,sid)).status_code==409
    d=make(c,h,sid);c.post('/api/whatsapp/session',headers=h,json={})
    assert c.post('/api/whatsapp/drafts/'+d['id']+'/arm',headers=h,json=payload(d,sid)).status_code==409
    assert not sent

def test_uncertain_never_retried(setup,monkeypatch):
    c,h,sid,sent=setup;d=make(c,h,sid);p=payload(d,sid);url='/api/whatsapp/drafts/'+d['id'];c.post(url+'/arm',headers=h,json=p)
    from fastapi import HTTPException
    async def failed(*args,**kwargs):raise HTTPException(503,'timeout')
    monkeypatch.setattr(wa,'bridge',failed)
    assert c.post(url+'/confirm',headers=h,json=p).json()['status']=='UNCERTAIN'
    assert c.post(url+'/confirm',headers=h,json=p).status_code==409

def test_ambiguous_contacts_and_revocation(setup):
    c,h,sid,sent=setup
    c.post('/api/whatsapp/contacts',headers=h,json={'name':'Ahmad','phone':'+442079460018'})
    ambiguous=make(c,h,sid)
    assert ambiguous['prepared'] is False and len(ambiguous['matches'])==2
    d=c.post('/api/whatsapp/drafts',headers=h,json={'session':sid,'recipient':'+14155552671','message':'Approved exact text'}).json()
    contact=c.get('/api/whatsapp/contacts',headers=h).json()[0]
    c.post('/api/whatsapp/contacts/'+contact['id']+'/remove',headers=h,json={})
    assert c.post('/api/whatsapp/drafts/'+d['id']+'/arm',headers=h,json=payload(d,sid)).status_code==409
    assert not sent

def test_disconnection_rejects_preparation(setup,monkeypatch):
    c,h,sid,sent=setup
    async def disconnected(*args,**kwargs):return {'state':'DISCONNECTED'}
    monkeypatch.setattr(wa,'bridge',disconnected)
    r=c.post('/api/whatsapp/drafts',headers=h,json={'session':sid,'recipient':'Ahmad','message':'No send'})
    assert r.status_code==409 and not sent

def test_automatic_local_session_is_private_and_origin_bound(tmp_path,monkeypatch):
    import asyncio, httpx
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(wa,'get_settings',lambda:Settings(whatsapp_owner_token='private-owner-token'*2))
    wa.limits.clear()
    async def check():
        transport=httpx.ASGITransport(app=app,client=('127.0.0.1',12345))
        async with httpx.AsyncClient(transport=transport,base_url='http://localhost:8000') as c:
            origin={'Origin':'http://localhost:3000','X-ROOH-Local':'1'}
            assert (await c.get('/api/whatsapp/contacts',headers=origin)).status_code==401
            assert (await c.post('/api/whatsapp/local-session',headers={**origin,'Origin':'https://evil.example'})).status_code==403
            assert (await c.post('/api/whatsapp/local-session',headers={'Origin':'http://localhost:3000'})).status_code==403
            r=await c.post('/api/whatsapp/local-session',headers=origin)
            assert r.status_code==200 and r.json()=={'ready':True}
            alternate={**origin,'Origin':'http://127.0.0.1:3001'}
            assert (await c.post('/api/whatsapp/local-session',headers=alternate)).status_code==200
            assert 'private-owner-token' not in r.text
            cookie=r.headers['set-cookie']
            assert 'HttpOnly' in cookie and 'SameSite=strict' in cookie and 'Path=/api/whatsapp' in cookie
            assert r.headers['cache-control']=='no-store'
            assert (await c.get('/api/whatsapp/contacts',headers=origin)).status_code==200
            assert (await c.post('/api/whatsapp/session',headers=origin)).status_code==200
            assert (await c.get('/api/whatsapp/contacts',headers={'Origin':'https://evil.example'})).status_code==403
            assert (await c.get('/api/whatsapp/contacts',headers={**origin,'Cookie':wa.LOCAL_COOKIE+'=tampered'})).status_code==401
        remote=httpx.ASGITransport(app=app,client=('192.168.1.22',12345))
        async with httpx.AsyncClient(transport=remote,base_url='http://localhost:8000') as c:
            assert (await c.post('/api/whatsapp/local-session',headers=origin)).status_code==403
    asyncio.run(check())

def test_local_cookie_expiry_and_signature(monkeypatch):
    import hashlib,hmac
    secret='test-owner-secret'*2
    payload='nonce.1000'
    signature=hmac.new(secret.encode(),('whatsapp-local:'+payload).encode(),hashlib.sha256).hexdigest()
    monkeypatch.setattr(wa.time,'time',lambda:1001)
    assert wa.local_cookie_valid(payload+'.'+signature,secret)
    assert not wa.local_cookie_valid(payload+'.'+signature,'different-secret')
    monkeypatch.setattr(wa.time,'time',lambda:1000+wa.LOCAL_SESSION_SECONDS+1)
    assert not wa.local_cookie_valid(payload+'.'+signature,secret)
