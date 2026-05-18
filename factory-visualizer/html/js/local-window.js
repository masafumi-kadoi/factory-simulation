// Local window — Machine editor
import * as API from './api.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const params = new URLSearchParams(location.search);
const FACTORY_ID = params.get('factoryId') || '';
const MACHINE_ID = params.get('machineId') || '';
const MACHINE_NAME = params.get('machineName') || MACHINE_ID;

let machineStation = null;
let childStations = [];
let childConnections = [];

// ---- 3D Model tab state ----
const _grid = {
    gridSize: 20,   // scene units per cell
    height: 40,     // scene units tall
    cols: 5,
    rows: 5,
    cells: new Set(), // "col,row" strings
    origin: null,     // [col, row] or null
    originMode: false,
    isDragging: false,
    dragMode: null,   // 'add' | 'remove'
};
let _3dRenderer = null;
let _3dScene = null;
let _3dCamera = null;
let _3dControls = null;
let _3dModelGroup = null;
let _importedGlb = null; // { arrayBuffer: ArrayBuffer, name: string } | null

// ---- Logic tab state ----

let _activeTool = 'select';
let _selectedStation = null;    // stationId string
let _connectSource = null;      // stationId of pending connection source
let _dragState = null;          // { stationId, startSVGX, startSVGY, origX, origY }
let _pendingAddType = null;     // stationType to place on next canvas click

// ---- Station colors ----

const STATION_COLORS = {
    source: '#28a745', processing: '#007bff', drain: '#6c757d',
    merge: '#6f42c1', split: '#fd7e14', entry: '#2e7d32', exit: '#e65100',
    inspection: '#ffc107', discharge: '#dc3545', switch: '#17a2b8',
};

// ---- Boot ----

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('local-title').textContent = `Machine Editor — ${MACHINE_NAME}`;
    document.getElementById('local-factory-info').textContent = `factory: ${FACTORY_ID.substring(0, 8)}…`;
    document.getElementById('info-sid').value = MACHINE_ID;

    initTabs();
    initButtons();
    await loadMachineData();
});

function initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
            if (tab.dataset.tab === 'logic') refreshLogicSVGSize();
            if (tab.dataset.tab === 'model3d') {
                renderGridCanvas();
                init3DPreview();
                if (_importedGlb && _3dRenderer) _loadGlbPreview(_importedGlb.arrayBuffer);
            }
        });
    });
}

function initButtons() {
    document.getElementById('btn-cancel').addEventListener('click', () => window.close());
    document.getElementById('btn-save').addEventListener('click', () => saveAndClose());
}

async function loadMachineData() {
    if (!FACTORY_ID || !MACHINE_ID) return;
    try {
        const allStations = await API.fetchFactoryStations(FACTORY_ID);
        const allConns = await API.fetchFactoryConnections(FACTORY_ID);

        machineStation = (Array.isArray(allStations) ? allStations : []).find(s => s.stationId === MACHINE_ID);
        childStations = (Array.isArray(allStations) ? allStations : []).filter(s => s.parentId === MACHINE_ID);

        const childIds = new Set(childStations.map(s => s.stationId));
        childConnections = (Array.isArray(allConns) ? allConns : []).filter(c =>
            childIds.has(c.fromStation) || childIds.has(c.toStation)
        );

        populateInfoTab();
        populateModelTab();
        populateLogicTab();
    } catch (err) {
        console.error('Failed to load machine data:', err);
    }
}

// ---- Info tab ----

function populateInfoTab() {
    if (!machineStation) return;
    document.getElementById('info-name').value = machineStation.name || '';
    const meta = machineStation.config?.metadata;
    document.getElementById('info-metadata').value = meta ? JSON.stringify(meta, null, 2) : '';
}

// ---- Model tab ----

