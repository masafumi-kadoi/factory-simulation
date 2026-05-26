// 3-zone timeline for factory-visualizer
// Left zone  (blue) : past 24h — realtime factory data
// Center line (green): Date.now()
// Right zone (amber) : future 24h — simulation predictions

export class Timeline {
    constructor({ canvas, onSeek, onPlayStateChange }) {
        this._canvas = canvas;
        this._ctx = canvas.getContext('2d');
        this._onSeek = onSeek;
        this._onPlayStateChange = onPlayStateChange;

        // Fixed 48-hour window centred on nowMs
        this._nowMs = null;          // Date.now() snapshot — set by setNow()
        this._currentTime = null;    // ms — current scrubber position

        // Zone data
        this._realtimeEvents = [];   // ms[] from realtime data source
        this._simRanges = [];        // [{ start, end, dsId, events: ms[] }]
        this._activeSimIdx = -1;     // which sim range is selected

        // Playback
        this._isPlaying = false;
        this._speed = 1;
        this._playTimer = null;
        this._lastRealTime = null;

        this._resizeObs = new ResizeObserver(() => this._resize());
        this._resizeObs.observe(canvas.parentElement);
        this._resize();

        canvas.addEventListener('click',     e => this._handleClick(e));
        canvas.addEventListener('mousedown', e => this._handleMouseDown(e));
        canvas.addEventListener('mousemove', e => this._handleMouseMove(e));
        canvas.addEventListener('mouseup',   e => this._handleMouseUp(e));
        canvas.addEventListener('mouseleave',e => this._handleMouseUp(e));
        this._dragging = false;
    }

    // ── public API ──────────────────────────────────────────────────────────

    /** Set/refresh the "now" centre point. Call once on load and periodically. */
    setNow(nowMs) {
        this._nowMs = nowMs;
        if (this._currentTime === null) this._currentTime = nowMs;
        this._draw();
    }

    /** Replace left-zone realtime events. events: ms[] */
    setRealtimeData(events) {
        this._realtimeEvents = Array.isArray(events) ? events.slice().sort((a, b) => a - b) : [];
        this._draw();
    }

    /** Add / replace a simulation range in the right zone.
     *  If dsId already exists it is replaced; otherwise appended. */
    setSimulationData(dsId, startMs, endMs, events) {
        const evts = Array.isArray(events) ? events.slice().sort((a, b) => a - b) : [];
        const idx = this._simRanges.findIndex(r => r.dsId === dsId);
        const entry = { dsId, start: startMs, end: endMs, events: evts };
        if (idx >= 0) {
            this._simRanges[idx] = entry;
        } else {
            this._simRanges.push(entry);
            if (this._activeSimIdx < 0) this._activeSimIdx = this._simRanges.length - 1;
        }
        this._draw();
    }

    /** Select which simulation result is "active" (shown in right zone). */
    selectSimulation(dsId) {
        const idx = this._simRanges.findIndex(r => r.dsId === dsId);
        if (idx >= 0) this._activeSimIdx = idx;
        this._draw();
    }

    clearSimulationData() {
        this._simRanges = [];
        this._activeSimIdx = -1;
        this._draw();
    }

    setCurrentTime(ms, seeking = false) {
        if (this._nowMs === null) return;
        const { startMs, endMs } = this._window();
        this._currentTime = Math.max(startMs, Math.min(endMs, ms));
        this._draw();
        this._emitTime(seeking);
    }

    getCurrentTime() { return this._currentTime; }
    setSpeed(s) { this._speed = s; }

    play() {
        if (this._isPlaying || this._nowMs === null) return;
        const { endMs } = this._window();
        if (this._currentTime >= endMs) this._currentTime = this._nowMs - 24 * 3600 * 1000;
        this._isPlaying = true;
        this._lastRealTime = performance.now();
        this._playTimer = setInterval(() => this._tick(), 50);
        this._onPlayStateChange && this._onPlayStateChange(true);
    }

    pause() {
        if (!this._isPlaying) return;
        this._isPlaying = false;
        clearInterval(this._playTimer);
        this._playTimer = null;
        this._onPlayStateChange && this._onPlayStateChange(false);
    }

    togglePlay() { this._isPlaying ? this.pause() : this.play(); }
    get isPlaying() { return this._isPlaying; }

    seekToStart() {
        if (this._nowMs === null) return;
        this.setCurrentTime(this._nowMs - 24 * 3600 * 1000, true);
    }

    seekToEnd() {
        if (this._nowMs === null) return;
        const { endMs } = this._window();
        this.setCurrentTime(endMs, true);
    }

    // ── internal ─────────────────────────────────────────────────────────────

    _window() {
        const H24 = 24 * 3600 * 1000;
        return { startMs: this._nowMs - H24, endMs: this._nowMs + H24 };
    }

    _tick() {
        if (!this._isPlaying || this._nowMs === null) return;
        const { endMs } = this._window();
        const now = performance.now();
        const delta = (now - this._lastRealTime) * this._speed;
        this._lastRealTime = now;
        const next = this._currentTime + delta;
        if (next >= endMs) {
            this.setCurrentTime(endMs);
            this.pause();
        } else {
            this.setCurrentTime(next);
        }
    }

    _emitTime(seeking = false) {
        if (this._onSeek && this._currentTime !== null) {
            this._onSeek(this._currentTime, seeking);
        }
    }

