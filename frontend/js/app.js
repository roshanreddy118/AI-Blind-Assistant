/**
 * AI Blind Assistant — Main Application Controller
 * Handles live scene analysis loop, obstacle alerts, and user interaction.
 */

(function () {
    'use strict';

    const camera = new CameraManager();
    const audio = new AudioEngine();

    // API base URL — auto-detect local vs deployed
    const API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? `http://${window.location.hostname}:8000`
        : '';  // same origin on Vercel

    // State
    const state = {
        active: false,
        language: 'en',
        autoNarrate: true,
        obstacleAlerts: true,
        haptic: true,
        interval: 3000,
        lastNarration: '',
        scanTimer: null,
        analyzing: false,
        wakeLock: null,
    };

    // ---- Wake Lock (prevent phone screen from sleeping) ----

    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                state.wakeLock = await navigator.wakeLock.request('screen');
                state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
                console.log('Wake lock acquired — screen will stay on');
            }
        } catch (e) {
            console.log('Wake lock not available:', e.message);
        }
    }

    function releaseWakeLock() {
        if (state.wakeLock) {
            state.wakeLock.release();
            state.wakeLock = null;
        }
    }

    // Re-acquire wake lock when tab becomes visible again (phone unlocked)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && state.active) {
            requestWakeLock();
        }
    });

    // ---- Init ----

    document.addEventListener('DOMContentLoaded', () => {
        wireUI();
        loadSettings();
        showWelcomeIfFirstVisit();
        startVoiceCommands();
    });

    // ---- Voice Command Language Map ----

    const LANG_MAP = {
        'english': 'en', 'hindi': 'hi', 'tamil': 'ta', 'telugu': 'te',
        'kannada': 'kn', 'malayalam': 'ml', 'bengali': 'bn', 'marathi': 'mr',
        'gujarati': 'gu', 'punjabi': 'pa', 'urdu': 'ur',
        'spanish': 'es', 'french': 'fr', 'arabic': 'ar',
    };

    function wireUI() {
        const startBtn = el('btn-start');
        const stopBtn = el('btn-stop');

        startBtn.addEventListener('click', startAssistant);

        if (stopBtn) {
            stopBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                stopAssistant();
            });
        }

        el('btn-describe')?.addEventListener('click', describeScene);
        el('btn-read')?.addEventListener('click', readText);
        el('btn-ask')?.addEventListener('click', () => toggleModal('ask-modal', true));
        el('btn-repeat')?.addEventListener('click', repeatLast);

        el('btn-close-ask')?.addEventListener('click', () => toggleModal('ask-modal', false));
        el('btn-send-ask')?.addEventListener('click', sendQuestion);
        el('btn-voice-ask')?.addEventListener('click', voiceQuestion);
        el('question-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendQuestion();
        });

        el('btn-settings')?.addEventListener('click', () => toggleModal('settings-modal', true));
        el('btn-close-settings')?.addEventListener('click', () => toggleModal('settings-modal', false));

        el('setting-language')?.addEventListener('change', (e) => {
            state.language = e.target.value;
            audio.setLanguage(state.language);
            saveSettings();
        });

        el('setting-auto-narrate')?.addEventListener('change', (e) => {
            state.autoNarrate = e.target.checked;
            saveSettings();
        });

        el('setting-obstacle-alerts')?.addEventListener('change', (e) => {
            state.obstacleAlerts = e.target.checked;
            saveSettings();
        });

        el('setting-haptic')?.addEventListener('change', (e) => {
            state.haptic = e.target.checked;
            audio.hapticEnabled = e.target.checked;
            saveSettings();
        });

        el('setting-interval')?.addEventListener('input', (e) => {
            state.interval = parseInt(e.target.value) * 1000;
            el('interval-value').textContent = e.target.value + 's';
            saveSettings();
        });

        el('setting-rate')?.addEventListener('input', (e) => {
            audio.rate = parseFloat(e.target.value);
            el('rate-value').textContent = parseFloat(e.target.value).toFixed(1) + 'x';
            saveSettings();
        });

        document.querySelectorAll('.modal-backdrop').forEach(bd => {
            bd.addEventListener('click', () => {
                document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
            }
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.key === ' ') {
                e.preventDefault();
                state.active ? stopAssistant() : startAssistant();
            }
        });
    }

    // ---- Welcome / Onboarding ----

    function showWelcomeIfFirstVisit() {
        if (localStorage.getItem('aiblind_welcomed')) return;

        const modal = el('welcome-modal');
        if (!modal) return;

        toggleModal('welcome-modal', true);

        // Auto-speak the welcome message after a short delay
        setTimeout(() => {
            audio.speak(
                'Welcome to AI Blind Assistant. Your AI-powered eyes. ' +
                'This app describes scenes, reads text, detects obstacles, and answers questions, all spoken aloud. ' +
                'Tap the Start button to begin. You can also use voice commands.'
            );
        }, 500);

        el('btn-close-welcome')?.addEventListener('click', () => {
            toggleModal('welcome-modal', false);
            localStorage.setItem('aiblind_welcomed', '1');
            audio.stop();
        });
    }

    // ---- Start / Stop ----

    async function startAssistant() {
        if (state.active) return;

        const btn = el('btn-start');
        btn.querySelector('.mega-label').textContent = 'Starting...';

        try {
            await camera.start();
            state.active = true;

            // Keep phone screen on
            await requestWakeLock();

            // Resume AudioContext if suspended (mobile requires gesture)
            if (audio.audioContext && audio.audioContext.state === 'suspended') {
                audio.audioContext.resume();
            }

            el('btn-start').closest('.action-zone').classList.add('hidden');
            el('active-panel').classList.remove('hidden');

            // Show scan line + status ring
            const scanLine = el('scan-line');
            const statusRing = el('status-ring');
            if (scanLine) scanLine.style.display = '';
            if (statusRing) statusRing.style.display = '';

            audio.speak('Assistant started. Scanning your surroundings.');

            if (state.autoNarrate) {
                startScanLoop();
            }

            toast('Assistant active', 'success');
        } catch (err) {
            btn.querySelector('.mega-label').textContent = 'Tap to Start';
            audio.speakUrgent(err.message);
            toast(err.message, 'error');
        }
    }

    function stopAssistant() {
        state.active = false;
        state.analyzing = false;
        stopScanLoop();
        camera.stop();
        audio.stop();
        releaseWakeLock();

        el('active-panel').classList.add('hidden');
        const startZone = document.querySelector('.action-zone');
        if (startZone) startZone.classList.remove('hidden');
        el('btn-start').querySelector('.mega-label').textContent = 'Tap to Start';

        // Hide scan line + status ring
        const scanLine = el('scan-line');
        const statusRing = el('status-ring');
        if (scanLine) scanLine.style.display = 'none';
        if (statusRing) statusRing.style.display = 'none';

        clearObstacleAlerts();
        setTimeout(() => audio.speak('Assistant stopped.'), 100);
    }

    // ---- Continuous Scan Loop ----

    function startScanLoop() {
        stopScanLoop();
        analyzeCurrent();
        state.scanTimer = setInterval(() => {
            // Don't scan while still speaking — wait for speech + 2s pause
            if (state.active && state.autoNarrate && !state.analyzing && !audio.isSpeaking) {
                analyzeCurrent();
            }
        }, state.interval + 2000); // add 2sec pause between scans
    }

    function stopScanLoop() {
        if (state.scanTimer) {
            clearInterval(state.scanTimer);
            state.scanTimer = null;
        }
    }

    async function analyzeCurrent() {
        if (state.analyzing || !state.active) return;
        state.analyzing = true;

        const blob = await camera.captureBlob();
        if (!blob || !state.active) {
            state.analyzing = false;
            return;
        }

        try {
            const formData = new FormData();
            formData.append('file', blob, 'frame.jpg');

            const res = await fetch(`${API}/api/analyze?language=${state.language}`, {
                method: 'POST',
                body: formData,
            });

            if (!state.active) return;
            if (!res.ok) throw new Error('Analysis failed');

            const data = await res.json();

            if (data.narration && !isSimilar(data.narration, state.lastNarration)) {
                state.lastNarration = data.narration;
                updateNarration(data.narration);
                audio.speak(data.narration, data.audio || '');
            }

        } catch (err) {
            console.error('Analysis error:', err);
        } finally {
            state.analyzing = false;
        }
    }

    // ---- Scene Description (on-demand) ----

    async function describeScene() {
        audio.speak('Looking around...');
        audio.vibrate('short');

        const blob = await camera.captureBlob();
        if (!blob) { audio.speak('Camera not ready.'); return; }

        try {
            const formData = new FormData();
            formData.append('file', blob, 'frame.jpg');

            const res = await fetch(`${API}/api/analyze?language=${state.language}`, {
                method: 'POST', body: formData,
            });

            const data = await res.json();
            state.lastNarration = data.narration || data.scene;
            updateNarration(state.lastNarration);
            audio.speak(state.lastNarration, data.audio || '');
        } catch {
            audio.speak('Sorry, I could not analyze the scene right now.');
        }
    }

    // ---- Read Text ----

    async function readText() {
        audio.speak('Looking for text...');
        audio.vibrate('short');

        const blob = await camera.captureBlob();
        if (!blob) { audio.speak('Camera not ready.'); return; }

        try {
            const formData = new FormData();
            formData.append('file', blob, 'frame.jpg');

            const res = await fetch(`${API}/api/read-text?language=${state.language}`, {
                method: 'POST', body: formData,
            });

            const data = await res.json();
            const text = data.text || 'No text visible.';
            state.lastNarration = text;
            updateNarration(text);
            audio.speak(text.startsWith('No text') ? text : `I can see text: ${text}`);
        } catch {
            audio.speak('Sorry, I could not read text right now.');
        }
    }

    // ---- Ask Question ----

    function voiceQuestion() {
        audio.speak('Listening for your question...');
        audio.onSpeechResult = (transcript) => {
            el('question-input').value = transcript;
            sendQuestion();
        };
        audio.listen();
    }

    async function sendQuestion() {
        const input = el('question-input');
        const question = input.value.trim();
        if (!question) { audio.speak('Please type or speak a question.'); return; }

        toggleModal('ask-modal', false);
        audio.speak('Thinking...');

        const blob = await camera.captureBlob();
        if (!blob) { audio.speak('Camera not ready.'); return; }

        try {
            const formData = new FormData();
            formData.append('file', blob, 'frame.jpg');

            const res = await fetch(`${API}/api/ask?question=${encodeURIComponent(question)}&language=${state.language}`, {
                method: 'POST', body: formData,
            });

            const data = await res.json();
            const answer = data.answer || 'I could not determine the answer.';
            state.lastNarration = answer;
            updateNarration(`Q: ${question}\nA: ${answer}`);
            audio.speak(answer);
        } catch {
            audio.speak('Sorry, I could not answer that right now.');
        }

        input.value = '';
    }

    // ---- Repeat Last ----

    function repeatLast() {
        if (state.lastNarration) {
            audio.speak(state.lastNarration);
        } else {
            audio.speak('Nothing to repeat yet.');
        }
    }

    // ---- Obstacles ----

    // ---- Obstacles (visual cards only — AI narration already speaks dangers) ----

    function handleObstacles(obstacles) {
        clearObstacleAlerts();
        // Only show visual cards — don't speak, AI narration handles it
        const container = el('obstacle-alerts');
        const urgent = obstacles.filter(o => o.urgency === 'high').slice(0, 3);
        const medium = obstacles.filter(o => o.urgency === 'medium').slice(0, 2);

        for (const obs of urgent) {
            const card = document.createElement('div');
            card.className = 'alert-card';
            card.setAttribute('role', 'alert');
            card.innerHTML = `<span aria-hidden="true">⚠️</span> ${esc(obs.label)} — ${esc(obs.position)}!`;
            container.appendChild(card);
        }

        for (const obs of medium) {
            const card = document.createElement('div');
            card.className = 'alert-card medium';
            card.innerHTML = `<span aria-hidden="true">⚡</span> ${esc(obs.label)} — ${esc(obs.position)}`;
            container.appendChild(card);
        }
    }

    function clearObstacleAlerts() {
        const container = el('obstacle-alerts');
        if (container) container.innerHTML = '';
    }

    // ---- UI Helpers ----

    function updateNarration(text) {
        const el_ = el('narration-text');
        if (el_) el_.textContent = text;
    }

    function toggleModal(id, show) {
        const modal = el(id);
        if (modal) modal.classList.toggle('hidden', !show);
        if (show) {
            const first = modal.querySelector('input, button, select, [tabindex]');
            first?.focus();
        }
    }

    function toast(msg, type = 'info') {
        const container = el('toasts');
        if (!container) return;
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.textContent = msg;
        container.appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
    }

    function isSimilar(a, b) {
        if (!a || !b) return false;
        if (a === b) return true;

        const wordsA = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
        const wordsB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));

        if (wordsA.size === 0 || wordsB.size === 0) return false;

        let overlap = 0;
        for (const w of wordsA) {
            if (wordsB.has(w)) overlap++;
        }

        const similarity = overlap / Math.max(wordsA.size, wordsB.size);
        return similarity >= 0.5; // lower threshold — skip if scene is even roughly similar
    }

    function el(id) { return document.getElementById(id); }

    function esc(text) {
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }

    // ---- Settings Persistence ----

    function loadSettings() {
        try {
            const s = JSON.parse(localStorage.getItem('blind-assist-settings') || '{}');
            if (s.language) {
                state.language = s.language;
                audio.setLanguage(s.language);
                const sel = el('setting-language');
                if (sel) sel.value = s.language;
            }
            if (s.interval) {
                state.interval = s.interval;
                const range = el('setting-interval');
                if (range) range.value = s.interval / 1000;
                const label = el('interval-value');
                if (label) label.textContent = (s.interval / 1000) + 's';
            }
            if (s.rate) {
                audio.rate = s.rate;
                const range = el('setting-rate');
                if (range) range.value = s.rate;
                const label = el('rate-value');
                if (label) label.textContent = s.rate.toFixed(1) + 'x';
            }
            if (s.autoNarrate !== undefined) {
                state.autoNarrate = s.autoNarrate;
                const cb = el('setting-auto-narrate');
                if (cb) cb.checked = s.autoNarrate;
            }
            if (s.obstacleAlerts !== undefined) {
                state.obstacleAlerts = s.obstacleAlerts;
                const cb = el('setting-obstacle-alerts');
                if (cb) cb.checked = s.obstacleAlerts;
            }
            if (s.haptic !== undefined) {
                state.haptic = s.haptic;
                audio.hapticEnabled = s.haptic;
                const cb = el('setting-haptic');
                if (cb) cb.checked = s.haptic;
            }
        } catch { /* ignore */ }
    }

    function saveSettings() {
        try {
            localStorage.setItem('blind-assist-settings', JSON.stringify({
                language: state.language,
                interval: state.interval,
                rate: audio.rate,
                autoNarrate: state.autoNarrate,
                obstacleAlerts: state.obstacleAlerts,
                haptic: state.haptic,
            }));
        } catch { /* ignore */ }
    }

    // ---- Voice Commands ----

    function startVoiceCommands() {
        const started = audio.startContinuousListening(processVoiceCommand);
        if (started) {
            console.log('Voice commands active. Say "Assistant start", "Assistant Telugu", etc.');
        } else {
            // No continuous recognition (iOS) — show mic buttons prominently
            console.log('Continuous voice commands not available — use mic buttons');
        }
    }

    function processVoiceCommand(transcript) {
        const raw = transcript.toLowerCase().trim();
        console.log('Voice heard:', raw);

        // ---- Wake word gate: must start with "assistant" ----
        // Ignore ALL speech that doesn't begin with the wake word.
        // This prevents ambient noise / bystander conversations from triggering actions.
        const wakeMatch = raw.match(/^(?:assistant|hey assistant|ok assistant)\s*(.*)/);
        if (!wakeMatch) {
            // Not addressed to us — silently ignore
            return;
        }
        const cmd = wakeMatch[1].trim();
        if (!cmd) {
            // Just said "assistant" with nothing after — acknowledge
            audio.speak('Yes? Say a command like start, stop, or a language name.');
            return;
        }
        console.log('Voice command:', cmd);

        // Start
        if (cmd.includes('start') || cmd.includes('begin') || cmd.includes('open') || cmd.includes('turn on') || cmd.includes('activate') || cmd.includes('launch')) {
            if (!state.active) {
                audio.speak('Starting assistant.');
                startAssistant();
            }
            return;
        }

        // Stop
        if (cmd.includes('stop') || cmd.includes('pause') || cmd.includes('close') || cmd.includes('turn off') || cmd.includes('shut') || cmd.includes('exit') || cmd.includes('quit') || cmd.includes('end')) {
            if (state.active) {
                stopAssistant();
            }
            return;
        }

        // Language change — "assistant telugu", "assistant change language to hindi", "assistant english"
        const langNames = Object.keys(LANG_MAP).join('|');
        const langRegex = new RegExp(`(?:change|switch|set)?\\s*(?:language|lang)?\\s*(?:to)?\\s*(${langNames})`, 'i');
        const langMatch = cmd.match(langRegex);
        if (langMatch) {
            const langName = langMatch[1].toLowerCase();
            const code = LANG_MAP[langName];
            if (code) {
                state.language = code;
                audio.setLanguage(code);
                const sel = el('setting-language');
                if (sel) sel.value = code;
                saveSettings();
                audio.speak(`Language changed to ${langName}.`);
                toast(`Language: ${langName}`, 'success');
                return;
            }
        }

        // Scene commands (only when active)
        if (!state.active) return;

        if (cmd.includes("what's here") || cmd.includes('what is here') || cmd.includes('describe') || cmd.includes('look around') || cmd.includes('what do you see')) {
            describeScene();
            return;
        }

        if (cmd.includes('read text') || cmd.includes('read sign') || cmd.includes('read this') || cmd.includes('what does it say')) {
            readText();
            return;
        }

        if (cmd.includes('repeat') || cmd.includes('say again') || cmd.includes('say that again')) {
            repeatLast();
            return;
        }

        // Ask a free-form question — "assistant ask what color is this"
        const askMatch = cmd.match(/^(?:ask|question)\s+(.+)/i);
        if (askMatch) {
            el('question-input').value = askMatch[1];
            sendQuestion();
            return;
        }
    }

})();
