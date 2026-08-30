let audioCtx = null;
let masterGain = null;
let isEngineRunning = false;
let currentLocationName = "OFFLINE";
let wakeLock = null;

// --- HARDWARE AUDIO GRAPH TIMING ENGINE ---
let clockNode = null;
let clockDummyGain = null;
let samplesPerTick = 0;
let sampleCounter = 0;

function initAudioClock() {
  const bufferSize = 4096;
  clockNode = audioCtx.createScriptProcessor(bufferSize, 1, 1);
  
  // Mute dummy gain to eliminate clock buffer clicks
  clockDummyGain = audioCtx.createGain();
  clockDummyGain.gain.setValueAtTime(0, audioCtx.currentTime);

  updateClockInterval(rainBpm);

  clockNode.onaudioprocess = function(e) {
    if (!isEngineRunning) return;
    sampleCounter += bufferSize;
    while (sampleCounter >= samplesPerTick) {
      sampleCounter -= samplesPerTick;
      tickClock();
    }
  };

  clockNode.connect(clockDummyGain);
  clockDummyGain.connect(audioCtx.destination);
}

function updateClockInterval(bpm) {
  if (!audioCtx) return;
  const tickDurationSeconds = (60 / bpm) / 4;
  samplesPerTick = Math.floor(audioCtx.sampleRate * tickDurationSeconds);
}

// --- WAKE LOCK & BACKGROUND RESUME HANDLER ---
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (err) {
    console.log('Wake Lock Error:', err);
  }
}

function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release().then(() => { wakeLock = null; });
  }
}

document.addEventListener('visibilitychange', async () => {
  // 1. App resumed: Restore audio if browser force-suspended it in the background
  if (!document.hidden && isEngineRunning && audioCtx) {
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    if (wakeLock === null) {
      await requestWakeLock();
    }
  }
});

// - AUDIO CONSTANTS & START UP SYNTH STATE //

const SCALE = [
  130.81, 146.83, 164.81, 196.00, 220.00,
  261.63, 293.66, 329.63, 392.00, 440.00,
  523.25, 587.33, 659.25, 783.99, 880.00,
  1046.50, 1174.66, 1318.51
];

const CHORD_PROGRESSIONS = [[0, 2, 4], [1, 3, 5], [2, 4, 6], [0, 3, 5]];
let currentChordIdx = 0;

const channelGains = { sun: null, wind: null, rain: null, cloud: null, humid: null, temp: null };

const paramValues = {
  sun:    { intensity: 0.5, volume: 0.5 },
  wind:   { intensity: 0.5, volume: 0.5 },
  rain:   { intensity: 0.5, volume: 0.5 },
  cloud:  { intensity: 0.5, volume: 0.5 },
  humid:  { intensity: 0.5, volume: 0.5 },
  temp:   { intensity: 0.5, volume: 0.5 },
  master: 0.8
};

let windFilter = null, windNoiseSrc = null;
let cloudFilter = null, cloudOscs = [];
let tempFilter = null, tempOsc = null;
let noiseBuffer = null;

let rainBpm = 120;
let stepIndex = 0;

const powerToggle = document.getElementById('power-toggle');
const presetBtns = document.querySelectorAll('.btn-preset:not(.btn-fav):not(#btn-random)'); 
const favBtns = document.querySelectorAll('.btn-fav');
const btnRandom = document.getElementById('btn-random');
const cityInput = document.getElementById('city-input');
const btnSearch = document.getElementById('btn-search');
const weatherStatus = document.getElementById('weather-status');
const masterSlider = document.getElementById('master-slider');

