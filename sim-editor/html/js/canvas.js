// Canvas rendering and interaction
import { MoveStationCommand, MoveMultipleStationsCommand } from './undo.js';

// 1 meter = 80 SVG pixels (standard station is 80×60px ≈ 1m wide)
const PX_PER_M = 80;

// Port indicator dimensions — single source of truth used by rendering, hit-test, and layout
const MODULER_PORT_W   = 20;
const MODULER_PORT_H   = 14;
const MODULER_PORT_GAP = 20;
const SPLIT_PORT_W     = 30;
const SPLIT_PORT_H     = 20;
const SPLIT_PORT_GAP   = 25;

export class Canvas {
    constructor(svg, editor) {
        this.svg = svg;
        this.editor = editor;
        this.stationsLayer = document.getElementById('stations-layer');
        this.connectionsLayer = document.getElementById('connections-layer');
        this.gridLayer = document.getElementById('grid-layer');

        // Drag state
        this.draggedStation = null;
        this.dragOffset = { x: 0, y: 0 };
        this.dragStartPos = { x: 0, y: 0 }; // Store initial position for undo

        // Connection drag state
        this.connectFrom = null;
        this.connectFromPortIndex = -1; // Port index for Split output port
        this.connectionDragLine = null; // Temporary line during connection drag
        this.isDraggingConnection = false;

        // Connection drag detection (distinguish click vs drag)
        this.connectDragPending = false; // mousedown occurred, waiting to see if it's a drag
        this.connectDragStartClient = { x: 0, y: 0 }; // client coords at mousedown
        this.connectDragStartSVG = { x: 0, y: 0 }; // SVG coords at mousedown
        this.connectDragThreshold = 5; // pixels of movement before drag mode activates
        this.connectDragPendingStationId = null;
        this.connectDragPendingPortIndex = -1;
        this.connectDragPendingIsPort = false;
        this.suppressNextClick = false; // suppress click event after drag-based connection

        // Pan/Zoom state
        this.viewBox = { x: 0, y: 0, width: 2000, height: 1200 };
        this.zoom = 1.0;
        this.isPanning = false;
        this.panStart = { x: 0, y: 0 };

        // Grid snap settings
        this.gridSize = 20;
        this.snapToGrid = true;

        // Station display size multiplier
        this.stationSizeMultiplier = 1.0;

        // Rectangle selection state
        this.isRectSelecting = false;
        this.rectSelectStart = { x: 0, y: 0 };
        this.rectSelectRect = null;

        // Multi-drag state
        this.multiDragStartPositions = new Map(); // stationId -> {x, y}

        // Manual double-click detection (browser dblclick unreliable with DOM rebuilds)
        this._lastClickStationId = null;
        this._lastClickTime = 0;

        this._setupEventListeners();
        this._updateViewBox();
    }

    _setupEventListeners() {
        this.svg.addEventListener('click', (e) => this._handleClick(e));
        this.svg.addEventListener('dblclick', (e) => this._handleDblClick(e));
        this.svg.addEventListener('mousedown', (e) => this._handleMouseDown(e));
        this.svg.addEventListener('mousemove', (e) => this._handleMouseMove(e));
        this.svg.addEventListener('mouseup', (e) => this._handleMouseUp(e));
        this.svg.addEventListener('wheel', (e) => this._handleWheel(e));
        this.svg.addEventListener('contextmenu', (e) => this._handleContextMenu(e));
    }

    _updateViewBox() {
        this.svg.setAttribute('viewBox',
            `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.width} ${this.viewBox.height}`
        );
        if (this.editor.minimap) this.editor.minimap.render();
    }

    _snapToGrid(value) {
        if (this.snapToGrid) {
            return Math.round(value / this.gridSize) * this.gridSize;
        }
        return value;
    }

    _handleClick(e) {
        // Suppress click event that fires after a drag-based connection
        if (this.suppressNextClick) {
            this.suppressNextClick = false;
            return;
        }

        const target = e.target;
        const tool = this.editor.currentTool;

        // Get SVG coordinates
        const pt = this._getSVGPoint(e);

        // Check if clicked on port slot
        const portSlot = target.closest('.port-slot');
        if (portSlot) {
            const stationId = portSlot.dataset.stationId;
            const portIndex = parseInt(portSlot.dataset.portIndex);
            const portType = portSlot.dataset.portType; // 'input' or 'output'

            if (tool === 'connect') {
                this._handlePortConnectClick(stationId, portIndex, portType);
                return;
            } else if (tool === 'select') {
                this.editor.selectItem({ type: 'station', id: stationId });
                return;
            }
        }

        // Check if clicked on station or connection
        const stationId = target.closest('.station')?.dataset?.stationId;
        const connectionIndex = target.closest('.connection')?.dataset?.connectionIndex;

        if (stationId) {
            // Manual double-click detection for Moduler drill-down
            const now = Date.now();
            if (tool === 'select' && stationId === this._lastClickStationId && (now - this._lastClickTime) < 400) {
                this._lastClickStationId = null;
                this._lastClickTime = 0;
                const station = this.editor.getStation(stationId);
                if (station && station.type === 'moduler') {
                    this.editor.drillDown(stationId);
                    return;
                }
            }
            this._lastClickStationId = stationId;
            this._lastClickTime = now;

            if (tool === 'select') {
                if (e.shiftKey) {
                    this.editor.addToSelection(stationId);
                } else if (e.metaKey || e.ctrlKey) {
                    this.editor.toggleInSelection(stationId);
                } else {
                    this.editor.selectItem({ type: 'station', id: stationId });
                }
            } else if (tool === 'connect') {
                this._handleConnectClick(stationId);
            } else if (tool === 'delete') {
                if (confirm('このステーションを削除しますか？')) {
                    this.editor.deleteStation(stationId);
                }
            }
        } else if (connectionIndex) {
            if (tool === 'select') {
                this.editor.selectItem({ type: 'connection', index: parseInt(connectionIndex) });
            } else if (tool === 'delete') {
                if (confirm('この接続を削除しますか？')) {
                    this.editor.deleteConnection(parseInt(connectionIndex));
                }
            }
        } else {
            this._lastClickStationId = null;
            // Clicked on empty space
            if (tool === 'source' || tool === 'processing' || tool === 'drain' || tool === 'merge' || tool === 'split' || tool === 'moduler' || tool === 'switch') {
                this.editor.addStation(tool, pt.x, pt.y);
            } else if (tool === 'select') {
                this.editor.selectItem(null);
            } else if (tool === 'connect') {
                // Cancel connection selection on empty click
                if (this.connectFrom !== null) {
                    this._cancelConnect();
                }
            }
        }
    }

    _handleContextMenu(e) {
        e.preventDefault();
        // Only show context menu if right-click is assigned to contextMenu
        const mc = this.editor.mouseConfig;
        if (mc && mc.getButton('contextMenu') !== 2) return;

        const target = e.target;
        const pt = this._getSVGPoint(e);
        const contextMenu = this.editor.contextMenu;
        if (!contextMenu) return;

        const stationEl = target.closest('.station');
        const connectionEl = target.closest('.connection');

        if (stationEl) {
            const stationId = stationEl.dataset.stationId;
            // Ensure right-clicked station is selected
            if (!this.editor.isStationSelected(stationId)) {
                this.editor.selectItem({ type: 'station', id: stationId });
            }
            contextMenu.show(e.clientX, e.clientY, contextMenu.stationItems(stationId));
        } else if (connectionEl) {
            const connectionIndex = parseInt(connectionEl.dataset.connectionIndex);
            this.editor.selectItem({ type: 'connection', index: connectionIndex });
            contextMenu.show(e.clientX, e.clientY, contextMenu.connectionItems(connectionIndex));
        } else {
            // Empty canvas - store SVG coordinates for paste position
            this.editor._contextMenuSVGPoint = { x: pt.x, y: pt.y };
            contextMenu.show(e.clientX, e.clientY, contextMenu.canvasItems());
        }
    }

    _handleDblClick(e) {
        const stationEl = e.target.closest('.station');
        if (!stationEl) return;

        const stationId = stationEl.dataset.stationId;
        const station = this.editor.getStation(stationId);
        if (station && station.type === 'moduler') {
            e.preventDefault();
            e.stopPropagation();
            this.editor.drillDown(stationId);
        }
    }

