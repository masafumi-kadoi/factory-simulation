// Properties Panel
import { validateStation } from './validation.js';

export class PropertiesPanel {
    constructor(container, editor) {
        this.container = container;
        this.editor = editor;
    }

    render() {
        const selected = this.editor.selectedItem;

        if (!selected) {
            this._renderScenarioInfo();
        } else if (selected.type === 'station') {
            this._renderStationProperties(selected.id);
        } else if (selected.type === 'connection') {
            this._renderConnectionProperties(selected.index);
        }
    }

    _renderScenarioInfo() {
        const scenario = this.editor.scenario;
        this.container.innerHTML = `
            <div class="property-group">
                <label class="property-label">シナリオ名</label>
                <input type="text" class="property-input" id="prop-scenario-name" value="${this._escape(scenario.name)}">
            </div>
            <div class="property-group">
                <label class="property-label">説明</label>
                <textarea class="property-input" id="prop-scenario-desc" rows="3">${this._escape(scenario.description || '')}</textarea>
            </div>
            <div class="property-group">
                <label class="property-label">統計</label>
                <div style="font-size: 0.875rem; color: #6c757d;">
                    <div>ステーション: ${scenario.stations.length}</div>
                    <div>接続: ${scenario.connections.length}</div>
                </div>
            </div>
        `;

        this.container.querySelector('#prop-scenario-name').addEventListener('change', (e) => {
            this.editor.scenario.name = e.target.value;
            document.getElementById('scenario-name').value = e.target.value;
            this.editor._markDirty();
        });

        this.container.querySelector('#prop-scenario-desc').addEventListener('change', (e) => {
            this.editor.scenario.description = e.target.value;
            this.editor._markDirty();
        });
    }

    _renderStationProperties(stationId) {
        const station = this.editor.getStation(stationId);
        if (!station) return;

        const configFields = this._getConfigFields(station.type);
        const errors = validateStation(station);

        this.container.innerHTML = `
            <div class="property-group">
                <label class="property-label">ID</label>
                <input type="text" class="property-input" value="${station.id}" disabled>
            </div>
            <div class="property-group">
                <label class="property-label">Type</label>
                <input type="text" class="property-input" value="${station.type}" disabled>
            </div>
            ${configFields.map(field => `
                <div class="property-group">
                    <label class="property-label">${field.label}</label>
                    <input
                        type="number"
                        class="property-input ${errors[field.key] ? 'error' : ''}"
                        id="prop-${field.key}"
                        value="${station.config[field.key] || ''}"
                        step="${field.step || '0.1'}"
                        min="${field.min || '0'}">
                    ${errors[field.key] ? `<div class="property-error">${errors[field.key]}</div>` : ''}
                </div>
            `).join('')}
            <div class="property-actions">
                <button class="btn-primary" id="update-btn">更新</button>
                <button class="btn-danger" id="delete-btn">削除</button>
            </div>
        `;

        this.container.querySelector('#update-btn').addEventListener('click', () => {
            const newConfig = {};
            configFields.forEach(field => {
                const value = parseFloat(this.container.querySelector(`#prop-${field.key}`).value);
                newConfig[field.key] = value;
            });

            this.editor.updateStation(stationId, newConfig);
        });

        this.container.querySelector('#delete-btn').addEventListener('click', () => {
            if (confirm('このステーションを削除しますか？')) {
                this.editor.deleteStation(stationId);
            }
        });
    }

    _renderConnectionProperties(connectionIndex) {
        const connection = this.editor.getConnection(connectionIndex);
        if (!connection) return;

        this.container.innerHTML = `
            <div class="property-group">
                <label class="property-label">From</label>
                <input type="text" class="property-input" value="${connection.from}" disabled>
            </div>
            <div class="property-group">
                <label class="property-label">To</label>
                <input type="text" class="property-input" value="${connection.to}" disabled>
            </div>
            <div class="property-group">
                <label class="property-label">Condition</label>
                <select class="property-input" id="prop-condition">
                    <option value="default" ${connection.condition === 'default' ? 'selected' : ''}>Default</option>
                </select>
            </div>
            <div class="property-actions">
                <button class="btn-danger" id="delete-connection-btn">削除</button>
            </div>
        `;

        this.container.querySelector('#delete-connection-btn').addEventListener('click', () => {
            if (confirm('この接続を削除しますか？')) {
                this.editor.deleteConnection(connectionIndex);
            }
        });
    }

    _getConfigFields(type) {
        const fields = {
            source: [
                { key: 'workCount', label: 'Work Count', step: '1', min: '1' },
                { key: 'departureTime', label: 'Departure Time (s)', step: '0.1', min: '0.1' }
            ],
            processing: [
                { key: 'processingTime', label: 'Processing Time (s)', step: '0.1', min: '0.1' },
                { key: 'arrivalTime', label: 'Arrival Time (s)', step: '0.1', min: '0.1' },
                { key: 'departureTime', label: 'Departure Time (s)', step: '0.1', min: '0.1' }
            ],
            drain: [
                { key: 'arrivalTime', label: 'Arrival Time (s)', step: '0.1', min: '0.1' }
            ]
        };
        return fields[type] || [];
    }

    _escape(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
