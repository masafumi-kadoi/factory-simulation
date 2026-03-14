// Minimap: shows a bird's-eye view of the canvas with viewport indicator
export class Minimap {
    constructor(editor) {
        this.editor = editor;
        this._el = null;
        this._canvas = null;
        this._ctx = null;
        this._isDragging = false;
        this._visible = editor.isMinimapVisible();
        this._create();
    }

    _create() {
        this._el = document.createElement('div');
        this._el.className = 'minimap';
        this._canvas = document.createElement('canvas');
        this._canvas.width = 200;
        this._canvas.height = 120;
        this._el.appendChild(this._canvas);
        this._ctx = this._canvas.getContext('2d');

        // Insert into canvas-container
        const container = document.querySelector('.canvas-container');
        if (container) container.appendChild(this._el);

        this._setupEvents();
        this.setVisible(this._visible);
    }

    _setupEvents() {
        const moveViewport = (e) => {
            const rect = this._canvas.getBoundingClientRect();
            const mx = (e.clientX - rect.left) / rect.width;
            const my = (e.clientY - rect.top) / rect.height;

            const bounds = this._getBounds();
            if (!bounds) return;

            const canvas = this.editor.canvas;
            canvas.viewBox.x = bounds.minX + mx * bounds.w - canvas.viewBox.width / 2;
            canvas.viewBox.y = bounds.minY + my * bounds.h - canvas.viewBox.height / 2;
            canvas._updateViewBox();
        };

        this._canvas.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._isDragging = true;
            moveViewport(e);
        });

        document.addEventListener('mousemove', (e) => {
            if (this._isDragging) moveViewport(e);
        });

        document.addEventListener('mouseup', () => {
            this._isDragging = false;
        });
    }

    _getBounds() {
        if (!this.editor.scenario) return null;
        const stations = this.editor.scenario.stations;
        if (stations.length === 0) return null;

        const pad = 100;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        stations.forEach(s => {
            minX = Math.min(minX, s.x - 50);
            minY = Math.min(minY, s.y - 30);
            maxX = Math.max(maxX, s.x + 50);
            maxY = Math.max(maxY, s.y + 30);
        });

        // Include viewport bounds too
        const vb = this.editor.canvas.viewBox;
        minX = Math.min(minX, vb.x) - pad;
        minY = Math.min(minY, vb.y) - pad;
        maxX = Math.max(maxX, vb.x + vb.width) + pad;
        maxY = Math.max(maxY, vb.y + vb.height) + pad;

        return { minX, minY, w: maxX - minX, h: maxY - minY };
    }

    render() {
        if (!this._visible || !this.editor.scenario) return;

        const ctx = this._ctx;
        const cw = this._canvas.width;
        const ch = this._canvas.height;
        ctx.clearRect(0, 0, cw, ch);

        // Background
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        ctx.fillStyle = isDark ? '#1a1a1a' : '#f0f0f0';
        ctx.fillRect(0, 0, cw, ch);

        const bounds = this._getBounds();
        if (!bounds) return;

        const scaleX = cw / bounds.w;
        const scaleY = ch / bounds.h;
        const scale = Math.min(scaleX, scaleY);
        const offsetX = (cw - bounds.w * scale) / 2;
        const offsetY = (ch - bounds.h * scale) / 2;

        const toMiniX = (x) => offsetX + (x - bounds.minX) * scale;
        const toMiniY = (y) => offsetY + (y - bounds.minY) * scale;

        // Draw connections
        ctx.strokeStyle = isDark ? '#555' : '#bbb';
        ctx.lineWidth = 0.5;
        this.editor.scenario.connections.forEach(c => {
            const from = this.editor.getStation(c.from);
            const to = this.editor.getStation(c.to);
            if (!from || !to) return;
            ctx.beginPath();
            ctx.moveTo(toMiniX(from.x), toMiniY(from.y));
            ctx.lineTo(toMiniX(to.x), toMiniY(to.y));
            ctx.stroke();
        });

        // Draw stations
        const colors = {
            source: '#4CAF50', processing: '#2196F3', drain: '#f44336',
            merge: '#FF9800', split: '#9C27B0', moduler: '#607D8B',
            entry: '#00BCD4', exit: '#795548'
        };
        this.editor.scenario.stations.forEach(s => {
            const x = toMiniX(s.x);
            const y = toMiniY(s.y);
            const hw = Math.max(2, 40 * scale);
            const hh = Math.max(1.5, 20 * scale);
            ctx.fillStyle = colors[s.type] || '#888';
            ctx.fillRect(x - hw, y - hh, hw * 2, hh * 2);
        });

        // Draw viewport rectangle
        const vb = this.editor.canvas.viewBox;
        const vx = toMiniX(vb.x);
        const vy = toMiniY(vb.y);
        const vw = vb.width * scale;
        const vh = vb.height * scale;
        ctx.strokeStyle = isDark ? '#4a9eff' : '#1976D2';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(vx, vy, vw, vh);
        ctx.fillStyle = isDark ? 'rgba(74,158,255,0.08)' : 'rgba(25,118,210,0.06)';
        ctx.fillRect(vx, vy, vw, vh);
    }

    setVisible(visible) {
        this._visible = visible;
        if (this._el) {
            this._el.style.display = visible ? 'block' : 'none';
        }
        if (visible) this.render();
    }

    toggle() {
        this.setVisible(!this._visible);
    }

    get visible() { return this._visible; }
}
