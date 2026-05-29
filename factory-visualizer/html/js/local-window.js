// Local window — Machine editor
import * as API from './api.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const params = new URLSearchParams(location.search);
const FACTORY_ID = params.get('factoryId') || '';
const MACHINE_ID = params.get('machineId') || '';
// 設備名: equipName URL param、なければ stationId のドット前の部分（例 fuga.001 → fuga）
const EQUIP_NAME = params.get('equipName') || MACHINE_ID.replace(/\.[^.]+$/, '') || MACHINE_ID;

// ステーションタイプの判定
// .000 = 設備マスター（3Dモデル・設備情報を保持）
// .001+ = サブマシン（ロジック・内部ステーションを保持）
// サフィックスなし = スタンドアロン（全タブ表示）
const _SUFFIX_MATCH = MACHINE_ID.match(/^(.+?)[._-](\d{3})$/);
const _STATION_SUFFIX = _SUFFIX_MATCH ? _SUFFIX_MATCH[2] : null;
const _IS_MASTER = !_SUFFIX_MATCH || _STATION_SUFFIX === '000';
const _IS_SUB    = !!_SUFFIX_MATCH && _STATION_SUFFIX !== '000';

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
let _logicModelBounds = null; // { minX, maxX, minZ, maxZ } GLBモデルのXZ範囲（metres）
let _logicModelRoot = null;   // loaded GLB model object (for coordinate shifts)
let _logicViewBox = { x: -8, y: -8, w: 16, h: 16 }; // current SVG viewBox (zoom/pan state) — meters
let _stationRadius = 0.25; // fixed station radius in metres
let _logicOriginMode = false;
let _logicOriginX = null;     // origin X in metres for SVG marker (null = not set, 0 after set)
let _logicOriginZ = null;
let _modelOriginOffsetX = 0;  // cumulative X offset saved to equipmentOrigin
let _modelOriginOffsetZ = 0;

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

// ---- Interlock rule editor constants ----

const INTERLOCK_DEFAULTS = {
    processing: {
        signals: [
            {name:'inputWorkPresent',initial:false},{name:'processingWorkPresent',initial:false},
            {name:'outputWorkPresent',initial:false},{name:'running',initial:false},
            {name:'complete',initial:false},{name:'processReady',initial:false},
            {name:'inputReady',initial:false},{name:'outputReady',initial:false},
            {name:'workFull',initial:false},{name:'workEmpty',initial:false},
        ],
        rules: [
            { id:'R1', description:'空きステーション → 搬入可ON',  target:'inputReady',   value:true,  conditions:[{signal:'inputWorkPresent',value:false},{signal:'processingWorkPresent',value:false},{signal:'outputWorkPresent',value:false}] },
            { id:'R2', description:'ワーク受入済 → 搬入可OFF',     target:'inputReady',   value:false, conditions:[{signal:'inputWorkPresent',value:true}] },
            { id:'R3', description:'ワーク到着 → 加工準備ON',      target:'processReady', value:true,  conditions:[{signal:'inputWorkPresent',value:true},{signal:'running',value:false},{signal:'complete',value:false}] },
            { id:'R4', description:'加工中 → 加工準備OFF',         target:'processReady', value:false, conditions:[{signal:'running',value:true}] },
            { id:'R5', description:'処理完了 → 搬出可ON',          target:'outputReady',  value:true,  conditions:[{signal:'complete',value:true},{signal:'outputWorkPresent',value:true}] },
            { id:'R6', description:'ワーク搬出済 → 搬出可OFF',     target:'outputReady',  value:false, conditions:[{signal:'outputWorkPresent',value:false}] },
        ],
    },
    merge: {
        signals: [
            {name:'inputWorkPresent',initial:false},{name:'processingWorkPresent',initial:false},
            {name:'outputWorkPresent',initial:false},{name:'running',initial:false},
            {name:'complete',initial:false},{name:'processReady',initial:false},
            {name:'inputReady',initial:false},{name:'outputReady',initial:false},
            {name:'workFull',initial:false},{name:'workEmpty',initial:false},
            {name:'allPortsFull',initial:false},
        ],
        rules: [
            { id:'R1', description:'全ポート満杯 → 加工準備ON',  target:'processReady', value:true,  conditions:[{signal:'allPortsFull',value:true},{signal:'running',value:false},{signal:'complete',value:false}] },
            { id:'R2', description:'加工中 → 加工準備OFF',       target:'processReady', value:false, conditions:[{signal:'running',value:true}] },
            { id:'R3', description:'結合処理完了 → 搬出可ON',    target:'outputReady',  value:true,  conditions:[{signal:'complete',value:true},{signal:'outputWorkPresent',value:true}] },
            { id:'R4', description:'ワーク搬出済 → 搬出可OFF',   target:'outputReady',  value:false, conditions:[{signal:'outputWorkPresent',value:false}] },
        ],
    },
    split: {
        signals: [
            {name:'inputWorkPresent',initial:false},{name:'processingWorkPresent',initial:false},
            {name:'outputWorkPresent',initial:false},{name:'running',initial:false},
            {name:'complete',initial:false},{name:'processReady',initial:false},
            {name:'inputReady',initial:false},{name:'outputReady',initial:false},
            {name:'workFull',initial:false},{name:'workEmpty',initial:true},
            {name:'allPortsEmpty',initial:true},
        ],
        rules: [
            { id:'R1', description:'全ポート空 → 搬入可ON',    target:'inputReady',   value:true,  conditions:[{signal:'allPortsEmpty',value:true},{signal:'inputWorkPresent',value:false},{signal:'running',value:false},{signal:'complete',value:false}] },
            { id:'R2', description:'ワーク受入済 → 搬入可OFF', target:'inputReady',   value:false, conditions:[{signal:'inputWorkPresent',value:true}] },
            { id:'R3', description:'ワーク到着 → 加工準備ON',  target:'processReady', value:true,  conditions:[{signal:'inputWorkPresent',value:true},{signal:'running',value:false},{signal:'complete',value:false}] },
            { id:'R4', description:'加工中 → 加工準備OFF',     target:'processReady', value:false, conditions:[{signal:'running',value:true}] },
        ],
    },
    switch: {
        signals: [
            {name:'inputWorkPresent',initial:false},{name:'processingWorkPresent',initial:false},
            {name:'outputWorkPresent',initial:false},{name:'running',initial:false},
            {name:'complete',initial:false},{name:'processReady',initial:false},
            {name:'inputReady',initial:false},{name:'outputReady',initial:false},
            {name:'workFull',initial:false},{name:'workEmpty',initial:false},
        ],
        rules: [
            { id:'R1', description:'ワーク到着 → 搬出可ON',  target:'outputReady', value:true,  conditions:[{signal:'outputWorkPresent',value:true}] },
            { id:'R2', description:'ワーク出発 → 搬出可OFF', target:'outputReady', value:false, conditions:[{signal:'outputWorkPresent',value:false}] },
            { id:'R3', description:'空き → 搬入可ON',        target:'inputReady',  value:true,  conditions:[{signal:'inputWorkPresent',value:false}] },
            { id:'R4', description:'ワーク有り → 搬入可OFF', target:'inputReady',  value:false, conditions:[{signal:'inputWorkPresent',value:true}] },
        ],
    },
};

const _INTERLOCK_SIGNALS_BASE = [
    'inputWorkPresent', 'processingWorkPresent', 'outputWorkPresent',
    'running', 'complete', 'processReady', 'inputReady', 'outputReady',
    'workFull', 'workEmpty',
];

function _getInterlockSignals(type) {
    if (type === 'merge')  return [..._INTERLOCK_SIGNALS_BASE, 'allPortsFull'];
    if (type === 'split')  return [..._INTERLOCK_SIGNALS_BASE, 'allPortsEmpty'];
    return _INTERLOCK_SIGNALS_BASE;
}

const _IL_SIGNAL_LABELS = {
    inputReady:   '搬入可',
    outputReady:  '搬出可',
    processReady: '加工準備',
    workFull:     '満杯',
    workEmpty:    '空き',
};

const _IL_SIGNAL_DESCRIPTIONS = {
    inputWorkPresent:      '搬入バッファにワークがある（上流から受け入れ済み）',
    processingWorkPresent: '加工エリアにワークがある（加工中または完了待ち）',
    outputWorkPresent:     '搬出バッファにワークがある（下流への搬出待ち）',
    running:               '加工処理が実行中（タイマー動作中）',
    complete:              '加工処理が完了（完了フラグがON）',
    processReady:          '加工開始条件が揃っている（ONで加工エンジンが加工を開始）',
    inputReady:            '搬入を受け付けられる（ONで上流ステーションが搬入動作を開始）',
    outputReady:           '搬出を許可できる（ONで下流ステーションへの搬出動作を開始）',
    workFull:              '全バッファが埋まっている（入力・加工・出力すべて満杯）',
    workEmpty:             '全バッファが空（入力・加工・出力すべて空き）',
    allPortsFull:          '全入力ポートにワークが揃った（merge専用: 結合処理の開始条件）',
    allPortsEmpty:         '全出力ポートが空き（split専用: 分岐先の受け入れ可能条件）',
};

const _IL_TARGET_TABS = {
    processing: [
        'inputReady:true',  'inputReady:false',
        'processReady:true', 'processReady:false',
        'outputReady:true',  'outputReady:false',
    ],
    merge: [
        'processReady:true', 'processReady:false',
        'outputReady:true',  'outputReady:false',
    ],
    split: [
        'inputReady:true',  'inputReady:false',
        'processReady:true', 'processReady:false',
    ],
    switch: [
        'inputReady:true',  'inputReady:false',
        'outputReady:true',  'outputReady:false',
    ],
};

function _getModalTabs(type, rules) {
    const predefined = _IL_TARGET_TABS[type] || [];
    const extra = [];
    rules.forEach(r => {
        const key = `${r.target}:${r.value}`;
        if (!predefined.includes(key) && !extra.includes(key)) extra.push(key);
    });
    return [...predefined, ...extra];
}

function _getTabLabel(tabKey) {
    const [sig, val] = tabKey.split(':');
    const base = _IL_SIGNAL_LABELS[sig] || sig;
    const onOff = val === 'true'
        ? '<span class="il-tab-on">ON</span>'
        : '<span class="il-tab-off">OFF</span>';
    return `${base} ${onOff}`;
}

function _getSignalLabel(sig) {
    return _IL_SIGNAL_LABELS[sig] ? `${_IL_SIGNAL_LABELS[sig]} (${sig})` : sig;
}

// ---- Boot ----

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('local-factory-info').textContent = `factory: ${FACTORY_ID.substring(0, 8)}…`;
    document.getElementById('info-sid').value = MACHINE_ID;

    initButtons();
    initViewTab();
    await loadMachineData();

    // Detect station type and configure UI accordingly
    const stationType = machineStation?.stationType || 'machine';
    if (stationType === 'source' || stationType === 'drain') {
        document.getElementById('local-title').textContent = `${stationType === 'source' ? 'Source' : 'Drain'} Editor — ${MACHINE_ID}`;
        _initSourceDrainMode(stationType);
    } else {
        const titleLabel = _IS_SUB ? `Station Editor — ${MACHINE_ID}` : `Machine Editor — ${EQUIP_NAME}`;
        document.getElementById('local-title').textContent = titleLabel;
        initTabs();
        if (document.querySelector('.tab.active')?.dataset.tab === 'view') {
            _lvActivateTab();
        }
    }
});

