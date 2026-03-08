// Chat with May — Client
// Sections: Config → State → UI → Auth → Speech → TTS → Chat → Init

const $ = (id) => document.getElementById(id) || document.querySelector(id);
const API = window.__API_BASE || '';
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// ── State ──

const state = {
  mode: 'idle',        // idle | listening | processing | speaking
  authToken: localStorage.getItem('vc_token') || '',
  lastReply: '',
  speechRate: 1,
  ttsCharIndex: 0,
  recognition: null,
  transcript: '',
  silenceTimer: null,
  audioUnlocked: false,
};

// ── UI Helpers ──

function setMode(mode) {
  state.mode = mode;
  $('orb').className = mode;
  $('status-indicator').className = mode === 'idle' ? 'ready' : mode;
  $('status-text').textContent = { idle: '按下麥克風開始說話', listening: '🔴 聆聽中… 再按一次停止', processing: '思考中…', speaking: '回覆中…' }[mode] || '';
  $('mic-btn').classList.toggle('active', mode === 'listening');

  const busy = mode === 'processing' || mode === 'speaking';
  $('text-input').disabled = busy;
  $('send-btn').disabled = busy;
  $('text-input').placeholder = busy ? (mode === 'processing' ? '處理中…' : '回覆中…') : '輸入訊息…';
}

function showText(text) { $('transcript').textContent = text; }

// Prevent ghost double-tap on mobile
function onTap(el, handler) {
  let lastTap = 0;
  el.addEventListener('touchend', (e) => { e.preventDefault(); lastTap = Date.now(); handler(); });
  el.addEventListener('click', () => { if (Date.now() - lastTap > 500) handler(); });
}

// ── Auth ──

async function apiAuth(token) {
  try {
    const res = await fetch(`${API}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    return (await res.json()).ok === true;
  } catch { return false; }
}

function enterApp() {
  $('auth-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  initSpeech();
  setMode('idle');
}

// Password login
$('auth-btn').addEventListener('click', doLogin);
$('auth-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  const token = $('auth-input').value.trim();
  if (!token) return;
  $('auth-btn').disabled = true;
  $('auth-error').textContent = '';

  if (await apiAuth(token)) {
    state.authToken = token;
    localStorage.setItem('vc_token', token);
    enterApp();
  } else {
    $('auth-error').textContent = '通行碼錯誤';
    $('auth-input').value = '';
    $('auth-input').focus();
  }
  $('auth-btn').disabled = false;
}

// View switching (login ↔ register)
$('show-register').addEventListener('click', (e) => { e.preventDefault(); $('auth-login').classList.add('hidden'); $('auth-register').classList.remove('hidden'); });
$('show-login').addEventListener('click', (e) => { e.preventDefault(); $('auth-register').classList.add('hidden'); $('auth-login').classList.remove('hidden'); });

// Registration
$('reg-btn').addEventListener('click', async () => {
  const name = $('reg-name').value.trim(), email = $('reg-email').value.trim();
  $('reg-status').textContent = '';
  if (!name || !email) { $('reg-status').textContent = '請填寫名字和 Email'; $('reg-status').className = 'error'; return; }

  $('reg-btn').disabled = true;
  try {
    const res = await fetch(`${API}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email }) });
    const data = await res.json();
    if (data.ok) { $('auth-register').classList.add('hidden'); $('auth-pending').classList.remove('hidden'); }
    else { $('reg-status').textContent = data.error; $('reg-status').className = 'error'; }
  } catch { $('reg-status').textContent = '連線失敗'; $('reg-status').className = 'error'; }
  $('reg-btn').disabled = false;
});

// ── Speech Recognition ──

function initSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;

  const rec = new SR();
  rec.lang = 'zh-TW';
  rec.continuous = true;
  rec.interimResults = true;

  let networkErrors = 0;

  rec.onresult = (e) => {
    clearTimeout(state.silenceTimer);
    let final = '', interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
    }
    state.transcript = final;
    showText(final + interim);

    state.silenceTimer = setTimeout(() => {
      if (state.mode === 'listening' && state.transcript.trim()) stopListening();
    }, 2000);
  };

  rec.onerror = (e) => {
    if (e.error === 'not-allowed') { showText('請允許麥克風權限'); setMode('idle'); return; }
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    if (e.error === 'network') {
      if (++networkErrors >= 3) { showText('語音辨識無法連線，請用輸入框打字'); setMode('idle'); networkErrors = 0; return; }
      showText('重新連線中…');
      setTimeout(() => { if (state.mode === 'listening') try { rec.start(); } catch {} }, 1500);
      return;
    }
  };

  rec.onend = () => { if (state.mode === 'listening') try { rec.start(); } catch {} };

  state.recognition = rec;
}