const PRESETS = {
  tropical:    { temp: 0.90, rain: 0.85, humid: 0.95, wind: 0.25, cloud: 0.65, sun: 0.70 },
  arid:        { temp: 0.95, rain: 0.00, humid: 0.10, wind: 0.40, cloud: 0.05, sun: 1.00 },
  temperate:   { temp: 0.55, rain: 0.45, humid: 0.60, wind: 0.45, cloud: 0.50, sun: 0.55 },
  continental: { temp: 0.35, rain: 0.40, humid: 0.50, wind: 0.65, cloud: 0.60, sun: 0.40 },
  polar:       { temp: 0.05, rain: 0.10, humid: 0.25, wind: 0.90, cloud: 0.85, sun: 0.10 },
  alpine:      { temp: 0.20, rain: 0.20, humid: 0.30, wind: 0.95, cloud: 0.40, sun: 0.75 }
};

function generateNoiseBuffer(ctx) {
  const bufferSize = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function clamp(val, min = 0, max = 1) { return Math.min(Math.max(val, min), max); }

function updateParameter(channelKey, type, value) {
  if (channelKey === 'master') {
    paramValues.master = value;
    if (masterGain && audioCtx) masterGain.gain.setTargetAtTime(value, audioCtx.currentTime, 0.05);
    return;
  }

  paramValues[channelKey][type] = value;
  if (!audioCtx || !isEngineRunning) return;

  const vol = paramValues[channelKey].volume;
  const intensity = paramValues[channelKey].intensity;

  if (channelGains[channelKey]) {
    let gainCap = 0.3;
    if (channelKey === 'rain') gainCap = 0.5;
    if (channelKey === 'sun') gainCap = 0.35;
    if (channelKey === 'cloud') gainCap = 0.12; 
    if (channelKey === 'wind') gainCap = 0.15;
    channelGains[channelKey].gain.setTargetAtTime(vol * gainCap, audioCtx.currentTime, 0.05);
  }

  switch (channelKey) {
    case 'wind':
      if (windFilter) windFilter.frequency.setTargetAtTime(intensity * 1200 + 150, audioCtx.currentTime, 0.1);
      break;
    case 'rain':
      rainBpm = intensity * 160 + 70;
      updateClockInterval(rainBpm);
      break;
    case 'cloud':
      if (cloudFilter) cloudFilter.frequency.setTargetAtTime(intensity * 700 + 200, audioCtx.currentTime, 0.1);
      break;
    case 'temp':
      if (tempFilter) tempFilter.frequency.setTargetAtTime(intensity * 600 + 80, audioCtx.currentTime, 0.1);
      break;
  }
}

// - PRESET KEY //

function applyPreset(presetKey, presetData) {
  currentLocationName = presetKey;
  updateStatusDisplay(`PRESET: ${presetKey}`);
  
  Object.keys(presetData).forEach(key => {
    updateParameter(key, 'intensity', presetData[key]);
    updateParameter(key, 'volume', 0.5);
    
    const intSlider = document.querySelector(`.${key}-int`);
    const volSlider = document.querySelector(`.${key}-vol`);
    if (intSlider) { intSlider.value = presetData[key]; updateSliderTrack(intSlider); }
    if (volSlider) { volSlider.value = 0.5; updateSliderTrack(volSlider); }
  });
  updateStatusDisplay(`PRESET: ${presetKey}`);
}

// - FETCH WEATHER COORDINATES //

async function fetchWeatherByCoords(lat, lon, label) {
  weatherStatus.innerText = `FETCHING LIVE WEATHER FOR ${label.toUpperCase()}...`;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,rain,cloud_cover,wind_speed_10m&hourly=uv_index&forecast_days=1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("API failed");
    const data = await res.json();

    const curr = data.current;
    const uv = (data.hourly && data.hourly.uv_index) ? data.hourly.uv_index[0] : 2;

    currentLocationName = label;
    updateStatusDisplay(`LIVE: ${label}`);

    applyPreset(`${label}`, {
      temp: clamp((curr.temperature_2m + 10) / 50),
      humid: clamp(curr.relative_humidity_2m / 100),
      rain: clamp((curr.precipitation || curr.rain || 0) / 10),
      cloud: clamp(curr.cloud_cover / 100),
      wind: clamp(curr.wind_speed_10m / 50),
      sun: clamp(((100 - curr.cloud_cover) / 100) * 0.6 + (uv / 10) * 0.4)
    });
  } catch (err) {
    weatherStatus.innerText = `ERROR FETCHING WEATHER FOR ${label.toUpperCase()}`;
  }
}

