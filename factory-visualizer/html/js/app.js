// Factory Visualizer — Main Application
import { Scene3D } from './scene3d.js';
import { Timeline } from './timeline.js';
import { initAIPanel, FloatingInfoPanel } from './panels.js';
import { initLeftPanel, applyDocTheme, renderObjectList, setObjectListClickHandler, setStatus, setICStatus, setTimeDisplay, renderExecutionList, setExecutionListClickHandler } from './ui.js';
import * as API from './api.js';

// ---- State ----

const state = {
    factories: [],
    currentFactory: null,
    currentFactoryData: null,
    stations: [],
    connections: [],
    locationMap: new Map(),     // locationId → stationId
    stationByLocation: new Map(), // stationId → locationId
    execution: null,
    initialConditions: {},
    activeWorks: new Map(),     // workId → stationId
    activeFilters: ['machine', 'station', 'work'],
    liveDataSourceId: null,
    ws: null,
    wsRetryTimer: null,
    wsRetryDelay: 1000,
};

let scene3d = null;
let timeline = null;
let infoPanel = null;
const _movedEquipment = new Map(); // equipName → { centroid, machines[] }

// ---- Boot ----

document.addEventListener('DOMContentLoaded', async () => {
    initScene();
    initTimeline();
    initUI();
    initAIPanel();
    initGlobalTabs();
    initFactoryInfoTab();
    initGlobal3DEditTab();
    initGlobalLogicEditTab();

    try {
        await loadFactories();
    } catch (err) {
        setStatus('工場リスト取得失敗: ' + err.message, 'status-error');
    }

    restoreSimStart();
});

function initScene() {
    const wrapper = document.getElementById('scene-canvas-wrapper');
    scene3d = new Scene3D(wrapper);

    scene3d.setOnMachineClick(sid => {
        const st = state.stations.find(s => s.stationId === sid);
        if (!st) return;
        openInfoPanel(st, 'machine');
    });
    scene3d.setOnMachineDoubleClick(sid => {
        openLocalWindow(sid);
    });
    scene3d.setOnEquipmentDoubleClick(equipName => {
        const members = state.stations.filter(s => {
            if (s.stationType !== 'machine') return false;
            const m = s.stationId.match(/^(.+?)[._-]?(\d{3})$/);
            return m ? m[1] === equipName : s.stationId === equipName;
        });
        if (members.length === 0) return;
        // 設備マスター (.000) を優先して開く。なければ最初のステーション
        const master = members.find(m => {
            const match = m.stationId.match(/^(.+?)[._-]?(\d{3})$/);
            return match && match[2] === '000';
        }) || members.slice().sort((a, b) => a.stationId.localeCompare(b.stationId))[0];
        openLocalWindow(master.stationId);
    });
    scene3d.setOnWorkClick(workId => {
        openInfoPanel({ stationId: workId, name: workId, stationType: 'work' }, 'work');
    });
    scene3d.setOnEquipmentMove((equipName, data) => {
        _movedEquipment.set(equipName, data);
        const posEl = document.getElementById(`gf-pos-${equipName}`);
        if (posEl) posEl.textContent = `X: ${data.centroid.x.toFixed(1)}m, Y: ${data.centroid.z.toFixed(1)}m`;
        const saveBtn = document.getElementById('gf-save-placement');
        if (saveBtn) { saveBtn.textContent = '保存して確定 *'; saveBtn.disabled = false; }
    });
}

function initTimeline() {
    const canvas = document.getElementById('timeline-canvas');
    timeline = new Timeline({
        canvas,
        onSeek: ms => {
            setTimeDisplay(ms);
        },
        onPlayStateChange: playing => {
            document.getElementById('tl-play').textContent = playing ? '⏸' : '▶';
        },
    });

    document.getElementById('tl-play').addEventListener('click', () => timeline.togglePlay());
    document.getElementById('tl-rewind').addEventListener('click', () => timeline.seekToStart());
    document.getElementById('tl-ffwd').addEventListener('click', () => timeline.seekToEnd());
    document.getElementById('tl-speed').addEventListener('change', e => {
        timeline.setSpeed(parseFloat(e.target.value));
    });
}

function initUI() {
    initLeftPanel({
        onFilterChange: filters => {
            state.activeFilters = filters;
            renderObjectList(state.stations, state.activeWorks, state.activeFilters);
        },
        onSettingChange: (key, value) => {
            if (!scene3d) return;
            switch (key) {
                case 'theme':
                    applyDocTheme(value);
                    scene3d.applyTheme(value);
                    break;
                case 'shellOpacity': scene3d.setShellOpacity(value); break;
                case 'internalRadius': scene3d.setInternalRadius(value); break;
                case 'showInternal': scene3d.setShowInternal(value); break;
                case 'showStationNames': scene3d.setShowStationNames(value); break;
                case 'showWorks': scene3d.setShowWorks(value); break;
                case 'showInterlocks': scene3d.setShowInterlocks(value); break;
            }
        },
    });

    setObjectListClickHandler((type, id) => {
        let st = state.stations.find(s => s.stationId === id);
        if (!st && type === 'machine') {
            // id is an equipment name — find the first matching machine
            st = state.stations
                .filter(s => s.stationType === 'machine')
                .find(s => {
                    const m = s.stationId.match(/^(.+?)[._-]?(\d{3})$/);
                    return m ? m[1] === id : s.stationId === id;
                });
        }
        if (st) openInfoPanel(st, type);
    });

    setExecutionListClickHandler(async (execId, dsId) => {
        if (!dsId) return;
        state.liveDataSourceId = dsId;
        subscribeWebSocket(dsId);
        setStatus('実行履歴を再生中', 'status-running');
        document.getElementById('btn-stop-sim').disabled = false;
        const vizBtn = document.getElementById('btn-open-visualizer');
        if (vizBtn) vizBtn.disabled = false;

        // タイムラインを選択した実行の情報で更新
        try {
            const exec = await API.fetchExecution(execId);
            timeline.setExecution({
                ...exec,
                startDatetime: exec.startTime,
                simulationTime: exec.simulationTime || 86400,
            });
        } catch (e) {
            console.warn('[execHistory] failed to fetch execution for timeline', e);
        }
    });

    // Factory selector
    document.getElementById('factory-select').addEventListener('change', async e => {
        const fid = e.target.value;
        if (!fid) return;
        await selectFactory(fid);
    });

    // Toolbar buttons
    document.getElementById('btn-run').addEventListener('click', () => openRunDialog());
    document.getElementById('btn-stop-sim').addEventListener('click', () => stopLive());
    document.getElementById('btn-fit').addEventListener('click', () => scene3d && scene3d.fitView());
    const btnTop = document.getElementById('btn-top');
    let _topViewActive = false;
    btnTop.addEventListener('click', () => {
        if (!scene3d) return;
        if (_topViewActive) {
            scene3d.setPerspView();
            btnTop.classList.remove('active');
        } else {
            scene3d.setTopView();
            btnTop.classList.add('active');
        }
        _topViewActive = !_topViewActive;
    });
    document.getElementById('btn-open-visualizer').addEventListener('click', () => {
        const dsId = state.liveDataSourceId;
        if (dsId) {
            window.open(`/visualizer/?ds=${encodeURIComponent(dsId)}`, '_blank');
        }
    });

    // Simulation panel
    document.getElementById('btn-fetch-ic').addEventListener('click', () => fetchInitialConditions());

    // Run modal
    document.getElementById('run-modal-close').addEventListener('click', () => {
        document.getElementById('run-modal').classList.add('hidden');
    });
}

