"""Read-only Twelve Data market candles and optional OpenAI commentary."""
import asyncio
import time
from datetime import datetime, timezone
import httpx
from fastapi import APIRouter, Depends, HTTPException
from .openai_api import complete
from .config import Settings, get_settings

router = APIRouter(prefix="/api/trading", tags=["trading"])
SYMBOLS = {"XAUUSD", "EURUSD", "GBPUSD"}
TIMEFRAMES = {"1m", "5m", "15m", "1h", "4h", "1d"}
_limit = asyncio.Semaphore(3)
_cache = {}
SYMBOL_NAMES = {"XAUUSD": "XAU/USD", "EURUSD": "EUR/USD", "GBPUSD": "GBP/USD"}
INTERVALS = {"1m": "1min", "5m": "5min", "15m": "15min", "1h": "1h", "4h": "4h", "1d": "1day"}

def validate(symbol: str, timeframe: str):
    if symbol not in SYMBOLS or timeframe not in TIMEFRAMES:
        raise HTTPException(400, "Unsupported symbol or timeframe")

def configured(s: Settings):
    if not s.twelvedata_api_key:
        raise HTTPException(503, "Twelve Data is not configured. Set TWELVEDATA_API_KEY.")

def normalize(c):
    stamp = c["datetime"]
    if isinstance(stamp, str):
        stamp = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return {"time": int(stamp.timestamp()), "open": float(c["open"]), "high": float(c["high"]), "low": float(c["low"]), "close": float(c["close"]), "volume": float(c.get("volume") or 0)}

@router.get("/candles")
async def candles(symbol: str = "XAUUSD", timeframe: str = "1h", limit: int = 300, s: Settings = Depends(get_settings)):
    validate(symbol, timeframe)
    if not 30 <= limit <= 1000:
        raise HTTPException(400, "Limit must be between 30 and 1000")
    configured(s)
    cache_key = (s.twelvedata_api_key, symbol, timeframe, limit)
    cached = _cache.get(cache_key)
    if cached and time.monotonic() - cached[0] < 60:
        return cached[1]
    async with _limit:
        cached = _cache.get(cache_key)
        if cached and time.monotonic() - cached[0] < 60:
            return cached[1]
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.get("https://api.twelvedata.com/time_series", params={"symbol": SYMBOL_NAMES[symbol], "interval": INTERVALS[timeframe], "outputsize": limit, "timezone": "UTC", "apikey": s.twelvedata_api_key})
            if response.status_code == 429:
                raise HTTPException(429, "Twelve Data rate limit reached.", headers={"Retry-After": "60"})
            response.raise_for_status()
            payload = response.json()
            if payload.get("status") == "error":
                code = payload.get("code")
                raise HTTPException(429 if code == 429 else 503, payload.get("message", "Twelve Data rejected this symbol or request."))
            result = sorted((normalize(c) for c in payload.get("values", [])), key=lambda c: c["time"])
            if not result:
                raise HTTPException(503, "Twelve Data returned no candles for this symbol and timeframe.")
            market = {"symbol": symbol, "timeframe": timeframe, "source": "Twelve Data", "candles": result, "as_of": datetime.now(timezone.utc).isoformat()}
            _cache[cache_key] = (time.monotonic(), market)
            return market
        except HTTPException:
            raise
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            raise HTTPException(503, "Market data is temporarily unavailable.") from None

def technical_facts(data):
    if len(data)<50:raise HTTPException(503,"At least 50 real candles are required.")
    closes=[c['close'] for c in data]
    def ema(values,period):
        out=[values[0]]
        for value in values[1:]:out.append(out[-1]+(value-out[-1])*2/(period+1))
        return out
    changes=[b-a for a,b in zip(closes,closes[1:])]
    gain=sum(max(v,0) for v in changes[:14])/14
    loss=sum(max(-v,0) for v in changes[:14])/14
    for value in changes[14:]:gain=(gain*13+max(value,0))/14;loss=(loss*13+max(-value,0))/14
    rsi=50 if gain==loss==0 else 100 if loss==0 else 100-100/(1+gain/loss)
    fast,slow=ema(closes,12),ema(closes,26)
    macd=[a-b for a,b in zip(fast,slow)]
    signal=ema(macd,9)[-1]
    ranges=[max(c['high']-c['low'],abs(c['high']-data[i-1]['close']),abs(c['low']-data[i-1]['close'])) for i,c in enumerate(data) if i]
    atr=sum(ranges[:14])/14
    for value in ranges[14:]:atr=(atr*13+value)/14
    mean=sum(closes[-20:])/20
    deviation=(sum((v-mean)**2 for v in closes[-20:])/20)**0.5
    e20,e50=ema(closes,20)[-1],ema(closes,50)[-1]
    return {'close':closes[-1],'rsi14':rsi,'ema20':e20,'ema50':e50,'macd':macd[-1],'macd_signal':signal,'macd_histogram':macd[-1]-signal,'atr14':atr,'bollinger_upper':mean+2*deviation,'bollinger_middle':mean,'bollinger_lower':mean-2*deviation,'support_30':min(c['low'] for c in data[-30:]),'resistance_30':max(c['high'] for c in data[-30:]),'trend':'Bullish' if closes[-1]>e20>e50 else 'Bearish' if closes[-1]<e20<e50 else 'Mixed','candles_used':len(data),'last_candle_utc':data[-1]['time']}

@router.post("/analysis")
async def analysis(symbol: str = "XAUUSD", timeframe: str = "1h", s: Settings = Depends(get_settings)):
    market=await candles(symbol,timeframe,300,s)
    # Exclude the forming bar so its changing close cannot distort the reading.
    seconds={'1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400}[timeframe]
    closed=[c for c in market['candles'] if c['time']+seconds<=time.time()]
    facts=technical_facts(closed)
    facts.update(symbol=symbol,timeframe=timeframe)
    commentary=f"{facts['trend']} trend on {timeframe}. RSI (Wilder 14): {facts['rsi14']:.1f}. MACD histogram: {facts['macd_histogram']:.6f}. ATR (Wilder 14): {facts['atr14']:.6f}. Support and resistance are the extremes of the last 30 closed candles. A break must be confirmed by a closed candle; mixed indicators imply an unclear direction. This is a technical snapshot, not a probability of profit."
    interpretation='Calculated technical summary'
    if s.openai_api_key:
        try:
            prompt=f"Analyze these computed Twelve Data facts only: {facts}. In English, cover trend, momentum, volatility, support/resistance, conditional bullish and bearish scenarios, and limitations. Distinguish facts from interpretation. Do not invent news, prices, probabilities, or fundamentals. Use concise paragraphs."
            result=await complete(s,[{'role':'user','content':prompt}])
            if result:commentary=result;interpretation='OpenAI interpretation'
        except Exception:pass
    return {'analysis':commentary,'facts':facts,'source':'Twelve Data closed candles; '+interpretation,'as_of':market['as_of']}
