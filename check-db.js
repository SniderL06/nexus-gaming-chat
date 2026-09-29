/**
 * check-db.js — Verifica servidores, canales y estructura de la DB
 * USO: node check-db.js
 */
const https = require('https');

const SUPABASE_URL = 'https://postlkgqpuirhfcyyqje.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvc3Rsa2dxcHVpcmhmY3l5cWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNzY5MDgsImV4cCI6MjA5NTg1MjkwOH0.gclaXRWKgon1Wys5-M_PLHzS_7sPuCXw9voPurez0Bo';

function get(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + path);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  console.log('\n=== SERVIDORES ===');
  const servers = await get('/rest/v1/servers?select=*&order=created_at.asc');
  console.log(`Status: ${servers.status}`);
  servers.data.forEach(s => {
    console.log(`  [${s.id}] name="${s.name}" icon="${s.icon}" created_at=${s.created_at}`);
  });

  console.log('\n=== CANALES ===');
  const channels = await get('/rest/v1/channels?select=*&order=created_at.asc');
  console.log(`Status: ${channels.status}`);
  channels.data.forEach(c => {
    console.log(`  [${c.id}] server_id="${c.server_id}" name="${c.name}" type="${c.type}"`);
  });

  console.log('\n=== MENSAJES RECIENTES (últimos 5) ===');
  const msgs = await get('/rest/v1/messages?select=*&order=id.desc&limit=5');
  console.log(`Status: ${msgs.status}`);
  msgs.data.forEach(m => {
    console.log(`  ch="${m.channel_id}" author="${m.author}" text="${(m.text||'').substring(0,50)}"`);
  });
})();
