// Scenario Editor Main
import { Canvas } from './canvas.js';
import { PropertiesPanel } from './properties.js';
import { validateScenario, validateStation } from './validation.js';
import { apiClient } from './api.js';
import {
    CommandManager,
    AddStationCommand,
    DeleteStationCommand,
    UpdateStationCommand,
    MoveStationCommand,
    AddConnectionCommand,
    DeleteConnectionCommand
} from './undo.js';

class ScenarioEditor {
    constructor() {
        this.scenarioId = null;
        this.scenario = null;
        this.currentTool = 'select';
        this.selectedItem = null;
        this.dirty = false;
        this.savedToAPI = false; // Track if scenario was saved to API

        this.canvas = null;
        this.propertiesPanel = null;
        this.commandManager = new CommandManager(this);

        this._init();
    }

    async _init() {
        // Get scenario ID from URL
        const params = new URLSearchParams(window.location.search);
        this.scenarioId = params.get('id');

        if (!this.scenarioId) {
            alert('シナリオIDが指定されていません');
            window.location.href = 'index.html';
            return;
        }

        // Load scenario
        this._loadScenario();

        // Initialize canvas and properties panel
        this.canvas = new Canvas(document.getElementById('canvas'), this);
        this.propertiesPanel = new PropertiesPanel(document.getElementById('properties-content'), this);

        // Setup event listeners
        this._setupEventListeners();

        // Render
        this._render();
    }

    _loadScenario() {
        const scenarios = JSON.parse(localStorage.getItem('sim-editor-scenarios') || '[]');
        this.scenario = scenarios.find(s => s.id === this.scenarioId);

        if (!this.scenario) {
            alert('シナリオが見つかりません');
            window.location.href = 'index.html';
            return;
        }

        // Set scenario name in header
        document.getElementById('scenario-name').value = this.scenario.name;
    }

