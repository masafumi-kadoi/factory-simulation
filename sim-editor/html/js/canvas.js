// Canvas rendering and interaction
import { MoveStationCommand } from './undo.js';

export class Canvas {
    constructor(svg, editor) {
        this.svg = svg;
        this.editor = editor;
        this.stationsLayer = document.getElementById('stations-layer');
        this.connectionsLayer = document.getElementById('connections-layer');

        // Drag state
        this.draggedStation = null;
        this.dragOffset = { x: 0, y: 0 };
        this.dragStartPos = { x: 0, y: 0 }; // Store initial position for undo

        // Connection drag state
        this.connectFrom = null;
        this.connectionDragLine = null; // Temporary line during connection drag
        this.isDraggingConnection = false;

        // Pan/Zoom state
        this.viewBox = { x: 0, y: 0, width: 2000, height: 1200 };
        this.zoom = 1.0;
        this.isPanning = false;
        this.panStart = { x: 0, y: 0 };

        // Grid snap settings
        this.gridSize = 20;
        this.snapToGrid = true;

        this._setupEventListeners();
        this._updateViewBox();
    }

    _setupEventListeners() {
        this.svg.addEventListener('click', (e) => this._handleClick(e));
        this.svg.addEventListener('mousedown', (e) => this._handleMouseDown(e));
        this.svg.addEventListener('mousemove', (e) => this._handleMouseMove(e));
        this.svg.addEventListener('mouseup', (e) => this._handleMouseUp(e));
        this.svg.addEventListener('wheel', (e) => this._handleWheel(e));
        this.svg.addEventListener('contextmenu', (e) => e.preventDefault()); // Disable context menu
    }

    _updateViewBox() {
        this.svg.setAttribute('viewBox',
            `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.width} ${this.viewBox.height}`
        );
    }

    _snapToGrid(value) {
        if (this.snapToGrid) {
            return Math.round(value / this.gridSize) * this.gridSize;
        }
        return value;
    }