function _initSourceDrainMode(stationType) {
    // Hide all tabs except info
    document.querySelectorAll('.tab').forEach(t => {
        if (t.dataset.tab !== 'info') t.style.display = 'none';
    });
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('.tab[data-tab="info"]').classList.add('active');
    document.getElementById('tab-info').classList.add('active');

    // Replace info tab content with source/drain config form
    const infoTab = document.getElementById('tab-info');
    const cfg = machineStation?.config || {};

    if (stationType === 'source') {
        infoTab.innerHTML = `
            <div class="field-group">
                <label>Station ID</label>
                <input type="text" value="${MACHINE_ID}" readonly style="opacity:0.6">
            </div>
            <div class="field-group">
                <label>連続生産モード</label>
                <select id="cfg-continuous">
                    <option value="true" ${cfg.continuous ? 'selected' : ''}>有効（timeLimit まで無限生成）</option>
                    <option value="false" ${!cfg.continuous ? 'selected' : ''}>無効（workCount 個で停止）</option>
                </select>
            </div>
            <div class="field-group">
                <label>ワーク生成数 (workCount)</label>
                <input type="number" id="cfg-workCount" value="${cfg.workCount || 10}" min="1" step="1">
                <span style="font-size:10px;color:var(--text-muted);">連続モード OFF の場合に使用</span>
            </div>
            <div class="field-group">
                <label>生成間隔 (arrivalInterval) [秒]</label>
                <input type="number" id="cfg-arrivalInterval" value="${cfg.arrivalInterval || 1}" min="0.1" step="0.1">
            </div>
            <div class="field-group">
                <label>搬出時間 (departureTime) [秒]</label>
                <input type="number" id="cfg-departureTime" value="${cfg.departureTime || 0.5}" min="0" step="0.1">
            </div>
        `;
    } else {
        infoTab.innerHTML = `
            <div class="field-group">
                <label>Station ID</label>
                <input type="text" value="${MACHINE_ID}" readonly style="opacity:0.6">
            </div>
            <div class="field-group">
                <label>搬入時間 (arrivalTime) [秒]</label>
                <input type="number" id="cfg-arrivalTime" value="${cfg.arrivalTime || 0.5}" min="0" step="0.1">
            </div>
            <p style="font-size:11px;color:var(--text-muted);margin-top:16px;">
                Drain はワークを受け取り消滅させるステーションです。<br>
                特別な設定は不要です。
            </p>
        `;
    }
}


function initTabs() {
    if (_IS_SUB) {
        // サブマシン (.001+): 3Dモデルタブを非表示、デフォルトをロジックタブに変更
        const modelTab = document.querySelector('.tab[data-tab="model3d"]');
        if (modelTab) modelTab.style.display = 'none';
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        const logicTab = document.querySelector('.tab[data-tab="logic"]');
        if (logicTab) { logicTab.classList.add('active'); document.getElementById('tab-logic').classList.add('active'); }
    }

    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const prevTab = document.querySelector('.tab.active')?.dataset.tab;
            if (prevTab === 'view' && tab.dataset.tab !== 'view') _lvDeactivateTab();

            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
            if (tab.dataset.tab === 'logic') { _resetLogicViewBox(); renderLogicSVG(); }
            if (tab.dataset.tab === 'model3d') {
                renderGridCanvas();
                init3DPreview();
                if (_3dRenderer) {
                    if (_importedGlb) _loadGlbPreview(_importedGlb.arrayBuffer);
                    else if (_glbPreviewBuffer) _loadGlbPreview(_glbPreviewBuffer);
                }
            }
            if (tab.dataset.tab === 'view') { _lvActivateTab(); }
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
        const stations = Array.isArray(allStations) ? allStations : [];
        machineStation = stations.find(s => s.stationId === MACHINE_ID);

        const layout = machineStation?.config?.equipmentLayout || {};
        const layoutMembers = layout.members || [];

        if (layoutMembers.length > 0) {
            // 保存済みレイアウトから復元（正規のソース）
            childStations = layoutMembers.map(m => ({
                stationId: m.stationId,
                stationType: m.stationType || 'processing',
                name: m.name || m.stationType || m.stationId,
                parentId: MACHINE_ID,
                positionX: m.x ?? null,
                positionY: m.y ?? null,
                config: m.config || {},
            }));
        } else {
            // 未保存: 同設備の DBステーションをフォールバックとして使用（未配置状態）
            childStations = stations
                .filter(s => s.equipmentId === EQUIP_NAME && s.stationId !== MACHINE_ID)
                .map(s => ({ ...s, positionX: null, positionY: null }));
        }

        childConnections = Array.isArray(layout.connections) ? layout.connections : [];

        if (childStations.length === 0) {
            addStation('entry', 'entry');
            addStation('exit', 'exit');
        }

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
    document.getElementById('info-name').value = EQUIP_NAME;
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

    document.getElementById('btn-refresh-3d-preview').addEventListener('click', () => {
        if (!_3dRenderer) { init3DPreview(); return; }
        if (_importedGlb) {
            _loadGlbPreview(_importedGlb.arrayBuffer);
        } else if (_glbPreviewBuffer) {
            _loadGlbPreview(_glbPreviewBuffer);
        } else {
            const savedGlb = machineStation?.config?.model3DGlb?.data;
            if (savedGlb) _loadGlbPreview(_base64ToArrayBuffer(savedGlb));
            else update3DPreview();
        }
    });
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
    _3dRenderer.setSize(w, h, false);
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
        _3dRenderer.setSize(w2, h2, false);
    }).observe(canvas);

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
        const savedGlb = machineStation?.config?.model3DGlb?.data;
        if (savedGlb) _loadGlbPreview(_base64ToArrayBuffer(savedGlb));
        else update3DPreview();
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
        // GLBはメートル単位。スケール変換しない。
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);
        // モデルをバウンディングボックス中心が原点に来るよう移動（底面はy=0）
        model.position.set(-center.x, -box.min.y, -center.z);
        _3dModelGroup.add(model);
        // カメラをモデルのサイズに合わせて調整
        const maxDim = Math.max(size.x, size.y, size.z) || 10;
        _3dCamera.position.set(0, maxDim * 1.2, maxDim * 2);
        _3dCamera.lookAt(0, 0, 0);
        _3dControls.target.set(0, 0, 0);
        _3dControls.update();
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
    _logicModelBounds = null;
    _logicModelRoot = null;

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

        // GLBはグリッドエディタが基準点(origin)を(0,0,0)としてエクスポートしたもの。
        // スケール変換・x/z移動は一切行わない（基準点を破壊しないため）。
        // y方向のみ地面(y=0)に合わせる。
        const bbox = new THREE.Box3().setFromObject(model);
        // 保存済みの原点オフセットを適用して座標系を統一する
        // （MachineEditorを再度開いたときもステーション座標と一致させるため）
        model.position.set(-_modelOriginOffsetX, -bbox.min.y, -_modelOriginOffsetZ);
        scene.add(model);
        _logicModelRoot = model;

        // モデルのXZ範囲をオフセット適用後の座標系で記録
        _logicModelBounds = {
            minX: bbox.min.x - _modelOriginOffsetX, maxX: bbox.max.x - _modelOriginOffsetX,
            minZ: bbox.min.z - _modelOriginOffsetZ, maxZ: bbox.max.z - _modelOriginOffsetZ,
        };

        // カメラは基準点(0,0)を中心に据え置き。SVGのメートル座標系と一致。
        _logicProjectionCX = 0;
        _logicProjectionCZ = 0;

        const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
        cam.position.set(0, 100, 0);
        cam.lookAt(0, 0, 0);
        cam.up.set(0, 0, -1);

        _logicProjectionCamera = cam;
        _logicProjectionScene = scene;

        // GLB読み込み完了後にviewBoxを再計算（モデル範囲を含む）
        _resetLogicViewBox();
        renderLogicSVG();
    }, undefined, err => {
        URL.revokeObjectURL(url);
        console.error('Logic projection load error:', err);
    });
}

function _resetLogicViewBox() {
    // _logicViewBox = コンテンツ範囲のみ（アスペクト比補正なし）
    // アスペクト比は _rerenderLogicProjection が毎回動的に補正する
    const PAD = 2; // metres
    let minX = -4, maxX = 4, minZ = -4, maxZ = 4;

    if (_logicModelBounds) {
        minX = Math.min(minX, _logicModelBounds.minX - PAD);
        maxX = Math.max(maxX, _logicModelBounds.maxX + PAD);
        minZ = Math.min(minZ, _logicModelBounds.minZ - PAD);
        maxZ = Math.max(maxZ, _logicModelBounds.maxZ + PAD);
    }

    childStations.forEach(s => {
        if (s.positionX == null) return;
        const x = s.positionX, z = s.positionY || 0;
        minX = Math.min(minX, x - PAD);
        maxX = Math.max(maxX, x + PAD);
        minZ = Math.min(minZ, z - PAD);
        maxZ = Math.max(maxZ, z + PAD);
    });

    _logicViewBox = { x: minX, y: minZ, w: maxX - minX, h: maxZ - minZ };
    _applyLogicViewBox();
    _rerenderLogicProjection();
}

// _logicViewBox をキャンバスのアスペクト比で拡張した表示用ビューを返す
// （_logicViewBox は変更しない）
function _computeEffectiveView() {
    const canvas = document.getElementById('logic-projection-canvas');
    const area = canvas?.parentElement;
    if (!area || area.clientWidth <= 0 || area.clientHeight <= 0) return _logicViewBox;
    const W = area.clientWidth, H = area.clientHeight;
    const canvasAspect = W / H;
    const { x: vx, y: vy, w: vw, h: vh } = _logicViewBox;
    const cx = vx + vw / 2, cy = vy + vh / 2;
    let ew, eh;
    if (canvasAspect >= vw / vh) { eh = vh; ew = eh * canvasAspect; }
    else                          { ew = vw; eh = ew / canvasAspect; }
    return { x: cx - ew / 2, y: cy - eh / 2, w: ew, h: eh };
}

// SVG描画用のビューボックスを返す
// Three.js投影あり → キャンバスアスペクト補正済みの表示ビュー
// Three.js投影なし → ロジカルビューボックスをそのまま使用
function _getDisplayViewBox() {
    return _logicProjectionRenderer ? _computeEffectiveView() : _logicViewBox;
}

function _applyLogicViewBox() {
    const svg = document.getElementById('logic-svg');
    if (!svg) return;
    // Three.js投影なし(SVGのみ)モードでのみSVG viewBoxを更新
    // Three.js投影ありの場合は _rerenderLogicProjection が更新する
    if (!_logicProjectionRenderer) {
        svg.setAttribute('viewBox', `${_logicViewBox.x} ${_logicViewBox.y} ${_logicViewBox.w} ${_logicViewBox.h}`);
        svg.removeAttribute('preserveAspectRatio');
    }
}

