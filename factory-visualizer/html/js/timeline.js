// Timeline control for factory-visualizer

export class Timeline {
    constructor({ canvas, onSeek, onPlayStateChange }) {
        this._canvas = canvas;
        this._ctx = canvas.getContext('2d');
        this._onSeek = onSeek;
        this._onPlayStateChange = onPlayStateChange;

        this._startTime = null;  // ms
        this._endTime = null;    // ms
        this._currentTime = null; // ms
        this._events = [];
        this._isPlaying = false;
        this._speed = 1;
        this._playTimer = null;
        this._lastRealTime = null;

        this._resizeObs = new ResizeObserver(() => this._resize());
        this._resizeObs.observe(canvas.parentElement);
        this._resize();

        canvas.addEventListener('click', e => this._handleClick(e));
    }

    setExecution(execution, events = []) {
        if (!execution) {
            this._startTime = null;
            this._endTime = null;
            this._currentTime = null;
            this._events = [];
            this._draw();
            return;
        }

        const startMs = new Date(execution.startDatetime || execution.startTime || execution.createdAt).getTime();
        const simSecs = execution.simulationTime || 86400;
        this._startTime = startMs;
        this._endTime = startMs + simSecs * 1000;
        this._currentTime = startMs;
        this._events = events.map(e => new Date(e.event_time || e.eventTime).getTime()).filter(t => !isNaN(t));
        this._draw();
        this._emitTime(true);
    }

    setCurrentTime(ms, seeking = false) {
        if (this._startTime === null) return;
        this._currentTime = Math.max(this._startTime, Math.min(this._endTime, ms));
        this._draw();
        this._emitTime(seeking);
    }

    getCurrentTime() { return this._currentTime; }

    setSpeed(s) { this._speed = s; }

    play() {
        if (this._isPlaying || this._startTime === null) return;
        if (this._currentTime >= this._endTime) this._currentTime = this._startTime;
        this._isPlaying = true;
        this._lastRealTime = performance.now();
        this._playTimer = setInterval(() => this._tick(), 50);
        this._onPlayStateChange && this._onPlayStateChange(true);
    }

    pause() {
        if (!this._isPlaying) return;
        this._isPlaying = false;
        if (this._playTimer) { clearInterval(this._playTimer); this._playTimer = null; }
        this._onPlayStateChange && this._onPlayStateChange(false);
    }

    togglePlay() {
        this._isPlaying ? this.pause() : this.play();
    }

    seekToStart() {
        this.setCurrentTime(this._startTime || 0, true);
    }

    seekToEnd() {
        this.setCurrentTime(this._endTime || 0, true);
    }

    get isPlaying() { return this._isPlaying; }

    _tick() {
        if (!this._isPlaying || this._startTime === null) return;
        const now = performance.now();
        const realDelta = now - this._lastRealTime;
        this._lastRealTime = now;
        const simDelta = realDelta * this._speed; // ms of sim time per real ms (_speed is direct multiplier)
        const next = this._currentTime + simDelta;
        if (next >= this._endTime) {
            this.setCurrentTime(this._endTime);
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

    _handleClick(event) {
        if (this._startTime === null || this._endTime === null) return;
        const rect = this._canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const ratio = Math.max(0, Math.min(1, (x - this._trackPad) / (this._trackWidth)));
        const ms = this._startTime + ratio * (this._endTime - this._startTime);
        this.pause();
        this.setCurrentTime(ms, true);
    }

    _resize() {
        const parent = this._canvas.parentElement;
        if (!parent) return;
        this._canvas.width = parent.clientWidth;
        this._canvas.height = parent.clientHeight || 40;
        this._trackPad = 8;
        this._trackWidth = this._canvas.width - this._trackPad * 2;
        this._draw();
    }

    _draw() {
        const ctx = this._ctx;
        const W = this._canvas.width;
        const H = this._canvas.height;
        ctx.clearRect(0, 0, W, H);

        if (this._startTime === null) {
            ctx.fillStyle = 'rgba(90,111,144,0.5)';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('実行データなし', W / 2, H / 2);
            return;
        }

        const pad = this._trackPad;
        const trackW = this._trackWidth;
        const trackY = H / 2;
        const totalMs = this._endTime - this._startTime;
        const nowMs = this._currentTime !== null ? this._currentTime - this._startTime : 0;
        const nowX = pad + (totalMs > 0 ? (nowMs / totalMs) * trackW : 0);

        // Track line — past (filled) / future (dashed)
        ctx.beginPath();
        ctx.strokeStyle = '#2a4070';
        ctx.lineWidth = 2;
        ctx.moveTo(pad, trackY);
        ctx.lineTo(pad + trackW, trackY);
        ctx.stroke();

        // Past portion
        ctx.beginPath();
        ctx.strokeStyle = '#4a9eff';
        ctx.lineWidth = 2;
        ctx.moveTo(pad, trackY);
        ctx.lineTo(nowX, trackY);
        ctx.stroke();

        // Event dots (past)
        this._events.forEach(evMs => {
            const evX = pad + ((evMs - this._startTime) / totalMs) * trackW;
            const isPast = evMs <= this._currentTime;
            ctx.beginPath();
            ctx.arc(evX, trackY, 3, 0, Math.PI * 2);
            ctx.fillStyle = isPast ? '#4a9eff' : '#2a4070';
            ctx.fill();
        });

        // Current time indicator
        ctx.beginPath();
        ctx.arc(nowX, trackY, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#4caf50';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(nowX, trackY, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // Time labels
        ctx.fillStyle = '#8fa3c8';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(this._fmtTime(this._startTime), pad, 2);
        ctx.textAlign = 'right';
        ctx.fillText(this._fmtTime(this._endTime), pad + trackW, 2);
    }

    _fmtTime(ms) {
        if (!ms) return '--';
        const d = new Date(ms);
        return d.toLocaleString('ja-JP', {
            month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit',
        });
    }

    dispose() {
        this.pause();
        this._resizeObs && this._resizeObs.disconnect();
    }
}
