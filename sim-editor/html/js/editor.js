// Scenario Editor Main
import { Canvas } from './canvas.js';
import { PropertiesPanel } from './properties.js';
import { validateScenario, validateStation } from './validation.js';
import { apiClient } from './api.js';
import { TooltipManager } from './tooltip.js';
import { InterlockModal } from './interlock-modal.js';
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
        this.interlockModal = new InterlockModal();
        this.commandManager = new CommandManager(this);
        this.tooltipManager = new TooltipManager();

        // Drill-down state for ModulerStation editing
        this._editStack = []; // Stack of { scenario, selectedItem, commandManager }
        this._currentSubScenarioPath = []; // Array of station IDs for breadcrumb

        this._init();
    }

    async _init() {
        // Get scenario ID from URL
        // 'id' = localStorage scenario, 'scenarioId' = API scenario
        const params = new URLSearchParams(window.location.search);
        this.scenarioId = params.get('id') || params.get('scenarioId');

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
        this.propertiesPanel.setInterlockModal(this.interlockModal);

        // Setup event listeners
        this._setupEventListeners();

        // Render
        this._render();
    }

    _loadScenario() {
        // Check if loading from API via scenarioId query param
        const params = new URLSearchParams(window.location.search);
        const apiScenarioId = params.get('scenarioId');

        if (apiScenarioId) {
            // Load from API
            this._loadScenarioFromAPI(apiScenarioId);
            return;
        }

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

    async _loadScenarioFromAPI(apiScenarioId) {
        try {
            const data = await apiClient.getScenario(apiScenarioId);
            this.scenarioId = apiScenarioId;
            this.scenario = {
                id: apiScenarioId,
                apiScenarioId: apiScenarioId,
                name: data.name,
                simdbConfig: data.simdbConfig || null,
                stations: (data.stations || []).map((s, i) => this._stationFromAPIData(s, i)),
                connections: (data.connections || []).map(c => ({
                    from: c.from,
                    to: c.to,
                    condition: c.condition || 'default',
                    fromPortIndex: c.fromPortIndex != null ? c.fromPortIndex : -1,
                    toPortIndex: c.toPortIndex != null ? c.toPortIndex : -1
                }))
            };
            this.savedToAPI = true;

            document.getElementById('scenario-name').value = this.scenario.name;
            this._render();
        } catch (err) {
            console.error('Failed to load from API:', err);
            alert('APIからシナリオを読み込めませんでした: ' + err.message);
        }
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
            // Don't trigger shortcuts when typing in input fields
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

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
            // Ctrl+S / Cmd+S for Save
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this._saveScenario();
            }
            // Ctrl+E / Cmd+E for Export
            if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
                e.preventDefault();
                this._exportJSON();
            }
            // Ctrl+I / Cmd+I for Import
            if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
                e.preventDefault();
                document.getElementById('file-input').click();
            }
            // Delete key to delete selected item
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                if (this.selectedItem) {
                    if (this.selectedItem.type === 'station') {
                        if (confirm('このステーションを削除しますか？')) {
                            this.deleteStation(this.selectedItem.id);
                        }
                    } else if (this.selectedItem.type === 'connection') {
                        if (confirm('この接続を削除しますか？')) {
                            this.deleteConnection(this.selectedItem.index);
                        }
                    }
                }
            }
            // Tool shortcuts: V=Select, C=Connect, D=Delete, S=Source, P=Processing, R=Drain
            if (e.key === 'v' || e.key === 'V') {
                e.preventDefault();
                this._selectTool('select');
            }
            if (e.key === 'c' || e.key === 'C') {
                e.preventDefault();
                this._selectTool('connect');
            }
            if (e.key === 'd' || e.key === 'D') {
                e.preventDefault();
                this._selectTool('delete');
            }
            if (e.key === 's' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                this._selectTool('source');
            }
            if (e.key === 'p' || e.key === 'P') {
                e.preventDefault();
                this._selectTool('processing');
            }
            if (e.key === 'r' || e.key === 'R') {
                e.preventDefault();
                this._selectTool('drain');
            }
            // Escape to deselect
            if (e.key === 'Escape') {
                e.preventDefault();
                this.selectItem(null);
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

        // Setup tooltips for tool buttons
        this._setupTooltips();

        // Grid snap toggle
        document.getElementById('grid-snap-toggle').addEventListener('change', (e) => {
            this.canvas.snapToGrid = e.target.checked;
        });

        // Auto layout button
        document.getElementById('auto-layout-btn').addEventListener('click', () => {
            this.autoLayout();
        });

        // Prevent accidental page leave
        window.addEventListener('beforeunload', (e) => {
            if (this.dirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    }

    _setupTooltips() {
        // Tool buttons tooltips
        const toolTooltips = {
            'source': 'Sourceステーション配置 (S)',
            'processing': 'Processingステーション配置 (P)',
            'drain': 'Drainステーション配置 (R)',
            'merge': 'Mergeステーション配置（複数ワークを結合）',
            'split': 'Splitステーション配置（結合ワークを分割）',
            'moduler': 'Modulerステーション配置（内部にSubScenarioを持つ階層ステーション）| ダブルクリックで内部編集',
            'select': '選択/移動モード (V)',
            'connect': '接続作成モード (C) | Shiftキー押しながらドラッグでも接続作成可能',
            'delete': '削除モード (D) | Deleteキーでも削除可能'
        };

        document.querySelectorAll('.tool-btn').forEach(btn => {
            const tool = btn.dataset.tool;
            if (toolTooltips[tool]) {
                this.tooltipManager.attach(btn, toolTooltips[tool]);
            }
        });

        // Header buttons tooltips
        this.tooltipManager.attach(document.getElementById('back-btn'), '一覧に戻る');
        this.tooltipManager.attach(document.getElementById('undo-btn'), '元に戻す (Ctrl+Z)');
        this.tooltipManager.attach(document.getElementById('redo-btn'), 'やり直し (Ctrl+Shift+Z)');
        this.tooltipManager.attach(document.getElementById('import-btn'), 'JSONインポート (Ctrl+I)');
        this.tooltipManager.attach(document.getElementById('save-btn'), 'APIに保存 (Ctrl+S)');
        this.tooltipManager.attach(document.getElementById('export-btn'), 'JSONエクスポート (Ctrl+E)');
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
            select: 'クリックで選択 | ドラッグで移動 | マウスホイールでズーム | 中ボタンドラッグでパン',
            source: 'クリックでSourceステーション配置 | マウスホイールでズーム',
            processing: 'クリックでProcessingステーション配置 | マウスホイールでズーム',
            drain: 'クリックでDrainステーション配置 | マウスホイールでズーム',
            moduler: 'クリックでModulerステーション配置 | ダブルクリックで内部編集',
            connect: 'ステーションをドラッグして接続作成 | Shiftキー+ドラッグでも可',
            delete: 'クリックで削除 | Deleteキーでも可'
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
            name: '',
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
                departureTime: 5.0,
                workType: ''
            },
            processing: {
                processingTime: 2.0,
                arrivalTime: 1.0,
                departureTime: 1.0
            },
            drain: {
                arrivalTime: 1.0
            },
            merge: {
                mergeCount: 2,
                ports: [
                    { capacity: 1 },
                    { capacity: 1 }
                ],
                outputWorkType: '',
                processingTime: 3.0,
                arrivalTime: 1.0,
                departureTime: 1.0
            },
            split: {
                splitCount: 2,
                ports: [
                    { capacity: 1 },
                    { capacity: 1 }
                ],
                processingTime: 2.0,
                arrivalTime: 1.0,
                departureTime: 1.0
            },
            moduler: {
                entryCount: 1,
                exitCount: 1,
                subScenario: {
                    stations: [
                        { id: 'entry-0', name: '', type: 'entry', config: {}, x: 100, y: 300 },
                        { id: 'exit-0', name: '', type: 'exit', config: {}, x: 700, y: 300 }
                    ],
                    connections: []
                }
            }
        };
        return defaults[type] ? JSON.parse(JSON.stringify(defaults[type])) : {};
    }

    // Auto-layout: arrange stations left-to-right using topological sort
    autoLayout() {
        const stations = this.scenario.stations;
        const connections = this.scenario.connections;
        if (stations.length === 0) return;

        // Build adjacency list and in-degree map
        const outEdges = new Map(); // stationId -> [targetStationId, ...]
        const inDegree = new Map();
        stations.forEach(s => {
            outEdges.set(s.id, []);
            inDegree.set(s.id, 0);
        });
        connections.forEach(c => {
            outEdges.get(c.from)?.push(c.to);
            inDegree.set(c.to, (inDegree.get(c.to) || 0) + 1);
        });

        // Topological sort (BFS / Kahn's algorithm) to assign layers
        const queue = [];
        stations.forEach(s => {
            if ((inDegree.get(s.id) || 0) === 0) queue.push(s.id);
        });

        const layer = new Map(); // stationId -> layer index
        let maxLayer = 0;
        while (queue.length > 0) {
            const id = queue.shift();
            const currentLayer = layer.get(id) || 0;
            if (currentLayer > maxLayer) maxLayer = currentLayer;
            for (const next of (outEdges.get(id) || [])) {
                const nextLayer = Math.max(layer.get(next) || 0, currentLayer + 1);
                layer.set(next, nextLayer);
                if (nextLayer > maxLayer) maxLayer = nextLayer;
                inDegree.set(next, (inDegree.get(next) || 0) - 1);
                if (inDegree.get(next) === 0) queue.push(next);
            }
        }

        // Assign unvisited stations (cycles or disconnected) to layer 0
        stations.forEach(s => {
            if (!layer.has(s.id)) layer.set(s.id, 0);
        });

        // Group stations by layer
        const layers = [];
        for (let i = 0; i <= maxLayer; i++) layers.push([]);
        stations.forEach(s => {
            layers[layer.get(s.id)].push(s);
        });

        // Layout parameters
        const xStart = 200;
        const xGap = 200;   // horizontal gap between layers
        const yStart = 150;
        const yGap = 120;   // vertical gap between stations in same layer

        // Position each station
        layers.forEach((layerStations, layerIdx) => {
            const totalHeight = (layerStations.length - 1) * yGap;
            const baseY = yStart + (600 - totalHeight) / 2; // center vertically in ~600px area

            layerStations.forEach((station, i) => {
                station.x = this.canvas._snapToGrid(xStart + layerIdx * xGap);
                station.y = this.canvas._snapToGrid(baseY + i * yGap);
            });
        });

        this._markDirty();
        this._render();
    }

    deleteStation(stationId) {
        // Prevent deletion of Entry/Exit stations inside SubScenario
        const station = this.getStation(stationId);
        if (station && (station.type === 'entry' || station.type === 'exit') && this.isInSubScenario()) {
            alert('Entry/Exitステーションは削除できません。親ステーションのプロパティでEntry/Exit数を変更してください。');
            return;
        }
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

    addConnection(fromId, toId, fromPortIndex = -1, toPortIndex = -1) {
        // Check if connection already exists (same from/to and port indices)
        const exists = this.scenario.connections.some(
            c => c.from === fromId && c.to === toId &&
                 (c.fromPortIndex || -1) === fromPortIndex &&
                 (c.toPortIndex || -1) === toPortIndex
        );

        if (exists) {
            alert('この接続は既に存在します');
            return;
        }

        // Check 1:1 port constraint: each port can only have one connection
        if (toPortIndex >= 0) {
            const portTaken = this.scenario.connections.some(
                c => c.to === toId && c.toPortIndex === toPortIndex
            );
            if (portTaken) {
                alert('このポートには既に接続があります');
                return;
            }
        }
        if (fromPortIndex >= 0) {
            const portTaken = this.scenario.connections.some(
                c => c.from === fromId && c.fromPortIndex === fromPortIndex
            );
            if (portTaken) {
                alert('このポートには既に接続があります');
                return;
            }
        }

        const connection = {
            from: fromId,
            to: toId,
            condition: 'default',
            fromPortIndex: fromPortIndex,
            toPortIndex: toPortIndex
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

    _showSaveDialog() {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'save-dialog-overlay';

            const dialog = document.createElement('div');
            dialog.className = 'save-dialog';
            dialog.innerHTML = `
                <div class="save-dialog-title">保存方法を選択</div>
                <div class="save-dialog-buttons">
                    <button class="btn-primary save-dialog-btn" data-choice="overwrite">上書き保存</button>
                    <button class="btn-secondary save-dialog-btn" data-choice="new">別名で保存</button>
                    <button class="btn-cancel save-dialog-btn" data-choice="cancel">キャンセル</button>
                </div>
            `;

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            const cleanup = (choice) => {
                document.body.removeChild(overlay);
                resolve(choice);
            };

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) cleanup(null);
            });

            dialog.querySelectorAll('.save-dialog-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const choice = btn.dataset.choice;
                    if (choice === 'cancel') cleanup(null);
                    else if (choice === 'new') cleanup('new');
                    else cleanup('overwrite');
                });
            });
        });
    }

    async _saveScenario() {
        // Validate
        const { errors, warnings } = validateScenario(this.scenario);

        if (errors.length > 0) {
            const confirmMsg = 'バリデーションエラー:\n' + errors.join('\n')
                + (warnings.length > 0 ? '\n\n警告:\n' + warnings.join('\n') : '')
                + '\n\nエラーを無視して保存しますか？';
            if (!confirm(confirmMsg)) {
                return;
            }
        } else if (warnings.length > 0) {
            // Warnings only — show informational message but don't block
            const infoMsg = '警告:\n' + warnings.join('\n') + '\n\n保存を続行します。';
            alert(infoMsg);
        }

        // If this scenario was loaded from API, ask whether to overwrite or save as new
        if (this.scenario.apiScenarioId) {
            const choice = await this._showSaveDialog();
            if (choice === null) return; // cancelled
            await this._saveToAPI(choice === 'overwrite');
        } else {
            await this._saveToAPI(false);
        }
    }

    // Save to API without validation dialog (used by properties panel for auto-save before SimDB test)
    async saveToAPIQuiet() {
        const { errors } = validateScenario(this.scenario);
        // Block only on structural errors, not warnings
        if (errors.length > 0) {
            throw new Error('バリデーションエラーがあるため保存できません:\n' + errors.join('\n'));
        }
        // Overwrite if already saved to API, otherwise create new
        await this._saveToAPI(!!this.scenario.apiScenarioId);
    }

    async _saveToAPI(overwrite = false) {
        try {
            // Before saving, drill all the way up to root to ensure SubScenarios are saved
            while (this._editStack.length > 0) {
                if (this.scenario._parentStation) {
                    this.scenario._parentStation.config.subScenario = {
                        stations: this.scenario.stations,
                        connections: this.scenario.connections
                    };
                }
                const prev = this._editStack.pop();
                this._currentSubScenarioPath.pop();
                this.scenario = prev.scenario;
                this.selectedItem = prev.selectedItem;
                this.commandManager = prev.commandManager;
            }
            this._updateBreadcrumb();

            // Prepare scenario data for API
            const scenarioData = {
                name: this.scenario.name,
                simdbConfig: this.scenario.simdbConfig || undefined,
                stations: this.scenario.stations.map(s => this._stationToAPIData(s)),
                connections: this.scenario.connections.map(c => ({
                    from: c.from,
                    to: c.to,
                    condition: c.condition || 'default',
                    fromPortIndex: c.fromPortIndex != null ? c.fromPortIndex : -1,
                    toPortIndex: c.toPortIndex != null ? c.toPortIndex : -1
                }))
            };

            let response;
            if (overwrite && this.scenario.apiScenarioId) {
                // Overwrite existing scenario
                response = await apiClient.updateScenario(this.scenario.apiScenarioId, scenarioData);
            } else {
                // Create new scenario
                response = await apiClient.createScenario(scenarioData);
            }

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
            const saveType = overwrite ? '上書き保存' : '新規保存';
            alert(`${saveType}しました\nシナリオID: ${response.scenarioId || 'localStorage'}`);
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
            simdbConfig: this.scenario.simdbConfig || undefined,
            scenario: {
                name: this.scenario.name.replace(/\s+/g, '_'),
                stations: this.scenario.stations.map(s => ({
                    id: s.id,
                    type: s.type,
                    locationId: s.locationId || undefined,
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

    _stationFromAPIData(s, i = 0) {
        const station = {
            id: s.id,
            name: s.name || '',
            type: s.type,
            locationId: s.locationId || null,
            config: s.config || {},
            x: (s.positionX != null) ? s.positionX : 100 + i * 200,
            y: (s.positionY != null) ? s.positionY : 300
        };

        // Reconstruct moduler station subScenario
        if (s.type === 'moduler' && s.subScenario) {
            station.config.entryCount = s.entryCount || 1;
            station.config.exitCount = s.exitCount || 1;
            station.config.subScenario = {
                stations: (s.subScenario.stations || []).map((sub, j) => this._stationFromAPIData(sub, j)),
                connections: (s.subScenario.connections || []).map(c => ({
                    from: c.from,
                    to: c.to,
                    condition: c.condition || 'default',
                    fromPortIndex: c.fromPortIndex != null ? c.fromPortIndex : -1,
                    toPortIndex: c.toPortIndex != null ? c.toPortIndex : -1
                }))
            };
        }

        return station;
    }

    _stationToAPIData(s) {
        const data = {
            id: s.id,
            name: s.name || '',
            type: s.type,
            locationId: s.locationId || undefined,
            config: s.config,
            positionX: s.x,
            positionY: s.y
        };

        // For moduler stations, include entryCount, exitCount, subScenario
        if (s.type === 'moduler' && s.config.subScenario) {
            data.entryCount = s.config.entryCount || 1;
            data.exitCount = s.config.exitCount || 1;
            data.subScenario = {
                stations: (s.config.subScenario.stations || []).map(sub => this._stationToAPIData(sub)),
                connections: (s.config.subScenario.connections || []).map(c => ({
                    from: c.from,
                    to: c.to,
                    condition: c.condition || 'default',
                    fromPortIndex: c.fromPortIndex != null ? c.fromPortIndex : -1,
                    toPortIndex: c.toPortIndex != null ? c.toPortIndex : -1
                }))
            };
        }

        return data;
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
                simdbConfig: data.simdbConfig || null,
                stations: [],
                connections: []
            };

            // Import stations
            data.scenario.stations.forEach((st, index) => {
                const station = {
                    id: st.id,
                    type: st.type,
                    locationId: st.locationId || null,
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

    // --- Drill-down / Drill-up for ModulerStation ---

    drillDown(stationId) {
        const station = this.scenario.stations.find(s => s.id === stationId);
        if (!station || station.type !== 'moduler') return;
        if (!station.config.subScenario) return;

        // Push current state to stack
        this._editStack.push({
            scenario: this.scenario,
            selectedItem: this.selectedItem,
            commandManager: this.commandManager
        });
        this._currentSubScenarioPath.push(stationId);

        // Create a virtual scenario from the SubScenario
        const sub = station.config.subScenario;
        this.scenario = {
            id: this.scenario.id,
            name: this.scenario.name,
            stations: sub.stations || [],
            connections: sub.connections || [],
            _parentStation: station, // reference back to parent for saving
            _isSubScenario: true
        };

        // Reset selection and command manager
        this.selectedItem = null;
        this.commandManager = new CommandManager(this);

        // Auto-place Entry/Exit if positions not set
        this._autoPlaceEntryExit();

        // Update breadcrumb
        this._updateBreadcrumb();

        this._render();
    }

    drillUp() {
        if (this._editStack.length === 0) return;

        // Save current SubScenario back to parent station
        if (this.scenario._parentStation) {
            this.scenario._parentStation.config.subScenario = {
                stations: this.scenario.stations,
                connections: this.scenario.connections
            };
        }

        // Pop state from stack
        const prev = this._editStack.pop();
        this._currentSubScenarioPath.pop();

        this.scenario = prev.scenario;
        this.selectedItem = prev.selectedItem;
        this.commandManager = prev.commandManager;

        this._markDirty();
        this._updateBreadcrumb();
        this._render();
    }

    drillToDepth(depth) {
        // Drill up until we reach the target depth
        while (this._editStack.length > depth) {
            // Save current SubScenario back
            if (this.scenario._parentStation) {
                this.scenario._parentStation.config.subScenario = {
                    stations: this.scenario.stations,
                    connections: this.scenario.connections
                };
            }
            const prev = this._editStack.pop();
            this._currentSubScenarioPath.pop();
            this.scenario = prev.scenario;
            this.selectedItem = prev.selectedItem;
            this.commandManager = prev.commandManager;
        }

        this._markDirty();
        this._updateBreadcrumb();
        this._render();
    }

    _autoPlaceEntryExit() {
        const entries = this.scenario.stations.filter(s => s.type === 'entry');
        const exits = this.scenario.stations.filter(s => s.type === 'exit');

        // Place entries on the left
        const entryX = 100;
        const exitX = 700;
        const yStart = 200;
        const yGap = 100;

        entries.forEach((entry, i) => {
            if (entry.x === 0 && entry.y === 0) {
                entry.x = entryX;
                entry.y = yStart + i * yGap;
            }
        });

        exits.forEach((exit, i) => {
            if (exit.x === 0 && exit.y === 0) {
                exit.x = exitX;
                exit.y = yStart + i * yGap;
            }
        });
    }

    _updateBreadcrumb() {
        const breadcrumb = document.getElementById('breadcrumb');
        if (!breadcrumb) return;

        if (this._editStack.length === 0) {
            breadcrumb.style.display = 'none';
            return;
        }

        breadcrumb.style.display = 'flex';
        breadcrumb.innerHTML = '';

        // Root item
        const rootSpan = document.createElement('span');
        rootSpan.className = 'breadcrumb-item breadcrumb-root';
        rootSpan.textContent = 'Root';
        rootSpan.dataset.depth = '0';
        rootSpan.addEventListener('click', () => this.drillToDepth(0));
        breadcrumb.appendChild(rootSpan);

        // Path items
        this._currentSubScenarioPath.forEach((stationId, i) => {
            const sep = document.createElement('span');
            sep.className = 'breadcrumb-separator';
            sep.textContent = ' > ';
            breadcrumb.appendChild(sep);

            const item = document.createElement('span');
            item.className = 'breadcrumb-item';
            if (i === this._currentSubScenarioPath.length - 1) {
                item.classList.add('breadcrumb-current');
            }
            item.textContent = stationId;
            item.dataset.depth = String(i + 1);
            item.addEventListener('click', () => this.drillToDepth(i + 1));
            breadcrumb.appendChild(item);
        });
    }

    isInSubScenario() {
        return this._editStack.length > 0;
    }

    // Auto-connect unconnected Entry/Exit to nearest station
    autoConnectEntryExit() {
        if (!this.isInSubScenario()) return;
        const entries = this.scenario.stations.filter(s => s.type === 'entry');
        const exits = this.scenario.stations.filter(s => s.type === 'exit');
        const others = this.scenario.stations.filter(s => s.type !== 'entry' && s.type !== 'exit');

        entries.forEach(entry => {
            // Check if already connected (outgoing)
            const hasOutgoing = this.scenario.connections.some(c => c.from === entry.id);
            if (hasOutgoing || others.length === 0) return;

            // Find nearest non-entry/exit station
            const nearest = this._findNearestStation(entry, others);
            if (nearest) {
                this.scenario.connections.push({
                    from: entry.id, to: nearest.id,
                    condition: 'default', fromPortIndex: -1, toPortIndex: -1
                });
            }
        });

        exits.forEach(exit => {
            // Check if already connected (incoming)
            const hasIncoming = this.scenario.connections.some(c => c.to === exit.id);
            if (hasIncoming || others.length === 0) return;

            const nearest = this._findNearestStation(exit, others);
            if (nearest) {
                this.scenario.connections.push({
                    from: nearest.id, to: exit.id,
                    condition: 'default', fromPortIndex: -1, toPortIndex: -1
                });
            }
        });

        this._markDirty();
        this._render();
    }

    _findNearestStation(target, candidates) {
        let nearest = null;
        let minDist = Infinity;

        candidates.forEach(c => {
            const dx = c.x - target.x;
            const dy = c.y - target.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDist || (dist === minDist && nearest && (
                c.y < nearest.y || (c.y === nearest.y && (c.x < nearest.x || (c.x === nearest.x && c.id < nearest.id)))
            ))) {
                minDist = dist;
                nearest = c;
            }
        });

        return nearest;
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
