// Interlock Modal — condition editor for station interlock rules
import { INTERLOCK_PRESETS, SIGNAL_DISPLAY, getDefaultPreset, getPresetsForType, clonePreset, getSignalLabel } from './interlock-presets.js';

const TAB_DEFS = [
    { id: 'processReady-on',  label: '加工準備ON',  target: 'processReady',  value: true },
    { id: 'processReady-off', label: '加工準備OFF', target: 'processReady',  value: false },
    { id: 'inputReady-on',  label: '搬入可ON',  target: 'inputReady',  value: true },
    { id: 'inputReady-off', label: '搬入可OFF', target: 'inputReady',  value: false },
    { id: 'outputReady-on',  label: '搬出可ON',  target: 'outputReady',  value: true },
    { id: 'outputReady-off', label: '搬出可OFF', target: 'outputReady',  value: false },
    { id: 'other',           label: 'その他',    target: null,           value: null }
];

export class InterlockModal {
    constructor() {
        this._overlay = null;
        this._station = null;
        this._scenario = null;
        this._activeTab = 'inputReady-on';
        this._isCustom = false;
        this._editRules = [];
        this._editSignals = [];
        this._onSave = null;
        this._boundKeyHandler = (e) => this._handleKeydown(e);
    }

    /**
     * Open the modal for a station or port
     * @param {object} station - the station object from the scenario
     * @param {object} scenario - the full scenario (for connection lookups)
     * @param {function} onSave - callback when save is clicked
     * @param {object} [portOpts] - optional: { portIndex, portType: 'mergeInput'|'splitOutput' }
     */
    open(station, scenario, onSave, portOpts) {
        this._station = station;
        this._scenario = scenario;
        this._onSave = onSave;
        this._portOpts = portOpts || null;

        // For port mode, filter tabs to show only relevant ones
        if (this._portOpts) {
            if (this._portOpts.portType === 'mergeInput') {
                this._activeTab = 'inputReady-on';
            } else {
                this._activeTab = 'outputReady-on';
            }
        } else {
            this._activeTab = 'inputReady-on';
        }

        // Determine mode and load rules
        if (this._portOpts) {
            // Port mode: load from port's interlockRules
            const portIdx = this._portOpts.portIndex;
            const ports = this._portOpts.portType === 'mergeInput'
                ? (station.config.inPorts || station.config.ports || [])
                : (station.config.outPorts || station.config.ports || []);
            const buf = ports[portIdx];
            this._isCustom = !!(buf && buf.interlockRules);

            if (this._isCustom && buf.interlockRules) {
                const config = clonePreset(buf.interlockRules);
                this._editRules = config.rules || [];
                this._editSignals = config.signals || [];
            } else {
                // Load default port preset
                const preset = this._getDefaultPortPreset();
                if (preset) {
                    const config = clonePreset(preset);
                    this._editRules = config.rules || [];
                    this._editSignals = config.signals || [];
                } else {
                    this._editRules = [];
                    this._editSignals = [];
                }
            }
        } else {
            // Station mode
            this._isCustom = !!station.config.interlockRules;

            if (this._isCustom) {
                const config = clonePreset(station.config.interlockRules);
                this._editRules = config.rules || [];
                this._editSignals = config.signals || [];
            } else {
                const preset = getDefaultPreset(station.type);
                if (preset) {
                    const config = clonePreset(preset);
                    this._editRules = config.rules || [];
                    this._editSignals = config.signals || [];
                } else {
                    this._editRules = [];
                    this._editSignals = [];
                }
            }
        }

        this._createOverlay();
        this._render();
        document.addEventListener('keydown', this._boundKeyHandler);
    }