function _rerenderLogicProjection() {
    if (!_logicProjectionRenderer || !_logicProjectionCamera || !_logicProjectionScene) return;
    const canvas = document.getElementById('logic-projection-canvas');
    const area = canvas?.parentElement;
    if (!area || area.clientWidth <= 0 || area.clientHeight <= 0) return;

    const W = area.clientWidth, H = area.clientHeight;
    _logicProjectionRenderer.setSize(W, H, false);

    // キャンバスアスペクト比に合わせた表示ビューを毎回計算
    const ev = _computeEffectiveView();

    // SVG viewBoxを表示ビューに合わせる（preserveAspectRatio="none"でThree.jsと一致）
    const svg = document.getElementById('logic-svg');
    if (svg) {
        svg.setAttribute('viewBox', `${ev.x} ${ev.y} ${ev.w} ${ev.h}`);
        svg.setAttribute('preserveAspectRatio', 'none');
    }

    const cam = _logicProjectionCamera;
    cam.left   = ev.x - _logicProjectionCX;
    cam.right  = (ev.x + ev.w) - _logicProjectionCX;
    cam.top    = _logicProjectionCZ - ev.y;
    cam.bottom = _logicProjectionCZ - (ev.y + ev.h);
    cam.updateProjectionMatrix();
    _logicProjectionRenderer.render(_logicProjectionScene, _logicProjectionCamera);
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
    // 原点状態をリセットして config から復元
    _logicOriginMode = false;
    const savedOrigin = machineStation?.config?.equipmentOrigin;
    _modelOriginOffsetX = savedOrigin?.x ?? 0;
    _modelOriginOffsetZ = savedOrigin?.z ?? 0;
    _logicOriginX = savedOrigin ? 0 : null;
    _logicOriginZ = savedOrigin ? 0 : null;

    initToolPalette();
    initPropsPanel();
    initSVGEvents();
    _initLogicProjection(); // GLTFがある場合は投影を初期化（viewBoxには影響しない）
    _resetLogicViewBox();  // 常にメートル座標系でviewBoxを初期化
    renderLogicSVG();
    renderUnplacedList();
    updateOriginPosDisplay();
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
    renderOriginMarker();
    renderStations();
}

function renderGrid() {
    const svg = document.getElementById('logic-svg');
    const layer = document.getElementById('logic-grid-layer');
    layer.innerHTML = '';

    const vb = _getDisplayViewBox();
    // グリッドステップをviewBox幅から自動計算（~15本になるよう調整）
    const rawStep = vb.w / 15;
    const step = _niceStep(rawStep);
    const x0 = Math.floor(vb.x / step) * step;
    const y0 = Math.floor(vb.y / step) * step;
    const x1 = vb.x + vb.w;
    const y1 = vb.y + vb.h;

    for (let x = x0; x <= x1 + step * 0.01; x += step) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x); line.setAttribute('y1', vb.y);
        line.setAttribute('x2', x); line.setAttribute('y2', y1);
        const isOrigin = Math.abs(x) < step * 0.01;
        line.setAttribute('stroke', isOrigin ? '#2a4880' : '#182240');
        line.setAttribute('stroke-width', isOrigin ? '1' : '0.5');
        line.setAttribute('vector-effect', 'non-scaling-stroke');
        layer.appendChild(line);
    }
    for (let y = y0; y <= y1 + step * 0.01; y += step) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', vb.x); line.setAttribute('y1', y);
        line.setAttribute('x2', x1); line.setAttribute('y2', y);
        const isOrigin = Math.abs(y) < step * 0.01;
        line.setAttribute('stroke', isOrigin ? '#2a4880' : '#182240');
        line.setAttribute('stroke-width', isOrigin ? '1' : '0.5');
        line.setAttribute('vector-effect', 'non-scaling-stroke');
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

        const R = _stationRadius;
        const lw = R * 0.18;
        const hitW = R * 1.2;
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

    const R = _stationRadius;
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

