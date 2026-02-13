// Properties Panel
import { validateStation } from './validation.js';
import { apiClient } from './api.js';

export class PropertiesPanel {
    constructor(container, editor) {
        this.container = container;
        this.editor = editor;
        this._locationMasterCache = null;
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
        const simdb = scenario.simdbConfig || {};

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
            <div class="simdb-section">
                <div class="property-group">
                    <label class="property-label simdb-section-title">SimDB設定</label>
                </div>
                <div class="property-group">
                    <label class="property-label">Host</label>
                    <input type="text" class="property-input" id="prop-simdb-host" value="${this._escape(simdb.host || '')}" placeholder="localhost">
                </div>
                <div class="property-group">
                    <label class="property-label">Port</label>
                    <input type="number" class="property-input" id="prop-simdb-port" value="${simdb.port || 5432}" min="1" max="65535">
                </div>
                <div class="property-group">
                    <label class="property-label">Database</label>
                    <input type="text" class="property-input" id="prop-simdb-database" value="${this._escape(simdb.database || '')}" placeholder="simdb">
                </div>
                <div class="property-group">
                    <label class="property-label">User</label>
                    <input type="text" class="property-input" id="prop-simdb-user" value="${this._escape(simdb.user || '')}" placeholder="postgres">
                </div>
                <div class="property-group">
                    <label class="property-label">Password</label>
                    <input type="password" class="property-input" id="prop-simdb-password" value="${this._escape(simdb.password || '')}" placeholder="パスワード">
                </div>
                <div class="property-group">
                    <button class="btn-primary" id="simdb-save-btn" style="width: 100%;">SimDB設定を保存</button>
                </div>
                <div class="property-group">
                    <button class="btn-secondary" id="simdb-test-btn" style="width: 100%;">接続テスト</button>
                    <div id="simdb-test-result" style="margin-top: 0.5rem; font-size: 0.8rem;"></div>
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

        this.container.querySelector('#simdb-save-btn').addEventListener('click', () => {
            this._saveSimDBConfig();
        });

        this.container.querySelector('#simdb-test-btn').addEventListener('click', () => {
            this._testSimDBConnection();
        });
    }

    _saveSimDBConfig() {
        const host = this.container.querySelector('#prop-simdb-host').value.trim();
        const port = parseInt(this.container.querySelector('#prop-simdb-port').value) || 5432;
        const database = this.container.querySelector('#prop-simdb-database').value.trim();
        const user = this.container.querySelector('#prop-simdb-user').value.trim();
        const password = this.container.querySelector('#prop-simdb-password').value;

        if (!host) {
            this.editor.scenario.simdbConfig = null;
        } else {
            this.editor.scenario.simdbConfig = { host, port, database, user, password };
        }
        this.editor._markDirty();
    }

    async _testSimDBConnection() {
        const resultEl = this.container.querySelector('#simdb-test-result');
        const btn = this.container.querySelector('#simdb-test-btn');

        // Apply current SimDB config from form fields before testing
        this._saveSimDBConfig();

        if (!this.editor.scenario.simdbConfig || !this.editor.scenario.simdbConfig.host) {
            resultEl.innerHTML = '<span style="color: #dc3545;">SimDB接続情報を入力してください</span>';
            return;
        }

        let scenarioId = this.editor.scenario.apiScenarioId;

        // Auto-save if not yet saved to API
        if (!scenarioId) {
            resultEl.innerHTML = '<span style="color: #6c757d;">シナリオを自動保存中...</span>';
            try {
                await this.editor.saveToAPIQuiet();
                scenarioId = this.editor.scenario.apiScenarioId;
            } catch (err) {
                resultEl.innerHTML = `<span style="color: #dc3545;">自動保存に失敗しました: ${this._escape(err.message)}</span>`;
                return;
            }

            if (!scenarioId) {
                resultEl.innerHTML = '<span style="color: #dc3545;">シナリオの保存に失敗しました</span>';
                return;
            }
        }

        btn.disabled = true;
        btn.textContent = 'テスト中...';
        resultEl.innerHTML = '';

        try {
            const result = await apiClient.testSimDBConnection(scenarioId);
            if (result.success) {
                if (result.locations && result.locations.length > 0) {
                    this._locationMasterCache = result.locations;
                    resultEl.innerHTML = `<span style="color: #28a745;">&#10003; ${this._escape(result.message)}</span>`;
                } else {
                    this._locationMasterCache = [];
                    resultEl.innerHTML = `<span style="color: #28a745;">&#10003; ${this._escape(result.message)}</span>`;
                }
            } else {
                resultEl.innerHTML = `<span style="color: #dc3545;">&#10007; ${this._escape(result.message)}</span>`;
            }
        } catch (err) {
            resultEl.innerHTML = `<span style="color: #dc3545;">&#10007; ${this._escape(err.message)}</span>`;
        } finally {
            btn.disabled = false;
            btn.textContent = '接続テスト';
        }
    }