    _getDefaultPortPreset() {
        if (!this._portOpts) return null;
        if (this._portOpts.portType === 'mergeInput') {
            return {
                signals: [
                    { name: 'inputWorkPresent', initial: false },
                    { name: 'inputReady', initial: false }
                ],
                rules: [
                    { id: 'R1', target: 'inputReady', value: true, conditions: [{ signal: 'inputWorkPresent', value: false }] },
                    { id: 'R2', target: 'inputReady', value: false, conditions: [{ signal: 'inputWorkPresent', value: true }] }
                ]
            };
        } else {
            return {
                signals: [
                    { name: 'outputWorkPresent', initial: false },
                    { name: 'outputReady', initial: false }
                ],
                rules: [
                    { id: 'R1', target: 'outputReady', value: true, conditions: [{ signal: 'outputWorkPresent', value: true }] },
                    { id: 'R2', target: 'outputReady', value: false, conditions: [{ signal: 'outputWorkPresent', value: false }] }
                ]
            };
        }
    }

    close() {
        if (this._overlay) {
            this._overlay.remove();
            this._overlay = null;
        }
        document.removeEventListener('keydown', this._boundKeyHandler);
    }

    _handleKeydown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            this.close();
        }
    }

    _createOverlay() {
        // Remove if already exists
        if (this._overlay) this._overlay.remove();

        this._overlay = document.createElement('div');
        this._overlay.className = 'interlock-overlay';
        this._overlay.innerHTML = '<div class="interlock-modal"></div>';
        document.body.appendChild(this._overlay);
    }

    _render() {
        const modal = this._overlay.querySelector('.interlock-modal');
        const station = this._station;
        const isCustom = this._isCustom;

        // Get available presets
        const presets = this._portOpts ? {} : getPresetsForType(station.type);
        const presetKeys = Object.keys(presets);

        // Build preset selector (visible only in Custom mode, not for ports)
        const presetOptions = presetKeys.map(key =>
            `<option value="${key}">${this._escape(presets[key].name)}</option>`
        ).join('');

        // Title
        let title;
        if (this._portOpts) {
            const portTypeLabel = this._portOpts.portType === 'mergeInput' ? '入力' : '出力';
            title = `ポート条件設定: ${this._escape(station.id)} [${portTypeLabel}ポート ${this._portOpts.portIndex + 1}]`;
        } else {
            title = `条件設定: ${this._escape(station.id)}`;
        }

        // Filter tabs for port mode
        let visibleTabs = TAB_DEFS;
        if (this._portOpts) {
            if (this._portOpts.portType === 'mergeInput') {
                visibleTabs = TAB_DEFS.filter(t => t.target === 'inputReady' || t.id === 'other');
            } else {
                visibleTabs = TAB_DEFS.filter(t => t.target === 'outputReady' || t.id === 'other');
            }
        }

        modal.innerHTML = `
            <div class="interlock-modal-header">
                <span class="interlock-modal-title">${title}</span>
                <button class="interlock-modal-close" id="il-close-btn">&times;</button>
            </div>
            <div class="interlock-modal-body">
                <div class="interlock-mode-row">
                    <label class="interlock-radio-label">
                        <input type="radio" name="il-mode" value="default" ${!isCustom ? 'checked' : ''}>
                        Default
                    </label>
                    <label class="interlock-radio-label">
                        <input type="radio" name="il-mode" value="custom" ${isCustom ? 'checked' : ''}>
                        Custom
                    </label>
                    ${presetKeys.length > 0 ? `
                        <span class="interlock-preset-area" style="${isCustom ? '' : 'display:none;'}">
                            Preset:
                            <select id="il-preset-select" class="interlock-preset-select">
                                <option value="">-- 選択 --</option>
                                ${presetOptions}
                            </select>
                        </span>
                    ` : ''}
                </div>
                <div class="interlock-tabs">
                    ${visibleTabs.map(tab => `
                        <button class="interlock-tab ${this._activeTab === tab.id ? 'active' : ''}" data-tab="${tab.id}">
                            ${tab.label}
                        </button>
                    `).join('')}
                </div>
                <div class="interlock-tab-content" id="il-tab-content">
                    ${this._renderTabContent()}
                </div>
                <div class="interlock-signals-info">
                    <span class="interlock-signals-title">信号一覧（初期値）:</span>
                    <div class="interlock-signals-grid">
                        ${this._editSignals.map((s, idx) => {
                            const label = getSignalLabel(s.name);
                            const isControl = s.name === 'inputReady' || s.name === 'outputReady';
                            return `<label class="interlock-signal-initial ${isControl ? 'control' : ''}">
                                <input type="checkbox" class="il-signal-initial" data-signal-idx="${idx}" ${s.initial ? 'checked' : ''} ${!this._isCustom ? 'disabled' : ''}>
                                <span class="interlock-signal-initial-label">${label}</span>
                                <span class="interlock-signal-initial-value ${s.initial ? 'on' : 'off'}">${s.initial ? 'ON' : 'OFF'}</span>
                            </label>`;
                        }).join('')}
                    </div>
                </div>
            </div>
            <div class="interlock-modal-footer">
                <button class="btn-secondary" id="il-cancel-btn">キャンセル</button>
                <button class="btn-primary" id="il-save-btn">保存</button>
            </div>
        `;

        // Event listeners
        modal.querySelector('#il-close-btn').addEventListener('click', () => this.close());
        modal.querySelector('#il-cancel-btn').addEventListener('click', () => this.close());
        modal.querySelector('#il-save-btn').addEventListener('click', () => this._handleSave());

        // Mode radios
        modal.querySelectorAll('input[name="il-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => this._handleModeChange(e.target.value));
        });

        // Tab buttons
        modal.querySelectorAll('.interlock-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                this._activeTab = btn.dataset.tab;
                this._render();
            });
        });

        // Preset selector
        const presetSelect = modal.querySelector('#il-preset-select');
        if (presetSelect) {
            presetSelect.addEventListener('change', (e) => {
                if (e.target.value) {
                    this._handlePresetSelect(e.target.value);
                }
            });
        }

        // Bind tab content event listeners
        this._bindTabContentEvents();

        // Signal initial value toggles
        modal.querySelectorAll('.il-signal-initial').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.signalIdx);
                if (this._editSignals[idx] !== undefined) {
                    this._editSignals[idx].initial = e.target.checked;
                    this._render();
                }
            });
        });
    }

    _renderTabContent() {
        const tab = TAB_DEFS.find(t => t.id === this._activeTab);
        if (!tab) return '';

        if (tab.id === 'other') {
            return this._renderOtherTab();
        }
        return this._renderMainTab(tab);
    }

    _renderMainTab(tab) {
        const isCustom = this._isCustom;
        const rule = this._editRules.find(r => r.target === tab.target && r.value === tab.value);
        const conditions = rule ? rule.conditions : [];

        const targetDisplay = getSignalLabel(tab.target);
        const valueDisplay = tab.value ? 'ON' : 'OFF';
        const transitionDisplay = tab.value ? 'OFF → ON' : 'ON → OFF';

        let html = `
            <div class="interlock-tab-header">
                ${targetDisplay}が ${transitionDisplay} になる条件:
            </div>
            <div class="interlock-tab-desc">
                以下の条件が【すべて】満たされたとき、${targetDisplay} = ${valueDisplay}
            </div>
        `;

        if (conditions.length === 0) {
            html += `<div class="interlock-conditions-empty">条件が設定されていません${isCustom ? '' : '（このタブは未使用）'}</div>`;
        } else {
            html += '<div class="interlock-conditions-list">';
            conditions.forEach((cond, idx) => {
                html += this._renderConditionRow(cond, idx, !isCustom);
            });
            html += '</div>';
        }

        if (isCustom) {
            html += `<button class="interlock-add-condition-btn" data-tab="${this._activeTab}" data-action="add-condition">+ 条件追加</button>`;
        }

        if (!isCustom) {
            html += `
                <div class="interlock-default-notice">
                    デフォルトルールが適用されています。[Custom] に切り替えると編集できます。
                </div>
            `;
        }

        return html;
    }

    _renderOtherTab() {
        const isCustom = this._isCustom;
        // "Other" rules: rules whose target is NOT inputReady or outputReady
        const otherRules = this._editRules.filter(r =>
            r.target !== 'inputReady' && r.target !== 'outputReady' && r.target !== 'processReady'
        );

        let html = '<div class="interlock-tab-header">補助ルール:</div>';

        if (otherRules.length === 0) {
            html += '<div class="interlock-conditions-empty">補助ルールはありません</div>';
        } else {
            otherRules.forEach((rule, ruleIdx) => {
                const globalIdx = this._editRules.indexOf(rule);
                const targetDisplay = getSignalLabel(rule.target);
                const valueDisplay = rule.value ? 'ON' : 'OFF';

                html += `<div class="interlock-other-rule" data-rule-idx="${globalIdx}">`;
                html += `<div class="interlock-other-rule-header">`;
                html += `<span>THEN: ${targetDisplay} = ${valueDisplay}</span>`;
                if (isCustom) {
                    html += `<button class="interlock-remove-btn" data-action="delete-other-rule" data-rule-idx="${globalIdx}" title="ルール削除">&times;</button>`;
                }
                html += `</div>`;
                html += `<div class="interlock-other-rule-body">`;

                if (isCustom) {
                    // Editable target and value
                    html += `<div class="interlock-other-then-row">`;
                    html += `THEN: ${this._renderSignalSelect(`other-target-${globalIdx}`, rule.target)} = ${this._renderValueSelect(`other-value-${globalIdx}`, rule.value)}`;
                    html += `</div>`;
                }

                html += '<div class="interlock-other-conditions-label">IF:</div>';
                if (rule.conditions.length === 0) {
                    html += '<div class="interlock-conditions-empty">条件なし</div>';
                } else {
                    html += '<div class="interlock-conditions-list">';
                    rule.conditions.forEach((cond, condIdx) => {
                        html += this._renderConditionRow(cond, condIdx, !isCustom, globalIdx);
                    });
                    html += '</div>';
                }

                if (isCustom) {
                    html += `<button class="interlock-add-condition-btn" data-action="add-other-condition" data-rule-idx="${globalIdx}">+ 条件追加</button>`;
                }

                html += '</div></div>';
            });
        }

        if (isCustom) {
            html += '<button class="interlock-add-rule-btn" data-action="add-other-rule">+ ルール追加</button>';
        }

        if (!isCustom) {
            html += `
                <div class="interlock-default-notice">
                    デフォルトルールが適用されています。[Custom] に切り替えると編集できます。
                </div>
            `;
        }

        return html;
    }

    _renderConditionRow(cond, condIdx, readonly, ruleIdx) {
        if (readonly) {
            const signalDisp = getSignalLabel(cond.signal);
            const stationPrefix = cond.stationId ? `${cond.stationId}.` : '';
            return `
                <div class="interlock-condition-row readonly">
                    <span class="interlock-condition-num">${condIdx + 1}.</span>
                    <span>${stationPrefix}${signalDisp} = ${cond.value ? 'ON' : 'OFF'}</span>
                </div>
            `;
        }

        const dataAttrs = ruleIdx !== undefined
            ? `data-rule-idx="${ruleIdx}" data-cond-idx="${condIdx}"`
            : `data-cond-idx="${condIdx}"`;

        return `
            <div class="interlock-condition-row" ${dataAttrs}>
                <span class="interlock-condition-num">${condIdx + 1}.</span>
                ${this._renderStationSelect(ruleIdx !== undefined ? `other-station-${ruleIdx}-${condIdx}` : `station-${condIdx}`, cond.stationId || '')}
                ${this._renderSignalSelect(ruleIdx !== undefined ? `other-signal-${ruleIdx}-${condIdx}` : `signal-${condIdx}`, cond.signal)}
                <span>=</span>
                ${this._renderValueSelect(ruleIdx !== undefined ? `other-condval-${ruleIdx}-${condIdx}` : `condval-${condIdx}`, cond.value)}
                <button class="interlock-remove-btn" data-action="${ruleIdx !== undefined ? 'remove-other-condition' : 'remove-condition'}" ${dataAttrs} title="削除">&times;</button>
            </div>
        `;
    }

    _renderStationSelect(id, currentValue) {
        const connectedStations = this._getConnectedStations();
        const options = [
            `<option value="" ${!currentValue ? 'selected' : ''}>自ステーション</option>`,
            ...connectedStations.map(s =>
                `<option value="${s}" ${currentValue === s ? 'selected' : ''}>${this._escape(s)}</option>`
            )
        ];
        return `<select class="interlock-inline-select" id="il-${id}">${options.join('')}</select>`;
    }

    _renderSignalSelect(id, currentValue) {
        const options = this._editSignals.map(s => {
            const disp = getSignalLabel(s.name);
            return `<option value="${s.name}" ${currentValue === s.name ? 'selected' : ''}>${disp}</option>`;
        });

        // Add workType signals from scenario
        const workTypes = this._collectWorkTypes();
        workTypes.forEach(wt => {
            const sigName = `workType:${wt}`;
            const alreadyInSignals = this._editSignals.some(s => s.name === sigName);
            if (!alreadyInSignals) {
                const disp = `ワーク種類: ${wt}`;
                options.push(`<option value="${sigName}" ${currentValue === sigName ? 'selected' : ''}>${disp}</option>`);
            }
        });

        // If currentValue is a workType signal not yet listed, add it
        if (currentValue && currentValue.startsWith('workType:') && !workTypes.includes(currentValue.substring(9))) {
            const wt = currentValue.substring(9);
            options.push(`<option value="${currentValue}" selected>ワーク種類: ${wt}</option>`);
        }

        return `<select class="interlock-inline-select" id="il-${id}">${options.join('')}</select>`;
    }

    _renderValueSelect(id, currentValue) {
        return `
            <select class="interlock-inline-select interlock-value-select" id="il-${id}">
                <option value="true" ${currentValue ? 'selected' : ''}>ON</option>
                <option value="false" ${!currentValue ? 'selected' : ''}>OFF</option>
            </select>
        `;
    }

    _collectWorkTypes() {
        if (!this._scenario) return [];
        const types = new Set();
        const collectFromScenario = (scenario) => {
            for (const station of (scenario.stations || [])) {
                const wt = station.config?.workType;
                if (wt) types.add(wt);
                const owt = station.config?.outputWorkType;
                if (owt) types.add(owt);
                // Collect from sub-scenarios (moduler)
                if (station.config?.subScenario) {
                    collectFromScenario(station.config.subScenario);
                }
                // Collect from port interlockRules workType conditions
                const allPorts = [
                    ...(station.config?.inPorts || []),
                    ...(station.config?.outPorts || []),
                    ...(station.config?.ports || []),
                ];
                for (const port of allPorts) {
                    if (port.interlockRules?.rules) {
                        for (const rule of port.interlockRules.rules) {
                            for (const cond of (rule.conditions || [])) {
                                if (cond.signal?.startsWith('workType:')) {
                                    types.add(cond.signal.substring(9));
                                }
                            }
                        }
                    }
                }
            }
            // Collect from connection conditions
            for (const conn of (scenario.connections || [])) {
                if (conn.condition?.startsWith('workType:')) {
                    types.add(conn.condition.substring(9));
                }
            }
        };
        collectFromScenario(this._scenario);
        return Array.from(types).sort();
    }

    _getConnectedStations() {
        if (!this._scenario || !this._station) return [];
        const stationId = this._station.id;
        const ids = new Set();
        for (const conn of this._scenario.connections) {
            if (conn.from === stationId) ids.add(conn.to);
            if (conn.to === stationId) ids.add(conn.from);
        }
        return Array.from(ids);
    }

    _bindTabContentEvents() {
        const content = this._overlay.querySelector('#il-tab-content');
        if (!content) return;

        // Add condition for main tabs
        content.querySelectorAll('[data-action="add-condition"]').forEach(btn => {
            btn.addEventListener('click', () => this._addConditionToMainTab());
        });

        // Remove condition for main tabs
        content.querySelectorAll('[data-action="remove-condition"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const condIdx = parseInt(btn.dataset.condIdx);
                this._removeConditionFromMainTab(condIdx);
            });
        });

        // Add condition for other rules
        content.querySelectorAll('[data-action="add-other-condition"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const ruleIdx = parseInt(btn.dataset.ruleIdx);
                this._addConditionToOtherRule(ruleIdx);
            });
        });

        // Remove condition for other rules
        content.querySelectorAll('[data-action="remove-other-condition"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const ruleIdx = parseInt(btn.dataset.ruleIdx);
                const condIdx = parseInt(btn.dataset.condIdx);
                this._removeConditionFromOtherRule(ruleIdx, condIdx);
            });
        });

        // Delete other rule
        content.querySelectorAll('[data-action="delete-other-rule"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const ruleIdx = parseInt(btn.dataset.ruleIdx);
                this._deleteOtherRule(ruleIdx);
            });
        });

        // Add other rule
        content.querySelectorAll('[data-action="add-other-rule"]').forEach(btn => {
            btn.addEventListener('click', () => this._addOtherRule());
        });

        // Inline select changes — save to model on change
        content.querySelectorAll('.interlock-inline-select').forEach(sel => {
            sel.addEventListener('change', () => this._syncFromUI());
        });
    }

    _getMainTabRule() {
        const tab = TAB_DEFS.find(t => t.id === this._activeTab);
        if (!tab || tab.id === 'other') return null;
        return this._editRules.find(r => r.target === tab.target && r.value === tab.value);
    }

    _addConditionToMainTab() {
        const tab = TAB_DEFS.find(t => t.id === this._activeTab);
        if (!tab || tab.id === 'other') return;

        let rule = this._editRules.find(r => r.target === tab.target && r.value === tab.value);
        if (!rule) {
            // Create the rule
            rule = { target: tab.target, value: tab.value, conditions: [] };
            this._editRules.push(rule);
        }
        rule.conditions.push({ signal: this._editSignals[0]?.name || 'inputWorkPresent', value: false });
        this._render();
    }

    _removeConditionFromMainTab(condIdx) {
        const tab = TAB_DEFS.find(t => t.id === this._activeTab);
        if (!tab || tab.id === 'other') return;

        const rule = this._editRules.find(r => r.target === tab.target && r.value === tab.value);
        if (rule && rule.conditions[condIdx] !== undefined) {
            rule.conditions.splice(condIdx, 1);
        }
        this._render();
    }

    _addConditionToOtherRule(ruleIdx) {
        const rule = this._editRules[ruleIdx];
        if (rule) {
            rule.conditions.push({ signal: this._editSignals[0]?.name || 'inputWorkPresent', value: false });
            this._render();
        }
    }

    _removeConditionFromOtherRule(ruleIdx, condIdx) {
        const rule = this._editRules[ruleIdx];
        if (rule && rule.conditions[condIdx] !== undefined) {
            rule.conditions.splice(condIdx, 1);
            this._render();
        }
    }

    _deleteOtherRule(ruleIdx) {
        const rule = this._editRules[ruleIdx];
        if (!rule) return;

        this._editRules.splice(ruleIdx, 1);
        this._render();
    }

    _addOtherRule() {
        this._editRules.push({
            target: this._editSignals[0]?.name || 'inputWorkPresent',
            value: false,
            conditions: [{ signal: this._editSignals[0]?.name || 'inputWorkPresent', value: false }]
        });
        this._render();
    }

    _syncFromUI() {
        const content = this._overlay.querySelector('#il-tab-content');
        if (!content) return;

        const tab = TAB_DEFS.find(t => t.id === this._activeTab);
        if (!tab) return;

        if (tab.id === 'other') {
            this._syncOtherTabFromUI(content);
        } else {
            this._syncMainTabFromUI(content, tab);
        }
    }

    _syncMainTabFromUI(content, tab) {
        const rule = this._editRules.find(r => r.target === tab.target && r.value === tab.value);
        if (!rule) return;

        rule.conditions.forEach((cond, idx) => {
            const stationSel = content.querySelector(`#il-station-${idx}`);
            const signalSel = content.querySelector(`#il-signal-${idx}`);
            const valSel = content.querySelector(`#il-condval-${idx}`);

            if (stationSel) cond.stationId = stationSel.value || undefined;
            if (signalSel) cond.signal = signalSel.value;
            if (valSel) cond.value = valSel.value === 'true';
        });
    }

    _syncOtherTabFromUI(content) {
        const otherRules = this._editRules.filter(r =>
            r.target !== 'inputReady' && r.target !== 'outputReady' && r.target !== 'processReady'
        );

        otherRules.forEach((rule) => {
            const globalIdx = this._editRules.indexOf(rule);

            // Sync target/value
            const targetSel = content.querySelector(`#il-other-target-${globalIdx}`);
            const valueSel = content.querySelector(`#il-other-value-${globalIdx}`);
            if (targetSel) rule.target = targetSel.value;
            if (valueSel) rule.value = valueSel.value === 'true';

            // Sync conditions
            rule.conditions.forEach((cond, condIdx) => {
                const stationSel = content.querySelector(`#il-other-station-${globalIdx}-${condIdx}`);
                const signalSel = content.querySelector(`#il-other-signal-${globalIdx}-${condIdx}`);
                const valSel = content.querySelector(`#il-other-condval-${globalIdx}-${condIdx}`);

                if (stationSel) cond.stationId = stationSel.value || undefined;
                if (signalSel) cond.signal = signalSel.value;
                if (valSel) cond.value = valSel.value === 'true';
            });
        });
    }

    _handleModeChange(mode) {
        if (mode === 'custom' && !this._isCustom) {
            // Switch to custom: copy current (default) rules
            this._isCustom = true;
            // Rules are already loaded from defaults
        } else if (mode === 'default' && this._isCustom) {
            if (!confirm('カスタムルールを破棄してデフォルトに戻しますか？')) {
                // Revert radio
                this._render();
                return;
            }
            this._isCustom = false;
            // Reload default preset
            let preset;
            if (this._portOpts) {
                preset = this._getDefaultPortPreset();
            } else {
                preset = getDefaultPreset(this._station.type);
            }
            if (preset) {
                const config = clonePreset(preset);
                this._editRules = config.rules || [];
                this._editSignals = config.signals || [];
            }
        }
        this._render();
    }

    _handlePresetSelect(presetKey) {
        const presets = getPresetsForType(this._station.type);
        const preset = presets[presetKey];
        if (!preset) return;

        if (!confirm('現在のルールをプリセットで上書きしますか？')) {
            // Reset selector
            const sel = this._overlay.querySelector('#il-preset-select');
            if (sel) sel.value = '';
            return;
        }

        const config = clonePreset(preset);
        this._editRules = config.rules || [];
        this._editSignals = config.signals || [];
        this._render();
    }

    _handleSave() {
        // Sync any pending UI changes
        this._syncFromUI();

        // Run validation
        const { errors, warnings } = this._validate();

        if (errors.length > 0) {
            alert('エラー:\n' + errors.join('\n') + '\n\nエラーを修正してから保存してください。');
            return;
        }

        if (warnings.length > 0) {
            const msg = '警告:\n' + warnings.join('\n') + '\n\n保存を続行しますか？';
            if (!confirm(msg)) return;
        }

        // Ensure workType signals used in rules are added to _editSignals
        for (const rule of this._editRules) {
            for (const cond of rule.conditions) {
                if (cond.signal.startsWith('workType:')) {
                    const exists = this._editSignals.some(s => s.name === cond.signal);
                    if (!exists) {
                        this._editSignals.push({ name: cond.signal, initial: false });
                    }
                }
            }
        }

        // Apply changes
        if (this._portOpts) {
            // Port mode: save to port's interlockRules
            const portIdx = this._portOpts.portIndex;
            const portKey = this._portOpts.portType === 'mergeInput' ? 'inPorts' : 'outPorts';
            if (!this._station.config[portKey]) this._station.config[portKey] = [];
            while (this._station.config[portKey].length <= portIdx) {
                this._station.config[portKey].push({ capacity: 1 });
            }
            if (this._isCustom) {
                this._station.config[portKey][portIdx].interlockRules = {
                    signals: clonePreset(this._editSignals),
                    rules: clonePreset(this._editRules)
                };
            } else {
                delete this._station.config[portKey][portIdx].interlockRules;
            }
        } else {
            // Station mode
            if (this._isCustom) {
                this._station.config.interlockRules = {
                    signals: clonePreset(this._editSignals),
                    rules: clonePreset(this._editRules)
                };
            } else {
                delete this._station.config.interlockRules;
            }
        }

        // Notify callback
        if (this._onSave) this._onSave();

        this.close();
    }

    _validate() {
        const errors = [];
        const warnings = [];

        if (!this._isCustom) return { errors, warnings };

        // Check each main tab
        const irOn = this._editRules.find(r => r.target === 'inputReady' && r.value === true);
        const irOff = this._editRules.find(r => r.target === 'inputReady' && r.value === false);
        const orOn = this._editRules.find(r => r.target === 'outputReady' && r.value === true);
        const orOff = this._editRules.find(r => r.target === 'outputReady' && r.value === false);

        if (!irOn || irOn.conditions.length === 0) {
            warnings.push('搬入可がONになる条件がありません。ワークを受け入れられません。');
        }
        if (!irOff || irOff.conditions.length === 0) {
            warnings.push('搬入可をOFFにする条件がありません。一度ONになると常にONのままになります。');
        }
        if (!orOn || orOn.conditions.length === 0) {
            warnings.push('搬出可がONになる条件がありません。ワークを搬出できません。');
        }
        if (!orOff || orOff.conditions.length === 0) {
            warnings.push('搬出可をOFFにする条件がありません。一度ONになると常にONのままになります。');
        }

        // Check for identical ON/OFF conditions (conflict)
        if (irOn && irOff && irOn.conditions.length > 0 && irOff.conditions.length > 0) {
            if (this._conditionsEqual(irOn.conditions, irOff.conditions)) {
                errors.push('搬入可ON/OFFの条件が同じです。矛盾しています。');
            }
        }
        if (orOn && orOff && orOn.conditions.length > 0 && orOff.conditions.length > 0) {
            if (this._conditionsEqual(orOn.conditions, orOff.conditions)) {
                errors.push('搬出可ON/OFFの条件が同じです。矛盾しています。');
            }
        }

        // Check for undefined signals
        const signalNames = new Set(this._editSignals.map(s => s.name));
        // Also include workType signals from scenario as valid
        const workTypes = this._collectWorkTypes();
        workTypes.forEach(wt => signalNames.add(`workType:${wt}`));
        for (const rule of this._editRules) {
            for (const cond of rule.conditions) {
                // Allow any workType:* signal (dynamic signals)
                if (!signalNames.has(cond.signal) && !cond.signal.startsWith('workType:')) {
                    errors.push(`信号 '${cond.signal}' は定義されていません。`);
                }
                if (cond.stationId) {
                    const exists = this._scenario.stations.some(s => s.id === cond.stationId);
                    if (!exists) {
                        errors.push(`ステーション '${cond.stationId}' は存在しません。`);
                    }
                }
            }
        }

        // Check for processReady ON rule in processing stations
        if (this._station.type === 'processing' || this._station.type === 'split') {
            const hasPR = this._editRules.some(r => r.target === 'processReady' && r.value === true && (r.conditions || []).length > 0);
            if (!hasPR) {
                warnings.push('加工準備ON (processReady) のルールがありません。加工が開始されない可能性があります。');
            }
        }

        return { errors, warnings };
    }

    _conditionsEqual(a, b) {
        if (a.length !== b.length) return false;
        const normalize = (c) => JSON.stringify(c.map(x => ({
            signal: x.signal, value: x.value, stationId: x.stationId || ''
        })).sort((x, y) => x.signal.localeCompare(y.signal)));
        return normalize(a) === normalize(b);
    }

    _escape(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
