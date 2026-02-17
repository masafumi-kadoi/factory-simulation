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
        this.connectFromBufferIndex = -1; // Buffer index for Split output buffer
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

        // Check if clicked on buffer slot
        const bufferSlot = target.closest('.buffer-slot');
        if (bufferSlot) {
            const stationId = bufferSlot.dataset.stationId;
            const bufferIndex = parseInt(bufferSlot.dataset.bufferIndex);
            const bufferType = bufferSlot.dataset.bufferType; // 'input' or 'output'

            if (tool === 'connect') {
                this._handleBufferConnectClick(stationId, bufferIndex, bufferType);
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

    _handleBufferConnectClick(stationId, bufferIndex, bufferType) {
        const station = this.editor.getStation(stationId);
        if (!station) return;

        if (bufferType === 'input') {
            // Merge input buffer: this is a connection TARGET
            if (this.connectFrom === null) {
                // Can't start a connection from an input buffer
                document.getElementById('canvas-info').textContent = '入力バッファからは接続開始できません。上流ステーションからドラッグしてください。';
                return;
            }
            // Check if this buffer already has a connection
            if (this._isBufferConnected(stationId, bufferIndex, 'input')) {
                alert('このバッファには既に接続があります');
                this.connectFrom = null;
                this.connectFromBufferIndex = -1;
                return;
            }
            // Create connection to this buffer
            this.editor.addConnection(this.connectFrom, stationId, this.connectFromBufferIndex, bufferIndex);
            this.connectFrom = null;
            this.connectFromBufferIndex = -1;
            document.getElementById('canvas-info').textContent = 'ステーションをクリックして接続作成';
        } else if (bufferType === 'output') {
            // Split output buffer: this is a connection SOURCE
            if (this.connectFrom !== null) {
                // Already have a source; can't use output buffer as target
                document.getElementById('canvas-info').textContent = '出力バッファは接続先として使用できません';
                this.connectFrom = null;
                this.connectFromBufferIndex = -1;
                return;
            }
            // Check if this buffer already has a connection
            if (this._isBufferConnected(stationId, bufferIndex, 'output')) {
                alert('このバッファには既に接続があります');
                return;
            }
            // Set as connection source
            this.connectFrom = stationId;
            this.connectFromBufferIndex = bufferIndex;
            document.getElementById('canvas-info').textContent = `${stationId}[buf${bufferIndex}] から接続 → 次のステーション/バッファをクリック`;
        }
    }

    _isBufferConnected(stationId, bufferIndex, bufferType) {
        return this.editor.scenario.connections.some(c => {
            if (bufferType === 'input') {
                return c.to === stationId && c.toBufferIndex === bufferIndex;
            } else {
                return c.from === stationId && c.fromBufferIndex === bufferIndex;
            }
        });
    }

    _handleConnectClick(stationId) {
        if (this.connectFrom === null) {
            // First click - set source
            const station = this.editor.getStation(stationId);
            if (station && station.type === 'split') {
                // For split stations, user should click on a specific output buffer
                document.getElementById('canvas-info').textContent = 'Splitステーションの出力バッファをクリックしてください';
                return;
            }
            this.connectFrom = stationId;
            this.connectFromBufferIndex = -1;
            document.getElementById('canvas-info').textContent = `${stationId} から接続 → 次のステーション/バッファをクリック`;
        } else {
            // Second click - create connection
            if (this.connectFrom === stationId) {
                alert('同じステーションには接続できません');
                this.connectFrom = null;
                this.connectFromBufferIndex = -1;
                return;
            }

            const toStation = this.editor.getStation(stationId);
            if (toStation && toStation.type === 'merge') {
                // For merge stations, user should click on a specific input buffer
                document.getElementById('canvas-info').textContent = 'Mergeステーションの入力バッファをクリックしてください';
                return;
            }

            this.editor.addConnection(this.connectFrom, stationId, this.connectFromBufferIndex, -1);
            this.connectFrom = null;
            this.connectFromBufferIndex = -1;
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
            const bufferSlot = e.target.closest('.buffer-slot');

            // Check if clicking on buffer slot for connection drag
            if (bufferSlot && (this.editor.currentTool === 'connect' || e.shiftKey)) {
                const stationId = bufferSlot.dataset.stationId;
                const bufferIndex = parseInt(bufferSlot.dataset.bufferIndex);
                const bufferType = bufferSlot.dataset.bufferType;

                // Only start drag from output buffers (split)
                if (bufferType === 'output') {
                    if (this._isBufferConnected(stationId, bufferIndex, 'output')) {
                        return; // Already connected
                    }
                    this.isDraggingConnection = true;
                    this.connectFrom = stationId;
                    this.connectFromBufferIndex = bufferIndex;

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
            }

            // Check if clicking on station edge for connection drag (connect mode or holding Shift)
            if (station && !bufferSlot && (this.editor.currentTool === 'connect' || e.shiftKey)) {
                const stationId = station.dataset.stationId;
                const stationData = this.editor.getStation(stationId);

                // Don't start connection drag from split stations (must use buffers)
                if (stationData && stationData.type === 'split') {
                    return;
                }

                this.isDraggingConnection = true;
                this.connectFrom = stationId;
                this.connectFromBufferIndex = -1;

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
            if (station && !bufferSlot && this.editor.currentTool === 'select' && !e.shiftKey) {
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

            // Check if mouse is over a buffer slot or station
            const bufferSlot = e.target.closest('.buffer-slot');
            const station = e.target.closest('.station');

            if (bufferSlot && this.connectFrom) {
                const toStationId = bufferSlot.dataset.stationId;
                const toBufferIndex = parseInt(bufferSlot.dataset.bufferIndex);
                const bufferType = bufferSlot.dataset.bufferType;

                if (bufferType === 'input' && toStationId !== this.connectFrom) {
                    if (!this._isBufferConnected(toStationId, toBufferIndex, 'input')) {
                        this.editor.addConnection(this.connectFrom, toStationId, this.connectFromBufferIndex, toBufferIndex);
                    }
                }
            } else if (station && this.connectFrom) {
                const toId = station.dataset.stationId;
                if (toId !== this.connectFrom) {
                    const toStation = this.editor.getStation(toId);
                    // If dropping on a merge station, user should target a buffer
                    if (toStation && toStation.type === 'merge') {
                        // Don't create connection - need to target a buffer
                    } else {
                        this.editor.addConnection(this.connectFrom, toId, this.connectFromBufferIndex, -1);
                    }
                }
            }

            this.isDraggingConnection = false;
            this.connectFrom = null;
            this.connectFromBufferIndex = -1;
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

            // Render buffer slots for Merge/Split
            if (station.type === 'merge') {
                this._renderMergeBuffers(g, station);
            } else if (station.type === 'split') {
                this._renderSplitBuffers(g, station);
            }

            this.stationsLayer.appendChild(g);
        });
    }

    _renderMergeBuffers(parentGroup, station) {
        const buffers = station.config.buffers || [];
        const count = buffers.length;
        if (count === 0) return;

        const bufferWidth = 30;
        const bufferHeight = 20;
        const gap = 25;
        const totalHeight = count * bufferHeight + (count - 1) * (gap - bufferHeight);
        const startY = station.y - totalHeight / 2;

        buffers.forEach((buf, i) => {
            const bufX = station.x - 40 - bufferWidth - 10; // Left of station
            const bufY = startY + i * gap;

            const bufGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            bufGroup.classList.add('buffer-slot', 'buffer-slot-merge');
            bufGroup.dataset.stationId = station.id;
            bufGroup.dataset.bufferIndex = i;
            bufGroup.dataset.bufferType = 'input';

            // Check if connected
            const isConnected = this.editor.scenario.connections.some(
                c => c.to === station.id && c.toBufferIndex === i
            );
            if (isConnected) {
                bufGroup.classList.add('connected');
            }

            const bufRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bufRect.setAttribute('x', bufX);
            bufRect.setAttribute('y', bufY);
            bufRect.setAttribute('width', bufferWidth);
            bufRect.setAttribute('height', bufferHeight);
            bufRect.setAttribute('rx', 3);

            const bufText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            bufText.setAttribute('x', bufX + bufferWidth / 2);
            bufText.setAttribute('y', bufY + bufferHeight / 2);
            bufText.setAttribute('text-anchor', 'middle');
            bufText.setAttribute('dominant-baseline', 'middle');
            bufText.setAttribute('font-size', '9');
            bufText.setAttribute('fill', '#6f42c1');
            bufText.textContent = `B${i}`;

            bufGroup.appendChild(bufRect);
            bufGroup.appendChild(bufText);
            parentGroup.appendChild(bufGroup);

            // Line from buffer to station body
            const connLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            connLine.setAttribute('x1', bufX + bufferWidth);
            connLine.setAttribute('y1', bufY + bufferHeight / 2);
            connLine.setAttribute('x2', station.x - 40);
            connLine.setAttribute('y2', station.y);
            connLine.setAttribute('stroke', '#6f42c180');
            connLine.setAttribute('stroke-width', '1');
            connLine.setAttribute('stroke-dasharray', '3,2');
            parentGroup.appendChild(connLine);
        });
    }

    _renderSplitBuffers(parentGroup, station) {
        const buffers = station.config.buffers || [];
        const count = buffers.length;
        if (count === 0) return;

        const bufferWidth = 30;
        const bufferHeight = 20;
        const gap = 25;
        const totalHeight = count * bufferHeight + (count - 1) * (gap - bufferHeight);
        const startY = station.y - totalHeight / 2;

        buffers.forEach((buf, i) => {
            const bufX = station.x + 40 + 10; // Right of station
            const bufY = startY + i * gap;

            const bufGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            bufGroup.classList.add('buffer-slot', 'buffer-slot-split');
            bufGroup.dataset.stationId = station.id;
            bufGroup.dataset.bufferIndex = i;
            bufGroup.dataset.bufferType = 'output';

            // Check if connected
            const isConnected = this.editor.scenario.connections.some(
                c => c.from === station.id && c.fromBufferIndex === i
            );
            if (isConnected) {
                bufGroup.classList.add('connected');
            }

            const bufRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bufRect.setAttribute('x', bufX);
            bufRect.setAttribute('y', bufY);
            bufRect.setAttribute('width', bufferWidth);
            bufRect.setAttribute('height', bufferHeight);
            bufRect.setAttribute('rx', 3);

            const bufText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            bufText.setAttribute('x', bufX + bufferWidth / 2);
            bufText.setAttribute('y', bufY + bufferHeight / 2);
            bufText.setAttribute('text-anchor', 'middle');
            bufText.setAttribute('dominant-baseline', 'middle');
            bufText.setAttribute('font-size', '9');
            bufText.setAttribute('fill', '#fd7e14');
            bufText.textContent = `B${i}`;

            bufGroup.appendChild(bufRect);
            bufGroup.appendChild(bufText);
            parentGroup.appendChild(bufGroup);

            // Line from station body to buffer
            const connLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            connLine.setAttribute('x1', station.x + 40);
            connLine.setAttribute('y1', station.y);
            connLine.setAttribute('x2', bufX);
            connLine.setAttribute('y2', bufY + bufferHeight / 2);
            connLine.setAttribute('stroke', '#fd7e1480');
            connLine.setAttribute('stroke-width', '1');
            connLine.setAttribute('stroke-dasharray', '3,2');
            parentGroup.appendChild(connLine);
        });
    }

    // Get the position of a buffer slot (for connection line endpoints)
    _getBufferPosition(stationId, bufferIndex, bufferType) {
        const station = this.editor.getStation(stationId);
        if (!station) return null;

        const buffers = station.config.buffers || [];
        const count = buffers.length;
        if (bufferIndex < 0 || bufferIndex >= count) return null;

        const bufferWidth = 30;
        const bufferHeight = 20;
        const gap = 25;
        const totalHeight = count * bufferHeight + (count - 1) * (gap - bufferHeight);
        const startY = station.y - totalHeight / 2;
        const bufY = startY + bufferIndex * gap + bufferHeight / 2;

        if (bufferType === 'input') {
            // Merge input buffer: left side
            const bufX = station.x - 40 - bufferWidth - 10;
            return { x: bufX, y: bufY }; // Left edge of buffer
        } else {
            // Split output buffer: right side
            const bufX = station.x + 40 + 10 + bufferWidth;
            return { x: bufX, y: bufY }; // Right edge of buffer
        }
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

            // Determine start point
            let x1, y1;
            if (connection.fromBufferIndex >= 0 && fromStation.type === 'split') {
                const bufPos = this._getBufferPosition(connection.from, connection.fromBufferIndex, 'output');
                if (bufPos) {
                    x1 = bufPos.x;
                    y1 = bufPos.y;
                } else {
                    x1 = fromStation.x + 40;
                    y1 = fromStation.y;
                }
            } else {
                x1 = fromStation.x + 40;
                y1 = fromStation.y;
            }

            // Determine end point
            let x2, y2;
            if (connection.toBufferIndex >= 0 && toStation.type === 'merge') {
                const bufPos = this._getBufferPosition(connection.to, connection.toBufferIndex, 'input');
                if (bufPos) {
                    x2 = bufPos.x;
                    y2 = bufPos.y;
                } else {
                    x2 = toStation.x - 40;
                    y2 = toStation.y;
                }
            } else {
                x2 = toStation.x - 40;
                y2 = toStation.y;
            }

            line.setAttribute('x1', x1);
            line.setAttribute('y1', y1);
            line.setAttribute('x2', x2);
            line.setAttribute('y2', y2);

            this.connectionsLayer.appendChild(line);
        });
    }
}
