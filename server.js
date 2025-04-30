// Gerekli modüller
require('dotenv').config();  
const express = require('express');  
const cors = require('cors');  
const bodyParser = require('body-parser');  
const axios = require('axios');  
const crypto = require('crypto');  
const querystring = require('querystring');  

const app = express();  
app.use(cors()); // CORS aktif  
app.use(bodyParser.json()); // JSON gövdesi alabilmek  

// API bilgileriniz - .env dosyasında tanımlı olmalı  
const API_KEY = process.env.API_KEY;  
const API_SECRET = process.env.API_SECRET;  
const BASE_URL = 'https://fapi.binance.com';  

// Zaman damgası ve imza hesaplamaları
function sign(query) {  
  return crypto.createHmac('sha256', API_SECRET).update(query).digest('hex');  
}

// Parametreleri sorgu stringine çevir ve imzalı query oluştur
function buildQuery(params) {  
  const query = querystring.stringify(params);  
  return `${query}&signature=${sign(query)}`;  
}

app.post('/start-bot', async (req, res) => {  
  const { symbol, leverage, positionPercent } = req.body;  
  const targetSymbol = symbol || 'BTCUSDT';  

  try {  
    const timestamp = Date.now();

    // Leverage ayarla
    const leverageParams = {
      symbol: targetSymbol,
      leverage,
      timestamp
    };
    
    await axios.post(`${BASE_URL}/fapi/v1/leverage?${buildQuery(leverageParams)}`, {}, {  
      headers: { 'X-MBX-APIKEY': API_KEY },  
    });

    // Hesaptaki USDT bakiyesi
    const balanceParams = { timestamp };
    const balanceRes = await axios.get(`${BASE_URL}/fapi/v2/account?${buildQuery(balanceParams)}`, {  
      headers: { 'X-MBX-APIKEY': API_KEY },  
    });  

    const usdtAsset = balanceRes.data.assets.find(a => a.asset === 'USDT');
    if (!usdtAsset) {
      return res.status(400).json({ success: false, message: 'USDT asset not found' });
    }

    const usdtBalance = parseFloat(usdtAsset.availableBalance);  
    const orderQty = ((usdtBalance * positionPercent) / 100).toFixed(2);  

    // Market alış emri
    const orderParams = {
      symbol: targetSymbol,
      side: 'BUY',
      type: 'MARKET',
      quantity: orderQty,
      timestamp
    };

    await axios.post(`${BASE_URL}/fapi/v1/order?${buildQuery(orderParams)}`, {}, {  
      headers: { 'X-MBX-APIKEY': API_KEY },  
    });  

    res.json({ success: true, message: `Buy order placed on ${targetSymbol}` });  

  } catch (err) {  
    console.error('Hata:', err.response?.data || err.message);  
    res.status(500).json({ success: false, message: 'Order failed', error: err.message });  
  }  
});  

app.listen(3001, () => console.log('Bot backend çalışıyor, port 3001'));
