import asyncio
import httpx
import pytest
from fastapi import HTTPException
from app import whatsapp as wa
from app.config import Settings

@pytest.fixture
def transport_setup(monkeypatch):
    monkeypatch.setattr(wa,'get_settings',lambda:Settings(whatsapp_bridge_secret='test-server-secret'*2))
    real_client=httpx.AsyncClient
    options=[]
    def use_transport(handler):
        def factory(**kwargs):
            options.append(kwargs)
            return real_client(transport=httpx.MockTransport(handler),**kwargs)
        monkeypatch.setattr(wa.httpx,'AsyncClient',factory)
    return use_transport, options

def test_local_bridge_bypasses_proxies_and_preserves_status(transport_setup):
    use_transport, options=transport_setup
    def handler(request):
        assert request.url.host=='127.0.0.1'
        assert request.headers['authorization']=='Bearer '+'test-server-secret'*2
        return httpx.Response(200,json={'state':'WAITING_FOR_QR','qr':None})
    use_transport(handler)
    assert asyncio.run(wa.bridge('status'))['state']=='WAITING_FOR_QR'
    assert options[0]['trust_env'] is False

@pytest.mark.parametrize('upstream,expected,text',[(401,503,'authentication failed'),(409,409,'not connected yet'),(429,429,'Wait a minute'),(500,503,'could not complete')])
def test_actionable_bridge_errors(transport_setup,upstream,expected,text):
    use_transport,_=transport_setup
    use_transport(lambda request:httpx.Response(upstream,text='private upstream details'))
    with pytest.raises(HTTPException) as error:asyncio.run(wa.bridge('connect',{}))
    assert error.value.status_code==expected
    assert text in error.value.detail
    assert 'private upstream details' not in error.value.detail

@pytest.mark.parametrize('exception,code,text',[(httpx.ConnectError,503,'not running'),(httpx.ReadTimeout,504,'timed out')])
def test_connection_failures_have_distinct_messages(transport_setup,exception,code,text):
    use_transport,_=transport_setup
    def fail(request):raise exception('private transport details',request=request)
    use_transport(fail)
    with pytest.raises(HTTPException) as error:asyncio.run(wa.bridge('connect',{}))
    assert error.value.status_code==code and text in error.value.detail
