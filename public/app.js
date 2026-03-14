// Chat with May — Client
// Sections: Config → State → UI → Auth → Speech → TTS → Chat → Init

const $ = (id) => document.getElementById(id) || document.querySelector(id);
const API = window.__API_BASE || '';
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// ── State ──

const state = {
  mode: 'idle',
  authToken: localStorage.getItem('vc_token') || '',
  lastReply: '',
  speechRate: 1,
  ttsCharIndex: 0,
  mediaRecorder: null,
  audioChunks: [],
  audioContext: null,
  analyser: null,
  silenceTimer: null,
  audioUnlocked: false,
  ttsPaused: false,
  currentUtt: null,
  // Continuous listening
  micStream: null,       // persistent mic stream
  continuous: false,     // continuous mode active
  hasSpeech: false,      // did user speak in current segment
  speechStarted: false, // has user started speaking in current segment
};

// ── UI Helpers ──

function setMode(mode) {
  state.mode = mode;
  $('orb').className = mode;
  $('status-indicator').className = mode === 'idle' ? 'ready' : mode;
  const labels = {
    idle: state.continuous ? '🎙️ 對話中… 說話即可' : '按下麥克風開始說話',
    listening: '🔴 聆聽中…',
    processing: '思考中…',
    speaking: '回覆中…',
  };
  $('status-text').textContent = labels[mode] || '';
  $('mic-btn').classList.toggle('active', state.continuous);

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

// Logout
$('logout-btn').addEventListener('click', () => {
  // Stop TTS playback and microphone
  stopTTS();
  stopContinuous();
  localStorage.removeItem('vc_token');
  state.authToken = '';
  $('app').classList.add('hidden');
  $('auth-screen').classList.remove('hidden');
  $('auth-login').classList.remove('hidden');
  $('auth-register').classList.add('hidden');
  $('auth-pending').classList.add('hidden');
  $('auth-input').value = '';
  $('auth-error').textContent = '';
  $('auth-input').focus();
});

// View switching (login → register)
$('show-register').addEventListener('click', (e) => { e.preventDefault(); $('auth-login').classList.add('hidden'); $('auth-register').classList.remove('hidden'); });

// Registration
$('reg-btn').addEventListener('click', async () => {
  const name = $('reg-name').value.trim(), email = $('reg-email').value.trim();
  $('reg-status').textContent = '';
  if (!name || !email) {
    $('reg-status').textContent = '請填寫名字和 Email';
    $('reg-status').className = 'error';
    return;
  }

  $('reg-btn').disabled = true;
  $('reg-status').textContent = '處理中...';
  $('reg-status').className = '';

  try {
    const res = await fetch(`${API}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email })
    });
    const data = await res.json();
    if (data.ok) {
      $('auth-register').classList.add('hidden');
      $('auth-pending').classList.remove('hidden');
    } else {
      $('reg-status').textContent = data.error;
      $('reg-status').className = 'error';
    }
  } catch {
    $('reg-status').textContent = '連線失敗';
    $('reg-status').className = 'error';
  }
  $('reg-btn').disabled = false;
});

// ── Speech Recognition (Continuous Whisper) ──

async function initSpeech() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showText('您的瀏覽器不支援語音功能');
    return;
  }
}

// Open persistent mic stream and start continuous listening
async function startContinuous() {
  if (state.continuous) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.micStream = stream;
    state.continuous = true;

    // Audio analysis setup (persistent)
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') await audioContext.resume();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.fftSize = 256;
    state.audioContext = audioContext;
    state.analyser = analyser;

    beginSegment();
  } catch (err) {
    showText('無法開啟麥克風：' + err.message);
    setMode('idle');
  }
}

// Start recording a new segment on the existing mic stream
function beginSegment() {
  if (!state.continuous || !state.micStream) return;

  state.audioChunks = [];
  state.hasSpeech = false;
  state.listening = true;
  state.speechStarted = false;

  const recorder = new MediaRecorder(state.micStream);
  state.mediaRecorder = recorder;

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) state.audioChunks.push(e.data);
  };

  recorder.onstop = async () => {
    // Only process if user actually spoke
    if (state.hasSpeech && state.audioChunks.length > 0) {
      setMode('processing');
      const audioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });
      const text = await transcribeAudio(audioBlob);
      if (text && text.trim()) {
        sendToAI(text);
      } else {
        // No speech detected — resume listening
        if (state.continuous) {
          beginSegment();
          setMode('listening');
        } else {
          setMode('idle');
        }
      }
    } else {
      // No speech in segment — just restart
      if (state.continuous && !state.ttsPaused) {
        beginSegment();
        setMode('listening');
      }
    }
  };

  recorder.start();
  setMode('listening');

  // Silence detection loop for this segment
  const analyser = state.analyser;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  let lastSoundTime = Date.now();
  let speechStarted = false;
  const SILENCE_THRESHOLD = 40;
  const SILENCE_DURATION = 2000; // 2s pause after speech starts triggers processing

  const checkSilence = () => {
    if (!state.listening) return;
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
    const average = sum / bufferLength;

    if (average > SILENCE_THRESHOLD) {
      lastSoundTime = Date.now();
      if (!speechStarted) speechStarted = true;
      state.hasSpeech = true;
    } else if (speechStarted && Date.now() - lastSoundTime > SILENCE_DURATION) {
      // User spoke then went silent — submit this segment
      state.listening = false;
      if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
        state.mediaRecorder.stop();
      }
      return;
    }
    requestAnimationFrame(checkSilence);
  };
  requestAnimationFrame(checkSilence);
}

// Fully stop continuous mode and release mic
function stopContinuous() {
  state.continuous = false;
  state.listening = false;
  state.ttsPaused = false;

  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
  }
  if (state.micStream) {
    state.micStream.getTracks().forEach(track => track.stop());
    state.micStream = null;
  }
  if (state.audioContext) {
    state.audioContext.close();
    state.audioContext = null;
  }
  setMode('idle');
}

// Legacy compat aliases
function stopListening() {
  if (state.continuous) {
    stopContinuous();
  }
}

// Resume listening after TTS finishes
function resumeAfterTTS() {
  state.ttsPaused = false;
  if (state.continuous) {
    beginSegment();
  }
}

async function transcribeAudio(blob) {
  const formData = new FormData();
  formData.append('audio', blob);

  try {
    const res = await fetch(`${API}/api/transcribe`, {
      method: 'POST',
      headers: { 'x-auth-token': state.authToken },
      body: formData,
    });

    if (res.status === 401) { localStorage.removeItem('vc_token'); location.reload(); return null; }
    if (!res.ok) throw new Error('辨識失敗');

    const data = await res.json();
    return data.text;
  } catch (err) {
    console.error('Transcribe error:', err);
    return null;
  }
}

// Mic button — toggles continuous listening mode
onTap($('mic-btn'), () => {
  unlockAudio();
  if (state.continuous) {
    // Stop everything
    if (chatAbort) { chatAbort.abort(); chatAbort = null; }
    stopTTS();
    stopContinuous();
  } else {
    // Enter continuous mode
    if (chatAbort) { chatAbort.abort(); chatAbort = null; }
    stopTTS();
    startContinuous();
  }
});

// ── TTS ──

function stopTTS() {
  state.currentUtt = null;
  if (window.speechSynthesis) speechSynthesis.cancel();
}

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
  if (!slice || !window.speechSynthesis) {
    resumeAfterTTS();
    return;
  }

  stopTTS();
  setMode('speaking');

  // Prevent listening during TTS to avoid echo feedback
  state.ttsPaused = true;

  const safety = setTimeout(() => { stopTTS(); resumeAfterTTS(); }, 30000);
  const utt = new SpeechSynthesisUtterance(slice);
  state.currentUtt = utt;
  utt.lang = 'zh-TW';
  utt.rate = state.speechRate;
  const voice = getChineseVoice();
  if (voice) utt.voice = voice;

  utt.onboundary = (e) => { state.ttsCharIndex = fromIndex + e.charIndex; };
  utt.onend = () => {
    if (state.currentUtt !== utt) return;
    clearTimeout(safety);
    state.ttsCharIndex = 0;
    resumeAfterTTS();
  };
  utt.onerror = () => {
    if (state.currentUtt !== utt) return;
    clearTimeout(safety);
    resumeAfterTTS();
  };

  speechSynthesis.speak(utt);
}

// TTS controls
$('stop-btn').addEventListener('click', () => { stopTTS(); resumeAfterTTS(); });
$('replay-btn').addEventListener('click', () => { if (state.lastReply && state.mode !== 'processing') speak(state.lastReply); });

$('speed-slider').addEventListener('input', () => {
  state.speechRate = SPEEDS[$('speed-slider').value];
  $('speed-label').textContent = state.speechRate + 'x';
  if (state.mode === 'speaking' && state.lastReply) speak(state.lastReply, state.ttsCharIndex || 0);
});
$('speed-label').textContent = SPEEDS[$('speed-slider').value] + 'x';

if (window.speechSynthesis) { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices(); }

// ── Chat ──

let chatAbort = null; // current in-flight request controller

const ACK_PHRASES = ['收到', '我知道了', '好的', '明白', '我查一下', '稍等', '讓我想想'];
function randomAck() { return ACK_PHRASES[Math.floor(Math.random() * ACK_PHRASES.length)]; }

function speakAck() {
  if (!window.speechSynthesis) return;
  const utt = new SpeechSynthesisUtterance(randomAck());
  utt.lang = 'zh-TW';
  utt.rate = state.speechRate;
  const voice = getChineseVoice();
  if (voice) utt.voice = voice;
  speechSynthesis.speak(utt);
}

async function sendToAI(text) {
  stopTTS();
  if (chatAbort) { chatAbort.abort(); chatAbort = null; } // cancel previous request
  $('transcript').innerHTML = `<span class="processing-hint">處理中，請稍候…</span>`;
  speakAck();

  try {
    // Cancel any previous in-flight request
    if (chatAbort) chatAbort.abort();
    chatAbort = new AbortController();
    const timer = setTimeout(() => chatAbort?.abort(), 60000);
    const res = await fetch(`${API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': state.authToken },
      body: JSON.stringify({ message: text }),
      signal: chatAbort.signal,
    });
    clearTimeout(timer);
    chatAbort = null;

    if (res.status === 401) { localStorage.removeItem('vc_token'); location.reload(); return; }
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    const { reply } = await res.json();
    showText(reply);
    speak(reply);
  } catch (err) {
    if (err.name === 'AbortError') {
      if (!state.listening) showText('回覆超時，請重試');
    } else {
      showText(`錯誤：${err.message}`);
    }
    // Resume continuous listening on error
    if (state.continuous) {
      beginSegment();
      setMode('listening');
    } else {
      setMode('idle');
    }
  }
}

// Text input
$('send-btn').addEventListener('click', sendText);
$('text-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendText(); } });

function sendText() {
  const text = $('text-input').value.trim();
  if (!text || state.mode === 'processing') return;
  if (state.mode === 'speaking') stopTTS();
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