function populateModelTab() {
    initModelTab();
    const cfg = machineStation?.config || {};

    // GLBインポートデータを復元
    if (cfg.model3DGlb?.data) {
        _importedGlb = {
            arrayBuffer: _base64ToArrayBuffer(cfg.model3DGlb.data),
            name: cfg.model3DGlb.name || 'model.glb',
        };
        _grid.cells.clear();
        _grid.origin = null;
        renderGridCanvas();
        return; // グリッドは使用しない
    }

    // グリッドデータを復元
    const g = cfg.model3DGrid;
    if (g) {
        if (g.gridSize) _grid.gridSize = g.gridSize;
        if (g.height)   _grid.height   = g.height;
        if (g.cols)     _grid.cols     = g.cols;
        if (g.rows)     _grid.rows     = g.rows;
        if (g.origin)   _grid.origin   = g.origin;
        if (Array.isArray(g.cells)) {
            _grid.cells.clear();
            g.cells.forEach(([c, r]) => _grid.cells.add(`${c},${r}`));
        }
    }
    renderGridCanvas();
}

function initModelTab() {
    const canvas = document.getElementById('model-grid-canvas');
    if (!canvas || canvas._modelInited) return;
    canvas._modelInited = true;

    // Toolbar buttons
    document.getElementById('btn-origin-mode').addEventListener('click', () => {
        _grid.originMode = !_grid.originMode;
        document.getElementById('btn-origin-mode').classList.toggle('active', _grid.originMode);
        renderGridCanvas();
    });
    document.getElementById('btn-clear-cells').addEventListener('click', () => {
        _importedGlb = null;
        _grid.cells.clear();
        _grid.origin = null;
        _grid.originMode = false;
        document.getElementById('btn-origin-mode').classList.remove('active');
        document.getElementById('model-status').textContent = '';
        renderGridCanvas();
        update3DPreview();
    });

    // GLBインポートボタン
    const glbInput = document.getElementById('model-glb-input');
    document.getElementById('btn-import-glb').addEventListener('click', () => glbInput.click());
    glbInput.addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            _importedGlb = { arrayBuffer: ev.target.result, name: file.name };
            _grid.cells.clear();
            _grid.origin = null;
            _grid.originMode = false;
            document.getElementById('btn-origin-mode').classList.remove('active');
            document.getElementById('model-status').textContent = `GLB: ${file.name}`;
            renderGridCanvas();
            if (_3dRenderer) _loadGlbPreview(_importedGlb.arrayBuffer);
        };
        reader.readAsArrayBuffer(file);
        glbInput.value = '';
    });
    document.getElementById('btn-grid-size').addEventListener('click', () => {
        document.getElementById('gs-cols').value = _grid.cols;
        document.getElementById('gs-rows').value = _grid.rows;
        document.getElementById('gs-size').value = _grid.gridSize;
        document.getElementById('grid-size-modal').style.display = 'flex';
    });
    document.getElementById('btn-height-set').addEventListener('click', () => {
        document.getElementById('h-val').value = _grid.height;
        document.getElementById('height-modal').style.display = 'flex';
    });

    // Modal: grid size OK
    document.getElementById('gs-ok').addEventListener('click', () => {
        const cols = Math.max(1, Math.min(30, parseInt(document.getElementById('gs-cols').value) || 5));
        const rows = Math.max(1, Math.min(30, parseInt(document.getElementById('gs-rows').value) || 5));
        const size = Math.max(5, Math.min(100, parseInt(document.getElementById('gs-size').value) || 20));
        // Remove cells that are out of new bounds
        for (const key of [..._grid.cells]) {
            const [c, r] = key.split(',').map(Number);
            if (c >= cols || r >= rows) _grid.cells.delete(key);
        }
        _grid.cols = cols; _grid.rows = rows; _grid.gridSize = size;
        document.getElementById('grid-size-modal').style.display = 'none';
        renderGridCanvas();
        update3DPreview();
    });

    // Modal: height OK
    document.getElementById('h-ok').addEventListener('click', () => {
        _grid.height = Math.max(5, Math.min(400, parseInt(document.getElementById('h-val').value) || 40));
        document.getElementById('height-modal').style.display = 'none';
        renderGridCanvas();
        update3DPreview();
    });

    // Modal close buttons
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById(btn.dataset.close).style.display = 'none';
        });
    });

    // Grid canvas mouse events
    const ro = new ResizeObserver(() => { renderGridCanvas(); });
    ro.observe(canvas);

    canvas.addEventListener('mousedown', e => {
        const cell = _getCellFromEvent(canvas, e);
        if (!cell) return;
        if (_grid.originMode) {
            _grid.origin = [cell.col, cell.row];
            _grid.originMode = false;
            document.getElementById('btn-origin-mode').classList.remove('active');
            renderGridCanvas();
            update3DPreview();
            return;
        }
        _grid.isDragging = true;
        const key = `${cell.col},${cell.row}`;
        if (_grid.cells.has(key)) { _grid.dragMode = 'remove'; _grid.cells.delete(key); }
        else { _grid.dragMode = 'add'; _grid.cells.add(key); }
        renderGridCanvas();
        update3DPreview();
    });
    canvas.addEventListener('mousemove', e => {
        if (!_grid.isDragging) return;
        const cell = _getCellFromEvent(canvas, e);
        if (!cell) return;
        const key = `${cell.col},${cell.row}`;
        if (_grid.dragMode === 'add') _grid.cells.add(key);
        else _grid.cells.delete(key);
        renderGridCanvas();
        update3DPreview();
    });
    canvas.addEventListener('mouseup', () => { _grid.isDragging = false; });
    canvas.addEventListener('mouseleave', () => { _grid.isDragging = false; });
    document.addEventListener('mouseup', () => { _grid.isDragging = false; });
}