// ---- Factory loading ----

async function loadFactories() {
    const data = await API.fetchFactories();
    state.factories = Array.isArray(data) ? data : (data.factories || []);

    const sel = document.getElementById('factory-select');
    sel.innerHTML = '<option value="">工場を選択...</option>' +
        state.factories.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');

    setStatus(`工場 ${state.factories.length} 件`);
}

async function selectFactory(factoryId) {
    try {
        setStatus('読み込み中...', 'status-running');
        const [factoryData, stations, connections, executions] = await Promise.all([
            API.fetchFactory(factoryId).catch(() => null),
            API.fetchFactoryStations(factoryId),
            API.fetchFactoryConnections(factoryId),
            API.fetchFactoryExecutions(factoryId).catch(() => []),
        ]);

        state.currentFactory = factoryId;
        state.currentFactoryData = factoryData || state.factories.find(f => f.id === factoryId) || { id: factoryId };
        state.stations = Array.isArray(stations) ? stations : [];
        state.connections = Array.isArray(connections) ? connections : [];
        state.activeWorks = new Map();

        buildLocationMap();

        scene3d.loadFactory(state.stations, state.connections);

        renderObjectList(state.stations, state.activeWorks, state.activeFilters);
        renderExecutionList(Array.isArray(executions) ? executions : []);
        setStatus(`工場: ${factoryName(factoryId)}`, 'status-ok');

        // Update other tabs if active
        const activeTab = document.querySelector('.toolbar-tab.active');
        if (activeTab) {
            const t = activeTab.dataset.gvtab;
            if (t === 'gv-factory-info') renderFactoryInfoGroup(_currentGFIGroup);
            if (t === 'gv-logic-edit') renderGlobalLogicGraph();
        }

        // Set default sim start to now
        const now = new Date();
        now.setSeconds(0, 0);
        const local = toLocalIsoString(now);
        document.getElementById('sim-start').value = local;
    } catch (err) {
        setStatus('読み込み失敗: ' + err.message, 'status-error');
    }
}

function buildLocationMap() {
    state.locationMap = new Map();
    state.stationByLocation = new Map();
    state.stations.forEach(s => {
        const locId = (s.config && s.config.locationId) != null ? s.config.locationId : null;
        if (locId !== null) {
            state.locationMap.set(Number(locId), s.stationId);
            state.stationByLocation.set(s.stationId, Number(locId));
        }
    });
}

function factoryName(fid) {
    const f = state.factories.find(x => x.id === fid);
    return f ? f.name : fid;
}

// ---- Initial conditions ----

async function fetchInitialConditions() {
    const fid = state.currentFactory;
    if (!fid) { setICStatus('工場が未選択です'); return; }

    const startStr = document.getElementById('sim-start').value;
    if (!startStr) { setICStatus('開始日時を入力してください'); return; }

    const startDatetime = new Date(startStr).toISOString();

    setICStatus('SimDBから取得中...');
    try {
        const result = await API.fetchInitialConditions(fid, startDatetime);
        state.initialConditions = result.initialConditions || {};
        const count = Object.keys(state.initialConditions).length;
        setICStatus(`取得完了: ${count}件のステーションに初期条件あり${result.warnings && result.warnings.length ? ` (警告: ${result.warnings.length})` : ''}`);
    } catch (err) {
        setICStatus('取得失敗: ' + err.message);
    }
}

// ---- Run simulation ----

function openRunDialog() {
    const fid = state.currentFactory;
    if (!fid) { setStatus('工場を選択してください', 'status-warn'); return; }
    document.getElementById('run-modal').classList.remove('hidden');
    runSimulation();
}

async function runSimulation() {
    const fid = state.currentFactory;
    const startStr = document.getElementById('sim-start').value;
    const hours = parseFloat(document.getElementById('sim-hours').value) || 24;
    const startDatetime = startStr ? new Date(startStr).toISOString() : new Date().toISOString();
    const simulationTime = hours * 3600;

    setRunModalStatus('シミュレーション実行中...');
    setStatus('実行中...', 'status-running');
    document.getElementById('btn-run').disabled = true;

    try {
        const exec = await API.createExecution(fid, startDatetime, simulationTime, state.initialConditions);
        setRunModalStatus('実行完了。データ読み込み中...');

        // Poll until completed
        await pollExecution(exec.executionId, exec.dataSourceId);

        document.getElementById('run-modal').classList.add('hidden');
        document.getElementById('btn-run').disabled = false;
        document.getElementById('btn-stop-sim').disabled = false;
        setStatus('完了', 'status-ok');

        // Load execution result and subscribe to live
        await loadExecutionResult(exec.executionId, exec.dataSourceId, startDatetime, simulationTime);

        // Enable the "Open in 3D Viewer" button now that we have a dataSourceId
        const vizBtn = document.getElementById('btn-open-visualizer');
        if (vizBtn) vizBtn.disabled = false;

        // Refresh execution history list
        if (fid) {
            API.fetchFactoryExecutions(fid).then(execs => {
                renderExecutionList(Array.isArray(execs) ? execs : []);
            }).catch(() => {});
        }
    } catch (err) {
        setRunModalStatus('失敗: ' + err.message, true);
        setStatus('実行失敗', 'status-error');
        document.getElementById('btn-run').disabled = false;
    }
}

async function pollExecution(execId, dataSourceId) {
    for (let i = 0; i < 600; i++) {
        await sleep(2000);
        const exec = await API.fetchExecution(execId);
        if (exec.status === 'completed') return exec;
        if (exec.status === 'error' || exec.status === 'failed') {
            throw new Error('シミュレーション失敗: ' + (exec.error || exec.status));
        }
        setRunModalStatus(`実行中... (${i * 2}s)`);
    }
    throw new Error('タイムアウト');
}

