// Factory Visualizer — Main Application
import { Scene3D } from './scene3d.js';
import { Timeline } from './timeline.js';
import { initAIPanel, FloatingInfoPanel } from './panels.js';
import { initLeftPanel, applyDocTheme, renderObjectList, setObjectListClickHandler, setStatus, setICStatus, setTimeDisplay } from './ui.js';
import * as API from './api.js';

// ---- State ----

const state = {
    factories: [],
    currentFactory: null,
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

// ---- Boot ----

document.addEventListener('DOMContentLoaded', async () => {
    initScene();
    initTimeline();
    initUI();
    initAIPanel();

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
    scene3d.setOnWorkClick(workId => {
        openInfoPanel({ stationId: workId, name: workId, stationType: 'work' }, 'work');
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
        const st = state.stations.find(s => s.stationId === id);
        if (st) openInfoPanel(st, type);
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
    document.getElementById('btn-top').addEventListener('click', () => scene3d && scene3d.setTopView());

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
        const [stations, connections] = await Promise.all([
            API.fetchFactoryStations(factoryId),
            API.fetchFactoryConnections(factoryId),
        ]);

        state.currentFactory = factoryId;
        state.stations = Array.isArray(stations) ? stations : [];
        state.connections = Array.isArray(connections) ? connections : [];
        state.activeWorks = new Map();

        buildLocationMap();

        scene3d.loadFactory(state.stations, state.connections);

        renderObjectList(state.stations, state.activeWorks, state.activeFilters);
        setStatus(`工場: ${factoryName(factoryId)}`, 'status-ok');

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

function subscribeWebSocket(dataSourceId) {
    disconnectWebSocket();

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
    const params = new URLSearchParams({
        factoryId: state.currentFactory || '',
        machineId: machineStationId,
        machineName: (st && st.name) || machineStationId,
    });
    const url = `/factory-visualizer/local-window.html?${params}`;
    const win = window.open(url, `machine_${machineStationId}`, 'width=900,height=700,resizable=yes');
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
