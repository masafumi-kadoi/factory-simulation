// Local window — Machine editor
import * as API from './api.js';

const params = new URLSearchParams(location.search);
const FACTORY_ID = params.get('factoryId') || '';
const MACHINE_ID = params.get('machineId') || '';
const MACHINE_NAME = params.get('machineName') || MACHINE_ID;

let machineStation = null;
let childStations = [];
let childConnections = [];

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

function populateInfoTab() {
    if (!machineStation) return;
    document.getElementById('info-name').value = machineStation.name || '';
    const meta = machineStation.config?.metadata;
    document.getElementById('info-metadata').value = meta ? JSON.stringify(meta, null, 2) : '';
}

function populateModelTab() {
    if (!machineStation) return;
    const cfg = machineStation.config || {};
    if (cfg.model3DGrid) {
        document.getElementById('model-current-type').textContent = 'ボクセルグリッド';
        const g = cfg.model3DGrid;
        if (g.gridSize) document.getElementById('model-gridsize').value = g.gridSize;
        if (g.height) document.getElementById('model-height').value = g.height;
        if (g.cells) document.getElementById('model-cells').value = JSON.stringify(g.cells);
    } else if (cfg.model3DGlb) {
        document.getElementById('model-current-type').textContent = 'GLB モデル';
    } else {
        document.getElementById('model-current-type').textContent = 'なし（円柱フォールバック）';
    }
    if (cfg.rotationY != null) document.getElementById('model-rotation').value = cfg.rotationY;
}

function populateLogicTab() {
    document.getElementById('logic-placeholder').textContent =
        `${childStations.length}ステーション、${childConnections.length}接続`;

    drawLogicCanvas();
    renderStationList();
}

function drawLogicCanvas() {
    const canvas = document.getElementById('logic-canvas');
    const wrapper = document.getElementById('logic-canvas-wrapper');
    canvas.width = wrapper.clientWidth;
    canvas.height = wrapper.clientHeight || 400;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#1e3355';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (childStations.length === 0) {
        ctx.fillStyle = '#8fa3c8';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('内部ステーションがありません', canvas.width / 2, canvas.height / 2);
        return;
    }

    // Layout stations in a grid
    const COLORS = {
        source: '#28a745', processing: '#007bff', drain: '#6c757d',
        merge: '#6f42c1', split: '#fd7e14', entry: '#2e7d32', exit: '#e65100',
    };
    const R = 24;
    const positions = new Map();
    const cols = Math.ceil(Math.sqrt(childStations.length));
    const cellW = Math.min(120, (canvas.width - 40) / cols);
    const cellH = 80;
    childStations.forEach((s, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = 30 + col * cellW + cellW / 2;
        const y = 40 + row * cellH + cellH / 2;
        positions.set(s.stationId, { x, y });

        ctx.beginPath();
        ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.fillStyle = COLORS[s.stationType] || '#666';
        ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = (s.name || s.stationId).substring(0, 8);
        ctx.fillText(label, x, y);
    });

    // Draw connections
    childConnections.forEach(c => {
        const from = positions.get(c.fromStation);
        const to = positions.get(c.toStation);
        if (!from || !to) return;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = '#4a9eff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Arrow
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const ex = to.x - R * Math.cos(angle);
        const ey = to.y - R * Math.sin(angle);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - 8 * Math.cos(angle - 0.3), ey - 8 * Math.sin(angle - 0.3));
        ctx.lineTo(ex - 8 * Math.cos(angle + 0.3), ey - 8 * Math.sin(angle + 0.3));
        ctx.closePath();
        ctx.fillStyle = '#4a9eff';
        ctx.fill();
    });
}

function renderStationList() {
    const container = document.getElementById('station-list');
    if (childStations.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:11px;padding:4px;">内部ステーションなし</div>';
        return;
    }
    container.innerHTML = '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px;">内部ステーション一覧</div>' +
        childStations.map(s => `
            <div class="station-list-item">
                <span style="color:var(--text-secondary)">${esc(s.stationType)}</span>
                <span>${esc(s.name || s.stationId)}</span>
                <span style="color:var(--text-muted);font-size:10px;">${esc(s.stationId)}</span>
            </div>
        `).join('');
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

        // Tab 2: Save 3D model config
        const gridSize = parseInt(document.getElementById('model-gridsize').value);
        const height = parseInt(document.getElementById('model-height').value);
        const cellsStr = document.getElementById('model-cells').value.trim();
        const rotationY = parseFloat(document.getElementById('model-rotation').value) || 0;
        if (cellsStr) {
            try {
                const cells = JSON.parse(cellsStr);
                const model3DGrid = { gridSize, height, cells };
                await API.updateStation(FACTORY_ID, MACHINE_ID, {
                    config: { ...(machineStation?.config || {}), model3DGrid, rotationY },
                });
            } catch { /* ignore */ }
        }

        // Tab 3: Save logic (batch)
        await API.saveMachineLogic(FACTORY_ID, MACHINE_ID, childStations, childConnections);

        window.close();
    } catch (err) {
        alert('保存失敗: ' + err.message);
        btn.disabled = false;
        btn.textContent = '保存して閉じる';
    }
}

function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
