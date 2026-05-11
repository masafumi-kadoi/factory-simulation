// Scenario Editor Main
import { Canvas } from './canvas.js';
import { PropertiesPanel } from './properties.js';
import { ModelEditor } from './model-editor.js';
import { Editor3DView } from './editor-3d-view.js';
import { validateScenario, validateStation } from './validation.js';
import { apiClient } from './api.js';
import { TooltipManager } from './tooltip.js';
import { InterlockModal } from './interlock-modal.js';
import { MenuBar } from './menubar.js';
import { ThemeManager } from './theme.js';
import { Clipboard } from './clipboard.js';
import { ContextMenu } from './context-menu.js';
import { Minimap } from './minimap.js';
import { SearchBar } from './search.js';
import { BufferConveyorDialog } from './buffer-conveyor-dialog.js';
// MouseConfig is loaded dynamically to avoid blocking the editor if the shared module is unavailable
let MouseConfig, MouseConfigModal, injectMouseConfigCSS;
try {
    const mod = await import('../shared/js/mouse-config.js');
    MouseConfig = mod.MouseConfig;
    MouseConfigModal = mod.MouseConfigModal;
    injectMouseConfigCSS = mod.injectMouseConfigCSS;
} catch (e) {
    console.warn('[Editor] mouse-config.js not available, using defaults:', e.message);
}
import {
    CommandManager,
    AddStationCommand,
    DeleteStationCommand,
    UpdateStationCommand,
    MoveStationCommand,
    MoveMultipleStationsCommand,
    DeleteMultipleStationsCommand,
    AddConnectionCommand,
    DeleteConnectionCommand
} from './undo.js';

class ScenarioEditor {
    constructor() {
        this.scenarioId = null;
        this.scenario = null;
        this.currentTool = 'select';
        this.selectedItem = null;        // Single selection (backward compat): {type:'station',id} or {type:'connection',index}
        this.selectedStationIds = new Set(); // Multi-select: set of station IDs
        this.dirty = false;
        this.savedToAPI = false; // Track if scenario was saved to API

        this.canvas = null;
        this.propertiesPanel = null;
        this.menuBar = null;
        this.themeManager = new ThemeManager();
        this.clipboard = new Clipboard(this);
        this.contextMenu = new ContextMenu(this);
        this.minimap = null;
        this.searchBar = null;
        this.interlockModal = new InterlockModal();
        this.commandManager = new CommandManager(this);
        this.tooltipManager = new TooltipManager();
        this.mouseConfig = MouseConfig ? new MouseConfig('editor') : null;
        this._mouseConfigModal = (MouseConfigModal && this.mouseConfig) ? new MouseConfigModal(this.mouseConfig) : null;
        if (injectMouseConfigCSS) injectMouseConfigCSS();

        // Settings
        this._lineStyle = localStorage.getItem('sim-editor-line-style') || 'bezier';
        this._minimapVisible = localStorage.getItem('sim-editor-minimap') !== 'false';
        this._gridSnap = localStorage.getItem('sim-editor-grid-snap') === 'true';
        this._alignmentGuide = localStorage.getItem('sim-editor-alignment-guide') !== 'false';

        // Drill-down state for ModulerStation editing
        this._editStack = []; // Stack of { scenario, selectedItem, commandManager }
        this._currentSubScenarioPath = []; // Array of station IDs for breadcrumb

        // Model editing mode
        this._editMode = 'logic'; // 'logic' | 'model'
        this._modelEditor = null;

        this._init();
    }

    async _init() {
        // Get scenario ID from URL
        // 'id' = localStorage scenario, 'scenarioId' = API scenario, 'new=1' = create blank
        const params = new URLSearchParams(window.location.search);
        const isNew = params.get('new') === '1';
        this.scenarioId = params.get('id') || params.get('scenarioId');

        if (isNew && !this.scenarioId) {
            // Create a blank scenario in localStorage and redirect
            const newId = 'scenario-' + Date.now();
            const factoryId = params.get('factoryId');
            const blank = {
                id: newId,
                name: '新規シナリオ',
                factoryId: factoryId || null,
                stations: [],
                connections: [],
                updatedAt: new Date().toISOString()
            };
            const scenarios = JSON.parse(localStorage.getItem('sim-editor-scenarios') || '[]');
            scenarios.push(blank);
            localStorage.setItem('sim-editor-scenarios', JSON.stringify(scenarios));
            const redirect = `editor.html?id=${newId}${factoryId ? '&factoryId=' + encodeURIComponent(factoryId) : ''}`;
            window.location.href = redirect;
            return;
        }

        if (!this.scenarioId) {
            alert('シナリオIDが指定されていません');
            window.location.href = 'index.html';
            return;
        }

        // Initialize menu bar (must be before _loadScenario so #scenario-name input exists)
        this.menuBar = new MenuBar(document.getElementById('menubar'), this);

        // Load scenario first (must complete before any render)
        await this._loadScenario();
        if (!this.scenario) return; // redirect happened

        // Initialize canvas and properties panel
        this.canvas = new Canvas(document.getElementById('canvas'), this);
        this.canvas.snapToGrid = this._gridSnap;
        this.propertiesPanel = new PropertiesPanel(document.getElementById('properties-content'), this);
        this.propertiesPanel.setInterlockModal(this.interlockModal);

        // 3D view
        this._editor3DView = new Editor3DView(document.getElementById('editor-3d-canvas'));
        this._is3DMode = false;
        this._setup3DToggle();

        // Initialize minimap and search
        this.minimap = new Minimap(this);
        this.searchBar = new SearchBar(this);

        // Setup event listeners
        this._setupEventListeners();

        // Render
        this._render();
    }

