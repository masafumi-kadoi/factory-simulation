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
const METER_SCALE = 1; // 1m = 1 Three.js unit (GLTF standard)
const _grid = {
    gridSize: 0.5,   // meters per cell
    height: 1.5,     // meters tall
    cols: 20,
    rows: 20,
    cells: new Set(), // "col,row" strings
    origin: null,     // [col, row] or null — maps to (0,0,0) in exported model
    originMode: false,
    isDragging: false,
    dragMode: null,   // 'add' | 'remove'
};
let _gridZoom = 1.0; // 2Dグリッドキャンバスの表示倍率
let _3dRenderer = null;
let _3dScene = null;
let _3dCamera = null;
let _3dControls = null;
let _3dModelGroup = null;
let _importedGlb = null; // { arrayBuffer: ArrayBuffer, name: string } | null
let _glbPreviewBuffer = null; // 3Dプレビュー用GLBバッファ（保存済みGLBをプレビューに表示するため）
let _deleteModel = false; // 保存時にmodel3DGrid/model3DGlbを両方削除するフラグ
let _logicProjectionRenderer = null; // Three.js WebGLRenderer for logic tab top-down view
let _logicProjectionCamera = null;   // OrthographicCamera (re-used on zoom/pan)
let _logicProjectionScene = null;    // Scene (re-used on zoom/pan)
let _logicProjectionCX = 0;          // Camera center X (world)
let _logicProjectionCZ = 0;          // Camera center Z (world)
let _logicWorldBounds = null; // { left, right, top, bottom } in Three.js world coords (X and Z axes)
let _logicViewBox = { x: 0, y: 0, w: 200, h: 200 }; // current SVG viewBox (zoom/pan state)

// ---- Logic tab state ----

let _activeTool = 'select';
let _selectedStation = null;    // stationId string
let _connectSource = null;      // stationId of pending connection source
let _dragState = null;          // { stationId, startSVGX, startSVGY, origX, origY }
let _svgPanState = null;        // { clientX, clientY, vb: snapshot } for middle-click pan
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
                if (_3dRenderer) {
                    if (_importedGlb) _loadGlbPreview(_importedGlb.arrayBuffer);
                    else if (_glbPreviewBuffer) _loadGlbPreview(_glbPreviewBuffer);
                }
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
    _deleteModel = false;
    _importedGlb = null;
    _glbPreviewBuffer = null;
    _gridZoom = 1.0;
    const cfg = machineStation?.config || {};

    // グリッドデータが優先（再編集可能）
    const g = cfg.model3DGrid;
    if (g && Array.isArray(g.cells) && g.cells.length > 0) {
        if (g.gridSize) _grid.gridSize = g.gridSize;
        if (g.height)   _grid.height   = g.height;
        if (g.cols)     _grid.cols     = g.cols;
        if (g.rows)     _grid.rows     = g.rows;
        if (g.origin)   _grid.origin   = g.origin;
        _grid.cells.clear();
        g.cells.forEach(([c, r]) => _grid.cells.add(`${c},${r}`));
        // 保存済みGLBがある場合は3DプレビューにそのGLBを表示（編集始めたらvoxelに切替）
        if (cfg.model3DGlb?.data) {
            _glbPreviewBuffer = _base64ToArrayBuffer(cfg.model3DGlb.data);
        }
        renderGridCanvas();
        return;
    }

    // グリッドがない場合はGLBを表示（インポートしたモデル）
    if (cfg.model3DGlb?.data) {
        _importedGlb = {
            arrayBuffer: _base64ToArrayBuffer(cfg.model3DGlb.data),
            name: cfg.model3DGlb.name || 'model.glb',
        };
        _grid.cells.clear();
        _grid.origin = null;
        renderGridCanvas();
        return;
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

    // モデル削除ボタン
    document.getElementById('btn-delete-model').addEventListener('click', () => {
        if (!confirm('保存済みの3Dモデルを削除しますか？\n保存するまで変更は確定しません。')) return;
        _deleteModel = true;
        _importedGlb = null;
        _grid.cells.clear();
        _grid.origin = null;
        _grid.originMode = false;
        document.getElementById('btn-origin-mode').classList.remove('active');
        document.getElementById('model-status').textContent = '削除予定（保存で確定）';
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
        const cols = Math.max(1, Math.min(50, parseInt(document.getElementById('gs-cols').value) || 20));
        const rows = Math.max(1, Math.min(50, parseInt(document.getElementById('gs-rows').value) || 20));
        const size = Math.max(0.1, Math.min(10, parseFloat(document.getElementById('gs-size').value) || 0.5));
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
        _grid.height = Math.max(0.1, Math.min(20, parseFloat(document.getElementById('h-val').value) || 1.5));
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
        _glbPreviewBuffer = null; // グリッド編集開始 → voxelプレビューに切替
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

    // ホイールズーム
    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        _gridZoom = Math.max(0.2, Math.min(8, _gridZoom * factor));
        renderGridCanvas();
    }, { passive: false });
}