    _handleClick(e) {
        const target = e.target;
        const tool = this.editor.currentTool;

        // Get SVG coordinates
        const pt = this._getSVGPoint(e);

        // Check if clicked on station or connection
        const stationId = target.closest('.station')?.dataset?.stationId;
        const connectionIndex = target.closest('.connection')?.dataset?.connectionIndex;

        if (stationId) {
            if (tool === 'select') {
                this.editor.selectItem({ type: 'station', id: stationId });
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
            // Clicked on empty space
            if (tool === 'source' || tool === 'processing' || tool === 'drain' || tool === 'merge' || tool === 'split') {
                this.editor.addStation(tool, pt.x, pt.y);
            } else if (tool === 'select') {
                this.editor.selectItem(null);
            }
        }
    }

    _handleConnectClick(stationId) {
        if (this.connectFrom === null) {
            // First click - set source
            this.connectFrom = stationId;
            document.getElementById('canvas-info').textContent = `${stationId} から接続 → 次のステーションをクリック`;
        } else {
            // Second click - create connection
            if (this.connectFrom === stationId) {
                alert('同じステーションには接続できません');
                this.connectFrom = null;
                return;
            }

            this.editor.addConnection(this.connectFrom, stationId);
            this.connectFrom = null;
            document.getElementById('canvas-info').textContent = 'ステーションをクリックして接続作成';
        }
    }

    _handleMouseDown(e) {
        const pt = this._getSVGPoint(e);

        // Middle button (button 1) for panning
        if (e.button === 1) {
            this.isPanning = true;
            this.panStart = { x: e.clientX, y: e.clientY };
            e.preventDefault();
            return;
        }

        // Left button (button 0)
        if (e.button === 0) {
            const station = e.target.closest('.station');

            // Check if clicking on station edge for connection drag (connect mode or holding Shift)
            if (station && (this.editor.currentTool === 'connect' || e.shiftKey)) {
                const stationId = station.dataset.stationId;
                this.isDraggingConnection = true;
                this.connectFrom = stationId;

                // Create temporary drag line
                this.connectionDragLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                this.connectionDragLine.setAttribute('stroke', '#4a9eff');
                this.connectionDragLine.setAttribute('stroke-width', '2');
                this.connectionDragLine.setAttribute('stroke-dasharray', '5,5');
                this.connectionDragLine.setAttribute('x1', pt.x);
                this.connectionDragLine.setAttribute('y1', pt.y);
                this.connectionDragLine.setAttribute('x2', pt.x);
                this.connectionDragLine.setAttribute('y2', pt.y);
                this.connectionsLayer.appendChild(this.connectionDragLine);

                e.preventDefault();
                return;
            }

            // Station drag (select mode only, no Shift)
            if (station && this.editor.currentTool === 'select' && !e.shiftKey) {
                const stationId = station.dataset.stationId;
                const stationData = this.editor.getStation(stationId);
                if (!stationData) return;

                this.draggedStation = stationId;
                this.dragOffset = {
                    x: pt.x - stationData.x,
                    y: pt.y - stationData.y
                };
                // Store initial position for undo
                this.dragStartPos = {
                    x: stationData.x,
                    y: stationData.y
                };

                e.preventDefault();
                return;
            }
        }
    }

    _handleMouseMove(e) {
        const pt = this._getSVGPoint(e);

        // Handle panning
        if (this.isPanning) {
            const dx = (e.clientX - this.panStart.x) / this.zoom;
            const dy = (e.clientY - this.panStart.y) / this.zoom;

            this.viewBox.x -= dx;
            this.viewBox.y -= dy;

            this.panStart = { x: e.clientX, y: e.clientY };
            this._updateViewBox();
            return;
        }

        // Handle connection drag
        if (this.isDraggingConnection && this.connectionDragLine) {
            this.connectionDragLine.setAttribute('x2', pt.x);
            this.connectionDragLine.setAttribute('y2', pt.y);
            return;
        }

        // Handle station drag
        if (this.draggedStation) {
            let newX = pt.x - this.dragOffset.x;
            let newY = pt.y - this.dragOffset.y;

            // Apply grid snap
            newX = this._snapToGrid(newX);
            newY = this._snapToGrid(newY);

            this.editor.moveStation(this.draggedStation, newX, newY);
        }
    }

    _handleMouseUp(e) {
        // Handle panning end
        if (this.isPanning) {
            this.isPanning = false;
            return;
        }

        // Handle connection drag end
        if (this.isDraggingConnection) {
            // Remove temporary drag line
            if (this.connectionDragLine) {
                this.connectionDragLine.remove();
                this.connectionDragLine = null;
            }

            // Check if mouse is over a station
            const station = e.target.closest('.station');
            if (station && this.connectFrom) {
                const toId = station.dataset.stationId;
                if (toId !== this.connectFrom) {
                    this.editor.addConnection(this.connectFrom, toId);
                }
            }

            this.isDraggingConnection = false;
            this.connectFrom = null;
            return;
        }

        // Handle station drag end
        if (this.draggedStation) {
            const stationData = this.editor.getStation(this.draggedStation);
            if (stationData) {
                // Check if position actually changed
                if (stationData.x !== this.dragStartPos.x || stationData.y !== this.dragStartPos.y) {
                    // Create move command for undo/redo
                    const command = new MoveStationCommand(
                        this.editor,
                        this.draggedStation,
                        this.dragStartPos.x,
                        this.dragStartPos.y,
                        stationData.x,
                        stationData.y
                    );
                    // Add to command history without executing (already moved during drag)
                    this.editor.commandManager.undoStack.push(command);
                    this.editor.commandManager.redoStack = [];
                    this.editor._updateUndoRedoButtons();
                }
            }
            this.draggedStation = null;
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

        // Update zoom
        this.zoom = newZoom;

        // Adjust viewBox to zoom towards cursor
        const newWidth = 2000 / this.zoom;
        const newHeight = 1200 / this.zoom;

        this.viewBox.width = newWidth;
        this.viewBox.height = newHeight;

        // Keep cursor position fixed
        this.viewBox.x = svgX - (mouseX / rect.width) * newWidth;
        this.viewBox.y = svgY - (mouseY / rect.height) * newHeight;

        this._updateViewBox();
    }

    _getSVGPoint(e) {
        const rect = this.svg.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Convert to SVG coordinates considering viewBox
        const svgX = this.viewBox.x + (x / rect.width) * this.viewBox.width;
        const svgY = this.viewBox.y + (y / rect.height) * this.viewBox.height;

        return { x: svgX, y: svgY };
    }

    render() {
        this._renderConnections();
        this._renderStations();
    }

    _renderStations() {
        this.stationsLayer.innerHTML = '';

        this.editor.scenario.stations.forEach(station => {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.classList.add('station', `station-${station.type}`);
            g.dataset.stationId = station.id;

            const isSelected = this.editor.selectedItem?.type === 'station' &&
                               this.editor.selectedItem.id === station.id;
            if (isSelected) {
                g.classList.add('selected');
            }

            // Rectangle
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', station.x - 40);
            rect.setAttribute('y', station.y - 30);
            rect.setAttribute('width', 80);
            rect.setAttribute('height', 60);
            rect.setAttribute('rx', 8);

            // Text
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', station.x);
            text.setAttribute('y', station.y);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'middle');
            text.setAttribute('font-size', '12');
            text.setAttribute('font-weight', 'bold');
            text.setAttribute('fill', '#333');
            text.textContent = station.id;

            g.appendChild(rect);
            g.appendChild(text);
            this.stationsLayer.appendChild(g);
        });
    }

    _renderConnections() {
        this.connectionsLayer.innerHTML = '';

        this.editor.scenario.connections.forEach((connection, index) => {
            const fromStation = this.editor.getStation(connection.from);
            const toStation = this.editor.getStation(connection.to);

            if (!fromStation || !toStation) return;

            const isSelected = this.editor.selectedItem?.type === 'connection' &&
                               this.editor.selectedItem.index === index;

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.classList.add('connection');
            if (isSelected) {
                line.classList.add('selected');
            }
            line.dataset.connectionIndex = index;
            line.setAttribute('x1', fromStation.x + 40);
            line.setAttribute('y1', fromStation.y);
            line.setAttribute('x2', toStation.x - 40);
            line.setAttribute('y2', toStation.y);

            this.connectionsLayer.appendChild(line);
        });
    }
}