    _msToX(ms) {
        const { startMs, endMs } = this._window();
        const ratio = (ms - startMs) / (endMs - startMs);
        return this._pad + ratio * this._trackW;
    }

    _xToMs(x) {
        const { startMs, endMs } = this._window();
        const ratio = Math.max(0, Math.min(1, (x - this._pad) / this._trackW));
        return startMs + ratio * (endMs - startMs);
    }

    _handleClick(e) {
        if (this._nowMs === null) return;
        const x = e.clientX - this._canvas.getBoundingClientRect().left;
        this.pause();
        this.setCurrentTime(this._xToMs(x), true);
    }

    _handleMouseDown(e) {
        if (this._nowMs === null) return;
        this._dragging = true;
        this.pause();
    }
    _handleMouseMove(e) {
        if (!this._dragging) return;
        const x = e.clientX - this._canvas.getBoundingClientRect().left;
        this.setCurrentTime(this._xToMs(x), true);
    }
    _handleMouseUp() { this._dragging = false; }

    _resize() {
        const parent = this._canvas.parentElement;
        if (!parent) return;
        this._canvas.width = parent.clientWidth;
        this._canvas.height = parent.clientHeight || 48;
        this._pad = 8;
        this._trackW = this._canvas.width - this._pad * 2;
        this._draw();
    }

    _draw() {
        const ctx = this._ctx;
        const W = this._canvas.width;
        const H = this._canvas.height;
        ctx.clearRect(0, 0, W, H);

        if (this._nowMs === null) {
            ctx.fillStyle = 'rgba(90,111,144,0.5)';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('工場を選択してください', W / 2, H / 2);
            return;
        }

        const { startMs, endMs } = this._window();
        const nowX = this._msToX(this._nowMs);
        const pad = this._pad;
        const trackW = this._trackW;
        const midY = Math.round(H / 2);

        // ── zone backgrounds ──
        // left (past): dark blue tint
        ctx.fillStyle = 'rgba(20,60,120,0.18)';
        ctx.fillRect(pad, 0, nowX - pad, H);
        // right (future): dark amber tint
        ctx.fillStyle = 'rgba(120,80,20,0.18)';
        ctx.fillRect(nowX, 0, pad + trackW - nowX, H);

        // ── base track ──
        ctx.beginPath();
        ctx.strokeStyle = '#2a4070';
        ctx.lineWidth = 2;
        ctx.moveTo(pad, midY);
        ctx.lineTo(pad + trackW, midY);
        ctx.stroke();

        // ── realtime events (left zone, blue) ──
        const H24 = 24 * 3600 * 1000;
        for (const evMs of this._realtimeEvents) {
            if (evMs < startMs || evMs > this._nowMs) continue;
            const ex = this._msToX(evMs);
            const isPast = evMs <= (this._currentTime || this._nowMs);
            ctx.beginPath();
            ctx.arc(ex, midY, 2, 0, Math.PI * 2);
            ctx.fillStyle = isPast ? '#4a9eff' : '#1a3a6a';
            ctx.fill();
        }

        // ── simulation events (right zone, amber) ──
        if (this._activeSimIdx >= 0 && this._activeSimIdx < this._simRanges.length) {
            const sim = this._simRanges[this._activeSimIdx];
            for (const evMs of sim.events) {
                if (evMs < this._nowMs || evMs > endMs) continue;
                const ex = this._msToX(evMs);
                const isPast = evMs <= (this._currentTime || this._nowMs);
                ctx.beginPath();
                ctx.arc(ex, midY, 2, 0, Math.PI * 2);
                ctx.fillStyle = isPast ? '#ffaa44' : '#5a3a10';
                ctx.fill();
            }
            // sim range bracket
            const sx = Math.max(nowX, this._msToX(sim.start));
            const ex2 = Math.min(pad + trackW, this._msToX(sim.end));
            ctx.strokeStyle = 'rgba(255,170,60,0.4)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(sx, midY);
            ctx.lineTo(ex2, midY);
            ctx.stroke();
        }

        // ── NOW vertical line ──
        ctx.strokeStyle = '#4caf50';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(nowX, 2);
        ctx.lineTo(nowX, H - 2);
        ctx.stroke();
        // NOW label
        ctx.fillStyle = '#4caf50';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('NOW', nowX, 2);

        // ── current position indicator ──
        if (this._currentTime !== null) {
            const cx = this._msToX(this._currentTime);
            ctx.beginPath();
            ctx.arc(cx, midY, 7, 0, Math.PI * 2);
            ctx.fillStyle = this._currentTime <= this._nowMs ? '#4a9eff' : '#ffaa44';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(cx, midY, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        }

        // ── time labels ──
        ctx.fillStyle = '#8fa3c8';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(this._fmt(startMs), pad, H - 1);
        ctx.textAlign = 'right';
        ctx.fillText(this._fmt(endMs), pad + trackW, H - 1);
        // current time label near cursor
        if (this._currentTime !== null) {
            const cx = this._msToX(this._currentTime);
            const label = this._fmt(this._currentTime);
            ctx.textAlign = cx < W / 2 ? 'left' : 'right';
            ctx.fillStyle = '#c0d4f0';
            ctx.fillText(label, cx + (cx < W / 2 ? 4 : -4), H - 1);
        }
    }

    _fmt(ms) {
        if (!ms) return '--';
        return new Date(ms).toLocaleString('ja-JP', {
            month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit',
        });
    }

    dispose() {
        this.pause();
        this._resizeObs && this._resizeObs.disconnect();
    }
}