function _getCellFromEvent(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    const cellPx = Math.min(W / _grid.cols, H / _grid.rows) * _gridZoom;
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

    const cellPx = Math.min(W / _grid.cols, H / _grid.rows) * _gridZoom;
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
    if (statusEl) statusEl.textContent = `${_grid.cells.size}セル | ${_grid.cols}×${_grid.rows} | ${_grid.gridSize}m/cell | 高さ:${_grid.height}m`;
}

function init3DPreview() {
    const canvas = document.getElementById('model-3d-canvas');
    if (!canvas || _3dRenderer) return;
    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 300;

    _3dScene = new THREE.Scene();
    _3dScene.background = new THREE.Color(0x0f1629);
    _3dScene.fog = new THREE.Fog(0x0f1629, 80, 200);

    _3dCamera = new THREE.PerspectiveCamera(45, w / h, 0.1, 300);
    _3dCamera.position.set(0, 12, 20);
    _3dCamera.lookAt(0, 0, 0);

    _3dRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    _3dRenderer.setSize(w, h);
    _3dRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _3dRenderer.shadowMap.enabled = true;

    _3dScene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(10, 20, 10);
    dir.castShadow = true;
    _3dScene.add(dir);

    const grid = new THREE.GridHelper(60, 20, 0x1a2744, 0x1a2744);
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
    } else if (_glbPreviewBuffer) {
        _loadGlbPreview(_glbPreviewBuffer);
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
    const gs = _grid.gridSize * METER_SCALE;
    const h = _grid.height * METER_SCALE;

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
        if (maxDim > 0) model.scale.setScalar(10 / maxDim);
        // Place bottom at y=0
        box.setFromObject(model);
        model.position.y = -box.min.y;
        _3dModelGroup.add(model);
    }, undefined, err => {
        URL.revokeObjectURL(url);
        console.error('GLB load error:', err);
    });
}