async function loadExecutionResult(execId, dataSourceId, startDatetime, simulationTime) {
    try {
        const exec = await API.fetchExecution(execId);
        timeline.setExecution({
            ...exec,
            startDatetime,
            simulationTime,
        });

        state.liveDataSourceId = dataSourceId;
        subscribeWebSocket(dataSourceId);

        const vizBtn = document.getElementById('btn-open-visualizer');
        if (vizBtn && dataSourceId) vizBtn.disabled = false;
    } catch (err) {
        setStatus('結果読み込み失敗: ' + err.message, 'status-error');
    }
}

function setRunModalStatus(msg, isError = false) {
    const el = document.getElementById('run-modal-status');
    if (el) {
        el.textContent = msg;
        el.style.color = isError ? 'var(--status-error)' : '';
    }
}

// ---- WebSocket live subscription ----

async function subscribeWebSocket(dataSourceId) {
    disconnectWebSocket();

    // DS切替時に前のワークをクリア
    state.activeWorks.clear();
    if (scene3d) scene3d.clearWorks();

    // locationId → stationId マップをlayout APIから構築
    try {
        const layout = await API.fetchDataSourceLayout(dataSourceId);
        const locs = layout.locations || [];
        state.locationMap = new Map();
        state.stationByLocation = new Map();
        locs.forEach(loc => {
            // location.name が stationId に対応する
            state.locationMap.set(Number(loc.id), loc.name);
            state.stationByLocation.set(loc.name, Number(loc.id));
        });
    } catch (e) {
        console.warn('[layout] failed to load layout, falling back to config-based map', e);
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws/live`;

    const ws = new WebSocket(url);
    state.ws = ws;

    ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'subscribe', data_source_id: dataSourceId }));
        state.wsRetryDelay = 1000;
        setStatus('ライブ受信中', 'status-running');
    };

    ws.onmessage = ev => {
        try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'event') handleWsEvent(msg.data);
        } catch (e) {
            console.warn('[ws] parse error', e);
        }
    };

    ws.onclose = () => {
        if (state.liveDataSourceId === dataSourceId) {
            state.wsRetryTimer = setTimeout(() => {
                state.wsRetryDelay = Math.min(state.wsRetryDelay * 2, 30000);
                subscribeWebSocket(dataSourceId);
            }, state.wsRetryDelay);
        }
    };
}

function disconnectWebSocket() {
    if (state.wsRetryTimer) { clearTimeout(state.wsRetryTimer); state.wsRetryTimer = null; }
    if (state.ws) {
        state.ws.onclose = null;
        state.ws.close();
        state.ws = null;
    }
}

function stopLive() {
    disconnectWebSocket();
    state.liveDataSourceId = null;
    document.getElementById('btn-stop-sim').disabled = true;
    setStatus('停止', 'status-idle');
}

function handleWsEvent(event) {
    if (!scene3d) return;

    if (event.table === 'item_movement') {
        const toStation = state.locationMap.get(Number(event.to_location_id));
        const fromStation = state.locationMap.get(Number(event.from_location_id));

        if (event.movement_type === 'arrived' && toStation) {
            state.activeWorks.set(event.item_id, toStation);
            scene3d.setWorkPosition(event.item_id, toStation);
        } else if (event.movement_type === 'departed' && fromStation) {
            state.activeWorks.delete(event.item_id);
            scene3d.removeWork(event.item_id);
        }
        renderObjectList(state.stations, state.activeWorks, state.activeFilters);
    } else if (event.table === 'machine_signal') {
        scene3d.setInterlockSignal(event.machine_id, event.signal_name, event.value);
    }
}

// ---- Info panels ----

function openInfoPanel(station, type) {
    if (infoPanel) { infoPanel.close(); infoPanel = null; }

    const rows = buildInfoRows(station, type);
    const rect = document.getElementById('scene-container').getBoundingClientRect();

    infoPanel = new FloatingInfoPanel({
        title: station.name || station.stationId || 'Info',
        rows,
        x: rect.right - 300,
        y: rect.top + 60,
        onClose: () => { infoPanel = null; },
    });
}

function buildInfoRows(station, type) {
    const rows = [
        { label: 'ID', value: station.stationId },
        { label: '名前', value: station.name || '—' },
        { label: 'タイプ', value: station.stationType || type },
    ];
    if (type === 'work') {
        const loc = state.activeWorks.get(station.stationId);
        rows.push({ label: '現在位置', value: loc || '—' });
        return rows;
    }
    if (station.config) {
        if (station.config.locationId != null) rows.push({ label: 'LocationID', value: station.config.locationId });
        if (station.config.processingTime != null) rows.push({ label: '処理時間(s)', value: station.config.processingTime });
    }
    const locId = state.stationByLocation.get(station.stationId);
    if (locId != null) rows.push({ label: 'SimDB LocationID', value: locId });
    rows.push({ label: '位置 X/Y', value: `${station.positionX?.toFixed(0) ?? 0} / ${station.positionY?.toFixed(0) ?? 0}` });
    return rows;
}

// ---- Local window (machine editor) ----

function openLocalWindow(machineStationId) {
    const st = state.stations.find(s => s.stationId === machineStationId);
    const equipName = st?.equipmentId || machineStationId;
    const params = new URLSearchParams({
        factoryId: state.currentFactory || '',
        machineId: machineStationId,
        equipName,
    });
    const url = `/factory-visualizer/local-window.html?${params}`;
    const win = window.open(url, `machine_${equipName}`, 'width=900,height=700,resizable=yes');
    if (!win) setStatus('ポップアップがブロックされました。許可してください。', 'status-warn');
}

// ---- Restore saved sim start ----

function restoreSimStart() {
    const saved = sessionStorage.getItem('fv_sim_start');
    if (saved) document.getElementById('sim-start').value = saved;

    document.getElementById('sim-start').addEventListener('change', e => {
        sessionStorage.setItem('fv_sim_start', e.target.value);
    });
}

// ---- Utilities ----

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toLocalIsoString(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============================================================
// Global View Tabs
// ============================================================

function initGlobalTabs() {
    document.querySelectorAll('.toolbar-tab').forEach(tab => {
        tab.addEventListener('click', () => switchGlobalTab(tab.dataset.gvtab));
    });
}

function switchGlobalTab(tabId) {
    document.querySelectorAll('.toolbar-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.gvtab === tabId));
    document.querySelectorAll('.global-tab-body').forEach(b =>
        b.classList.toggle('active', b.id === tabId));

    if (tabId === 'gv-3d-edit') {
        if (scene3d) {
            const g3dScene = document.getElementById('g3d-scene');
            scene3d.attachTo(g3dScene);
        }
    } else if (tabId === 'gv-view-display') {
        if (scene3d) {
            scene3d.attachTo(document.getElementById('scene-canvas-wrapper'));
        }
    }

    if (tabId === 'gv-factory-info') renderFactoryInfoGroup(_currentGFIGroup);
    if (tabId === 'gv-logic-edit') renderGlobalLogicGraph();
}

// ============================================================
// 工場情報タブ
// ============================================================

let _currentGFIGroup = 'basic';

function initFactoryInfoTab() {
    document.querySelectorAll('.gfi-group-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.gfi-group-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            _currentGFIGroup = item.dataset.group;
            document.getElementById('gfi-group-title').textContent = item.textContent;
            renderFactoryInfoGroup(_currentGFIGroup);
        });
    });

    document.getElementById('btn-gfi-export').addEventListener('click', exportFactoryJSON);
    document.getElementById('btn-gfi-import').addEventListener('click', () =>
        document.getElementById('gfi-import-file').click());
    document.getElementById('gfi-import-file').addEventListener('change', importFactoryJSON);
}

function renderFactoryInfoGroup(groupId) {
    const container = document.getElementById('gfi-fields');
    if (!state.currentFactory) {
        container.innerHTML = '<div class="empty-hint">工場を選択してください</div>';
        return;
    }
    switch (groupId) {
        case 'basic':       renderGFIBasic(container); break;
        case 'stations':    renderGFIStations(container); break;
        case 'connections': renderGFIConnections(container); break;
        case 'metadata':    renderGFIMetadata(container); break;
    }
}

function renderGFIBasic(container) {
    const f = state.currentFactoryData || {};
    container.innerHTML = `
        <div class="gfi-form">
            <div class="gfi-field-row">
                <label>工場ID</label>
                <input type="text" value="${esc(f.id || state.currentFactory)}" readonly class="input-dark gfi-input-readonly">
            </div>
            <div class="gfi-field-row">
                <label>工場名</label>
                <input type="text" id="gfi-factory-name" value="${esc(f.name || '')}" class="input-dark">
            </div>
            <div class="gfi-field-row">
                <label>説明</label>
                <textarea id="gfi-factory-desc" class="input-dark gfi-textarea">${esc(f.description || '')}</textarea>
            </div>
            <div class="gfi-field-row">
                <label>作成日</label>
                <input type="text" value="${esc(f.createdAt || '—')}" readonly class="input-dark gfi-input-readonly">
            </div>
            <div class="gfi-save-row">
                <span id="gfi-basic-status" class="ic-status"></span>
                <button class="btn-primary" id="gfi-save-basic" style="width:auto;padding:5px 16px;">保存</button>
            </div>
        </div>`;
    document.getElementById('gfi-save-basic').addEventListener('click', async () => {
        const name = document.getElementById('gfi-factory-name').value.trim();
        const desc = document.getElementById('gfi-factory-desc').value;
        const statusEl = document.getElementById('gfi-basic-status');
        try {
            await API.updateFactory(state.currentFactory, { name, description: desc });
            state.currentFactoryData = { ...state.currentFactoryData, name, description: desc };
            const opt = document.querySelector(`#factory-select option[value="${esc(state.currentFactory)}"]`);
            if (opt) opt.textContent = name;
            const f2 = state.factories.find(x => x.id === state.currentFactory);
            if (f2) f2.name = name;
            statusEl.textContent = '保存しました';
            statusEl.style.color = 'var(--status-normal)';
        } catch (err) {
            statusEl.textContent = '保存失敗: ' + err.message;
            statusEl.style.color = 'var(--status-error)';
        }
    });
}

