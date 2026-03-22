/* ═══════════════════════════════════
   FAJR WAKE — App Logic
   ═══════════════════════════════════ */

// ─── State ───
let fajrTime = null;
let alarmArmed = false;
let alarmActive = false;
let dismissed = false;
let refPhoto = null;
let offset = 15;
let emergencySeconds = 30;
let emergencyInterval = null;
let cameraStream = null;
let cameraTarget = null;
let challenge = null;
let wakeLock = null;
let locationMode = null; // 'auto' | 'manual' | null

const $ = (id) => document.getElementById(id);

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
  refPhoto = localStorage.getItem('fajr_ref_photo');
  const savedArm = localStorage.getItem('fajr_armed') === 'true';
  const savedOffset = parseInt(localStorage.getItem('fajr_offset'));
  const savedCity = localStorage.getItem('fajr_city');
  const savedCountry = localStorage.getItem('fajr_country');

  if (!isNaN(savedOffset)) offset = savedOffset;
  updateOffsetDisplay();

  if (refPhoto) {
    showRefPhoto();
  } else {
    $('status-ref-missing').classList.remove('hidden');
  }

  updateClock();
  setInterval(updateClock, 1000);

  if (savedCity && savedCountry) {
    fetchFajrByCity(savedCity, savedCountry);
  } else {
    fetchFajrByGeo();
  }

  if (savedArm) {
    setTimeout(() => { if (fajrTime) { alarmArmed = true; updateArmButton(); } }, 2000);
  }

  registerSW();
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  setInterval(checkAlarm, 10000);
});

// ─── Clock ───
function updateClock() {
  const now = new Date();
  const str = now.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  $('clock').textContent = str;
  if ($('alarm-clock')) $('alarm-clock').textContent = str;
}

// ─── Fajr fetch ───
async function fetchFajrByGeo() {
  if (!navigator.geolocation) {
    showLocationNeedsManual('Géolocalisation non supportée');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const ts = Math.floor(Date.now() / 1000);
        const res = await fetch(`https://api.aladhan.com/v1/timings/${ts}?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}&method=2`);
        const json = await res.json();
        if (json.data?.timings?.Fajr) {
          locationMode = 'auto';
          setFajrTime(json.data.timings.Fajr);
          updateLocationUI();
        } else {
          showLocationNeedsManual('Données invalides');
        }
      } catch {
        showLocationNeedsManual('Erreur réseau');
      }
    },
    () => showLocationNeedsManual('Position refusée')
  );
}