function renderOriginMarker() {
    const layer = document.getElementById('logic-origin-layer');
    if (!layer) return;
    layer.innerHTML = '';
    if (_logicOriginX === null) return;

    const arm = Math.max(_stationRadius * 2, 0.5);
    const sw  = arm * 0.12;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${_logicOriginX}, ${_logicOriginZ})`);
    g.setAttribute('pointer-events', 'none');

    const mk = (x1, y1, x2, y2) => {
        const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        l.setAttribute('x1', x1); l.setAttribute('y1', y1);
        l.setAttribute('x2', x2); l.setAttribute('y2', y2);
        l.setAttribute('stroke', '#ff4444');
        l.setAttribute('stroke-width', sw);
        return l;
    };
    g.appendChild(mk(-arm, 0, arm, 0));
    g.appendChild(mk(0, -arm, 0, arm));

    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('r', sw * 1.2);
    c.setAttribute('fill', '#ff4444');
    g.appendChild(c);

    layer.appendChild(g);
}

function updateOriginPosDisplay() {
    const el = document.getElementById('logic-origin-pos');
    if (!el) return;
    el.textContent = _logicOriginX !== null ? '設定済み (0, 0)' : '未設定';
}

function _setLogicOrigin(x, z) {
    _logicOriginMode = false;
    document.getElementById('btn-logic-origin-mode')?.classList.remove('active');
    document.getElementById('logic-svg').style.cursor = '';

    // クリック位置 (x, z) を (0, 0) にするため全データを (-x, -z) シフトする

    // ステーション座標をシフト
    childStations.forEach(s => {
        if (s.positionX != null) {
            s.positionX = Math.round((s.positionX - x) * 1000) / 1000;
            s.positionY = Math.round(((s.positionY || 0) - z) * 1000) / 1000;
        }
    });

    // Three.js モデルをシフト
    if (_logicModelRoot) {
        _logicModelRoot.position.x -= x;
        _logicModelRoot.position.z -= z;
    }

    // モデルバウンディングボックスをシフト
    if (_logicModelBounds) {
        _logicModelBounds.minX -= x; _logicModelBounds.maxX -= x;
        _logicModelBounds.minZ -= z; _logicModelBounds.maxZ -= z;
    }

    // 累積オフセットを更新（scene3d.js での GLB 配置に使用）
    _modelOriginOffsetX += x;
    _modelOriginOffsetZ += z;
    // マーカーは常に (0, 0) に表示
    _logicOriginX = 0;
    _logicOriginZ = 0;

    // _grid が存在する場合はグリッドの原点セルも更新
    if (_grid.cells.size > 0) {
        const allKeys = [..._grid.cells.keys()];
        const allC = allKeys.map(k => parseInt(k.split(',')[0]));
        const allR = allKeys.map(k => parseInt(k.split(',')[1]));
        const refC = _grid.origin ? _grid.origin[0] : (Math.min(...allC) + Math.max(...allC)) / 2;
        const refR = _grid.origin ? _grid.origin[1] : (Math.min(...allR) + Math.max(...allR)) / 2;
        _grid.origin = [
            Math.round(refC + x / _grid.gridSize),
            Math.round(refR + z / _grid.gridSize),
        ];
        renderGridCanvas();
        update3DPreview();
    }

    _resetLogicViewBox();
    updateOriginPosDisplay();
    renderLogicSVG();
}

// ---- SVG event handling ----

function svgPoint(svg, e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function initSVGEvents() {
    const svg = document.getElementById('logic-svg');

    // Rerender when the logic area is resized (panel drag, window resize, etc.)
    const logicArea = document.getElementById('logic-projection-canvas')?.parentElement;
    if (logicArea) {
        new ResizeObserver(() => {
            _rerenderLogicProjection();
            renderLogicSVG();
        }).observe(logicArea);
    }

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
        // 原点設定モード: 左クリックでクリック位置を原点として確定
        if (_logicOriginMode && e.button === 0) {
            e.stopPropagation();
            const p = svgPoint(svg, e);
            _setLogicOrigin(p.x, p.y);
            return;
        }
        if (e.button === 1) {
            e.preventDefault();
            const dv = _getDisplayViewBox();
            const rect = svg.getBoundingClientRect();
            _svgPanState = {
                cx: e.clientX, cy: e.clientY, vb: { ..._logicViewBox },
                scaleX: dv.w / rect.width, scaleY: dv.h / rect.height,
            };
        }
    });
    svg.addEventListener('mousemove', e => {
        if (!_svgPanState) return;
        const scaleX = _svgPanState.scaleX;
        const scaleY = _svgPanState.scaleY;
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
    if (_logicOriginMode) return; // SVG mousedown が原点設定を担当する
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

    document.getElementById('btn-refresh-logic')?.addEventListener('click', () => {
        _initLogicProjection(); // 保存後の最新GLTFで投影を再構築（内部でviewBox/SVGも更新）
        _resetLogicViewBox();
        renderLogicSVG();
        renderUnplacedList();
    });

    document.getElementById('btn-logic-origin-mode')?.addEventListener('click', () => {
        _logicOriginMode = !_logicOriginMode;
        document.getElementById('btn-logic-origin-mode').classList.toggle('active', _logicOriginMode);
        const svg = document.getElementById('logic-svg');
        if (svg) svg.style.cursor = _logicOriginMode ? 'crosshair' : '';
        updateInfoBar();
    });

    // ステーション半径スライダー／数値入力
    const _radiusSlider = document.getElementById('station-radius-slider');
    const _radiusInput  = document.getElementById('station-radius-input');
    const _applyRadius = (v) => {
        v = Math.max(0.1, Math.min(10, parseFloat(v) || 0.25));
        _stationRadius = v;
        _radiusSlider.value = v;
        _radiusInput.value  = v;
        renderLogicSVG();
    };
    _radiusSlider?.addEventListener('input',  () => _applyRadius(_radiusSlider.value));
    _radiusInput?.addEventListener('change',  () => _applyRadius(_radiusInput.value));
    _radiusInput?.addEventListener('keydown', e => { if (e.key === 'Enter') _applyRadius(_radiusInput.value); });

    // 新規ステーション追加ボタン
    const _doAddStation = () => {
        const type = document.getElementById('add-station-type')?.value || 'processing';
        const nameInput = document.getElementById('add-station-name');
        const name = nameInput?.value.trim() || '';
        addStation(type, name || type);
        if (nameInput) nameInput.value = '';
        renderUnplacedList();
    };
    document.getElementById('btn-add-station')?.addEventListener('click', _doAddStation);
    document.getElementById('add-station-name')?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); _doAddStation(); }
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
    // Listeners are attached dynamically in _attachPropsListeners after each render.
}

// --- Helper: HTML escape ---
function _escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Helper: config fields per type ---
function _getConfigFields(type) {
    const map = {
        source:     [
            { key: 'workCount',      label: 'Work Count',         step: '1',   min: '1' },
            { key: 'departureTime',  label: 'Departure Time (s)', step: '0.1', min: '0.1' },
        ],
        processing: [
            { key: 'processingTime', label: 'Processing Time (s)', step: '0.1', min: '0.1' },
            { key: 'arrivalTime',    label: 'Arrival Time (s)',    step: '0.1', min: '0.1' },
            { key: 'departureTime',  label: 'Departure Time (s)', step: '0.1', min: '0.1' },
        ],
        drain:      [
            { key: 'arrivalTime',    label: 'Arrival Time (s)',   step: '0.1', min: '0.1' },
        ],
        merge:      [
            { key: 'processingTime', label: 'Processing Time (s)', step: '0.1', min: '0' },
            { key: 'arrivalTime',    label: 'Arrival Time (s)',    step: '0.1', min: '0.1' },
            { key: 'departureTime',  label: 'Departure Time (s)', step: '0.1', min: '0.1' },
        ],
        split:      [
            { key: 'processingTime', label: 'Processing Time (s)', step: '0.1', min: '0' },
            { key: 'arrivalTime',    label: 'Arrival Time (s)',    step: '0.1', min: '0.1' },
            { key: 'departureTime',  label: 'Departure Time (s)', step: '0.1', min: '0.1' },
        ],
        entry: [],
        exit:  [],
    };
    return map[type] || [];
}

// --- Helper: merge port rows HTML ---
function _buildMergePortsHtml(s) {
    const count = s.config.mergeCount || 2;
    const ports = s.config.inPorts || [];
    return Array.from({ length: count }, (_, i) => {
        const cap = ports[i]?.capacity || 1;
        return `<div class="props-port-row" data-index="${i}">
            <span class="props-port-label">Port ${i + 1}</span>
            <input type="number" class="props-port-capacity" value="${cap}" min="1" step="1" data-port-index="${i}">
            <span class="props-port-unit">容量</span>
        </div>`;
    }).join('');
}

// --- Helper: split port rows HTML ---
function _buildSplitPortsHtml(s) {
    const count = s.config.splitCount || 2;
    const ports = s.config.outPorts || [];
    return Array.from({ length: count }, (_, i) => {
        const cap = ports[i]?.capacity || 1;
        return `<div class="props-port-row" data-index="${i}">
            <span class="props-port-label">Port ${i + 1}</span>
            <input type="number" class="props-port-capacity" value="${cap}" min="1" step="1" data-port-index="${i}">
            <span class="props-port-unit">容量</span>
        </div>`;
    }).join('');
}

// --- Helper: type-specific config section HTML ---
function _buildTypeConfigHtml(s) {
    const type = s.stationType;
    const cfg = s.config || {};
    const fields = _getConfigFields(type);

    const fieldsHtml = fields.map(f => {
        const disabled = (type === 'source' && f.key === 'workCount' && cfg.continuous) ? 'disabled' : '';
        return `<div class="props-field">
            <label>${_escapeHtml(f.label)}</label>
            <input type="number" id="props-cfg-${f.key}" value="${cfg[f.key] != null ? cfg[f.key] : ''}"
                step="${f.step}" min="${f.min || '0'}" ${disabled}>
        </div>`;
    }).join('');

    let extraHtml = '';

    if (type === 'source') {
        extraHtml = `
        <div class="props-field">
            <label class="props-checkbox-label">
                <input type="checkbox" id="props-cfg-continuous" ${cfg.continuous ? 'checked' : ''}>
                Continuous（Duration中ずっと生成）
            </label>
            <div class="props-hint">ONの場合 Work Count は自動計算</div>
        </div>
        <div class="props-field">
            <label>Work Type</label>
            <input type="text" id="props-cfg-workType" value="${_escapeHtml(cfg.workType || '')}" placeholder="(例: partA)">
            <div class="props-hint">生成ワーク種別（Merge/Split で使用）</div>
        </div>`;
    }

    if (type === 'merge') {
        extraHtml = `
        <div class="props-field props-section-header">入力ポート (Merge Ports)</div>
        <div class="props-field">
            <label>ポート数</label>
            <input type="number" id="props-cfg-mergeCount" value="${cfg.mergeCount || 2}" min="1" step="1">
        </div>
        <div id="props-merge-ports">${_buildMergePortsHtml(s)}</div>
        <div class="props-field">
            <label>出力ワーク Type</label>
            <input type="text" id="props-cfg-outputWorkType" value="${_escapeHtml(cfg.outputWorkType || '')}" placeholder="(例: assembly-AB)">
        </div>`;
    }

    if (type === 'split') {
        extraHtml = `
        <div class="props-field props-section-header">出力ポート (Split Ports)</div>
        <div class="props-field">
            <label>ポート数</label>
            <input type="number" id="props-cfg-splitCount" value="${cfg.splitCount || 2}" min="1" step="1">
        </div>
        <div id="props-split-ports">${_buildSplitPortsHtml(s)}</div>`;
    }

    return fieldsHtml + extraHtml + _buildInterlockEditorHtml(s);
}

// --- Helper: interlock rule editor HTML (summary + modal open button) ---
function _buildInterlockEditorHtml(s) {
    const type = s.stationType;
    if (!INTERLOCK_DEFAULTS[type]) return '';

    const rules = s.config?.interlockRules?.rules ?? INTERLOCK_DEFAULTS[type].rules;
    const isCustom = !!s.config?.interlockRules;

    return `
    <div id="props-interlock-section">
        <div class="props-section-header il-section-header">
            インターロックルール${isCustom ? ' <span class="il-custom-badge">カスタム</span>' : ''}
        </div>
        <div class="il-summary-row">
            <span class="il-summary-text">${rules.length} ルール${isCustom ? '' : '（デフォルト）'}</span>
            <button id="props-interlock-edit" class="il-edit-btn">編集</button>
        </div>
    </div>`;
}

// --- Helper: full props panel HTML ---
function _buildPropsHtml(s) {
    const typeOptions = ['source', 'processing', 'drain', 'merge', 'split', 'entry', 'exit']
        .map(t => `<option value="${t}" ${s.stationType === t ? 'selected' : ''}>${t}</option>`)
        .join('');

    return `
        <div class="props-field">
            <label>ステーションID</label>
            <span style="font-family:monospace;font-size:11px;color:var(--text-muted);word-break:break-all;display:block;padding:2px 0;">${_escapeHtml(s.stationId)}</span>
        </div>
        <div class="props-field">
            <label>名前（表示名）</label>
            <input type="text" id="props-name" value="${_escapeHtml(s.name || '')}">
        </div>
        <div class="props-field">
            <label>タイプ</label>
            <select id="props-type">${typeOptions}</select>
        </div>
        <div class="props-field">
            <label>位置 X (m)</label>
            <input type="number" id="props-pos-x" value="${s.positionX != null ? s.positionX : 0}" step="0.1">
        </div>
        <div class="props-field">
            <label>位置 Y (m)</label>
            <input type="number" id="props-pos-y" value="${s.positionY != null ? s.positionY : 0}" step="0.1">
        </div>
        <div class="props-field">
            <label>Location ID</label>
            <input type="number" id="props-location-id" value="${s.config?.locationId || 0}" min="0" step="1">
        </div>
        <div id="props-type-config">${_buildTypeConfigHtml(s)}</div>
        <button id="props-unplace" style="margin-top:8px;font-size:11px;padding:4px 8px;background:var(--bg-surface);color:var(--text-secondary);border:1px solid var(--border-color);border-radius:3px;cursor:pointer;width:100%;">配置を解除</button>
        <button class="props-delete-btn" id="props-delete">このステーションを削除</button>`;
}

// --- Attach listeners for merge port capacity inputs ---
function _attachMergePortListeners(s) {
    document.querySelectorAll('#props-merge-ports .props-port-capacity').forEach((inp, i) => {
        inp.addEventListener('change', e => {
            s.config.inPorts = s.config.inPorts || [];
            if (!s.config.inPorts[i]) s.config.inPorts[i] = {};
            s.config.inPorts[i].capacity = parseInt(e.target.value) || 1;
        });
    });
}

// --- Attach listeners for split port capacity inputs ---
function _attachSplitPortListeners(s) {
    document.querySelectorAll('#props-split-ports .props-port-capacity').forEach((inp, i) => {
        inp.addEventListener('change', e => {
            s.config.outPorts = s.config.outPorts || [];
            if (!s.config.outPorts[i]) s.config.outPorts[i] = {};
            s.config.outPorts[i].capacity = parseInt(e.target.value) || 1;
        });
    });
}

// --- Attach all event listeners after rendering the props panel ---
function _attachPropsListeners(s) {
    const fields = document.getElementById('props-fields');
    if (!fields) return;

    fields.querySelector('#props-name')?.addEventListener('change', e => {
        s.name = e.target.value;
        renderLogicSVG();
    });

    fields.querySelector('#props-type')?.addEventListener('change', e => {
        s.stationType = e.target.value;
        s.config = {};
        updatePropsPanel();
        renderLogicSVG();
        renderUnplacedList();
    });

    fields.querySelector('#props-pos-x')?.addEventListener('change', e => {
        s.positionX = parseFloat(e.target.value) || 0;
        refreshLogicSVGSize();
        renderLogicSVG();
        updatePalettePos();
    });

    fields.querySelector('#props-pos-y')?.addEventListener('change', e => {
        s.positionY = parseFloat(e.target.value) || 0;
        refreshLogicSVGSize();
        renderLogicSVG();
        updatePalettePos();
    });

    fields.querySelector('#props-location-id')?.addEventListener('change', e => {
        s.config = s.config || {};
        s.config.locationId = parseInt(e.target.value) || 0;
    });

    // Numeric config fields
    _getConfigFields(s.stationType).forEach(f => {
        fields.querySelector(`#props-cfg-${f.key}`)?.addEventListener('change', e => {
            s.config = s.config || {};
            s.config[f.key] = parseFloat(e.target.value) || 0;
        });
    });

    // Source extras
    if (s.stationType === 'source') {
        fields.querySelector('#props-cfg-continuous')?.addEventListener('change', e => {
            s.config = s.config || {};
            s.config.continuous = e.target.checked;
            const wc = fields.querySelector('#props-cfg-workCount');
            if (wc) wc.disabled = e.target.checked;
        });
        fields.querySelector('#props-cfg-workType')?.addEventListener('change', e => {
            s.config = s.config || {};
            s.config.workType = e.target.value.trim();
        });
    }

    // Merge extras
    if (s.stationType === 'merge') {
        fields.querySelector('#props-cfg-mergeCount')?.addEventListener('change', e => {
            s.config = s.config || {};
            s.config.mergeCount = parseInt(e.target.value) || 2;
            const list = fields.querySelector('#props-merge-ports');
            if (list) { list.innerHTML = _buildMergePortsHtml(s); _attachMergePortListeners(s); }
        });
        _attachMergePortListeners(s);
        fields.querySelector('#props-cfg-outputWorkType')?.addEventListener('change', e => {
            s.config = s.config || {};
            s.config.outputWorkType = e.target.value.trim();
        });
    }

    // Split extras
    if (s.stationType === 'split') {
        fields.querySelector('#props-cfg-splitCount')?.addEventListener('change', e => {
            s.config = s.config || {};
            s.config.splitCount = parseInt(e.target.value) || 2;
            const list = fields.querySelector('#props-split-ports');
            if (list) { list.innerHTML = _buildSplitPortsHtml(s); _attachSplitPortListeners(s); }
        });
        _attachSplitPortListeners(s);
    }

    fields.querySelector('#props-unplace')?.addEventListener('click', () => {
        s.positionX = null;
        s.positionY = null;
        _selectedStation = null;
        refreshLogicSVGSize();
        renderLogicSVG();
        renderUnplacedList();
        updatePropsPanel();
        updateInfoBar();
    });

    fields.querySelector('#props-delete')?.addEventListener('click', () => {
        if (_selectedStation) deleteStation(_selectedStation);
    });

    _attachInterlockListeners(s);
}

// --- Attach interlock editor button → opens modal ---
function _attachInterlockListeners(s) {
    const section = document.getElementById('props-interlock-section');
    if (!section) return;
    section.querySelector('#props-interlock-edit')?.addEventListener('click', () => {
        _openInterlockModal(s);
    });
}

// ---- Interlock modal ----

function _openInterlockModal(s) {
    document.getElementById('il-modal-overlay')?.remove();
    const type = s.stationType;
    const currentRules = s.config?.interlockRules?.rules ?? INTERLOCK_DEFAULTS[type].rules;
    const modalRules = JSON.parse(JSON.stringify(currentRules));

    const overlay = document.createElement('div');
    overlay.id = 'il-modal-overlay';
    overlay.className = 'il-modal-overlay';

    const tabs = _getModalTabs(type, modalRules);
    const activeTab = tabs[0] || '';
    overlay.innerHTML = _buildInterlockModalHtml(s, modalRules, activeTab);
    document.body.appendChild(overlay);
    _attachInterlockModalListeners(s, modalRules, overlay);
}

