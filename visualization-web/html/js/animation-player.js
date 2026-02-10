// Animation player for simulation replay

class AnimationPlayer {
    constructor(scenarioData, logs, containerId) {
        console.log('[AnimationPlayer] Constructor called');
        console.log('[AnimationPlayer] Scenario:', scenarioData);
        console.log('[AnimationPlayer] Container ID:', containerId);

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
        this.stationPositions = new Map(); // Map<stationId, {x, y}>
        this.initialViewport = null; // Store initial viewport (zoom + pan)

        console.log('[AnimationPlayer] Max time:', this.maxTime);

        this._initGraph();
        this._setupControls();

        console.log('[AnimationPlayer] Initialization complete');
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
        console.log('[AnimationPlayer] Initializing graph...');

        // Reuse scenario-graph rendering
        this.cy = renderScenarioGraph(this.scenario, this.containerId);

        console.log('[AnimationPlayer] Cytoscape instance created, nodes:', this.cy.nodes().length);

        // Disable automatic viewport adjustments
        this.cy.autoungrabify(false);
        this.cy.autounselectify(false);

        // Save initial viewport
        this.initialViewport = {
            zoom: this.cy.zoom(),
            pan: this.cy.pan()
        };
        console.log('[AnimationPlayer] Initial viewport saved:', this.initialViewport);

        // Register multiple events to debug
        this.cy.on('layoutstart', () => {
            console.log('[AnimationPlayer] Layout started');
        });

        this.cy.on('layoutstop', () => {
            console.log('[AnimationPlayer] Layout stopped - saving positions');

            // Save positions of all station nodes
            this.cy.nodes().forEach(node => {
                const pos = node.position();
                this.stationPositions.set(node.id(), { x: pos.x, y: pos.y });
                console.log(`[AnimationPlayer] Saved position for ${node.id()}: x=${pos.x}, y=${pos.y}`);
            });

            console.log('[AnimationPlayer] Total station positions saved:', this.stationPositions.size);

            // Save viewport after layout
            this.initialViewport = {
                zoom: this.cy.zoom(),
                pan: this.cy.pan()
            };
        });

        this.cy.ready(() => {
            console.log('[AnimationPlayer] Cytoscape ready');

            // If layout hasn't fired yet, save current positions
            if (this.stationPositions.size === 0) {
                console.log('[AnimationPlayer] Layout event not fired, saving current positions');
                this.cy.nodes().forEach(node => {
                    const pos = node.position();
                    this.stationPositions.set(node.id(), { x: pos.x, y: pos.y });
                    console.log(`[AnimationPlayer] Saved position for ${node.id()}: x=${pos.x}, y=${pos.y}`);
                });
            }
        });
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

        console.log('[AnimationPlayer] Play button pressed');

        this.isPlaying = true;
        this.lastFrameTime = performance.now();

        document.getElementById('play-btn').disabled = true;
        document.getElementById('pause-btn').disabled = false;

        // Lock station nodes (location layer)
        let lockedCount = 0;
        this.cy.nodes().forEach(node => {
            if (!node.hasClass('work-node')) {
                node.lock();
                lockedCount++;
            }
        });
        console.log(`[AnimationPlayer] Locked ${lockedCount} station nodes`);

        this._animate();
    }