    _setupEventListeners() {
        // Back button
        document.getElementById('back-btn').addEventListener('click', () => {
            if (this.dirty && !confirm('保存していない変更があります。戻りますか？')) {
                return;
            }
            window.location.href = 'index.html';
        });

        // Save button
        document.getElementById('save-btn').addEventListener('click', () => {
            this._saveScenario();
        });

        // Export button
        document.getElementById('export-btn').addEventListener('click', () => {
            this._exportJSON();
        });

        // Import button
        document.getElementById('import-btn').addEventListener('click', () => {
            document.getElementById('file-input').click();
        });

        // File input
        document.getElementById('file-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this._importJSON(file);
            }
            e.target.value = ''; // Reset file input
        });

        // Undo button
        document.getElementById('undo-btn').addEventListener('click', () => {
            if (this.commandManager.undo()) {
                this._updateUndoRedoButtons();
            }
        });

        // Redo button
        document.getElementById('redo-btn').addEventListener('click', () => {
            if (this.commandManager.redo()) {
                this._updateUndoRedoButtons();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl+Z / Cmd+Z for Undo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                if (this.commandManager.undo()) {
                    this._updateUndoRedoButtons();
                }
            }
            // Ctrl+Shift+Z / Cmd+Shift+Z for Redo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
                e.preventDefault();
                if (this.commandManager.redo()) {
                    this._updateUndoRedoButtons();
                }
            }
            // Ctrl+Y / Cmd+Y for Redo (alternative)
            if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                if (this.commandManager.redo()) {
                    this._updateUndoRedoButtons();
                }
            }
        });

        // Scenario name input
        document.getElementById('scenario-name').addEventListener('change', (e) => {
            this.scenario.name = e.target.value;
            this._markDirty();
        });

        // Tool buttons
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this._selectTool(btn.dataset.tool);
            });
        });

        // Prevent accidental page leave
        window.addEventListener('beforeunload', (e) => {
            if (this.dirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    }

    _selectTool(tool) {
        this.currentTool = tool;

        // Update UI
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });

        // Update canvas cursor
        const canvas = document.getElementById('canvas');
        canvas.className = '';
        canvas.classList.add(tool + '-mode');

        // Update info text
        const infoTexts = {
            select: 'クリックで選択 | ドラッグで移動',
            source: 'クリックでSourceステーション配置',
            processing: 'クリックでProcessingステーション配置',
            drain: 'クリックでDrainステーション配置',
            connect: 'ステーションをクリックして接続作成',
            delete: 'クリックで削除'
        };
        document.getElementById('canvas-info').textContent = infoTexts[tool] || '';
    }

    _render() {
        this.canvas.render();
        this.propertiesPanel.render();
        this._updateUndoRedoButtons();
    }

    _updateUndoRedoButtons() {
        document.getElementById('undo-btn').disabled = !this.commandManager.canUndo();
        document.getElementById('redo-btn').disabled = !this.commandManager.canRedo();
    }

    addStation(type, x, y) {
        const id = `${type}-${Date.now()}`;
        const station = {
            id: id,
            type: type,
            config: this._getDefaultConfig(type),
            x: x,
            y: y
        };

        const command = new AddStationCommand(this, station);
        this.commandManager.execute(command);
        return station;
    }

    _getDefaultConfig(type) {
        const defaults = {
            source: {
                workCount: 3,
                departureTime: 5.0
            },
            processing: {
                processingTime: 2.0,
                arrivalTime: 1.0,
                departureTime: 1.0
            },
            drain: {
                arrivalTime: 1.0
            }
        };
        return defaults[type] || {};
    }

    deleteStation(stationId) {
        const command = new DeleteStationCommand(this, stationId);
        this.commandManager.execute(command);
    }

    updateStation(stationId, config) {
        const station = this.scenario.stations.find(s => s.id === stationId);
        if (station) {
            const command = new UpdateStationCommand(this, stationId, station.config, { ...station.config, ...config });
            this.commandManager.execute(command);
        }
    }

    moveStation(stationId, x, y) {
        const station = this.scenario.stations.find(s => s.id === stationId);
        if (station) {
            station.x = x;
            station.y = y;
            this._markDirty();
            this._render();
        }
    }

    addConnection(fromId, toId) {
        // Check if connection already exists
        const exists = this.scenario.connections.some(
            c => c.from === fromId && c.to === toId
        );

        if (exists) {
            alert('この接続は既に存在します');
            return;
        }

        const connection = {
            from: fromId,
            to: toId,
            condition: 'default'
        };

        const command = new AddConnectionCommand(this, connection);
        this.commandManager.execute(command);
    }

    deleteConnection(index) {
        const connection = this.scenario.connections[index];
        if (connection) {
            const command = new DeleteConnectionCommand(this, connection, index);
            this.commandManager.execute(command);
        }
    }

    selectItem(item) {
        this.selectedItem = item;
        this.propertiesPanel.render();
        this.canvas.render();
    }

    _markDirty() {
        this.dirty = true;
    }

    async _saveScenario() {
        // Validate
        const errors = validateScenario(this.scenario);
        if (errors.length > 0) {
            const confirmMsg = 'バリデーションエラー/警告:\n' + errors.join('\n') + '\n\n無視して保存しますか？';
            if (!confirm(confirmMsg)) {
                return;
            }
        }

        try {
            // Prepare scenario data for API
            const scenarioData = {
                name: this.scenario.name,
                stations: this.scenario.stations.map(s => ({
                    id: s.id,
                    type: s.type,
                    config: s.config
                })),
                connections: this.scenario.connections.map(c => ({
                    from: c.from,
                    to: c.to,
                    condition: c.condition || 'default'
                }))
            };

            // Save to API
            const response = await apiClient.createScenario(scenarioData);

            // Store scenario ID from API response
            if (response.scenarioId) {
                this.scenario.apiScenarioId = response.scenarioId;
                this.savedToAPI = true;
            }

            // Also save to localStorage
            const scenarios = JSON.parse(localStorage.getItem('sim-editor-scenarios') || '[]');
            const index = scenarios.findIndex(s => s.id === this.scenarioId);

            if (index >= 0) {
                scenarios[index] = this.scenario;
            } else {
                scenarios.push(this.scenario);
            }

            localStorage.setItem('sim-editor-scenarios', JSON.stringify(scenarios));

            this.dirty = false;
            alert(`保存しました\nシナリオID: ${response.scenarioId || 'localStorage'}`);
        } catch (error) {
            console.error('Save failed:', error);
            alert('API保存に失敗しました。localStorageに保存します。\nエラー: ' + error.message);

            // Fallback to localStorage only
            const scenarios = JSON.parse(localStorage.getItem('sim-editor-scenarios') || '[]');
            const index = scenarios.findIndex(s => s.id === this.scenarioId);

            if (index >= 0) {
                scenarios[index] = this.scenario;
            } else {
                scenarios.push(this.scenario);
            }

            localStorage.setItem('sim-editor-scenarios', JSON.stringify(scenarios));
            this.dirty = false;
            alert('localStorageに保存しました');
        }
    }

    _exportJSON() {
        const exportData = {
            name: this.scenario.name,
            description: this.scenario.description || '',
            scenario: {
                name: this.scenario.name.replace(/\s+/g, '_'),
                stations: this.scenario.stations.map(s => ({
                    id: s.id,
                    type: s.type,
                    config: s.config
                })),
                connections: this.scenario.connections.map(c => ({
                    from: c.from,
                    to: c.to
                }))
            },
            ui: {
                layout: this.scenario.stations.reduce((acc, s) => {
                    acc[s.id] = { x: s.x, y: s.y };
                    return acc;
                }, {})
            }
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `scenario-${this.scenario.name}-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);

        alert('JSONをエクスポートしました');
    }

    async _importJSON(file) {
        try {
            const text = await file.text();
            const data = JSON.parse(text);

            // Check if the JSON has the expected structure
            if (!data.scenario || !data.scenario.stations || !data.scenario.connections) {
                throw new Error('無効なJSONフォーマットです。scenario, stations, connectionsが必要です。');
            }

            // Create new scenario object
            const importedScenario = {
                id: this.scenarioId,
                name: data.name || data.scenario.name || 'インポートされたシナリオ',
                description: data.description || '',
                stations: [],
                connections: []
            };

            // Import stations
            data.scenario.stations.forEach((st, index) => {
                const station = {
                    id: st.id,
                    type: st.type,
                    config: st.config || {},
                    x: 0,
                    y: 0
                };

                // If UI layout exists, use it
                if (data.ui && data.ui.layout && data.ui.layout[st.id]) {
                    station.x = data.ui.layout[st.id].x;
                    station.y = data.ui.layout[st.id].y;
                } else {
                    // Auto-layout: arrange stations in a row
                    station.x = 100 + index * 200;
                    station.y = 300;
                }

                importedScenario.stations.push(station);
            });

            // Import connections
            data.scenario.connections.forEach(conn => {
                importedScenario.connections.push({
                    from: conn.from,
                    to: conn.to,
                    condition: conn.condition || 'default'
                });
            });

            // Replace current scenario
            this.scenario = importedScenario;
            this.selectedItem = null;
            this.commandManager.clear();

            // Update UI
            document.getElementById('scenario-name').value = importedScenario.name;

            this._markDirty();
            this._render();

            alert('JSONをインポートしました');
        } catch (error) {
            console.error('Import failed:', error);
            alert('JSONインポートに失敗しました:\n' + error.message);
        }
    }

    getStation(id) {
        return this.scenario.stations.find(s => s.id === id);
    }

    getConnection(index) {
        return this.scenario.connections[index];
    }
}

// Initialize
new ScenarioEditor();