function _getCellFromEvent(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    const cellPx = Math.min(W / _grid.cols, H / _grid.rows);
    if (cellPx <= 0) return null;
    const offX = (W - cellPx * _grid.cols) / 2;
    const offY = (H - cellPx * _grid.rows) / 2;
    const col = Math.floor((x - offX) / cellPx);
    const row = Math.floor((y - offY) / cellPx);
    if (col < 0 || col >= _grid.cols || row < 0 || row >= _grid.rows) return null;
    return { col, row };
}

function renderGridCanvas() {
    const canvas = document.getElementById('model-grid-canvas');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (!W || !H) return;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cellPx = Math.min(W / _grid.cols, H / _grid.rows);
    const gridW = cellPx * _grid.cols;
    const gridH = cellPx * _grid.rows;
    const offX = (W - gridW) / 2;
    const offY = (H - gridH) / 2;

    // Background
    ctx.fillStyle = '#0f1629';
    ctx.fillRect(0, 0, W, H);

    // Selected cells
    for (const key of _grid.cells) {
        const [c, r] = key.split(',').map(Number);
        ctx.fillStyle = 'rgba(74,158,255,0.35)';
        ctx.fillRect(offX + c * cellPx, offY + r * cellPx, cellPx, cellPx);
        ctx.strokeStyle = '#4a9eff';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = '#4a9eff';
        ctx.shadowBlur = 8;
        ctx.strokeRect(offX + c * cellPx + 1, offY + r * cellPx + 1, cellPx - 2, cellPx - 2);
        ctx.shadowBlur = 0;
    }

    // Grid lines
    ctx.strokeStyle = '#2a3f6a';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let c = 0; c <= _grid.cols; c++) {
        const x = offX + c * cellPx;
        ctx.moveTo(x, offY); ctx.lineTo(x, offY + gridH);
    }
    for (let r = 0; r <= _grid.rows; r++) {
        const y = offY + r * cellPx;
        ctx.moveTo(offX, y); ctx.lineTo(offX + gridW, y);
    }
    ctx.stroke();

    // Grid border
    ctx.strokeStyle = '#4a6090';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(offX, offY, gridW, gridH);

    // Origin marker
    if (_grid.origin) {
        const [oc, or_] = _grid.origin;
        const ox = offX + (oc + 0.5) * cellPx;
        const oy = offY + (or_ + 0.5) * cellPx;
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 2;
        const arm = cellPx * 0.35;
        ctx.beginPath();
        ctx.moveTo(ox - arm, oy); ctx.lineTo(ox + arm, oy);
        ctx.moveTo(ox, oy - arm); ctx.lineTo(ox, oy + arm);
        ctx.stroke();
    }

    // Status
    const statusEl = document.getElementById('model-status');
    if (statusEl) statusEl.textContent = `${_grid.cells.size}セル | ${_grid.cols}×${_grid.rows} | 高さ:${_grid.height} | サイズ:${_grid.gridSize}`;
}

