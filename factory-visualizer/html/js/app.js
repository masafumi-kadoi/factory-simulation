// Factory Visualizer — Main Application
import { Scene3D } from './scene3d.js';
import { Timeline } from './timeline.js';
import { initAIPanel, FloatingInfoPanel, FloatingCameraPanel } from './panels.js';
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
    historyEvents: [],          // sorted item_movement events for timeline replay
};

let scene3d = null;
let timeline = null;
let infoPanel = null;
let infoPanels = [];       // multi-window mode で開いたパネル一覧
let multiWindowMode = false;
let cameraPanels = [];     // カメラウインドウ一覧（常に複数表示）
const _movedEquipment = new Map(); // equipName → { centroid, machines[] }
let _dragEquipData = null;         // ドラッグ中の設備データ { equipName, members }（3D編集用）
let _dragGleData   = null;         // ドラッグ中の設備データ { equipName, members }（ロジック編集用）

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

function applyHistoryAtTime(ms, animate = true) {
    if (!scene3d || !state.historyEvents.length) return;
    const workLocations = new Map(); // workId → locationId
    for (const ev of state.historyEvents) {
        if (new Date(ev.event_time).getTime() > ms) break;
        if (ev.movement_type === 'arrived') {
            workLocations.set(ev.item_id, ev.to_location_id);
        } else if (ev.movement_type === 'departed') {
            workLocations.delete(ev.item_id);
        }
    }

    // Remove works no longer present at this time
    state.activeWorks.forEach((_, workId) => {
        if (!workLocations.has(workId)) {
            scene3d.removeWork(workId);
            state.activeWorks.delete(workId);
        }
    });

    // Add or move works that changed station
    workLocations.forEach((locationId, workId) => {
        const stationId = state.locationMap.get(Number(locationId));
        if (!stationId) return;
        const prevStation = state.activeWorks.get(workId);
        if (prevStation !== stationId) {
            state.activeWorks.set(workId, stationId);
            scene3d.setWorkPosition(workId, stationId, undefined, animate);
        }
    });

    renderObjectList(state.stations, state.activeWorks, state.activeFilters);
}