function renderGFIStations(container) {
    const rows = state.stations.map(s => `
        <tr>
            <td style="font-family:monospace;font-size:11px;">${esc(s.stationId)}</td>
            <td><input type="text" value="${esc(s.name || '')}" class="gfi-table-input"
                data-sid="${esc(s.stationId)}" data-field="name"></td>
            <td>${esc(s.stationType || '')}</td>
            <td style="text-align:center;">
                <button class="gfi-action-btn" data-action="del-st" data-sid="${esc(s.stationId)}">削除</button>
            </td>
        </tr>`).join('');
    container.innerHTML = `
        <div class="gfi-table-wrap">
            <table class="gfi-table">
                <thead><tr><th>ID</th><th>名前</th><th>タイプ</th><th>操作</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="4" style="color:var(--text-muted);padding:10px;">ステーションがありません</td></tr>'}</tbody>
            </table>
        </div>`;
    container.querySelectorAll('.gfi-table-input').forEach(input => {
        input.addEventListener('change', async e => {
            const sid = e.target.dataset.sid;
            const field = e.target.dataset.field;
            try {
                await API.updateStation(state.currentFactory, sid, { [field]: e.target.value });
                const st = state.stations.find(s => s.stationId === sid);
                if (st) st[field] = e.target.value;
            } catch (err) {
                setStatus('更新失敗: ' + err.message, 'status-error');
                e.target.value = state.stations.find(s => s.stationId === sid)?.[field] || '';
            }
        });
    });
    container.querySelectorAll('[data-action="del-st"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const sid = btn.dataset.sid;
            if (!confirm(`ステーション "${sid}" を削除しますか？`)) return;
            try {
                await API.deleteStation(state.currentFactory, sid);
                state.stations = state.stations.filter(s => s.stationId !== sid);
                scene3d && scene3d.loadFactory(state.stations, state.connections);
                renderGFIStations(container);
            } catch (err) {
                setStatus('削除失敗: ' + err.message, 'status-error');
            }
        });
    });
}