function init3DPreview() {
    const canvas = document.getElementById('model-3d-canvas');
    if (!canvas || _3dRenderer) return;
    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 300;

    _3dScene = new THREE.Scene();
    _3dScene.background = new THREE.Color(0x0f1629);
    _3dScene.fog = new THREE.Fog(0x0f1629, 800, 2000);

    _3dCamera = new THREE.PerspectiveCamera(45, w / h, 1, 3000);
    _3dCamera.position.set(0, 120, 200);
    _3dCamera.lookAt(0, 0, 0);

    _3dRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    _3dRenderer.setSize(w, h);
    _3dRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _3dRenderer.shadowMap.enabled = true;

    _3dScene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(100, 200, 100);
    dir.castShadow = true;
    _3dScene.add(dir);

    const grid = new THREE.GridHelper(600, 20, 0x1a2744, 0x1a2744);
    _3dScene.add(grid);

    _3dControls = new OrbitControls(_3dCamera, canvas);
    _3dControls.enableDamping = true;
    _3dControls.dampingFactor = 0.05;

    _3dModelGroup = new THREE.Group();
    _3dScene.add(_3dModelGroup);

    new ResizeObserver(() => {
        const w2 = canvas.clientWidth; const h2 = canvas.clientHeight;
        if (!w2 || !h2) return;
        _3dCamera.aspect = w2 / h2;
        _3dCamera.updateProjectionMatrix();
        _3dRenderer.setSize(w2, h2);
    }).observe(canvas.parentElement || canvas);

    (function animate() {
        requestAnimationFrame(animate);
        _3dControls.update();
        _3dRenderer.render(_3dScene, _3dCamera);
    })();

    if (_importedGlb) {
        _loadGlbPreview(_importedGlb.arrayBuffer);
    } else {
        update3DPreview();
    }
}

function update3DPreview() {
    if (!_3dModelGroup) return;
    // Clear
    while (_3dModelGroup.children.length > 0) {
        const child = _3dModelGroup.children[0];
        child.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
        _3dModelGroup.remove(child);
    }
    if (_grid.cells.size === 0) return;

    const cells = [..._grid.cells].map(k => k.split(',').map(Number));
    const gs = _grid.gridSize;
    const h = _grid.height;

    const allC = cells.map(([c]) => c); const allR = cells.map(([, r]) => r);
    const refC = _grid.origin ? _grid.origin[0] : (Math.min(...allC) + Math.max(...allC)) / 2;
    const refR = _grid.origin ? _grid.origin[1] : (Math.min(...allR) + Math.max(...allR)) / 2;

    cells.forEach(([c, r]) => {
        const geo = new THREE.BoxGeometry(gs * 0.95, h, gs * 0.95);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x4a9eff, transparent: true, opacity: 0.75,
            roughness: 0.35, metalness: 0.3,
            emissive: 0x1a3d6f, emissiveIntensity: 0.35,
        });
        const cube = new THREE.Mesh(geo, mat);
        cube.position.set((c - refC) * gs, h / 2, (r - refR) * gs);
        cube.castShadow = true;
        _3dModelGroup.add(cube);

        const edgeGeo = new THREE.EdgesGeometry(geo, 30);
        const edgeMat = new THREE.LineBasicMaterial({ color: 0xaaddff, transparent: true, opacity: 0.9 });
        const edges = new THREE.LineSegments(edgeGeo, edgeMat);
        edges.position.copy(cube.position);
        _3dModelGroup.add(edges);
    });
}

