//------------------------------  
// Gerekli modüller & yapılandırma  
//------------------------------  
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

console.log('API KEY:', API_KEY);  
console.log('API SECRET:', API_SECRET);  

//------------------------------  
// HMAC Sign Method  
//------------------------------  
function sign(query) {  
  return crypto.createHmac('sha256', API_SECRET).update(query).digest('hex');  
}  

// Query string oluşturma ve imzalama  
function buildQuery(params) {  
  const query = querystring.stringify(params);  
  return `${query}&signature=${sign(query)}`;  
}  

//------------------------------  
// Raporda /start-bot işlemi  
//------------------------------  
app.post('/start-bot', async (req, res) => {  
  const { symbol, leverage, positionPercent } = req.body;  
  const targetSymbol = symbol || 'BTCUSDT';  

  try {  
    const timestamp = Date.now();  

    // Leverage ayarla  
    await axios.post(`${BASE_URL}/fapi/v1/leverage?${buildQuery({  
      symbol: targetSymbol,  
      leverage,  
      timestamp,  
    })}`, {}, {  
      headers: { 'X-MBX-APIKEY': API_KEY },  
    });  

    // Hesaptaki USDT bakiyesi  
    const balanceRes = await axios.get(`${BASE_URL}/fapi/v2/account?${buildQuery({ timestamp })}`, {  
      headers: { 'X-MBX-APIKEY': API_KEY },  
    });  

    const assets = balanceRes.data.assets;  
    const usdtAsset = assets.find(a =>a.asset === 'USDT');  
    if (!usdtAsset) {  
      return res.status(400).json({ success: false, message: 'USDT asset not found' });  
    }  
    const usdtBalance = parseFloat(usdtAsset.availableBalance);  

    // İşlem miktarını hesapla  
    const orderQty = ((usdtBalance * positionPercent) / 100).toFixed(2);  

    // Market alış emri  
    await axios.post(`${BASE_URL}/fapi/v1/order?${buildQuery({  
      symbol: targetSymbol,  
      side: 'BUY',  
      type: 'MARKET',  
      quantity: orderQty,  
      timestamp,  
    })}`, {}, {  
      headers: { 'X-MBX-APIKEY': API_KEY },  
    });  

    res.json({ success: true, message: `Buy order placed on ${targetSymbol}` });  

  } catch (err) {  
    console.error('Hata:', err.response?.data || err.message);  
    res.status(500).json({ success: false, message: 'Order failed', error: err.message });  
  }  
});  

// Sunucuyu çalıştır  
app.listen(3001, () => console.log('Bot backend çalışıyor, port 3001'));  