function _initLogicProjection() {
    // GLBデータを取得（インポート済みまたはDB保存済み）
    let arrayBuffer = null;
    if (_importedGlb?.arrayBuffer) {
        arrayBuffer = _importedGlb.arrayBuffer;
    } else {
        const glbData = machineStation?.config?.model3DGlb?.data;
        if (glbData) arrayBuffer = _base64ToArrayBuffer(glbData);
    }
    if (!arrayBuffer) return;

    const canvas = document.getElementById('logic-projection-canvas');
    if (!canvas) return;

    // 前のレンダラーを破棄
    if (_logicProjectionRenderer) {
        _logicProjectionRenderer.dispose();
        _logicProjectionRenderer = null;
    }
    _logicProjectionCamera = null;
    _logicProjectionScene = null;
    _logicWorldBounds = null;

    // キャンバスサイズ（親要素から取得）
    const area = canvas.parentElement;
    const W = area.clientWidth || 600;
    const H = area.clientHeight || 400;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setSize(W, H, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0f1629, 1);
    _logicProjectionRenderer = renderer;

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));

    const blob = new Blob([arrayBuffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const loader = new GLTFLoader();
    loader.load(url, gltf => {
        URL.revokeObjectURL(url);
        const model = gltf.scene;
        scene.add(model);

        // バウンディングボックスを計算（Three.js単位）
        const bbox = new THREE.Box3().setFromObject(model);
        const sizeX = bbox.max.x - bbox.min.x;
        const sizeZ = bbox.max.z - bbox.min.z;
        const cx = (bbox.min.x + bbox.max.x) / 2;
        const cz = (bbox.min.z + bbox.max.z) / 2;

        // アスペクト比を合わせてカメラ範囲を決定（5%パディング付き）
        const aspect = W / (H || 1);
        const halfModelW = sizeX / 2 * 1.05;
        const halfModelH = sizeZ / 2 * 1.05;
        const halfWcam = Math.max(halfModelW, halfModelH * aspect);
        const halfHcam = halfWcam / aspect;

        // ワールド座標のビュー範囲を記録（METER_SCALE=1のためThree.js単位=メートル）
        _logicWorldBounds = {
            left:   cx - halfWcam,
            right:  cx + halfWcam,
            top:    cz - halfHcam,   // 画面上端 = 小さいZ
            bottom: cz + halfHcam,   // 画面下端 = 大きいZ
        };

        // OrthographicCamera: 真上(-Y方向)から見下ろす
        const cam = new THREE.OrthographicCamera(
            -halfWcam, halfWcam,   // left, right（カメラローカル = ワールドX）
             halfHcam, -halfHcam,  // top, bottom（カメラローカルY+ = ワールドZ-）
            0.1, 1000
        );
        cam.position.set(cx, 100, cz);
        cam.lookAt(cx, 0, cz);
        cam.up.set(0, 0, -1); // Z-方向が画面上端

        // グローバルに保持（ズーム/パン時に再レンダリング可能にする）
        _logicProjectionCamera = cam;
        _logicProjectionScene = scene;
        _logicProjectionCX = cx;
        _logicProjectionCZ = cz;

        renderer.render(scene, cam);

        // SVG viewBoxをGLTFのワールド座標に合わせてリセット（初回のみ全体表示）
        _resetLogicViewBox();
        renderLogicSVG();
    }, undefined, err => {
        URL.revokeObjectURL(url);
        console.error('Logic projection load error:', err);
    });
}

function _resetLogicViewBox() {
    // 初期viewBoxをGLTFバウンディングまたはステーション座標から設定（ズームリセット）
    if (_logicWorldBounds) {
        const { left, top, right, bottom } = _logicWorldBounds;
        _logicViewBox = { x: left, y: top, w: right - left, h: bottom - top };
    } else {
        const PAD = 60;
        let minX = -80, maxX = 80, minY = -80, maxY = 80;
        childStations.forEach(s => {
            if (s.positionX == null) return;
            const x = s.positionX, y = s.positionY || 0;
            if (x - PAD < minX) minX = x - PAD;
            if (x + PAD > maxX) maxX = x + PAD;
            if (y - PAD < minY) minY = y - PAD;
            if (y + PAD > maxY) maxY = y + PAD;
        });
        _logicViewBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    _applyLogicViewBox();
    _rerenderLogicProjection();
}

function _applyLogicViewBox() {
    const svg = document.getElementById('logic-svg');
    if (!svg) return;
    svg.setAttribute('viewBox', `${_logicViewBox.x} ${_logicViewBox.y} ${_logicViewBox.w} ${_logicViewBox.h}`);
}

function _rerenderLogicProjection() {
    if (!_logicProjectionRenderer || !_logicProjectionCamera || !_logicProjectionScene) return;
    const { x: vx, y: vy, w: vw, h: vh } = _logicViewBox;
    const cam = _logicProjectionCamera;
    cam.left   = vx - _logicProjectionCX;
    cam.right  = (vx + vw) - _logicProjectionCX;
    cam.top    = _logicProjectionCZ - vy;
    cam.bottom = _logicProjectionCZ - (vy + vh);
    cam.updateProjectionMatrix();
    const canvas = document.getElementById('logic-projection-canvas');
    const area = canvas?.parentElement;
    if (area) _logicProjectionRenderer.setSize(area.clientWidth, area.clientHeight, false);
    _logicProjectionRenderer.render(_logicProjectionScene, _logicProjectionCamera);
}

function _updateLogicViewBox() {
    _applyLogicViewBox();
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

// Build a merged THREE.Group using greedy rectangle algorithm.
// Adjacent filled cells are combined into the largest possible rectangular block,
// so 4 cells in a 2x2 square become one BoxGeometry instead of four.
function _buildMergedGroup() {
    const { gridSize: gridSizeM, height: heightM, cols, rows, cells, origin } = _grid;
    const gs = gridSizeM * METER_SCALE;
    const h = heightM * METER_SCALE;
    if (cells.size === 0) return null;

    const filled = Array.from({ length: rows }, () => new Array(cols).fill(false));
    for (const key of cells) {
        const [c, r] = key.split(',').map(Number);
        if (c >= 0 && c < cols && r >= 0 && r < rows) filled[r][c] = true;
    }

    const allCells = [...cells].map(k => k.split(',').map(Number));
    const allC = allCells.map(([c]) => c);
    const allR = allCells.map(([, r]) => r);
    const refC = origin ? origin[0] : (Math.min(...allC) + Math.max(...allC)) / 2;
    const refR = origin ? origin[1] : (Math.min(...allR) + Math.max(...allR)) / 2;

    const processed = Array.from({ length: rows }, () => new Array(cols).fill(false));
    const group = new THREE.Group();

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (!filled[r][c] || processed[r][c]) continue;

            // Expand right
            let w = 0;
            while (c + w < cols && filled[r][c + w] && !processed[r][c + w]) w++;

            // Expand down (all w columns must be unprocessed+filled in each next row)
            let dh = 1;
            outer: while (r + dh < rows) {
                for (let dc = 0; dc < w; dc++) {
                    if (!filled[r + dh][c + dc] || processed[r + dh][c + dc]) break outer;
                }
                dh++;
            }

            for (let dr = 0; dr < dh; dr++)
                for (let dc = 0; dc < w; dc++)
                    processed[r + dr][c + dc] = true;

            const cx = (c + w / 2 - refC) * gs;
            const cz = (r + dh / 2 - refR) * gs;
            const geo = new THREE.BoxGeometry(w * gs, h, dh * gs);
            const mat = new THREE.MeshStandardMaterial({ color: 0x4a9eff, roughness: 0.35, metalness: 0.3 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(cx, h / 2, cz);
            group.add(mesh);
        }
    }
    return group;
}

function _exportModelGroupAsGlb() {
    return new Promise((resolve, reject) => {
        const mergedGroup = _buildMergedGroup();
        if (!mergedGroup || mergedGroup.children.length === 0) { resolve(null); return; }
        const exporter = new GLTFExporter();
        exporter.parse(mergedGroup, buffer => {
            mergedGroup.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
            resolve(buffer);
        }, err => reject(err), { binary: true });
    });
}

// ---- Logic tab ----

function populateLogicTab() {
    initToolPalette();
    initPropsPanel();
    initSVGEvents();
    _initLogicProjection(); // GLTFがある場合 → _resetLogicViewBox()を呼ぶ
    if (!_logicWorldBounds) _resetLogicViewBox(); // GLTFなし場合もviewBox初期化
    renderLogicSVG();
    renderUnplacedList();
    updateInfoBar();
}

function refreshLogicSVGSize() {
    // ズーム/パン中はviewBoxを維持。ステーション移動後もviewBoxはそのまま。
    // 初期化はpopulateLogicTab → _initLogicProjection → _resetLogicViewBoxで行う。
    _applyLogicViewBox();
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

    const vb = _logicViewBox;
    // グリッドステップをviewBox幅から自動計算（~15本になるよう調整）
    const rawStep = vb.w / 15;
    const step = _niceStep(rawStep);
    const sw = vb.w / 500; // stroke-widthもviewBoxに比例
    const x0 = Math.floor(vb.x / step) * step;
    const y0 = Math.floor(vb.y / step) * step;
    const x1 = vb.x + vb.w;
    const y1 = vb.y + vb.h;

    for (let x = x0; x <= x1 + step * 0.01; x += step) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x); line.setAttribute('y1', vb.y);
        line.setAttribute('x2', x); line.setAttribute('y2', y1);
        const isOrigin = Math.abs(x) < step * 0.01;
        line.setAttribute('stroke', isOrigin ? '#2a4070' : '#1a2744');
        line.setAttribute('stroke-width', (isOrigin ? sw * 2 : sw).toFixed(4));
        layer.appendChild(line);
    }
    for (let y = y0; y <= y1 + step * 0.01; y += step) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', vb.x); line.setAttribute('y1', y);
        line.setAttribute('x2', x1); line.setAttribute('y2', y);
        const isOrigin = Math.abs(y) < step * 0.01;
        line.setAttribute('stroke', isOrigin ? '#2a4070' : '#1a2744');
        line.setAttribute('stroke-width', (isOrigin ? sw * 2 : sw).toFixed(4));
        layer.appendChild(line);
    }
}