function _loadGlbPreview(arrayBuffer) {
    if (!_3dModelGroup) return;
    // Clear existing model
    while (_3dModelGroup.children.length > 0) {
        const child = _3dModelGroup.children[0];
        child.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
        _3dModelGroup.remove(child);
    }
    const blob = new Blob([arrayBuffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const loader = new GLTFLoader();
    loader.load(url, gltf => {
        URL.revokeObjectURL(url);
        const model = gltf.scene;
        // Auto-scale: fit to 100 units max dimension
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) model.scale.setScalar(100 / maxDim);
        // Place bottom at y=0
        box.setFromObject(model);
        model.position.y = -box.min.y;
        _3dModelGroup.add(model);
    }, undefined, err => {
        URL.revokeObjectURL(url);
        console.error('GLB load error:', err);
    });
}

function _arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunk = 8192;
    for (let i = 0; i < bytes.byteLength; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function _base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

function _exportModelGroupAsGlb() {
    return new Promise((resolve, reject) => {
        if (!_3dModelGroup || _3dModelGroup.children.length === 0) { resolve(null); return; }
        const exporter = new GLTFExporter();
        exporter.parse(_3dModelGroup, buffer => resolve(buffer), err => reject(err), { binary: true });
    });
}

// ---- Logic tab ----

function populateLogicTab() {
    initToolPalette();
    initPropsPanel();
    initSVGEvents();
    refreshLogicSVGSize();
    renderLogicSVG();
    updateInfoBar();
}

function refreshLogicSVGSize() {
    // Compute viewBox to fit all stations with padding
    const PAD = 60;
    let minX = -80, maxX = 80, minY = -80, maxY = 80;
    childStations.forEach(s => {
        const x = s.positionX || 0;
        const y = s.positionY || 0;
        if (x - PAD < minX) minX = x - PAD;
        if (x + PAD > maxX) maxX = x + PAD;
        if (y - PAD < minY) minY = y - PAD;
        if (y + PAD > maxY) maxY = y + PAD;
    });
    const svg = document.getElementById('logic-svg');
    svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
}

function renderLogicSVG() {
    renderGrid();
    renderConnections();
    renderStations();
}

function renderGrid() {
    const svg = document.getElementById('logic-svg');
    const layer = document.getElementById('logic-grid-layer');
    layer.innerHTML = '';

    const vb = svg.viewBox.baseVal;
    const x0 = Math.floor(vb.x / 20) * 20;
    const y0 = Math.floor(vb.y / 20) * 20;
    const x1 = vb.x + vb.width;
    const y1 = vb.y + vb.height;

    for (let x = x0; x <= x1; x += 20) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x); line.setAttribute('y1', vb.y);
        line.setAttribute('x2', x); line.setAttribute('y2', y1);
        const isOrigin = x === 0;
        line.setAttribute('stroke', isOrigin ? '#2a4070' : '#1a2744');
        line.setAttribute('stroke-width', isOrigin ? '0.8' : '0.4');
        layer.appendChild(line);
    }
    for (let y = y0; y <= y1; y += 20) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', vb.x); line.setAttribute('y1', y);
        line.setAttribute('x2', x1); line.setAttribute('y2', y);
        const isOrigin = y === 0;
        line.setAttribute('stroke', isOrigin ? '#2a4070' : '#1a2744');
        line.setAttribute('stroke-width', isOrigin ? '0.8' : '0.4');
        layer.appendChild(line);
    }
}

