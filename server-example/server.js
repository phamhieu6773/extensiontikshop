// Demo server to test login + sync of the POD Crawler extension.
// Run: node server-example/server.js   (Node 18+, no dependencies)
// Env: PORT (default 3000), API_KEY (default "demo-key")
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.API_KEY || 'demo-key';
const DB_FILE = path.join(__dirname, 'products.json');

const loadProducts = () => (fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : []);

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, X-API-Key, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 50 * 1024 * 1024) reject(new Error('Body too large'));
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

http
  .createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const key = req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (key !== API_KEY) return send(res, 401, { error: 'API key không hợp lệ' });

    try {
      if (req.method === 'GET' && req.url === '/api/v1/extension/me') {
        return send(res, 200, { name: 'Demo User', plan: 'free' });
      }
      if (req.method === 'GET' && req.url === '/api/v1/extension/products') {
        return send(res, 200, { products: loadProducts() });
      }
      if (req.method === 'POST' && req.url === '/api/v1/extension/products') {
        const { products = [] } = JSON.parse((await readBody(req)) || '{}');
        const byKey = new Map(loadProducts().map((p) => [p.key, p]));
        for (const p of products) if (p && p.key) byKey.set(p.key, { ...p, receivedAt: new Date().toISOString() });
        fs.writeFileSync(DB_FILE, JSON.stringify([...byKey.values()], null, 2));
        console.log(`Nhận ${products.length} sản phẩm (tổng ${byKey.size})`);
        return send(res, 200, { ok: true, received: products.length, total: byKey.size });
      }
      send(res, 404, { error: 'Not found' });
    } catch (err) {
      send(res, 400, { error: err.message });
    }
  })
  .listen(PORT, () => {
    console.log(`POD Crawler demo server: http://localhost:${PORT}  (API key: ${API_KEY})`);
  });