    _handlePortConnectClick(stationId, portIndex, portType) {
        const station = this.editor.getStation(stationId);
        if (!station) return;

        if (portType === 'input') {
            // Merge input port: this is a connection TARGET
            if (this.connectFrom === null) {
                document.getElementById('canvas-info').textContent = '入力ポートからは接続開始できません。上流ステーションからドラッグしてください。';
                return;
            }
            if (this._isPortConnected(stationId, portIndex, 'input')) {
                alert('このポートには既に接続があります');
                this._cancelConnect();
                return;
            }
            this.editor.addConnection(this.connectFrom, stationId, this.connectFromPortIndex, portIndex);
            this._cancelConnect();
        } else if (portType === 'output') {
            // Split output port: this is a connection SOURCE
            if (this.connectFrom !== null) {
                document.getElementById('canvas-info').textContent = '出力ポートは接続先として使用できません';
                this._cancelConnect();
                return;
            }
            if (this._isPortConnected(stationId, portIndex, 'output')) {
                alert('このポートには既に接続があります');
                return;
            }
            this.connectFrom = stationId;
            this.connectFromPortIndex = portIndex;
            this._highlightConnectFrom(stationId);
            const displayName = station.name || station.config?.name || stationId;
            document.getElementById('canvas-info').textContent = `${displayName}[Port ${portIndex + 1}] から接続 → 次のステーション/ポートをクリック（空白クリックでキャンセル）`;
        }
    }

    _isPortConnected(stationId, portIndex, portType) {
        return this.editor.scenario.connections.some(c => {
            if (portType === 'input') {
                return c.to === stationId && c.toPortIndex === portIndex;
            } else {
                return c.from === stationId && c.fromPortIndex === portIndex;
            }
        });
    }

    _handleConnectClick(stationId) {
        if (this.connectFrom === null) {
            // First click - set source
            const station = this.editor.getStation(stationId);
            if (station && (station.type === 'split' || station.type === 'moduler')) {
                // For split/moduler stations, user should click on a specific output port
                const label = station.type === 'split' ? 'Split' : 'Moduler';
                document.getElementById('canvas-info').textContent = `${label}ステーションの出力ポートをクリックしてください`;
                return;
            }
            this.connectFrom = stationId;
            this.connectFromPortIndex = -1;
            this._highlightConnectFrom(stationId);
            const displayName = station?.name || station?.config?.name || stationId;
            document.getElementById('canvas-info').textContent = `${displayName} から接続 → 次のステーション/ポートをクリック（空白クリックでキャンセル）`;
        } else {
            // Second click - create connection
            if (this.connectFrom === stationId) {
                alert('同じステーションには接続できません');
                this._cancelConnect();
                return;
            }

            const toStation = this.editor.getStation(stationId);
            if (toStation && (toStation.type === 'merge' || toStation.type === 'moduler')) {
                // For merge/moduler stations, user should click on a specific input port
                const label = toStation.type === 'merge' ? 'Merge' : 'Moduler';
                document.getElementById('canvas-info').textContent = `${label}ステーションの入力ポートをクリックしてください`;
                return;
            }

            this.editor.addConnection(this.connectFrom, stationId, this.connectFromPortIndex, -1);
            this._cancelConnect();
        }
    }

    _cancelConnect() {
        this._clearConnectHighlight();
        this.connectFrom = null;
        this.connectFromPortIndex = -1;
        document.getElementById('canvas-info').textContent = 'ステーションをクリックして接続作成';
    }

    _highlightConnectFrom(stationId) {
        this._clearConnectHighlight();
        const el = this.stationsLayer.querySelector(`.station[data-station-id="${stationId}"]`);
        if (el) el.classList.add('connect-from');
    }

    _clearConnectHighlight() {
        this.stationsLayer.querySelectorAll('.connect-from').forEach(el => el.classList.remove('connect-from'));
    }

    _handleMouseDown(e) {
        const pt = this._getSVGPoint(e);

        // Pan button (configurable, default: middle button)
        const mc = this.editor.mouseConfig;
        const panButton = mc ? mc.getButton('pan') : 1;
        if (e.button === panButton) {
            this.isPanning = true;
            this.panStart = { x: e.clientX, y: e.clientY };
            e.preventDefault();
            return;
        }

        // Context menu via non-right button (e.g. middle=contextMenu in "panRight" preset)
        const ctxButton = mc ? mc.getButton('contextMenu') : 2;
        if (e.button === ctxButton && ctxButton !== 2) {
            // Trigger context menu manually for non-right-click button
            const contextMenu = this.editor.contextMenu;
            if (contextMenu) {
                const target = e.target;
                const stationEl = target.closest('.station');
                const connectionEl = target.closest('.connection');
                if (stationEl) {
                    const stationId = stationEl.dataset.stationId;
                    if (!this.editor.isStationSelected(stationId)) {
                        this.editor.selectItem({ type: 'station', id: stationId });
                    }
                    contextMenu.show(e.clientX, e.clientY, contextMenu.stationItems(stationId));
                } else if (connectionEl) {
                    const connectionIndex = parseInt(connectionEl.dataset.connectionIndex);
                    this.editor.selectItem({ type: 'connection', index: connectionIndex });
                    contextMenu.show(e.clientX, e.clientY, contextMenu.connectionItems(connectionIndex));
                } else {
                    this.editor._contextMenuSVGPoint = { x: pt.x, y: pt.y };
                    contextMenu.show(e.clientX, e.clientY, contextMenu.canvasItems());
                }
            }
            e.preventDefault();
            return;
        }

        // Left button (button 0)
        if (e.button === 0) {
            const station = e.target.closest('.station');
            const portSlot = e.target.closest('.port-slot');

            // Check if clicking on port slot for connection drag
            if (portSlot && (this.editor.currentTool === 'connect' || e.shiftKey)) {
                const stationId = portSlot.dataset.stationId;
                const portIndex = parseInt(portSlot.dataset.portIndex);
                const portType = portSlot.dataset.portType;

                // Only start drag from output ports (split)
                if (portType === 'output') {
                    if (this._isPortConnected(stationId, portIndex, 'output')) {
                        return; // Already connected
                    }
                    // Record pending drag start (don't create drag line yet)
                    this.connectDragPending = true;
                    this.connectDragStartClient = { x: e.clientX, y: e.clientY };
                    this.connectDragStartSVG = { x: pt.x, y: pt.y };
                    this.connectDragPendingStationId = stationId;
                    this.connectDragPendingPortIndex = portIndex;
                    this.connectDragPendingIsPort = true;

                    e.preventDefault();
                    return;
                }
            }

            // Check if clicking on station edge for connection drag (connect mode or holding Shift)
            if (station && !portSlot && (this.editor.currentTool === 'connect' || e.shiftKey)) {
                const stationId = station.dataset.stationId;
                const stationData = this.editor.getStation(stationId);

                // Don't start connection drag from split/moduler stations (must use ports)
                if (stationData && (stationData.type === 'split' || stationData.type === 'moduler')) {
                    return;
                }

                // Record pending drag start (don't create drag line yet)
                this.connectDragPending = true;
                this.connectDragStartClient = { x: e.clientX, y: e.clientY };
                this.connectDragStartSVG = { x: pt.x, y: pt.y };
                this.connectDragPendingStationId = stationId;
                this.connectDragPendingPortIndex = -1;
                this.connectDragPendingIsPort = false;

                e.preventDefault();
                return;
            }

            // Station drag (select mode only, no Shift)
            if (station && !portSlot && this.editor.currentTool === 'select' && !e.shiftKey) {
                const stationId = station.dataset.stationId;
                const stationData = this.editor.getStation(stationId);
                if (!stationData) return;

                // If the station isn't in the current selection, select it alone first
                if (!this.editor.isStationSelected(stationId)) {
                    this.editor.selectItem({ type: 'station', id: stationId });
                }

                // Setup drag for all selected stations
                this.draggedStation = stationId;
                this.dragOffset = {
                    x: pt.x - stationData.x,
                    y: pt.y - stationData.y
                };
                this.dragStartPos = {
                    x: stationData.x,
                    y: stationData.y
                };
                // Store start positions for all selected stations (multi-drag)
                this.multiDragStartPositions.clear();
                for (const sid of this.editor.selectedStationIds) {
                    const s = this.editor.getStation(sid);
                    if (s) this.multiDragStartPositions.set(sid, { x: s.x, y: s.y });
                }

                e.preventDefault();
                return;
            }

            // Rectangle selection: mousedown on empty space in select mode
            if (!station && !portSlot && this.editor.currentTool === 'select' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                this.isRectSelecting = true;
                this.rectSelectStart = { x: pt.x, y: pt.y };
                e.preventDefault();
                return;
            }
        }
    }