    async _loadScenario() {
        // Check if loading from API via scenarioId query param
        const params = new URLSearchParams(window.location.search);
        const apiScenarioId = params.get('scenarioId');

        if (apiScenarioId) {
            // Load from API
            await this._loadScenarioFromAPI(apiScenarioId);
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
            const urlParams = new URLSearchParams(window.location.search);
            this.scenario = {
                id: apiScenarioId,
                apiScenarioId: apiScenarioId,
                name: data.name,
                factoryId: data.factoryId || urlParams.get('factoryId') || null,
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
        // File input
        document.getElementById('file-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this._importJSON(file);
            }
            e.target.value = '';
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                // Allow Cmd+S even in input fields
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    this._saveScenario();
                }
                return;
            }

            // Ctrl+Z / Cmd+Z for Undo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                this.triggerUndo();
            }
            // Ctrl+Shift+Z / Cmd+Shift+Z for Redo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
                e.preventDefault();
                this.triggerRedo();
            }
            // Ctrl+Y / Cmd+Y for Redo (alternative)
            if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                this.triggerRedo();
            }
            // Ctrl+C / Cmd+C for Copy
            if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
                e.preventDefault();
                this.triggerCopy();
            }
            // Ctrl+X / Cmd+X for Cut
            if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
                e.preventDefault();
                this.triggerCut();
            }
            // Ctrl+V / Cmd+V for Paste
            if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
                e.preventDefault();
                this.triggerPaste();
            }
            // Ctrl+S / Cmd+S for Save
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this._saveScenario();
            }
            // Ctrl+0 / Cmd+0 for Fit to Screen
            if ((e.ctrlKey || e.metaKey) && e.key === '0') {
                e.preventDefault();
                this.triggerFitToScreen();
            }
            // Ctrl+F / Cmd+F for Search
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                if (this.searchBar) this.searchBar.toggle();
            }
            // Ctrl+A / Cmd+A for Select All
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                e.preventDefault();
                this.selectAll();
            }
            // Delete key to delete selected item(s)
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                if (this.selectedStationIds.size > 1) {
                    if (confirm(`${this.selectedStationIds.size}個のステーションを削除しますか？`)) {
                        this.deleteMultipleStations([...this.selectedStationIds]);
                    }
                } else if (this.selectedItem) {
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
            // Tool shortcuts (only without modifier keys)
            if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
                if (e.key === 'v') { e.preventDefault(); this._selectTool('select'); }
                if (e.key === 'c') { e.preventDefault(); this._selectTool('connect'); }
                if (e.key === 'd') { e.preventDefault(); this._selectTool('delete'); }
                if (e.key === 's') { e.preventDefault(); this._selectTool('source'); }
                if (e.key === 'p') { e.preventDefault(); this._selectTool('processing'); }
                if (e.key === 'r') { e.preventDefault(); this._selectTool('drain'); }
            }
            // Escape to deselect
            if (e.key === 'Escape') { e.preventDefault(); this.selectItem(null); }
        });

        // Tool buttons
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this._selectTool(btn.dataset.tool);
            });
        });

        // Setup tooltips for tool buttons
        this._setupTooltips();

        // Grid snap toggle (in tool palette)
        const gridToggle = document.getElementById('grid-snap-toggle');
        if (gridToggle) {
            gridToggle.checked = this._gridSnap;
            gridToggle.addEventListener('change', (e) => {
                this._gridSnap = e.target.checked;
                this.canvas.snapToGrid = this._gridSnap;
                localStorage.setItem('sim-editor-grid-snap', this._gridSnap);
            });
        }

        // Auto layout button (in tool palette)
        const autoLayoutBtn = document.getElementById('auto-layout-btn');
        if (autoLayoutBtn) {
            autoLayoutBtn.addEventListener('click', () => {
                this.autoLayout();
            });
        }

        // Buffer conveyor template button
        const bufferConveyorBtn = document.getElementById('buffer-conveyor-btn');
        if (bufferConveyorBtn) {
            bufferConveyorBtn.addEventListener('click', () => {
                const dialog = new BufferConveyorDialog(this);
                dialog.open();
            });
        }

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

    }

    _selectTool(tool) {
        this.currentTool = tool;

        // Update UI
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });

        // Update canvas cursor
        const canvas = document.getElementById('canvas');
        canvas.setAttribute('class', tool + '-mode');

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
        if (!this.scenario) return; // Not loaded yet
        if (!this.canvas) return; // Not initialized yet (during async _loadScenarioFromAPI)
        const svg = document.getElementById('canvas');
        if (svg) svg.classList.toggle('sub-scenario', this.isInSubScenario());
        this.canvas.render();
        // Skip properties re-render if user is actively editing inside the panel
        const active = document.activeElement;
        const propsContainer = this.propertiesPanel?.container;
        if (!active || !propsContainer || !propsContainer.contains(active)) {
            this.propertiesPanel.render();
        }
        this._updateUndoRedoButtons();
        if (this.minimap) this.minimap.render();
    }

    _updateUndoRedoButtons() {
        // No-op: undo/redo state is checked dynamically by menu dropdown
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

    addStationFull(station) {
        const command = new AddStationCommand(this, station);
        this.commandManager.execute(command);
        return station;
    }

    getViewCenter() {
        if (!this.canvas) return { x: 500, y: 300 };
        const vb = this.canvas.viewBox;
        return { x: vb.x + vb.width / 2, y: vb.y + vb.height / 2 };
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
                inPorts: [
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
                outPorts: [
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

        // Build port-ordered adjacency (for fan-out/fan-in ordering)
        const portOutEdges = new Map(); // stationId -> [{to, portIndex}]
        const portInEdges = new Map();  // stationId -> [{from, portIndex}]
        stations.forEach(s => {
            portOutEdges.set(s.id, []);
            portInEdges.set(s.id, []);
        });
        connections.forEach(c => {
            portOutEdges.get(c.from)?.push({to: c.to, portIndex: c.fromPortIndex ?? -1});
            portInEdges.get(c.to)?.push({from: c.from, portIndex: c.toPortIndex ?? -1});
        });
        portOutEdges.forEach(arr => arr.sort((a, b) => a.portIndex - b.portIndex));
        portInEdges.forEach(arr => arr.sort((a, b) => a.portIndex - b.portIndex));

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

        // ALAP (As Late As Possible) scheduling:
        // Shift each node as far right as possible (to successor layer - 1).
        // This keeps critical paths unchanged but moves shorter branches closer
        // to their junction, so e.g. all moduler inputs are in adjacent columns.
        // Process right-to-left: sort stations by layer descending, then adjust.
        const stationsByLayerDesc = [...stations].sort(
            (a, b) => (layer.get(b.id) || 0) - (layer.get(a.id) || 0)
        );
        for (const s of stationsByLayerDesc) {
            const succs = outEdges.get(s.id) || [];
            if (succs.length === 0) continue;
            const minSuccLayer = Math.min(...succs.map(t => layer.get(t) ?? maxLayer));
            const alapLayer = minSuccLayer - 1;
            if (alapLayer > (layer.get(s.id) || 0)) {
                layer.set(s.id, alapLayer);
            }
        }

        // Recalculate maxLayer and rebuild layer groups
        maxLayer = 0;
        stations.forEach(s => { maxLayer = Math.max(maxLayer, layer.get(s.id) || 0); });

        // Build reverse adjacency (predecessors)
        const inEdges = new Map();
        stations.forEach(s => inEdges.set(s.id, []));
        connections.forEach(c => {
            inEdges.get(c.to)?.push(c.from);
        });

        // Group stations by layer
        const layerGroups = [];
        for (let i = 0; i <= maxLayer; i++) layerGroups.push([]);
        stations.forEach(s => layerGroups[layer.get(s.id)].push(s));

        // Reverse-junction Y-ordering: process junctions from right to left,
        // spreading branches by port order. This ensures all port orderings
        // are globally consistent and lines don't cross.
        const yOrder = new Map();

        // Trace backward along chain (single-pred, pred has single-succ) and assign Y
        const traceBackAssign = (startId, y) => {
            let cur = startId;
            for (let i = 0; i < 1000; i++) {
                if (yOrder.has(cur)) break;
                yOrder.set(cur, y);
                const preds = inEdges.get(cur) || [];
                if (preds.length !== 1) break;
                const prev = preds[0];
                if ((outEdges.get(prev) || []).length !== 1) break;
                cur = prev;
            }
        };

        // Trace forward along chain (single-succ, succ has single-pred) and assign Y
        const traceFwdAssign = (startId, y) => {
            let cur = startId;
            for (let i = 0; i < 1000; i++) {
                if (yOrder.has(cur)) break;
                yOrder.set(cur, y);
                const succs = outEdges.get(cur) || [];
                if (succs.length !== 1) break;
                const next = succs[0];
                if ((inEdges.get(next) || []).length !== 1) break;
                cur = next;
            }
        };

        // Find junctions (multi-input or multi-output) sorted by:
        // 1. Layer descending (rightmost first)
        // 2. At same layer: more connections first (larger junction gets priority)
        const junctions = stations.filter(s => {
            const inCount = (inEdges.get(s.id) || []).length;
            const outCount = (outEdges.get(s.id) || []).length;
            return inCount > 1 || outCount > 1;
        });
        junctions.sort((a, b) => {
            const layerDiff = (layer.get(b.id) || 0) - (layer.get(a.id) || 0);
            if (layerDiff !== 0) return layerDiff;
            const connA = (inEdges.get(a.id) || []).length + (outEdges.get(a.id) || []).length;
            const connB = (inEdges.get(b.id) || []).length + (outEdges.get(b.id) || []).length;
            return connB - connA;
        });

        // Process each junction: determine its Y, spread its branches
        junctions.forEach(j => {
            const jId = j.id;
            const pIn = [...(portInEdges.get(jId) || [])].sort((a, b) => a.portIndex - b.portIndex);
            const pOut = [...(portOutEdges.get(jId) || [])].sort((a, b) => a.portIndex - b.portIndex);
            let jY = yOrder.get(jId);

            if (jY === undefined) {
                // Try Y from assigned successors (set by earlier/rightward junction)
                const succYs = (outEdges.get(jId) || []).filter(s => yOrder.has(s)).map(s => yOrder.get(s));
                if (succYs.length > 0) {
                    jY = succYs.reduce((a, b) => a + b, 0) / succYs.length;
                }
            }
            if (jY === undefined) {
                // Try Y from assigned predecessors
                const predYs = (inEdges.get(jId) || []).filter(p => yOrder.has(p)).map(p => yOrder.get(p));
                if (predYs.length > 0) {
                    predYs.sort((a, b) => a - b);
                    jY = predYs[Math.floor(predYs.length / 2)];
                }
            }
            if (jY === undefined) {
                // No context from neighbors: place below all assigned Y values
                const allYs = Array.from(yOrder.values());
                const maxUsedY = allYs.length > 0 ? Math.max(...allYs) : -1;
                const branchCount = Math.max(pIn.length, pOut.length);
                jY = maxUsedY + 1 + (branchCount - 1) / 2;
            }
            yOrder.set(jId, jY);

            // Spread fan-in inputs by toPortIndex order
            if (pIn.length > 1) {
                const half = (pIn.length - 1) / 2;
                pIn.forEach((e, i) => {
                    const inputY = jY + (i - half);
                    if (!yOrder.has(e.from)) traceBackAssign(e.from, inputY);
                });
            } else if (pIn.length === 1 && !yOrder.has(pIn[0].from)) {
                traceBackAssign(pIn[0].from, jY);
            }

            // Spread fan-out outputs by fromPortIndex order
            if (pOut.length > 1) {
                const half = (pOut.length - 1) / 2;
                pOut.forEach((e, i) => {
                    const outputY = jY + (i - half);
                    if (!yOrder.has(e.to)) traceFwdAssign(e.to, outputY);
                });
            } else if (pOut.length === 1 && !yOrder.has(pOut[0].to)) {
                traceFwdAssign(pOut[0].to, jY);
            }
        });

        // Assign any remaining unvisited stations (no junction in path)
        // Process left-to-right, inheriting predecessor Y or assigning new row
        let nextRow = Math.max(0, ...Array.from(yOrder.values()).map(v => Math.ceil(v))) + 1;
        for (let li = 0; li <= maxLayer; li++) {
            for (const s of layerGroups[li]) {
                if (yOrder.has(s.id)) continue;
                const preds = (inEdges.get(s.id) || []).filter(p => yOrder.has(p));
                if (preds.length > 0) {
                    yOrder.set(s.id, yOrder.get(preds[0]));
                } else {
                    yOrder.set(s.id, nextRow++);
                }
            }
        }

        // Within each layer: resolve collisions while preserving cross-layer alignment
        for (let li = 0; li <= maxLayer; li++) {
            const group = layerGroups[li];
            group.sort((a, b) => (yOrder.get(a.id) || 0) - (yOrder.get(b.id) || 0));
            // Round to integers and push down only when overlapping
            for (let i = 0; i < group.length; i++) {
                let y = Math.round(yOrder.get(group[i].id) || 0);
                if (i > 0) {
                    const prevY = yOrder.get(group[i - 1].id);
                    if (y <= prevY) y = prevY + 1;
                }
                yOrder.set(group[i].id, y);
            }
        }

        // Normalize: shift so minimum Y = 0
        let minY = Infinity;
        stations.forEach(s => { minY = Math.min(minY, yOrder.get(s.id) ?? 0); });

        // Layout parameters
        const xStart = 200;
        const xGap = 200;
        const yStart = 150;
        const yGap = 120;

        stations.forEach(station => {
            const li = layer.get(station.id);
            const yi = (yOrder.get(station.id) || 0) - minY;
            station.x = this.canvas._snapToGrid(xStart + li * xGap);
            station.y = this.canvas._snapToGrid(yStart + yi * yGap);
        });

        this._markDirty();
        this._render();
        this.triggerFitToScreen();
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

    deleteMultipleStations(stationIds) {
        // Filter out Entry/Exit if in SubScenario
        const filtered = stationIds.filter(id => {
            const s = this.getStation(id);
            if (s && (s.type === 'entry' || s.type === 'exit') && this.isInSubScenario()) return false;
            return true;
        });
        if (filtered.length === 0) return;
        const command = new DeleteMultipleStationsCommand(this, filtered);
        this.commandManager.execute(command);
    }

    selectItem(item) {
        this.selectedItem = item;
        this.selectedStationIds.clear();
        if (item && item.type === 'station') {
            this.selectedStationIds.add(item.id);
        }
        this.propertiesPanel?.render();
        this.canvas?.render();
    }

    // Multi-select: add a station to selection
    addToSelection(stationId) {
        this.selectedStationIds.add(stationId);
        if (this.selectedStationIds.size === 1) {
            this.selectedItem = { type: 'station', id: stationId };
        } else {
            this.selectedItem = { type: 'multi', ids: [...this.selectedStationIds] };
        }
        this.propertiesPanel?.render();
        this.canvas?.render();
    }

    // Multi-select: toggle a station in selection
    toggleInSelection(stationId) {
        if (this.selectedStationIds.has(stationId)) {
            this.selectedStationIds.delete(stationId);
        } else {
            this.selectedStationIds.add(stationId);
        }
        if (this.selectedStationIds.size === 0) {
            this.selectedItem = null;
        } else if (this.selectedStationIds.size === 1) {
            this.selectedItem = { type: 'station', id: [...this.selectedStationIds][0] };
        } else {
            this.selectedItem = { type: 'multi', ids: [...this.selectedStationIds] };
        }
        this.propertiesPanel?.render();
        this.canvas?.render();
    }

    // Multi-select: set selection to a set of station IDs
    setSelection(stationIds) {
        this.selectedStationIds = new Set(stationIds);
        if (this.selectedStationIds.size === 0) {
            this.selectedItem = null;
        } else if (this.selectedStationIds.size === 1) {
            this.selectedItem = { type: 'station', id: [...this.selectedStationIds][0] };
        } else {
            this.selectedItem = { type: 'multi', ids: [...this.selectedStationIds] };
        }
        this.propertiesPanel?.render();
        this.canvas?.render();
    }

    selectAll() {
        const ids = this.scenario.stations.map(s => s.id);
        this.setSelection(ids);
    }

    isStationSelected(stationId) {
        return this.selectedStationIds.has(stationId);
    }

    _markDirty() {
        this.dirty = true;
        if (this.menuBar) this.menuBar.updateSaveIndicator('unsaved');
    }

    _markClean() {
        this.dirty = false;
        if (this.menuBar) this.menuBar.updateSaveIndicator('saved');
    }

    // --- MenuBar bridge methods ---
    triggerImport() { document.getElementById('file-input').click(); }
    triggerExport() { this._exportJSON(); }
    triggerSave() { this._saveScenario(); }
    triggerUndo() { if (this.commandManager.undo()) this._render(); }
    triggerRedo() { if (this.commandManager.redo()) this._render(); }
    triggerFitToScreen() { if (this.canvas) this.canvas.fitToScreen(); }
    triggerZoomIn() {
        if (!this.canvas) return;
        const newZoom = Math.min(this.canvas.zoom * 1.2, 5);
        this._applyZoom(newZoom);
    }
    triggerZoomOut() {
        if (!this.canvas) return;
        const newZoom = Math.max(this.canvas.zoom / 1.2, 0.1);
        this._applyZoom(newZoom);
    }
    _applyZoom(newZoom) {
        const c = this.canvas;
        const cx = c.viewBox.x + c.viewBox.width / 2;
        const cy = c.viewBox.y + c.viewBox.height / 2;
        c.zoom = newZoom;
        const newW = 2000 / newZoom;
        const newH = 1200 / newZoom;
        c.viewBox.width = newW;
        c.viewBox.height = newH;
        c.viewBox.x = cx - newW / 2;
        c.viewBox.y = cy - newH / 2;
        c._updateViewBox();
    }
    triggerCopy() { this.clipboard.copy(); }
    triggerCut() { this.clipboard.cut(); }
    triggerPaste() {
        let cx, cy;
        if (this._contextMenuSVGPoint) {
            cx = this._contextMenuSVGPoint.x;
            cy = this._contextMenuSVGPoint.y;
            this._contextMenuSVGPoint = null;
        } else {
            // Paste at center of current viewport
            const c = this.canvas;
            cx = c.viewBox.x + c.viewBox.width / 2;
            cy = c.viewBox.y + c.viewBox.height / 2;
        }
        this.clipboard.paste(cx, cy);
    }
    hasSelection() { return this.selectedStationIds.size > 0 || (this.selectedItem && this.selectedItem.type === 'connection'); }
    hasClipboard() { return this.clipboard.hasData(); }

    isAutoSave() { return this.propertiesPanel ? this.propertiesPanel.autoSave : false; }
    toggleAutoSave() {
        if (!this.propertiesPanel) return;
        this.propertiesPanel.autoSave = !this.propertiesPanel.autoSave;
        localStorage.setItem('sim-editor-autosave', this.propertiesPanel.autoSave);
        const cb = document.getElementById('auto-save-checkbox');
        if (cb) cb.checked = this.propertiesPanel.autoSave;
    }

    isMinimapVisible() { return this._minimapVisible; }
    toggleMinimap() {
        this._minimapVisible = !this._minimapVisible;
        localStorage.setItem('sim-editor-minimap', this._minimapVisible);
        if (this.minimap) this.minimap.setVisible(this._minimapVisible);
    }

    isGridSnap() { return this._gridSnap; }
    toggleGridSnap() {
        this._gridSnap = !this._gridSnap;
        localStorage.setItem('sim-editor-grid-snap', this._gridSnap);
        if (this.canvas) {
            this.canvas.snapToGrid = this._gridSnap;
            this.canvas.render();
        }
        const toggle = document.getElementById('grid-snap-toggle');
        if (toggle) toggle.checked = this._gridSnap;
    }

    isAlignmentGuide() { return this._alignmentGuide; }
    toggleAlignmentGuide() {
        this._alignmentGuide = !this._alignmentGuide;
        localStorage.setItem('sim-editor-alignment-guide', this._alignmentGuide);
    }

    getLineStyle() { return this._lineStyle; }
    setLineStyle(style) {
        this._lineStyle = style;
        localStorage.setItem('sim-editor-line-style', style);
        this._render();
    }

    getThemeMode() { return this.themeManager.mode; }
    setTheme(mode) { this.themeManager.setMode(mode); }

    openMouseConfig() {
        if (this._mouseConfigModal) {
            this._mouseConfigModal.open();
        } else {
            alert('マウス操作設定モジュールが読み込まれていません');
        }
    }

    openSimDBSettings() {
        const simdb = this.scenario.simdbConfig || {};
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h3>SimDB 接続先設定</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="property-group">
                        <label class="property-label">ホスト</label>
                        <input type="text" class="property-input" id="modal-simdb-host" value="${this._escapeAttr(simdb.host || '')}" placeholder="localhost">
                    </div>
                    <div class="property-group">
                        <label class="property-label">ポート</label>
                        <input type="number" class="property-input" id="modal-simdb-port" value="${simdb.port || 5432}" min="1" max="65535">
                    </div>
                    <div class="property-group">
                        <label class="property-label">データベース</label>
                        <input type="text" class="property-input" id="modal-simdb-database" value="${this._escapeAttr(simdb.database || '')}" placeholder="simdb">
                    </div>
                    <div class="property-group">
                        <label class="property-label">ユーザー</label>
                        <input type="text" class="property-input" id="modal-simdb-user" value="${this._escapeAttr(simdb.user || '')}" placeholder="postgres">
                    </div>
                    <div class="property-group">
                        <label class="property-label">パスワード</label>
                        <input type="password" class="property-input" id="modal-simdb-password" value="${this._escapeAttr(simdb.password || '')}" placeholder="パスワード">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" id="modal-simdb-cancel">キャンセル</button>
                    <button class="btn-primary" id="modal-simdb-save">保存</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
        overlay.querySelector('#modal-simdb-cancel').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        overlay.querySelector('#modal-simdb-save').addEventListener('click', () => {
            const host = overlay.querySelector('#modal-simdb-host').value.trim();
            const port = parseInt(overlay.querySelector('#modal-simdb-port').value) || 5432;
            const database = overlay.querySelector('#modal-simdb-database').value.trim();
            const user = overlay.querySelector('#modal-simdb-user').value.trim();
            const password = overlay.querySelector('#modal-simdb-password').value;

            if (!host) {
                this.scenario.simdbConfig = null;
            } else {
                this.scenario.simdbConfig = { host, port, database, user, password };
            }
            this._markDirty();
            this._render();
            overlay.remove();
        });
    }

    _escapeAttr(str) {
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    openShortcutsDialog() {
        const shortcuts = [
            ['Cmd+S', '保存'],
            ['Cmd+Z', '元に戻す'],
            ['Cmd+Shift+Z', 'やり直す'],
            ['Cmd+C', 'コピー'],
            ['Cmd+X', 'カット'],
            ['Cmd+V', 'ペースト'],
            ['Cmd+A', '全選択'],
            ['Cmd+F', '検索'],
            ['Cmd+0', '画面にフィット'],
            ['Delete / Backspace', '選択削除'],
            ['Shift+クリック', '選択に追加'],
            ['Cmd+クリック', '選択トグル'],
            ['ドラッグ（空白）', '範囲選択'],
            ['ダブルクリック（Moduler）', '内部編集'],
            ['マウスホイール', 'ズーム'],
            ['中ボタンドラッグ', 'パン'],
            ['Esc', '選択解除 / 検索閉じる'],
        ];
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const rows = shortcuts.map(([key, desc]) =>
            `<tr><td class="shortcut-key">${key}</td><td>${desc}</td></tr>`
        ).join('');
        overlay.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h3>キーボードショートカット</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <table class="shortcuts-table">${rows}</table>
                </div>
                <div class="modal-footer">
                    <button class="btn-primary" id="modal-shortcuts-close">閉じる</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
        overlay.querySelector('#modal-shortcuts-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
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
        // When editing a sub-scenario, sync it to the parent and validate the root scenario
        let scenarioToValidate = this.scenario;
        if (this.scenario._isSubScenario) {
            if (this.scenario._parentStation) {
                this.scenario._parentStation.config.subScenario = {
                    stations: this.scenario.stations,
                    connections: this.scenario.connections
                };
            }
            scenarioToValidate = this._editStack[0]?.scenario || this.scenario;
        }
        const { errors, warnings } = validateScenario(scenarioToValidate);

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
            const urlParams = new URLSearchParams(window.location.search);
            const factoryId = urlParams.get('factoryId') || this.scenario.factoryId || undefined;
            const scenarioData = {
                name: this.scenario.name,
                factoryId: factoryId || undefined,
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

            this._markClean();
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
            this._markClean();
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

        this._editMode = 'logic';
        this._showSubScenarioToolbar();
        this._animateDrill();
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

        this._hideSubScenarioToolbar();
        this._markDirty();
        this._updateBreadcrumb();
        this._animateDrill();
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

        if (this._editStack.length === 0) this._hideSubScenarioToolbar();
        this._markDirty();
        this._updateBreadcrumb();
        this._animateDrill();
    }

    _animateDrill() {
        const svg = document.getElementById('canvas');
        if (!svg) { this._render(); return; }
        svg.style.opacity = '0';
        svg.style.transition = 'opacity 0.15s ease-in';
        requestAnimationFrame(() => {
            this._render();
            requestAnimationFrame(() => {
                svg.style.opacity = '1';
                svg.style.transition = 'opacity 0.2s ease-out';
            });
        });
    }

    // -----------------------------------------------------------------------
    // Sub-scenario toolbar (model editing mode)
    // -----------------------------------------------------------------------
    _showSubScenarioToolbar() {
        const toolbar = document.getElementById('sub-scenario-toolbar');
        if (!toolbar) return;
        toolbar.style.display = 'flex';

        // Re-attach event listeners every time (toolbar may have been hidden)
        const logicBtn = document.getElementById('logic-mode-btn');
        const modelBtn = document.getElementById('model-mode-btn');
        const blockSizeBtn = document.getElementById('block-size-btn');
        const blockHeightBtn = document.getElementById('block-height-btn');
        const originBtn = document.getElementById('origin-set-btn');
        const confirmBtn = document.getElementById('model-confirm-btn');
        const importBtn = document.getElementById('model-import-btn');
        const fileInput = document.getElementById('model-file-input');
        const resetBtn = document.getElementById('model-reset-btn');
        const exportBtn = document.getElementById('model-export-btn');

        // Clone buttons to remove old listeners
        const rebind = (el, handler) => {
            if (!el) return;
            const clone = el.cloneNode(true);
            el.parentNode.replaceChild(clone, el);
            clone.addEventListener('click', handler);
            return clone;
        };

        rebind(logicBtn, () => this.setEditMode('logic'));
        rebind(modelBtn, () => this.setEditMode('model'));
        rebind(blockSizeBtn, () => this._modelEditor?.openGridSizeModal());
        rebind(blockHeightBtn, () => this._modelEditor?.openHeightModal());
        rebind(originBtn, () => {
            if (!this._modelEditor) return;
            const active = this._modelEditor.toggleOriginMode();
            const btn = document.getElementById('origin-set-btn');
            if (btn) {
                btn.style.background = active ? '#ff4444' : '';
                btn.style.color = active ? '#fff' : '';
            }
        });
        rebind(confirmBtn, () => this._handleModelConfirm());
        rebind(importBtn, () => document.getElementById('model-file-input')?.click());
        rebind(resetBtn, () => this._handleModelReset());
        rebind(exportBtn, () => this._handleModelExport());

        // File input change handler
        if (fileInput) {
            const newFileInput = fileInput.cloneNode(true);
            fileInput.parentNode.replaceChild(newFileInput, fileInput);
            newFileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) this._handleModelImport(file);
                e.target.value = '';
            });
        }

        // Initialize model editor
        const canvas = document.getElementById('model-editor-canvas');
        const fp = document.getElementById('model-footprint-canvas');
        if (canvas && fp) {
            if (this._modelEditor) this._modelEditor.close();
            this._modelEditor = new ModelEditor(canvas, fp);
            this._modelEditor.open(this._loadModel3D());
        }

        this._updateSubScenarioToolbarState();

        // Draw footprint on SVG if model data exists (logic mode on drill-down)
        // Use double-RAF to ensure _animateDrill's _render() has already run
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (this._editMode === 'logic') {
                const m = this._loadModel3D();
                if (m) this._drawFootprintOnSVG(m);
            }
        }));
    }

    _hideSubScenarioToolbar() {
        const toolbar = document.getElementById('sub-scenario-toolbar');
        if (toolbar) toolbar.style.display = 'none';

        const modelCanvas = document.getElementById('model-editor-canvas');
        if (modelCanvas) modelCanvas.style.display = 'none';

        const fpCanvas = document.getElementById('model-footprint-canvas');
        if (fpCanvas) fpCanvas.style.display = 'none';

        this._clearFootprintSVG();

        const svgCanvas = document.getElementById('canvas');
        if (svgCanvas) svgCanvas.style.display = '';

        if (this._modelEditor) {
            this._modelEditor.close();
            this._modelEditor = null;
        }
    }

    setEditMode(mode) {
        const svgCanvas = document.getElementById('canvas');
        const modelCanvas = document.getElementById('model-editor-canvas');
        const fpCanvas = document.getElementById('model-footprint-canvas');
        const editControls = document.getElementById('model-editing-controls');
        const logicBtn = document.getElementById('logic-mode-btn');
        const modelBtn = document.getElementById('model-mode-btn');

        if (mode === 'logic') {
            if (svgCanvas) svgCanvas.style.display = '';
            if (modelCanvas) modelCanvas.style.display = 'none';
            if (fpCanvas) fpCanvas.style.display = 'none';
            if (editControls) editControls.style.display = 'none';
            logicBtn?.classList.add('active');
            modelBtn?.classList.remove('active');

            // Draw footprint as SVG overlay
            const m = this._loadModel3D();
            requestAnimationFrame(() => this._drawFootprintOnSVG(m));
        } else if (mode === 'model') {
            this._clearFootprintSVG();
            if (svgCanvas) svgCanvas.style.display = 'none';
            if (modelCanvas) modelCanvas.style.display = 'block';
            if (editControls) editControls.style.display = 'flex';
            if (fpCanvas) fpCanvas.style.display = 'none';
            modelBtn?.classList.add('active');
            logicBtn?.classList.remove('active');

            this._modelEditor?.open(this._loadModel3D());
            this._updateSubScenarioToolbarState();
        }

        this._editMode = mode;
    }

    _updateSubScenarioToolbarState() {
        const m = this._loadModel3D();
        const exportBtn = document.getElementById('model-export-btn');
        const confirmBtn = document.getElementById('model-confirm-btn');
        const resetBtn = document.getElementById('model-reset-btn');

        if (exportBtn) exportBtn.disabled = !m;

        if (this._modelEditor?._mode === 'imported') {
            if (confirmBtn) confirmBtn.disabled = true;
            if (resetBtn) resetBtn.style.display = '';
        } else {
            if (confirmBtn) confirmBtn.disabled = false;
            if (resetBtn) resetBtn.style.display = 'none';
        }
    }

    _handleModelConfirm() {
        if (!this._modelEditor) return;
        const grid = this._modelEditor.getGridData();
        if (!grid) {
            alert('セルを選択してください');
            return;
        }
        this._saveModel3DGrid(grid);
        this._updateSubScenarioToolbarState();
        this._showInlineNotification('モデルを保存しました');
    }

    async _handleModelImport(file) {
        if (!this._modelEditor) return;
        try {
            const result = await this._modelEditor.importFile(file);
            if (result.type === 'gltf') {
                this._saveModel3DGltf(result.data);
            } else if (result.type === 'glb') {
                this._saveModel3DGlb(result.data);
            }
            this._updateSubScenarioToolbarState();
        } catch (err) {
            this._showInlineNotification(err.message || 'インポートに失敗しました', 'error');
        }
    }

    async _handleModelExport() {
        if (!this._modelEditor) return;
        const exportBtn = document.getElementById('model-export-btn');
        if (exportBtn) {
            exportBtn.disabled = true;
            exportBtn.textContent = '処理中...';
        }
        try {
            const m = this._loadModel3D();
            if (!m) return;
            if (m.type === 'grid') {
                await this._modelEditor.exportFromGrid();
            } else if (m.type === 'gltf') {
                this._modelEditor.exportFromGltf(m.data);
            } else if (m.type === 'glb') {
                this._modelEditor.exportFromGlb(m.data);
            }
        } finally {
            if (exportBtn) {
                exportBtn.disabled = false;
                exportBtn.textContent = 'エクスポート';
                this._updateSubScenarioToolbarState();
            }
        }
    }

    _handleModelReset() {
        this._resetModel3D();
        this._modelEditor?.open(null);
        this._updateSubScenarioToolbarState();
    }

    _showInlineNotification(message, type = 'info') {
        const modelCanvas = document.getElementById('model-editor-canvas');
        if (!modelCanvas) return;
        const container = modelCanvas.parentElement;
        if (!container) return;

        const existing = container.querySelector('.model-inline-notification');
        if (existing) existing.remove();

        const note = document.createElement('div');
        note.className = 'model-inline-notification';
        note.textContent = message;
        note.style.cssText = `
            position:absolute; top:8px; left:50%; transform:translateX(-50%);
            background:${type === 'error' ? 'var(--danger-color)' : 'var(--accent-color)'};
            color:#fff; padding:6px 16px; border-radius:4px; font-size:13px;
            z-index:100; pointer-events:none; white-space:nowrap;`;
        container.appendChild(note);
        setTimeout(() => note.remove(), 3000);
    }

    // -----------------------------------------------------------------------
    // Model 3D save/load helpers
    // -----------------------------------------------------------------------
    _saveModel3DGrid(grid) {
        const parent = this.scenario._parentStation;
        if (!parent) return;
        parent.config = parent.config || {};
        delete parent.config.model3DGltf;
        delete parent.config.model3DGlb;
        if (grid) {
            parent.config.model3DGrid = grid;
        } else {
            delete parent.config.model3DGrid;
        }
        this._markDirty();
    }

    _saveModel3DGltf(gltfJson) {
        const parent = this.scenario._parentStation;
        if (!parent) return;
        parent.config = parent.config || {};
        delete parent.config.model3DGrid;
        delete parent.config.model3DGlb;
        parent.config.model3DGltf = gltfJson;
        this._markDirty();
    }

    _saveModel3DGlb(base64) {
        const parent = this.scenario._parentStation;
        if (!parent) return;
        parent.config = parent.config || {};
        delete parent.config.model3DGrid;
        delete parent.config.model3DGltf;
        parent.config.model3DGlb = base64;
        this._markDirty();
    }

    _resetModel3D() {
        const parent = this.scenario._parentStation;
        if (!parent) return;
        delete parent.config?.model3DGrid;
        delete parent.config?.model3DGltf;
        delete parent.config?.model3DGlb;
        this._markDirty();
    }

    _loadModel3D() {
        const cfg = this.scenario._parentStation?.config;
        if (!cfg) return null;
        if (cfg.model3DGrid) return { type: 'grid', data: cfg.model3DGrid };
        if (cfg.model3DGltf) return { type: 'gltf', data: cfg.model3DGltf };
        if (cfg.model3DGlb)  return { type: 'glb',  data: cfg.model3DGlb };
        return null;
    }

    _clearFootprintSVG() {
        document.getElementById('footprint-overlay')?.remove();
    }

    _drawFootprintOnSVG(model3D) {
        this._clearFootprintSVG();
        const svgEl = document.getElementById('canvas');
        if (!svgEl || !model3D || model3D.type !== 'grid') return;
        const cells = model3D.data?.cells;
        if (!cells || cells.length === 0) return;

        const svgNS = 'http://www.w3.org/2000/svg';
        const g = document.createElementNS(svgNS, 'g');
        g.id = 'footprint-overlay';
        g.setAttribute('pointer-events', 'none');

        const minC = Math.min(...cells.map(([c]) => c));
        const maxC = Math.max(...cells.map(([c]) => c));
        const minR = Math.min(...cells.map(([, r]) => r));
        const maxR = Math.max(...cells.map(([, r]) => r));
        const spanC = maxC - minC + 1;
        const spanR = maxR - minR + 1;

        const vw = svgEl.clientWidth  || 800;
        const vh = svgEl.clientHeight || 600;
        const maxPx  = Math.min(vw, vh) * 0.6;
        const cellPx = Math.min(maxPx / spanC, maxPx / spanR);
        const startX = (vw - spanC * cellPx) / 2;
        const startY = (vh - spanR * cellPx) / 2;

        for (const [c, r] of cells) {
            const rect = document.createElementNS(svgNS, 'rect');
            rect.setAttribute('x',      startX + (c - minC) * cellPx);
            rect.setAttribute('y',      startY + (r - minR) * cellPx);
            rect.setAttribute('width',  cellPx);
            rect.setAttribute('height', cellPx);
            rect.setAttribute('fill',   'rgba(0,207,255,0.25)');
            rect.setAttribute('stroke', 'rgba(0,207,255,0.75)');
            rect.setAttribute('stroke-width', '1.5');
            g.appendChild(rect);
        }

        // Insert behind stations so stations render on top
        const stationsLayer = svgEl.querySelector('#stations-layer');
        if (stationsLayer) svgEl.insertBefore(g, stationsLayer);
        else svgEl.appendChild(g);
    }

    _drawFootprintOnCanvas(fpCanvas, model3D) {
        const dpr = window.devicePixelRatio || 1;
        const w = fpCanvas.offsetWidth  || fpCanvas.parentElement?.offsetWidth  || 0;
        const h = fpCanvas.offsetHeight || fpCanvas.parentElement?.offsetHeight || 0;
        if (w <= 0 || h <= 0) return;

        fpCanvas.width  = w * dpr;
        fpCanvas.height = h * dpr;
        const ctx = fpCanvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        if (model3D.type === 'grid' && model3D.data?.cells?.length > 0) {
            const cells = model3D.data.cells;
            const minC = Math.min(...cells.map(([c]) => c));
            const maxC = Math.max(...cells.map(([c]) => c));
            const minR = Math.min(...cells.map(([, r]) => r));
            const maxR = Math.max(...cells.map(([, r]) => r));
            const spanC = maxC - minC + 1;
            const spanR = maxR - minR + 1;
            const maxPx  = Math.min(w, h) * 0.7;
            const cellPx = Math.min(maxPx / spanC, maxPx / spanR);
            const offsetX = (w - spanC * cellPx) / 2;
            const offsetY = (h - spanR * cellPx) / 2;

            ctx.fillStyle   = 'rgba(0, 207, 255, 0.35)';
            ctx.strokeStyle = 'rgba(0, 207, 255, 0.9)';
            ctx.lineWidth   = 2;
            for (const [c, r] of cells) {
                ctx.fillRect(  offsetX + (c - minC) * cellPx, offsetY + (r - minR) * cellPx, cellPx, cellPx);
                ctx.strokeRect(offsetX + (c - minC) * cellPx, offsetY + (r - minR) * cellPx, cellPx, cellPx);
            }
        } else if (model3D.type === 'gltf' || model3D.type === 'glb') {
            ctx.font          = '14px sans-serif';
            ctx.fillStyle     = 'rgba(0, 207, 255, 0.6)';
            ctx.textAlign     = 'center';
            ctx.textBaseline  = 'middle';
            ctx.fillText('📦 外部モデル設定済み', w / 2, h / 2);
        }
    }

    _setup3DToggle() {
        const btn = document.getElementById('toggle-3d-btn');
        if (!btn) return;
        const sizeSlider = document.getElementById('editor-station-size');
        const sizeValue = document.getElementById('editor-station-size-value');

        btn.addEventListener('click', () => {
            this._is3DMode = !this._is3DMode;
            const svgCanvas = document.getElementById('canvas');
            if (this._is3DMode) {
                if (svgCanvas) svgCanvas.style.display = 'none';
                btn.textContent = '2D';
                btn.style.background = '#4a148c';
                btn.style.color = '#fff';
                this._editor3DView.show(this.scenario);
            } else {
                this._editor3DView.hide();
                if (svgCanvas) svgCanvas.style.display = '';
                btn.textContent = '3D';
                btn.style.background = '#222';
                btn.style.color = '#ccc';
            }
        });

        if (sizeSlider) {
            sizeSlider.addEventListener('input', () => {
                const v = parseFloat(sizeSlider.value);
                if (sizeValue) sizeValue.textContent = v.toFixed(1);
                if (this._is3DMode) {
                    this._editor3DView.setStationSizeMultiplier(v);
                } else {
                    this.canvas.stationSizeMultiplier = v;
                    this.canvas.render();
                }
            });
        }
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

        // Back button
        const backBtn = document.createElement('span');
        backBtn.className = 'breadcrumb-back';
        backBtn.textContent = '←';
        backBtn.title = '戻る';
        backBtn.addEventListener('click', () => this.drillUp());
        breadcrumb.appendChild(backBtn);

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
            // Show station name instead of ID
            const parentScenario = i === 0 ? this._editStack[0].scenario : this._editStack[i].scenario;
            const station = parentScenario?.stations?.find(s => s.id === stationId);
            item.textContent = station?.name || stationId;
            item.dataset.depth = String(i + 1);
            item.addEventListener('click', () => this.drillToDepth(i + 1));
            breadcrumb.appendChild(item);
        });

        // Port count warning
        this._renderPortCountWarning(breadcrumb);
    }

    _renderPortCountWarning(breadcrumb) {
        if (!this.isInSubScenario()) return;
        const parentStation = this.scenario._parentStation;
        if (!parentStation) return;

        const entries = this.scenario.stations.filter(s => s.type === 'entry').length;
        const exits = this.scenario.stations.filter(s => s.type === 'exit').length;
        const expectedIn = parentStation.config?.entryCount || 1;
        const expectedOut = parentStation.config?.exitCount || 1;

        if (entries !== expectedIn || exits !== expectedOut) {
            const warn = document.createElement('span');
            warn.className = 'breadcrumb-warning';
            warn.title = `ポート数不一致: Entry=${entries}(期待${expectedIn}), Exit=${exits}(期待${expectedOut})`;
            warn.textContent = '⚠';
            breadcrumb.appendChild(warn);
        }
    }

    isInSubScenario() {
        return this._editStack.length > 0;
    }

    /** Returns the root scenario (top of the edit stack), or the current scenario if not in a sub-scenario */
    getRootScenario() {
        if (this._editStack.length === 0) return this.scenario;
        return this._editStack[0].scenario;
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