// - SEARCH CITY //

async function searchCity(cityName) {
  if (!cityName.trim()) return;
  weatherStatus.innerText = `SEARCHING ${cityName.toUpperCase()}...`;
  try {
    const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cityName)}`;
    const res = await fetch(geoUrl);
    const data = await res.json();
    if (!data || data.length === 0) {
      weatherStatus.innerText = `CITY NOT FOUND: ${cityName.toUpperCase()}`;
      return;
    }
    await fetchWeatherByCoords(data[0].lat, data[0].lon, data[0].display_name.split(',')[0]);
  } catch (err) {
    weatherStatus.innerText = `GEOCODING ERROR FOR ${cityName.toUpperCase()}`;
  }
}

// - UPDATE LCD TICKER //

function updateStatusDisplay(prefix, timeLabel = null) {
  if (!weatherStatus) return;
  const t = (paramValues.temp.intensity * 50 - 10).toFixed(1);
  const h = Math.round(paramValues.humid.intensity * 100);
  const r = (paramValues.rain.intensity * 10).toFixed(1);
  const c = Math.round(paramValues.cloud.intensity * 100);
  const w = (paramValues.wind.intensity * 50).toFixed(1);
  const s = Math.round(paramValues.sun.intensity * 100);

  const timeTag = timeLabel ? ` (${timeLabel})` : '';
  const locationTag = `${currentLocationName.toUpperCase()}${timeTag}`;

  weatherStatus.innerText = `${prefix.toUpperCase()} - ${locationTag} | Temp: ${t}°C | Humid: ${h}% | Rain: ${r}mm/h | Cloud: ${c}% | Wind: ${w}km/h | Sun: ${s}%`;
  
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'KOPWASM Synthesizer',
      artist: `${currentLocationName.toUpperCase()}`,
      album: `Temp: ${t}°C | Rain: ${r}mm/h | Wind: ${w}km/h`
    });
  }
}

// - GENERATIVE SYNTH INSTRUMENTS - PD TO JS//

// - SUN / BELLS //

function triggerSunBell(time) {
  if (paramValues.sun.volume < 0.02) return;
  const minIdx = Math.floor(paramValues.sun.intensity * 6);
  const maxIdx = Math.min(SCALE.length - 1, minIdx + 8);
  const freq = SCALE[Math.floor(Math.random() * (maxIdx - minIdx + 1)) + minIdx];

  const osc = audioCtx.createOscillator();
  const env = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, time);
  env.gain.setValueAtTime(0.001, time);
  env.gain.linearRampToValueAtTime(0.3, time + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0001, time + 1.2 + Math.random() * 0.8);
  osc.connect(env); env.connect(channelGains.sun);
  osc.start(time); osc.stop(time + 2.5);
}

// - RAIN / KICK //

function playKick(time) {
  const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
  osc.frequency.setValueAtTime(60, time);
  osc.frequency.exponentialRampToValueAtTime(30, time + 0.15);
  gain.gain.setValueAtTime(0.6, time); gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
  osc.connect(gain); gain.connect(channelGains.rain);
  osc.start(time); osc.stop(time + 0.2);
}

// - RAIN/ HIGH HAT //

function playHat(time) {
  const src = audioCtx.createBufferSource(); src.buffer = noiseBuffer;
  const filter = audioCtx.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.setValueAtTime(7000, time);
  const gain = audioCtx.createGain(); 
  gain.gain.setValueAtTime(0.1 + Math.random() * 0.1, time); 
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
  src.connect(filter); filter.connect(gain); gain.connect(channelGains.rain);
  src.start(time); src.stop(time + 0.05);
}

// - HUMIDITY / ARPEGGIATOR //

function triggerHumidArp(time) {
  if (paramValues.humid.volume < 0.02) return;
  const intensity = paramValues.humid.intensity;
  if (intensity < 0.3 && stepIndex % 4 !== 0) return;
  if (intensity < 0.6 && stepIndex % 2 !== 0) return;

  const chord = CHORD_PROGRESSIONS[currentChordIdx];
  const baseNote = chord[stepIndex % chord.length];
  const octaveShift = (intensity > 0.5 && Math.random() < intensity) ? (Math.random() > 0.5 ? 5 : 10) : 0;
  const freq = SCALE[Math.min(SCALE.length - 1, baseNote + 3 + octaveShift)];

  const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
  osc.type = intensity > 0.7 ? 'square' : 'triangle';
  osc.frequency.setValueAtTime(freq, time);
  const decayTime = 0.6 - (intensity * 0.45);
  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(0.18, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, time + decayTime);
  osc.connect(gain); gain.connect(channelGains.humid);
  osc.start(time); osc.stop(time + decayTime + 0.05);
}

// - TICK CLOCK //

function tickClock() {
  if (!isEngineRunning || !audioCtx) return;

  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const now = audioCtx.currentTime;

  if (stepIndex % 32 === 0) {
    currentChordIdx = (currentChordIdx + 1) % CHORD_PROGRESSIONS.length;
    if (tempOsc) tempOsc.frequency.setTargetAtTime(SCALE[CHORD_PROGRESSIONS[currentChordIdx][0]] * 0.5, now, 0.5);
  }

  if (Math.random() < (paramValues.sun.intensity * 0.7 + 0.1)) triggerSunBell(now + Math.random() * 0.1);
  if (stepIndex % 2 === 0 || Math.random() < paramValues.rain.intensity) playHat(now);
  if ((stepIndex === 0 || stepIndex === 10) && paramValues.rain.intensity > 0.2) playKick(now);

  triggerHumidArp(now);
  stepIndex = (stepIndex + 1) % 64;
}

// - MEDIA SESSION SETUP //

function setupMediaSession() {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'KOPWASM Synthesizer',
      artist: currentLocationName.toUpperCase(),
      album: 'Weather Synth'
    });

    navigator.mediaSession.setActionHandler('play', async () => {
      if (audioCtx && audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      isEngineRunning = true;
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      if (audioCtx) audioCtx.suspend();
      isEngineRunning = false;
    });
  }
}

//  - POWER ON / ENGINE START //

async function startEngine() {
  if (navigator.audioSession) {
    navigator.audioSession.type = 'playback';
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }

  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  masterGain = audioCtx.createGain();
  masterGain.gain.setValueAtTime(0.001, audioCtx.currentTime);
  masterGain.gain.exponentialRampToValueAtTime(paramValues.master || 0.8, audioCtx.currentTime + 0.15);

  masterGain.connect(audioCtx.destination);

  Object.keys(channelGains).forEach(key => {
    channelGains[key] = audioCtx.createGain();
    channelGains[key].connect(masterGain);
  });

  noiseBuffer = generateNoiseBuffer(audioCtx);

  windNoiseSrc = audioCtx.createBufferSource();
  windNoiseSrc.buffer = noiseBuffer; windNoiseSrc.loop = true;
  windFilter = audioCtx.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.Q.value = 1.2;
  windNoiseSrc.connect(windFilter); windFilter.connect(channelGains.wind); windNoiseSrc.start();

  cloudFilter = audioCtx.createBiquadFilter(); cloudFilter.type = 'lowpass';
  cloudOscs = [110, 164.81, 220].map(f => {
    const o = audioCtx.createOscillator(); o.type = 'triangle';
    o.frequency.value = f; o.connect(cloudFilter); o.start(); return o;
  });
  cloudFilter.connect(channelGains.cloud);

  tempOsc = audioCtx.createOscillator(); tempOsc.type = 'sine';
  tempOsc.frequency.value = SCALE[0] * 0.5;
  tempFilter = audioCtx.createBiquadFilter(); tempFilter.type = 'lowpass';
  tempOsc.connect(tempFilter); tempFilter.connect(channelGains.temp); tempOsc.start();

  isEngineRunning = true;

  ['sun','wind','rain','cloud','humid','temp'].forEach(k => {
    updateParameter(k, 'intensity', paramValues[k].intensity);
    updateParameter(k, 'volume', paramValues[k].volume);
  });

  initAudioClock();
  setupMediaSession();
  requestWakeLock();

  btnRandom.removeAttribute('disabled');
  cityInput.removeAttribute('disabled');
  btnSearch.removeAttribute('disabled');
  masterSlider.removeAttribute('disabled');
  presetBtns.forEach(btn => btn.removeAttribute('disabled'));
  favBtns.forEach(btn => btn.removeAttribute('disabled'));

  ['sun','wind','rain','cloud','humid','temp'].forEach(k => {
    document.querySelector(`.${k}-int`).removeAttribute('disabled');
    document.querySelector(`.${k}-vol`).removeAttribute('disabled');
  });

  updateFavButtonStyles();
  applyPreset('temperate', PRESETS.temperate);
}

//  - POWER OFF / ENGINE STOP //

function stopEngine() {
  if (!audioCtx || !masterGain) return;
  isEngineRunning = false;

  if (clockNode) {
    clockNode.disconnect();
    clockNode = null;
  }
  if (clockDummyGain) {
    clockDummyGain.disconnect();
    clockDummyGain = null;
  }

  masterGain.gain.setValueAtTime(masterGain.gain.value, audioCtx.currentTime);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.15);

  setTimeout(() => {
    if (windNoiseSrc) windNoiseSrc.stop();
    cloudOscs.forEach(o => o.stop());
    if (tempOsc) tempOsc.stop();
    if (audioCtx && audioCtx.state !== 'closed') {
      audioCtx.suspend();
    }
    releaseWakeLock();
  }, 160);

  btnRandom.disabled = true;
  cityInput.disabled = true;
  btnSearch.disabled = true;
  masterSlider.disabled = true;
  presetBtns.forEach(btn => btn.disabled = true);
  favBtns.forEach(btn => btn.disabled = true);

  ['sun','wind','rain','cloud','humid','temp'].forEach(k => {
    document.querySelector(`.${k}-int`).disabled = true;
    document.querySelector(`.${k}-vol`).disabled = true;
  });

  currentLocationName = "OFFLINE";
  weatherStatus.innerText = "live: offline";
}

// - FAV BUTTONS //

function updateFavButtonStyles() {
  favBtns.forEach(btn => {
    const slot = btn.getAttribute('data-slot');
    const saved = localStorage.getItem(`kopwasm_fav_${slot}`);
    if (saved) {
      btn.classList.add('active-fav');
    } else {
      btn.classList.remove('active-fav');
    }
  });
}

function clearFavorite(btnElement) {
  const slot = btnElement.getAttribute('data-slot');
  localStorage.removeItem(`kopwasm_fav_${slot}`);
  updateFavButtonStyles();
  if (weatherStatus) weatherStatus.innerText = `RESET FAV ${slot}`;
}

// - CONTROLS LISTENERS //

powerToggle.addEventListener('change', (e) => { e.target.checked ? startEngine() : stopEngine(); });
btnSearch.addEventListener('click', () => searchCity(cityInput.value));
cityInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') searchCity(cityInput.value); });

['sun','wind','rain','cloud','humid','temp'].forEach(k => {
  document.querySelector(`.${k}-int`).addEventListener('input', (e) => {
    updateParameter(k, 'intensity', parseFloat(e.target.value));
    updateStatusDisplay("MANUAL EDIT");
  });
  document.querySelector(`.${k}-vol`).addEventListener('input', (e) => {
    updateParameter(k, 'volume', parseFloat(e.target.value));
    updateStatusDisplay("MANUAL EDIT");
  });
});

masterSlider.addEventListener('input', (e) => updateParameter('master', null, parseFloat(e.target.value)));

presetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const presetKey = btn.getAttribute('data-preset');
    if (PRESETS[presetKey]) applyPreset(presetKey, PRESETS[presetKey]);
  });
});

// - FAVORITE BUTTON EVENTS - CLICK, RIGHT CLICK, TOUCH LONG PRESS //

favBtns.forEach(btn => {
  let touchTimer = null;

  // - STANDARD CLICK - LOAD OR SAVE //
  
  btn.addEventListener('click', () => {
    const slot = btn.getAttribute('data-slot');
    const storageKey = `kopwasm_fav_${slot}`;
    const saved = localStorage.getItem(storageKey);

    if (!saved) {
      const now = new Date();
      const timestamp = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth()+1).toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

      const snap = {
        locationName: currentLocationName || `CUSTOM FAV ${slot}`,
        timestamp: timestamp,
        params: {}
      };

      ['sun','wind','rain','cloud','humid','temp'].forEach(k => { 
        snap.params[k] = { ...paramValues[k] }; 
      });

      localStorage.setItem(storageKey, JSON.stringify(snap));
      updateFavButtonStyles();
      updateStatusDisplay(`FAV ${slot}`, timestamp);
    } 
    else {
      const favData = JSON.parse(saved);
      const state = favData.params || favData;
      currentLocationName = favData.locationName || `FAV ${slot}`;
      const timestamp = favData.timestamp || null;

      Object.keys(state).forEach(ch => {
        if (paramValues[ch]) {
          updateParameter(ch, 'intensity', state[ch].intensity);
          updateParameter(ch, 'volume', state[ch].volume);
          const intEl = document.querySelector(`.${ch}-int`);
          const volEl = document.querySelector(`.${ch}-vol`);
          if (intEl) { intEl.value = state[ch].intensity; updateSliderTrack(intEl); }
          if (volEl) { volEl.value = state[ch].volume; updateSliderTrack(volEl); }
        }
      });

      updateStatusDisplay(`FAV ${slot}`, timestamp);
    }
  });

  // - DESKTOP - RIGHT CLICK RESET //
  
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    clearFavorite(btn);
  });

  // - MOBILE - LONG PRESS RESET 6s //
  
  btn.addEventListener('touchstart', () => {
    touchTimer = setTimeout(() => {
      clearFavorite(btn);
    }, 600);
  }, { passive: true });

  btn.addEventListener('touchend', () => {
    if (touchTimer) clearTimeout(touchTimer);
  });

  btn.addEventListener('touchmove', () => {
    if (touchTimer) clearTimeout(touchTimer);
  });
});

// - RANDOM MODE BUTTON //

btnRandom.addEventListener('click', () => {
  currentLocationName = "RANDOM";
  ['sun', 'wind', 'rain', 'cloud', 'humid', 'temp'].forEach(key => {
    const rndInt = Math.random();
    const rndVol = Math.random() * 0.8 + 0.2;
    updateParameter(key, 'intensity', rndInt);
    updateParameter(key, 'volume', rndVol);
    document.querySelector(`.${key}-int`).value = rndInt;
    document.querySelector(`.${key}-vol`).value = rndVol;
  });
  refreshAllSliderFills();
  updateStatusDisplay('RANDOM MODE');
});

// - RECORD AND EXPORT 30s BUTTON //

const exportBtn = document.getElementById('export-btn');

if (exportBtn) {
  exportBtn.addEventListener('click', record30SecRealtimeWav);
}

async function record30SecRealtimeWav() {
  if (!isEngineRunning || !audioCtx) {
    alert("Please turn on the synth power switch first!");
    return;
  }

  if (exportBtn) exportBtn.disabled = true;

  const destStreamNode = audioCtx.createMediaStreamDestination();
  masterGain.connect(destStreamNode);

  const mediaRecorder = new MediaRecorder(destStreamNode.stream);
  const audioChunks = [];

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    masterGain.disconnect(destStreamNode);

    if (weatherStatus) weatherStatus.innerText = "ENCODING WAV FILE...";

    const rawBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
    const arrayBuffer = await rawBlob.arrayBuffer();
    const decodedAudioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    const wavBlob = audioBufferToWavBlob(decodedAudioBuffer);
    const downloadUrl = URL.createObjectURL(wavBlob);

    const now = new Date();
    const timestamp = `${now.getDate().toString().padStart(2, '0')}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getFullYear()}_${now.getHours().toString().padStart(2, '0')}.${now.getMinutes().toString().padStart(2, '0')}.${now.getSeconds().toString().padStart(2, '0')}`;

    const downloadLink = document.createElement('a');
    downloadLink.href = downloadUrl;
    downloadLink.download = `KOPWASM-30s-Recording-${timestamp}.wav`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);

    updateStatusDisplay("EXPORT COMPLETE");
    if (exportBtn) exportBtn.disabled = false;
  };

  // - LCD RECORDING COUNTDOWN //
  
  mediaRecorder.start();

  let countdown = 30;
  if (weatherStatus) weatherStatus.innerText = `RECORDING WAV (${countdown}s)...`;

  const timer = setInterval(() => {
    countdown--;
    if (countdown > 0) {
      if (weatherStatus) weatherStatus.innerText = `RECORDING WAV (${countdown}s)...`;
    } else {
      clearInterval(timer);
      mediaRecorder.stop();
    }
  }, 1000);
}

// - PCM WAV BINARY ENCODER UTILITIES //

function audioBufferToWavBlob(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1;
  const bitDepth = 16;

  let result;
  if (numChannels === 2) {
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    result = interleave(left, right);
  } else {
    result = buffer.getChannelData(0);
  }

  const dataLength = result.length * 2;
  const bufferHeader = new ArrayBuffer(44 + dataLength);
  const view = new DataView(bufferHeader);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');

  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, bitDepth, true);

  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < result.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, result[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

function interleave(leftChannel, rightChannel) {
  const length = leftChannel.length + rightChannel.length;
  const result = new Float32Array(length);

  let inputIndex = 0;
  for (let index = 0; index < length; ) {
    result[index++] = leftChannel[inputIndex];
    result[index++] = rightChannel[inputIndex];
    inputIndex++;
  }
  return result;
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// - SLIDER COLOURS AND FILL //
// --- UPDATED SLIDER TRACK UTILITIES (HOISTED) ---
function updateSliderTrack(slider) {
  if (!slider) return;
  const min = slider.min ? parseFloat(slider.min) : 0;
  const max = slider.max ? parseFloat(slider.max) : 1;
  const val = ((parseFloat(slider.value) - min) / (max - min)) * 100;
  
  const isVol = slider.id === 'master-slider' || slider.classList.contains('vol-fader') || slider.className.includes('-vol');
  const color = isVol ? '#7bd855' : '#7f8c8d'; 

  slider.style.background = `linear-gradient(to right, ${color} 0%, ${color} ${val}%, #222222 ${val}%, #222222 100%)`;
}

function refreshAllSliderFills() {
  document.querySelectorAll('input[type="range"]').forEach(slider => {
    updateSliderTrack(slider);
  });
}

// --- DOM INITIALIZATION WRAPPER ---
document.addEventListener('DOMContentLoaded', () => {
  refreshAllSliderFills();
  document.querySelectorAll('input[type="range"]').forEach(slider => {
    slider.addEventListener('input', (e) => updateSliderTrack(e.target));
  });
});

