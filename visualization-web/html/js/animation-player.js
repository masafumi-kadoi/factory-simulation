// Animation player for simulation replay

class AnimationPlayer {
    constructor(scenarioData, logs, containerId) {
        this.scenario = scenarioData;
        this.logs = logs;
        this.containerId = containerId;

        this.currentTime = 0;
        this.maxTime = this._calculateMaxTime();
        this.isPlaying = false;
        this.speed = 1.0;
        this.lastFrameTime = 0;

        this.cy = null;
        this.workNodes = new Map(); // Map<workId, nodeId>

        this._initGraph();
        this._setupControls();
    }

    _calculateMaxTime() {
        let maxTime = 0;

        if (this.logs.workEvents && this.logs.workEvents.length > 0) {
            const lastEvent = this.logs.workEvents[this.logs.workEvents.length - 1];
            maxTime = Math.max(maxTime, lastEvent.Timestamp);
        }

        if (this.logs.stationStatusLogs && this.logs.stationStatusLogs.length > 0) {
            const lastLog = this.logs.stationStatusLogs[this.logs.stationStatusLogs.length - 1];
            maxTime = Math.max(maxTime, lastLog.Timestamp);
        }

        return maxTime || 100;
    }

    _initGraph() {
        // Reuse scenario-graph rendering
        this.cy = renderScenarioGraph(this.scenario, this.containerId);
    }

    _setupControls() {
        // Play button
        document.getElementById('play-btn').addEventListener('click', () => this.play());

        // Pause button
        document.getElementById('pause-btn').addEventListener('click', () => this.pause());

        // Reset button
        document.getElementById('reset-btn').addEventListener('click', () => this.reset());

        // Speed selector
        document.getElementById('speed-select').addEventListener('change', (e) => {
            this.setSpeed(parseFloat(e.target.value));
        });

        // Timeline slider
        const slider = document.getElementById('timeline-slider');
        slider.max = this.maxTime;
        slider.addEventListener('input', (e) => {
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
        this._updateGraph();
        this._updateUI();
    }

    setSpeed(speed) {
        this.speed = speed;
    }

    _animate() {
        if (!this.isPlaying) return;

        const now = performance.now();
        const deltaTime = (now - this.lastFrameTime) / 1000; // Convert to seconds
        this.lastFrameTime = now;

        this.currentTime += deltaTime * this.speed;

        if (this.currentTime >= this.maxTime) {
            this.currentTime = this.maxTime;
            this.pause();
        }

        this._updateGraph();
        this._updateUI();

        if (this.isPlaying) {
            requestAnimationFrame(() => this._animate());
        }
    }

    _updateGraph() {
        // Remove all work nodes
        this.workNodes.forEach((nodeId) => {
            this.cy.$(`#${nodeId}`).remove();
        });
        this.workNodes.clear();

        // Process work events up to current time
        const activeWorks = new Map(); // Map<workId, stationId>

        if (this.logs.workEvents) {
            for (const event of this.logs.workEvents) {
                if (event.Timestamp > this.currentTime) break;

                const workId = event.WorkID;
                const stationId = event.StationID;

                if (event.EventType === 'WorkCreated') {
                    activeWorks.set(workId, stationId);
                } else if (event.EventType === 'WorkArrived') {
                    activeWorks.set(workId, stationId);
                } else if (event.EventType === 'WorkDeparted') {
                    activeWorks.delete(workId);
                } else if (event.EventType === 'WorkDestroyed') {
                    activeWorks.delete(workId);
                }
            }
        }

        // Add work nodes to graph
        activeWorks.forEach((stationId, workId) => {
            const nodeId = `work-${workId}`;

            if (!this.cy.$(`#${nodeId}`).length) {
                this.cy.add({
                    group: 'nodes',
                    data: {
                        id: nodeId,
                        label: workId,
                        parent: stationId
                    },
                    classes: 'work-node'
                });

                // Style work nodes
                this.cy.$(`#${nodeId}`).style({
                    'background-color': '#ff0000',
                    'width': 30,
                    'height': 30,
                    'font-size': '8px'
                });

                this.workNodes.set(workId, nodeId);
            }
        });

        // Update station colors based on status logs
        // (Simplified: just highlight stations with recent activity)
        this.cy.nodes().forEach(node => {
            if (!node.id().startsWith('work-')) {
                node.style('opacity', 0.5);
            }
        });

        activeWorks.forEach((stationId) => {
            this.cy.$(`#${stationId}`).style('opacity', 1.0);
        });
    }

    _updateUI() {
        document.getElementById('current-time').textContent = this.currentTime.toFixed(2) + 's';
        document.getElementById('timeline-slider').value = this.currentTime;
    }
}
