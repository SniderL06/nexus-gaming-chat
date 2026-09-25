/**
 * test-voice-presence.js — Prueba de presencia de sala de voz con 30 bots
 * Simula 30 usuarios uniéndose al canal de voz usando WebSocket nativo (protocolo Phoenix de Supabase)
 * 
 * USO: node test-voice-presence.js
 */

const net  = require('net');
const tls  = require('tls');
const http = require('http');

// ── Config ────────────────────────────────────────────────────────────────
const SUPABASE_HOST  = 'postlkgqpuirhfcyyqje.supabase.co';
const SUPABASE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvc3Rsa2dxcHVpcmhmY3l5cWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNzY5MDgsImV4cCI6MjA5NTg1MjkwOH0.gclaXRWKgon1Wys5-M_PLHzS_7sPuCXw9voPurez0Bo';
const VOICE_CHANNEL  = 'voice:general';
const NUM_BOTS       = 30;
const TEST_DURATION  = 45_000; // 45 segundos
const HEARTBEAT_MS   = 20_000; // igual que el código real

// ── WebSocket Handshake helper ───────────────────────────────────────────
function makeWsKey() {
  return require('crypto').randomBytes(16).toString('base64');
}

function connectWS(botId) {
  return new Promise((resolve, reject) => {
    const wsKey  = makeWsKey();
    const botName = `VozBot_${String(botId + 1).padStart(3, '0')}`;
    const peerId = `nexus_bot_${botId}_${Date.now()}`;
    const topic  = VOICE_CHANNEL;

    const socket = tls.connect(443, SUPABASE_HOST, { servername: SUPABASE_HOST }, () => {
      // HTTP Upgrade → WebSocket
      const handshake = [
        `GET /realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0 HTTP/1.1`,
        `Host: ${SUPABASE_HOST}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${wsKey}`,
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Protocol: phoenix',
        '',
        '',
      ].join('\r\n');
      socket.write(handshake);
    });

    let upgraded  = false;
    let buffer    = Buffer.alloc(0);
    let ref       = 1;
    let heartbeatHandle = null;
    let presenceHandle  = null;

    function sendFrame(payload) {
      const data   = Buffer.from(JSON.stringify(payload));
      const len    = data.length;
      let header;
      if (len < 126) {
        header = Buffer.from([0x81, 0x80 | len, 0, 0, 0, 0]);
      } else {
        header = Buffer.from([0x81, 0x80 | 126, (len >> 8) & 0xff, len & 0xff, 0, 0, 0, 0]);
      }
      // XOR mask (zeros = no-op)
      const frame = Buffer.concat([header, data]);
      try { socket.write(frame); } catch (e) {}
    }

    function joinChannel() {
      sendFrame({ topic, event: 'phx_join', payload: { config: { presence: { key: `user_vozbot_${botId}` } } }, ref: String(ref++) });
    }

    function trackPresence() {
      sendFrame({
        topic,
        event: 'presence:track',
        payload: {
          name:      botName,
          email:     `vozbot${botId}@nexus-test.bot`,
          peerId,
          avatar:    '',
          isMuted:   false,
          joinedAt:  Date.now(),
        },
        ref: String(ref++),
      });
    }

    function sendHeartbeat() {
      sendFrame({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(ref++) });
    }

    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);

      if (!upgraded) {
        const str = buffer.toString();
        if (str.includes('101 Switching Protocols')) {
          upgraded = true;
          const headerEnd = buffer.indexOf('\r\n\r\n');
          buffer = buffer.slice(headerEnd + 4);

          // Unirse al canal
          joinChannel();

          // Heartbeat Phoenix cada 25s (para mantener la conexión WS activa)
          heartbeatHandle = setInterval(sendHeartbeat, 25_000);
          // Heartbeat de presencia cada 20s (igual que el código real de voice.js)
          presenceHandle  = setInterval(trackPresence, HEARTBEAT_MS);

          resolve({ name: botName, socket, cleanup: () => {
            clearInterval(heartbeatHandle);
            clearInterval(presenceHandle);
            try { socket.destroy(); } catch (e) {}
          }});
        }
        return;
      }

      // Parsear frames WebSocket (básico, solo para extraer mensajes de texto)
      while (buffer.length >= 2) {
        const b0   = buffer[0];
        const b1   = buffer[1];
        const masked = (b1 & 0x80) !== 0;
        let payLen = b1 & 0x7f;
        let offset = 2;
        if (payLen === 126) { payLen = buffer.readUInt16BE(2); offset = 4; }
        if (buffer.length < offset + payLen) break;

        const msgBuf = buffer.slice(offset, offset + payLen);
        buffer = buffer.slice(offset + payLen);

        const opcode = b0 & 0x0f;
        if (opcode === 1) { // text frame
          try {
            const msg = JSON.parse(msgBuf.toString());
            // Si el join fue confirmado, publicar presencia
            if (msg.event === 'phx_reply' && msg.payload?.status === 'ok') {
              trackPresence();
            }
          } catch (e) {}
        }
      }
    });

    socket.on('error', err => {
      if (!upgraded) reject(err);
    });

    socket.setTimeout(10_000, () => {
      if (!upgraded) reject(new Error('WS timeout'));
    });
  });
}