function initTimeline() {
    const canvas = document.getElementById('timeline-canvas');
    timeline = new Timeline({
        canvas,
        onSeek: (ms, seeking) => {
            setTimeDisplay(ms);
            applyHistoryAtTime(ms, !seeking);
        },
        onPlayStateChange: playing => {
            document.getElementById('tl-play').textContent = playing ? '⏸' : '▶';
        },
    });

    document.getElementById('tl-play').addEventListener('click', () => timeline.togglePlay());
    document.getElementById('tl-rewind').addEventListener('click', () => timeline.seekToStart());
    document.getElementById('tl-ffwd').addEventListener('click', () => timeline.seekToEnd());
    const speedSel = document.getElementById('tl-speed');
    timeline.setSpeed(parseFloat(speedSel.value));
    speedSel.addEventListener('change', e => {
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
                case 'showInternal':
                    scene3d.setShowInternal(value);
                    // Force works to re-render at new positions (internal vs hub)
                    scene3d.clearWorks();
                    state.activeWorks.clear();
                    if (timeline && timeline.getCurrentTime() !== null) {
                        applyHistoryAtTime(timeline.getCurrentTime(), false);
                    }
                    break;
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

    // カメラリストのクリックハンドラー
    document.getElementById('camera-list').addEventListener('click', e => {
        const item = e.target.closest('.camera-item');
        if (!item) return;
        if (item.querySelector('.cam-dot.offline')) return; // オフライン中は無効
        openCameraPanel(item.dataset.camId, item.dataset.camName, item.dataset.camLocation);
    });

    setExecutionListClickHandler(async (execId, dsId) => {
        if (!dsId) return;
        state.liveDataSourceId = dsId;
        // await ensures locationMap is populated before replaying events
        await subscribeWebSocket(dsId);
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

        // Replay historical events so the 3D view shows the simulation final state
        try {
            const events = await API.fetchDataSourceEvents(
                dsId,
                new Date(0).toISOString(),
                new Date('2100-01-01').toISOString()
            );
            if (Array.isArray(events)) {
                // Store sorted item_movement events for timeline-driven replay
                state.historyEvents = events
                    .filter(ev => ev.table === 'item_movement')
                    .sort((a, b) => new Date(a.event_time) - new Date(b.event_time));

                // Recalibrate timeline to actual event timestamps (exec.startTime is server
                // creation time and may differ from the simulation's startDatetime base).
                if (state.historyEvents.length > 0) {
                    const firstMs = new Date(state.historyEvents[0].event_time).getTime();
                    const lastMs = new Date(state.historyEvents[state.historyEvents.length - 1].event_time).getTime();
                    timeline.setExecution({
                        startDatetime: new Date(firstMs).toISOString(),
                        simulationTime: Math.max(Math.ceil((lastMs - firstMs) / 1000), 60),
                    });
                }

                if (scene3d) scene3d.clearWorks();
                state.activeWorks.clear();
                for (const ev of events) {
                    handleWsEvent(ev);
                }
            }
        } catch (e) {
            console.warn('[execHistory] failed to replay historical events', e);
        }
        timeline.seekToEnd();
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
    document.getElementById('btn-refresh').addEventListener('click', async () => {
        if (state.currentFactory) await selectFactory(state.currentFactory);
    });
    const btnTop = document.getElementById('btn-top');
    let _topViewActive = false;
    btnTop.addEventListener('click', () => {
        if (!scene3d) return;
        if (_topViewActive) {
            scene3d.setPerspView();
            btnTop.classList.remove('active');
            btnTop.innerHTML = '↧ 2D';
            btnTop.title = '2Dトップビューに切り替え';
        } else {
            scene3d.setTopView();
            btnTop.classList.add('active');
            btnTop.innerHTML = '↥ 3D';
            btnTop.title = '3Dパースビューに切り替え';
        }
        _topViewActive = !_topViewActive;
    });
    const btnMultiPanel = document.getElementById('btn-multi-panel');
    btnMultiPanel.addEventListener('click', () => {
        multiWindowMode = !multiWindowMode;
        btnMultiPanel.classList.toggle('active', multiWindowMode);
        btnMultiPanel.title = multiWindowMode
            ? '複数ウインドウモード：オン（クリックで無効化）'
            : '複数ウインドウモード：オフ（クリックで有効化）';
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
        state.historyEvents = [];

        buildLocationMap();

        scene3d.loadFactory(state.stations, state.connections);
        renderG3DUnplacedList();

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
            throw new Error('シミュレーション失敗: ' + (exec.errorMessage || exec.status));
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
        // subscribeWebSocket also loads the layout (locationMap) before connecting WS
        await subscribeWebSocket(dataSourceId);

        // Replay historical events so the 3D view shows the final simulation state.
        // Simulation is already complete, so no live WS events will arrive — we must
        // load the full history from the events API.
        try {
            const events = await API.fetchDataSourceEvents(
                dataSourceId,
                new Date(0).toISOString(),
                new Date('2100-01-01').toISOString()
            );
            if (Array.isArray(events)) {
                state.historyEvents = events
                    .filter(ev => ev.table === 'item_movement')
                    .sort((a, b) => new Date(a.event_time) - new Date(b.event_time));

                // Recalibrate timeline to actual event timestamps in case the passed
                // startDatetime differs from the simulation base time in the DB.
                if (state.historyEvents.length > 0) {
                    const firstMs = new Date(state.historyEvents[0].event_time).getTime();
                    const lastMs = new Date(state.historyEvents[state.historyEvents.length - 1].event_time).getTime();
                    timeline.setExecution({
                        startDatetime: new Date(firstMs).toISOString(),
                        simulationTime: Math.max(Math.ceil((lastMs - firstMs) / 1000), 60),
                    });
                }

                for (const ev of events) {
                    handleWsEvent(ev);
                }
            }
        } catch (e) {
            console.warn('[loadExecutionResult] failed to load historical events:', e);
        }

        // Advance timeline to end so the 3D view matches the replayed final state.
        timeline.seekToEnd();

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

function openCameraPanel(camId, title, location) {
    // 同じカメラが既に開いていれば前面に出すだけ
    const existing = cameraPanels.find(p => p._camId === camId);
    if (existing) {
        existing._el.style.zIndex = ++_camZCounter;
        return;
    }
    const rect = document.getElementById('scene-container').getBoundingClientRect();
    const offset = cameraPanels.length * 28;
    const panel = new FloatingCameraPanel({
        camId,
        title,
        location,
        x: rect.left + 20 + offset,
        y: rect.top  + 20 + offset,
        onClose: () => {
            const idx = cameraPanels.indexOf(panel);
            if (idx >= 0) cameraPanels.splice(idx, 1);
        },
    });
    panel._el.style.zIndex = ++_camZCounter;
    panel._el.addEventListener('mousedown', () => {
        panel._el.style.zIndex = ++_camZCounter;
    });
    cameraPanels.push(panel);
}
let _camZCounter = 110;

function openInfoPanel(station, type) {
    const rows = buildInfoRows(station, type);
    const rect = document.getElementById('scene-container').getBoundingClientRect();

    if (multiWindowMode) {
        const offset = infoPanels.length * 24;
        const panel = new FloatingInfoPanel({
            title: station.name || station.stationId || 'Info',
            rows,
            x: rect.right - 300 - offset,
            y: rect.top + 60 + offset,
            onClose: () => {
                const idx = infoPanels.indexOf(panel);
                if (idx >= 0) infoPanels.splice(idx, 1);
            },
        });
        infoPanels.push(panel);
    } else {
        if (infoPanel) { infoPanel.close(); infoPanel = null; }
        infoPanel = new FloatingInfoPanel({
            title: station.name || station.stationId || 'Info',
            rows,
            x: rect.right - 300,
            y: rect.top + 60,
            onClose: () => { infoPanel = null; },
        });
    }
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

const INTERNAL_STATION_TYPES = ['processing', 'merge', 'split', 'switch'];

function renderGFIStations(container) {
    // Build a set of machine hub IDs (have at least one child station)
    const hubIds = new Set(
        state.stations.filter(s => s.parentId).map(s => s.parentId)
    );
    const rows = state.stations.map(s => {
        const isInternal = s.parentId && INTERNAL_STATION_TYPES.includes(s.stationType);
        const isHub = s.stationType === 'machine' && hubIds.has(s.stationId);
        const typeCell = isInternal
            ? `<select class="gfi-type-select gfi-table-input" data-sid="${esc(s.stationId)}" data-field="stationType">
                ${INTERNAL_STATION_TYPES.map(t => `<option value="${t}" ${s.stationType === t ? 'selected' : ''}>${t}</option>`).join('')}
               </select>`
            : `<span style="color:var(--text-muted)">${esc(s.stationType || '')}</span>${isHub ? ' <span style="font-size:10px;color:var(--status-normal);">[hub]</span>' : ''}`;
        return `<tr>
            <td style="font-family:monospace;font-size:11px;">${esc(s.stationId)}</td>
            <td><input type="text" value="${esc(s.name || '')}" class="gfi-table-input"
                data-sid="${esc(s.stationId)}" data-field="name"></td>
            <td>${typeCell}</td>
            <td style="text-align:center;">
                <button class="gfi-action-btn" data-action="del-st" data-sid="${esc(s.stationId)}">削除</button>
            </td>
        </tr>`;
    }).join('');
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
            const value = e.target.value;
            try {
                await API.updateStation(state.currentFactory, sid, { [field]: value });
                const st = state.stations.find(s => s.stationId === sid);
                if (st) st[field] = value;
                // Reload 3D scene so tetris block shapes update
                if (field === 'stationType' && scene3d) {
                    scene3d.loadFactory(state.stations, state.connections);
                }
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
    // Build hub set and parent lookup for role annotation
    const hubIds = new Set(state.stations.filter(s => s.parentId).map(s => s.parentId));
    const parentOf = new Map(state.stations.filter(s => s.parentId).map(s => [s.stationId, s.parentId]));
    const connRole = (c) => {
        const fromIsHub = hubIds.has(c.fromStation);
        const toIsHub = hubIds.has(c.toStation);
        if (fromIsHub && parentOf.get(c.toStation) === c.fromStation) return 'Entry';
        if (toIsHub && parentOf.get(c.fromStation) === c.toStation) return 'Exit';
        if (!fromIsHub && !toIsHub && parentOf.has(c.fromStation) && parentOf.has(c.toStation)
            && parentOf.get(c.fromStation) === parentOf.get(c.toStation)) return '内部';
        return '';
    };
    const rows = state.connections.map(c => {
        const cid = c.id || c.connectionId || '';
        const role = connRole(c);
        const roleHtml = role
            ? `<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:${role==='Entry'?'rgba(46,125,50,0.25)':role==='Exit'?'rgba(230,81,0,0.25)':'rgba(74,158,255,0.15)'};">${role}</span>`
            : '';
        return `<tr>
            <td style="font-family:monospace;font-size:11px;">${esc(String(cid))}</td>
            <td style="font-family:monospace;">${esc(c.fromStation)}</td>
            <td style="color:var(--text-muted)">→</td>
            <td style="font-family:monospace;">${esc(c.toStation)}</td>
            <td>${roleHtml}</td>
            <td>${esc(c.condition || 'default')}</td>
            <td style="text-align:center;">
                <button class="gfi-action-btn" data-action="del-conn" data-cid="${esc(String(cid))}">削除</button>
            </td>
        </tr>`;
    }).join('');
    container.innerHTML = `
        <div class="gfi-table-wrap">
            <table class="gfi-table">
                <thead><tr><th>ID</th><th>From</th><th></th><th>To</th><th>役割</th><th>条件</th><th>操作</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="7" style="color:var(--text-muted);padding:10px;">接続がありません</td></tr>'}</tbody>
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

function _equipNameOf(stationId) {
    const m = stationId.match(/^(.+?)[._-]?(\d{3})$/);
    return m ? m[1] : stationId;
}

function renderG3DUnplacedList() {
    const list = document.getElementById('g3d-unplaced-list');
    if (!list) return;

    const equipMap = new Map();
    (state.stations || []).filter(s => s.stationType === 'machine').forEach(s => {
        const equip = _equipNameOf(s.stationId);
        if (!equipMap.has(equip)) equipMap.set(equip, []);
        equipMap.get(equip).push(s);
    });

    const unplaced = [];
    equipMap.forEach((members, equipName) => {
        if (members.every(s => s.positionX == null)) unplaced.push({ equipName, members });
    });

    list.innerHTML = '';
    if (unplaced.length === 0) {
        const msg = document.createElement('div');
        msg.className = 'g3d-unplaced-empty';
        msg.textContent = (state.stations || []).length === 0 ? '工場を選択してください' : '全て配置済み';
        list.appendChild(msg);
        return;
    }

    unplaced.forEach(({ equipName, members }) => {
        const item = document.createElement('div');
        item.className = 'g3d-unplaced-item';
        item.textContent = equipName;
        item.title = `${equipName} (${members.length}台)  ドラッグまたはクリックで配置`;
        item.draggable = true;
        item.addEventListener('click', () => placeEquipmentFromSidebar(equipName, members));
        item.addEventListener('dragstart', e => {
            _dragEquipData = { equipName, members };
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', equipName);
            item.classList.add('dragging');
        });
        item.addEventListener('dragend', () => {
            _dragEquipData = null;
            item.classList.remove('dragging');
            document.getElementById('g3d-scene')?.classList.remove('drop-target');
        });
        list.appendChild(item);
    });
}

// 指定座標に設備を配置し、3D シーンを更新する共通コア
function _placeEquipAtPosition(equipName, members, cx, cz) {
    members.forEach(s => { s.positionX = cx; s.positionY = cz; });
    _movedEquipment.set(equipName, {
        centroid: { x: cx, z: cz },
        machines: members.map(s => ({ stationId: s.stationId, positionX: cx, positionY: cz })),
    });
    scene3d && scene3d.loadFactory(state.stations, state.connections);
    renderG3DUnplacedList();
    // 配置モードを起動して保存ボタンを表示
    if (!scene3d?._placementMode) {
        scene3d && scene3d.setPlacementMode(true);
        document.querySelectorAll('.g3d-sidebar-item').forEach(i => i.classList.remove('active'));
        const placementItem = document.querySelector('.g3d-sidebar-item[data-group="placement"]');
        if (placementItem) placementItem.classList.add('active');
        openG3DFloating('placement');
    } else {
        const floatEl = document.getElementById('g3d-floating');
        if (floatEl && !floatEl.classList.contains('hidden')) openG3DFloating('placement');
    }
}

// クリック配置: カメラ注視点付近の空き位置に自動配置
function placeEquipmentFromSidebar(equipName, members) {
    const target = scene3d ? scene3d.controls.target : { x: 0, z: 0 };
    const SPACING = 300;

    const occupiedCentroids = [];
    const existMap = new Map();
    (state.stations || []).filter(s => s.stationType === 'machine' && s.positionX != null).forEach(s => {
        const en = _equipNameOf(s.stationId);
        if (!existMap.has(en)) existMap.set(en, []);
        existMap.get(en).push(s);
    });
    existMap.forEach(ms => {
        occupiedCentroids.push({
            x: ms.reduce((a, s) => a + s.positionX, 0) / ms.length,
            z: ms.reduce((a, s) => a + s.positionY, 0) / ms.length,
        });
    });
    _movedEquipment.forEach(({ centroid }) => occupiedCentroids.push(centroid));

    let cx = target.x, cz = target.z;
    for (let attempt = 0; attempt < 30; attempt++) {
        if (!occupiedCentroids.some(p => Math.abs(p.x - cx) < SPACING && Math.abs(p.z - cz) < SPACING)) break;
        cx += SPACING;
        if (attempt % 5 === 4) { cx = target.x; cz += SPACING; }
    }
    _placeEquipAtPosition(equipName, members, cx, cz);
}

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

    setupG3DDragDrop();
}

function setupG3DDragDrop() {
    const sceneEl = document.getElementById('g3d-scene');
    if (!sceneEl) return;

    sceneEl.addEventListener('dragover', e => {
        if (!_dragEquipData) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        sceneEl.classList.add('drop-target');
    });

    sceneEl.addEventListener('dragleave', e => {
        // relatedTarget が sceneEl の外に出た時のみ解除
        if (!sceneEl.contains(e.relatedTarget)) {
            sceneEl.classList.remove('drop-target');
        }
    });

    sceneEl.addEventListener('drop', e => {
        e.preventDefault();
        sceneEl.classList.remove('drop-target');
        if (!_dragEquipData || !scene3d) { _dragEquipData = null; return; }

        const { equipName, members } = _dragEquipData;
        _dragEquipData = null;

        // ドロップ座標を地面ワールド座標に変換
        const pos = scene3d.getGroundPositionAtScreen(e.clientX, e.clientY);
        if (pos) {
            _placeEquipAtPosition(equipName, members, pos.x, pos.z);
        } else {
            // レイキャスト失敗時はクリック配置と同じ自動位置
            placeEquipmentFromSidebar(equipName, members);
        }
    });
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
const GLE_NODE_H = 80;
const GLE_NODE_R = 36;
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
            if (_gleConnectFrom) gleSetNodeHighlight(_gleConnectFrom.equipName || _gleConnectFrom, false);
            _gleConnectFrom = null;
            _gleSelectedNode = null;
            gleUpdateHint();
            gleUpdateNodeStyles();
        });
    });

    // New machine button
    const _openNewMachineModal = () => {
        if (!state.currentFactory) { alert('工場を選択してください'); return; }
        const modal = document.getElementById('new-machine-modal');
        modal.classList.remove('hidden');
        document.getElementById('new-machine-name').value = '';
        document.getElementById('new-machine-sid').value = '';
        document.getElementById('new-machine-type').value = 'machine';
        document.getElementById('new-machine-name').focus();
    };
    document.getElementById('btn-gle-add-machine').addEventListener('click', _openNewMachineModal);
    document.getElementById('btn-g3d-add-machine').addEventListener('click', _openNewMachineModal);

    // Auto-layout button: reset all positions and re-apply grid layout
    document.getElementById('btn-gle-auto-layout').addEventListener('click', () => {
        if (!state.currentFactory) return;
        _gleNodePositions = {};
        const equips = _gleEquips();
        gleAutoLayout(equips);
        gleSavePositions();
        renderGlobalLogicGraph();
    });
    document.getElementById('new-machine-modal-close').addEventListener('click', () =>
        document.getElementById('new-machine-modal').classList.add('hidden'));
    document.getElementById('new-machine-cancel').addEventListener('click', () =>
        document.getElementById('new-machine-modal').classList.add('hidden'));
    document.getElementById('new-machine-ok').addEventListener('click', gleAddMachine);
    document.getElementById('new-machine-name').addEventListener('input', e => {
        document.getElementById('new-machine-sid').value = gleGenerateStationId(e.target.value);
    });
    document.getElementById('new-machine-name').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('new-machine-sid').focus();
    });
    document.getElementById('new-machine-sid').addEventListener('keydown', e => {
        if (e.key === 'Enter') gleAddMachine();
    });

    setupGleDragDrop();
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

// entry/exitポートをマシン設備のconfig.equipmentLayout.membersから抽出する
function _gleExtractPorts(machineStation) {
    const layout = machineStation?.config?.equipmentLayout;
    const exitPorts = [];
    const entryPorts = [];
    if (layout && Array.isArray(layout.members)) {
        layout.members.forEach(child => {
            const portObj = {
                stationId: child.stationId,
                stationType: child.stationType,
                name: child.name || child.stationType,
                parentId: machineStation.stationId,
            };
            if (child.stationType === 'exit')  exitPorts.push(portObj);
            else if (child.stationType === 'entry') entryPorts.push(portObj);
        });
    }
    return { exitPorts, entryPorts };
}

function _gleEquips() {
    const equipMap = new Map();
    state.stations
        .filter(s => s.stationType === 'machine' || s.stationType === 'source' || s.stationType === 'drain')
        .forEach(s => {
            const en = _equipNameOf(s.stationId);
            if (!equipMap.has(en)) equipMap.set(en, []);
            equipMap.get(en).push(s);
        });
    const equips = [];
    equipMap.forEach((members, equipName) => {
        const rep = members.find(m => m.stationId === `${equipName}.000`) || members[0];
        // entry/exitポートはconfig.equipmentLayout.membersに埋め込まれているため
        // state.stationsではなくマシン設備のconfigから抽出する
        const exitPorts = [];
        const entryPorts = [];
        members.forEach(m => {
            const { exitPorts: ep, entryPorts: np } = _gleExtractPorts(m);
            exitPorts.push(...ep);
            entryPorts.push(...np);
        });
        equips.push({ equipName, members, rep, exitPorts, entryPorts });
    });
    return equips;
}

function _gleStationToEquip() {
    const map = new Map();
    // top-level equipment stations
    state.stations
        .filter(s => s.stationType === 'machine' || s.stationType === 'source' || s.stationType === 'drain')
        .forEach(s => map.set(s.stationId, _equipNameOf(s.stationId)));
    // entry/exit port stations → config.equipmentLayout.membersから抽出してマッピング
    state.stations
        .filter(s => s.stationType === 'machine')
        .forEach(m => {
            const equipName = _equipNameOf(m.stationId);
            const { exitPorts, entryPorts } = _gleExtractPorts(m);
            [...exitPorts, ...entryPorts].forEach(p => map.set(p.stationId, equipName));
        });
    return map;
}

// ポートの SVG 内位置を計算する
// returns Map<portStationId, {relX, relY, absX, absY}>
function _gleCalcPortPositions(equips, stationToEquip) {
    const portPos = new Map();
    const cx = GLE_NODE_W / 2;
    const cy = GLE_NODE_H / 2;

    equips.forEach(equip => {
        const { equipName, exitPorts, entryPorts, members } = equip;
        const pos = _gleNodePositions[equipName];
        if (!pos) return;
        const absCx = pos.x + cx;
        const absCy = pos.y + cy;
        const memberIds = new Set(members.map(m => m.stationId));

        // ポート stationId で接続を探し、なければメンバー機器IDでフォールバック
        const calcAngle = (portSid, portType, defaultAngle) => {
            // 1st: ポートIDで直接検索（ポートIDで接続が作られた場合）
            let conn = state.connections.find(c => c.fromStation === portSid || c.toStation === portSid);

            // 2nd: メンバー機器IDで検索（機器IDで接続が作られた場合）
            if (!conn) {
                if (portType === 'exit') {
                    conn = state.connections.find(c => memberIds.has(c.fromStation) && !memberIds.has(c.toStation));
                } else {
                    conn = state.connections.find(c => !memberIds.has(c.fromStation) && memberIds.has(c.toStation));
                }
            }

            if (conn) {
                const fromEquip = stationToEquip.get(conn.fromStation);
                const toEquip   = stationToEquip.get(conn.toStation);
                const otherEquip = fromEquip === equipName ? toEquip : fromEquip;
                const otherPos = otherEquip && _gleNodePositions[otherEquip];
                if (otherPos) {
                    return Math.atan2((otherPos.y + cy) - absCy, (otherPos.x + cx) - absCx);
                }
            }
            return defaultAngle;
        };

        const spread = Math.PI / 3; // 60° の範囲に分散
        exitPorts.forEach((port, i) => {
            const base = 0; // 右側
            const def = exitPorts.length === 1 ? base
                : base + (i / (exitPorts.length - 1) - 0.5) * spread;
            const angle = calcAngle(port.stationId, 'exit', def);
            portPos.set(port.stationId, {
                relX: cx + GLE_NODE_R * Math.cos(angle),
                relY: cy + GLE_NODE_R * Math.sin(angle),
                absX: absCx + GLE_NODE_R * Math.cos(angle),
                absY: absCy + GLE_NODE_R * Math.sin(angle),
            });
        });

        entryPorts.forEach((port, i) => {
            const base = Math.PI; // 左側
            const def = entryPorts.length === 1 ? base
                : base + (i / (entryPorts.length - 1) - 0.5) * spread;
            const angle = calcAngle(port.stationId, 'entry', def);
            portPos.set(port.stationId, {
                relX: cx + GLE_NODE_R * Math.cos(angle),
                relY: cy + GLE_NODE_R * Math.sin(angle),
                absX: absCx + GLE_NODE_R * Math.cos(angle),
                absY: absCy + GLE_NODE_R * Math.sin(angle),
            });
        });
    });
    return portPos;
}

function gleAutoLayout(equips) {
    const cols = Math.ceil(Math.sqrt(equips.length)) || 1;
    equips.forEach((e, i) => {
        if (!_gleNodePositions[e.equipName]) {
            _gleNodePositions[e.equipName] = {
                x: 60 + (i % cols) * (GLE_NODE_W + 60),
                y: 60 + Math.floor(i / cols) * (GLE_NODE_H + 60),
            };
        }
    });
}

function renderGlobalLogicGraph() {
    gleLoadPositions();
    const equips = _gleEquips();

    // Auto-layout on first render (no saved positions for this factory)
    const hasAnyPlaced = equips.some(e => _gleNodePositions[e.equipName]);
    if (!hasAnyPlaced && equips.length > 0) {
        gleAutoLayout(equips);
        gleSavePositions();
    }

    renderGleUnplacedList(equips);

    const connLayer = document.getElementById('gle-conn-layer');
    const nodeLayer = document.getElementById('gle-node-layer');
    connLayer.innerHTML = '';
    nodeLayer.innerHTML = '';

    const stationToEquip = _gleStationToEquip();
    const placedEquips = new Set(equips.filter(e => _gleNodePositions[e.equipName]).map(e => e.equipName));
    const portPositions = _gleCalcPortPositions(equips, stationToEquip);

    // 接続を1本ずつ描画（ポートレベルで重複排除）
    const drawnKeys = new Set();
    state.connections.forEach(c => {
        const fromEquip = stationToEquip.get(c.fromStation);
        const toEquip   = stationToEquip.get(c.toStation);
        if (!fromEquip || !toEquip || fromEquip === toEquip) return;
        if (!placedEquips.has(fromEquip) || !placedEquips.has(toEquip)) return;
        const key = `${c.fromStation}→${c.toStation}`;
        if (drawnKeys.has(key)) return;
        drawnKeys.add(key);
        gleDrawConnection(c, connLayer, portPositions, stationToEquip);
    });

    equips.filter(e => _gleNodePositions[e.equipName])
          .forEach(e => gleDrawNode(e, nodeLayer, portPositions));
}

function renderGleUnplacedList(equips) {
    const listEl = document.getElementById('gle-machine-list');
    if (!listEl) return;

    if (!state.currentFactory) {
        listEl.innerHTML = '<div class="empty-hint">工場を選択してください</div>';
        return;
    }

    const unplaced = equips.filter(e => !_gleNodePositions[e.equipName]);

    listEl.innerHTML = '';
    if (unplaced.length === 0) {
        const msg = document.createElement('div');
        msg.className = 'empty-hint';
        msg.style.fontSize = '11px';
        msg.style.padding = '6px 12px';
        msg.textContent = equips.length === 0 ? '設備がありません' : '全て配置済み';
        listEl.appendChild(msg);
        return;
    }

    unplaced.forEach(({ equipName, members, rep }) => {
        const item = document.createElement('div');
        item.className = 'gle-machine-item';
        const displayName = rep?.name || equipName;
        const typeLabel = rep?.stationType || 'machine';
        item.textContent = displayName;
        item.title = `${displayName} [${typeLabel}]  ドラッグまたはクリックで配置`;
        item.draggable = true;
        item.addEventListener('click', () => gleAddEquipmentToCanvas(equipName, members));
        item.addEventListener('dragstart', e => {
            _dragGleData = { equipName, members };
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', equipName);
            item.classList.add('dragging');
        });
        item.addEventListener('dragend', () => {
            _dragGleData = null;
            item.classList.remove('dragging');
            document.getElementById('gle-canvas-wrap')?.classList.remove('drop-target');
        });
        listEl.appendChild(item);
    });
}

// クリック配置: 既存ノードの下に自動配置
function gleAddEquipmentToCanvas(equipName, members) {
    const existing = Object.values(_gleNodePositions);
    const SPACING_Y = GLE_NODE_H + 60;
    let startX = 60;
    let startY = 60;
    if (existing.length > 0) {
        startY = Math.max(...existing.map(p => p.y)) + SPACING_Y;
    }
    _gleNodePositions[equipName] = { x: startX, y: startY };
    gleSavePositions();
    renderGlobalLogicGraph();
}

// ドロップ配置: 指定 SVG 座標に配置
function gleAddEquipmentAtPosition(equipName, members, svgX, svgY) {
    _gleNodePositions[equipName] = {
        x: Math.max(0, svgX - GLE_NODE_W / 2),
        y: Math.max(0, svgY - GLE_NODE_H / 2),
    };
    gleSavePositions();
    renderGlobalLogicGraph();
}

function setupGleDragDrop() {
    const wrap = document.getElementById('gle-canvas-wrap');
    if (!wrap) return;

    wrap.addEventListener('dragover', e => {
        if (!_dragGleData) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        wrap.classList.add('drop-target');
    });

    wrap.addEventListener('dragleave', e => {
        if (!wrap.contains(e.relatedTarget)) {
            wrap.classList.remove('drop-target');
        }
    });

    wrap.addEventListener('drop', e => {
        e.preventDefault();
        wrap.classList.remove('drop-target');
        if (!_dragGleData) return;

        const { equipName, members } = _dragGleData;
        _dragGleData = null;

        // ドロップ座標をSVG座標に変換（スクロールオフセット考慮）
        const wrapRect = wrap.getBoundingClientRect();
        const svgX = e.clientX - wrapRect.left + wrap.scrollLeft;
        const svgY = e.clientY - wrapRect.top  + wrap.scrollTop;

        gleAddEquipmentAtPosition(equipName, members, svgX, svgY);
    });
}

const GLE_PORT_R = 6;
const GLE_PORT_EXIT_COLOR  = '#28a745';
const GLE_PORT_ENTRY_COLOR = '#e67e22';

function gleDrawNode(equip, layer, portPositions) {
    const { equipName, rep, exitPorts, entryPorts } = equip;
    const pos = _gleNodePositions[equipName] || { x: 60, y: 60 };
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'gle-node');
    g.setAttribute('data-eid', equipName);
    g.setAttribute('transform', `translate(${pos.x},${pos.y})`);

    const GLE_TYPE_COLORS = { source: '#28a745', drain: '#6c757d', machine: '#4a9eff' };
    const typeColor = GLE_TYPE_COLORS[rep?.stationType] || '#4a9eff';

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', GLE_NODE_W / 2);
    circle.setAttribute('cy', GLE_NODE_H / 2);
    circle.setAttribute('r', GLE_NODE_R);
    circle.setAttribute('fill', 'var(--bg-panel)');
    circle.setAttribute('stroke', typeColor);
    circle.setAttribute('stroke-width', '2');
    circle.style.cursor = 'pointer';

    const name = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    name.setAttribute('x', GLE_NODE_W / 2);
    name.setAttribute('y', GLE_NODE_H / 2 - 5);
    name.setAttribute('text-anchor', 'middle');
    name.setAttribute('dominant-baseline', 'middle');
    name.setAttribute('fill', 'var(--text-primary)');
    name.setAttribute('font-size', '12');
    name.setAttribute('font-family', 'inherit');
    name.textContent = rep?.name || equipName;

    const sub = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    sub.setAttribute('x', GLE_NODE_W / 2);
    sub.setAttribute('y', GLE_NODE_H / 2 + 12);
    sub.setAttribute('text-anchor', 'middle');
    sub.setAttribute('dominant-baseline', 'middle');
    sub.setAttribute('fill', typeColor);
    sub.setAttribute('font-size', '10');
    sub.setAttribute('font-family', 'inherit');
    sub.textContent = rep?.stationType || 'machine';

    g.appendChild(circle);
    g.appendChild(name);
    g.appendChild(sub);

    // ポート円を描画（設備円の上に重ねるため後から追加）
    [...exitPorts, ...entryPorts].forEach(port => {
        const pp = portPositions?.get(port.stationId);
        if (!pp) return;
        const isExit = port.stationType === 'exit';
        const pc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        pc.setAttribute('cx', pp.relX);
        pc.setAttribute('cy', pp.relY);
        pc.setAttribute('r', GLE_PORT_R);
        pc.setAttribute('fill', isExit ? GLE_PORT_EXIT_COLOR : GLE_PORT_ENTRY_COLOR);
        pc.setAttribute('stroke', 'var(--bg-panel)');
        pc.setAttribute('stroke-width', '1.5');
        pc.setAttribute('data-port-id', port.stationId);
        pc.style.cursor = 'pointer';
        pc.addEventListener('click', e => {
            e.stopPropagation();
            if (_gleCurrentTool === 'connect') gleHandleConnectInteraction(port.stationId, equipName);
        });
        pc.addEventListener('mouseenter', () => pc.setAttribute('stroke', 'var(--accent-blue)'));
        pc.addEventListener('mouseleave', () => pc.setAttribute('stroke', 'var(--bg-panel)'));
        g.appendChild(pc);
    });

    layer.appendChild(g);
    gleAttachNodeEvents(g, equip);
}

function gleDrawConnection(conn, layer, portPositions, stationToEquip) {
    const fromEquip = stationToEquip.get(conn.fromStation);
    const toEquip   = stationToEquip.get(conn.toStation);
    if (!fromEquip || !toEquip || fromEquip === toEquip) return;

    const fromEquipPos = _gleNodePositions[fromEquip];
    const toEquipPos   = _gleNodePositions[toEquip];
    if (!fromEquipPos || !toEquipPos) return;

    const fromPort = portPositions?.get(conn.fromStation);
    const toPort   = portPositions?.get(conn.toStation);

    let x1, y1, x2, y2;
    if (fromPort && toPort) {
        // ポート間接続: ポートの絶対座標を使用
        x1 = fromPort.absX; y1 = fromPort.absY;
        x2 = toPort.absX;   y2 = toPort.absY;
    } else {
        // フォールバック: 設備円周上の交点
        const fcx = fromEquipPos.x + GLE_NODE_W / 2;
        const fcy = fromEquipPos.y + GLE_NODE_H / 2;
        const tcx = toEquipPos.x  + GLE_NODE_W / 2;
        const tcy = toEquipPos.y  + GLE_NODE_H / 2;
        const dx = tcx - fcx, dy = tcy - fcy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < GLE_NODE_R * 2) return;
        const nx = dx / dist, ny = dy / dist;
        x1 = fcx + nx * GLE_NODE_R; y1 = fcy + ny * GLE_NODE_R;
        x2 = tcx - nx * GLE_NODE_R; y2 = tcy - ny * GLE_NODE_R;
    }

    const d = `M ${x1},${y1} L ${x2},${y2}`;

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

    const fromSid = conn.fromStation;
    const toSid   = conn.toStation;
    hit.addEventListener('click', () => gleHandleConnClick(fromSid, toSid));
    hit.addEventListener('mouseenter', () => { path.setAttribute('opacity', '1'); path.setAttribute('stroke-width', '3'); });
    hit.addEventListener('mouseleave', () => { path.setAttribute('opacity', '0.75'); path.setAttribute('stroke-width', '2'); });

    layer.appendChild(path);
    layer.appendChild(hit);
}

function gleAttachNodeEvents(g, equip) {
    const { equipName, rep } = equip;
    const repSid = rep?.stationId || equipName;
    let dragActive = false, startX = 0, startY = 0, origX = 0, origY = 0;

    g.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        // ポート円クリックは stopPropagation されるので、ここに来るのは設備円本体
        if (_gleCurrentTool === 'select') {
            dragActive = true;
            startX = e.clientX;
            startY = e.clientY;
            const pos = _gleNodePositions[equipName] || { x: 0, y: 0 };
            origX = pos.x;
            origY = pos.y;
            e.preventDefault();
        } else if (_gleCurrentTool === 'connect') {
            gleHandleConnectInteraction(repSid, equipName);
            e.preventDefault();
        }
    });

    document.addEventListener('mousemove', e => {
        if (!dragActive) return;
        const newX = Math.max(0, origX + e.clientX - startX);
        const newY = Math.max(0, origY + e.clientY - startY);
        _gleNodePositions[equipName] = { x: newX, y: newY };
        g.setAttribute('transform', `translate(${newX},${newY})`);
        gleRedrawConnections();
    });

    document.addEventListener('mouseup', () => {
        if (dragActive) {
            dragActive = false;
            gleSavePositions();
            gleRedrawConnections();
        }
    });

    g.addEventListener('dblclick', e => {
        e.stopPropagation();
        openLocalWindow(repSid);
    });

    // 設備本体の円のみホバー（ポート円は自前のイベントを持つ）
    const mainCircle = g.querySelector('circle:not([data-port-id])');
    if (mainCircle) {
        mainCircle.addEventListener('mouseenter', () => mainCircle.setAttribute('stroke', 'var(--accent-blue)'));
        mainCircle.addEventListener('mouseleave', () => {
            if (_gleSelectedNode !== equipName) {
                const GLE_TYPE_COLORS = { source: '#28a745', drain: '#6c757d', machine: '#4a9eff' };
                mainCircle.setAttribute('stroke', GLE_TYPE_COLORS[rep?.stationType] || '#4a9eff');
            }
        });
    }
}

function gleRedrawConnections() {
    const connLayer = document.getElementById('gle-conn-layer');
    connLayer.innerHTML = '';
    const equips = _gleEquips();
    const stationToEquip = _gleStationToEquip();
    const portPositions = _gleCalcPortPositions(equips, stationToEquip);

    const drawnKeys = new Set();
    state.connections.forEach(c => {
        const fromEquip = stationToEquip.get(c.fromStation);
        const toEquip   = stationToEquip.get(c.toStation);
        if (!fromEquip || !toEquip || fromEquip === toEquip) return;
        if (!_gleNodePositions[fromEquip] || !_gleNodePositions[toEquip]) return;
        const key = `${c.fromStation}→${c.toStation}`;
        if (drawnKeys.has(key)) return;
        drawnKeys.add(key);
        gleDrawConnection(c, connLayer, portPositions, stationToEquip);
    });

    // ドラッグ中もポート位置を更新
    _gleUpdatePortPositions(equips, portPositions);
}

function _gleUpdatePortPositions(equips, portPositions) {
    equips.forEach(equip => {
        const nodeG = document.querySelector(`#gle-node-layer .gle-node[data-eid="${equip.equipName}"]`);
        if (!nodeG) return;
        [...equip.exitPorts, ...equip.entryPorts].forEach(port => {
            const pp = portPositions.get(port.stationId);
            if (!pp) return;
            const el = nodeG.querySelector(`circle[data-port-id="${port.stationId}"]`);
            if (el) { el.setAttribute('cx', pp.relX); el.setAttribute('cy', pp.relY); }
        });
    });
}

// 接続モードの統合ハンドラ（設備円クリック・ポート円クリック共用）
async function gleHandleConnectInteraction(sid, equipName) {
    if (!_gleConnectFrom) {
        _gleConnectFrom = { sid, equipName };
        gleSetNodeHighlight(equipName, true);
        document.getElementById('gle-hint').textContent = `"${equipName}" から接続先を選択してください`;
    } else {
        if (_gleConnectFrom.sid === sid || _gleConnectFrom.equipName === equipName) {
            const fromEquip = _gleConnectFrom.equipName;
            _gleConnectFrom = null;
            gleSetNodeHighlight(fromEquip, false);
            gleUpdateHint();
            return;
        }
        const from = _gleConnectFrom;
        _gleConnectFrom = null;
        gleSetNodeHighlight(from.equipName, false);

        // 設備レベルで接続元 stationId を解決（ポートでなければ rep.000 を使用）
        const resolveRepSid = (sid, en) => {
            // entry/exitポートはconfig.equipmentLayout.membersに埋め込まれているため確認
            const machineMembers = state.stations.filter(s => _equipNameOf(s.stationId) === en && s.stationType === 'machine');
            for (const m of machineMembers) {
                const { exitPorts, entryPorts } = _gleExtractPorts(m);
                if ([...exitPorts, ...entryPorts].some(p => p.stationId === sid)) return sid;
            }
            const members = state.stations.filter(s => _equipNameOf(s.stationId) === en);
            return members.find(m => m.stationId === `${en}.000`)?.stationId || members[0]?.stationId || sid;
        };
        const fromSid = resolveRepSid(from.sid, from.equipName);
        const toSid   = resolveRepSid(sid, equipName);

        // 同一ポートペアの重複チェック
        if (state.connections.some(c => c.fromStation === fromSid && c.toStation === toSid)) {
            gleUpdateHint();
            return;
        }

        try {
            const conn = await API.createConnection(state.currentFactory, fromSid, toSid);
            state.connections.push(conn);
            renderGlobalLogicGraph();
        } catch (err) {
            setStatus('接続作成失敗: ' + err.message, 'status-error');
        }
        gleUpdateHint();
    }
}

async function gleHandleConnClick(fromStation, toStation) {
    if (_gleCurrentTool !== 'delete') return;
    if (!confirm('この接続を削除しますか？')) return;
    const c = state.connections.find(conn => conn.fromStation === fromStation && conn.toStation === toStation);
    if (!c) return;
    try {
        await API.deleteConnection(state.currentFactory, String(c.id || c.connectionId || ''));
        state.connections = state.connections.filter(conn => !(conn.fromStation === fromStation && conn.toStation === toStation));
        renderGlobalLogicGraph();
    } catch (err) {
        setStatus('接続削除失敗: ' + err.message, 'status-error');
    }
}

function gleSetNodeHighlight(equipName, on) {
    const g = document.querySelector(`#gle-node-layer .gle-node[data-eid="${equipName}"]`);
    if (!g) return;
    const circle = g.querySelector('circle');
    if (!circle) return;
    if (on) {
        circle.setAttribute('stroke', 'var(--accent-blue)');
    } else {
        const equip = _gleEquips().find(e => e.equipName === equipName);
        const GLE_TYPE_COLORS = { source: '#28a745', drain: '#6c757d', machine: '#4a9eff' };
        circle.setAttribute('stroke', GLE_TYPE_COLORS[equip?.rep?.stationType] || '#4a9eff');
    }
}

function gleUpdateNodeStyles() {
    document.querySelectorAll('#gle-node-layer .gle-node').forEach(g => {
        const eid = g.dataset.eid;
        const equip = _gleEquips().find(e => e.equipName === eid);
        const GLE_TYPE_COLORS = { source: '#28a745', drain: '#6c757d', machine: '#4a9eff' };
        const color = GLE_TYPE_COLORS[equip?.rep?.stationType] || '#4a9eff';
        const circle = g.querySelector('circle');
        if (circle) circle.setAttribute('stroke', color);
    });
}

function gleScrollToNode(equipName) {
    const pos = _gleNodePositions[equipName];
    if (!pos) return;
    const wrap = document.getElementById('gle-canvas-wrap');
    wrap.scrollLeft = Math.max(0, pos.x - wrap.clientWidth / 2 + GLE_NODE_W / 2);
    wrap.scrollTop  = Math.max(0, pos.y - wrap.clientHeight / 2 + GLE_NODE_H / 2);
}

function gleGenerateStationId(name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'machine';
    return `${base}.000`;
}

async function gleAddMachine() {
    const nameInput = document.getElementById('new-machine-name');
    const sidInput  = document.getElementById('new-machine-sid');
    const typeSelect = document.getElementById('new-machine-type');
    const name = nameInput.value.trim();
    const sid  = sidInput ? sidInput.value.trim() : '';
    const stationType = typeSelect ? typeSelect.value : 'machine';
    if (!name) { nameInput.focus(); return; }
    if (!sid) { sidInput && sidInput.focus(); return; }

    // 設備名の重複チェック
    const newEquipName = _equipNameOf(sid);
    const duplicate = (state.stations || []).some(s => _equipNameOf(s.stationId) === newEquipName);
    if (duplicate) {
        alert(`設備名 "${newEquipName}" は既に存在します。別の名前を使用してください。`);
        nameInput.focus();
        return;
    }

    document.getElementById('new-machine-modal').classList.add('hidden');
    try {
        await API.createStation(state.currentFactory, {
            stationId:   sid,
            name,
            stationType,
        });
        // Reload stations from server (API returns only {status:"created"})
        const stations = await API.fetchFactoryStations(state.currentFactory);
        state.stations = Array.isArray(stations) ? stations : state.stations;
        scene3d && scene3d.loadFactory(state.stations, state.connections);
        renderObjectList(state.stations, state.activeWorks, state.activeFilters);
        renderG3DUnplacedList();
        renderGlobalLogicGraph();
        setStatus('設備を追加しました', 'status-ok');
    } catch (err) {
        setStatus('設備追加失敗: ' + err.message, 'status-error');
    }
}