function _buildFlowViewHtml(activeRules) {
    if (!activeRules.length) {
        return '<div class="il-flow-empty">このシグナルにルールはありません</div>';
    }
    return activeRules.map((r, idx) => {
        const orSep = idx > 0 ? '<div class="il-flow-or-sep">or</div>' : '';
        const conds = r.conditions || [];
        const targetClass = r.value ? 'il-chip-on' : 'il-chip-off';
        const targetLabel = `${_escapeHtml(r.target)} = ${r.value ? 'ON' : 'OFF'}`;

        let condHtml;
        if (!conds.length) {
            condHtml = '<span class="il-flow-cond-chip il-cond-empty">(条件なし)</span>';
        } else if (conds.length === 1) {
            condHtml = `<span class="il-flow-cond-chip">${_escapeHtml(conds[0].signal)} = ${conds[0].value ? 'ON' : 'OFF'}</span>`;
        } else {
            const chips = conds.map(c =>
                `<span class="il-flow-cond-chip">${_escapeHtml(c.signal)} = ${c.value ? 'ON' : 'OFF'}</span>`
            ).join('');
            condHtml = `<div class="il-flow-conds-multi">${chips}</div><span class="il-flow-and">AND</span>`;
        }

        return `${orSep}
        <div class="il-flow-row">
            <span class="il-flow-rid">${_escapeHtml(r.id || '')}</span>
            <div class="il-flow-conditions">${condHtml}</div>
            <span class="il-flow-arrow">──→</span>
            <span class="il-flow-target-chip ${targetClass}">${targetLabel}</span>
            <span class="il-flow-desc">${_escapeHtml(r.description || '')}</span>
        </div>`;
    }).join('');
}

function _buildInterlockModalHtml(s, rules, activeTab) {
    const type = s.stationType;
    const tabs = _getModalTabs(type, rules);
    const signals = _getInterlockSignals(type);

    const tabsHtml = tabs.map(tab => `
        <button class="il-modal-tab${tab === activeTab ? ' active' : ''}" data-target="${_escapeHtml(tab)}">
            ${_getTabLabel(tab)}
        </button>`).join('');

    const [activeTabSig, activeTabVal] = activeTab.split(':');
    const activeTabValue = activeTabVal === 'true';
    const activeRules = rules.map((r, i) => ({ ...r, _idx: i }))
        .filter(r => r.target === activeTabSig && r.value === activeTabValue);
    const flowHtml = _buildFlowViewHtml(activeRules);

    function sigOptions(selected) {
        return signals.map(sig => {
            const desc = _IL_SIGNAL_DESCRIPTIONS[sig] ? ` — ${_IL_SIGNAL_DESCRIPTIONS[sig]}` : '';
            return `<option value="${_escapeHtml(sig)}"${sig === selected ? ' selected' : ''}>${_escapeHtml(sig)}${_escapeHtml(desc)}</option>`;
        }).join('');
    }

    const detailHtml = activeRules.map(r => {
        const ri = r._idx;
        const condsHtml = (r.conditions || []).map((cond, ci) => `
            <div class="il-detail-cond-row" data-rule-index="${ri}" data-cond-index="${ci}">
                <select class="il-cond-sig">${sigOptions(cond.signal)}</select>
                <span class="il-lbl">=</span>
                <label class="il-val-label"><input type="checkbox" class="il-cond-val"${cond.value ? ' checked' : ''}> ON</label>
                <button class="il-cond-del">−</button>
            </div>`).join('');
        return `
        <div class="il-detail-rule" data-rule-index="${ri}">
            <div class="il-detail-rule-header">
                <span class="il-rule-id">${_escapeHtml(r.id || `R${ri + 1}`)}</span>
                <input type="text" class="il-rule-desc" value="${_escapeHtml(r.description || '')}" placeholder="説明">
                <button class="il-rule-del">削除</button>
            </div>
            <div class="il-detail-conditions">
                ${condsHtml}
                <button class="il-cond-add" data-rule-index="${ri}">＋ 条件追加</button>
            </div>
        </div>`;
    }).join('');

    const stationLabel = `${_escapeHtml(s.name || s.stationId || '')} (${_escapeHtml(type)})`;
    const isCustom = !!s.config?.interlockRules;

    return `
    <div class="il-modal" id="il-modal">
        <div class="il-modal-header">
            <span class="il-modal-title">インターロックルール — ${stationLabel}${isCustom ? ' <span class="il-custom-badge">カスタム</span>' : ''}</span>
            <button class="il-modal-close" id="il-modal-close">×</button>
        </div>
        <div class="il-tab-bar">${tabsHtml}</div>
        <div class="il-modal-body">
            <div class="il-flow-section">
                <div class="il-section-label">フロービュー</div>
                <div class="il-flow-view" id="il-flow-view">${flowHtml}</div>
            </div>
            <div class="il-detail-section">
                <div class="il-section-label">ルール詳細</div>
                <div class="il-detail-editor" id="il-detail-editor">${detailHtml}</div>
                <button class="il-add-btn" id="il-modal-add-rule">＋ ルール追加 (${_getTabLabel(activeTab)})</button>
            </div>
        </div>
        <div class="il-modal-footer">
            <button class="il-reset-btn" id="il-modal-reset">デフォルトに戻す</button>
            <div style="display:flex;gap:8px;">
                <button class="btn-secondary" id="il-modal-cancel">キャンセル</button>
                <button class="btn-primary" id="il-modal-save">保存</button>
            </div>
        </div>
    </div>`;
}

function _attachInterlockModalListeners(s, modalRules, overlay) {
    const type = s.stationType;
    let activeTab = overlay.querySelector('.il-modal-tab.active')?.dataset.target
        || _getModalTabs(type, modalRules)[0] || '';

    function refresh() {
        const tabs = _getModalTabs(type, modalRules);
        if (!tabs.includes(activeTab)) activeTab = tabs[0] || '';
        const modal = document.getElementById('il-modal');
        if (modal) modal.outerHTML = _buildInterlockModalHtml(s, modalRules, activeTab);
        _attachInterlockModalListeners(s, modalRules, overlay);
    }

    function refreshFlow() {
        const fv = document.getElementById('il-flow-view');
        if (!fv) return;
        const [tabSig, tabVal] = activeTab.split(':');
        const tabValue = tabVal === 'true';
        const active = modalRules.map((r, i) => ({ ...r, _idx: i }))
            .filter(r => r.target === tabSig && r.value === tabValue);
        fv.innerHTML = _buildFlowViewHtml(active);
    }

    const modal = document.getElementById('il-modal');
    if (!modal) return;

    modal.querySelector('#il-modal-close')?.addEventListener('click', () => overlay.remove());
    modal.querySelector('#il-modal-cancel')?.addEventListener('click', () => overlay.remove());

    modal.querySelector('#il-modal-save')?.addEventListener('click', () => {
        s.config = s.config || {};
        const defaultRules = INTERLOCK_DEFAULTS[type]?.rules;
        const matchesDefault = JSON.stringify(modalRules) === JSON.stringify(defaultRules);
        if (matchesDefault) {
            delete s.config.interlockRules;
        } else {
            s.config.interlockRules = {
                signals: JSON.parse(JSON.stringify(INTERLOCK_DEFAULTS[type].signals)),
                rules: modalRules,
            };
        }
        const section = document.getElementById('props-interlock-section');
        if (section) { section.outerHTML = _buildInterlockEditorHtml(s); _attachInterlockListeners(s); }
        overlay.remove();
    });

    modal.querySelector('#il-modal-reset')?.addEventListener('click', () => {
        const defaults = INTERLOCK_DEFAULTS[type]?.rules || [];
        modalRules.splice(0, modalRules.length, ...JSON.parse(JSON.stringify(defaults)));
        refresh();
    });

    modal.querySelectorAll('.il-modal-tab').forEach(tab => {
        tab.addEventListener('click', () => { activeTab = tab.dataset.target; refresh(); });
    });

    modal.querySelector('#il-modal-add-rule')?.addEventListener('click', () => {
        const sigs = _getInterlockSignals(type);
        const [tabSig, tabVal] = activeTab.split(':');
        modalRules.push({
            id: `R${modalRules.length + 1}`,
            description: '',
            target: tabSig,
            value: tabVal === 'true',
            conditions: [{ signal: sigs[0], value: false }],
        });
        refresh();
    });

    modal.querySelectorAll('.il-detail-rule').forEach(ruleEl => {
        const ri = parseInt(ruleEl.dataset.ruleIndex);

        ruleEl.querySelector('.il-rule-del')?.addEventListener('click', () => {
            modalRules.splice(ri, 1);
            modalRules.forEach((r, i) => { r.id = `R${i + 1}`; });
            refresh();
        });

        ruleEl.querySelector('.il-rule-desc')?.addEventListener('change', e => {
            modalRules[ri].description = e.target.value;
            refreshFlow();
        });

    });

    modal.querySelectorAll('.il-cond-add').forEach(btn => {
        const ri = parseInt(btn.dataset.ruleIndex);
        btn.addEventListener('click', () => {
            const sigs = _getInterlockSignals(type);
            modalRules[ri].conditions.push({ signal: sigs[0], value: false });
            refresh();
        });
    });

    modal.querySelectorAll('.il-detail-cond-row').forEach(condEl => {
        const ri = parseInt(condEl.dataset.ruleIndex);
        const ci = parseInt(condEl.dataset.condIndex);

        condEl.querySelector('.il-cond-del')?.addEventListener('click', () => {
            modalRules[ri].conditions.splice(ci, 1);
            refresh();
        });

        condEl.querySelector('.il-cond-sig')?.addEventListener('change', e => {
            modalRules[ri].conditions[ci].signal = e.target.value;
            refreshFlow();
        });

        condEl.querySelector('.il-cond-val')?.addEventListener('change', e => {
            modalRules[ri].conditions[ci].value = e.target.checked;
            refreshFlow();
        });
    });
}

