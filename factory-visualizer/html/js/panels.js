// Panels module: AI agent panel + floating info panels

// ---- AI Agent Panel ----

export function initAIPanel() {
    const panel = document.getElementById('ai-agent-panel');
    const header = document.getElementById('ai-panel-header');
    const toggle = document.getElementById('ai-panel-toggle');
    const body = document.getElementById('ai-panel-body');

    if (!panel) return;

    // Drag support
    let dragging = false;
    let startX = 0, startY = 0, origLeft = 0, origTop = 0;

    header.addEventListener('mousedown', e => {
        if (e.target === toggle) return;
        dragging = true;
        const rect = panel.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        // Switch from bottom/right to top/left for positioning
        origLeft = rect.left;
        origTop = rect.top;
        panel.style.bottom = 'auto';
        panel.style.right = 'auto';
        panel.style.left = origLeft + 'px';
        panel.style.top = origTop + 'px';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        panel.style.left = Math.max(0, origLeft + dx) + 'px';
        panel.style.top = Math.max(0, origTop + dy) + 'px';
    }

    function onMouseUp() {
        dragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }

    // Toggle collapse
    toggle.addEventListener('click', () => {
        const collapsed = body.classList.toggle('collapsed');
        toggle.textContent = collapsed ? '+' : '−';
    });
}

// ---- Floating Info Panels ----

let _panelCounter = 0;

export class FloatingInfoPanel {
    constructor({ title, rows, x, y, onClose }) {
        this._id = ++_panelCounter;
        this._el = this._create(title, rows, x, y, onClose);
        document.getElementById('floating-panels').appendChild(this._el);
        this._initDrag();
    }

    update(rows) {
        const body = this._el.querySelector('.info-panel-body');
        if (!body) return;
        body.innerHTML = rows.map(r => this._rowHtml(r)).join('');
    }

    close() {
        this._el.remove();
    }

    _create(title, rows, x, y, onClose) {
        const el = document.createElement('div');
        el.className = 'info-panel';
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.innerHTML = `
            <div class="info-panel-header">
                <span>${this._esc(title)}</span>
                <button class="info-panel-close">✕</button>
            </div>
            <div class="info-panel-body">
                ${rows.map(r => this._rowHtml(r)).join('')}
            </div>
        `;
        el.querySelector('.info-panel-close').addEventListener('click', () => {
            el.remove();
            onClose && onClose();
        });
        return el;
    }

    _rowHtml(row) {
        if (row.separator) return `<hr style="border-color: var(--border-color); margin: 4px 0;">`;
        return `<div class="info-row">
            <span class="info-label">${this._esc(row.label || '')}</span>
            <span class="info-value">${this._esc(String(row.value ?? '—'))}</span>
        </div>`;
    }

    _esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    _initDrag() {
        const header = this._el.querySelector('.info-panel-header');
        let dragging = false;
        let sx = 0, sy = 0, ox = 0, oy = 0;

        header.addEventListener('mousedown', e => {
            if (e.target.classList.contains('info-panel-close')) return;
            dragging = true;
            sx = e.clientX; sy = e.clientY;
            ox = this._el.offsetLeft; oy = this._el.offsetTop;
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });

        const move = e => {
            if (!dragging) return;
            this._el.style.left = Math.max(0, ox + e.clientX - sx) + 'px';
            this._el.style.top = Math.max(0, oy + e.clientY - sy) + 'px';
        };
        const up = () => {
            dragging = false;
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
        };
    }
}