function renderGFIConnections(container) {
    const rows = state.connections.map(c => {
        const cid = c.id || c.connectionId || '';
        return `<tr>
            <td style="font-family:monospace;font-size:11px;">${esc(String(cid))}</td>
            <td>${esc(c.fromStation)}</td>
            <td style="color:var(--text-muted)">→</td>
            <td>${esc(c.toStation)}</td>
            <td>${esc(c.condition || 'default')}</td>
            <td style="text-align:center;">
                <button class="gfi-action-btn" data-action="del-conn" data-cid="${esc(String(cid))}">削除</button>
            </td>
        </tr>`;
    }).join('');
    container.innerHTML = `
        <div class="gfi-table-wrap">
            <table class="gfi-table">
                <thead><tr><th>ID</th><th>From</th><th></th><th>To</th><th>条件</th><th>操作</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="6" style="color:var(--text-muted);padding:10px;">接続がありません</td></tr>'}</tbody>
            </table>
        </div>`;
    container.querySelectorAll('[data-action="del-conn"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('この接続を削除しますか？')) return;
            const cid = btn.dataset.cid;
            try {
                await API.deleteConnection(state.currentFactory, cid);
                state.connections = state.connections.filter(c => String(c.id || c.connectionId) !== cid);
                scene3d && scene3d.loadFactory(state.stations, state.connections);
                renderGFIConnections(container);
                renderGlobalLogicGraph();
            } catch (err) {
                setStatus('削除失敗: ' + err.message, 'status-error');
            }
        });
    });
}

function renderGFIMetadata(container) {
    const f = state.currentFactoryData || {};
    container.innerHTML = `
        <div class="gfi-form">
            <div style="margin-bottom:10px;font-size:11px;color:var(--text-muted);padding:8px 10px;background:var(--bg-surface);border-radius:var(--radius-sm);border:1px solid var(--border-color);">
                工場オブジェクトの全データを表示しています（読み取り専用）。<br>
                基本情報（名前・説明）の編集は「基本情報」タブで行えます。
            </div>
            <div class="gfi-field-row">
                <label>工場データ (JSON)</label>
                <textarea class="input-dark gfi-textarea gfi-textarea-tall gfi-input-readonly"
                    readonly style="cursor:default;font-family:monospace;">${esc(JSON.stringify(f, null, 2))}</textarea>
            </div>
        </div>`;
}

