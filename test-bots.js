/**
 * test-bots.js — Prueba de carga con 30 bots simulados
 * Usa la API REST de Supabase directamente con https nativo de Node.js
 * 
 * USO: node test-bots.js
 * DURACIÓN: 60 segundos
 */

const https = require('https');

// ── Configuración Supabase ──────────────────────────────────────────────────
const SUPABASE_URL  = 'https://postlkgqpuirhfcyyqje.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvc3Rsa2dxcHVpcmhmY3l5cWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNzY5MDgsImV4cCI6MjA5NTg1MjkwOH0.gclaXRWKgon1Wys5-M_PLHzS_7sPuCXw9voPurez0Bo';

const NUM_BOTS      = 30;
const TEST_DURATION = 60_000; // 60 segundos
const MSG_INTERVAL  = { min: 2000, max: 8000 }; // mensajes cada 2–8s por bot
const CHANNEL_ID    = 'general'; // canal donde envían mensajes
const SERVER_ID     = 'nexus-default';

// ── Helpers HTTP ────────────────────────────────────────────────────────────
function supabaseRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url  = new URL(SUPABASE_URL + path);
    const data = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request(options, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Estadísticas ────────────────────────────────────────────────────────────
const stats = {
  msgSent:    0,
  msgFailed:  0,
  latencies:  [],    // ms por insert exitoso
  botsAlive:  new Set(),
  errors:     [],
};

// ── Bot individual ──────────────────────────────────────────────────────────
async function runBot(id) {
  const name    = `Bot_${String(id + 1).padStart(3, '0')}`;
  const botId   = `bot-uuid-${id}-${Date.now()}`;
  let   running = true;

  stats.botsAlive.add(name);

  // ── Heartbeat: insertar un registro de presencia simulada en messages ──
  // (Supabase Realtime Presence requiere WebSocket; usamos messages como proxy)
  async function sendMessage() {
    if (!running) return;

    const messages = [
      `Hola desde ${name}! 🎮`,
      `${name} está testeando la conexión...`,
      `Prueba de carga ${id + 1}/30 — todo OK`,
      `@nexus evento en vivo con ${name}`,
      `${name}: latencia del servidor?`,
      `🔊 Audio check desde ${name}`,
      `${name} listo para el evento`,
    ];
    const content = messages[Math.floor(Math.random() * messages.length)];

    const t0 = Date.now();
    try {
      const res = await supabaseRequest('POST', '/rest/v1/messages', {
        channel_id: CHANNEL_ID,
        author:     name,
        avatar:     null,
        avatar_bg:  'bg-blue',
        text:       content,
        image:      null,
        file:       null,
      });

      const latency = Date.now() - t0;

      if (res.status >= 200 && res.status < 300) {
        stats.msgSent++;
        stats.latencies.push(latency);
      } else {
        stats.msgFailed++;
        stats.errors.push(`[${name}] HTTP ${res.status}: ${JSON.stringify(res.body)?.slice(0, 80)}`);
      }
    } catch (err) {
      stats.msgFailed++;
      stats.errors.push(`[${name}] Error red: ${err.message}`);
    }

    if (running) {
      const delay = MSG_INTERVAL.min + Math.random() * (MSG_INTERVAL.max - MSG_INTERVAL.min);
      setTimeout(sendMessage, delay);
    }
  }

  // Arranque escalonado para no saturar todo al mismo tiempo
  await new Promise(r => setTimeout(r, id * 80));
  sendMessage();

  return () => {
    running = false;
    stats.botsAlive.delete(name);
  };
}

// ── Limpieza: borrar mensajes de bots al terminar ───────────────────────────
async function cleanup() {
  process.stdout.write('\n🧹 Limpiando mensajes de bots en Supabase... ');
  try {
    const res = await supabaseRequest(
      'DELETE',
      `/rest/v1/messages?author=like.Bot_*`,
    );
    if (res.status < 300) {
      console.log('✅ Mensajes de bots eliminados.');
    } else {
      console.log(`⚠️  HTTP ${res.status} — puede que necesites borrarlos manualmente.`);
    }
  } catch (e) {
    console.log(`⚠️  Error en cleanup: ${e.message}`);
  }
}

// ── Reporte en tiempo real ──────────────────────────────────────────────────
function printProgress(elapsed) {
  const avgLat = stats.latencies.length
    ? Math.round(stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length)
    : 0;
  const maxLat = stats.latencies.length ? Math.max(...stats.latencies) : 0;
  const minLat = stats.latencies.length ? Math.min(...stats.latencies) : 0;

  process.stdout.write(
    `\r⏱  ${elapsed}s | 🤖 Bots: ${stats.botsAlive.size}/${NUM_BOTS} | ` +
    `✉️  Enviados: ${stats.msgSent} | ❌ Fallidos: ${stats.msgFailed} | ` +
    `⚡ Latencia avg/min/max: ${avgLat}/${minLat}/${maxLat} ms     `
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   NEXUS GAMING CHAT — Prueba de carga con 30 bots   ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`\n🔗 Supabase: ${SUPABASE_URL}`);
  console.log(`📡 Canal: #${CHANNEL_ID} (${SERVER_ID})`);
  console.log(`🤖 Bots: ${NUM_BOTS}  |  Duración: ${TEST_DURATION / 1000}s`);
  console.log('');

  // Verificar conectividad primero
  process.stdout.write('🔍 Verificando conectividad con Supabase... ');
  try {
    const check = await supabaseRequest('GET', '/rest/v1/servers?select=id&limit=1');
    if (check.status === 200) {
      console.log('✅ Conectado!');
    } else {
      console.log(`❌ Error HTTP ${check.status}. Abortando.`);
      process.exit(1);
    }
  } catch (e) {
    console.log(`❌ Sin red: ${e.message}`);
    process.exit(1);
  }

  console.log('\n🚀 Iniciando bots...\n');

  // Lanzar todos los bots
  const stopFns = await Promise.all(
    Array.from({ length: NUM_BOTS }, (_, i) => runBot(i))
  );

  // Monitor de progreso
  const startTime = Date.now();
  const progressInterval = setInterval(() => {
    printProgress(Math.round((Date.now() - startTime) / 1000));
  }, 500);

  // Esperar duración del test
  await new Promise(r => setTimeout(r, TEST_DURATION));

  // Detener bots
  clearInterval(progressInterval);
  stopFns.forEach(stop => stop());

  // Reporte final
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const avgLat  = stats.latencies.length
    ? Math.round(stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length)
    : 0;
  const p95 = stats.latencies.length
    ? stats.latencies.sort((a, b) => a - b)[Math.floor(stats.latencies.length * 0.95)]
    : 0;

  console.log('\n\n══════════════════════════════════════════════════════');
  console.log('                    REPORTE FINAL');
  console.log('══════════════════════════════════════════════════════');
  console.log(`⏱  Duración real:         ${elapsed}s`);
  console.log(`🤖 Bots activos:          ${NUM_BOTS}`);
  console.log(`✉️  Mensajes enviados:     ${stats.msgSent}`);
  console.log(`❌ Mensajes fallidos:     ${stats.msgFailed}`);
  console.log(`📊 Tasa éxito:            ${((stats.msgSent / (stats.msgSent + stats.msgFailed)) * 100 || 0).toFixed(1)}%`);
  console.log(`⚡ Latencia promedio:     ${avgLat} ms`);
  console.log(`⚡ Latencia mínima:       ${stats.latencies.length ? Math.min(...stats.latencies) : 0} ms`);
  console.log(`⚡ Latencia máxima:       ${stats.latencies.length ? Math.max(...stats.latencies) : 0} ms`);
  console.log(`⚡ Latencia P95:          ${p95} ms`);

  if (stats.errors.length > 0) {
    console.log(`\n⚠️  Primeros errores (${Math.min(stats.errors.length, 5)} de ${stats.errors.length}):`);
    stats.errors.slice(0, 5).forEach(e => console.log('   ' + e));
  }

  // Veredicto
  console.log('\n══════════════════════════════════════════════════════');
  const successRate = (stats.msgSent / (stats.msgSent + stats.msgFailed)) * 100 || 0;
  if (successRate >= 95 && avgLat < 800) {
    console.log('🟢 VEREDICTO: NEXUS AGUANTA 30 USUARIOS SIN PROBLEMAS');
    console.log('   El sistema está listo para el evento en vivo.');
  } else if (successRate >= 80 && avgLat < 1500) {
    console.log('🟡 VEREDICTO: RENDIMIENTO ACEPTABLE CON ALGUNOS PICOS');
    console.log('   Revisar latencia P95 antes del evento.');
  } else {
    console.log('🔴 VEREDICTO: HAY PROBLEMAS DE RENDIMIENTO');
    console.log('   Revisar logs de Supabase antes del evento.');
  }
  console.log('══════════════════════════════════════════════════════\n');

  // Limpiar mensajes de bots
  await cleanup();
}

main().catch(err => {
  console.error('\n❌ Error fatal:', err.message);
  process.exit(1);
});
