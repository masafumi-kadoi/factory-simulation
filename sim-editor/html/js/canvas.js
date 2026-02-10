// Canvas rendering and interaction
export class Canvas {
    constructor(svg, editor) {
        this.svg = svg;
        this.editor = editor;
        this.stationsLayer = document.getElementById('stations-layer');
        this.connectionsLayer = document.getElementById('connections-layer');

        this.draggedStation = null;
        this.dragOffset = { x: 0, y: 0 };
        this.connectFrom = null;

        this._setupEventListeners();
    }

    _setupEventListeners() {
        this.svg.addEventListener('click', (e) => this._handleClick(e));
        this.svg.addEventListener('mousedown', (e) => this._handleMouseDown(e));
        this.svg.addEventListener('mousemove', (e) => this._handleMouseMove(e));
        this.svg.addEventListener('mouseup', (e) => this._handleMouseUp(e));
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
            if (tool === 'source' || tool === 'processing' || tool === 'drain') {
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
        if (this.editor.currentTool !== 'select') return;

        const station = e.target.closest('.station');
        if (!station) return;

        const stationId = station.dataset.stationId;
        const stationData = this.editor.getStation(stationId);
        if (!stationData) return;

        const pt = this._getSVGPoint(e);
        this.draggedStation = stationId;
        this.dragOffset = {
            x: pt.x - stationData.x,
            y: pt.y - stationData.y
        };

        e.preventDefault();
    }

    _handleMouseMove(e) {
        if (!this.draggedStation) return;

        const pt = this._getSVGPoint(e);
        const newX = pt.x - this.dragOffset.x;
        const newY = pt.y - this.dragOffset.y;

        this.editor.moveStation(this.draggedStation, newX, newY);
    }

    _handleMouseUp(e) {
        this.draggedStation = null;
    }

    _getSVGPoint(e) {
        const rect = this.svg.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
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