    _renderStationProperties(stationId) {
        const station = this.editor.getStation(stationId);
        if (!station) return;

        const configFields = this._getConfigFields(station.type);
        const errors = validateStation(station);
        const locationSelectHtml = this._renderLocationSelect(station);

        const continuousHtml = station.type === 'source' ? `
            <div class="property-group">
                <label class="property-label">
                    <input type="checkbox" id="prop-continuous" ${station.config.continuous ? 'checked' : ''}>
                    Continuous (Duration満了まで生成)
                </label>
                <div class="property-hint">ONの場合、Work CountはDurationに応じて自動計算されます</div>
            </div>
        ` : '';

        this.container.innerHTML = `
            <div class="property-group">
                <label class="property-label">ID</label>
                <input type="text" class="property-input" value="${station.id}" disabled>
            </div>
            <div class="property-group">
                <label class="property-label">Type</label>
                <input type="text" class="property-input" value="${station.type}" disabled>
            </div>
            ${locationSelectHtml}
            ${continuousHtml}
            ${configFields.map(field => `
                <div class="property-group">
                    <label class="property-label">${field.label}</label>
                    <input
                        type="number"
                        class="property-input ${errors[field.key] ? 'error' : ''}"
                        id="prop-${field.key}"
                        value="${station.config[field.key] || ''}"
                        step="${field.step || '0.1'}"
                        min="${field.min || '0'}"
                        ${field.key === 'workCount' && station.config.continuous ? 'disabled' : ''}>
                    ${errors[field.key] ? `<div class="property-error">${errors[field.key]}</div>` : ''}
                </div>
            `).join('')}
            <div class="property-actions">
                <button class="btn-primary" id="update-btn">更新</button>
                <button class="btn-danger" id="delete-btn">削除</button>
            </div>
        `;

        // Continuous toggle behavior
        const continuousCheckbox = this.container.querySelector('#prop-continuous');
        if (continuousCheckbox) {
            continuousCheckbox.addEventListener('change', () => {
                const workCountInput = this.container.querySelector('#prop-workCount');
                if (workCountInput) {
                    workCountInput.disabled = continuousCheckbox.checked;
                }
            });
        }

        this.container.querySelector('#update-btn').addEventListener('click', () => {
            const newConfig = {};
            configFields.forEach(field => {
                const value = parseFloat(this.container.querySelector(`#prop-${field.key}`).value);
                newConfig[field.key] = value;
            });

            // Save continuous flag for source stations
            const continuousEl = this.container.querySelector('#prop-continuous');
            if (continuousEl) {
                newConfig.continuous = continuousEl.checked;
            }

            // Save locationId
            const locationSelect = this.container.querySelector('#prop-location-id');
            if (locationSelect) {
                const val = locationSelect.value;
                station.locationId = val ? parseInt(val) : null;
            }

            this.editor.updateStation(stationId, newConfig);
        });

        this.container.querySelector('#delete-btn').addEventListener('click', () => {
            if (confirm('このステーションを削除しますか？')) {
                this.editor.deleteStation(stationId);
            }
        });
    }

    _renderLocationSelect(station) {
        const locations = this._locationMasterCache;
        const currentLocationId = station.locationId;

        if (!locations || locations.length === 0) {
            return `
                <div class="property-group">
                    <label class="property-label">Location</label>
                    <select class="property-input" id="prop-location-id" disabled>
                        <option value="">${currentLocationId ? `ID: ${currentLocationId}` : '(SimDB接続テストで取得)'}</option>
                    </select>
                </div>
            `;
        }

        const options = locations.map(loc => {
            const selected = currentLocationId === loc.id ? 'selected' : '';
            return `<option value="${loc.id}" ${selected}>${this._escape(loc.name)} (ID: ${loc.id})</option>`;
        }).join('');

        return `
            <div class="property-group">
                <label class="property-label">Location</label>
                <select class="property-input" id="prop-location-id">
                    <option value="">-- 選択 --</option>
                    ${options}
                </select>
            </div>
        `;
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
