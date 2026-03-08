// Voice Chat App — Main Client

const $ = (sel) => document.querySelector(sel);

const state = {
  mode: 'idle',
  recognition: null,
  finalTranscript: '',
  interimTranscript: '',
  silenceTimer: null,
  SILENCE_TIMEOUT: 2000,
  useWebSpeech: false,
  audioUnlocked: false,
};

const ui = {
  orb: $('#orb'),
  micBtn: $('#mic-btn'),
  statusIndicator: $('#status-indicator'),
  statusText: $('#status-text'),
  transcript: $('#transcript'),
};

// ── State transitions ──
function setMode(mode) {
  console.log('setMode:', state.mode, '->', mode);
  state.mode = mode;
  ui.orb.className = mode;
  ui.statusIndicator.className = mode === 'idle' ? 'ready' : mode;

  const labels = {
    idle: '按下麥克風開始說話',
    listening: '🔴 聆聽中… 再按一次停止',
    processing: '思考中…',
    speaking: '回覆中…',
  };
  ui.statusText.textContent = labels[mode] || '';
  ui.micBtn.classList.toggle('active', mode === 'listening');
}

function showError(msg) {
  ui.transcript.textContent = msg;
}

// ── Detect speech support ──
function detectSpeechSupport() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  state.useWebSpeech = !!SR;
  console.log('Web Speech API:', state.useWebSpeech ? 'yes' : 'no');
}

// ── Web Speech API ──
function initRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;

  const rec = new SR();
  rec.lang = 'zh-TW';
  rec.continuous = true;
  rec.interimResults = true;

  rec.onresult = (event) => {
    clearTimeout(state.silenceTimer);
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        state.finalTranscript += event.results[i][0].transcript;
      } else {
        interim += event.results[i][0].transcript;
      }
    }
    state.interimTranscript = interim;
    ui.transcript.textContent = state.finalTranscript + interim;

    // Auto-stop after silence
    state.silenceTimer = setTimeout(() => {
      if (state.mode === 'listening' && state.finalTranscript.trim()) {
        stopListening();
      }
    }, state.SILENCE_TIMEOUT);
  };

  rec.onerror = (event) => {
    console.error('Speech error:', event.error);
    if (event.error === 'not-allowed') {
      showError('請允許麥克風權限');
      setMode('idle');
    } else if (event.error === 'no-speech' || event.error === 'aborted') {
      return; // ignore, will auto-restart via onend
    } else if (event.error === 'network') {
      // Network error — retry after a short delay
      console.log('Network error, retrying...');
      ui.transcript.textContent = '網路重新連線中…';
      setTimeout(() => {
        if (state.mode === 'listening') {
          try { rec.start(); } catch (e) { console.log('retry failed:', e); }
        }
      }, 1000);
      return;
    }
    // Other errors — don't reset if still listening
    if (state.mode !== 'listening') setMode('idle');
  };

  rec.onend = () => {
    console.log('recognition onend, mode:', state.mode);
    if (state.mode === 'listening') {
      try { rec.start(); } catch (e) { console.log('restart failed:', e); }
    }
  };

  return rec;
}

// ── Mic button ──
function handleMicAction() {
  // Unlock audio on first interaction
  unlockAudio();

  if (state.mode === 'idle') {
    startListening();
  } else if (state.mode === 'listening') {
    stopListening();
  } else if (state.mode === 'speaking') {
    // Allow interrupting TTS
    speechSynthesis.cancel();
    setMode('idle');
  }
}

// Prevent both click and touchend from firing
let lastTapTime = 0;
ui.micBtn.addEventListener('touchend', (e) => {
  e.preventDefault();
  lastTapTime = Date.now();
  handleMicAction();
});

ui.micBtn.addEventListener('click', (e) => {
  if (Date.now() - lastTapTime < 500) return; // skip if touch just fired
  handleMicAction();
});

function startListening() {
  state.finalTranscript = '';
  state.interimTranscript = '';
  ui.transcript.textContent = '';

  if (state.useWebSpeech) {
    if (!state.recognition) state.recognition = initRecognition();
    if (!state.recognition) { showError('語音辨識不可用'); return; }

    try {
      state.recognition.start();
      setMode('listening');
    } catch (err) {
      // Might be already started
      state.recognition.stop();
      setTimeout(() => {
        try {
          state.recognition.start();
          setMode('listening');
        } catch (e) {
          showError('無法啟動語音辨識');
        }
      }, 200);
    }
  } else {
    showError('請使用 Chrome 瀏覽器');
  }
}

function stopListening() {
  clearTimeout(state.silenceTimer);
  if (state.recognition) state.recognition.stop();

  const text = state.finalTranscript.trim();
  if (text) {
    setMode('processing');
    sendToAI(text);
  } else {
    setMode('idle');
  }
}

// ── AI Chat ──
async function sendToAI(text) {
  ui.transcript.textContent = '🗣️ ' + text;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    ui.transcript.textContent = data.reply;

    // Try TTS, but always return to idle
    await speakReply(data.reply);

  } catch (err) {
    console.error('AI error:', err);
    if (err.name === 'AbortError') {
      showError('回覆超時，請重試');
    } else {
      showError('錯誤：' + err.message);
    }
    setMode('idle');
  }
}

// ── TTS ──
// Unlock audio context on first user interaction (required on mobile)
function unlockAudio() {
  if (state.audioUnlocked) return;
  if (window.speechSynthesis) {
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    speechSynthesis.speak(u);
    state.audioUnlocked = true;
    console.log('Audio unlocked');
  }
}

function speakReply(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) {
      console.log('No speechSynthesis');
      setMode('idle');
      resolve();
      return;
    }

    setMode('speaking');

    // Safety timeout — if TTS hangs, force idle after 15s
    const safetyTimeout = setTimeout(() => {
      console.warn('TTS safety timeout');
      speechSynthesis.cancel();
      setMode('idle');
      resolve();
    }, 15000);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-TW';
    utterance.rate = 1.05;

    // Pick a Chinese voice
    const voices = speechSynthesis.getVoices();
    const zhVoice = voices.find(v => v.lang.includes('zh') && v.localService)
      || voices.find(v => v.lang.startsWith('zh-TW'))
      || voices.find(v => v.lang.startsWith('zh'));
    if (zhVoice) {
      utterance.voice = zhVoice;
      console.log('Using voice:', zhVoice.name);
    }

    utterance.onend = () => {
      clearTimeout(safetyTimeout);
      console.log('TTS finished');
      setMode('idle');
      resolve();
    };

    utterance.onerror = (e) => {
      clearTimeout(safetyTimeout);
      console.error('TTS error:', e);
      setMode('idle');
      resolve();
    };

    speechSynthesis.speak(utterance);
  });
}

// Preload voices
if (window.speechSynthesis) {
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => {
    const voices = speechSynthesis.getVoices();
    console.log('Voices loaded:', voices.length);
  };
}

// ── Init ──
async function init() {
  detectSpeechSupport();
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (data.status === 'ok') {
      setMode('idle');
    }
  } catch {
    showError('連線失敗，請重新整理');
  }
}

init();