    _handleMouseMove(e) {
        const pt = this._getSVGPoint(e);

        // Handle panning — use viewBox/rect ratio, never rely on this.zoom
        if (this.isPanning) {
            const rect = this.svg.getBoundingClientRect();
            const dx = (e.clientX - this.panStart.x) * (this.viewBox.width  / rect.width);
            const dy = (e.clientY - this.panStart.y) * (this.viewBox.height / rect.height);

            this.viewBox.x -= dx;
            this.viewBox.y -= dy;

            this.panStart = { x: e.clientX, y: e.clientY };
            this._updateViewBox();
            return;
        }

        // Handle pending connection drag: check if movement exceeds threshold
        if (this.connectDragPending) {
            const dx = e.clientX - this.connectDragStartClient.x;
            const dy = e.clientY - this.connectDragStartClient.y;
            if (Math.sqrt(dx * dx + dy * dy) >= this.connectDragThreshold) {
                // Threshold exceeded: promote to actual drag
                this.connectDragPending = false;
                this.isDraggingConnection = true;
                this.connectFrom = this.connectDragPendingStationId;
                this.connectFromPortIndex = this.connectDragPendingPortIndex;

                // Create temporary drag line from original mousedown position
                this.connectionDragLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                this.connectionDragLine.setAttribute('stroke', '#4a9eff');
                this.connectionDragLine.setAttribute('stroke-width', '2');
                this.connectionDragLine.setAttribute('stroke-dasharray', '5,5');
                this.connectionDragLine.setAttribute('x1', this.connectDragStartSVG.x);
                this.connectionDragLine.setAttribute('y1', this.connectDragStartSVG.y);
                this.connectionDragLine.setAttribute('x2', pt.x);
                this.connectionDragLine.setAttribute('y2', pt.y);
                this.connectionsLayer.appendChild(this.connectionDragLine);
            }
            return;
        }

        // Handle connection drag
        if (this.isDraggingConnection && this.connectionDragLine) {
            this.connectionDragLine.setAttribute('x2', pt.x);
            this.connectionDragLine.setAttribute('y2', pt.y);
            return;
        }

        // Handle station drag (multi-drag support)
        if (this.draggedStation) {
            let newX = pt.x - this.dragOffset.x;
            let newY = pt.y - this.dragOffset.y;
            newX = this._snapToGrid(newX);
            newY = this._snapToGrid(newY);

            // Alignment guide snapping — use viewBox/rect ratio, never rely on this.zoom
            if (this.editor._alignmentGuide) {
                const rect = this.svg.getBoundingClientRect();
                const threshold = 5 * (this.viewBox.width / rect.width);
                const selected = this.editor.selectedStationIds;
                const others = this.editor.scenario.stations.filter(s => !selected.has(s.id));
                let snapX = null, snapY = null;
                for (const other of others) {
                    if (snapX === null && Math.abs(newX - other.x) < threshold) snapX = other.x;
                    if (snapY === null && Math.abs(newY - other.y) < threshold) snapY = other.y;
                }
                if (snapX !== null) newX = snapX;
                if (snapY !== null) newY = snapY;
                this._drawAlignmentGuides(newX, newY, snapX !== null, snapY !== null);
            } else {
                this._clearAlignmentGuides();
            }

            const primary = this.editor.getStation(this.draggedStation);
            if (primary) {
                const dx = newX - primary.x;
                const dy = newY - primary.y;
                // Move all selected stations by the same delta
                for (const sid of this.editor.selectedStationIds) {
                    const s = this.editor.getStation(sid);
                    if (s) {
                        s.x += dx;
                        s.y += dy;
                    }
                }
                this.editor.canvas.render();
            }
            return;
        }

        // Handle rectangle selection
        if (this.isRectSelecting) {
            const x = Math.min(this.rectSelectStart.x, pt.x);
            const y = Math.min(this.rectSelectStart.y, pt.y);
            const w = Math.abs(pt.x - this.rectSelectStart.x);
            const h = Math.abs(pt.y - this.rectSelectStart.y);
            this._drawSelectionRect(x, y, w, h);
            return;
        }
    }

    _handleMouseUp(e) {
        // Handle panning end
        if (this.isPanning) {
            this.isPanning = false;
            return;
        }

        // Handle pending connection drag that didn't exceed threshold (= click)
        if (this.connectDragPending) {
            this.connectDragPending = false;
            // Don't set connectFrom here; let the click event handle it via _handleConnectClick/_handlePortConnectClick
            return;
        }

        // Handle connection drag end
        if (this.isDraggingConnection) {
            // Remove temporary drag line
            if (this.connectionDragLine) {
                this.connectionDragLine.remove();
                this.connectionDragLine = null;
            }

            // Check if mouse is over a port slot or station
            const portSlot = e.target.closest('.port-slot');
            const station = e.target.closest('.station');

            if (portSlot && this.connectFrom) {
                const toStationId = portSlot.dataset.stationId;
                const toPortIndex = parseInt(portSlot.dataset.portIndex);
                const portType = portSlot.dataset.portType;

                if (portType === 'input' && toStationId !== this.connectFrom) {
                    if (!this._isPortConnected(toStationId, toPortIndex, 'input')) {
                        this.editor.addConnection(this.connectFrom, toStationId, this.connectFromPortIndex, toPortIndex);
                    }
                }
            } else if (station && this.connectFrom) {
                const toId = station.dataset.stationId;
                if (toId !== this.connectFrom) {
                    const toStation = this.editor.getStation(toId);
                    // If dropping on a merge/moduler station, user should target a port
                    if (toStation && (toStation.type === 'merge' || toStation.type === 'moduler')) {
                        // Don't create connection - need to target a port
                    } else {
                        this.editor.addConnection(this.connectFrom, toId, this.connectFromPortIndex, -1);
                    }
                }
            }

            this.isDraggingConnection = false;
            this._clearConnectHighlight();
            this.connectFrom = null;
            this.connectFromPortIndex = -1;
            this.suppressNextClick = true; // suppress the click event that follows mouseup
            return;
        }

        // Handle station drag end (multi-drag aware)
        if (this.draggedStation) {
            // Check if any station actually moved
            let moved = false;
            for (const [sid, startPos] of this.multiDragStartPositions) {
                const s = this.editor.getStation(sid);
                if (s && (s.x !== startPos.x || s.y !== startPos.y)) { moved = true; break; }
            }
            if (moved && this.multiDragStartPositions.size > 1) {
                // Multi-station move: create a batch undo command
                const moves = [];
                for (const [sid, startPos] of this.multiDragStartPositions) {
                    const s = this.editor.getStation(sid);
                    if (s) moves.push({ id: sid, fromX: startPos.x, fromY: startPos.y, toX: s.x, toY: s.y });
                }
                const command = new MoveMultipleStationsCommand(this.editor, moves);
                this.editor.commandManager.undoStack.push(command);
                this.editor.commandManager.redoStack = [];
            } else if (moved) {
                // Single station move
                const stationData = this.editor.getStation(this.draggedStation);
                if (stationData) {
                    const command = new MoveStationCommand(
                        this.editor, this.draggedStation,
                        this.dragStartPos.x, this.dragStartPos.y,
                        stationData.x, stationData.y
                    );
                    this.editor.commandManager.undoStack.push(command);
                    this.editor.commandManager.redoStack = [];
                }
            }
            this.draggedStation = null;
            this.multiDragStartPositions.clear();
            this._clearAlignmentGuides();
            return;
        }

        // Handle rectangle selection end
        if (this.isRectSelecting) {
            this.isRectSelecting = false;
            this._removeSelectionRect();
            const pt = this._getSVGPoint(e);
            const x1 = Math.min(this.rectSelectStart.x, pt.x);
            const y1 = Math.min(this.rectSelectStart.y, pt.y);
            const x2 = Math.max(this.rectSelectStart.x, pt.x);
            const y2 = Math.max(this.rectSelectStart.y, pt.y);
            // Select all stations whose bounding box intersects the selection rectangle.
            const ids = this.editor.scenario.stations
                .filter(s => {
                    const { cx, cy, hw, hh } = this._getStationBounds(s);
                    return cx + hw >= x1 && cx - hw <= x2 &&
                           cy + hh >= y1 && cy - hh <= y2;
                })
                .map(s => s.id);
            if (ids.length > 0) {
                this.editor.setSelection(ids);
            }
            return;
        }
    }