function updatePropsPanel() {
    const empty = document.getElementById('props-empty');
    const fields = document.getElementById('props-fields');

    if (!_selectedStation) {
        empty.style.display = '';
        fields.style.display = 'none';
        fields.innerHTML = '';
        return;
    }
    const s = childStations.find(s => s.stationId === _selectedStation);
    if (!s) {
        empty.style.display = '';
        fields.style.display = 'none';
        fields.innerHTML = '';
        return;
    }
    empty.style.display = 'none';
    fields.style.display = '';
    fields.innerHTML = _buildPropsHtml(s);
    _attachPropsListeners(s);
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

function _nextStationId() {
    const equipName = MACHINE_ID.replace(/\.\d{3}$/, '');
    const usedIds = new Set(childStations.map(s => s.stationId));
    let i = 1;
    while (usedIds.has(`${equipName}.${String(i).padStart(3, '0')}`)) i++;
    return `${equipName}.${String(i).padStart(3, '0')}`;
}

function addStation(type, name, x = null, y = null) {
    const id = _nextStationId();
    childStations.push({
        stationId: id,
        stationType: type,
        name: name || type,
        parentId: MACHINE_ID,
        positionX: x,
        positionY: y,
        config: type === 'processing'
            ? { processingTime: 2, arrivalTime: 0.5, departureTime: 0.5 }
            : {},
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

    // 常にSVGメートル座標を使用（GLTFあり・なし共通）
    const svg = document.getElementById('logic-svg');
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const sp = pt.matrixTransform(svg.getScreenCTM().inverse());
    const lx = Math.round(sp.x * 100) / 100;
    const lz = Math.round(sp.y * 100) / 100;

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
    const unplaced = childStations.filter(s => s.positionX == null && !/[._-]000$/.test(s.stationId));
    if (unplaced.length === 0) {
        const msg = document.createElement('div');
        msg.className = 'unplaced-empty';
        msg.textContent = childStations.length === 0 ? 'ステーションなし' : '全て配置済み';
        list.appendChild(msg);
        return;
    }
    unplaced.forEach(s => {
        const item = document.createElement('div');
        item.className = 'unplaced-item';
        item.draggable = true;
        item.dataset.stationId = s.stationId;
        item.title = `${s.name} [${s.stationId}] (${s.stationType})`;
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

    const stationType = machineStation?.stationType || 'machine';

    // Source/Drain: save config fields and close
    if (stationType === 'source' || stationType === 'drain') {
        try {
            let newConfig = { ...(machineStation?.config || {}) };
            if (stationType === 'source') {
                newConfig.continuous = document.getElementById('cfg-continuous').value === 'true';
                newConfig.workCount = parseInt(document.getElementById('cfg-workCount').value) || 10;
                newConfig.arrivalInterval = parseFloat(document.getElementById('cfg-arrivalInterval').value) || 1;
                newConfig.departureTime = parseFloat(document.getElementById('cfg-departureTime').value) || 0.5;
            } else {
                newConfig.arrivalTime = parseFloat(document.getElementById('cfg-arrivalTime').value) || 0.5;
            }
            await API.updateStation(FACTORY_ID, MACHINE_ID, { config: newConfig });
            btn.textContent = '保存完了';
            setTimeout(() => window.close(), 500);
        } catch (err) {
            alert('保存失敗: ' + err.message);
            btn.disabled = false;
            btn.textContent = '保存する';
        }
        return;
    }

    try {
        // config を段階的に構築して1回のsaveにまとめる
        let newConfig = { ...(machineStation?.config || {}) };

        // Tab 1: name + metadata
        const name = document.getElementById('info-name').value.trim();
        const metaStr = document.getElementById('info-metadata').value.trim();
        if (name) await API.updateStation(FACTORY_ID, MACHINE_ID, { name });
        if (metaStr) {
            try { newConfig.metadata = JSON.parse(metaStr); } catch { /* ignore */ }
        }

        // Tab 2: 3D model
        let _savedGlbBuffer = null;
        if (_deleteModel) {
            delete newConfig.model3DGrid;
            delete newConfig.model3DGlb;
        } else if (_importedGlb) {
            newConfig.model3DGlb = { data: _arrayBufferToBase64(_importedGlb.arrayBuffer), name: _importedGlb.name };
            delete newConfig.model3DGrid;
        } else if (_grid.cells.size > 0) {
            newConfig.model3DGrid = {
                gridSize: _grid.gridSize,
                height: _grid.height,
                cols: _grid.cols,
                rows: _grid.rows,
                cells: [..._grid.cells].map(k => k.split(',').map(Number)),
                origin: _grid.origin,
            };
            const glbBuffer = await _exportModelGroupAsGlb();
            newConfig.model3DGlb = glbBuffer
                ? { data: _arrayBufferToBase64(glbBuffer), name: 'model.glb' }
                : null;
            _savedGlbBuffer = glbBuffer;
        }

        // Tab 3: 原点位置を保存
        if (_logicOriginX !== null) {
            newConfig.equipmentOrigin = { x: _modelOriginOffsetX, z: _modelOriginOffsetZ };
        }

        // Tab 3: ステーション配置を equipmentLayout に保存（parentId は変更しない）
        newConfig.equipmentLayout = {
            members: childStations.map(s => ({
                stationId: s.stationId,
                stationType: s.stationType,
                name: s.name,
                x: s.positionX,
                y: s.positionY,
                config: s.config || {},
            })),
            connections: childConnections,
        };

        await API.updateStation(FACTORY_ID, MACHINE_ID, { config: newConfig });

        // 保存成功後: ローカル状態を更新して 更新ボタン が最新 GLTF を表示できるようにする
        if (machineStation) machineStation.config = newConfig;
        if (_savedGlbBuffer) _glbPreviewBuffer = _savedGlbBuffer;

        btn.disabled = false;
        btn.textContent = '保存する';
    } catch (err) {
        alert('保存失敗: ' + err.message);
        btn.disabled = false;
        btn.textContent = '保存する';
    }
}

// ============================================================
// ---- View Display Tab ----
// ============================================================

const LV_STATION_COLORS_CSS = {
    source: '#28a745', processing: '#007bff', drain: '#6c757d',
    merge: '#6f42c1', split: '#fd7e14', entry: '#2e7d32', exit: '#e65100',
    inspection: '#ffc107', discharge: '#dc3545', switch: '#17a2b8',
};
const LV_STATION_COLORS_HEX = {
    source: 0x28a745, processing: 0x007bff, drain: 0x6c757d,
    merge: 0x6f42c1, split: 0xfd7e14, entry: 0x2e7d32, exit: 0xe65100,
    inspection: 0xffc107, discharge: 0xdc3545, switch: 0x17a2b8,
};

let _lvScene = null;
let _lvActiveWorks = new Map();  // workId → stationId
let _lvHistory = [];             // filtered item_movement events
let _lvLocationMap = new Map();  // locationId → stationId (from opener)
let _lvLastSyncTime = null;
let _lvLastHistoryLen = 0;
let _lvSyncActive = false;
let _lvSyncFrameId = null;
let _lvActiveFilters = new Set(['station', 'work']);

const _themeChannel = new BroadcastChannel('fv_theme');

function _applyDocTheme(theme) {
    const root = document.documentElement;
    root.className = theme === 'auto' ? 'theme-auto' : (theme === 'light' ? 'theme-light' : '');
}

function _applySharedTheme(theme) {
    const el = document.getElementById('lv-theme');
    if (el) el.value = theme;
    _applyDocTheme(theme);
    _lvScene?.applyTheme(theme);
}


function initViewTab() {
    document.getElementById('lv-shell-opacity').addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        document.getElementById('lv-shell-opacity-val').textContent = v.toFixed(2);
        _lvScene?.setShellOpacity(v);
    });
    document.getElementById('lv-station-radius').addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        document.getElementById('lv-station-radius-val').textContent = v.toFixed(2);
        _lvScene?.setStationRadius(v);
    });
    document.getElementById('lv-theme').addEventListener('change', e => {
        const theme = e.target.value;
        _applyDocTheme(theme);
        _lvScene?.applyTheme(theme);
        try { localStorage.setItem('fv_scene_theme', theme); } catch {}
        _themeChannel.postMessage({ type: 'theme', value: theme });
    });
    document.getElementById('lv-show-station-names').addEventListener('change', e => {
        _lvScene?.setShowStationNames(e.target.checked);
    });
    document.getElementById('lv-show-works').addEventListener('change', e => {
        _lvScene?.setShowWorks(e.target.checked);
        if (e.target.checked) _lvLastSyncTime = null; // Force re-apply to rebuild missing work meshes
    });
    document.getElementById('lv-show-interlocks').addEventListener('change', e => {
        _lvScene?.setShowInterlocks(e.target.checked);
    });
    document.getElementById('lv-show-entry').addEventListener('change', e => {
        _lvScene?.setShowEntry(e.target.checked);
    });
    document.getElementById('lv-show-exit').addEventListener('change', e => {
        _lvScene?.setShowExit(e.target.checked);
    });
    document.getElementById('lv-h-station-label').addEventListener('input', e => {
        const v = parseFloat(e.target.value) || 0.8;
        document.getElementById('lv-h-station-label-num').value = v;
        _lvScene?.setStationLabelY(v);
    });
    document.getElementById('lv-h-station-label-num').addEventListener('input', e => {
        const v = parseFloat(e.target.value) || 0.8;
        document.getElementById('lv-h-station-label').value = v;
        _lvScene?.setStationLabelY(v);
    });
    document.getElementById('lv-h-work-station').addEventListener('input', e => {
        const v = parseFloat(e.target.value) || 0.5;
        document.getElementById('lv-h-work-station-num').value = v;
        _lvScene?.setWorkY(v);
    });
    document.getElementById('lv-h-work-station-num').addEventListener('input', e => {
        const v = parseFloat(e.target.value) || 0.5;
        document.getElementById('lv-h-work-station').value = v;
        _lvScene?.setWorkY(v);
    });

    // Init theme from shared storage or opener
    const _initTheme = (() => {
        try {
            const shared = localStorage.getItem('fv_scene_theme');
            if (shared) return shared;
            const g3d = JSON.parse(localStorage.getItem('fv_3d_settings') || 'null');
            if (g3d?.theme) return g3d.theme;
        } catch {}
        return 'dark';
    })();
    _applySharedTheme(_initTheme);

    _themeChannel.onmessage = e => {
        if (e.data?.type === 'theme') _applySharedTheme(e.data.value);
    };

    document.querySelectorAll('.lv-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.classList.toggle('active');
            const f = btn.dataset.lvFilter;
            if (btn.classList.contains('active')) _lvActiveFilters.add(f);
            else _lvActiveFilters.delete(f);
            _lvRenderObjectList();
        });
    });
}

function _lvActivateTab() {
    _lvLastSyncTime = null; // Force re-apply on activation
    if (!_lvScene) {
        // Defer one frame so the container has valid dimensions
        requestAnimationFrame(() => {
            const wrapper = document.getElementById('lv-canvas-wrapper');
            if (!wrapper) return;
            _lvScene = new LocalViewScene(wrapper);
            _lvScene.loadStations(childStations, childConnections, machineStation);
            // Apply current UI settings
            _lvScene.applyTheme(document.getElementById('lv-theme').value);
            _lvScene.setShellOpacity(parseFloat(document.getElementById('lv-shell-opacity').value));
            _lvScene.setShowStationNames(document.getElementById('lv-show-station-names').checked);
            _lvScene.setShowWorks(document.getElementById('lv-show-works').checked);
            _lvScene.setShowEntry(document.getElementById('lv-show-entry').checked);
            _lvScene.setShowExit(document.getElementById('lv-show-exit').checked);
            _lvScene.setStationLabelY(parseFloat(document.getElementById('lv-h-station-label').value) || 0.8);
            _lvScene.setWorkY(parseFloat(document.getElementById('lv-h-work-station').value) || 0.5);
            // Apply current timeline position now that scene is ready
            const currentMs = _lvGetOpenerTimeline()?.getCurrentTime?.();
            if (currentMs !== null && currentMs !== undefined && !isNaN(currentMs)) {
                _lvLastSyncTime = currentMs;
                _lvApplyHistoryAtTime(currentMs, false);
            }
        });
    } else {
        _lvScene.resume();
        _lvScene.loadStations(childStations, childConnections, machineStation);
    }
    _lvRefreshHistory();
    _lvStartSyncLoop();
    _lvRenderObjectList();
}

function _lvDeactivateTab() {
    _lvStopSyncLoop();
    _lvScene?.pause();
}

function _lvGetOpenerState() {
    try {
        return window.opener?._fvState || null;
    } catch (_e) { return null; }
}

function _lvGetOpenerTimeline() {
    try {
        return window.opener?._fvTimeline || null;
    } catch (_e) { return null; }
}

function _lvRefreshHistory() {
    const openerState = _lvGetOpenerState();
    if (!openerState) {
        _lvHistory = [];
        _lvLocationMap = new Map();
        _lvLastHistoryLen = 0;
        return;
    }
    const openerHistory = openerState.historyEvents;
    const openerLocationMap = openerState.locationMap;
    if (!Array.isArray(openerHistory) || !openerLocationMap) {
        _lvHistory = [];
        return;
    }
    _lvLastHistoryLen = openerHistory.length;
    _lvLocationMap = openerLocationMap;

    const myStationIds = new Set(childStations.map(s => s.stationId));
    _lvHistory = openerHistory.filter(ev => {
        const fromSt = openerLocationMap.get(Number(ev.from_location_id));
        const toSt = openerLocationMap.get(Number(ev.to_location_id));
        return myStationIds.has(fromSt) || myStationIds.has(toSt);
    });
}

