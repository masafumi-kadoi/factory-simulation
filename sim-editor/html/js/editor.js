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
                stations: (data.stations || []).map((s, i) => ({
                    id: s.id,
                    type: s.type,
                    locationId: s.locationId || null,
                    config: s.config || {},
                    x: (s.positionX != null) ? s.positionX : 100 + i * 200,
                    y: (s.positionY != null) ? s.positionY : 300
                })),
                connections: (data.connections || []).map(c => ({
                    from: c.from,
                    to: c.to,
                    condition: c.condition || 'default'
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
            const choice = prompt(
                '保存方法を選択してください:\n' +
                '1: 上書き保存（既存シナリオを更新）\n' +
                '2: 新規保存（新しいシナリオとして作成）\n\n' +
                '番号を入力:',
                '1'
            );
            if (choice === null) return; // cancelled
            if (choice.trim() === '2') {
                await this._saveToAPI(false);
            } else {
                await this._saveToAPI(true);
            }
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
            // Prepare scenario data for API
            const scenarioData = {
                name: this.scenario.name,
                simdbConfig: this.scenario.simdbConfig || undefined,
                stations: this.scenario.stations.map(s => ({
                    id: s.id,
                    type: s.type,
                    locationId: s.locationId || undefined,
                    config: s.config,
                    positionX: s.x,
                    positionY: s.y
                })),
                connections: this.scenario.connections.map(c => ({
                    from: c.from,
                    to: c.to,
                    condition: c.condition || 'default'
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

    getStation(id) {
        return this.scenario.stations.find(s => s.id === id);
    }

    getConnection(index) {
        return this.scenario.connections[index];
    }
}

// Initialize
new ScenarioEditor();