    _handleWheel(e) {
        e.preventDefault();

        const delta = e.deltaY > 0 ? 1.1 : 0.9;
        const newZoom = this.zoom * delta;

        // Limit zoom range
        if (newZoom < 0.1 || newZoom > 5.0) return;

        // Zoom towards mouse cursor
        const rect = this.svg.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Calculate mouse position in SVG coordinates
        const svgX = this.viewBox.x + (mouseX / rect.width) * this.viewBox.width;
        const svgY = this.viewBox.y + (mouseY / rect.height) * this.viewBox.height;

        // Scale viewBox by inverse zoom ratio — never touch hardcoded 2000/1200
        const scale = this.zoom / newZoom;
        this.viewBox.width  *= scale;
        this.viewBox.height *= scale;

        // Keep cursor position fixed in SVG space
        this.viewBox.x = svgX - (mouseX / rect.width)  * this.viewBox.width;
        this.viewBox.y = svgY - (mouseY / rect.height) * this.viewBox.height;

        // Update zoom as derived value (rect.width / viewBox.width)
        this.zoom = rect.width / this.viewBox.width;

        this._updateViewBox();
    }

    _getSVGPoint(e) {
        // Use SVG's built-in coordinate transformation for accuracy
        const point = this.svg.createSVGPoint();
        point.x = e.clientX;
        point.y = e.clientY;
        const ctm = this.svg.getScreenCTM();
        if (ctm) {
            const svgPoint = point.matrixTransform(ctm.inverse());
            return { x: svgPoint.x, y: svgPoint.y };
        }
        // Fallback to manual calculation
        const rect = this.svg.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const svgX = this.viewBox.x + (x / rect.width) * this.viewBox.width;
        const svgY = this.viewBox.y + (y / rect.height) * this.viewBox.height;
        return { x: svgX, y: svgY };
    }

    render() {
        if (!this.editor.scenario) return;
        this._renderGhost();
        this._renderGrid();
        this._renderConnections();
        this._renderStations();
    }

    _renderGhost() {
        const ghostLayer = document.getElementById('ghost-layer');
        if (!ghostLayer) return;
        ghostLayer.innerHTML = '';

        if (!this.editor.isInSubScenario()) return;
        const stack = this.editor._editStack;
        if (stack.length === 0) return;

        const parentScenario = stack[stack.length - 1].scenario;
        if (!parentScenario) return;

        // Draw local origin crosshair at (0, 0) — the point that maps to the parent moduler's x/y
        const mkLen = 40;
        const svgNS = 'http://www.w3.org/2000/svg';
        [['x1', -mkLen, 'y1', 0, 'x2', mkLen, 'y2', 0],
         ['x1', 0, 'y1', -mkLen, 'x2', 0, 'y2', mkLen]].forEach(([k1, v1, k2, v2, k3, v3, k4, v4]) => {
            const ln = document.createElementNS(svgNS, 'line');
            ln.setAttribute(k1, v1); ln.setAttribute(k2, v2);
            ln.setAttribute(k3, v3); ln.setAttribute(k4, v4);
            ln.setAttribute('stroke', '#ff6600');
            ln.setAttribute('stroke-width', 1.5);
            ln.setAttribute('stroke-dasharray', '4,3');
            ln.style.pointerEvents = 'none';
            ghostLayer.appendChild(ln);
        });
        const lbl = document.createElementNS(svgNS, 'text');
        lbl.setAttribute('x', mkLen + 4); lbl.setAttribute('y', -4);
        lbl.setAttribute('font-size', '10'); lbl.setAttribute('fill', '#ff6600');
        lbl.style.pointerEvents = 'none';
        lbl.textContent = 'origin';
        ghostLayer.appendChild(lbl);

        // Draw parent stations as simple rectangles
        parentScenario.stations.forEach(s => {
            const { cx, cy, hw, hh } = this._getStationBounds(s);
            const rect = document.createElementNS(svgNS, 'rect');
            rect.setAttribute('x', cx - hw);
            rect.setAttribute('y', cy - hh);
            rect.setAttribute('width', hw * 2);
            rect.setAttribute('height', hh * 2);
            rect.setAttribute('rx', 8);
            rect.setAttribute('fill', '#888');
            rect.setAttribute('stroke', '#666');
            rect.setAttribute('stroke-width', 1);
            ghostLayer.appendChild(rect);
        });

        // Draw parent connections
        parentScenario.connections.forEach(c => {
            const from = parentScenario.stations.find(s => s.id === c.from);
            const to = parentScenario.stations.find(s => s.id === c.to);
            if (!from || !to) return;
            const fc = this._getStationCenter(from);
            const tc = this._getStationCenter(to);
            const line = document.createElementNS(svgNS, 'line');
            line.setAttribute('x1', fc.x); line.setAttribute('y1', fc.y);
            line.setAttribute('x2', tc.x); line.setAttribute('y2', tc.y);
            line.setAttribute('stroke', '#888');
            line.setAttribute('stroke-width', 1);
            ghostLayer.appendChild(line);
        });
    }

    _renderGrid() {
        this.gridLayer.innerHTML = '';
        if (!this.snapToGrid) return;

        const gs = this.gridSize;
        const vb = this.viewBox;
        const startX = Math.floor(vb.x / gs) * gs;
        const startY = Math.floor(vb.y / gs) * gs;
        const endX = vb.x + vb.width;
        const endY = vb.y + vb.height;

        // Use a single path for performance
        let d = '';
        for (let x = startX; x <= endX; x += gs) {
            d += `M${x} ${startY}V${endY}`;
        }
        for (let y = startY; y <= endY; y += gs) {
            d += `M${startX} ${y}H${endX}`;
        }

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('stroke', 'var(--border-color-light, #eee)');
        path.setAttribute('stroke-width', 0.5 / this.zoom);
        path.setAttribute('fill', 'none');
        path.style.pointerEvents = 'none';
        this.gridLayer.appendChild(path);
    }

    _renderStations() {
        this.stationsLayer.innerHTML = '';

        this.editor.scenario.stations.forEach(station => {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.classList.add('station', `station-${station.type}`);
            g.dataset.stationId = station.id;

            const isSelected = this.editor.isStationSelected(station.id);
            if (isSelected) {
                g.classList.add('selected');
            }

            if (station.type === 'entry' || station.type === 'exit') {
                // Entry/Exit: triangle shape
                this._renderEntryExitStation(g, station);
            } else if (station.type === 'moduler') {
                // Moduler: double-border box
                this._renderModulerStation(g, station);
            } else {
                // Rectangle (standard)
                const m = this.stationSizeMultiplier;
                const hw = 40 * m, hh = 30 * m;
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', station.x - hw);
                rect.setAttribute('y', station.y - hh);
                rect.setAttribute('width', hw * 2);
                rect.setAttribute('height', hh * 2);
                rect.setAttribute('rx', 8 * m);

                // Text
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', station.x);
                text.setAttribute('y', station.y);
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('dominant-baseline', 'middle');
                text.setAttribute('font-size', Math.round(12 * m));
                text.setAttribute('font-weight', 'bold');
                text.setAttribute('fill', 'var(--station-stroke)');
                text.textContent = station.name || station.config?.name || station.id;

                g.appendChild(rect);
                g.appendChild(text);
            }

            // Render port slots for Merge/Split
            if (station.type === 'merge') {
                this._renderMergePorts(g, station);
            } else if (station.type === 'split') {
                this._renderSplitPorts(g, station);
            } else if (station.type === 'moduler') {
                this._renderModulerPorts(g, station);
            }

            this.stationsLayer.appendChild(g);
        });
    }

    _renderEntryExitStation(g, station) {
        const x = station.x;
        const y = station.y;
        const isEntry = station.type === 'entry';
        const m = this.stationSizeMultiplier;

        const halfW = 25 * m;
        const halfH = 20 * m;
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        if (isEntry) {
            polygon.setAttribute('points',
                `${x - halfW},${y - halfH} ${x + halfW},${y} ${x - halfW},${y + halfH}`);
        } else {
            polygon.setAttribute('points',
                `${x - halfW},${y - halfH} ${x + halfW},${y} ${x - halfW},${y + halfH}`);
        }

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x - 5 * m);
        text.setAttribute('y', y);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('font-size', Math.round(10 * m));
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('fill', 'var(--station-stroke)');
        text.textContent = station.name || station.config?.name || station.id;