    pause() {
        console.log('[AnimationPlayer] Pause button pressed');

        this.isPlaying = false;

        document.getElementById('play-btn').disabled = false;
        document.getElementById('pause-btn').disabled = true;

        // Unlock station nodes (allow manual adjustment)
        let unlockedCount = 0;
        this.cy.nodes().forEach(node => {
            if (!node.hasClass('work-node')) {
                node.unlock();
                unlockedCount++;
            }
        });
        console.log(`[AnimationPlayer] Unlocked ${unlockedCount} station nodes`);
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
        const currentViewport = { zoom: this.cy.zoom(), pan: this.cy.pan() };
        console.log(`[AnimationPlayer] _updateGraph called at time ${this.currentTime.toFixed(2)}, saved positions: ${this.stationPositions.size}`);
        console.log(`[AnimationPlayer] Current viewport before update - zoom: ${currentViewport.zoom.toFixed(2)}, pan: (${currentViewport.pan.x.toFixed(1)}, ${currentViewport.pan.y.toFixed(1)})`);

        // Use batch to prevent layout recalculation during updates
        this.cy.batch(() => {
            // First, restore all station positions (location layer must stay fixed)
            let restoredCount = 0;
            this.stationPositions.forEach((pos, stationId) => {
                const node = this.cy.$id(stationId);
                if (node.length > 0 && !node.hasClass('work-node')) {
                    const currentPos = node.position();
                    if (currentPos.x !== pos.x || currentPos.y !== pos.y) {
                        console.log(`[AnimationPlayer] Restoring ${stationId} from (${currentPos.x}, ${currentPos.y}) to (${pos.x}, ${pos.y})`);
                    }
                    node.position(pos);
                    restoredCount++;
                }
            });
            console.log(`[AnimationPlayer] Restored ${restoredCount} station positions`);

            // Remove all work nodes (keep station nodes intact)
            const workNodesBefore = this.cy.nodes('.work-node').length;
            this.cy.nodes('.work-node').remove();
            this.workNodes.clear();
            console.log(`[AnimationPlayer] Removed ${workNodesBefore} work nodes`);

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

            console.log(`[AnimationPlayer] Active works: ${activeWorks.size}`);

            // Add work nodes to graph at their current stations
            // Works are independent nodes (not children of stations)
            const workCountPerStation = new Map(); // Track work count per station

            activeWorks.forEach((stationId, workId) => {
                const nodeId = `work-${workId}`;

                // Get station position from saved positions (not current position)
                const stationPos = this.stationPositions.get(stationId);
                if (!stationPos) {
                    console.warn(`[AnimationPlayer] No saved position for station ${stationId}`);
                    return;
                }

                // Calculate work position offset (arrange works in a circle around station)
                const workIndex = workCountPerStation.get(stationId) || 0;
                workCountPerStation.set(stationId, workIndex + 1);

                const angle = (workIndex * 60) * (Math.PI / 180); // 60 degrees apart
                const radius = 50; // Distance from station center
                const workX = stationPos.x + radius * Math.cos(angle);
                const workY = stationPos.y + radius * Math.sin(angle);

                // Add work node as independent node (not as child)
                this.cy.add({
                    group: 'nodes',
                    data: {
                        id: nodeId,
                        label: `W${workId.substring(0, 4)}`,
                        stationId: stationId // Store reference to station
                    },
                    classes: 'work-node',
                    position: { x: workX, y: workY }
                });

                // Style work nodes
                this.cy.$(`#${nodeId}`).style({
                    'background-color': '#ff6b6b',
                    'width': 25,
                    'height': 25,
                    'font-size': '10px',
                    'color': '#fff',
                    'text-halign': 'center',
                    'text-valign': 'center',
                    'z-index': 999 // Keep works on top
                });

                this.workNodes.set(workId, nodeId);
            });

            // Final position restoration to ensure stations haven't moved
            let finalRestoredCount = 0;
            this.stationPositions.forEach((pos, stationId) => {
                const node = this.cy.$id(stationId);
                if (node.length > 0 && !node.hasClass('work-node')) {
                    node.position(pos);
                    finalRestoredCount++;
                }
            });
            console.log(`[AnimationPlayer] Final restoration of ${finalRestoredCount} station positions`);

            // Restore viewport to prevent automatic panning/zooming
            if (this.initialViewport) {
                const beforeRestore = { zoom: this.cy.zoom(), pan: this.cy.pan() };
                this.cy.viewport({
                    zoom: this.initialViewport.zoom,
                    pan: this.initialViewport.pan
                });
                const afterRestore = { zoom: this.cy.zoom(), pan: this.cy.pan() };

                if (beforeRestore.zoom !== afterRestore.zoom ||
                    beforeRestore.pan.x !== afterRestore.pan.x ||
                    beforeRestore.pan.y !== afterRestore.pan.y) {
                    console.log(`[AnimationPlayer] Viewport restored from zoom:${beforeRestore.zoom.toFixed(2)} pan:(${beforeRestore.pan.x.toFixed(1)},${beforeRestore.pan.y.toFixed(1)}) to zoom:${afterRestore.zoom.toFixed(2)} pan:(${afterRestore.pan.x.toFixed(1)},${afterRestore.pan.y.toFixed(1)})`);
                }
            }
        });
    }

    _updateUI() {
        document.getElementById('current-time').textContent = this.currentTime.toFixed(2) + 's';
        document.getElementById('timeline-slider').value = this.currentTime;
    }
}
