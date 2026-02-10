// Scenario Editor Main
import { Canvas } from './canvas.js';
import { PropertiesPanel } from './properties.js';
import { validateScenario, validateStation } from './validation.js';

const API_BASE = 'http://localhost:8080/api';

class ScenarioEditor {
    constructor() {
        this.scenarioId = null;
        this.scenario = null;
        this.currentTool = 'select';
        this.selectedItem = null;
        this.dirty = false;

        this.canvas = null;
        this.propertiesPanel = null;

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

        this.scenario.stations.push(station);
        this._markDirty();
        this._render();
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
        // Remove station
        this.scenario.stations = this.scenario.stations.filter(s => s.id !== stationId);

        // Remove related connections
        this.scenario.connections = this.scenario.connections.filter(
            c => c.from !== stationId && c.to !== stationId
        );

        if (this.selectedItem?.type === 'station' && this.selectedItem.id === stationId) {
            this.selectedItem = null;
        }

        this._markDirty();
        this._render();
    }

    updateStation(stationId, config) {
        const station = this.scenario.stations.find(s => s.id === stationId);
        if (station) {
            station.config = { ...station.config, ...config };
            this._markDirty();
            this._render();
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

        this.scenario.connections.push({
            from: fromId,
            to: toId,
            condition: 'default'
        });

        this._markDirty();
        this._render();
    }

    deleteConnection(index) {
        this.scenario.connections.splice(index, 1);

        if (this.selectedItem?.type === 'connection' && this.selectedItem.index === index) {
            this.selectedItem = null;
        }

        this._markDirty();
        this._render();
    }

    selectItem(item) {
        this.selectedItem = item;
        this.propertiesPanel.render();
        this.canvas.render();
    }

    _markDirty() {
        this.dirty = true;
    }

    _saveScenario() {
        // Validate
        const errors = validateScenario(this.scenario);
        if (errors.length > 0) {
            alert('バリデーションエラー:\n' + errors.join('\n'));
            return;
        }

        // Save to localStorage
        const scenarios = JSON.parse(localStorage.getItem('sim-editor-scenarios') || '[]');
        const index = scenarios.findIndex(s => s.id === this.scenarioId);

        if (index >= 0) {
            scenarios[index] = this.scenario;
        } else {
            scenarios.push(this.scenario);
        }

        localStorage.setItem('sim-editor-scenarios', JSON.stringify(scenarios));

        this.dirty = false;
        alert('保存しました');
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

    getStation(id) {
        return this.scenario.stations.find(s => s.id === id);
    }

    getConnection(index) {
        return this.scenario.connections[index];
    }
}

// Initialize
new ScenarioEditor();