        g.appendChild(polygon);
        g.appendChild(text);
    }

    // Returns {w, h} for a moduler station — model-based or default 100×70
    _getModulerSize(station) {
        const grid = station.config?.model3DGrid;
        if (grid?.cells?.length > 0) {
            const cells = grid.cells;
            const minC = Math.min(...cells.map(([c]) => c));
            const maxC = Math.max(...cells.map(([c]) => c));
            const minR = Math.min(...cells.map(([, r]) => r));
            const maxR = Math.max(...cells.map(([, r]) => r));
            const gs = (grid.gridSize || 1) * PX_PER_M;
            return { w: (maxC - minC + 1) * gs, h: (maxR - minR + 1) * gs };
        }
        return { w: 100, h: 70 };
    }

    // Returns the visual center {x, y} of any station type.
    // For moduler, accounts for origin offset.  For all others, returns station.x/y.
    // Single source of truth for station bounding box.
    // Returns { cx, cy, hw, hh } in SVG (global) coordinates.
    _getStationBounds(station) {
        const m = this.stationSizeMultiplier;
        if (station.type === 'moduler') {
            const { cx, cy } = this._getModulerVisualCenter(station);
            const { w, h }   = this._getModulerSize(station);
            return { cx, cy, hw: w / 2, hh: h / 2 };
        }
        const small = station.type === 'entry' || station.type === 'exit';
        return { cx: station.x, cy: station.y,
                 hw: (small ? 25 : 40) * m,
                 hh: (small ? 20 : 30) * m };
    }

    _getStationCenter(station) {
        const { cx, cy } = this._getStationBounds(station);
        return { x: cx, y: cy };
    }

    // Returns the point on station's axis-aligned bounding-box edge
    // in the normalized direction (dirX, dirY) from the station center.
    _getStationEdgePoint(station, dirX, dirY) {
        const { cx, cy, hw, hh } = this._getStationBounds(station);
        const absX = Math.abs(dirX), absY = Math.abs(dirY);
        const tx = absX > 1e-9 ? hw / absX : Infinity;
        const ty = absY > 1e-9 ? hh / absY : Infinity;
        const t = Math.min(tx, ty);
        return { x: cx + dirX * t, y: cy + dirY * t };
    }

    // Returns the visual center of a moduler station, accounting for origin offset
    _getModulerVisualCenter(station) {
        const grid = station.config?.model3DGrid;
        if (!grid?.cells?.length) return { cx: station.x, cy: station.y };
        const cells = grid.cells;
        const minC = Math.min(...cells.map(([c]) => c));
        const maxC = Math.max(...cells.map(([c]) => c));
        const minR = Math.min(...cells.map(([, r]) => r));
        const maxR = Math.max(...cells.map(([, r]) => r));
        const cellPx = (grid.gridSize || 1) * PX_PER_M;
        const spanC = maxC - minC + 1;
        const spanR = maxR - minR + 1;
        const origin = grid.origin;
        if (origin) {
            const startX = station.x - (origin[0] - minC + 0.5) * cellPx;
            const startY = station.y - (origin[1] - minR + 0.5) * cellPx;
            return { cx: startX + spanC * cellPx / 2, cy: startY + spanR * cellPx / 2 };
        }
        return { cx: station.x, cy: station.y };
    }

    // ── Local coordinate system helpers ─────────────────────────────────────
    // station.x/y is the moduler's anchor in global SVG space.
    // Sub-scenario station positions are stored in LOCAL coords (relative to anchor).
    // Existing scenarios in "old format" (large absolute sub-canvas coords) are migrated
    // automatically on first access via _migrateSubScenarioToLocalCoords().

    _toGlobal(moduler, localX, localY) {
        return { x: moduler.x + localX, y: moduler.y + localY };
    }

    _migrateSubScenarioToLocalCoords(station) {
        const ss = station.config?.subScenario;
        if (!ss || ss.localCoords) return;

        const grid = station.config?.model3DGrid;
        const gs   = (grid?.gridSize || 1) * PX_PER_M;

        if (grid?.cells?.length > 0 && grid.origin) {
            // Model-based moduler: place Entry at physical left edge, Exit at right edge.
            const cells = grid.cells;
            const minC  = Math.min(...cells.map(([c]) => c));
            const maxC  = Math.max(...cells.map(([c]) => c));
            const minR  = Math.min(...cells.map(([, r]) => r));
            const maxR  = Math.max(...cells.map(([, r]) => r));
            // Attachment points in local coords (outer edge of port indicator)
            const leftX  = (minC - grid.origin[0]) * gs - gs / 2;
            const rightX = (maxC - grid.origin[0] + 1) * gs - gs / 2;
            const topY   = (minR - grid.origin[1]) * gs - gs / 2;
            const botY   = (maxR - grid.origin[1] + 1) * gs - gs / 2;
            const totalH = botY - topY;

            const entries = ss.stations.filter(s => s.type === 'entry').sort((a, b) => a.y - b.y);
            const exits   = ss.stations.filter(s => s.type === 'exit').sort((a, b) => a.y - b.y);

            entries.forEach((e, i) => {
                e.x = leftX;
                e.y = topY + totalH * (i + 1) / (entries.length + 1);
            });
            exits.forEach((e, i) => {
                e.x = rightX;
                e.y = topY + totalH * (i + 1) / (exits.length + 1);
            });
            // Shift other stations (Processing, Switch…) by the IO centroid so they stay centred
            const io  = [...entries, ...exits];
            const cx0 = io.reduce((s, st) => s + st.x, 0) / io.length;
            const cy0 = io.reduce((s, st) => s + st.y, 0) / io.length;
            ss.stations.filter(s => s.type !== 'entry' && s.type !== 'exit')
                .forEach(s => { s.x -= cx0; s.y -= cy0; });
        } else {
            // Default box (w=100, hw=50): centre Entry/Exit around (0,0).
            const io = ss.stations.filter(s => s.type === 'entry' || s.type === 'exit');
            if (io.length > 0) {
                const cx0 = io.reduce((s, st) => s + st.x, 0) / io.length;
                const cy0 = io.reduce((s, st) => s + st.y, 0) / io.length;
                ss.stations.forEach(s => { s.x -= cx0; s.y -= cy0; });
            }
            // Snap Entry to left side (-50) and Exit to right side (+50)
            const hw = 50;
            ss.stations.filter(s => s.type === 'entry').forEach(e => { e.x = -hw; });
            ss.stations.filter(s => s.type === 'exit').forEach(e => { e.x = +hw; });
        }
        ss.localCoords = true;
    }

    // Returns the port indicator CENTER in global SVG coordinates.
    // For model3DGrid stations: always computed from grid geometry (immune to sub-canvas edits).
    // For default-box stations: derived from sub-scenario Entry/Exit local coords (migrated once).
    _getModulerPortPos(station, portIndex, portType) {
        const isInput = portType === 'input';
        const count = isInput ? (station.config.entryCount || 1) : (station.config.exitCount || 1);
        if (portIndex < 0 || portIndex >= count) return null;

        // Model3DGrid: derive attachment point from physical grid geometry
        const grid = station.config?.model3DGrid;
        if (grid?.cells?.length > 0 && grid.origin) {
            const gs    = (grid.gridSize || 1) * PX_PER_M;
            const cells = grid.cells;
            const minC  = Math.min(...cells.map(([c]) => c));
            const maxC  = Math.max(...cells.map(([c]) => c));
            const minR  = Math.min(...cells.map(([, r]) => r));
            const maxR  = Math.max(...cells.map(([, r]) => r));
            // Local X: outer edge of model (left for input, right for output)
            const localX = isInput
                ? (minC - grid.origin[0] - 0.5) * gs   // left edge attachment
                : (maxC - grid.origin[0] + 0.5) * gs;  // right edge attachment
            // Local Y: evenly spaced within row span
            const topY   = (minR - grid.origin[1] - 0.5) * gs;
            const botY   = (maxR - grid.origin[1] + 0.5) * gs;
            const localY = (botY - topY) > 0 ? topY + (botY - topY) * (portIndex + 1) / (count + 1) : 0;
            // Indicator centre = attachment ± half portWidth (inward)
            const cx = station.x + localX + (isInput ? MODULER_PORT_W / 2 : -MODULER_PORT_W / 2);
            return { x: cx, y: station.y + localY };
        }

        // Default box: use sub-scenario Entry/Exit local coords (run migration on first access)
        const ss = station.config?.subScenario;
        if (!ss?.stations) return null;
        if (!ss.localCoords) this._migrateSubScenarioToLocalCoords(station);
        const stype   = isInput ? 'entry' : 'exit';
        const targets = ss.stations.filter(s => s.type === stype).sort((a, b) => a.y - b.y);
        const t = targets[portIndex];
        if (!t) return null;
        const cx = station.x + t.x + (isInput ? MODULER_PORT_W / 2 : -MODULER_PORT_W / 2);
        return { x: cx, y: station.y + t.y };
    }

    _renderModulerStation(g, station) {
        const x = station.x;
        const y = station.y;
        const svgNS = 'http://www.w3.org/2000/svg';
        const grid = station.config?.model3DGrid;
        const { w, h } = this._getModulerSize(station);

        if (grid?.cells?.length > 0) {
            const cells = grid.cells;
            const minC = Math.min(...cells.map(([c]) => c));
            const maxC = Math.max(...cells.map(([c]) => c));
            const minR = Math.min(...cells.map(([, r]) => r));
            const maxR = Math.max(...cells.map(([, r]) => r));
            const spanC = maxC - minC + 1;
            const spanR = maxR - minR + 1;
            const cellPx = (grid.gridSize || 1) * PX_PER_M;

            // Origin-based positioning: station.x,y aligns to origin cell center.
            // Without origin, station.x,y is the bounding box center (default).
            const origin = grid.origin;
            let startX, startY;
            if (origin) {
                startX = x - (origin[0] - minC + 0.5) * cellPx;
                startY = y - (origin[1] - minR + 0.5) * cellPx;
            } else {
                startX = x - w / 2;
                startY = y - h / 2;
            }

            const hitRect = document.createElementNS(svgNS, 'rect');
            hitRect.setAttribute('x', startX);
            hitRect.setAttribute('y', startY);
            hitRect.setAttribute('width',  spanC * cellPx);
            hitRect.setAttribute('height', spanR * cellPx);
            hitRect.setAttribute('fill',   'transparent');
            hitRect.setAttribute('stroke', 'none');
            g.appendChild(hitRect);

            for (const [c, r] of cells) {
                const cr = document.createElementNS(svgNS, 'rect');
                const gap = Math.max(cellPx * 0.05, 0.5);
                cr.setAttribute('x',      startX + (c - minC) * cellPx + gap);
                cr.setAttribute('y',      startY + (r - minR) * cellPx + gap);
                cr.setAttribute('width',  cellPx - gap * 2);
                cr.setAttribute('height', cellPx - gap * 2);
                cr.setAttribute('rx', Math.max(cellPx * 0.1, 1));
                cr.setAttribute('fill',         'rgba(74,20,140,0.5)');
                cr.setAttribute('stroke',        '#7b1fa2');
                cr.setAttribute('stroke-width',  '1');
                g.appendChild(cr);
            }

            // Text at visual center of bounding box
            const vizCenterX = startX + spanC * cellPx / 2;
            const vizCenterY = startY + spanR * cellPx / 2;

            const text = document.createElementNS(svgNS, 'text');
            text.setAttribute('x', vizCenterX);
            text.setAttribute('y', vizCenterY - 4);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'middle');
            text.setAttribute('font-size', '10');
            text.setAttribute('font-weight', 'bold');
            text.setAttribute('fill', '#e0d0ff');
            text.setAttribute('pointer-events', 'none');
            text.textContent = station.name || station.config?.name || station.id;
            g.appendChild(text);

            const entryCount = station.config.entryCount || 1;
            const exitCount  = station.config.exitCount  || 1;
            const subText = document.createElementNS(svgNS, 'text');
            subText.setAttribute('x', vizCenterX);
            subText.setAttribute('y', vizCenterY + 10);
            subText.setAttribute('text-anchor', 'middle');
            subText.setAttribute('dominant-baseline', 'middle');
            subText.setAttribute('font-size', '8');
            subText.setAttribute('fill', '#c0a0e0');
            subText.setAttribute('pointer-events', 'none');
            subText.textContent = `E:${entryCount} X:${exitCount}`;
            g.appendChild(subText);
        } else {
            // --- Default mode: standard rectangle ---
            const m = this.stationSizeMultiplier;
            const mw = w * m, mh = h * m;
            const outerRect = document.createElementNS(svgNS, 'rect');
            outerRect.setAttribute('x', x - mw / 2);
            outerRect.setAttribute('y', y - mh / 2);
            outerRect.setAttribute('width', mw);
            outerRect.setAttribute('height', mh);
            outerRect.setAttribute('rx', 8 * m);
            g.appendChild(outerRect);

            const innerRect = document.createElementNS(svgNS, 'rect');
            innerRect.setAttribute('x', x - mw / 2 + 4 * m);
            innerRect.setAttribute('y', y - mh / 2 + 4 * m);
            innerRect.setAttribute('width', mw - 8 * m);
            innerRect.setAttribute('height', mh - 8 * m);
            innerRect.setAttribute('rx', 5 * m);
            innerRect.classList.add('moduler-inner-rect');
            g.appendChild(innerRect);

            const text = document.createElementNS(svgNS, 'text');
            text.setAttribute('x', x);
            text.setAttribute('y', y - 5 * m);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'middle');
            text.setAttribute('font-size', Math.round(11 * m));
            text.setAttribute('font-weight', 'bold');
            text.setAttribute('fill', 'var(--station-stroke)');
            text.textContent = station.name || station.config?.name || station.id;
            g.appendChild(text);

            const subText = document.createElementNS(svgNS, 'text');
            subText.setAttribute('x', x);
            subText.setAttribute('y', y + 12 * m);
            subText.setAttribute('text-anchor', 'middle');
            subText.setAttribute('dominant-baseline', 'middle');
            subText.setAttribute('font-size', Math.round(9 * m));
            subText.setAttribute('fill', 'var(--text-secondary)');
            const entryCount = station.config.entryCount || 1;
            const exitCount  = station.config.exitCount  || 1;
            subText.textContent = `E:${entryCount} X:${exitCount}`;
            g.appendChild(subText);
        }
    }

    _renderModulerPorts(parentGroup, station) {
        const entryCount = station.config.entryCount || 1;
        const exitCount = station.config.exitCount || 1;
        const { w, h } = this._getModulerSize(station);
        const { cx, cy } = this._getModulerVisualCenter(station);

        const portWidth  = MODULER_PORT_W;
        const portHeight = MODULER_PORT_H;
        const gap        = MODULER_PORT_GAP;

        // Fallback even-spacing helpers (use visual center)
        const entryTotalH = entryCount * portHeight + (entryCount - 1) * (gap - portHeight);
        const entryStartY = cy - entryTotalH / 2;
        const exitTotalH  = exitCount  * portHeight + (exitCount  - 1) * (gap - portHeight);
        const exitStartY  = cy - exitTotalH  / 2;

        const renderPort = (i, portType, fallbackCenterX, fallbackCenterY, label, fillColor) => {
            const mapped = this._getModulerPortPos(station, i, portType);
            const cx = mapped ? mapped.x : fallbackCenterX;
            const cy = mapped ? mapped.y : fallbackCenterY;

            const bufGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            bufGroup.classList.add('port-slot', portType === 'input' ? 'port-slot-entry' : 'port-slot-exit');
            bufGroup.dataset.stationId = station.id;
            bufGroup.dataset.portIndex = i;
            bufGroup.dataset.portType = portType;

            const isConnected = portType === 'input'
                ? this.editor.scenario.connections.some(c => c.to === station.id && c.toPortIndex === i)
                : this.editor.scenario.connections.some(c => c.from === station.id && c.fromPortIndex === i);
            if (isConnected) bufGroup.classList.add('connected');

            const bufRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bufRect.setAttribute('x', cx - portWidth / 2);
            bufRect.setAttribute('y', cy - portHeight / 2);
            bufRect.setAttribute('width', portWidth);
            bufRect.setAttribute('height', portHeight);
            bufRect.setAttribute('rx', 2);

            const bufText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            bufText.setAttribute('x', cx);
            bufText.setAttribute('y', cy);
            bufText.setAttribute('text-anchor', 'middle');
            bufText.setAttribute('dominant-baseline', 'middle');
            bufText.setAttribute('font-size', '7');
            bufText.setAttribute('fill', fillColor);
            bufText.textContent = label;

            bufGroup.appendChild(bufRect);
            bufGroup.appendChild(bufText);
            parentGroup.appendChild(bufGroup);
        };

        // Entry ports
        for (let i = 0; i < entryCount; i++) {
            renderPort(i, 'input',
                cx - w / 2 + portWidth / 2,
                entryStartY + i * gap + portHeight / 2,
                `E${i}`, '#2e7d32');
        }

        // Exit ports
        for (let i = 0; i < exitCount; i++) {
            renderPort(i, 'output',
                cx + w / 2 - portWidth / 2,
                exitStartY + i * gap + portHeight / 2,
                `X${i}`, '#e65100');
        }
    }

    _renderMergePorts(parentGroup, station) {
        const ports = station.config.inPorts || station.config.ports || [];
        const count = ports.length;
        if (count === 0) return;

        const portWidth  = SPLIT_PORT_W;
        const portHeight = SPLIT_PORT_H;
        const gap        = SPLIT_PORT_GAP;
        const { cx, cy, hw } = this._getStationBounds(station);
        const totalHeight = count * portHeight + (count - 1) * (gap - portHeight);
        const startY = cy - totalHeight / 2;

        ports.forEach((buf, i) => {
            const bufX = cx - hw - portWidth - 10; // Left of station
            const bufY = startY + i * gap;

            const bufGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            bufGroup.classList.add('port-slot', 'port-slot-merge');
            bufGroup.dataset.stationId = station.id;
            bufGroup.dataset.portIndex = i;
            bufGroup.dataset.portType = 'input';

            // Check if connected
            const isConnected = this.editor.scenario.connections.some(
                c => c.to === station.id && c.toPortIndex === i
            );
            if (isConnected) {
                bufGroup.classList.add('connected');
            }

            const bufRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bufRect.setAttribute('x', bufX);
            bufRect.setAttribute('y', bufY);
            bufRect.setAttribute('width', portWidth);
            bufRect.setAttribute('height', portHeight);
            bufRect.setAttribute('rx', 3);

            const bufText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            bufText.setAttribute('x', bufX + portWidth / 2);
            bufText.setAttribute('y', bufY + portHeight / 2);
            bufText.setAttribute('text-anchor', 'middle');
            bufText.setAttribute('dominant-baseline', 'middle');
            bufText.setAttribute('font-size', '9');
            bufText.setAttribute('fill', '#6f42c1');
            bufText.textContent = `B${i}`;

            bufGroup.appendChild(bufRect);
            bufGroup.appendChild(bufText);
            parentGroup.appendChild(bufGroup);

            // Line from port to station body
            const connLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            connLine.setAttribute('x1', bufX + portWidth);
            connLine.setAttribute('y1', bufY + portHeight / 2);
            connLine.setAttribute('x2', cx - hw);
            connLine.setAttribute('y2', cy);
            connLine.setAttribute('stroke', '#6f42c180');
            connLine.setAttribute('stroke-width', '1');
            connLine.setAttribute('stroke-dasharray', '3,2');
            parentGroup.appendChild(connLine);
        });
    }

    _renderSplitPorts(parentGroup, station) {
        const ports = station.config.outPorts || station.config.ports || [];
        const count = ports.length;
        if (count === 0) return;

        const portWidth  = SPLIT_PORT_W;
        const portHeight = SPLIT_PORT_H;
        const gap        = SPLIT_PORT_GAP;
        const { cx, cy, hw } = this._getStationBounds(station);
        const totalHeight = count * portHeight + (count - 1) * (gap - portHeight);
        const startY = cy - totalHeight / 2;

        ports.forEach((buf, i) => {
            const bufX = cx + hw + 10; // Right of station
            const bufY = startY + i * gap;

            const bufGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            bufGroup.classList.add('port-slot', 'port-slot-split');
            bufGroup.dataset.stationId = station.id;
            bufGroup.dataset.portIndex = i;
            bufGroup.dataset.portType = 'output';

            // Check if connected
            const isConnected = this.editor.scenario.connections.some(
                c => c.from === station.id && c.fromPortIndex === i
            );
            if (isConnected) {
                bufGroup.classList.add('connected');
            }

            const bufRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bufRect.setAttribute('x', bufX);
            bufRect.setAttribute('y', bufY);
            bufRect.setAttribute('width', portWidth);
            bufRect.setAttribute('height', portHeight);
            bufRect.setAttribute('rx', 3);

            const bufText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            bufText.setAttribute('x', bufX + portWidth / 2);
            bufText.setAttribute('y', bufY + portHeight / 2);
            bufText.setAttribute('text-anchor', 'middle');
            bufText.setAttribute('dominant-baseline', 'middle');
            bufText.setAttribute('font-size', '9');
            bufText.setAttribute('fill', '#fd7e14');
            bufText.textContent = `B${i}`;

            bufGroup.appendChild(bufRect);
            bufGroup.appendChild(bufText);
            parentGroup.appendChild(bufGroup);

            // Line from station body to port
            const connLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            connLine.setAttribute('x1', cx + hw);
            connLine.setAttribute('y1', cy);
            connLine.setAttribute('x2', bufX);
            connLine.setAttribute('y2', bufY + portHeight / 2);
            connLine.setAttribute('stroke', '#fd7e1480');
            connLine.setAttribute('stroke-width', '1');
            connLine.setAttribute('stroke-dasharray', '3,2');
            parentGroup.appendChild(connLine);
        });
    }

    // Get the position of a port slot (for connection line endpoints)
    _getPortPosition(stationId, portIndex, portType) {
        const station = this.editor.getStation(stationId);
        if (!station) return null;

        // ModulerStation ports — connection line attaches to port indicator edge
        if (station.type === 'moduler') {
            const { w } = this._getModulerSize(station);
            const { cx, cy } = this._getModulerVisualCenter(station);
            const portWidth  = MODULER_PORT_W;
            const portHeight = MODULER_PORT_H;
            const gap        = MODULER_PORT_GAP;

            if (portType === 'input') {
                const count = station.config.entryCount || 1;
                if (portIndex < 0 || portIndex >= count) return null;
                const mapped = this._getModulerPortPos(station, portIndex, 'input');
                if (mapped) return { x: mapped.x - portWidth / 2, y: mapped.y };
                const totalH = count * portHeight + (count - 1) * (gap - portHeight);
                const startY = cy - totalH / 2;
                const fallbackX = cx - w / 2 + portWidth / 2;
                return { x: fallbackX - portWidth / 2, y: startY + portIndex * gap + portHeight / 2 };
            } else {
                const count = station.config.exitCount || 1;
                if (portIndex < 0 || portIndex >= count) return null;
                const mapped = this._getModulerPortPos(station, portIndex, 'output');
                if (mapped) return { x: mapped.x + portWidth / 2, y: mapped.y };
                const totalH = count * portHeight + (count - 1) * (gap - portHeight);
                const startY = cy - totalH / 2;
                const fallbackX = cx + w / 2 - portWidth / 2;
                return { x: fallbackX + portWidth / 2, y: startY + portIndex * gap + portHeight / 2 };
            }
        }

        // Merge/Split ports
        const ports = (portType === 'input')
            ? (station.config.inPorts || station.config.ports || [])
            : (station.config.outPorts || station.config.ports || []);
        const count = ports.length;
        if (portIndex < 0 || portIndex >= count) return null;

        const portWidth  = SPLIT_PORT_W;
        const portHeight = SPLIT_PORT_H;
        const gap        = SPLIT_PORT_GAP;
        const { cx, cy, hw } = this._getStationBounds(station);
        const totalHeight = count * portHeight + (count - 1) * (gap - portHeight);
        const startY = cy - totalHeight / 2;
        const bufY = startY + portIndex * gap + portHeight / 2;

        if (portType === 'input') {
            // Merge input port: left side
            const bufX = cx - hw - portWidth - 10;
            return { x: bufX, y: bufY }; // Left edge of port
        } else {
            // Split output port: right side
            const bufX = cx + hw + 10 + portWidth;
            return { x: bufX, y: bufY }; // Right edge of port
        }
    }

    _getConnectionEndpoints(connection) {
        const fromStation = this.editor.getStation(connection.from);
        const toStation = this.editor.getStation(connection.to);
        if (!fromStation || !toStation) return null;

        // Direction vector from source center to target center (used for edge intersection)
        const fc = this._getStationCenter(fromStation);
        const tc = this._getStationCenter(toStation);
        const dxTotal = tc.x - fc.x, dyTotal = tc.y - fc.y;
        const dist = Math.sqrt(dxTotal * dxTotal + dyTotal * dyTotal);
        const nx = dist > 0 ? dxTotal / dist : 1;
        const ny = dist > 0 ? dyTotal / dist : 0;

        // Source endpoint
        let x1, y1;
        const isFromPort = connection.fromPortIndex >= 0 &&
            (fromStation.type === 'split' || fromStation.type === 'moduler');
        if (isFromPort) {
            const bufPos = this._getPortPosition(connection.from, connection.fromPortIndex, 'output');
            if (bufPos) { x1 = bufPos.x; y1 = bufPos.y; }
            else { const ep = this._getStationEdgePoint(fromStation, nx, ny); x1 = ep.x; y1 = ep.y; }
        } else {
            // Exit from the edge of fromStation facing toStation
            const ep = this._getStationEdgePoint(fromStation, nx, ny);
            x1 = ep.x; y1 = ep.y;
        }

        // Destination endpoint
        let x2, y2;
        const isToPort = connection.toPortIndex >= 0 &&
            (toStation.type === 'merge' || toStation.type === 'moduler');
        if (isToPort) {
            const bufPos = this._getPortPosition(connection.to, connection.toPortIndex, 'input');
            if (bufPos) { x2 = bufPos.x; y2 = bufPos.y; }
            else { const ep = this._getStationEdgePoint(toStation, -nx, -ny); x2 = ep.x; y2 = ep.y; }
        } else {
            // Enter from the edge of toStation facing fromStation
            const ep = this._getStationEdgePoint(toStation, -nx, -ny);
            x2 = ep.x; y2 = ep.y;
        }

        return { x1, y1, x2, y2 };
    }

    _renderConnections() {
        this.connectionsLayer.innerHTML = '';
        const lineStyle = this.editor.getLineStyle();

        this.editor.scenario.connections.forEach((connection, index) => {
            const pts = this._getConnectionEndpoints(connection);
            if (!pts) return;

            const isSelected = this.editor.selectedItem?.type === 'connection' &&
                               this.editor.selectedItem.index === index;

            let el;
            if (lineStyle === 'straight') {
                el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                el.setAttribute('x1', pts.x1);
                el.setAttribute('y1', pts.y1);
                el.setAttribute('x2', pts.x2);
                el.setAttribute('y2', pts.y2);
            } else if (lineStyle === 'bezier') {
                el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                // Direction-aware bezier: tangent follows the line from source to target
                const bdx = pts.x2 - pts.x1, bdy = pts.y2 - pts.y1;
                const bLen = Math.sqrt(bdx * bdx + bdy * bdy);
                const bnx = bLen > 0 ? bdx / bLen : 1;
                const bny = bLen > 0 ? bdy / bLen : 0;
                const strength = bLen * 0.4;
                const cp1x = pts.x1 + bnx * strength, cp1y = pts.y1 + bny * strength;
                const cp2x = pts.x2 - bnx * strength, cp2y = pts.y2 - bny * strength;
                el.setAttribute('d', `M${pts.x1},${pts.y1} C${cp1x},${cp1y} ${cp2x},${cp2y} ${pts.x2},${pts.y2}`);
                el.setAttribute('fill', 'none');
            } else {
                // orthogonal: choose primary axis based on which dimension is larger
                el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                const odx = Math.abs(pts.x2 - pts.x1), ody = Math.abs(pts.y2 - pts.y1);
                let od;
                if (ody > odx * 1.5) {
                    // Predominantly vertical: go halfway down, then across, then down
                    const midY = (pts.y1 + pts.y2) / 2;
                    od = `M${pts.x1},${pts.y1} V${midY} H${pts.x2} V${pts.y2}`;
                } else {
                    // Predominantly horizontal (default): go halfway across, then down, then across
                    const midX = (pts.x1 + pts.x2) / 2;
                    od = `M${pts.x1},${pts.y1} H${midX} V${pts.y2} H${pts.x2}`;
                }
                el.setAttribute('d', od);
                el.setAttribute('fill', 'none');
            }

            el.classList.add('connection');
            if (isSelected) el.classList.add('selected');
            el.dataset.connectionIndex = index;
            this.connectionsLayer.appendChild(el);
        });
    }

    fitToScreen() {
        const stations = this.editor.scenario.stations;
        if (stations.length === 0) return;

        // Calculate bounding box using actual station bounds (handles Moduler correctly)
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        stations.forEach(s => {
            const { cx, cy, hw, hh } = this._getStationBounds(s);
            minX = Math.min(minX, cx - hw);
            minY = Math.min(minY, cy - hh);
            maxX = Math.max(maxX, cx + hw);
            maxY = Math.max(maxY, cy + hh);
        });

        const padding = 80;
        const targetX = minX - padding;
        const targetY = minY - padding;
        const targetW = (maxX - minX) + padding * 2;
        const targetH = (maxY - minY) + padding * 2;

        // Maintain aspect ratio based on SVG element size
        const svgRect = this.svg.getBoundingClientRect();
        const svgAspect = svgRect.width / svgRect.height;
        const contentAspect = targetW / targetH;

        let finalW, finalH, finalX, finalY;
        if (contentAspect > svgAspect) {
            // Content is wider - fit to width
            finalW = targetW;
            finalH = targetW / svgAspect;
            finalX = targetX;
            finalY = targetY - (finalH - targetH) / 2;
        } else {
            // Content is taller - fit to height
            finalH = targetH;
            finalW = targetH * svgAspect;
            finalX = targetX - (finalW - targetW) / 2;
            finalY = targetY;
        }

        // Animate from current viewBox to target
        const startVB = { ...this.viewBox };
        const endVB = { x: finalX, y: finalY, width: finalW, height: finalH };
        const duration = 300;
        const startTime = performance.now();

        const animate = (now) => {
            const t = Math.min((now - startTime) / duration, 1);
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
            this.viewBox.x = startVB.x + (endVB.x - startVB.x) * ease;
            this.viewBox.y = startVB.y + (endVB.y - startVB.y) * ease;
            this.viewBox.width = startVB.width + (endVB.width - startVB.width) * ease;
            this.viewBox.height = startVB.height + (endVB.height - startVB.height) * ease;
            this._updateViewBox();
            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                this.zoom = svgRect.width / finalW;
            }
        };
        requestAnimationFrame(animate);
    }

    _drawAlignmentGuides(x, y, hasX, hasY) {
        this._clearAlignmentGuides();
        const vb = this.viewBox;
        if (hasX) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.classList.add('alignment-guide');
            line.setAttribute('x1', x);
            line.setAttribute('y1', vb.y);
            line.setAttribute('x2', x);
            line.setAttribute('y2', vb.y + vb.height);
            this.svg.appendChild(line);
        }
        if (hasY) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.classList.add('alignment-guide');
            line.setAttribute('x1', vb.x);
            line.setAttribute('y1', y);
            line.setAttribute('x2', vb.x + vb.width);
            line.setAttribute('y2', y);
            this.svg.appendChild(line);
        }
    }

    _clearAlignmentGuides() {
        this.svg.querySelectorAll('.alignment-guide').forEach(el => el.remove());
    }

    _drawSelectionRect(x, y, w, h) {
        this._removeSelectionRect();
        this.rectSelectRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        this.rectSelectRect.setAttribute('x', x);
        this.rectSelectRect.setAttribute('y', y);
        this.rectSelectRect.setAttribute('width', w);
        this.rectSelectRect.setAttribute('height', h);
        this.rectSelectRect.setAttribute('fill', 'rgba(74, 158, 255, 0.1)');
        this.rectSelectRect.setAttribute('stroke', '#4a9eff');
        this.rectSelectRect.setAttribute('stroke-width', '1');
        this.rectSelectRect.setAttribute('stroke-dasharray', '5,3');
        this.rectSelectRect.style.pointerEvents = 'none';
        this.svg.appendChild(this.rectSelectRect);
    }

    _removeSelectionRect() {
        if (this.rectSelectRect) {
            this.rectSelectRect.remove();
            this.rectSelectRect = null;
        }
    }
}
