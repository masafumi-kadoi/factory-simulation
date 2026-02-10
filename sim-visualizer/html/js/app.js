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

        if (!simId) {
            alert('シミュレーションIDが指定されていません');
            window.location.href = '/';
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
            alert('データの読み込みに失敗しました: ' + error.message);
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
        const activeWorks = new Map(); // Map<workId, stationId>

        if (this.logs.workEvents) {
            for (const event of this.logs.workEvents) {
                if (event.Timestamp > this.currentTime) break;

                const workId = event.WorkID;
                const stationId = event.StationID;

                if (event.EventType === 'WorkCreated' || event.EventType === 'WorkArrived') {
                    activeWorks.set(workId, stationId);
                } else if (event.EventType === 'WorkDeparted' || event.EventType === 'WorkDestroyed') {
                    activeWorks.delete(workId);
                }
            }
        }

        // Update visualizer
        if (this.visualizer) {
            this.visualizer.updateWorks(activeWorks);
        }
    }

    _updateUI() {
        document.getElementById('current-time').textContent = this.currentTime.toFixed(2) + 's';
        document.getElementById('timeline-slider').value = this.currentTime;
    }
}

// Start app
new App();