function _lvApplyHistoryAtTime(ms, animate = true) {
    if (!_lvScene || !_lvHistory.length) return;

    const workLocations = new Map(); // workId → locationId (at station)
    const workTransit  = new Map();  // workId → fromLocationId (departed, not yet arrived)

    for (const ev of _lvHistory) {
        if (new Date(ev.event_time).getTime() > ms) break;
        if (ev.movement_type === 'arrived') {
            workLocations.set(ev.item_id, ev.to_location_id);
            workTransit.delete(ev.item_id);
        } else if (ev.movement_type === 'departed') {
            workLocations.delete(ev.item_id);
            workTransit.set(ev.item_id, ev.from_location_id);
        }
    }

    // Remove works no longer in this machine
    _lvActiveWorks.forEach((_, workId) => {
        if (!workLocations.has(workId) && !workTransit.has(workId)) {
            _lvScene.removeWork(workId);
            _lvActiveWorks.delete(workId);
        }
    });

    // In-transit: show at departure station without animation (only if departure is in this machine)
    workTransit.forEach((fromLocId, workId) => {
        const stationId = _lvLocationMap.get(Number(fromLocId));
        if (!stationId || !_lvScene.hasRenderableStation(stationId)) {
            // Work departed from outside this machine (heading here but not arrived yet) — remove ghost
            _lvScene.removeWork(workId);
            _lvActiveWorks.delete(workId);
            return;
        }
        const prev = _lvActiveWorks.get(workId);
        if (prev !== stationId) {
            _lvActiveWorks.set(workId, stationId);
            _lvScene.setWorkPosition(workId, stationId, false);
        }
    });

    // Arrived: animate to destination
    workLocations.forEach((locId, workId) => {
        const stationId = _lvLocationMap.get(Number(locId));
        if (!stationId || !_lvScene.hasRenderableStation(stationId)) {
            _lvScene.removeWork(workId);
            _lvActiveWorks.delete(workId);
            return;
        }
        const prev = _lvActiveWorks.get(workId);
        if (prev !== stationId) {
            _lvActiveWorks.set(workId, stationId);
            _lvScene.setWorkPosition(workId, stationId, animate);
        }
    });

    _lvRenderObjectList();
}

function _lvStartSyncLoop() {
    _lvStopSyncLoop(); // Cancel any existing loop before starting
    _lvSyncActive = true;
    _lvSyncFrameId = setInterval(() => _lvSyncTick(), 50);
}

function _lvStopSyncLoop() {
    _lvSyncActive = false;
    if (_lvSyncFrameId) { clearInterval(_lvSyncFrameId); _lvSyncFrameId = null; }
}

function _lvSyncTick() {
    if (!_lvSyncActive) { clearInterval(_lvSyncFrameId); _lvSyncFrameId = null; return; }

    const syncBar = document.getElementById('lv-sync-bar');
    const openerState    = _lvGetOpenerState();
    const openerTimeline = _lvGetOpenerTimeline();

    if (openerState) {
        // Detect history change (new execution loaded in global)
        const newLen = openerState.historyEvents?.length || 0;
        if (newLen !== _lvLastHistoryLen) {
            _lvRefreshHistory();
            _lvScene?.clearWorks();
            _lvActiveWorks.clear();
            _lvLastSyncTime = null;
        }

        const currentMs = openerTimeline?.getCurrentTime?.();
        if (currentMs !== null && currentMs !== undefined && !isNaN(currentMs)) {
            if (currentMs !== _lvLastSyncTime) {
                _lvLastSyncTime = currentMs;
                _lvApplyHistoryAtTime(currentMs, true);
            }
            if (syncBar) {
                const isPlaying = openerTimeline?.isPlaying;
                const d = new Date(currentMs);
                const timeStr = d.toLocaleString('ja-JP', {
                    month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                });
                syncBar.textContent = `${isPlaying ? '▶ 再生中' : '⏸ 停止'} | ${timeStr}`;
                syncBar.style.color = isPlaying ? '#4caf50' : 'var(--text-muted)';
            }
        } else {
            if (syncBar) {
                syncBar.textContent = 'データなし（グローバルビューで実行を選択してください）';
                syncBar.style.color = 'var(--text-muted)';
            }
        }
    } else {
        if (syncBar) {
            syncBar.textContent = 'グローバルビューと未接続';
            syncBar.style.color = 'var(--text-muted)';
        }
    }

}

function _lvRenderObjectList() {
    const listEl = document.getElementById('lv-object-list');
    if (!listEl) return;

    const items = [];

    if (_lvActiveFilters.has('station')) {
        childStations.forEach(s => {
            const color = LV_STATION_COLORS_CSS[s.stationType] || '#666';
            const label = (s.name && s.name !== s.stationId) ? `${s.name}` : s.stationId;
            items.push(
                `<div class="lv-obj-item">` +
                `<span class="lv-obj-dot" style="background:${color}"></span>` +
                `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${label}</span>` +
                `</div>`
            );
        });
    }

    if (_lvActiveFilters.has('work')) {
        _lvActiveWorks.forEach((stationId, workId) => {
            items.push(
                `<div class="lv-obj-item">` +
                `<span class="lv-obj-dot-sq" style="background:#4a9eff"></span>` +
                `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${workId}</span>` +
                `</div>`
            );
        });
    }

    listEl.innerHTML = items.length
        ? items.join('')
        : '<div style="font-size:10px;color:var(--text-muted);padding:4px 0;">なし</div>';
}

// ============================================================
// ---- LocalViewScene — self-contained Three.js scene ----
// ============================================================

class LocalViewScene {
    constructor(container) {
        this.container = container;
        this._stations = new Map();      // stationId → { group, station }
        this._works = new Map();         // workId → { mesh, stationId, _anim }
        this._connectionLines = [];
        this._theme = 'dark-navy';
        this._shellOpacity = 0.6;
        this._showStationNames = true;
        this._showWorks = true;
        this._showInterlocks = false;
        this._showEntry = true;
        this._showExit = true;
        this._stationLabelY = 0.8;
        this._workY = 0.5;
        this._stationRadius = 0.25;
        this._animActive = true;
        this._gridHelper = null;
        this._shellGroup = null;
        this._lastMachineStation = null;

        this._initScene();
        this._animate();
    }