function startListening() {
  if (!state.recognition) { showText('請使用 Chrome 瀏覽器'); return; }
  state.transcript = '';
  showText('');
  try { state.recognition.start(); setMode('listening'); } catch {
    state.recognition.stop();
    setTimeout(() => { try { state.recognition.start(); setMode('listening'); } catch {} }, 200);
  }
}

function stopListening() {
  clearTimeout(state.silenceTimer);
  state.recognition?.stop();
  const text = state.transcript.trim();
  if (text) { setMode('processing'); sendToAI(text); } else setMode('idle');
}

// Mic button
onTap($('mic-btn'), () => {
  unlockAudio();
  if (state.mode === 'idle') startListening();
  else if (state.mode === 'listening') stopListening();
  else if (state.mode === 'speaking') { speechSynthesis.cancel(); setMode('idle'); }
});

// ── TTS ──

function unlockAudio() {
  if (state.audioUnlocked || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(''); u.volume = 0;
  speechSynthesis.speak(u);
  state.audioUnlocked = true;
}

function getChineseVoice() {
  const voices = speechSynthesis.getVoices();
  return voices.find(v => v.lang.includes('zh') && v.localService)
    || voices.find(v => v.lang.startsWith('zh-TW'))
    || voices.find(v => v.lang.startsWith('zh'));
}

function speak(text, fromIndex = 0) {
  state.lastReply = text;
  $('tts-controls').classList.remove('hidden');
  if (fromIndex === 0) state.ttsCharIndex = 0;

  const slice = text.slice(fromIndex);
  if (!slice || !window.speechSynthesis) { setMode('idle'); return; }

  speechSynthesis.cancel();
  setMode('speaking');

  const safety = setTimeout(() => { speechSynthesis.cancel(); setMode('idle'); }, 30000);
  const utt = new SpeechSynthesisUtterance(slice);
  utt.lang = 'zh-TW';
  utt.rate = state.speechRate;
  const voice = getChineseVoice();
  if (voice) utt.voice = voice;

  utt.onboundary = (e) => { state.ttsCharIndex = fromIndex + e.charIndex; };
  utt.onend = () => { clearTimeout(safety); state.ttsCharIndex = 0; setMode('idle'); };
  utt.onerror = () => { clearTimeout(safety); setMode('idle'); };

  speechSynthesis.speak(utt);
}

// TTS controls
$('stop-btn').addEventListener('click', () => { speechSynthesis?.cancel(); setMode('idle'); });
$('replay-btn').addEventListener('click', () => { if (state.lastReply && state.mode !== 'processing') speak(state.lastReply); });

$('speed-slider').addEventListener('input', () => {
  state.speechRate = SPEEDS[$('speed-slider').value];
  $('speed-label').textContent = state.speechRate + 'x';
  if (state.mode === 'speaking' && state.lastReply) speak(state.lastReply, state.ttsCharIndex || 0);
});
$('speed-label').textContent = SPEEDS[$('speed-slider').value] + 'x';

if (window.speechSynthesis) { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices(); }

// ── Chat ──

async function sendToAI(text) {
  $('transcript').innerHTML = `<span style="color:var(--text-dim);font-size:13px">你說：</span> ${text}<br><span class="processing-hint">處理中，請稍候…</span>`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    const res = await fetch(`${API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': state.authToken },
      body: JSON.stringify({ message: text }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    const { reply } = await res.json();
    showText(reply);
    speak(reply);
  } catch (err) {
    showText(err.name === 'AbortError' ? '回覆超時，請重試' : `錯誤：${err.message}`);
    setMode('idle');
  }
}

// Text input
$('send-btn').addEventListener('click', sendText);
$('text-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendText(); } });

function sendText() {
  const text = $('text-input').value.trim();
  if (!text || state.mode === 'processing' || state.mode === 'speaking') return;
  $('text-input').value = '';
  setMode('processing');
  sendToAI(text);
}

// ── Init ──

(async () => {
  if (state.authToken && await apiAuth(state.authToken)) {
    enterApp();
  } else {
    localStorage.removeItem('vc_token');
    state.authToken = '';
    $('auth-screen').classList.remove('hidden');
    $('auth-input').focus();
  }
})();
