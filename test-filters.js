const fs = require('fs');

class AudioNodeMock {
  constructor(name) {
    this.name = name;
    this.connectedTo = [];
    this.gain = { value: 1, setValueAtTime: () => {}, setTargetAtTime: () => {} };
    this.delayTime = { value: 0 };
    this.frequency = { value: 0 };
    this.Q = { value: 0 };
    this.attack = { value: 0 };
    this.release = { value: 0 };
    this.knee = { value: 0 };
    this.threshold = { value: 0 };
    this.ratio = { value: 0 };
  }
  connect(dest) { this.connectedTo.push(dest); return dest; }
  disconnect() { this.connectedTo = []; }
}

class AudioContextMock {
  constructor() { this.currentTime = 0; this.state = 'running'; }
  createGain() { return new AudioNodeMock('GainNode'); }
  createBiquadFilter() { return new AudioNodeMock('BiquadFilterNode'); }
  createDelay() { return new AudioNodeMock('DelayNode'); }
  createOscillator() { return Object.assign(new AudioNodeMock('OscillatorNode'), { start: () => {}, stop: () => {} }); }
  createDynamicsCompressor() { return new AudioNodeMock('DynamicsCompressorNode'); }
  createWaveShaper() { return new AudioNodeMock('WaveShaperNode'); }
  createAnalyser() { return Object.assign(new AudioNodeMock('AnalyserNode'), { frequencyBinCount: 128, getByteTimeDomainData: () => {} }); }
  createMediaStreamDestination() { return { stream: { getAudioTracks: () => [{ kind: 'audio' }] } }; }
}

const audioCtx = new AudioContextMock();
let filterCleanupFns = [];

const voiceCode = fs.readFileSync('js/voice.js', 'utf8');

// Extraer funciones
const makeDistortionCurveMatch = voiceCode.match(/function makeDistortionCurve[\s\S]*?\n\}/);
const buildFilterChainMatch = voiceCode.match(/function buildFilterChain[\s\S]*?\n\}/);

if (!makeDistortionCurveMatch || !buildFilterChainMatch) {
  console.error("No se pudo extraer la función buildFilterChain");
  process.exit(1);
}

eval(makeDistortionCurveMatch[0]);
eval(buildFilterChainMatch[0]);

const filters = ['noise', 'none', 'extreme', 'robot', 'radio', 'megaphone', 'echo', 'bass', 'chipmunk'];

console.log("=== INICIANDO PRUEBAS DE FILTROS DE AUDIO ===");
let allPassed = true;
filters.forEach(filterName => {
  try {
    const inputNode = audioCtx.createGain();
    const outNode = buildFilterChain(filterName, inputNode);
    if (!outNode) throw new Error('Retornó null o undefined');
    
    // Probar que el cleanup no arroje errores
    const cleanCount = filterCleanupFns.length;
    filterCleanupFns.forEach(fn => fn());
    filterCleanupFns = [];
    
    console.log(`✅ Filtro [${filterName.padEnd(9)}]: FUNCIONA CORRECTAMENTE (${outNode.name}, ${cleanCount} cleanups)`);
  } catch(err) {
    allPassed = false;
    console.error(`❌ Error en filtro [${filterName}]:`, err.message);
  }
});

if (allPassed) {
  console.log("\n🎉 TODOS LOS 9 FILTROS DE MICRÓFONO FUNCIONAN Y SE LIMPIAN SIN ERRORES.");
} else {
  process.exit(1);
}
