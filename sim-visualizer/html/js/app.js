// Main application logic
import { fetchSimulation, fetchScenario, fetchLogs } from './api.js';
import { Visualizer3D } from './visualizer.js';

class App {
    constructor() {
        this.visualizer = null;
        this.logs = null;
        this.currentTime = 0;
        this.maxTime = 0;
        this.isPlaying = false;
        this.speed = 1.0;
        this.lastFrameTime = 0;

        this._init();
    }

    async _init() {
        // Get simulation ID from URL
        const params = new URLSearchParams(window.location.search);
        const simId = params.get('sim');

        console.log('[App] URL:', window.location.href);
        console.log('[App] Query params:', window.location.search);
        console.log('[App] Simulation ID:', simId);

        if (!simId) {
            // Show simulation list
            await this._showSimulationList();
            return;
        }

        try {
            // Show loading
            document.getElementById('container-3d').innerHTML = '<div class="loading">Loading...</div>';

            // Fetch data
            console.log('[App] Fetching simulation:', simId);
            const simulation = await fetchSimulation(simId);
            const scenario = await fetchScenario(simulation.scenarioId);
            this.logs = await fetchLogs(simId);

            // Update UI
            document.getElementById('sim-info').textContent =
                `${simulation.friendlyName || simulation.simulationId}`;

            // Calculate max time
            this.maxTime = this._calculateMaxTime();
            document.getElementById('timeline-slider').max = this.maxTime;

            // Initialize 3D visualizer
            const container = document.getElementById('container-3d');
            container.innerHTML = '';
            this.visualizer = new Visualizer3D(container);
            this.visualizer.loadScenario(scenario);

            // Setup controls
            this._setupControls();

            // Initial update
            this._updateSimulation();

            console.log('[App] Initialization complete');

        } catch (error) {
            console.error('[App] Failed to load:', error);
            const container = document.getElementById('container-3d');
            container.innerHTML = `
                <div style="padding: 40px; text-align: center; color: #d32f2f;">
                    <h2>❌ データの読み込みに失敗しました</h2>
                    <p style="margin-top: 20px; color: #666;">
                        ${error.message}
                    </p>
                    <p style="margin-top: 20px; font-size: 14px; color: #999;">
                        シミュレーションID: ${simId}
                    </p>
                </div>
            `;
        }
    }

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
            if (this.visualizer) {
                this.visualizer.setShowStationNames(e.target.checked);
            }
        });

        document.getElementById('show-work-ids').addEventListener('change', (e) => {
            if (this.visualizer) {
                this.visualizer.setShowWorkIDs(e.target.checked);
            }
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
        // Process work events up to current time
        const activeWorks = new Map(); // Map<workId, {state, stationId, fromStation, toStation, departTime, arriveTime}>

        if (this.logs.workEvents) {
            // Build work state map
            for (let i = 0; i < this.logs.workEvents.length; i++) {
                const event = this.logs.workEvents[i];
                if (event.Timestamp > this.currentTime) break;

                const workId = event.WorkID;
                const stationId = event.StationID;

                if (event.EventType === 'WorkCreated' || event.EventType === 'WorkArrived') {
                    // Work is at station
                    activeWorks.set(workId, {
                        state: 'at_station',
                        stationId: stationId,
                        workType: event.WorkType || ''
                    });
                } else if (event.EventType === 'WorkBuffered') {
                    // Work is in a merge station's buffer slot
                    activeWorks.set(workId, {
                        state: 'at_station',
                        stationId: stationId,
                        isBuffered: true,
                        workType: event.WorkType || ''
                    });
                } else if (event.EventType === 'WorkMerged') {
                    // Merged work appears at station body; remove consumed works
                    // Remove all buffered works at this station (they were consumed)
                    for (const [wId, wInfo] of activeWorks) {
                        if (wInfo.stationId === stationId && wInfo.isBuffered) {
                            activeWorks.delete(wId);
                        }
                    }
                    activeWorks.set(workId, {
                        state: 'at_station',
                        stationId: stationId,
                        workType: event.WorkType || ''
                    });
                } else if (event.EventType === 'WorkSplit') {
                    // Split work placed in output buffer slot
                    activeWorks.set(workId, {
                        state: 'at_station',
                        stationId: stationId,
                        isBuffered: true,
                        workType: event.WorkType || ''
                    });
                } else if (event.EventType === 'WorkDeparted') {
                    // Look ahead to find next arrival
                    let nextArrival = null;
                    for (let j = i + 1; j < this.logs.workEvents.length; j++) {
                        const nextEvent = this.logs.workEvents[j];
                        if (nextEvent.WorkID === workId &&
                            (nextEvent.EventType === 'WorkArrived' || nextEvent.EventType === 'WorkBuffered' || nextEvent.EventType === 'WorkDestroyed')) {
                            nextArrival = nextEvent;
                            break;
                        }
                    }

                    if (nextArrival) {
                        // Work is moving
                        activeWorks.set(workId, {
                            state: 'moving',
                            fromStation: stationId,
                            toStation: nextArrival.StationID,
                            departTime: event.Timestamp,
                            arriveTime: nextArrival.Timestamp,
                            workType: event.WorkType || ''
                        });
                    } else {
                        // No next arrival (destroyed or end of log)
                        activeWorks.delete(workId);
                    }
                } else if (event.EventType === 'WorkDestroyed') {
                    activeWorks.delete(workId);
                }
            }
        }

        // Update visualizer
        if (this.visualizer) {
            this.visualizer.updateWorks(activeWorks, this.currentTime);
        }
    }

    _updateUI() {
        document.getElementById('current-time').textContent = this.currentTime.toFixed(2) + 's';
        document.getElementById('timeline-slider').value = this.currentTime;
    }

    async _showSimulationList() {
        console.log('[App] _showSimulationList called');
        const container = document.getElementById('container-3d');
        console.log('[App] Container element:', container);

        // Hide controls
        document.getElementById('controls').style.display = 'none';

        // Enable scrolling for the list
        container.style.overflow = 'auto';
        container.style.background = '#f5f5f5';

        // Update header
        document.getElementById('sim-info').textContent = 'シミュレーション結果一覧';

        try {
            // Show loading
            console.log('[App] Setting loading message');
            container.innerHTML = '<div style="padding: 40px; text-align: center; color: #333; font-size: 18px;">📊 読み込み中...</div>';

            // Fetch simulations list
            console.log('[App] Fetching simulations from API...');
            const response = await fetch('http://localhost:8080/api/simulations');
            console.log('[App] API response status:', response.status);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const simulations = await response.json();
            console.log('[App] Received simulations:', simulations.length, 'items');

            if (!simulations || simulations.length === 0) {
                container.innerHTML = `
                    <div style="padding: 60px 40px; text-align: center; color: #666;">
                        <h2 style="margin-bottom: 20px;">📭 シミュレーション結果がありません</h2>
                        <p style="margin-bottom: 10px;">まだシミュレーションが実行されていません。</p>
                        <p style="font-size: 14px; color: #999;">
                            以下のコマンドでテストを実行してください：<br>
                            <code style="background: #f5f5f5; padding: 4px 8px; border-radius: 4px; margin-top: 10px; display: inline-block;">
                                cd simulation-core/test && bash run_all_tests.sh
                            </code>
                        </p>
                    </div>
                `;
                return;
            }

            // Sort by creation time (most recent first)
            simulations.sort((a, b) => {
                const dateA = new Date(a.createdAt || 0);
                const dateB = new Date(b.createdAt || 0);
                return dateB - dateA;
            });

            // Render list
            const listHTML = simulations.map(sim => {
                const createdAt = sim.createdAt ? new Date(sim.createdAt).toLocaleString('ja-JP') : 'N/A';
                const endTime = sim.endTime ? sim.endTime.toFixed(2) + 's' : 'N/A';
                const statusColor = sim.status === 'completed' ? '#4caf50' : '#f44336';

                return `
                    <div style="
                        background: #f8f9fa;
                        border: 1px solid #dee2e6;
                        border-radius: 8px;
                        padding: 20px;
                        margin-bottom: 15px;
                        cursor: pointer;
                        transition: all 0.2s ease;
                    "
                    onmouseover="this.style.background='#e9ecef'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.1)'"
                    onmouseout="this.style.background='#f8f9fa'; this.style.boxShadow='none'"
                    onclick="window.location.href='?sim=${sim.simulationId}'">
                        <h3 style="color: #495057; font-size: 18px; margin-bottom: 12px;">
                            ${sim.friendlyName || sim.simulationId}
                        </h3>
                        <div style="display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; background: ${statusColor}20; color: ${statusColor}; margin-bottom: 10px;">
                            ${sim.status.toUpperCase()}
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; color: #6c757d; font-size: 14px; margin-top: 10px;">
                            <div>🆔 ID: ${sim.simulationId.substring(0, 8)}...</div>
                            <div>📅 実行日時: ${createdAt}</div>
                            <div>⏱️ 終了時刻: ${endTime}</div>
                            <div>🏁 終了理由: ${sim.endReason || 'N/A'}</div>
                        </div>
                    </div>
                `;
            }).join('');

            container.innerHTML = `
                <div style="padding: 20px;">
                    <div style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
                        <h2 style="color: #333;">全${simulations.length}件のシミュレーション</h2>
                        <button onclick="location.reload()" style="
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            border: none;
                            padding: 10px 20px;
                            border-radius: 6px;
                            cursor: pointer;
                            font-size: 14px;
                        ">
                            🔄 更新
                        </button>
                    </div>
                    ${listHTML}
                </div>
            `;

        } catch (error) {
            console.error('[App] Failed to load simulation list:', error);
            container.innerHTML = `
                <div style="padding: 60px 40px; text-align: center; color: #d32f2f;">
                    <h2 style="margin-bottom: 20px;">❌ エラーが発生しました</h2>
                    <p style="color: #666;">${error.message}</p>
                    <p style="font-size: 14px; margin-top: 20px; color: #999;">
                        APIサーバーが起動しているか確認してください。<br>
                        <code style="background: #f5f5f5; padding: 4px 8px; border-radius: 4px;">docker-compose ps</code>
                    </p>
                </div>
            `;
        }
    }
}

// Global error handlers
window.addEventListener('error', (event) => {
    console.error('[App] Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('[App] Unhandled promise rejection:', event.reason);
});

// Start app
console.log('[App] Starting application...');
new App();
console.log('[App] Application constructor completed');
