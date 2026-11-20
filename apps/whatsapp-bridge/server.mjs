import express from 'express';
import rateLimit from 'express-rate-limit';
import QRCode from 'qrcode';
import WA from 'whatsapp-web.js';
import {timingSafeEqual} from 'node:crypto';
import {mkdirSync,appendFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const secret=process.env.WHATSAPP_BRIDGE_SECRET;
if(!secret||secret.length<32)throw Error('WHATSAPP_BRIDGE_SECRET must contain at least 32 characters');
const dir=resolve(process.env.WHATSAPP_DATA_DIR||'../../.rooh-private');mkdirSync(dir,{recursive:true,mode:0o700});
const chromePath=process.env.WHATSAPP_CHROME_PATH||[`${process.env.PROGRAMFILES}/Google/Chrome/Application/chrome.exe`,`${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`].find(path=>existsSync(path));
const configuredAuthTimeout=Number(process.env.WHATSAPP_AUTH_TIMEOUT_MS||180000);
const authTimeoutMs=Number.isFinite(configuredAuthTimeout)&&configuredAuthTimeout>=30000?configuredAuthTimeout:180000;
const navigationTimeoutMs=45000;
class RoohWhatsAppClient extends WA.Client {
  async initWebVersionCache(){
    await super.initWebVersionCache();
    const page=this.pupPage;
    const goto=page.goto.bind(page);
    // The upstream client waits for every load-blocking asset, then waits for
    // WhatsApp's runtime itself. Start that runtime check at DOM readiness.
    page.goto=async (url,options)=>{
      page.goto=goto;
      if(url!=='https://web.whatsapp.com/')return goto(url,options);
      return goto(url,{...options,waitUntil:'domcontentloaded',timeout:navigationTimeoutMs});
    };
  }
}
const journal=resolve(dir,'sends.jsonl'), attempts=new Map();
if(existsSync(journal))for(const line of readFileSync(journal,'utf8').trim().split('\n')){if(line){const row=JSON.parse(line);attempts.set(row.id,row)}}
let client,initializing=false,generation=0,seq=0;
let snapshot={state:'DISCONNECTED',qr:null,expires_at:null,account:null,error:null};
const streams=new Set();
function update(patch){snapshot={...snapshot,...patch};if(snapshot.state!=='WAITING_FOR_QR'){snapshot.qr=null;snapshot.expires_at=null}for(const res of streams)res.write(`data: ${JSON.stringify(snapshot)}\n\n`)}
async function connect(){if(initializing||['CONNECTED','WAITING_FOR_QR','AUTHENTICATING'].includes(snapshot.state))return;initializing=true;const epoch=++generation,started=Date.now();let firstQr=false;update({state:client?'RECONNECTING':'INITIALIZING',error:null});try{if(client)await client.destroy().catch(()=>{});client=new RoohWhatsAppClient({authStrategy:new WA.LocalAuth({dataPath:resolve(dir,'auth')}),webVersionCache:{type:'none'},puppeteer:{headless:true,...(chromePath?{executablePath:chromePath}:{}),args:['--no-first-run','--no-default-browser-check','--disable-extensions','--disable-component-update','--disable-background-timer-throttling']},qrMaxRetries:8,authTimeoutMs,takeoverOnConflict:false});
client.on('qr',async raw=>{if(epoch!==generation)return;const serial=++seq;const qr=await QRCode.toDataURL(raw,{width:420,margin:3,errorCorrectionLevel:'M'});if(epoch===generation&&serial===seq){if(!firstQr){firstQr=true;console.info(`WhatsApp: first QR ready after ${Date.now()-started} ms`)}update({state:'WAITING_FOR_QR',qr,expires_at:Date.now()+60000})}});
client.on('authenticated',()=>{if(epoch===generation){seq++;update({state:'AUTHENTICATING'})}});
client.on('ready',()=>{if(epoch===generation){seq++;update({state:'CONNECTED',account:client.info?.wid?.user||null});client.pupBrowser?.once('disconnected',()=>{if(epoch===generation){seq++;update({state:'ERROR',account:null,error:'WhatsApp browser closed. Reconnect explicitly.'})}})}});
client.on('auth_failure',()=>{if(epoch===generation){seq++;update({state:'ERROR',error:'Authentication failed. Reconnect and scan again.'})}});
client.on('disconnected',()=>{if(epoch===generation){seq++;update({state:'DISCONNECTED',account:null,error:'Connection lost. Reconnect explicitly; no messages will be retried.'})}});
let timer;try{await Promise.race([client.initialize(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('INITIALIZATION_TIMEOUT')),authTimeoutMs+navigationTimeoutMs)})])}finally{clearTimeout(timer)}}catch(error){if(epoch===generation){generation++;seq++;const message=error?.name==='TimeoutError'?'WhatsApp Web did not finish loading its page. Check access to web.whatsapp.com and static.whatsapp.net, then try again.':error?.message==='INITIALIZATION_TIMEOUT'||error==='auth timeout'?'WhatsApp Web did not become ready. Check the network or VPN route and try again.':error?.message?.includes('Could not find Chrome')?'Chromium is missing. Install Puppeteer Chrome or configure WHATSAPP_CHROME_PATH.':'Browser could not start. Check Chromium installation, network, and session conflicts.';console.warn(`WhatsApp: ${message} (${Date.now()-started} ms)`);update({state:'ERROR',error:message});await client?.destroy().catch(()=>{})}}finally{initializing=false}}
const app=express();app.disable('x-powered-by');app.use((req,res,next)=>{res.set('Cache-Control','no-store');const supplied=Buffer.from(req.headers.authorization?.replace(/^Bearer /,'')||'');const expected=Buffer.from(secret);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return res.sendStatus(401);next()});app.use(rateLimit({windowMs:60000,limit:100}));app.use(express.json({limit:'16kb'}));
app.get('/status',(_,res)=>res.json({...snapshot,qr:snapshot.expires_at>Date.now()?snapshot.qr:null}));
app.get('/events',(req,res)=>{res.set({'Content-Type':'text/event-stream','Connection':'keep-alive'});res.flushHeaders();streams.add(res);res.write(`data: ${JSON.stringify(snapshot)}\n\n`);const timer=setInterval(()=>res.write(': heartbeat\n\n'),15000);req.on('close',()=>{clearInterval(timer);streams.delete(res)})});
app.post('/connect',(_,res)=>{void connect();res.json({accepted:true})});
app.post('/disconnect',async(_,res)=>{generation++;seq++;update({state:'DISCONNECTED',account:null});try{await client?.logout();await client?.destroy().catch(()=>{});res.json({disconnected:true})}catch{res.status(503).json({error:'Could not unlink. Remove ROOH in phone Linked Devices.'})}});
app.get('/contacts',async(_,res)=>{if(snapshot.state!=='CONNECTED')return res.sendStatus(409);try{const contacts=await client.getContacts();res.json(contacts.filter(c=>c.isWAContact&&!c.isGroup&&c.id?.server==='c.us').map(c=>({id:c.id._serialized,name:c.name||c.pushname||c.number,phone:'+'+c.number}))) }catch{res.sendStatus(503)}});
app.get('/chats',async(_,res)=>{if(snapshot.state!=='CONNECTED')return res.sendStatus(409);try{const chats=await client.getChats();res.json(chats.filter(c=>!c.isGroup&&c.id?.server==='c.us').map(c=>({id:c.id._serialized,name:c.name||c.id.user,phone:'+'+c.id.user,unread:c.unreadCount}))) }catch{res.sendStatus(503)}});
app.get('/messages',async(req,res)=>{if(snapshot.state!=='CONNECTED')return res.sendStatus(409);const id=req.query.chat;if(typeof id!=='string'||!/^\d+@c\.us$/.test(id))return res.sendStatus(400);try{const chat=await client.getChatById(id);const messages=await chat.fetchMessages({limit:50});res.json(messages.map(m=>({id:m.id._serialized,body:m.body||'',fromMe:m.fromMe,timestamp:m.timestamp,hasMedia:m.hasMedia})))}catch{res.sendStatus(503)}});
app.post('/validate',async(req,res)=>{if(snapshot.state!=='CONNECTED')return res.sendStatus(409);if(!/^\+[1-9]\d{7,14}$/.test(req.body.phone||''))return res.sendStatus(400);try{res.json({valid:Boolean(await client.getNumberId(req.body.phone.slice(1)))})}catch{res.sendStatus(503)}});
function record(row){appendFileSync(journal,JSON.stringify(row)+'\n',{mode:0o600,flush:true});attempts.set(row.id,row)}
app.post('/send',async(req,res)=>{const {id,phone,message}=req.body;if(!/^[a-f0-9]{32}$/.test(id||'')||!/^\+[1-9]\d{7,14}$/.test(phone||'')||typeof message!=='string'||!message.trim()||message.length>4000)return res.sendStatus(400);if(attempts.has(id))return res.json(attempts.get(id));if(snapshot.state!=='CONNECTED')return res.status(409).json({error:'Disconnected'});record({id,status:'UNCERTAIN'});try{const target=await client.getNumberId(phone.slice(1));if(!target){record({id,status:'FAILED'});return res.json(attempts.get(id))}const sent=await client.sendMessage(target._serialized,message);record({id,status:'SENT',message_id:sent.id._serialized});res.json(attempts.get(id))}catch{res.json({id,status:'UNCERTAIN'})}});
const server=app.listen(Number(process.env.WHATSAPP_BRIDGE_PORT||3010),'127.0.0.1');server.on('error',()=>{console.error('Bridge port unavailable; another instance may be running.');process.exit(1)});
server.once('listening',()=>{if(process.argv.includes('--prewarm')&&process.env.WHATSAPP_PREWARM!=='0')void connect()});
setInterval(()=>{if(snapshot.qr&&snapshot.expires_at<=Date.now())update({qr:null,expires_at:null})},1000).unref();
async function close(){generation++;server.close();for(const res of streams)res.end();await client?.destroy().catch(()=>{});process.exit(0)}process.on('SIGINT',close);process.on('SIGTERM',close);

process.on("message",message=>{if(message?.type==="shutdown")void close()});
