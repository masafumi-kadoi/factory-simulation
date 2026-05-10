import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export class ModelEditor {
    constructor(canvas, footprintCanvas) {
        this._canvas = canvas;
        this._footprintCanvas = footprintCanvas;
        this._ctx = canvas.getContext('2d');
        this._footprintCtx = footprintCanvas.getContext('2d');

        this._mode = 'grid';
        this._gridSize = 1;
        this._height = 2;
        this._cols = 20;
        this._rows = 20;
        this._selectedCells = new Set();
        this._origin = null; // [col, row] or null
        this._isSettingOrigin = false;
        this._isDragging = false;
        this._dragStartToggle = true;

        this._boundMouseDown = this._handleMouseDown.bind(this);
        this._boundMouseMove = this._handleMouseMove.bind(this);
        this._boundMouseUp = this._handleMouseUp.bind(this);
        this._boundMouseLeave = this._handleMouseLeave.bind(this);
        this._boundDocMouseUp = () => { this._isDragging = false; };

        canvas.addEventListener('mousedown', this._boundMouseDown);
        canvas.addEventListener('mousemove', this._boundMouseMove);
        canvas.addEventListener('mouseup', this._boundMouseUp);
        canvas.addEventListener('mouseleave', this._boundMouseLeave);
        document.addEventListener('mouseup', this._boundDocMouseUp);

        this._resizeObserver = new ResizeObserver(() => {
            this._resize();
            this._render();
        });
        this._resizeObserver.observe(canvas);
        this._resize();
        this._render();
    }

    // -----------------------------------------------------------------------
    // Resize
    // -----------------------------------------------------------------------
    _resize() {
        const dpr = window.devicePixelRatio || 1;
        const w = this._canvas.offsetWidth;
        const h = this._canvas.offsetHeight;
        this._canvas.width = w * dpr;
        this._canvas.height = h * dpr;
        this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const fw = this._footprintCanvas.offsetWidth;
        const fh = this._footprintCanvas.offsetHeight;
        if (fw > 0 && fh > 0) {
            this._footprintCanvas.width = fw * dpr;
            this._footprintCanvas.height = fh * dpr;
            this._footprintCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
    }

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    _render() {
        this._drawBackground();
        this._drawGrid();
        this._drawCells();
        this._drawOrigin();
        this._drawImportedBadge();
    }

    _drawBackground() {
        const ctx = this._ctx;
        const w = this._canvas.offsetWidth;
        const h = this._canvas.offsetHeight;
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, w, h);
    }

    _drawGrid() {
        const ctx = this._ctx;
        const w = this._canvas.offsetWidth;
        const h = this._canvas.offsetHeight;
        const cellPx = this._cellPx();

        ctx.strokeStyle = '#333';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let c = 0; c <= this._cols; c++) {
            const x = c * cellPx;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this._rows * cellPx);
        }
        for (let r = 0; r <= this._rows; r++) {
            const y = r * cellPx;
            ctx.moveTo(0, y);
            ctx.lineTo(this._cols * cellPx, y);
        }
        ctx.stroke();

        // outer border
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, this._cols * cellPx, this._rows * cellPx);
    }

    _drawCells() {
        if (this._mode !== 'grid') return;
        const ctx = this._ctx;
        const cellPx = this._cellPx();
        for (const key of this._selectedCells) {
            const [c, r] = key.split(',').map(Number);
            ctx.fillStyle = 'rgba(0, 207, 255, 0.35)';
            ctx.fillRect(c * cellPx, r * cellPx, cellPx, cellPx);
            ctx.strokeStyle = '#00cfff';
            ctx.lineWidth = 2;
            ctx.shadowColor = '#00cfff';
            ctx.shadowBlur = 12;
            ctx.strokeRect(c * cellPx + 1, r * cellPx + 1, cellPx - 2, cellPx - 2);
            ctx.shadowBlur = 0;
        }
    }

    _drawOrigin() {
        if (this._mode !== 'grid' || !this._origin) return;
        const ctx = this._ctx;
        const cellPx = this._cellPx();
        const [oc, or] = this._origin;
        const cx = (oc + 0.5) * cellPx;
        const cy = (or + 0.5) * cellPx;
        const r = cellPx * 0.35;

        // Crosshair circle
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();

        // Crosshair lines
        const ext = cellPx * 0.45;
        ctx.beginPath();
        ctx.moveTo(cx - ext, cy);
        ctx.lineTo(cx + ext, cy);
        ctx.moveTo(cx, cy - ext);
        ctx.lineTo(cx, cy + ext);
        ctx.stroke();

        // "0" label
        ctx.font = 'bold 10px sans-serif';
        ctx.fillStyle = '#ff4444';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('0', cx + r + 2, cy - r);
    }

    toggleOriginMode() {
        this._isSettingOrigin = !this._isSettingOrigin;
        return this._isSettingOrigin;
    }

    _drawImportedBadge() {
        if (this._mode !== 'imported') return;
        const ctx = this._ctx;
        const w = this._canvas.offsetWidth;
        const h = this._canvas.offsetHeight;
        ctx.save();
        ctx.font = '16px sans-serif';
        ctx.fillStyle = 'rgba(0, 207, 255, 0.8)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('📦 外部モデル設定済み', w / 2, h / 2 - 12);
        ctx.font = '12px sans-serif';
        ctx.fillStyle = 'rgba(200, 200, 200, 0.6)';
        ctx.fillText('「リセット」でグリッド編集に戻れます', w / 2, h / 2 + 14);
        ctx.restore();
    }

    _cellPx() {
        const w = this._canvas.offsetWidth;
        const h = this._canvas.offsetHeight;
        return Math.min(w / this._cols, h / this._rows);
    }

    // -----------------------------------------------------------------------
    // Mouse interaction
    // -----------------------------------------------------------------------
    _getCellFromEvent(e) {
        const rect = this._canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const cellPx = this._cellPx();
        const col = Math.floor(x / cellPx);
        const row = Math.floor(y / cellPx);
        if (col < 0 || col >= this._cols || row < 0 || row >= this._rows) return null;
        return { col, row };
    }

    _handleMouseDown(e) {
        if (this._mode !== 'grid') return;
        const cell = this._getCellFromEvent(e);
        if (!cell) return;

        if (this._isSettingOrigin) {
            this._origin = [cell.col, cell.row];
            this._isSettingOrigin = false;
            this._render();
            return;
        }

        this._isDragging = true;
        const key = `${cell.col},${cell.row}`;
        if (this._selectedCells.has(key)) {
            this._dragStartToggle = false;
            this._selectedCells.delete(key);
        } else {
            this._dragStartToggle = true;
            this._selectedCells.add(key);
        }
        this._render();
    }

    _handleMouseMove(e) {
        if (!this._isDragging || this._mode !== 'grid') return;
        const cell = this._getCellFromEvent(e);
        if (!cell) return;
        const key = `${cell.col},${cell.row}`;
        if (this._dragStartToggle) {
            this._selectedCells.add(key);
        } else {
            this._selectedCells.delete(key);
        }
        this._render();
    }

    _handleMouseUp() {
        this._isDragging = false;
    }

    _handleMouseLeave() {
        this._isDragging = false;
    }

    // -----------------------------------------------------------------------
    // Modals
    // -----------------------------------------------------------------------
    openGridSizeModal() {
        const overlay = this._createModalOverlay();
        overlay.innerHTML = `
            <div class="modal" style="min-width:280px;">
                <div class="modal-header">
                    <h3 class="modal-title">格子設定</h3>
                    <button class="modal-close" id="gs-close">×</button>
                </div>
                <div class="modal-body" style="display:flex;flex-direction:column;gap:12px;">
                    <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        格子サイズ
                        <span style="display:flex;align-items:center;gap:4px;">
                            <input id="gs-size" type="number" min="0.1" step="0.1" max="200" value="${this._gridSize}"
                                   style="width:80px;padding:4px 6px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-surface);color:var(--text-primary);">
                            <span style="color:var(--text-secondary);font-size:12px;">m</span>
                        </span>
                    </label>
                    <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        列数
                        <input id="gs-cols" type="number" min="1" max="50" value="${this._cols}"
                               style="width:80px;padding:4px 6px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-surface);color:var(--text-primary);">
                    </label>
                    <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        行数
                        <input id="gs-rows" type="number" min="1" max="50" value="${this._rows}"
                               style="width:80px;padding:4px 6px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-surface);color:var(--text-primary);">
                    </label>
                </div>
                <div class="modal-footer">
                    <button class="btn-cancel" id="gs-cancel">キャンセル</button>
                    <button class="btn-primary" id="gs-ok">決定</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const close = () => document.body.removeChild(overlay);
        overlay.querySelector('#gs-close').addEventListener('click', close);
        overlay.querySelector('#gs-cancel').addEventListener('click', close);
        overlay.querySelector('#gs-ok').addEventListener('click', () => {
            const newSize = parseFloat(overlay.querySelector('#gs-size').value) || this._gridSize;
            const newCols = parseInt(overlay.querySelector('#gs-cols').value) || this._cols;
            const newRows = parseInt(overlay.querySelector('#gs-rows').value) || this._rows;
            this._gridSize = Math.min(200, Math.max(0.1, newSize));
            this._cols = Math.min(50, Math.max(1, newCols));
            this._rows = Math.min(50, Math.max(1, newRows));
            // remove out-of-range cells
            for (const key of [...this._selectedCells]) {
                const [c, r] = key.split(',').map(Number);
                if (c >= this._cols || r >= this._rows) this._selectedCells.delete(key);
            }
            this._render();
            close();
        });
    }

    openHeightModal() {
        const overlay = this._createModalOverlay();
        overlay.innerHTML = `
            <div class="modal" style="min-width:260px;">
                <div class="modal-header">
                    <h3 class="modal-title">ブロック高さ設定</h3>
                    <button class="modal-close" id="bh-close">×</button>
                </div>
                <div class="modal-body" style="display:flex;flex-direction:column;gap:12px;">
                    <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        高さ
                        <span style="display:flex;align-items:center;gap:4px;">
                            <input id="bh-height" type="number" min="0.1" step="0.1" max="500" value="${this._height}"
                                   style="width:80px;padding:4px 6px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-surface);color:var(--text-primary);">
                            <span style="color:var(--text-secondary);font-size:12px;">m</span>
                        </span>
                    </label>
                </div>
                <div class="modal-footer">
                    <button class="btn-cancel" id="bh-cancel">キャンセル</button>
                    <button class="btn-primary" id="bh-ok">決定</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const close = () => document.body.removeChild(overlay);
        overlay.querySelector('#bh-close').addEventListener('click', close);
        overlay.querySelector('#bh-cancel').addEventListener('click', close);
        overlay.querySelector('#bh-ok').addEventListener('click', () => {
            const newH = parseFloat(overlay.querySelector('#bh-height').value) || this._height;
            this._height = Math.min(500, Math.max(0.1, newH));
            close();
        });
    }

    _createModalOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:var(--bg-overlay);display:flex;align-items:center;justify-content:center;z-index:20000;';
        return overlay;
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    open(model3DInfo) {
        if (!model3DInfo) {
            this._mode = 'grid';
            this._selectedCells.clear();
            this._origin = null;
        } else if (model3DInfo.type === 'grid') {
            this._mode = 'grid';
            const d = model3DInfo.data;
            this._gridSize = d.gridSize ?? this._gridSize;
            this._height   = d.height   ?? this._height;
            this._cols     = d.cols     ?? this._cols;
            this._rows     = d.rows     ?? this._rows;
            this._selectedCells = new Set(d.cells.map(([c, r]) => `${c},${r}`));
            this._origin = d.origin ?? null;
        } else {
            this._mode = 'imported';
            this._selectedCells.clear();
            this._origin = null;
        }
        this._isSettingOrigin = false;
        this._render();
    }

    close() {
        this._canvas.removeEventListener('mousedown', this._boundMouseDown);
        this._canvas.removeEventListener('mousemove', this._boundMouseMove);
        this._canvas.removeEventListener('mouseup', this._boundMouseUp);
        this._canvas.removeEventListener('mouseleave', this._boundMouseLeave);
        document.removeEventListener('mouseup', this._boundDocMouseUp);
        this._resizeObserver.disconnect();
        const w = this._canvas.offsetWidth;
        const h = this._canvas.offsetHeight;
        this._ctx.clearRect(0, 0, w, h);
    }

    getGridData() {
        if (this._mode !== 'grid' || this._selectedCells.size === 0) return null;
        const data = {
            gridSize: this._gridSize,
            height: this._height,
            cols: this._cols,
            rows: this._rows,
            cells: [...this._selectedCells].map(k => k.split(',').map(Number)),
        };
        if (this._origin) data.origin = this._origin;
        return data;
    }

    drawFootprint(ctx, canvasWidth, canvasHeight) {
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        if (this._mode === 'imported') {
            ctx.save();
            ctx.font = '14px sans-serif';
            ctx.fillStyle = 'rgba(0, 207, 255, 0.6)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('📦 外部モデル設定済み', canvasWidth / 2, canvasHeight / 2);
            ctx.restore();
            return;
        }
        if (this._selectedCells.size === 0) return;

        const cells = [...this._selectedCells];
        const minC = Math.min(...cells.map(k => parseInt(k.split(',')[0])));
        const maxC = Math.max(...cells.map(k => parseInt(k.split(',')[0])));
        const minR = Math.min(...cells.map(k => parseInt(k.split(',')[1])));
        const maxR = Math.max(...cells.map(k => parseInt(k.split(',')[1])));
        const spanC = maxC - minC + 1;
        const spanR = maxR - minR + 1;

        const maxPx = Math.min(canvasWidth, canvasHeight) * 0.7;
        const cellPx = Math.min(maxPx / spanC, maxPx / spanR);
        const offsetX = (canvasWidth - spanC * cellPx) / 2;
        const offsetY = (canvasHeight - spanR * cellPx) / 2;

        ctx.fillStyle = 'rgba(0, 207, 255, 0.15)';
        ctx.strokeStyle = 'rgba(0, 207, 255, 0.5)';
        ctx.lineWidth = 1;
        for (const key of this._selectedCells) {
            const [c, r] = key.split(',').map(Number);
            ctx.fillRect(offsetX + (c - minC) * cellPx, offsetY + (r - minR) * cellPx, cellPx, cellPx);
            ctx.strokeRect(offsetX + (c - minC) * cellPx, offsetY + (r - minR) * cellPx, cellPx, cellPx);
        }
    }

    // -----------------------------------------------------------------------
    // Import
    // -----------------------------------------------------------------------
    async importFile(file) {
        const name = file.name.toLowerCase();
        if (name.endsWith('.gltf')) {
            const text = await file.text();
            let json;
            try {
                json = JSON.parse(text);
            } catch {
                throw new Error('glTF ファイルのパースに失敗しました（不正な JSON です）');
            }
            if (!json.asset?.version) {
                throw new Error('有効な glTF ファイルではありません（asset.version が存在しません）');
            }
            this._mode = 'imported';
            this._render();
            return { type: 'gltf', data: json };
        } else if (name.endsWith('.glb')) {
            const buf = await file.arrayBuffer();
            // validate GLB magic number: 0x46546C67 ('glTF')
            const view = new DataView(buf);
            if (view.getUint32(0, true) !== 0x46546C67) {
                throw new Error('有効な GLB ファイルではありません（マジックナンバーが不正です）');
            }
            // encode to base64
            const bytes = new Uint8Array(buf);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
            const base64 = btoa(binary);
            this._mode = 'imported';
            this._render();
            return { type: 'glb', data: base64 };
        } else {
            throw new Error('.gltf または .glb ファイルを選択してください');
        }
    }

    // -----------------------------------------------------------------------
    // Export
    // -----------------------------------------------------------------------
    async exportFromGrid() {
        const scene = new THREE.Scene();
        const cellPx = this._gridSize;
        const h = this._height;
        const geometry = new THREE.BoxGeometry(cellPx, h, cellPx);
        for (const key of this._selectedCells) {
            const [cx, cy] = key.split(',').map(Number);
            const material = new THREE.MeshStandardMaterial({ color: 0x4a148c });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(
                (cx - (this._cols - 1) / 2) * cellPx,
                h / 2,
                (cy - (this._rows - 1) / 2) * cellPx
            );
            scene.add(mesh);
        }

        const gltfJson = await new Promise((resolve, reject) => {
            new GLTFExporter().parse(scene, resolve, reject, { binary: false });
        });

        const blob = new Blob([JSON.stringify(gltfJson)], { type: 'model/gltf+json' });
        this._download(URL.createObjectURL(blob), 'model.gltf');
    }

    exportFromGltf(gltfJson) {
        const blob = new Blob([JSON.stringify(gltfJson)], { type: 'model/gltf+json' });
        this._download(URL.createObjectURL(blob), 'model.gltf');
    }

    exportFromGlb(base64) {
        const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const blob = new Blob([binary], { type: 'model/gltf-binary' });
        this._download(URL.createObjectURL(blob), 'model.glb');
    }

    _download(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
}
