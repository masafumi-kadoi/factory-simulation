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
        this.autoSave = false;

        // Auto-save toggle
        const checkbox = document.getElementById('auto-save-checkbox');
        if (checkbox) {
            // Restore from localStorage
            this.autoSave = localStorage.getItem('sim-editor-autosave') === 'true';
            checkbox.checked = this.autoSave;
            checkbox.addEventListener('change', () => {
                this.autoSave = checkbox.checked;
                localStorage.setItem('sim-editor-autosave', this.autoSave);
            });
        }
    }

    setInterlockModal(modal) {
        this._interlockModal = modal;
    }

    render() {
        const selected = this.editor.selectedItem;

        if (!selected) {
            this._renderScenarioInfo();
        } else if (selected.type === 'multi') {
            this._renderMultiSelection();
        } else if (selected.type === 'station') {
            this._renderStationProperties(selected.id);
        } else if (selected.type === 'connection') {
            this._renderConnectionProperties(selected.index);
        }
    }

    _renderMultiSelection() {
        const count = this.editor.selectedStationIds.size;
        this.container.innerHTML = `
            <div class="empty-properties">
                <p>${count}個選択中</p>
                <div style="font-size: 0.85rem; color: var(--text-secondary);">
                    ドラッグで一括移動 | Delete で一括削除
                </div>
            </div>
        `;
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
        const modulerConfigHtml = station.type === 'moduler' ? this._renderModulerConfig(station) : '';

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
            ${modulerConfigHtml}
            ${station.type !== 'entry' && station.type !== 'exit' ? this._renderInterlockSection(station) : ''}
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

        // Shared save logic for update button and auto-save
        const saveStationConfig = () => {
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
                newConfig.ports = this._collectMergePorts();
                const outputWorkTypeEl = this.container.querySelector('#prop-outputWorkType');
                newConfig.outputWorkType = outputWorkTypeEl ? outputWorkTypeEl.value.trim() : '';
            }

            // Save split config
            if (station.type === 'split') {
                newConfig.splitCount = parseInt(this.container.querySelector('#prop-splitCount')?.value) || 2;
                newConfig.ports = this._collectSplitPorts();
            }

            // Save moduler config (preserve subScenario)
            if (station.type === 'moduler') {
                newConfig.entryCount = parseInt(this.container.querySelector('#prop-entryCount')?.value) || 1;
                newConfig.exitCount = parseInt(this.container.querySelector('#prop-exitCount')?.value) || 1;
                newConfig.subScenario = station.config.subScenario;
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
        };

        this.container.querySelector('#update-btn').addEventListener('click', saveStationConfig);

        // Auto-save on input (immediate feedback)
        if (this.autoSave) {
            this.container.querySelectorAll('.property-input, select.property-input').forEach(input => {
                if (!input.disabled) {
                    input.addEventListener('input', () => saveStationConfig());
                    input.addEventListener('change', () => saveStationConfig());
                }
            });
        }

        this.container.querySelector('#delete-btn').addEventListener('click', () => {
            if (confirm('このステーションを削除しますか？')) {
                this.editor.deleteStation(stationId);
            }
        });

        // Merge port count change handler
        const mergeCountInput = this.container.querySelector('#prop-mergeCount');
        if (mergeCountInput) {
            mergeCountInput.addEventListener('change', () => {
                const count = parseInt(mergeCountInput.value) || 2;
                const list = this.container.querySelector('#merge-ports-list');
                const rows = list.querySelectorAll('.merge-port-row');
                if (count > rows.length) {
                    for (let i = rows.length; i < count; i++) {
                        const div = document.createElement('div');
                        div.className = 'merge-port-row';
                        div.dataset.index = i;
                        div.innerHTML = `
                            <div style="font-size: 0.8rem; color: #333; display: flex; justify-content: space-between; align-items: center;">
                                <span>Port ${i + 1}</span>
                                <span style="font-size: 0.7rem; color: #999;">Default</span>
                            </div>
                            <div style="display: flex; gap: 0.25rem; align-items: center;">
                                <input type="number" class="property-input merge-port-capacity" value="1" min="1" step="1" style="width:3rem" title="容量">
                                <span style="font-size: 0.75rem; color: #666;">容量</span>
                                <button class="btn-secondary merge-port-interlock-btn" data-port-index="${i}" style="margin-left: auto; font-size: 0.7rem; padding: 0.2rem 0.5rem;">搬入可条件...</button>
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

        // Merge port interlock buttons
        this.container.querySelectorAll('.merge-port-interlock-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const portIndex = parseInt(btn.dataset.portIndex);
                if (this._interlockModal) {
                    this._interlockModal.open(station, this.editor.scenario, () => {
                        this.editor._markDirty();
                        this.render();
                    }, { portIndex, portType: 'mergeInput' });
                }
            });
        });

        // Split port count change handler
        const splitCountInput = this.container.querySelector('#prop-splitCount');
        if (splitCountInput) {
            splitCountInput.addEventListener('change', () => {
                const count = parseInt(splitCountInput.value) || 2;
                const list = this.container.querySelector('#split-ports-list');
                const rows = list.querySelectorAll('.split-port-row');
                if (count > rows.length) {
                    for (let i = rows.length; i < count; i++) {
                        const div = document.createElement('div');
                        div.className = 'split-port-row';
                        div.dataset.index = i;
                        div.innerHTML = `
                            <div style="font-size: 0.8rem; color: #333; display: flex; justify-content: space-between; align-items: center;">
                                <span>Port ${i + 1}</span>
                                <span style="font-size: 0.7rem; color: #999;">Default</span>
                            </div>
                            <div style="display: flex; gap: 0.25rem; align-items: center;">
                                <input type="number" class="property-input split-port-capacity" value="1" min="1" step="1" style="width:3rem" title="容量">
                                <span style="font-size: 0.75rem; color: #666;">容量</span>
                                <button class="btn-secondary split-port-interlock-btn" data-port-index="${i}" style="margin-left: auto; font-size: 0.7rem; padding: 0.2rem 0.5rem;">搬出可条件...</button>
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

        // Split port interlock buttons
        this.container.querySelectorAll('.split-port-interlock-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const portIndex = parseInt(btn.dataset.portIndex);
                if (this._interlockModal) {
                    this._interlockModal.open(station, this.editor.scenario, () => {
                        this.editor._markDirty();
                        this.render();
                    }, { portIndex, portType: 'splitOutput' });
                }
            });
        });

        // Moduler config
        if (station.type === 'moduler') {
            const entryCountInput = this.container.querySelector('#prop-entryCount');
            const exitCountInput = this.container.querySelector('#prop-exitCount');
            const drilldownBtn = this.container.querySelector('#moduler-drilldown-btn');

            if (entryCountInput) {
                entryCountInput.addEventListener('change', () => {
                    const newCount = Math.max(1, parseInt(entryCountInput.value) || 1);
                    station.config.entryCount = newCount;
                    // Sync SubScenario entry stations
                    this._syncModulerEntryExit(station);
                    this.editor._markDirty();
                    this.editor.canvas.render();
                    this.render();
                });
            }
            if (exitCountInput) {
                exitCountInput.addEventListener('change', () => {
                    const newCount = Math.max(1, parseInt(exitCountInput.value) || 1);
                    station.config.exitCount = newCount;
                    // Sync SubScenario exit stations
                    this._syncModulerEntryExit(station);
                    this.editor._markDirty();
                    this.editor.canvas.render();
                    this.render();
                });
            }
            if (drilldownBtn) {
                drilldownBtn.addEventListener('click', () => {
                    this.editor.drillDown(stationId);
                });
            }
        }

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
        const mainRules = rules.filter(r => r.target === 'inputReady' || r.target === 'outputReady' || r.target === 'processReady');
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

        const saveConnectionConfig = () => {
            const condSelect = this.container.querySelector('#prop-condition').value;
            let condition = condSelect;
            if (condSelect === 'workType') {
                const wt = this.container.querySelector('#prop-condition-worktype').value.trim();
                condition = wt ? `workType:${wt}` : 'default';
            }
            connection.condition = condition;
            this.editor._markDirty();
            this.render();
        };

        this.container.querySelector('#update-connection-btn').addEventListener('click', saveConnectionConfig);

        // Auto-save on input for connection properties
        if (this.autoSave) {
            this.container.querySelectorAll('.property-input, select.property-input').forEach(input => {
                if (!input.disabled) {
                    input.addEventListener('input', () => saveConnectionConfig());
                    input.addEventListener('change', () => saveConnectionConfig());
                }
            });
        }

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
            ],
            moduler: [],
            entry: [],
            exit: []
        };
        return fields[type] || [];
    }

    _renderMergeConfig(station) {
        const mergeCount = station.config.mergeCount || 2;
        const ports = station.config.ports || [];
        const outputWorkType = station.config.outputWorkType || '';

        const portsHtml = ports.map((buf, i) => {
            const hasCustomRules = !!buf.interlockRules;
            return `
                <div class="merge-port-row" data-index="${i}">
                    <div style="font-size: 0.8rem; color: #333; display: flex; justify-content: space-between; align-items: center;">
                        <span>Port ${i + 1}</span>
                        <span style="font-size: 0.7rem; color: ${hasCustomRules ? '#6f42c1' : '#999'};">${hasCustomRules ? 'Custom' : 'Default'}</span>
                    </div>
                    <div style="display: flex; gap: 0.25rem; align-items: center;">
                        <input type="number" class="property-input merge-port-capacity" value="${buf.capacity || 1}" min="1" step="1" style="width:3rem" title="容量">
                        <span style="font-size: 0.75rem; color: #666;">容量</span>
                        <button class="btn-secondary merge-port-interlock-btn" data-port-index="${i}" style="margin-left: auto; font-size: 0.7rem; padding: 0.2rem 0.5rem;">搬入可条件...</button>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="property-group merge-config-section">
                <label class="property-label" style="border-top: 1px solid #dee2e6; padding-top: 0.5rem;">入力ポート (Merge Ports)</label>
                <div class="property-group">
                    <label class="property-label">ポート数 (mergeCount)</label>
                    <input type="number" class="property-input" id="prop-mergeCount" value="${mergeCount}" min="1" step="1">
                </div>
                <div class="property-hint">各ポートの容量・搬入可条件（1:1接続）</div>
                <div id="merge-ports-list">${portsHtml}</div>
            </div>
            <div class="property-group">
                <label class="property-label">出力ワークType</label>
                <input type="text" class="property-input" id="prop-outputWorkType" value="${this._escapeAttr(outputWorkType)}" placeholder="例: assembly-AB">
            </div>
        `;
    }

    _renderSplitConfig(station) {
        const splitCount = station.config.splitCount || 2;
        const ports = station.config.ports || [];

        const portsHtml = ports.map((buf, i) => {
            const hasCustomRules = !!buf.interlockRules;
            return `
                <div class="split-port-row" data-index="${i}">
                    <div style="font-size: 0.8rem; color: #333; display: flex; justify-content: space-between; align-items: center;">
                        <span>Port ${i + 1}</span>
                        <span style="font-size: 0.7rem; color: ${hasCustomRules ? '#fd7e14' : '#999'};">${hasCustomRules ? 'Custom' : 'Default'}</span>
                    </div>
                    <div style="display: flex; gap: 0.25rem; align-items: center;">
                        <input type="number" class="property-input split-port-capacity" value="${buf.capacity || 1}" min="1" step="1" style="width:3rem" title="容量">
                        <span style="font-size: 0.75rem; color: #666;">容量</span>
                        <button class="btn-secondary split-port-interlock-btn" data-port-index="${i}" style="margin-left: auto; font-size: 0.7rem; padding: 0.2rem 0.5rem;">搬出可条件...</button>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="property-group split-config-section">
                <label class="property-label" style="border-top: 1px solid #dee2e6; padding-top: 0.5rem;">出力ポート (Split Ports)</label>
                <div class="property-group">
                    <label class="property-label">ポート数 (splitCount)</label>
                    <input type="number" class="property-input" id="prop-splitCount" value="${splitCount}" min="1" step="1">
                </div>
                <div class="property-hint">各ポートの容量・搬出可条件（1:1接続）</div>
                <div id="split-ports-list">${portsHtml}</div>
            </div>
        `;
    }

    _syncModulerEntryExit(station) {
        if (!station.config.subScenario) {
            station.config.subScenario = { stations: [], connections: [] };
        }
        const sub = station.config.subScenario;
        const entryCount = station.config.entryCount || 1;
        const exitCount = station.config.exitCount || 1;

        // Current entries and exits
        const entries = sub.stations.filter(s => s.type === 'entry').sort((a, b) => a.id.localeCompare(b.id));
        const exits = sub.stations.filter(s => s.type === 'exit').sort((a, b) => a.id.localeCompare(b.id));

        // Add missing entries
        for (let i = entries.length; i < entryCount; i++) {
            sub.stations.push({
                id: `entry-${i}`,
                name: '',
                type: 'entry',
                config: {},
                x: 100,
                y: 200 + i * 100
            });
        }

        // Remove excess entries (from the end)
        if (entries.length > entryCount) {
            const toRemove = entries.slice(entryCount);
            // Check for affected external connections
            const parentScenario = this.editor.scenario;
            const affectedExternalConns = parentScenario.connections.filter(c =>
                c.to === station.id && c.toPortIndex >= entryCount
            );
            // Check for affected internal connections
            const affectedInternalConns = [];
            toRemove.forEach(entry => {
                sub.connections.filter(c => c.from === entry.id || c.to === entry.id).forEach(c => {
                    affectedInternalConns.push(c);
                });
            });

            if (affectedExternalConns.length > 0 || affectedInternalConns.length > 0) {
                const msgs = [];
                if (affectedExternalConns.length > 0) {
                    msgs.push(`外部接続 ${affectedExternalConns.length} 件が削除されます`);
                }
                if (affectedInternalConns.length > 0) {
                    msgs.push(`内部接続 ${affectedInternalConns.length} 件が削除されます`);
                }
                if (!confirm(`Entry数を減少します。\n${msgs.join('\n')}\n\n続行しますか？`)) {
                    station.config.entryCount = entries.length;
                    return;
                }
                // Remove affected external connections
                affectedExternalConns.forEach(c => {
                    const idx = parentScenario.connections.indexOf(c);
                    if (idx >= 0) parentScenario.connections.splice(idx, 1);
                });
            }

            toRemove.forEach(entry => {
                sub.stations = sub.stations.filter(s => s.id !== entry.id);
                sub.connections = sub.connections.filter(c => c.from !== entry.id && c.to !== entry.id);
            });
        }

        // Add missing exits
        for (let i = exits.length; i < exitCount; i++) {
            sub.stations.push({
                id: `exit-${i}`,
                name: '',
                type: 'exit',
                config: {},
                x: 700,
                y: 200 + i * 100
            });
        }

        // Remove excess exits (from the end)
        if (exits.length > exitCount) {
            const toRemove = exits.slice(exitCount);
            const parentScenario = this.editor.scenario;
            const affectedExternalConns = parentScenario.connections.filter(c =>
                c.from === station.id && c.fromPortIndex >= exitCount
            );
            const affectedInternalConns = [];
            toRemove.forEach(exit => {
                sub.connections.filter(c => c.from === exit.id || c.to === exit.id).forEach(c => {
                    affectedInternalConns.push(c);
                });
            });

            if (affectedExternalConns.length > 0 || affectedInternalConns.length > 0) {
                const msgs = [];
                if (affectedExternalConns.length > 0) {
                    msgs.push(`外部接続 ${affectedExternalConns.length} 件が削除されます`);
                }
                if (affectedInternalConns.length > 0) {
                    msgs.push(`内部接続 ${affectedInternalConns.length} 件が削除されます`);
                }
                if (!confirm(`Exit数を減少します。\n${msgs.join('\n')}\n\n続行しますか？`)) {
                    station.config.exitCount = exits.length;
                    return;
                }
                affectedExternalConns.forEach(c => {
                    const idx = parentScenario.connections.indexOf(c);
                    if (idx >= 0) parentScenario.connections.splice(idx, 1);
                });
            }

            toRemove.forEach(exit => {
                sub.stations = sub.stations.filter(s => s.id !== exit.id);
                sub.connections = sub.connections.filter(c => c.from !== exit.id && c.to !== exit.id);
            });
        }
    }

    _renderModulerConfig(station) {
        const entryCount = station.config.entryCount || 1;
        const exitCount = station.config.exitCount || 1;
        const subStations = station.config.subScenario?.stations || [];
        const subConnections = station.config.subScenario?.connections || [];

        return `
            <div class="property-group moduler-config-section">
                <label class="property-label" style="border-top: 1px solid #dee2e6; padding-top: 0.5rem;">Moduler設定</label>
                <div class="property-group">
                    <label class="property-label">Entry数</label>
                    <input type="number" class="property-input" id="prop-entryCount" value="${entryCount}" min="1" step="1">
                </div>
                <div class="property-group">
                    <label class="property-label">Exit数</label>
                    <input type="number" class="property-input" id="prop-exitCount" value="${exitCount}" min="1" step="1">
                </div>
                <div class="property-group">
                    <label class="property-label">SubScenario</label>
                    <div style="font-size: 0.8rem; color: #6c757d;">
                        <div>内部Station: ${subStations.length}</div>
                        <div>内部Connection: ${subConnections.length}</div>
                    </div>
                    <button class="btn-secondary" id="moduler-drilldown-btn" style="width: 100%; margin-top: 0.5rem;">内部を編集 (ドリルダウン)</button>
                </div>
            </div>
        `;
    }

    _collectMergePorts() {
        const rows = this.container.querySelectorAll('.merge-port-row');
        const station = this.editor.getStation(this.editor.selectedItem?.id);
        const existingPorts = station?.config?.ports || [];
        return Array.from(rows).map((row, i) => {
            const buf = {
                capacity: parseInt(row.querySelector('.merge-port-capacity').value) || 1
            };
            // Preserve existing interlockRules
            if (existingPorts[i] && existingPorts[i].interlockRules) {
                buf.interlockRules = existingPorts[i].interlockRules;
            }
            return buf;
        });
    }

    _collectSplitPorts() {
        const rows = this.container.querySelectorAll('.split-port-row');
        const station = this.editor.getStation(this.editor.selectedItem?.id);
        const existingPorts = station?.config?.ports || [];
        return Array.from(rows).map((row, i) => {
            const buf = {
                capacity: parseInt(row.querySelector('.split-port-capacity')?.value) || 1
            };
            // Preserve existing interlockRules
            if (existingPorts[i] && existingPorts[i].interlockRules) {
                buf.interlockRules = existingPorts[i].interlockRules;
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
