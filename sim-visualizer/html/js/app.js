// Main application logic
import { fetchSimulation, fetchScenario, fetchLogs } from './api.js';
import { Visualizer3D } from './visualizer.js';
import { ModulerModal } from './moduler-modal.js';

let MouseConfig, MouseConfigModal, injectMouseConfigCSS;
try {
    const mod = await import('../shared/js/mouse-config.js');
    MouseConfig = mod.MouseConfig;
    MouseConfigModal = mod.MouseConfigModal;
    injectMouseConfigCSS = mod.injectMouseConfigCSS;
} catch (e) {
    console.warn('[App] mouse-config.js not available, using defaults:', e.message);
}

class App {
    constructor() {
        this.visualizer = null;
        this.logs = null;
        this.currentTime = 0;
        this.maxTime = 0;
        this.isPlaying = false;
        this.speed = 1.0;
        this.lastFrameTime = 0;
        this.mouseConfig = MouseConfig ? new MouseConfig('viewer') : null;
        this._mouseConfigModal = (MouseConfigModal && this.mouseConfig) ? new MouseConfigModal(this.mouseConfig) : null;
        if (injectMouseConfigCSS) injectMouseConfigCSS();

        this.flatScenario = null;
        this.modulerMap = new Map();   // internal stationID → direct parent moduler ID
        this.openModals = [];          // ModulerModal[]
        this._rawActiveWorks = new Map();
        this._rawSignalStates = new Map();

        this._buildMenuBar();
        this._init();
    }