function renderConnections() {
    const layer = document.getElementById('logic-conn-layer');
    layer.innerHTML = '';

    childConnections.forEach(conn => {
        const from = childStations.find(s => s.stationId === conn.fromStation);
        const to = childStations.find(s => s.stationId === conn.toStation);
        if (!from || !to) return;

        const x1 = from.positionX || 0;
        const y1 = from.positionY || 0;
        const x2 = to.positionX || 0;
        const y2 = to.positionY || 0;

        const R = 16;
        const dx = x2 - x1; const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len; const uy = dy / len;

        const sx = x1 + ux * R; const sy = y1 + uy * R;
        const ex = x2 - ux * R; const ey = y2 - uy * R;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', sx); line.setAttribute('y1', sy);
        line.setAttribute('x2', ex); line.setAttribute('y2', ey);
        line.setAttribute('stroke', '#4a9eff');
        line.setAttribute('stroke-width', '1.5');
        line.setAttribute('marker-end', 'url(#arrowhead)');
        line.setAttribute('data-conn-id', conn.id || '');
        line.setAttribute('data-from', conn.fromStation);
        line.setAttribute('data-to', conn.toStation);
        line.style.cursor = _activeTool === 'delete' ? 'pointer' : 'default';
        layer.appendChild(line);

        // Wider invisible hit area
        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        hit.setAttribute('x1', sx); hit.setAttribute('y1', sy);
        hit.setAttribute('x2', ex); hit.setAttribute('y2', ey);
        hit.setAttribute('stroke', 'transparent');
        hit.setAttribute('stroke-width', '8');
        hit.setAttribute('data-conn-id', conn.id || '');
        hit.setAttribute('data-from', conn.fromStation);
        hit.setAttribute('data-to', conn.toStation);
        hit.style.cursor = _activeTool === 'delete' ? 'pointer' : 'default';
        hit.addEventListener('click', onConnectionClick);
        layer.appendChild(hit);
    });
}

function renderStations() {
    const layer = document.getElementById('logic-station-layer');
    layer.innerHTML = '';

    childStations.forEach(s => {
        const x = s.positionX || 0;
        const y = s.positionY || 0;
        const R = 16;
        const isSelected = s.stationId === _selectedStation;
        const isConnSource = s.stationId === _connectSource;

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('data-station-id', s.stationId);
        g.setAttribute('transform', `translate(${x}, ${y})`);
        g.style.cursor = 'pointer';

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('r', R);
        circle.setAttribute('fill', STATION_COLORS[s.stationType] || '#666');
        circle.setAttribute('stroke', isSelected ? '#fff' : (isConnSource ? '#ffcc00' : 'none'));
        circle.setAttribute('stroke-width', isSelected || isConnSource ? '2' : '0');
        g.appendChild(circle);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('dominant-baseline', 'middle');
        label.setAttribute('font-size', '8');
        label.setAttribute('fill', '#fff');
        label.setAttribute('pointer-events', 'none');
        label.textContent = (s.name || s.stationId).substring(0, 10);
        g.appendChild(label);

        g.addEventListener('mousedown', onStationMouseDown);
        g.addEventListener('click', onStationClick);
        layer.appendChild(g);
    });
}

// ---- SVG event handling ----

function svgPoint(svg, e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function initSVGEvents() {
    const svg = document.getElementById('logic-svg');

    svg.addEventListener('mousemove', e => {
        if (!_dragState) return;
        const p = svgPoint(svg, e);
        const dx = p.x - _dragState.startSVGX;
        const dy = p.y - _dragState.startSVGY;
        const s = childStations.find(s => s.stationId === _dragState.stationId);
        if (!s) return;
        s.positionX = Math.round(_dragState.origX + dx);
        s.positionY = Math.round(_dragState.origY + dy);
        refreshLogicSVGSize();
        renderLogicSVG();
        updatePropsPanel();
        updatePalettePos();
    });

    svg.addEventListener('mouseup', () => { _dragState = null; });
    svg.addEventListener('mouseleave', () => { _dragState = null; });

    svg.addEventListener('click', e => {
        if (_pendingAddType) {
            const p = svgPoint(svg, e);
            addStation(_pendingAddType, Math.round(p.x), Math.round(p.y));
            _pendingAddType = null;
            updateInfoBar();
            return;
        }
        // Click on empty space in select mode → deselect
        if (e.target === svg || e.target.tagName === 'rect') {
            if (_activeTool === 'select') {
                _selectedStation = null;
                _connectSource = null;
                updatePropsPanel();
                updatePalettePos();
                renderStations();
            }
        }
    });
}

function onStationMouseDown(e) {
    if (_activeTool !== 'select') return;
    e.stopPropagation();
    const stationId = e.currentTarget.dataset.stationId;
    const svg = document.getElementById('logic-svg');
    const p = svgPoint(svg, e);
    const s = childStations.find(s => s.stationId === stationId);
    if (!s) return;
    _dragState = {
        stationId,
        startSVGX: p.x, startSVGY: p.y,
        origX: s.positionX || 0, origY: s.positionY || 0,
    };
}

function onStationClick(e) {
    e.stopPropagation();
    const stationId = e.currentTarget.dataset.stationId;

    if (_activeTool === 'delete') {
        deleteStation(stationId);
        return;
    }

    if (_activeTool === 'connect') {
        if (!_connectSource) {
            _connectSource = stationId;
            renderStations();
            updateInfoBar('接続先をクリック');
        } else if (_connectSource !== stationId) {
            addConnection(_connectSource, stationId);
            _connectSource = null;
            renderStations();
            updateInfoBar();
        }
        return;
    }

    // select tool
    _selectedStation = stationId;
    renderStations();
    updatePropsPanel();
    updatePalettePos();
}

function onConnectionClick(e) {
    if (_activeTool !== 'delete') return;
    e.stopPropagation();
    const from = e.currentTarget.dataset.from;
    const to = e.currentTarget.dataset.to;
    childConnections = childConnections.filter(c => !(c.fromStation === from && c.toStation === to));
    renderConnections();
    updateInfoBar();
}

// ---- Tool palette ----

function initToolPalette() {
    document.querySelectorAll('.logic-palette .tool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.logic-palette .tool-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _activeTool = btn.dataset.tool;
            _connectSource = null;
            _pendingAddType = null;
            renderConnections();
            renderStations();
            updateInfoBar();
        });
    });

    document.querySelectorAll('.logic-palette .station-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            _pendingAddType = btn.dataset.type;
            updateInfoBar(`キャンバスをクリックして ${btn.dataset.type} を配置`);
        });
    });
}