// ── Stats ────────────────────────────────────────────────────────────────
const stats = {
  connected:    0,
  failed:       0,
  latencies:    [],  // tiempo hasta conexión WS exitosa
  disconnected: 0,
};

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  NEXUS — Prueba de presencia de VOZ con 30 bots     ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`\n📡 Canal: ${VOICE_CHANNEL}`);
  console.log(`🤖 Bots: ${NUM_BOTS}  |  Duración: ${TEST_DURATION / 1000}s\n`);

  const cleanupFns = [];
  const connectPromises = Array.from({ length: NUM_BOTS }, async (_, i) => {
    // Escalonar conexiones para no saturar el handshake TLS
    await new Promise(r => setTimeout(r, i * 120));
    const t0 = Date.now();
    try {
      const { name, socket, cleanup } = await connectWS(i);
      const latency = Date.now() - t0;
      stats.connected++;
      stats.latencies.push(latency);
      cleanupFns.push(cleanup);

      socket.on('close', () => { stats.disconnected++; });
      console.log(`  ✅ ${name} conectado en ${latency}ms (${stats.connected}/${NUM_BOTS})`);
    } catch (err) {
      stats.failed++;
      console.log(`  ❌ VozBot_${String(i+1).padStart(3,'0')} falló: ${err.message}`);
    }
  });

  console.log('🚀 Conectando bots al canal de voz...\n');

  // Esperar conexiones (max 30s para todas)
  await Promise.allSettled(connectPromises);

  console.log(`\n⏳ Bots en sala. Esperando ${TEST_DURATION / 1000}s para medir estabilidad...`);

  // Monitor cada 5s
  const monitorHandle = setInterval(() => {
    process.stdout.write(`\r📊 Conectados: ${stats.connected - stats.disconnected}/${NUM_BOTS} | Desconectados inesperados: ${stats.disconnected}  `);
  }, 5_000);

  await new Promise(r => setTimeout(r, TEST_DURATION));
  clearInterval(monitorHandle);

  // Desconectar todos
  cleanupFns.forEach(fn => fn());

  // Reporte
  const avg = stats.latencies.length
    ? Math.round(stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length)
    : 0;
  const max = stats.latencies.length ? Math.max(...stats.latencies) : 0;
  const min = stats.latencies.length ? Math.min(...stats.latencies) : 0;

  console.log('\n\n══════════════════════════════════════════════════════');
  console.log('               REPORTE FINAL — PRESENCIA VOZ');
  console.log('══════════════════════════════════════════════════════');
  console.log(`🤖 Bots que conectaron:       ${stats.connected}/${NUM_BOTS}`);
  console.log(`❌ Bots que fallaron:         ${stats.failed}`);
  console.log(`💔 Desconectados inesperados: ${stats.disconnected}`);
  console.log(`⚡ Latencia WS promedio:      ${avg} ms`);
  console.log(`⚡ Latencia WS mínima:        ${min} ms`);
  console.log(`⚡ Latencia WS máxima:        ${max} ms`);

  const rate = (stats.connected / NUM_BOTS) * 100;
  console.log('\n══════════════════════════════════════════════════════');
  if (rate >= 95 && stats.disconnected === 0) {
    console.log('🟢 PRESENCIA SUPABASE: Aguanta 30 usuarios sin problemas');
  } else if (rate >= 80) {
    console.log('🟡 PRESENCIA SUPABASE: Acceptable, algunos fallos de conexión');
  } else {
    console.log('🔴 PRESENCIA SUPABASE: Problemas críticos de conectividad');
  }
  console.log('══════════════════════════════════════════════════════');
  console.log('');
  console.log('⚠️  NOTA IMPORTANTE: Esta prueba solo mide la capa de');
  console.log('   presencia de Supabase. El audio real usa WebRTC P2P');
  console.log('   (PeerJS). Ver análisis de escalabilidad P2P abajo.');
  console.log('══════════════════════════════════════════════════════\n');
}

main().catch(err => { console.error('Error fatal:', err.message); process.exit(1); });
