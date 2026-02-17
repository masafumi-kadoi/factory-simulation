// Properties Panel
import { validateStation } from './validation.js';
import { apiClient } from './api.js';
import { getDefaultPreset, SIGNAL_DISPLAY } from './interlock-presets.js';

export class PropertiesPanel {
    constructor(container, editor) {
        this.container = container;
        this.editor = editor;
        this._locationMasterCache = null;
        this._interlockModal = null;
    }

    setInterlockModal(modal) {
        this._interlockModal = modal;
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

        const workTypeHtml = station.type === 'source' ? `
            <div class="property-group">
                <label class="property-label">Work Type</label>
                <input type="text" class="property-input" id="prop-workType" value="${this._escapeAttr(station.config.workType || '')}" placeholder="(例: partA)">
                <div class="property-hint">生成するワークの種別（Merge/Split で使用）</div>
            </div>
        ` : '';

        const mergeConfigHtml = station.type === 'merge' ? this._renderMergeConfig(station) : '';
        const splitConfigHtml = station.type === 'split' ? this._renderSplitConfig(station) : '';

        this.container.innerHTML = `
            <div class="property-group">
                <label class="property-label">ID</label>
                <input type="text" class="property-input" value="${station.id}" disabled>
            </div>
            <div class="property-group">
                <label class="property-label">表示名</label>
                <input type="text" class="property-input" id="prop-name" value="${this._escapeAttr(station.name || '')}" placeholder="(未設定)">
            </div>
            <div class="property-group">
                <label class="property-label">Type</label>
                <input type="text" class="property-input" value="${station.type}" disabled>
            </div>
            ${locationSelectHtml}
            ${continuousHtml}
            ${workTypeHtml}
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
            ${mergeConfigHtml}
            ${splitConfigHtml}
            ${this._renderInterlockSection(station)}
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

            // Save workType for source stations
            const workTypeEl = this.container.querySelector('#prop-workType');
            if (workTypeEl) {
                newConfig.workType = workTypeEl.value.trim();
            }

            // Save merge config
            if (station.type === 'merge') {
                newConfig.mergeCount = parseInt(this.container.querySelector('#prop-mergeCount')?.value) || 2;
                newConfig.buffers = this._collectMergeBuffers();
                const outputWorkTypeEl = this.container.querySelector('#prop-outputWorkType');
                newConfig.outputWorkType = outputWorkTypeEl ? outputWorkTypeEl.value.trim() : '';
            }

            // Save split config
            if (station.type === 'split') {
                newConfig.splitCount = parseInt(this.container.querySelector('#prop-splitCount')?.value) || 2;
                newConfig.buffers = this._collectSplitBuffers();
            }

            // Save name
            const nameInput = this.container.querySelector('#prop-name');
            if (nameInput) {
                station.name = nameInput.value.trim();
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

        // Merge buffer count change handler
        const mergeCountInput = this.container.querySelector('#prop-mergeCount');
        if (mergeCountInput) {
            mergeCountInput.addEventListener('change', () => {
                const count = parseInt(mergeCountInput.value) || 2;
                const list = this.container.querySelector('#merge-buffers-list');
                const rows = list.querySelectorAll('.merge-buffer-row');
                if (count > rows.length) {
                    for (let i = rows.length; i < count; i++) {
                        const div = document.createElement('div');
                        div.className = 'merge-buffer-row';
                        div.dataset.index = i;
                        div.innerHTML = `
                            <div style="font-size: 0.8rem; color: #333; display: flex; justify-content: space-between; align-items: center;">
                                <span>Slot ${i + 1}</span>
                                <span style="font-size: 0.7rem; color: #999;">Default</span>
                            </div>
                            <div style="display: flex; gap: 0.25rem; align-items: center;">
                                <input type="number" class="property-input merge-buffer-capacity" value="1" min="1" step="1" style="width:3rem" title="容量">
                                <span style="font-size: 0.75rem; color: #666;">容量</span>
                                <button class="btn-secondary merge-buffer-interlock-btn" data-buffer-index="${i}" style="margin-left: auto; font-size: 0.7rem; padding: 0.2rem 0.5rem;">搬入可条件...</button>
                            </div>
                        `;
                        list.appendChild(div);
                    }
                } else {
                    for (let i = rows.length - 1; i >= count; i--) {
                        rows[i].remove();
                    }
                }
            });
        }

        // Merge buffer interlock buttons
        this.container.querySelectorAll('.merge-buffer-interlock-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const bufferIndex = parseInt(btn.dataset.bufferIndex);
                if (this._interlockModal) {
                    this._interlockModal.open(station, this.editor.scenario, () => {
                        this.editor._markDirty();
                        this.render();
                    }, { bufferIndex, bufferType: 'mergeInput' });
                }
            });
        });

        // Split buffer count change handler
        const splitCountInput = this.container.querySelector('#prop-splitCount');
        if (splitCountInput) {
            splitCountInput.addEventListener('change', () => {
                const count = parseInt(splitCountInput.value) || 2;
                const list = this.container.querySelector('#split-buffers-list');
                const rows = list.querySelectorAll('.split-buffer-row');
                if (count > rows.length) {
                    for (let i = rows.length; i < count; i++) {
                        const div = document.createElement('div');
                        div.className = 'split-buffer-row';
                        div.dataset.index = i;
                        div.innerHTML = `
                            <div style="font-size: 0.8rem; color: #333; display: flex; justify-content: space-between; align-items: center;">
                                <span>Slot ${i + 1}</span>
                                <span style="font-size: 0.7rem; color: #999;">Default</span>
                            </div>
                            <div style="display: flex; gap: 0.25rem; align-items: center;">
                                <input type="number" class="property-input split-buffer-capacity" value="1" min="1" step="1" style="width:3rem" title="容量">
                                <span style="font-size: 0.75rem; color: #666;">容量</span>
                                <button class="btn-secondary split-buffer-interlock-btn" data-buffer-index="${i}" style="margin-left: auto; font-size: 0.7rem; padding: 0.2rem 0.5rem;">搬出可条件...</button>
                            </div>
                        `;
                        list.appendChild(div);
                    }
                } else {
                    for (let i = rows.length - 1; i >= count; i--) {
                        rows[i].remove();
                    }
                }
            });
        }

        // Split buffer interlock buttons
        this.container.querySelectorAll('.split-buffer-interlock-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const bufferIndex = parseInt(btn.dataset.bufferIndex);
                if (this._interlockModal) {
                    this._interlockModal.open(station, this.editor.scenario, () => {
                        this.editor._markDirty();
                        this.render();
                    }, { bufferIndex, bufferType: 'splitOutput' });
                }
            });
        });

        // Interlock config button
        const interlockBtn = this.container.querySelector('#interlock-config-btn');
        if (interlockBtn) {
            interlockBtn.addEventListener('click', () => {
                if (this._interlockModal) {
                    this._interlockModal.open(station, this.editor.scenario, () => {
                        this.editor._markDirty();
                        this.render();
                    });
                }
            });
        }
    }

    _renderInterlockSection(station) {
        const isCustom = !!station.config.interlockRules;
        const modeLabel = isCustom ? 'Custom' : 'Default';
        const typeLabel = station.type.charAt(0).toUpperCase() + station.type.slice(1);

        // Build summary of current rules
        let summaryHtml = '';
        const rules = isCustom ? station.config.interlockRules.rules : (getDefaultPreset(station.type) || {}).rules || [];
        const mainRules = rules.filter(r => r.target === 'inputReady' || r.target === 'outputReady');
        if (mainRules.length > 0) {
            summaryHtml = mainRules.slice(0, 4).map(r => {
                const abbr = SIGNAL_DISPLAY[r.target] ? SIGNAL_DISPLAY[r.target].abbr : r.target;
                const condStr = r.conditions.map(c => {
                    const cAbbr = SIGNAL_DISPLAY[c.signal] ? SIGNAL_DISPLAY[c.signal].abbr : c.signal;
                    const prefix = c.stationId ? `${c.stationId}.` : '';
                    return `${prefix}${cAbbr}=${c.value ? 'ON' : 'OFF'}`;
                }).join(' & ');
                return `<div style="font-size: 0.75rem; color: #6c757d; margin-top: 0.15rem;">${condStr} → ${abbr}=${r.value ? 'ON' : 'OFF'}</div>`;
            }).join('');
        }

        return `
            <div class="interlock-section">
                <div class="property-group">
                    <label class="property-label">Interlock: ${modeLabel} (${typeLabel})</label>
                    ${summaryHtml}
                    <button class="btn-secondary" id="interlock-config-btn" style="width: 100%; margin-top: 0.5rem;">条件設定...</button>
                </div>
            </div>
        `;
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

        // Check if from station is a split station to show workType options
        const fromStation = this.editor.getStation(connection.from);
        const isSplitSource = fromStation && fromStation.type === 'split';

        // Get workType from condition if it's a workType condition
        const isWorkTypeCondition = (connection.condition || '').startsWith('workType:');
        const currentWorkType = isWorkTypeCondition ? connection.condition.substring('workType:'.length) : '';

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
                    <option value="default" ${connection.condition === 'default' || !connection.condition ? 'selected' : ''}>Default</option>
                    <option value="quality_ok" ${connection.condition === 'quality_ok' ? 'selected' : ''}>Quality OK</option>
                    <option value="quality_ng" ${connection.condition === 'quality_ng' ? 'selected' : ''}>Quality NG</option>
                    <option value="workType" ${isWorkTypeCondition ? 'selected' : ''}>Work Type</option>
                </select>
            </div>
            <div class="property-group" id="worktype-condition-group" style="display: ${isWorkTypeCondition ? '' : 'none'}">
                <label class="property-label">Work Type 値</label>
                <input type="text" class="property-input" id="prop-condition-worktype" value="${this._escapeAttr(currentWorkType)}" placeholder="例: partA">
            </div>
            <div class="property-actions">
                <button class="btn-primary" id="update-connection-btn">更新</button>
                <button class="btn-danger" id="delete-connection-btn">削除</button>
            </div>
        `;

        // Toggle workType input visibility
        this.container.querySelector('#prop-condition').addEventListener('change', (e) => {
            const group = this.container.querySelector('#worktype-condition-group');
            group.style.display = e.target.value === 'workType' ? '' : 'none';
        });

        this.container.querySelector('#update-connection-btn').addEventListener('click', () => {
            const condSelect = this.container.querySelector('#prop-condition').value;
            let condition = condSelect;
            if (condSelect === 'workType') {
                const wt = this.container.querySelector('#prop-condition-worktype').value.trim();
                condition = wt ? `workType:${wt}` : 'default';
            }
            connection.condition = condition;
            this.editor._markDirty();
            this.render();
        });

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
            ],
            merge: [
                { key: 'processingTime', label: 'Processing Time (s)', step: '0.1', min: '0' },
                { key: 'arrivalTime', label: 'Arrival Time (s)', step: '0.1', min: '0.1' },
                { key: 'departureTime', label: 'Departure Time (s)', step: '0.1', min: '0.1' }
            ],
            split: [
                { key: 'processingTime', label: 'Processing Time (s)', step: '0.1', min: '0' },
                { key: 'arrivalTime', label: 'Arrival Time (s)', step: '0.1', min: '0.1' },
                { key: 'departureTime', label: 'Departure Time (s)', step: '0.1', min: '0.1' }
            ]
        };
        return fields[type] || [];
    }

    _renderMergeConfig(station) {
        const mergeCount = station.config.mergeCount || 2;
        const buffers = station.config.buffers || [];
        const outputWorkType = station.config.outputWorkType || '';

        const buffersHtml = buffers.map((buf, i) => {
            const hasCustomRules = !!buf.interlockRules;
            return `
                <div class="merge-buffer-row" data-index="${i}">
                    <div style="font-size: 0.8rem; color: #333; display: flex; justify-content: space-between; align-items: center;">
                        <span>Slot ${i + 1}</span>
                        <span style="font-size: 0.7rem; color: ${hasCustomRules ? '#6f42c1' : '#999'};">${hasCustomRules ? 'Custom' : 'Default'}</span>
                    </div>
                    <div style="display: flex; gap: 0.25rem; align-items: center;">
                        <input type="number" class="property-input merge-buffer-capacity" value="${buf.capacity || 1}" min="1" step="1" style="width:3rem" title="容量">
                        <span style="font-size: 0.75rem; color: #666;">容量</span>
                        <button class="btn-secondary merge-buffer-interlock-btn" data-buffer-index="${i}" style="margin-left: auto; font-size: 0.7rem; padding: 0.2rem 0.5rem;">搬入可条件...</button>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="property-group merge-config-section">
                <label class="property-label" style="border-top: 1px solid #dee2e6; padding-top: 0.5rem;">入力バッファ (Merge Buffers)</label>
                <div class="property-group">
                    <label class="property-label">バッファ数 (mergeCount)</label>
                    <input type="number" class="property-input" id="prop-mergeCount" value="${mergeCount}" min="1" step="1">
                </div>
                <div class="property-hint">各バッファの容量・搬入可条件（1:1接続）</div>
                <div id="merge-buffers-list">${buffersHtml}</div>
            </div>
            <div class="property-group">
                <label class="property-label">出力ワークType</label>
                <input type="text" class="property-input" id="prop-outputWorkType" value="${this._escapeAttr(outputWorkType)}" placeholder="例: assembly-AB">
            </div>
        `;
    }

    _renderSplitConfig(station) {
        const splitCount = station.config.splitCount || 2;
        const buffers = station.config.buffers || [];

        const buffersHtml = buffers.map((buf, i) => {
            const hasCustomRules = !!buf.interlockRules;
            return `
                <div class="split-buffer-row" data-index="${i}">
                    <div style="font-size: 0.8rem; color: #333; display: flex; justify-content: space-between; align-items: center;">
                        <span>Slot ${i + 1}</span>
                        <span style="font-size: 0.7rem; color: ${hasCustomRules ? '#fd7e14' : '#999'};">${hasCustomRules ? 'Custom' : 'Default'}</span>
                    </div>
                    <div style="display: flex; gap: 0.25rem; align-items: center;">
                        <input type="number" class="property-input split-buffer-capacity" value="${buf.capacity || 1}" min="1" step="1" style="width:3rem" title="容量">
                        <span style="font-size: 0.75rem; color: #666;">容量</span>
                        <button class="btn-secondary split-buffer-interlock-btn" data-buffer-index="${i}" style="margin-left: auto; font-size: 0.7rem; padding: 0.2rem 0.5rem;">搬出可条件...</button>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="property-group split-config-section">
                <label class="property-label" style="border-top: 1px solid #dee2e6; padding-top: 0.5rem;">出力バッファ (Split Buffers)</label>
                <div class="property-group">
                    <label class="property-label">バッファ数 (splitCount)</label>
                    <input type="number" class="property-input" id="prop-splitCount" value="${splitCount}" min="1" step="1">
                </div>
                <div class="property-hint">各バッファの容量・搬出可条件（1:1接続）</div>
                <div id="split-buffers-list">${buffersHtml}</div>
            </div>
        `;
    }

    _collectMergeBuffers() {
        const rows = this.container.querySelectorAll('.merge-buffer-row');
        const station = this.editor.getStation(this.editor.selectedItem?.id);
        const existingBuffers = station?.config?.buffers || [];
        return Array.from(rows).map((row, i) => {
            const buf = {
                capacity: parseInt(row.querySelector('.merge-buffer-capacity').value) || 1
            };
            // Preserve existing interlockRules
            if (existingBuffers[i] && existingBuffers[i].interlockRules) {
                buf.interlockRules = existingBuffers[i].interlockRules;
            }
            return buf;
        });
    }

    _collectSplitBuffers() {
        const rows = this.container.querySelectorAll('.split-buffer-row');
        const station = this.editor.getStation(this.editor.selectedItem?.id);
        const existingBuffers = station?.config?.buffers || [];
        return Array.from(rows).map((row, i) => {
            const buf = {
                capacity: parseInt(row.querySelector('.split-buffer-capacity')?.value) || 1
            };
            // Preserve existing interlockRules
            if (existingBuffers[i] && existingBuffers[i].interlockRules) {
                buf.interlockRules = existingBuffers[i].interlockRules;
            }
            return buf;
        });
    }

    _escape(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    _escapeAttr(text) {
        return (text || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}
