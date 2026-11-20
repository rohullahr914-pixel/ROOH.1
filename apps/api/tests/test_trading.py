from fastapi import HTTPException
from app.trading import validate, normalize

def test_market_allowlist():
    validate("XAUUSD", "1h")
    for symbol, frame in [("US30", "1h"), ("EURUSD", "2h")]:
        try:
            validate(symbol, frame)
            assert False, "unsupported market was accepted"
        except HTTPException as exc:
            assert exc.status_code == 400

def test_candle_normalization():
    candle = normalize({"datetime":"2026-01-01T00:00:00Z", "open":1, "high":2, "low":0.5, "close":1.5, "volume":12})
    assert candle == {"time":1767225600,"open":1.0,"high":2.0,"low":0.5,"close":1.5,"volume":12.0}


def test_flat_market_indicators():
    from app.trading import technical_facts
    rows=[{'time':i*3600,'open':100,'high':100,'low':100,'close':100} for i in range(60)]
    facts=technical_facts(rows)
    assert facts['rsi14']==50
    assert facts['atr14']==0
    assert facts['macd_histogram']==0
    assert facts['bollinger_upper']==facts['bollinger_lower']==100
    assert facts['trend']=='Mixed'

def test_rising_market_indicators():
    from app.trading import technical_facts
    rows=[{'time':i*3600,'open':i+99,'high':i+101,'low':i+99,'close':i+100} for i in range(100)]
    facts=technical_facts(rows)
    assert facts['rsi14']==100
    assert facts['trend']=='Bullish'
    assert facts['atr14']==2
    assert facts['ema20']>facts['ema50']
