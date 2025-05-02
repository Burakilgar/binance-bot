// rsi-bot-server.js

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const dotenv = require("dotenv");
const cors = require("cors");
const cron = require("node-cron");

dotenv.config();

const app = express();
const port = 3001;

app.use(express.json());
app.use(cors());

const apiKey = process.env.API_KEY;
const apiSecret = process.env.API_SECRET;
const baseURL = "https://fapi.binance.com";

let currentPosition = null;
let entryPrice = null;

app.post("/rsi-bot", async (req, res) => {
  try {
    const { symbol, interval, rsiPeriod, smaPeriod, stopLossPercent, leverage, positionPercent } = req.body;

    const validIntervals = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];
    if (!validIntervals.includes(interval)) {
      return res.status(400).json({ message: `Geçersiz interval: ${interval}.` });
    }

    const klines = await axios.get(`${baseURL}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${smaPeriod + rsiPeriod + 2}`);
    const closes = klines.data.map(k => parseFloat(k[4]));

    const rsi = calcRSI(closes, rsiPeriod);
    const sma = calcSMA(rsi, smaPeriod);

    const latestRSI = rsi[rsi.length - 1];
    const prevRSI = rsi[rsi.length - 2];
    const latestSMA = sma[sma.length - 1];
    const prevSMA = sma[sma.length - 2];

    let signal = null;

    if (prevRSI < prevSMA && latestRSI > latestSMA) {
      signal = "LONG"; // crossover
    } else if (prevRSI > prevSMA && latestRSI < latestSMA) {
      signal = "SHORT"; // crossunder
    }

    if (signal && signal !== currentPosition) {
      if (currentPosition) await closePosition(symbol);
      await setLeverage(symbol, leverage);

      const usdtBalance = await getUSDTBalance();
      const orderUSDT = (usdtBalance * positionPercent / 100) * leverage;

      const price = parseFloat((await axios.get(`${baseURL}/fapi/v1/ticker/price?symbol=${symbol}`)).data.price);

      const exchangeInfo = await axios.get(`${baseURL}/fapi/v1/exchangeInfo`);
      const symbolInfo = exchangeInfo.data.symbols.find(s => s.symbol === symbol);
      const stepSize = symbolInfo.filters.find(f => f.filterType === "LOT_SIZE").stepSize;
      const minQty = parseFloat(symbolInfo.filters.find(f => f.filterType === "LOT_SIZE").minQty);
      const minNotional = parseFloat(symbolInfo.filters.find(f => f.filterType === "MIN_NOTIONAL")?.notional || 0);

      const precision = Math.abs(Math.log10(parseFloat(stepSize)));
      const quantity = parseFloat((orderUSDT / price).toFixed(precision));
      const notional = quantity * price;

      if (quantity < minQty) {
        return res.status(400).json({ message: "Yetersiz miktar", minQty, availableQty: quantity });
      }

      if (notional < minNotional) {
        return res.status(400).json({ message: "Yetersiz notional", minNotional, currentNotional: notional });
      }

      await placeMarketOrder(symbol, signal === "LONG" ? "BUY" : "SELL", quantity);

      currentPosition = signal;
      entryPrice = price;

      console.log(`[${signal} AÇILDI] Fiyat: ${price}, Miktar: ${quantity}`);
      return res.json({ message: `Pozisyon açıldı: ${signal}` });
    } else {
      return res.json({ message: `Sinyal yok veya zaten açık: ${currentPosition}` });
    }

  } catch (error) {
    console.error("Hata:", error.response?.data || error.message);
    return res.status(500).json({ message: "Bot hatası", error: error.message });
  }
});

function createSignature(query) {
  return crypto.createHmac("sha256", apiSecret).update(query).digest("hex");
}

async function setLeverage(symbol, leverage) {
  const params = `symbol=${symbol}&leverage=${leverage}&timestamp=${Date.now()}&recvWindow=5000`;
  const sig = createSignature(params);
  await axios.post(`${baseURL}/fapi/v1/leverage?${params}&signature=${sig}`, null, {
    headers: { "X-MBX-APIKEY": apiKey },
  });
}

async function getUSDTBalance() {
  const params = `timestamp=${Date.now()}&recvWindow=5000`;
  const sig = createSignature(params);
  const res = await axios.get(`${baseURL}/fapi/v2/account?${params}&signature=${sig}`, {
    headers: { "X-MBX-APIKEY": apiKey },
  });
  const usdtAsset = res.data.assets.find(asset => asset.asset === "USDT");
  return parseFloat(usdtAsset.availableBalance);
}

async function closePosition(symbol) {
  const params = `symbol=${symbol}&timestamp=${Date.now()}&recvWindow=5000`;
  const sig = createSignature(params);
  const posRes = await axios.get(`${baseURL}/fapi/v2/positionRisk?${params}&signature=${sig}`, {
    headers: { "X-MBX-APIKEY": apiKey },
  });
  const position = posRes.data.find(p => p.symbol === symbol);
  const amt = Math.abs(parseFloat(position.positionAmt));
  if (amt > 0) {
    const side = parseFloat(position.positionAmt) > 0 ? "SELL" : "BUY";
    await placeMarketOrder(symbol, side, amt);
    console.log(`[POZİSYON KAPANDI] ${side} ${amt}`);
  }
}

async function placeMarketOrder(symbol, side, quantity) {
  const params = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${quantity}&timestamp=${Date.now()}&recvWindow=5000`;
  const sig = createSignature(params);
  await axios.post(`${baseURL}/fapi/v1/order?${params}&signature=${sig}`, null, {
    headers: { "X-MBX-APIKEY": apiKey },
  });
}

function calcSMA(arr, period) {
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) result.push(null);
    else {
      const sum = arr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
  }
  return result;
}

function calcRSI(closes, period) {
  const gains = [], losses = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  const avgGain = [average(gains.slice(0, period))];
  const avgLoss = [average(losses.slice(0, period))];
  for (let i = period; i < gains.length; i++) {
    avgGain.push((avgGain[avgGain.length - 1] * (period - 1) + gains[i]) / period);
    avgLoss.push((avgLoss[avgLoss.length - 1] * (period - 1) + losses[i]) / period);
  }
  const rsi = avgGain.map((g, i) => {
    const l = avgLoss[i];
    const rs = l === 0 ? 100 : g / l;
    return 100 - 100 / (1 + rs);
  });
  const empty = Array(closes.length - rsi.length).fill(null);
  return [...empty, ...rsi];
}

function average(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ⏱ Otomatik her 1 dakikada bir çağır
cron.schedule("*/1 * * * *", async () => {
  try {
    await axios.post("http://localhost:3001/rsi-bot", {
      symbol: "XRPUSDT",
      interval: "5m",
      rsiPeriod: 7,
      smaPeriod: 7,
      stopLossPercent: 1,
      leverage: 10,
      positionPercent: 5
    });
    console.log("✓ RSI BOT çalıştı.");
  } catch (e) {
    console.log("⚠ RSI BOT hata:", e.response?.data || e.message);
  }
});

app.listen(port, () => {
  console.log(`✅ Bot sunucusu çalışıyor: http://localhost:${port}`);
});