function _niceStep(raw) {
    const exp = Math.pow(10, Math.floor(Math.log10(raw)));
    const frac = raw / exp;
    if (frac < 1.5) return exp;
    if (frac < 3.5) return 2 * exp;
    if (frac < 7.5) return 5 * exp;
    return 10 * exp;
}

function renderConnections() {
    const layer = document.getElementById('logic-conn-layer');
    layer.innerHTML = '';

    childConnections.forEach(conn => {
        const from = childStations.find(s => s.stationId === conn.fromStation);
        const to = childStations.find(s => s.stationId === conn.toStation);
        if (!from || !to) return;
        if (from.positionX == null || to.positionX == null) return; // 未配置はスキップ

        const x1 = from.positionX;
        const y1 = from.positionY || 0;
        const x2 = to.positionX;
        const y2 = to.positionY || 0;

        const R = _logicViewBox.w / 25;
        const lw = _logicViewBox.w / 400;
        const hitW = R * 0.6;
        const dx = x2 - x1; const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len; const uy = dy / len;

        const sx = x1 + ux * R; const sy = y1 + uy * R;
        const ex = x2 - ux * R; const ey = y2 - uy * R;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', sx); line.setAttribute('y1', sy);
        line.setAttribute('x2', ex); line.setAttribute('y2', ey);
        line.setAttribute('stroke', '#4a9eff');
        line.setAttribute('stroke-width', lw);
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
        hit.setAttribute('stroke-width', hitW);
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

    const R = _logicViewBox.w / 25; // viewBox幅の1/25をステーション半径に
    const sw = R / 5;
    const fs = R * 0.65;

    childStations.forEach(s => {
        if (s.positionX == null) return; // 未配置はサイドバーに表示
        const x = s.positionX;
        const y = s.positionY || 0;
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
        circle.setAttribute('stroke-width', isSelected || isConnSource ? sw : '0');
        g.appendChild(circle);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('dominant-baseline', 'middle');
        label.setAttribute('font-size', fs);
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
        s.positionX = Math.round((_dragState.origX + dx) * 100) / 100;
        s.positionY = Math.round((_dragState.origY + dy) * 100) / 100;
        refreshLogicSVGSize();
        renderLogicSVG();
        updatePropsPanel();
        updatePalettePos();
    });

    svg.addEventListener('mouseup', () => { _dragState = null; });
    svg.addEventListener('mouseleave', () => { _dragState = null; });

    svg.addEventListener('click', e => {
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

    // ---- Wheel zoom ----
    svg.addEventListener('wheel', e => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        const p = svgPoint(svg, e);
        _logicViewBox = {
            x: p.x - (p.x - _logicViewBox.x) * factor,
            y: p.y - (p.y - _logicViewBox.y) * factor,
            w: _logicViewBox.w * factor,
            h: _logicViewBox.h * factor,
        };
        _applyLogicViewBox();
        _rerenderLogicProjection();
        renderLogicSVG();
    }, { passive: false });

    // ---- Middle-click pan ----
    svg.addEventListener('mousedown', e => {
        if (e.button === 1) {
            e.preventDefault();
            _svgPanState = { cx: e.clientX, cy: e.clientY, vb: { ..._logicViewBox } };
        }
    });
    svg.addEventListener('mousemove', e => {
        if (!_svgPanState) return;
        const rect = svg.getBoundingClientRect();
        const scaleX = _svgPanState.vb.w / rect.width;
        const scaleY = _svgPanState.vb.h / rect.height;
        _logicViewBox = {
            x: _svgPanState.vb.x - (e.clientX - _svgPanState.cx) * scaleX,
            y: _svgPanState.vb.y - (e.clientY - _svgPanState.cy) * scaleY,
            w: _svgPanState.vb.w,
            h: _svgPanState.vb.h,
        };
        _applyLogicViewBox();
        _rerenderLogicProjection();
        renderLogicSVG();
    });
    window.addEventListener('mouseup', e => {
        if (e.button === 1) _svgPanState = null;
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

    // 新規ステーション追加ボタン
    document.getElementById('btn-add-station')?.addEventListener('click', () => {
        const type = document.getElementById('add-station-type')?.value || 'processing';
        addStation(type); // positionX/Y = null（未配置）
        renderUnplacedList();
    });

    // ドロップゾーン設定
    const area = document.querySelector('.logic-canvas-area');
    if (area) {
        area.addEventListener('dragover', e => e.preventDefault());
        area.addEventListener('drop', e => _dropToLogicCanvas(e));
    }
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
            else if (id === 'props-pos-x') { s.positionX = parseFloat(el.value) || 0; refreshLogicSVGSize(); renderLogicSVG(); }
            else if (id === 'props-pos-y') { s.positionY = parseFloat(el.value) || 0; refreshLogicSVGSize(); renderLogicSVG(); }
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

    document.getElementById('props-unplace').addEventListener('click', () => {
        if (!_selectedStation) return;
        const s = childStations.find(s => s.stationId === _selectedStation);
        if (!s) return;
        s.positionX = null;
        s.positionY = null;
        _selectedStation = null;
        refreshLogicSVGSize();
        renderLogicSVG();
        renderUnplacedList();
        updatePropsPanel();
        updateInfoBar();
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
    el.innerHTML = `X: ${s.positionX || 0}m<br>Y: ${s.positionY || 0}m`;
}

function updateInfoBar(msg) {
    const bar = document.getElementById('logic-info-bar');
    if (!bar) return;
    if (msg) { bar.textContent = msg; return; }
    bar.textContent = `${childStations.length}ステーション、${childConnections.length}接続 — 選択ツール: ドラッグで移動、接続ツール: クリックで接続作成`;
}

// ---- Data operations ----

function addStation(type, x = null, y = null) {
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
    _selectedStation = x !== null ? id : null;
    if (x !== null) {
        refreshLogicSVGSize();
        renderLogicSVG();
        updatePropsPanel();
        updatePalettePos();
    }
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
    renderUnplacedList();
    updatePropsPanel();
    updatePalettePos();
    updateInfoBar();
}

function _dropToLogicCanvas(e) {
    e.preventDefault();
    const stationId = e.dataTransfer.getData('text/station-id');
    const s = childStations.find(st => st.stationId === stationId);
    if (!s) return;

    let lx, lz;
    if (_logicWorldBounds) {
        // GLTF投影モード: キャンバス座標 → GLTFローカル座標
        const area = document.querySelector('.logic-canvas-area');
        const rect = area.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const W = rect.width || 1;
        const H = rect.height || 1;
        const { left, right, top, bottom } = _logicWorldBounds;
        lx = left + (px / W) * (right - left);
        lz = top  + (py / H) * (bottom - top);
    } else {
        // GLTFなしモード: SVG座標に変換
        const svg = document.getElementById('logic-svg');
        const pt = svg.createSVGPoint();
        pt.x = e.clientX; pt.y = e.clientY;
        const sp = pt.matrixTransform(svg.getScreenCTM().inverse());
        lx = Math.round(sp.x);
        lz = Math.round(sp.y);
    }

    s.positionX = lx;
    s.positionY = lz;
    _selectedStation = stationId;
    refreshLogicSVGSize();
    renderUnplacedList();
    renderLogicSVG();
    updatePropsPanel();
    updatePalettePos();
    updateInfoBar();
}

function renderUnplacedList() {
    const list = document.getElementById('unplaced-station-list');
    if (!list) return;
    list.innerHTML = '';
    const unplaced = childStations.filter(s => s.positionX == null);
    if (unplaced.length === 0) {
        const msg = document.createElement('div');
        msg.className = 'unplaced-empty';
        msg.textContent = '全て配置済み';
        list.appendChild(msg);
        return;
    }
    unplaced.forEach(s => {
        const item = document.createElement('div');
        item.className = 'unplaced-item';
        item.draggable = true;
        item.dataset.stationId = s.stationId;
        item.title = `${s.name} (${s.stationType})`;
        item.textContent = s.name || s.stationType;
        item.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/station-id', s.stationId);
            e.dataTransfer.effectAllowed = 'move';
        });
        list.appendChild(item);
    });
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
        if (_deleteModel) {
            // モデル削除: 編集用データとGLBの両方をリセット
            await API.updateStation(FACTORY_ID, MACHINE_ID, {
                config: { ...baseConfig, model3DGrid: null, model3DGlb: null },
            });
        } else if (_importedGlb) {
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

        btn.disabled = false;
        btn.textContent = '保存する';
    } catch (err) {
        alert('保存失敗: ' + err.message);
        btn.disabled = false;
        btn.textContent = '保存する';
    }
}