    _buildMenuBar() {
        const container = document.getElementById('menubar');
        container.innerHTML = '';

        const left = document.createElement('div');
        left.className = 'menubar-left';

        const menus = [
            {
                label: '表示', items: [
                    { label: 'ステーション名表示', toggle: () => document.getElementById('show-station-names')?.checked, action: () => { const cb = document.getElementById('show-station-names'); if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); } } },
                    { label: 'ワークID表示', toggle: () => document.getElementById('show-work-ids')?.checked, action: () => { const cb = document.getElementById('show-work-ids'); if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); } } },
                    { label: 'インターロック表示', toggle: () => document.getElementById('show-interlocks')?.checked, action: () => { const cb = document.getElementById('show-interlocks'); if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); } } },
                ]
            },
            {
                label: '設定', items: [
                    { label: 'マウス操作設定', action: () => { if (this._mouseConfigModal) this._mouseConfigModal.open(); else alert('マウス操作設定モジュールが読み込まれていません'); } },
                ]
            },
        ];

        let openMenu = null;

        const closeAll = () => {
            container.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open'));
            openMenu = null;
        };

        menus.forEach(menuDef => {
            const item = document.createElement('div');
            item.className = 'menu-item';

            const label = document.createElement('span');
            label.className = 'menu-label';
            label.textContent = menuDef.label;
            item.appendChild(label);

            const dropdown = document.createElement('div');
            dropdown.className = 'menu-dropdown';
            item.appendChild(dropdown);

            const renderDropdown = () => {
                dropdown.innerHTML = '';
                menuDef.items.forEach(itemDef => {
                    if (itemDef.type === 'separator') {
                        const sep = document.createElement('div');
                        sep.className = 'menu-separator';
                        dropdown.appendChild(sep);
                        return;
                    }
                    const btn = document.createElement('button');
                    btn.className = 'menu-dropdown-item';
                    if (itemDef.toggle && itemDef.toggle()) btn.classList.add('active');

                    const labelSpan = document.createElement('span');
                    labelSpan.textContent = itemDef.label;
                    btn.appendChild(labelSpan);

                    if (itemDef.toggle) {
                        const indicator = document.createElement('span');
                        indicator.className = 'toggle-indicator';
                        btn.appendChild(indicator);
                    }

                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        itemDef.action();
                        closeAll();
                    });
                    dropdown.appendChild(btn);
                });
            };

            label.addEventListener('click', (e) => {
                e.stopPropagation();
                if (openMenu === item) {
                    closeAll();
                } else {
                    closeAll();
                    item.classList.add('open');
                    openMenu = item;
                    renderDropdown();
                }
            });

            label.addEventListener('mouseenter', () => {
                if (openMenu && openMenu !== item) {
                    closeAll();
                    item.classList.add('open');
                    openMenu = item;
                    renderDropdown();
                }
            });

            left.appendChild(item);
        });

        container.appendChild(left);

        const right = document.createElement('div');
        right.className = 'menubar-right';
        const simInfo = document.createElement('span');
        simInfo.id = 'sim-info';
        right.appendChild(simInfo);
        container.appendChild(right);

        document.addEventListener('click', () => closeAll());
    }

    async _init() {
        const params = new URLSearchParams(window.location.search);
        const simId = params.get('sim');

        if (!simId) {
            await this._showSimulationList();
            return;
        }

        try {
            document.getElementById('container-3d').innerHTML = '<div class="loading">Loading...</div>';

            const simulation = await fetchSimulation(simId);
            const scenario = await fetchScenario(simulation.scenarioId);
            this.logs = await fetchLogs(simId);

            document.getElementById('sim-info').textContent =
                `${simulation.friendlyName || simulation.simulationId}`;

            this.maxTime = this._calculateMaxTime();
            document.getElementById('timeline-slider').max = this.maxTime;

            const container = document.getElementById('container-3d');
            container.innerHTML = '';
            this.visualizer = new Visualizer3D(container, this.mouseConfig);

            this.flatScenario = this._flattenScenario(scenario);
            this._buildModulerMap(this.flatScenario);

            const layer1Scenario = this._buildLayer1Scenario(this.flatScenario);
            this.visualizer.loadScenario(layer1Scenario);

            this.visualizer.setOnWorkClick((workId) => this._showWorkModal(workId));
            this.visualizer.setOnModulerDoubleClick((stationId) => this._openModulerModal(stationId));

            this._setupControls();
            this._updateSimulation();

        } catch (error) {
            console.error('[App] Failed to load:', error);
            const container = document.getElementById('container-3d');
            container.innerHTML = `
                <div style="padding: 40px; text-align: center; color: #d32f2f;">
                    <h2>データの読み込みに失敗しました</h2>
                    <p style="margin-top: 20px; color: #666;">${error.message}</p>
                    <p style="margin-top: 20px; font-size: 14px; color: #999;">シミュレーションID: ${simId}</p>
                </div>
            `;
        }
    }

    // --- Moduler hierarchy ---

    _buildModulerMap(flatScenario) {
        this.modulerMap.clear();
        for (const station of flatScenario.stations) {
            const dotIdx = station.id.lastIndexOf('.');
            if (dotIdx === -1) continue;
            const parentId = station.id.substring(0, dotIdx);
            this.modulerMap.set(station.id, parentId);
        }
    }

    _getDirectParent(stationId) {
        return this.modulerMap.get(stationId) || null;
    }

    _isInsideModuler(stationId) {
        return this.modulerMap.has(stationId);
    }

    // --- Layer transforms ---

    _transformForLayer1(rawActiveWorks) {
        const layer1 = new Map();

        rawActiveWorks.forEach((workInfo, workId) => {
            if (workInfo.state === 'at_station') {
                const parent = this._getDirectParent(workInfo.stationId);
                if (parent) {
                    // Internal station → show at parent moduler, static
                    layer1.set(workId, {
                        state: 'at_station',
                        stationId: this._resolveToTopLevel(parent)
                    });
                } else {
                    layer1.set(workId, { ...workInfo });
                }
            } else if (workInfo.state === 'moving') {
                const fromParent = this._getDirectParent(workInfo.fromStation);
                const toParent = this._getDirectParent(workInfo.toStation);

                if (fromParent && toParent) {
                    const fromTop = this._resolveToTopLevel(fromParent);
                    const toTop = this._resolveToTopLevel(toParent);
                    if (fromTop === toTop) {
                        // Both inside same top-level moduler → static at moduler
                        layer1.set(workId, {
                            state: 'at_station',
                            stationId: fromTop
                        });
                    } else {
                        // Different top-level modulers → moving between them
                        layer1.set(workId, {
                            ...workInfo,
                            fromStation: fromTop,
                            toStation: toTop
                        });
                    }
                } else if (!fromParent && toParent) {
                    // External → internal: moving to moduler
                    layer1.set(workId, {
                        ...workInfo,
                        toStation: this._resolveToTopLevel(toParent)
                    });
                } else if (fromParent && !toParent) {
                    // Internal → external: moving from moduler
                    layer1.set(workId, {
                        ...workInfo,
                        fromStation: this._resolveToTopLevel(fromParent)
                    });
                } else {
                    layer1.set(workId, { ...workInfo });
                }
            } else {
                layer1.set(workId, { ...workInfo });
            }
        });

        return layer1;
    }

    _resolveToTopLevel(stationId) {
        let current = stationId;
        while (this.modulerMap.has(current)) {
            current = this.modulerMap.get(current);
        }
        return current;
    }

    _filterForModuler(rawActiveWorks, modulerId) {
        const filtered = new Map();
        const prefix = modulerId + '.';

        rawActiveWorks.forEach((workInfo, workId) => {
            if (workInfo.state === 'at_station') {
                if (workInfo.stationId.startsWith(prefix)) {
                    // Check if direct child (not nested deeper)
                    const relative = workInfo.stationId.substring(prefix.length);
                    const nestedParent = this._getDirectParent(workInfo.stationId);
                    if (nestedParent === modulerId) {
                        filtered.set(workId, {
                            ...workInfo,
                            stationId: relative
                        });
                    } else if (nestedParent && nestedParent.startsWith(prefix)) {
                        // Nested moduler child → show at the nested moduler (1 level up)
                        const nestedRelative = nestedParent.substring(prefix.length);
                        filtered.set(workId, {
                            state: 'at_station',
                            stationId: nestedRelative
                        });
                    }
                }
            } else if (workInfo.state === 'moving') {
                const fromInside = workInfo.fromStation.startsWith(prefix);
                const toInside = workInfo.toStation.startsWith(prefix);

                if (fromInside && toInside) {
                    const fromRel = workInfo.fromStation.substring(prefix.length);
                    const toRel = workInfo.toStation.substring(prefix.length);
                    const fromParent = this._getDirectParent(workInfo.fromStation);
                    const toParent = this._getDirectParent(workInfo.toStation);

                    let resolvedFrom = fromRel;
                    let resolvedTo = toRel;

                    if (fromParent !== modulerId && fromParent && fromParent.startsWith(prefix)) {
                        resolvedFrom = fromParent.substring(prefix.length);
                    }
                    if (toParent !== modulerId && toParent && toParent.startsWith(prefix)) {
                        resolvedTo = toParent.substring(prefix.length);
                    }

                    if (resolvedFrom === resolvedTo) {
                        filtered.set(workId, { state: 'at_station', stationId: resolvedFrom });
                    } else {
                        filtered.set(workId, {
                            ...workInfo,
                            fromStation: resolvedFrom,
                            toStation: resolvedTo
                        });
                    }
                } else if (toInside) {
                    const toRel = workInfo.toStation.substring(prefix.length);
                    const toParent = this._getDirectParent(workInfo.toStation);
                    let resolvedTo = toRel;
                    if (toParent !== modulerId && toParent && toParent.startsWith(prefix)) {
                        resolvedTo = toParent.substring(prefix.length);
                    }
                    filtered.set(workId, { state: 'at_station', stationId: resolvedTo });
                } else if (fromInside) {
                    const fromRel = workInfo.fromStation.substring(prefix.length);
                    const fromParent = this._getDirectParent(workInfo.fromStation);
                    let resolvedFrom = fromRel;
                    if (fromParent !== modulerId && fromParent && fromParent.startsWith(prefix)) {
                        resolvedFrom = fromParent.substring(prefix.length);
                    }
                    filtered.set(workId, { state: 'at_station', stationId: resolvedFrom });
                }
            }
        });

        return filtered;
    }

    _filterSignalsForModuler(rawSignalStates, modulerId) {
        const filtered = new Map();
        const prefix = modulerId + '.';
        rawSignalStates.forEach((signals, stationId) => {
            if (stationId.startsWith(prefix)) {
                const relative = stationId.substring(prefix.length);
                filtered.set(relative, signals);
            }
        });
        return filtered;
    }

    // --- Scenario building ---

    _buildLayer1Scenario(flatScenario) {
        const topStations = flatScenario.stations.filter(s => !s.id.includes('.'));

        const topStationIds = new Set(topStations.map(s => s.id));

        const topConnections = [];
        for (const conn of flatScenario.connections) {
            const fromTop = this._resolveToTopLevel(conn.from);
            const toTop = this._resolveToTopLevel(conn.to);

            if (!topStationIds.has(fromTop) || !topStationIds.has(toTop)) continue;
            if (fromTop === toTop) continue;

            const exists = topConnections.some(c => c.from === fromTop && c.to === toTop);
            if (exists) continue;

            topConnections.push({
                ...conn,
                from: fromTop,
                to: toTop,
                fromPortIndex: conn.fromPortIndex ?? -1,
                toPortIndex: conn.toPortIndex ?? -1
            });
        }

        return {
            ...flatScenario,
            stations: topStations,
            connections: topConnections
        };
    }

    _buildInternalScenario(flatScenario, modulerId) {
        const prefix = modulerId + '.';

        // Get parent moduler position to convert absolute coords back to relative
        const parentStation = flatScenario.stations.find(s => s.id === modulerId);
        const parentX = parentStation?.positionX || 0;
        const parentY = parentStation?.positionY || 0;

        const internalStations = flatScenario.stations.filter(s => {
            if (!s.id.startsWith(prefix)) return false;
            const relative = s.id.substring(prefix.length);
            return !relative.includes('.');
        });

        const displayStations = internalStations.map(s => ({
            ...s,
            id: s.id.substring(prefix.length),
            name: s.name || s.id.substring(prefix.length),
            positionX: s.positionX != null ? s.positionX - parentX : s.positionX,
            positionY: s.positionY != null ? s.positionY - parentY : s.positionY
        }));

        const displayIds = new Set(displayStations.map(s => s.id));

        const internalConnections = flatScenario.connections
            .filter(c => {
                const fromRel = c.from.startsWith(prefix) ? c.from.substring(prefix.length) : null;
                const toRel = c.to.startsWith(prefix) ? c.to.substring(prefix.length) : null;
                return fromRel && toRel && displayIds.has(fromRel) && displayIds.has(toRel);
            })
            .map(c => ({
                ...c,
                from: c.from.substring(prefix.length),
                to: c.to.substring(prefix.length)
            }));

        return {
            name: modulerId,
            stations: displayStations,
            connections: internalConnections
        };
    }

    // --- Modal management ---

    _openModulerModal(modulerId) {
        const existing = this.openModals.find(m => m.modulerId === modulerId);
        if (existing && existing.isOpen()) return;

        const internalScenario = this._buildInternalScenario(this.flatScenario, modulerId);
        if (internalScenario.stations.length === 0) return;

        const modulerStation = this.flatScenario.stations.find(s => s.id === modulerId);
        const modulerName = modulerStation?.name || modulerId;

        const zIndex = 10000 + this.openModals.length * 10;
        const modal = new ModulerModal(document.body, zIndex);

        modal.setOnOpenNestedModal((nestedStationId, parentModal) => {
            const fullId = modulerId + '.' + nestedStationId;
            this._openModulerModal(fullId);
        });

        modal.setOnClose((closedModal) => {
            this.openModals = this.openModals.filter(m => m !== closedModal);
        });

        modal.open(internalScenario, modulerName, modulerId, this.mouseConfig);
        this.openModals.push(modal);
    }

    // --- Time & animation ---

    _calculateMaxTime() {
        let max = 0;
        if (this.logs.workEvents && this.logs.workEvents.length > 0) {
            const lastEvent = this.logs.workEvents[this.logs.workEvents.length - 1];
            max = Math.max(max, lastEvent.Timestamp);
        }
        if (this.logs.stationStatusLogs && this.logs.stationStatusLogs.length > 0) {
            const lastLog = this.logs.stationStatusLogs[this.logs.stationStatusLogs.length - 1];
            max = Math.max(max, lastLog.Timestamp);
        }
        return max || 100;
    }

    _setupControls() {
        document.getElementById('play-btn').addEventListener('click', () => this.play());
        document.getElementById('pause-btn').addEventListener('click', () => this.pause());
        document.getElementById('reset-btn').addEventListener('click', () => this.reset());

        document.getElementById('speed-select').addEventListener('change', (e) => {
            this.speed = parseFloat(e.target.value);
        });

        document.getElementById('timeline-slider').addEventListener('input', (e) => {
            this.seek(parseFloat(e.target.value));
        });

        document.getElementById('show-station-names').addEventListener('change', (e) => {
            if (this.visualizer) this.visualizer.setShowStationNames(e.target.checked);
        });
        document.getElementById('show-work-ids').addEventListener('change', (e) => {
            if (this.visualizer) this.visualizer.setShowWorkIDs(e.target.checked);
        });
        document.getElementById('show-interlocks').addEventListener('change', (e) => {
            if (this.visualizer) this.visualizer.setShowInterlocks(e.target.checked);
        });
    }

    play() {
        if (this.isPlaying) return;
        this.isPlaying = true;
        this.lastFrameTime = performance.now();
        document.getElementById('play-btn').disabled = true;
        document.getElementById('pause-btn').disabled = false;
        this._animate();
    }

    pause() {
        this.isPlaying = false;
        document.getElementById('play-btn').disabled = false;
        document.getElementById('pause-btn').disabled = true;
    }

    reset() {
        this.pause();
        this.seek(0);
    }

    seek(time) {
        this.currentTime = Math.max(0, Math.min(time, this.maxTime));
        this._updateSimulation();
        this._updateUI();
    }

    _animate() {
        if (!this.isPlaying) return;

        const now = performance.now();
        const deltaTime = (now - this.lastFrameTime) / 1000;
        this.lastFrameTime = now;

        this.currentTime += deltaTime * this.speed;

        if (this.currentTime >= this.maxTime) {
            this.currentTime = this.maxTime;
            this.pause();
        }

        this._updateSimulation();
        this._updateUI();

        requestAnimationFrame(() => this._animate());
    }

    _updateSimulation() {
        // Build raw work states from event log
        const rawActiveWorks = new Map();

        if (this.logs.workEvents) {
            for (let i = 0; i < this.logs.workEvents.length; i++) {
                const event = this.logs.workEvents[i];
                if (event.Timestamp > this.currentTime) break;

                const workId = event.WorkID;
                const stationId = event.StationID;

                if (event.EventType === 'WorkCreated' || event.EventType === 'WorkArrived') {
                    rawActiveWorks.set(workId, { state: 'at_station', stationId });
                } else if (event.EventType === 'WorkPortEntered') {
                    rawActiveWorks.set(workId, {
                        state: 'at_station', stationId,
                        isInPort: true,
                        portIndex: event.PortIndex != null ? event.PortIndex : -1
                    });
                } else if (event.EventType === 'WorkMerged') {
                    for (const [wId, wInfo] of rawActiveWorks) {
                        if (wInfo.stationId === stationId && wInfo.isInPort) {
                            rawActiveWorks.delete(wId);
                        }
                    }
                    rawActiveWorks.set(workId, { state: 'at_station', stationId });
                } else if (event.EventType === 'WorkSplit') {
                    for (const [wId, wInfo] of rawActiveWorks) {
                        if (wInfo.stationId === stationId && !wInfo.isInPort) {
                            rawActiveWorks.delete(wId);
                        }
                    }
                    rawActiveWorks.set(workId, {
                        state: 'at_station', stationId,
                        isInPort: true,
                        portIndex: event.PortIndex != null ? event.PortIndex : -1
                    });
                } else if (event.EventType === 'WorkDeparted') {
                    let nextArrival = null;
                    for (let j = i + 1; j < this.logs.workEvents.length; j++) {
                        const nextEvent = this.logs.workEvents[j];
                        if (nextEvent.WorkID === workId &&
                            (nextEvent.EventType === 'WorkArrived' || nextEvent.EventType === 'WorkPortEntered' || nextEvent.EventType === 'WorkDestroyed')) {
                            nextArrival = nextEvent;
                            break;
                        }
                    }
                    if (nextArrival) {
                        rawActiveWorks.set(workId, {
                            state: 'moving',
                            fromStation: stationId,
                            toStation: nextArrival.StationID,
                            departTime: event.Timestamp,
                            arriveTime: nextArrival.Timestamp,
                            fromPortIndex: event.PortIndex != null ? event.PortIndex : -1,
                            toPortIndex: nextArrival.PortIndex != null ? nextArrival.PortIndex : -1
                        });
                    } else {
                        rawActiveWorks.delete(workId);
                    }
                } else if (event.EventType === 'WorkDestroyed') {
                    rawActiveWorks.delete(workId);
                }
            }
        }

        // Build signal states
        const rawSignalStates = new Map();
        if (this.logs.stationStatusLogs) {
            for (const log of this.logs.stationStatusLogs) {
                if (log.Timestamp > this.currentTime) break;
                if (log.StatusType === 'signal_change') {
                    if (!rawSignalStates.has(log.StationID)) {
                        rawSignalStates.set(log.StationID, new Map());
                    }
                    rawSignalStates.get(log.StationID).set(log.SignalName, log.Value);
                }
            }
        }

        this._rawActiveWorks = rawActiveWorks;
        this._rawSignalStates = rawSignalStates;

        // Update main visualizer with layer1 data
        if (this.visualizer) {
            const layer1Works = this._transformForLayer1(rawActiveWorks);
            this.visualizer.updateWorks(layer1Works, this.currentTime);
            this.visualizer.updateInterlockStates(rawSignalStates);
        }

        // Update open modals
        for (const modal of this.openModals) {
            if (!modal.isOpen()) continue;
            const modalWorks = this._filterForModuler(rawActiveWorks, modal.modulerId);
            const modalSignals = this._filterSignalsForModuler(rawSignalStates, modal.modulerId);
            modal.update(modalWorks, modalSignals, this.currentTime);
        }
    }

    _showWorkModal(workId) {
        const workInfo = this.visualizer.getWorkInfo(workId);

        const events = [];
        if (this.logs.workEvents) {
            for (const e of this.logs.workEvents) {
                if (e.WorkID === workId) events.push(e);
            }
        }

        let stateText = '不明';
        let stationText = '-';
        if (workInfo) {
            if (workInfo.state === 'at_station') {
                stateText = workInfo.isInPort ? 'バッファ内' : 'ステーション内';
                stationText = workInfo.stationId || '-';
            } else if (workInfo.state === 'moving') {
                stateText = '移動中';
                stationText = `${workInfo.fromStation} → ${workInfo.toStation}`;
            }
        }

        const workType = events.length > 0 ? (events[events.length - 1].WorkType || '-') : '-';
        const friendlyName = events.length > 0 ? (events[0].WorkFriendlyName || workId) : workId;

        const eventRows = events.map(e => `
            <tr>
                <td style="padding:4px 8px">${e.Timestamp.toFixed(2)}s</td>
                <td style="padding:4px 8px">${e.EventType}</td>
                <td style="padding:4px 8px">${e.StationID}</td>
                <td style="padding:4px 8px">${e.PortIndex >= 0 ? 'B' + e.PortIndex : '-'}</td>
            </tr>
        `).join('');

        const existing = document.getElementById('work-info-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'work-info-modal';
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999';
        modal.innerHTML = `
            <div style="background:#1e1e2e;color:#cdd6f4;border-radius:12px;padding:24px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.5)">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h2 style="margin:0;font-size:18px;color:#89b4fa">${friendlyName}</h2>
                    <button id="work-modal-close" style="background:none;border:none;color:#6c7086;font-size:24px;cursor:pointer;padding:0 4px">&times;</button>
                </div>
                <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:14px">
                    <tr><td style="padding:4px 8px;color:#a6adc8">ワークID</td><td style="padding:4px 8px">${workId.substring(0, 12)}...</td></tr>
                    <tr><td style="padding:4px 8px;color:#a6adc8">表示名</td><td style="padding:4px 8px">${friendlyName}</td></tr>
                    <tr><td style="padding:4px 8px;color:#a6adc8">ワーク種類</td><td style="padding:4px 8px">${workType}</td></tr>
                    <tr><td style="padding:4px 8px;color:#a6adc8">現在状態</td><td style="padding:4px 8px">${stateText}</td></tr>
                    <tr><td style="padding:4px 8px;color:#a6adc8">場所</td><td style="padding:4px 8px">${stationText}</td></tr>
                </table>
                <h3 style="font-size:14px;color:#89b4fa;margin-bottom:8px">イベント履歴</h3>
                <div style="max-height:300px;overflow-y:auto">
                    <table style="width:100%;border-collapse:collapse;font-size:12px">
                        <thead>
                            <tr style="border-bottom:1px solid #313244;color:#a6adc8">
                                <th style="padding:4px 8px;text-align:left">時刻</th>
                                <th style="padding:4px 8px;text-align:left">イベント</th>
                                <th style="padding:4px 8px;text-align:left">ステーション</th>
                                <th style="padding:4px 8px;text-align:left">バッファ</th>
                            </tr>
                        </thead>
                        <tbody>${eventRows}</tbody>
                    </table>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector('#work-modal-close').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    _flattenScenario(scenario) {
        const flatStations = [];
        const flatConnections = [];

        for (const station of scenario.stations) {
            if (station.type === 'moduler') {
                const sub = station.subScenario || station.config?.subScenario;
                if (!sub || !sub.stations || sub.stations.length === 0) {
                    flatStations.push(station);
                    continue;
                }

                const prefix = station.id;

                flatStations.push({
                    ...station,
                    subScenario: undefined
                });

                const parentX = station.positionX || 0;
                const parentY = station.positionY || 0;

                for (const inner of sub.stations) {
                    const flatId = `${prefix}.${inner.id}`;
                    const innerX = inner.positionX ?? inner.x ?? 0;
                    const innerY = inner.positionY ?? inner.y ?? 0;
                    const flatInner = {
                        ...inner,
                        id: flatId,
                        positionX: parentX + innerX,
                        positionY: parentY + innerY,
                        config: inner.config ? { ...inner.config } : {}
                    };

                    if (inner.type === 'moduler' && (inner.subScenario || inner.config?.subScenario)) {
                        const innerSub = inner.subScenario || inner.config?.subScenario;
                        if (innerSub) {
                            flatInner.subScenario = {
                                stations: (innerSub.stations || []).map(s => ({
                                    ...s,
                                    id: s.id
                                })),
                                connections: (innerSub.connections || []).map(c => ({
                                    ...c
                                }))
                            };
                        }
                        const recursed = this._flattenScenario({
                            stations: [flatInner],
                            connections: []
                        });
                        flatStations.push(...recursed.stations);
                        flatConnections.push(...recursed.connections);
                        continue;
                    }

                    flatStations.push(flatInner);
                }

                for (const conn of (sub.connections || [])) {
                    flatConnections.push({
                        ...conn,
                        from: `${prefix}.${conn.from}`,
                        to: `${prefix}.${conn.to}`
                    });
                }
            } else {
                flatStations.push(station);
            }
        }

        for (const conn of scenario.connections) {
            const fromStation = scenario.stations.find(s => s.id === conn.from);
            const toStation = scenario.stations.find(s => s.id === conn.to);

            let newFrom = conn.from;
            let newTo = conn.to;
            let newFromPortIndex = conn.fromPortIndex ?? -1;
            let newToPortIndex = conn.toPortIndex ?? -1;

            if (fromStation && fromStation.type === 'moduler') {
                const sub = fromStation.subScenario || fromStation.config?.subScenario;
                const exits = sub ? sub.stations.filter(s => s.type === 'exit') : [];
                const exitIdx = Math.max(0, newFromPortIndex);
                if (exits.length > 0) {
                    const exitSt = exits[exitIdx < exits.length ? exitIdx : 0];
                    newFrom = `${conn.from}.${exitSt.id}`;
                } else {
                    newFrom = `${conn.from}.exit-${exitIdx}`;
                }
                newFromPortIndex = -1;
            }

            if (toStation && toStation.type === 'moduler') {
                const sub = toStation.subScenario || toStation.config?.subScenario;
                const entries = sub ? sub.stations.filter(s => s.type === 'entry') : [];
                const entryIdx = Math.max(0, newToPortIndex);
                if (entries.length > 0) {
                    const entrySt = entries[entryIdx < entries.length ? entryIdx : 0];
                    newTo = `${conn.to}.${entrySt.id}`;
                } else {
                    newTo = `${conn.to}.entry-${entryIdx}`;
                }
                newToPortIndex = -1;
            }

            flatConnections.push({
                ...conn,
                from: newFrom,
                to: newTo,
                fromPortIndex: newFromPortIndex,
                toPortIndex: newToPortIndex
            });
        }

        return {
            ...scenario,
            stations: flatStations,
            connections: flatConnections
        };
    }

    _updateUI() {
        document.getElementById('current-time').textContent = this.currentTime.toFixed(2) + 's';
        document.getElementById('timeline-slider').value = this.currentTime;
    }

    async _showSimulationList() {
        const container = document.getElementById('container-3d');
        document.getElementById('controls').style.display = 'none';
        container.style.overflow = 'auto';
        container.style.background = '#f5f5f5';
        document.getElementById('sim-info').textContent = 'シミュレーション結果一覧';

        try {
            container.innerHTML = '<div style="padding: 40px; text-align: center; color: #333; font-size: 18px;">読み込み中...</div>';

            const response = await fetch('/api/simulations');
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

            const simulations = await response.json();

            if (!simulations || simulations.length === 0) {
                container.innerHTML = `
                    <div style="padding: 60px 40px; text-align: center; color: #666;">
                        <h2 style="margin-bottom: 20px;">シミュレーション結果がありません</h2>
                        <p>まだシミュレーションが実行されていません。</p>
                    </div>
                `;
                return;
            }

            simulations.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

            const listHTML = simulations.map(sim => {
                const createdAt = sim.createdAt ? new Date(sim.createdAt).toLocaleString('ja-JP') : 'N/A';
                const endTime = sim.endTime ? sim.endTime.toFixed(2) + 's' : 'N/A';
                const statusColor = sim.status === 'completed' ? '#4caf50' : '#f44336';

                return `
                    <div style="background:#f8f9fa;border:1px solid #dee2e6;border-radius:8px;padding:20px;margin-bottom:15px;cursor:pointer;transition:all 0.2s ease"
                    onmouseover="this.style.background='#e9ecef';this.style.boxShadow='0 4px 12px rgba(0,0,0,0.1)'"
                    onmouseout="this.style.background='#f8f9fa';this.style.boxShadow='none'"
                    onclick="window.location.href='?sim=${sim.simulationId}'">
                        <h3 style="color:#495057;font-size:18px;margin-bottom:12px">${sim.friendlyName || sim.simulationId}</h3>
                        <div style="display:inline-block;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600;background:${statusColor}20;color:${statusColor};margin-bottom:10px">${sim.status.toUpperCase()}</div>
                        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;color:#6c757d;font-size:14px;margin-top:10px">
                            <div>ID: ${sim.simulationId.substring(0, 8)}...</div>
                            <div>実行日時: ${createdAt}</div>
                            <div>終了時刻: ${endTime}</div>
                            <div>終了理由: ${sim.endReason || 'N/A'}</div>
                        </div>
                    </div>
                `;
            }).join('');

            container.innerHTML = `
                <div style="padding:20px">
                    <div style="margin-bottom:20px;display:flex;justify-content:space-between;align-items:center">
                        <h2 style="color:#333">全${simulations.length}件のシミュレーション</h2>
                        <button onclick="location.reload()" style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-size:14px">更新</button>
                    </div>
                    ${listHTML}
                </div>
            `;
        } catch (error) {
            console.error('[App] Failed to load simulation list:', error);
            container.innerHTML = `
                <div style="padding: 60px 40px; text-align: center; color: #d32f2f;">
                    <h2>エラーが発生しました</h2>
                    <p style="color: #666;">${error.message}</p>
                </div>
            `;
        }
    }
}

window.addEventListener('error', (event) => {
    console.error('[App] Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('[App] Unhandled promise rejection:', event.reason);
});

new App();
