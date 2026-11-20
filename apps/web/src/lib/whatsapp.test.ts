import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('./api',()=>({api:{base:'http://localhost:8000'}}));
let requests:{path:string;body:any}[];
beforeEach(()=>{vi.resetModules();requests=[];vi.stubGlobal('window',{dispatchEvent:vi.fn()});vi.stubGlobal('fetch',vi.fn(async(url:string,options:any)=>{const body=options.body?JSON.parse(options.body):undefined;requests.push({path:url,body});let data:any={};if(url.endsWith('/session'))data={session:'active-session'};if(url.endsWith('/drafts'))data={prepared:true,id:'draft-id',recipient:'Ahmad',message:'Exact text',expires:Date.now()/1000+60,confirmation_token:'private-token'};if(url.endsWith('/confirm'))data={status:'SENT'};return {ok:true,json:async()=>data}}))});
it('keeps confirmation tokens out of model responses and rejects unarmed voice',async()=>{const wa=await import('./whatsapp');await wa.waUnlock('owner-token');const result=await wa.waTool('prepare_whatsapp_message',{recipient:'Ahmad',message:'Exact text'});expect(result.confirmation_token).toBeUndefined();await wa.waVoiceApproval('yes, send it');expect(requests.some(x=>x.path.endsWith('/confirm'))).toBe(false);await wa.waArm();await wa.waVoiceApproval('background yes');expect(requests.some(x=>x.path.endsWith('/confirm'))).toBe(false);await wa.waVoiceApproval('Yes, send it.');await wa.waVoiceApproval('yes, send it');expect(requests.filter(x=>x.path.endsWith('/confirm'))).toHaveLength(1);expect(requests.find(x=>x.path.endsWith('/confirm'))?.body.token).toBe('private-token')});
it('invalidates local confirmation on session changes',async()=>{const wa=await import('./whatsapp');await wa.waUnlock('owner-token');await wa.waTool('prepare_whatsapp_message',{recipient:'Ahmad',message:'Exact text'});await wa.waArm();await wa.waNewSession();await wa.waVoiceApproval('yes, send it');expect(requests.some(x=>x.path.endsWith('/confirm'))).toBe(false)});

it('preserves service diagnostics and HTTP status for recovery',async()=>{
  const wa=await import('./whatsapp');
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:503,json:async()=>({detail:'WhatsApp bridge authentication failed. Restart ROOH.'})})));
  await expect(wa.waRequest('/connect',{})).rejects.toMatchObject({status:503,message:'WhatsApp bridge authentication failed. Restart ROOH.'});
});

it('opens a local session automatically once without exposing a server secret',async()=>{
  const wa=await import('./whatsapp');
  await Promise.all([wa.waUnlockLocal(),wa.waUnlockLocal(),wa.waUnlockLocal()]);
  expect(requests.filter(x=>x.path.endsWith('/local-session'))).toHaveLength(1);
  expect(requests.filter(x=>x.path.endsWith('/session'))).toHaveLength(1);
  expect(wa.waDraft().unlocked).toBe(true);
  const options=vi.mocked(fetch).mock.calls[0][1]!;
  expect(options.credentials).toBe('include');
  expect(options.headers).not.toHaveProperty('Authorization');
});
it('checking status does not start a WhatsApp connection',async()=>{
  const wa=await import('./whatsapp');
  await wa.waTool('get_whatsapp_status',{});
  expect(requests.some(x=>x.path.endsWith('/connect'))).toBe(false);
});
