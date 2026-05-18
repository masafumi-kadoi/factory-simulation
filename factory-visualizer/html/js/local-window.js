// Local window — Machine editor
import * as API from './api.js';

const params = new URLSearchParams(location.search);
const FACTORY_ID = params.get('factoryId') || '';
const MACHINE_ID = params.get('machineId') || '';
const MACHINE_NAME = params.get('machineName') || MACHINE_ID;

let machineStation = null;
let childStations = [];
let childConnections = [];

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

        // Tab 3: Save logic (stations with positionX/Y + connections)
        await API.saveMachineLogic(FACTORY_ID, MACHINE_ID, childStations, childConnections);

        window.close();
    } catch (err) {
        alert('保存失敗: ' + err.message);
        btn.disabled = false;
        btn.textContent = '保存して閉じる';
    }
}