function exportFactoryJSON() {
    if (!state.currentFactory) return;
    const data = {
        factory: state.currentFactoryData || { id: state.currentFactory },
        stations: state.stations,
        connections: state.connections,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `factory_${state.currentFactory}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

async function importFactoryJSON(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        const fid = state.currentFactory;
        if (!fid) { alert('先に工場を選択してください'); return; }

        const msg = [
            `工場: ${data.factory?.name || '?'}`,
            `ステーション: ${(data.stations || []).length}件`,
            `接続: ${(data.connections || []).length}件`,
            '',
            'このデータをインポートしますか？',
            '（既存データへの追加ではなく上書きになります）',
        ].join('\n');
        if (!confirm(msg)) return;

        // Update factory basic info
        if (data.factory?.name) {
            await API.updateFactory(fid, { name: data.factory.name, description: data.factory.description || '' });
        }

        // Refresh from server after import attempt
        setStatus('インポート中...', 'status-running');
        await selectFactory(fid);
        setStatus('インポート完了', 'status-ok');
    } catch (err) {
        setStatus('インポート失敗: ' + err.message, 'status-error');
    }
}

// ============================================================
// 3Dモデル編集タブ
// ============================================================

function initGlobal3DEditTab() {
    document.querySelectorAll('.g3d-sidebar-item').forEach(item => {
        item.addEventListener('click', () => {
            // 配置モードが ON の場合: active クラスがなくてもボタン再押しで終了できるようにする
            if (item.dataset.group === 'placement' && scene3d && scene3d._placementMode) {
                closeG3DFloating();
                return;
            }
            if (item.classList.contains('active')) {
                closeG3DFloating();
                return;
            }
            document.querySelectorAll('.g3d-sidebar-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            openG3DFloating(item.dataset.group, item.textContent);
        });
    });

    document.getElementById('g3d-float-close').addEventListener('click', closeG3DFloating);
    document.getElementById('g3d-float-confirm').addEventListener('click', () => {
        saveG3DSettings();
        closeG3DFloating();
    });

    // Make floating window draggable
    const floatEl = document.getElementById('g3d-floating');
    const header = floatEl.querySelector('.g3d-float-header');
    let dragging = false, ox = 0, oy = 0;
    header.addEventListener('mousedown', e => {
        dragging = true;
        ox = e.clientX - floatEl.offsetLeft;
        oy = e.clientY - floatEl.offsetTop;
        e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        floatEl.style.left = (e.clientX - ox) + 'px';
        floatEl.style.top  = (e.clientY - oy) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
}

function openG3DFloating(groupId, title) {
    const floatEl = document.getElementById('g3d-floating');
    document.getElementById('g3d-float-title').textContent = title || groupId;
    const body = document.getElementById('g3d-float-body');

    // Read current values from left-panel controls
    const theme = document.getElementById('scene-theme').value;
    const shellOp = document.getElementById('shell-opacity').value;
    const intRadius = document.getElementById('internal-radius').value;
    const showInt = document.getElementById('show-internal').checked;
    const showNames = document.getElementById('show-station-names').checked;
    const showWorks = document.getElementById('show-works').checked;
    const showIL = document.getElementById('show-interlocks').checked;

    const row = (label, content) =>
        `<div class="gf-field-row"><label>${label}</label>${content}</div>`;

    switch (groupId) {
        case 'placement': {
            scene3d && scene3d.setPlacementMode(true);
            document.getElementById('g3d-float-footer').style.display = 'none';

            const equipMap = new Map();
            state.stations.filter(s => s.stationType === 'machine').forEach(s => {
                const m = s.stationId.match(/^(.+?)[._-]?(\d{3})$/);
                const equip = m ? m[1] : s.stationId;
                if (!equipMap.has(equip)) equipMap.set(equip, []);
                equipMap.get(equip).push(s);
            });

            const rows = [];
            equipMap.forEach((members, equipName) => {
                // 未保存の移動がある場合はその座標を表示、なければ DB の値を使用
                const moved = _movedEquipment.get(equipName);
                const cx = moved ? moved.centroid.x : members.reduce((acc, m) => acc + (m.positionX || 0), 0) / members.length;
                const cz = moved ? moved.centroid.z : members.reduce((acc, m) => acc + (m.positionY || 0), 0) / members.length;
                rows.push(`<div class="gf-equip-row">
                    <span class="gf-equip-name">${esc(equipName)}</span>
                    <span class="gf-equip-pos" id="gf-pos-${esc(equipName)}">X: ${cx.toFixed(1)}m, Y: ${cz.toFixed(1)}m</span>
                </div>`);
            });

            body.innerHTML = `
                <button class="btn-primary" id="gf-save-placement" style="width:100%;padding:6px;margin-bottom:4px;">保存して確定</button>
                <button class="btn-secondary" id="gf-exit-placement" style="width:100%;padding:5px;margin-bottom:4px;">保存せず終了</button>
                <button class="toolbar-btn" id="gf-refresh-placement" style="width:100%;padding:4px;margin-bottom:6px;font-size:11px;">↺ 表示を更新</button>
                <div style="font-size:11px;color:var(--text-muted);">設備をドラッグして移動。確定で SimDB に保存されます。</div>
                <div style="max-height:200px;overflow-y:auto;">${rows.join('') || '<div style="color:var(--text-muted);font-size:11px">設備がありません</div>'}</div>
            `;
            body.querySelector('#gf-exit-placement').addEventListener('click', closeG3DFloating);
            body.querySelector('#gf-save-placement').addEventListener('click', saveEquipPlacement);
            body.querySelector('#gf-refresh-placement').addEventListener('click', () => openG3DFloating('placement'));
            break;
        }
        case 'global':
            body.innerHTML = `
                ${row('シーンテーマ', `<select id="gf-theme">
                    <option value="auto" ${theme==='auto'?'selected':''}>テーマに合わせる</option>
                    <option value="dark" ${theme==='dark'?'selected':''}>ダークネイビー</option>
                    <option value="light" ${theme==='light'?'selected':''}>ライト</option>
                </select>`)}
                ${row('内部表示', `<label class="toggle-switch">
                    <input type="checkbox" id="gf-show-internal" ${showInt?'checked':''}>
                    <span class="toggle-track"></span></label>`)}`;
            body.querySelector('#gf-theme').addEventListener('change', e => {
                const v = e.target.value;
                applyDocTheme(v);
                scene3d && scene3d.applyTheme(v);
                document.getElementById('scene-theme').value = v;
            });
            body.querySelector('#gf-show-internal').addEventListener('change', e => {
                scene3d && scene3d.setShowInternal(e.target.checked);
                document.getElementById('show-internal').checked = e.target.checked;
            });
            break;

        case 'shell':
            body.innerHTML = `
                ${row('シェル透明度', `<input type="range" id="gf-shell-op" min="0.1" max="1.0" step="0.05" value="${shellOp}">
                    <span class="gf-slider-val" id="gf-shell-op-val">${shellOp}</span>`)}`;
            body.querySelector('#gf-shell-op').addEventListener('input', e => {
                body.querySelector('#gf-shell-op-val').textContent = e.target.value;
                scene3d && scene3d.setShellOpacity(parseFloat(e.target.value));
                document.getElementById('shell-opacity').value = e.target.value;
                document.getElementById('shell-opacity-val').textContent = e.target.value;
            });
            break;

        case 'stations':
            body.innerHTML = `
                ${row('内部ステーション径', `<input type="range" id="gf-int-radius" min="5" max="30" step="1" value="${intRadius}">
                    <span class="gf-slider-val" id="gf-int-radius-val">${intRadius}</span>`)}
                ${row('ステーション名', `<label class="toggle-switch">
                    <input type="checkbox" id="gf-show-names" ${showNames?'checked':''}>
                    <span class="toggle-track"></span></label>`)}`;
            body.querySelector('#gf-int-radius').addEventListener('input', e => {
                body.querySelector('#gf-int-radius-val').textContent = e.target.value;
                scene3d && scene3d.setInternalRadius(parseFloat(e.target.value));
                document.getElementById('internal-radius').value = e.target.value;
                document.getElementById('internal-radius-val').textContent = e.target.value;
            });
            body.querySelector('#gf-show-names').addEventListener('change', e => {
                scene3d && scene3d.setShowStationNames(e.target.checked);
                document.getElementById('show-station-names').checked = e.target.checked;
            });
            break;

        case 'works':
            body.innerHTML = `
                ${row('ワーク表示', `<label class="toggle-switch">
                    <input type="checkbox" id="gf-show-works" ${showWorks?'checked':''}>
                    <span class="toggle-track"></span></label>`)}`;
            body.querySelector('#gf-show-works').addEventListener('change', e => {
                scene3d && scene3d.setShowWorks(e.target.checked);
                document.getElementById('show-works').checked = e.target.checked;
            });
            break;

        case 'interlocks':
            body.innerHTML = `
                ${row('インターロック表示', `<label class="toggle-switch">
                    <input type="checkbox" id="gf-show-il" ${showIL?'checked':''}>
                    <span class="toggle-track"></span></label>`)}`;
            body.querySelector('#gf-show-il').addEventListener('change', e => {
                scene3d && scene3d.setShowInterlocks(e.target.checked);
                document.getElementById('show-interlocks').checked = e.target.checked;
            });
            break;

        default:
            body.innerHTML = '<div class="empty-hint">設定項目がありません</div>';
    }

    floatEl.classList.remove('hidden');
}

function closeG3DFloating() {
    document.getElementById('g3d-floating').classList.add('hidden');
    document.getElementById('g3d-float-footer').style.display = '';
    document.querySelectorAll('.g3d-sidebar-item').forEach(i => i.classList.remove('active'));
    scene3d && scene3d.setPlacementMode(false);
}

function saveG3DSettings() {
    const settings = {
        theme: document.getElementById('scene-theme').value,
        shellOpacity: document.getElementById('shell-opacity').value,
        internalRadius: document.getElementById('internal-radius').value,
        showInternal: document.getElementById('show-internal').checked,
        showStationNames: document.getElementById('show-station-names').checked,
        showWorks: document.getElementById('show-works').checked,
        showInterlocks: document.getElementById('show-interlocks').checked,
    };
    try { localStorage.setItem('fv_3d_settings', JSON.stringify(settings)); } catch {}
}

async function saveEquipPlacement() {
    const btn = document.getElementById('gf-save-placement');
    if (!btn) return;
    if (_movedEquipment.size === 0) {
        btn.textContent = '移動した設備がありません';
        setTimeout(() => { if (btn) btn.textContent = '保存して確定'; }, 1500);
        return;
    }
    btn.disabled = true;
    btn.textContent = '保存中...';

    try {
        const promises = [];
        _movedEquipment.forEach(({ machines }) => {
            machines.forEach(({ stationId, positionX, positionY }) => {
                promises.push(API.updateStation(state.currentFactory, stationId, { posX: positionX, posY: positionY }));
            });
        });
        await Promise.all(promises);
        _movedEquipment.clear();
        // Reload to sync saved positions, then exit placement mode
        if (state.currentFactory) await selectFactory(state.currentFactory);
        closeG3DFloating();
    } catch (err) {
        alert('保存失敗: ' + err.message);
        btn.textContent = '保存して確定 *';
        btn.disabled = false;
    }
}

// ============================================================
// ロジック編集タブ
// ============================================================

const GLE_NODE_W = 140;
const GLE_NODE_H = 54;
let _gleCurrentTool = 'select';
let _gleConnectFrom = null;
let _gleNodePositions = {};
let _gleSelectedNode = null;

function initGlobalLogicEditTab() {
    // Tool buttons
    document.querySelectorAll('[data-gle-tool]').forEach(btn => {
        btn.addEventListener('click', () => {
            _gleCurrentTool = btn.dataset.gleTool;
            document.querySelectorAll('[data-gle-tool]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _gleConnectFrom = null;
            _gleSelectedNode = null;
            gleUpdateHint();
            gleUpdateNodeStyles();
        });
    });

    document.getElementById('btn-gle-refresh').addEventListener('click', async () => {
        if (state.currentFactory) await selectFactory(state.currentFactory);
    });

    // New machine button
    document.getElementById('btn-gle-add-machine').addEventListener('click', () => {
        if (!state.currentFactory) { alert('工場を選択してください'); return; }
        const modal = document.getElementById('new-machine-modal');
        modal.classList.remove('hidden');
        document.getElementById('new-machine-name').value = '';
        document.getElementById('new-machine-name').focus();
    });
    document.getElementById('new-machine-modal-close').addEventListener('click', () =>
        document.getElementById('new-machine-modal').classList.add('hidden'));
    document.getElementById('new-machine-cancel').addEventListener('click', () =>
        document.getElementById('new-machine-modal').classList.add('hidden'));
    document.getElementById('new-machine-ok').addEventListener('click', gleAddMachine);
    document.getElementById('new-machine-name').addEventListener('input', e => {
        const sidInput = document.getElementById('new-machine-sid');
        sidInput.value = gleGenerateStationId(e.target.value);
    });
    document.getElementById('new-machine-name').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('new-machine-sid').focus();
    });
    document.getElementById('new-machine-sid').addEventListener('keydown', e => {
        if (e.key === 'Enter') gleAddMachine();
    });
}

function gleUpdateHint() {
    const hints = {
        select:  '設備をドラッグして移動 / ダブルクリックで設備編集',
        connect: '接続元の設備をクリック → 接続先の設備をクリック',
        delete:  '削除したい接続線をクリック',
    };
    document.getElementById('gle-hint').textContent = hints[_gleCurrentTool] || '';
}

function gleLoadPositions() {
    if (!state.currentFactory) { _gleNodePositions = {}; return; }
    try {
        const raw = localStorage.getItem(`fv_gle_pos_${state.currentFactory}`);
        _gleNodePositions = raw ? JSON.parse(raw) : {};
    } catch { _gleNodePositions = {}; }
}

function gleSavePositions() {
    if (!state.currentFactory) return;
    try { localStorage.setItem(`fv_gle_pos_${state.currentFactory}`, JSON.stringify(_gleNodePositions)); } catch {}
}

function gleAutoLayout(machines) {
    const cols = Math.ceil(Math.sqrt(machines.length)) || 1;
    machines.forEach((m, i) => {
        if (!_gleNodePositions[m.stationId]) {
            _gleNodePositions[m.stationId] = {
                x: 60 + (i % cols) * (GLE_NODE_W + 60),
                y: 60 + Math.floor(i / cols) * (GLE_NODE_H + 60),
            };
        }
    });
}

function renderGlobalLogicGraph() {
    gleLoadPositions();
    const machines = state.stations.filter(s => s.stationType === 'machine');
    gleAutoLayout(machines);

    // Update sidebar list
    const listEl = document.getElementById('gle-machine-list');
    if (!state.currentFactory) {
        listEl.innerHTML = '<div class="empty-hint">工場を選択してください</div>';
    } else {
        listEl.innerHTML = machines.map(m =>
            `<div class="gle-machine-item" data-sid="${esc(m.stationId)}">${esc(m.name || m.stationId)}</div>`
        ).join('') || '<div class="empty-hint">設備がありません</div>';
        listEl.querySelectorAll('.gle-machine-item').forEach(item => {
            item.addEventListener('click', () => {
                // Pan to node
                const sid = item.dataset.sid;
                gleScrollToNode(sid);
            });
        });
    }

    // Build SVG
    const connLayer = document.getElementById('gle-conn-layer');
    const nodeLayer = document.getElementById('gle-node-layer');
    connLayer.innerHTML = '';
    nodeLayer.innerHTML = '';

    // Draw connections
    const machineIds = new Set(machines.map(m => m.stationId));
    state.connections.filter(c => machineIds.has(c.fromStation) && machineIds.has(c.toStation))
        .forEach(c => gleDrawConnection(c, connLayer));

    // Draw nodes
    machines.forEach(m => gleDrawNode(m, nodeLayer));
}

function gleDrawNode(machine, layer) {
    const pos = _gleNodePositions[machine.stationId] || { x: 60, y: 60 };
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'gle-node');
    g.setAttribute('data-sid', machine.stationId);
    g.setAttribute('transform', `translate(${pos.x},${pos.y})`);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', GLE_NODE_W);
    rect.setAttribute('height', GLE_NODE_H);
    rect.setAttribute('rx', 6);
    rect.setAttribute('fill', 'var(--bg-panel)');
    rect.setAttribute('stroke', 'var(--border-light)');
    rect.setAttribute('stroke-width', '1.5');
    rect.style.cursor = 'pointer';

    const name = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    name.setAttribute('x', GLE_NODE_W / 2);
    name.setAttribute('y', 22);
    name.setAttribute('text-anchor', 'middle');
    name.setAttribute('fill', 'var(--text-primary)');
    name.setAttribute('font-size', '12');
    name.setAttribute('font-family', 'inherit');
    name.textContent = machine.name || machine.stationId;

    const sub = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    sub.setAttribute('x', GLE_NODE_W / 2);
    sub.setAttribute('y', 38);
    sub.setAttribute('text-anchor', 'middle');
    sub.setAttribute('fill', 'var(--text-muted)');
    sub.setAttribute('font-size', '10');
    sub.setAttribute('font-family', 'inherit');
    sub.textContent = 'machine';

    g.appendChild(rect);
    g.appendChild(name);
    g.appendChild(sub);
    layer.appendChild(g);

    // Events
    gleAttachNodeEvents(g, machine);
}

function gleDrawConnection(conn, layer) {
    const fromPos = _gleNodePositions[conn.fromStation];
    const toPos   = _gleNodePositions[conn.toStation];
    if (!fromPos || !toPos) return;

    const x1 = fromPos.x + GLE_NODE_W;
    const y1 = fromPos.y + GLE_NODE_H / 2;
    const x2 = toPos.x;
    const y2 = toPos.y + GLE_NODE_H / 2;
    const cx1 = x1 + 60;
    const cx2 = x2 - 60;
    const d = `M ${x1},${y1} C ${cx1},${y1} ${cx2},${y2} ${x2},${y2}`;

    // Hit area (invisible, wide)
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.setAttribute('d', d);
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '12');
    hit.setAttribute('fill', 'none');
    hit.style.cursor = 'pointer';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', '#4a9eff');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', 'url(#gle-arrow)');
    path.setAttribute('opacity', '0.75');
    path.style.pointerEvents = 'none';

    const cid = String(conn.id || conn.connectionId || '');
    hit.dataset.cid = cid;
    hit.addEventListener('click', () => gleHandleConnClick(cid));
    hit.addEventListener('mouseenter', () => { path.setAttribute('opacity', '1'); path.setAttribute('stroke-width', '3'); });
    hit.addEventListener('mouseleave', () => { path.setAttribute('opacity', '0.75'); path.setAttribute('stroke-width', '2'); });

    layer.appendChild(path);
    layer.appendChild(hit);
}

function gleAttachNodeEvents(g, machine) {
    const sid = machine.stationId;
    let dragActive = false, startX = 0, startY = 0, origX = 0, origY = 0;
    let clickStartTime = 0;

    g.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        clickStartTime = Date.now();
        if (_gleCurrentTool === 'select') {
            dragActive = true;
            startX = e.clientX;
            startY = e.clientY;
            const pos = _gleNodePositions[sid] || { x: 0, y: 0 };
            origX = pos.x;
            origY = pos.y;
            e.preventDefault();
        } else if (_gleCurrentTool === 'connect') {
            gleHandleConnectClick(sid);
            e.preventDefault();
        }
    });

    document.addEventListener('mousemove', e => {
        if (!dragActive) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const newX = Math.max(0, origX + dx);
        const newY = Math.max(0, origY + dy);
        _gleNodePositions[sid] = { x: newX, y: newY };
        g.setAttribute('transform', `translate(${newX},${newY})`);
        gleRedrawConnections();
    });

    document.addEventListener('mouseup', e => {
        if (dragActive) {
            dragActive = false;
            gleSavePositions();
            gleRedrawConnections();
        }
    });

    g.addEventListener('dblclick', e => {
        e.stopPropagation();
        openLocalWindow(sid);
    });

    g.querySelector('rect').addEventListener('mouseenter', () => {
        g.querySelector('rect').setAttribute('stroke', 'var(--accent-blue)');
    });
    g.querySelector('rect').addEventListener('mouseleave', () => {
        if (_gleSelectedNode !== sid)
            g.querySelector('rect').setAttribute('stroke', 'var(--border-light)');
    });
}

function gleRedrawConnections() {
    const connLayer = document.getElementById('gle-conn-layer');
    connLayer.innerHTML = '';
    const machineIds = new Set(
        state.stations.filter(s => s.stationType === 'machine').map(m => m.stationId)
    );
    state.connections
        .filter(c => machineIds.has(c.fromStation) && machineIds.has(c.toStation))
        .forEach(c => gleDrawConnection(c, connLayer));
}

async function gleHandleConnectClick(sid) {
    if (!_gleConnectFrom) {
        _gleConnectFrom = sid;
        gleSetNodeHighlight(sid, true);
        document.getElementById('gle-hint').textContent = `"${sid}" から接続先を選択してください`;
    } else {
        if (_gleConnectFrom === sid) {
            _gleConnectFrom = null;
            gleSetNodeHighlight(sid, false);
            gleUpdateHint();
            return;
        }
        const from = _gleConnectFrom;
        _gleConnectFrom = null;
        gleSetNodeHighlight(from, false);
        try {
            const conn = await API.createConnection(state.currentFactory, from, sid);
            state.connections.push(conn);
            renderGlobalLogicGraph();
        } catch (err) {
            setStatus('接続作成失敗: ' + err.message, 'status-error');
        }
        gleUpdateHint();
    }
}

async function gleHandleConnClick(cid) {
    if (_gleCurrentTool !== 'delete') return;
    if (!confirm('この接続を削除しますか？')) return;
    try {
        await API.deleteConnection(state.currentFactory, cid);
        state.connections = state.connections.filter(c => String(c.id || c.connectionId) !== cid);
        renderGlobalLogicGraph();
    } catch (err) {
        setStatus('接続削除失敗: ' + err.message, 'status-error');
    }
}

function gleSetNodeHighlight(sid, on) {
    const g = document.querySelector(`#gle-node-layer .gle-node[data-sid="${sid}"]`);
    if (g) g.querySelector('rect').setAttribute('stroke', on ? 'var(--accent-blue)' : 'var(--border-light)');
}

function gleUpdateNodeStyles() {
    // Reset all node highlights
    document.querySelectorAll('#gle-node-layer .gle-node rect').forEach(r =>
        r.setAttribute('stroke', 'var(--border-light)'));
}

function gleScrollToNode(sid) {
    const pos = _gleNodePositions[sid];
    if (!pos) return;
    const wrap = document.getElementById('gle-canvas-wrap');
    wrap.scrollLeft = Math.max(0, pos.x - wrap.clientWidth / 2 + GLE_NODE_W / 2);
    wrap.scrollTop  = Math.max(0, pos.y - wrap.clientHeight / 2 + GLE_NODE_H / 2);
}

function gleGenerateStationId(name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'machine';
    return `${base}.machine`;
}

async function gleAddMachine() {
    const nameInput = document.getElementById('new-machine-name');
    const sidInput  = document.getElementById('new-machine-sid');
    const name = nameInput.value.trim();
    const sid  = sidInput ? sidInput.value.trim() : '';
    if (!name) { nameInput.focus(); return; }
    if (!sid) { sidInput && sidInput.focus(); return; }
    document.getElementById('new-machine-modal').classList.add('hidden');
    try {
        await API.createStation(state.currentFactory, {
            stationId:   sid,
            name,
            stationType: 'machine',
            posX: 0,
            posY: 0,
            posZ: 0,
        });
        // Reload stations from server (API returns only {status:"created"})
        const stations = await API.fetchFactoryStations(state.currentFactory);
        state.stations = Array.isArray(stations) ? stations : state.stations;
        scene3d && scene3d.loadFactory(state.stations, state.connections);
        renderObjectList(state.stations, state.activeWorks, state.activeFilters);
        renderGlobalLogicGraph();
        setStatus('設備を追加しました', 'status-ok');
    } catch (err) {
        setStatus('設備追加失敗: ' + err.message, 'status-error');
    }
}