// ---- Props panel ----

function initPropsPanel() {
    ['props-name', 'props-type', 'props-pos-x', 'props-pos-y', 'props-processing-time', 'props-location-id'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', () => {
            if (!_selectedStation) return;
            const s = childStations.find(s => s.stationId === _selectedStation);
            if (!s) return;
            if (id === 'props-name') s.name = el.value;
            else if (id === 'props-type') s.stationType = el.value;
            else if (id === 'props-pos-x') { s.positionX = parseInt(el.value) || 0; refreshLogicSVGSize(); renderLogicSVG(); }
            else if (id === 'props-pos-y') { s.positionY = parseInt(el.value) || 0; refreshLogicSVGSize(); renderLogicSVG(); }
            else if (id === 'props-processing-time') {
                s.config = s.config || {};
                s.config.processingTime = parseInt(el.value) || 0;
            } else if (id === 'props-location-id') {
                s.config = s.config || {};
                s.config.locationId = parseInt(el.value) || 0;
            }
            updatePalettePos();
        });
    });

    document.getElementById('props-delete').addEventListener('click', () => {
        if (_selectedStation) deleteStation(_selectedStation);
    });
}

function updatePropsPanel() {
    const empty = document.getElementById('props-empty');
    const fields = document.getElementById('props-fields');

    if (!_selectedStation) {
        empty.style.display = '';
        fields.style.display = 'none';
        return;
    }
    const s = childStations.find(s => s.stationId === _selectedStation);
    if (!s) {
        empty.style.display = '';
        fields.style.display = 'none';
        return;
    }
    empty.style.display = 'none';
    fields.style.display = '';

    document.getElementById('props-name').value = s.name || '';
    document.getElementById('props-type').value = s.stationType || 'processing';
    document.getElementById('props-pos-x').value = s.positionX || 0;
    document.getElementById('props-pos-y').value = s.positionY || 0;
    document.getElementById('props-processing-time').value = s.config?.processingTime || 0;
    document.getElementById('props-location-id').value = s.config?.locationId || 0;
}

function updatePalettePos() {
    const el = document.getElementById('palette-pos');
    if (!el) return;
    if (!_selectedStation) { el.innerHTML = 'X: —<br>Y: —'; return; }
    const s = childStations.find(s => s.stationId === _selectedStation);
    if (!s) { el.innerHTML = 'X: —<br>Y: —'; return; }
    el.innerHTML = `X: ${s.positionX || 0}<br>Y: ${s.positionY || 0}`;
}