    _initScene() {
        const w = this.container.clientWidth  || 800;
        const h = this.container.clientHeight || 500;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(50, w / (h || 1), 0.1, 200);
        this.camera.position.set(0, 15, 20);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        const ambient = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambient);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(10, 20, 10);
        this.scene.add(dirLight);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 1;
        this.controls.maxDistance = 100;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.PAN,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.ROTATE,
        };

        this._applyThemeColors();

        this._resizeObs = new ResizeObserver(() => this._onResize());
        this._resizeObs.observe(this.container);
    }

    // ---- Theme ----

    _themeConfig(name) {
        const THEMES = {
            'dark':      { bg: 0x0d1520, gridMain: 0x2b5278, gridSub: 0x162a3e },
            'dark-navy': { bg: 0x0d1520, gridMain: 0x2b5278, gridSub: 0x162a3e }, // legacy alias
            'light':     { bg: 0xf0f4f8, gridMain: 0x9aacbf, gridSub: 0xc5d0dc },
        };
        let t = name;
        if (t === 'auto') t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        return THEMES[t] || THEMES['dark'];
    }

    _applyThemeColors() {
        const t = this._themeConfig(this._theme);
        this.renderer.setClearColor(t.bg);
        this.scene.fog = new THREE.Fog(t.bg, 40, 120);
        if (this._gridHelper) this.scene.remove(this._gridHelper);
        this._gridHelper = new THREE.GridHelper(200, 200, t.gridMain, t.gridSub);
        this.scene.add(this._gridHelper);
    }

    applyTheme(theme) {
        this._theme = theme;
        this._applyThemeColors();
        const stations = [...this._stations.values()].map(s => s.station);
        if (stations.length) this.loadStations(stations, this._lastConnections || [], this._lastMachineStation);
    }

    // ---- Stations ----

    loadStations(stations, connections, machineStation = null) {
        this._lastConnections = connections || [];
        this._lastMachineStation = machineStation;
        this._stations.forEach(({ group }) => this.scene.remove(group));
        this._stations.clear();
        this._connectionLines.forEach(l => this.scene.remove(l));
        this._connectionLines = [];
        if (this._shellGroup) { this.scene.remove(this._shellGroup); this._shellGroup = null; }

        const placed = stations.filter(s => s.positionX !== null && s.positionY !== null);

        if (machineStation) this._renderMachineShell(machineStation, placed);

        for (const st of placed) this._addStation(st);
        for (const conn of this._lastConnections) this._addConnectionLine(conn, placed);

        this._fitCamera(placed);
    }

    _renderMachineShell(machine, placedStations) {
        const cfg = machine.config || {};
        const hasGlb = !!cfg.model3DGlb?.data;
        const hasGrid = Array.isArray(cfg.model3DGrid?.cells) && cfg.model3DGrid.cells.length > 0;

        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        placedStations.forEach(s => {
            const px = s.positionX || 0, pz = s.positionY || 0;
            minX = Math.min(minX, px); maxX = Math.max(maxX, px);
            minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
        });
        if (!isFinite(minX)) { minX = -2; maxX = 2; minZ = -2; maxZ = 2; }

        const PAD = 2;
        const cx = (minX + maxX) / 2;
        const cz = (minZ + maxZ) / 2;
        const W = Math.max(maxX - minX + PAD * 2, 4);
        const D = Math.max(maxZ - minZ + PAD * 2, 4);
        const H = 3;

        const shellGroup = new THREE.Group();

        if (hasGlb) {
            const equipOrigin = cfg.equipmentOrigin;
            const eox = equipOrigin?.x ?? 0;
            const eoz = equipOrigin?.z ?? 0;
            const modelGroup = new THREE.Group();
            modelGroup.position.set(-eox, 0, -eoz);
            shellGroup.add(modelGroup);
            this._loadGlb(cfg.model3DGlb.data, modelGroup);
        } else if (hasGrid) {
            const voxelMesh = this._buildVoxelMesh(cfg.model3DGrid, this._shellOpacity);
            voxelMesh.position.set(0, 0, 0);
            shellGroup.add(voxelMesh);
        } else {
            const shellGeo = new THREE.BoxGeometry(W, H, D);
            const shellMat = new THREE.MeshStandardMaterial({
                color: 0x4a9eff, transparent: true, opacity: this._shellOpacity * 0.2,
                roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide,
            });
            const shellMesh = new THREE.Mesh(shellGeo, shellMat);
            shellMesh.position.set(cx, H / 2, cz);
            shellGroup.add(shellMesh);

            const edgeGeo = new THREE.EdgesGeometry(shellGeo);
            const edgeMat = new THREE.LineBasicMaterial({ color: 0x6ab4ff, transparent: true, opacity: 0.45 });
            const edgeMesh = new THREE.LineSegments(edgeGeo, edgeMat);
            edgeMesh.position.copy(shellMesh.position);
            shellGroup.add(edgeMesh);
        }

        this.scene.add(shellGroup);
        this._shellGroup = shellGroup;
    }

    _loadGlb(base64data, targetGroup) {
        const binary = atob(base64data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'model/gltf-binary' });
        const url = URL.createObjectURL(blob);
        const loader = new GLTFLoader();
        loader.load(url, gltf => {
            URL.revokeObjectURL(url);
            const model = gltf.scene;
            const box = new THREE.Box3().setFromObject(model);
            model.position.y = -box.min.y;
            targetGroup.add(model);
        }, undefined, err => {
            URL.revokeObjectURL(url);
            console.error('GLB load error (local-view):', err);
        });
    }

    _buildVoxelMesh(grid3d, opacity) {
        const gridSize = grid3d.gridSize || 0.5;
        const cellHeight = grid3d.height || 1.5;
        const cells = grid3d.cells || [];
        if (cells.length === 0) return new THREE.Group();

        const origin = grid3d.origin;
        const allC = cells.map(([c]) => c);
        const allR = cells.map(([, r]) => r);
        const refC = origin ? origin[0] : (Math.min(...allC) + Math.max(...allC)) / 2;
        const refR = origin ? origin[1] : (Math.min(...allR) + Math.max(...allR)) / 2;

        const group = new THREE.Group();
        const geo = new THREE.BoxGeometry(gridSize * 0.95, cellHeight, gridSize * 0.95);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x4a9eff, transparent: true, opacity, roughness: 0.4, metalness: 0.3,
        });
        cells.forEach(([cx, cz]) => {
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set((cx - refC) * gridSize, cellHeight / 2, (cz - refR) * gridSize);
            group.add(mesh);
        });
        return group;
    }

    _addStation(station) {
        const px = station.positionX || 0;
        const pz = station.positionY || 0;
        const color = LV_STATION_COLORS_HEX[station.stationType] || 0x666666;
        const R = this._stationRadius;
        const H = 0.2;

        const group = new THREE.Group();
        group.userData.stationId = station.stationId;
        group.userData.stationType = station.stationType;

        const geo  = new THREE.CylinderGeometry(R, R, H, 16);
        const mat  = new THREE.MeshStandardMaterial({
            color, emissive: color, emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.35,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = H / 2;
        mesh.castShadow = true;
        group.add(mesh);

        const edgeColor = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55).getHex();
        const edgeGeo = new THREE.EdgesGeometry(geo, 30);
        const edgeMat = new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.9 });
        const edges   = new THREE.LineSegments(edgeGeo, edgeMat);
        edges.position.copy(mesh.position);
        group.add(edges);

        if (this._showStationNames) {
            const label = this._createLabel(station.name || station.stationId, 0, this._stationLabelY, 0);
            group.add(label);
            group.userData.labelMesh = label;
        }

        group.position.set(px, 0, pz);
        if (station.stationType === 'entry') group.visible = this._showEntry;
        if (station.stationType === 'exit')  group.visible = this._showExit;
        this.scene.add(group);
        this._stations.set(station.stationId, { group, station });
    }

    _addConnectionLine(conn, stations) {
        const fromSt = stations.find(s => s.stationId === conn.fromStation);
        const toSt   = stations.find(s => s.stationId === conn.toStation);
        if (!fromSt || !toSt) return;
        const pts = [
            new THREE.Vector3(fromSt.positionX || 0, 0.15, fromSt.positionY || 0),
            new THREE.Vector3(toSt.positionX   || 0, 0.15, toSt.positionY   || 0),
        ];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color: 0x3a6eb0, transparent: true, opacity: 0.8 });
        const line = new THREE.Line(geo, mat);
        this.scene.add(line);
        this._connectionLines.push(line);
    }

    _createLabel(text, x, y, z) {
        const canvas = document.createElement('canvas');
        canvas.width  = 256;
        canvas.height = 48;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 256, 48);
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const display = text.length > 18 ? text.substring(0, 16) + '…' : text;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.lineWidth = 4;
        ctx.strokeText(display, 128, 24);
        ctx.fillStyle = '#e8edf5';
        ctx.fillText(display, 128, 24);

        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(4, 0.75, 1);
        sprite.position.set(x, y, z);
        return sprite;
    }

    // ---- Works ----

    hasRenderableStation(stationId) {
        return this._stations.has(stationId);
    }

    _workColor(workId) {
        const PRESET = {
            'finished-part': 0x4caf50, 'raw-part': 0x11ccaa,
            typeA: 0xff3355, typeB: 0x3355ff, typeC: 0xcc33ff,
        };
        if (PRESET[workId]) return PRESET[workId];
        let h = 0;
        for (let i = 0; i < workId.length; i++) h = (h * 127 + workId.charCodeAt(i)) >>> 0;
        return new THREE.Color().setHSL((h % 360) / 360, 0.75, 0.62).getHex();
    }

    setWorkPosition(workId, stationId, animate = true) {
        if (!this._showWorks) return;

        const stEntry = this._stations.get(stationId);
        if (!stEntry) return;

        const px = stEntry.station.positionX || 0;
        const pz = stEntry.station.positionY || 0;
        const py = this._workY;

        let entry = this._works.get(workId);
        if (!entry) {
            const SZ    = 0.3;
            const color = this._workColor(workId);
            const geo   = new THREE.BoxGeometry(SZ, SZ, SZ);
            const mat   = new THREE.MeshStandardMaterial({
                color, emissive: color, emissiveIntensity: 0.5, roughness: 0.2, metalness: 0.6,
            });
            const fill  = new THREE.Mesh(geo, mat);
            const eGeo  = new THREE.EdgesGeometry(geo);
            const eMat  = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
            const edges = new THREE.LineSegments(eGeo, eMat);

            const group = new THREE.Group();
            group.add(fill);
            group.add(edges);
            group.userData.workId = workId;
            group.position.set(px, py, pz);
            this.scene.add(group);

            entry = { mesh: group, stationId, _anim: null };
            this._works.set(workId, entry);
            return;
        }

        if (entry.stationId === stationId && !entry._anim) return;
        entry.stationId = stationId;

        if (!animate) {
            entry._anim = null;
            entry.mesh.position.set(px, py, pz);
            return;
        }

        const from  = entry.mesh.position.clone();
        const to    = new THREE.Vector3(px, py, pz);
        const hDist = Math.sqrt((to.x - from.x) ** 2 + (to.z - from.z) ** 2);
        if (hDist < 0.01) {
            entry._anim = null;
            entry.mesh.position.set(px, py, pz);
            return;
        }
        entry._anim = {
            from, to,
            arcH: Math.max(0.3, Math.min(2, hDist * 0.35)),
            startTime: Date.now(),
            duration: 350,
        };
    }

    removeWork(workId) {
        const entry = this._works.get(workId);
        if (!entry) return;
        this.scene.remove(entry.mesh);
        entry.mesh.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (obj.material.map) obj.material.map.dispose();
                obj.material.dispose();
            }
        });
        this._works.delete(workId);
    }

    clearWorks() {
        this._works.forEach((_, workId) => this.removeWork(workId));
        this._works.clear();
    }

    // ---- Settings ----

    setShellOpacity(v) {
        this._shellOpacity = v;
        if (this._shellGroup) {
            this._shellGroup.traverse(obj => {
                if (obj.isMesh && obj.material) {
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach(m => { m.opacity = v; m.transparent = true; m.needsUpdate = true; });
                    } else {
                        obj.material.opacity = v;
                        obj.material.transparent = true;
                        obj.material.needsUpdate = true;
                    }
                }
            });
        }
    }

    setStationRadius(r) {
        const prevR = this._stationRadius;
        this._stationRadius = r;
        if (prevR <= 0) return;
        const scale = r / prevR;
        this._stations.forEach(({ group }) => {
            group.children.forEach(child => {
                if (child.isMesh || child.isLineSegments) {
                    child.scale.x *= scale;
                    child.scale.z *= scale;
                }
            });
        });
    }

    setShowStationNames(v) {
        this._showStationNames = v;
        this._stations.forEach(({ group }) => {
            const label = group.userData.labelMesh;
            if (label) label.visible = v;
        });
    }

    setShowWorks(v) {
        this._showWorks = v;
        this._works.forEach(({ mesh }) => { mesh.visible = v; });
    }

    setShowInterlocks(v) {
        this._showInterlocks = v;
        // Future: show interlock signal indicators on stations
    }

    setShowEntry(v) {
        this._showEntry = v;
        this._stations.forEach(({ group }) => {
            if (group.userData.stationType === 'entry') group.visible = v;
        });
    }

    setShowExit(v) {
        this._showExit = v;
        this._stations.forEach(({ group }) => {
            if (group.userData.stationType === 'exit') group.visible = v;
        });
    }

    setStationLabelY(v) {
        this._stationLabelY = v;
        this._stations.forEach(({ group }) => {
            const label = group.userData.labelMesh;
            if (label) label.position.y = v;
        });
    }

    setWorkY(v) {
        this._workY = v;
        this._works.forEach(entry => {
            if (!entry._anim) entry.mesh.position.y = v;
        });
    }

    // ---- Camera ----

    _fitCamera(stations) {
        if (!stations || stations.length === 0) {
            this.camera.position.set(0, 15, 20);
            this.controls.target.set(0, 0, 0);
            this.controls.update();
            return;
        }

        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        stations.forEach(s => {
            const x = s.positionX || 0, z = s.positionY || 0;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        });

        const cx   = (minX + maxX) / 2;
        const cz   = (minZ + maxZ) / 2;
        const range = Math.max(maxX - minX, maxZ - minZ, 4);
        const dist  = range * 0.8 + 6;

        this.camera.position.set(cx, dist * 0.65, cz + dist);
        this.camera.lookAt(cx, 0, cz);
        this.controls.target.set(cx, 0, cz);
        this.controls.maxDistance = dist * 5;
        this.controls.update();
    }

    fitView() {
        const placed = [...this._stations.values()].map(s => s.station);
        this._fitCamera(placed);
    }

    // ---- Resize ----

    _onResize() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (w === 0 || h === 0) return;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    // ---- Animation loop ----

    _animate() {
        if (!this._animActive) return;
        this._animFrameId = requestAnimationFrame(() => this._animate());
        this.controls.update();

        // Arc animation update
        const now = Date.now();
        this._works.forEach(entry => {
            if (!entry._anim) return;
            const { from, to, arcH, startTime, duration } = entry._anim;
            const t = Math.min(1, (now - startTime) / duration);
            const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            const x = from.x + (to.x - from.x) * ease;
            const z = from.z + (to.z - from.z) * ease;
            const y = from.y + (to.y - from.y) * ease + arcH * Math.sin(Math.PI * t);
            entry.mesh.position.set(x, y, z);
            if (t >= 1) entry._anim = null;
        });

        // Camera-following grid
        if (this._gridHelper) {
            this._gridHelper.position.x = Math.round(this.camera.position.x / 5) * 5;
            this._gridHelper.position.z = Math.round(this.camera.position.z / 5) * 5;
        }

        this.renderer.render(this.scene, this.camera);
    }

    // ---- Pause / Resume ----

    pause() {
        this._animActive = false;
    }

    resume() {
        if (this._animActive) return;
        this._animActive = true;
        this._animate();
    }

    // ---- Dispose ----

    dispose() {
        this._animActive = false;
        if (this._animFrameId) cancelAnimationFrame(this._animFrameId);
        this._resizeObs?.disconnect();
        this.clearWorks();
        this._stations.forEach(({ group }) => {
            group.traverse(obj => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (obj.material.map) obj.material.map.dispose();
                    obj.material.dispose();
                }
            });
        });
        this._connectionLines.forEach(l => {
            l.geometry?.dispose();
            l.material?.dispose();
        });
        this.renderer.dispose();
        this.renderer.domElement.parentElement?.removeChild(this.renderer.domElement);
    }
}
