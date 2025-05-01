const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const dotenv = require("dotenv");
const cors = require("cors");
require("dotenv").config();

const app = express();
const port = 3001;

app.use(express.json());
app.use(cors());

const apiKey = process.env.API_KEY;
const apiSecret = process.env.API_SECRET;
const baseURL = "https://fapi.binance.com";

console.log(apiKey);
console.log(apiSecret);


app.post("/start-bot", async (req, res) => {
  try {
    const { symbol, leverage, positionPercent } = req.body;

    // 1. Get balance
    const timestamp = Date.now();
    const balanceParams = `timestamp=${timestamp}&recvWindow=5000`;
    const balanceSignature = crypto
      .createHmac("sha256", apiSecret)
      .update(balanceParams)
      .digest("hex");

    const balanceResponse = await axios.get(`${baseURL}/fapi/v2/account?${balanceParams}&signature=${balanceSignature}`, {
      headers: { "X-MBX-APIKEY": apiKey },
    });

    const usdtBalance = parseFloat(balanceResponse.data.totalWalletBalance);

    // 2. Set leverage
    const leverageParams = {
      symbol,
      leverage,
      timestamp: Date.now(),
      recvWindow: 5000
    };

    const leverageQuery = new URLSearchParams(leverageParams).toString();
    const leverageSignature = crypto
      .createHmac("sha256", apiSecret)
      .update(leverageQuery)
      .digest("hex");

    await axios.post(`${baseURL}/fapi/v1/leverage?${leverageQuery}&signature=${leverageSignature}`, null, {
      headers: { "X-MBX-APIKEY": apiKey },
    });

    // 3. Get price and calculate quantity
    const orderUSDT = (usdtBalance * (positionPercent / 100)) * leverage;

    const priceRes = await axios.get(`${baseURL}/fapi/v1/ticker/price?symbol=${symbol}`);
    const price = parseFloat(priceRes.data.price);

    // Get precision info
    const exchangeInfo = await axios.get(`${baseURL}/fapi/v1/exchangeInfo`);
    const symbolInfo = exchangeInfo.data.symbols.find(s => s.symbol === symbol);
    const stepSize = symbolInfo.filters.find(f => f.filterType === "LOT_SIZE").stepSize;
    const precision = Math.abs(Math.log10(parseFloat(stepSize)));

    const quantity = (orderUSDT / price).toFixed(precision);

    // 4. Place market order
    const orderParams = {
      symbol,
      side: "BUY",
      type: "MARKET",
      quantity,
      timestamp: Date.now(),
      recvWindow: 5000
    };

    const orderQuery = new URLSearchParams(orderParams).toString();
    const orderSignature = crypto
      .createHmac("sha256", apiSecret)
      .update(orderQuery)
      .digest("hex");

    const response = await axios.post(`${baseURL}/fapi/v1/order?${orderQuery}&signature=${orderSignature}`, null, {
      headers: { "X-MBX-APIKEY": apiKey },
    });

    res.json({ success: true, data: response.data });

  } catch (error) {
    console.error("Hata:", error.response?.data || error.message);
    res.status(500).json({ success: false, message: "Order failed", error: error.response?.data || error.message });
  }
});

app.listen(port, () => {
  console.log(`Bot backend çalışıyor, port ${port}`);
});