function updateInfoBar(msg) {
    const bar = document.getElementById('logic-info-bar');
    if (!bar) return;
    if (msg) { bar.textContent = msg; return; }
    bar.textContent = `${childStations.length}ステーション、${childConnections.length}接続 — 選択ツール: ドラッグで移動、接続ツール: クリックで接続作成`;
}

// ---- Data operations ----

function addStation(type, x = 0, y = 0) {
    const id = `${MACHINE_ID}_${type}_${Date.now()}`;
    childStations.push({
        stationId: id,
        stationType: type,
        name: type,
        parentId: MACHINE_ID,
        positionX: x,
        positionY: y,
        config: {},
    });
    _selectedStation = id;
    refreshLogicSVGSize();
    renderLogicSVG();
    updatePropsPanel();
    updatePalettePos();
    updateInfoBar();
}

function addConnection(fromStation, toStation) {
    const exists = childConnections.some(c => c.fromStation === fromStation && c.toStation === toStation);
    if (exists) return;
    childConnections.push({ fromStation, toStation, condition: 'default', fromPortIndex: -1, toPortIndex: -1 });
    renderConnections();
    updateInfoBar();
}

function deleteStation(stationId) {
    childStations = childStations.filter(s => s.stationId !== stationId);
    childConnections = childConnections.filter(c => c.fromStation !== stationId && c.toStation !== stationId);
    if (_selectedStation === stationId) _selectedStation = null;
    refreshLogicSVGSize();
    renderLogicSVG();
    updatePropsPanel();
    updatePalettePos();
    updateInfoBar();
}

// ---- Save ----

async function saveAndClose() {
    const btn = document.getElementById('btn-save');
    btn.disabled = true;
    btn.textContent = '保存中...';

    try {
        // Tab 1: Save name + metadata
        const name = document.getElementById('info-name').value.trim();
        const metaStr = document.getElementById('info-metadata').value.trim();
        let metaUpdate = {};
        if (name) metaUpdate.name = name;
        if (metaStr) {
            try { metaUpdate.config = { ...(machineStation?.config || {}), metadata: JSON.parse(metaStr) }; }
            catch { /* ignore JSON parse error */ }
        }
        if (Object.keys(metaUpdate).length > 0) {
            await API.updateStation(FACTORY_ID, MACHINE_ID, metaUpdate);
        }

        // Tab 2: Save 3D model
        const baseConfig = machineStation?.config || {};
        if (_importedGlb) {
            // GLBインポート: model3DGlbのみ保存、model3DGridをクリア
            const data = _arrayBufferToBase64(_importedGlb.arrayBuffer);
            await API.updateStation(FACTORY_ID, MACHINE_ID, {
                config: { ...baseConfig, model3DGlb: { data, name: _importedGlb.name }, model3DGrid: null },
            });
        } else if (_grid.cells.size > 0) {
            // グリッド編集: model3DGrid（再編集用）+ model3DGlb（表示用GLBエクスポート）の両方保存
            const model3DGrid = {
                gridSize: _grid.gridSize,
                height: _grid.height,
                cols: _grid.cols,
                rows: _grid.rows,
                cells: [..._grid.cells].map(k => k.split(',').map(Number)),
                origin: _grid.origin,
            };
            const glbBuffer = await _exportModelGroupAsGlb();
            const model3DGlb = glbBuffer
                ? { data: _arrayBufferToBase64(glbBuffer), name: 'model.glb' }
                : null;
            await API.updateStation(FACTORY_ID, MACHINE_ID, {
                config: { ...baseConfig, model3DGrid, model3DGlb },
            });
        }

        // Tab 3: Save logic (stations with positionX/Y + connections)
        await API.saveMachineLogic(FACTORY_ID, MACHINE_ID, childStations, childConnections);

        window.close();
    } catch (err) {
        alert('保存失敗: ' + err.message);
        btn.disabled = false;
        btn.textContent = '保存して閉じる';
    }
}