async function fetchFajrByCity(city, country) {
  try {
    const res = await fetch(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=2`);
    const json = await res.json();
    if (json.data?.timings?.Fajr) {
      locationMode = 'manual';
      localStorage.setItem('fajr_city', city);
      localStorage.setItem('fajr_country', country);
      setFajrTime(json.data.timings.Fajr);
      updateLocationUI();
    } else {
      $('location-error').textContent = 'Ville non trouvée';
    }
  } catch {
    $('location-error').textContent = 'Erreur réseau';
  }
}

function submitManualCity() {
  const city = $('input-city').value.trim();
  const country = $('input-country').value.trim();
  if (city && country) fetchFajrByCity(city, country);
}

function showLocationNeedsManual(err) {
  $('location-error').textContent = err + '. Entre ta ville :';
  $('status-location-missing').classList.remove('hidden');
  // Settings location stays on manual form
  $('location-auto').classList.add('hidden');
  $('location-saved').classList.add('hidden');
  $('location-manual').classList.remove('hidden');
}

function showManualInputForce() {
  $('location-auto').classList.add('hidden');
  $('location-saved').classList.add('hidden');
  $('location-manual').classList.remove('hidden');
  $('location-error').textContent = '';
}

function updateLocationUI() {
  $('status-location-missing').classList.add('hidden');
  if (locationMode === 'auto') {
    $('location-auto').classList.remove('hidden');
    $('location-saved').classList.add('hidden');
    $('location-manual').classList.add('hidden');
  } else if (locationMode === 'manual') {
    const city = localStorage.getItem('fajr_city') || '';
    const country = localStorage.getItem('fajr_country') || '';
    $('location-city-display').textContent = city + ', ' + country;
    $('location-saved').classList.remove('hidden');
    $('location-auto').classList.add('hidden');
    $('location-manual').classList.add('hidden');
  }
}

function setFajrTime(time) {
  fajrTime = time;
  $('fajr-time').textContent = time;
  $('btn-arm').disabled = false;
  updateAlarmTimeDisplay();
}

// ─── Offset ───
function changeOffset(delta) {
  offset = Math.max(0, Math.min(60, offset + delta));
  localStorage.setItem('fajr_offset', offset);
  updateOffsetDisplay();
  updateAlarmTimeDisplay();
}

function updateOffsetDisplay() {
  $('offset-display').textContent = offset + ' min';
}

function updateAlarmTimeDisplay() {
  $('alarm-time-display').textContent = getAlarmTimeStr();
}

function getAlarmTimeStr() {
  if (!fajrTime) return '--:--';
  const [h, m] = fajrTime.split(':').map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0); d.setMinutes(d.getMinutes() - offset);
  return d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
}

function getAlarmHM() {
  if (!fajrTime) return null;
  const [h, m] = fajrTime.split(':').map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0); d.setMinutes(d.getMinutes() - offset);
  return { h: d.getHours(), m: d.getMinutes() };
}

// ─── Arm ───
function toggleArm() {
  alarmArmed = !alarmArmed;
  dismissed = false;
  localStorage.setItem('fajr_armed', alarmArmed ? 'true' : 'false');
  updateArmButton();
  if (alarmArmed) { acquireWakeLock(); scheduleNotification(); }
  else { releaseWakeLock(); }
}

function updateArmButton() {
  const btn = $('btn-arm');
  if (alarmArmed) {
    btn.textContent = '✓ Alarme activée — ' + getAlarmTimeStr();
    btn.classList.add('armed');
  } else {
    btn.textContent = 'Activer l\'alarme';
    btn.classList.remove('armed');
  }
  if (refPhoto) $('btn-test').classList.remove('hidden');
  else $('btn-test').classList.add('hidden');
}

// ─── Alarm check ───
function checkAlarm() {
  if (!alarmArmed || alarmActive || dismissed) return;
  const target = getAlarmHM();
  if (!target) return;
  const now = new Date();
  if (now.getHours() === target.h && now.getMinutes() === target.m) triggerAlarm();
}

function triggerAlarm() {
  alarmActive = true;
  showScreen('alarm');
  playAdhan();
  startEmergencyCountdown();
  fireNotification();

  $('alarm-comparing').classList.add('hidden');
  $('alarm-fail').classList.add('hidden');
  $('alarm-success').classList.add('hidden');
  $('alarm-actions').classList.remove('hidden');
  $('btn-alarm-back').classList.add('hidden');
  $('alarm-title').classList.add('shake');

  if (refPhoto) $('btn-photo-verify').classList.remove('hidden');
  else $('btn-photo-verify').classList.add('hidden');
}

// ─── Test with countdown ───
let testCountdownInterval = null;
let testSeconds = 60;

function testAlarm() {
  dismissed = false;
  testSeconds = 60;
  $('btn-test').classList.add('hidden');
  $('test-countdown').classList.remove('hidden');
  $('test-timer').textContent = testSeconds;

  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'SCHEDULE_TEST', delayMs: 60000 });
  }

  testCountdownInterval = setInterval(() => {
    testSeconds--;
    $('test-timer').textContent = testSeconds;
    if (testSeconds <= 0) {
      clearInterval(testCountdownInterval);
      $('test-countdown').classList.add('hidden');
      $('btn-test').classList.remove('hidden');
      triggerAlarm();
    }
  }, 1000);
}

function cancelTest() {
  clearInterval(testCountdownInterval);
  $('test-countdown').classList.add('hidden');
  $('btn-test').classList.remove('hidden');
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'CANCEL_TEST' });
  }
}

// ─── Audio ───
function playAdhan() {
  const audio = $('adhan-audio');
  audio.currentTime = 0; audio.volume = 1;
  audio.play().catch(() => playFallbackBeep());
}

function stopAdhan() {
  const audio = $('adhan-audio');
  audio.pause(); audio.currentTime = 0;
}

let beepInterval = null;
function playFallbackBeep() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  function beep() {
    [392, 440, 523].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.18); osc.stop(now + 0.7 + i * 0.18);
    });
  }
  beep();
  beepInterval = setInterval(beep, 1100);
}
function stopFallbackBeep() { if (beepInterval) { clearInterval(beepInterval); beepInterval = null; } }

// ─── Emergency countdown ───
function startEmergencyCountdown() {
  emergencySeconds = 30;
  $('emergency-countdown').classList.remove('hidden');
  $('btn-emergency').classList.add('hidden');
  $('emergency-timer').textContent = emergencySeconds;

  emergencyInterval = setInterval(() => {
    emergencySeconds--;
    $('emergency-timer').textContent = emergencySeconds;
    if (emergencySeconds <= 0) {
      clearInterval(emergencyInterval);
      $('emergency-countdown').classList.add('hidden');
      $('btn-emergency').classList.remove('hidden');
    }
  }, 1000);
}

// ─── Dismiss ───
function dismissAlarm() {
  alarmActive = false; alarmArmed = false; dismissed = true;
  localStorage.setItem('fajr_armed', 'false');
  stopAdhan(); stopFallbackBeep();
  clearInterval(emergencyInterval);
  releaseWakeLock();
}

function goHome() { showScreen('home'); updateArmButton(); }

// ─── Camera ───
async function startCamera(target) {
  cameraTarget = target;
  showScreen('camera');
  $('camera-hint').textContent = target === 'ref'
    ? 'Prends une photo de ton évier — ce sera ta référence'
    : 'Photographie ton évier pour couper l\'alarme';
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:'environment', width:640, height:480 } });
    $('camera-video').srcObject = cameraStream;
  } catch {
    alert('Impossible d\'accéder à la caméra');
    showScreen(alarmActive ? 'alarm' : 'settings');
  }
}

function stopCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
}

function cancelCamera() {
  stopCamera();
  showScreen(alarmActive ? 'alarm' : 'settings');
}

async function capturePhoto() {
  const video = $('camera-video');
  if (!video) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  stopCamera();

  if (cameraTarget === 'ref') {
    refPhoto = dataUrl;
    localStorage.setItem('fajr_ref_photo', dataUrl);
    showRefPhoto();
    $('status-ref-missing').classList.add('hidden');
    showScreen('settings');
    updateArmButton();
  } else {
    showScreen('alarm');
    $('alarm-comparing').classList.remove('hidden');
    $('alarm-fail').classList.add('hidden');
    try {
      const score = await compareImages(refPhoto, dataUrl);
      $('alarm-comparing').classList.add('hidden');
      if (score >= 0.52) {
        $('alarm-success').classList.remove('hidden');
        $('alarm-actions').classList.add('hidden');
        $('btn-alarm-back').classList.remove('hidden');
        $('alarm-title').classList.remove('shake');
        dismissAlarm();
      } else {
        $('alarm-fail').classList.remove('hidden');
      }
    } catch {
      $('alarm-comparing').classList.add('hidden');
      $('alarm-fail').classList.remove('hidden');
    }
  }
}

function showRefPhoto() {
  $('ref-empty').classList.add('hidden');
  $('ref-filled').classList.remove('hidden');
  $('ref-img').src = refPhoto;
}

function deleteRef() {
  refPhoto = null;
  localStorage.removeItem('fajr_ref_photo');
  $('ref-empty').classList.remove('hidden');
  $('ref-filled').classList.add('hidden');
  $('status-ref-missing').classList.remove('hidden');
  updateArmButton();
}

// ─── Image comparison ───
function getImageData(src) {
  return new Promise((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 64, 64);
      resolve(ctx.getImageData(0, 0, 64, 64));
    };
    img.onerror = reject; img.src = src;
  });
}

function computeHistogram(imageData) {
  const { data } = imageData;
  const rH = new Float32Array(16), gH = new Float32Array(16), bH = new Float32Array(16);
  const total = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    rH[Math.floor(data[i]/16)]++; gH[Math.floor(data[i+1]/16)]++; bH[Math.floor(data[i+2]/16)]++;
  }
  for (let i = 0; i < 16; i++) { rH[i]/=total; gH[i]/=total; bH[i]/=total; }
  return { rH, gH, bH };
}

async function compareImages(ref, test) {
  const [d1, d2] = await Promise.all([getImageData(ref), getImageData(test)]);
  const h1 = computeHistogram(d1), h2 = computeHistogram(d2);
  let s = 0;
  for (let i = 0; i < 16; i++) { s += Math.min(h1.rH[i],h2.rH[i]) + Math.min(h1.gH[i],h2.gH[i]) + Math.min(h1.bH[i],h2.bH[i]); }
  return s / 3;
}

// ─── Emergency ───
function startEmergency() {
  challenge = generateChallenge();
  $('challenge-question').textContent = challenge.q;
  $('challenge-input').value = '';
  $('challenge-error').classList.add('hidden');
  showScreen('emergency');
  $('challenge-input').focus();
}

function generateChallenge() {
  const ops = [
    () => { const a=2+Math.floor(Math.random()*8), b=2+Math.floor(Math.random()*8); return {q:`${a} × ${b}`,a:a*b}; },
    () => { const a=10+Math.floor(Math.random()*40), b=10+Math.floor(Math.random()*40); return {q:`${a} + ${b}`,a:a+b}; },
    () => { const a=2+Math.floor(Math.random()*9), b=2+Math.floor(Math.random()*5); return {q:`${a*b} ÷ ${a}`,a:b}; },
    () => { const a=10+Math.floor(Math.random()*50), b=3+Math.floor(Math.random()*15); return {q:`${a} − ${b}`,a:a-b}; },
  ];
  return ops[Math.floor(Math.random()*ops.length)]();
}

function submitChallenge() {
  if (!challenge) return;
  if (parseInt($('challenge-input').value) === challenge.a) {
    dismissAlarm(); showScreen('home'); updateArmButton();
  } else {
    $('challenge-error').classList.remove('hidden');
    challenge = generateChallenge();
    $('challenge-question').textContent = challenge.q;
    $('challenge-input').value = '';
    $('challenge-input').focus();
  }
}

// ─── Screens ───
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
}

// ─── Wake Lock ───
async function acquireWakeLock() {
  if ('wakeLock' in navigator) {
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
  }
}
function releaseWakeLock() { if (wakeLock) { wakeLock.release(); wakeLock = null; } }

// ─── Notifications ───
function fireNotification() {
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification('🌙 Fajr Wake — Lève-toi !', {
      body: 'Il est l\'heure de la prière du Fajr',
      tag: 'fajr-alarm', requireInteraction: true,
      vibrate: [500,200,500,200,500],
    });
    n.onclick = () => { window.focus(); n.close(); };
  }
}

function scheduleNotification() {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    const target = getAlarmHM();
    if (target) {
      navigator.serviceWorker.controller.postMessage({ type:'SCHEDULE_ALARM', hour:target.h, minute:target.m });
    }
  }
}

// ─── Service Worker ───
async function registerSW() {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data.type === 'ALARM_TRIGGER' && alarmArmed && !alarmActive && !dismissed) triggerAlarm();
      });
    } catch (e) { console.log('SW fail:', e); }
  }
}
