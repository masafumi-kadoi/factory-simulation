// Interlock Modal — condition editor for station interlock rules
import { INTERLOCK_PRESETS, SIGNAL_DISPLAY, getDefaultPreset, getPresetsForType, clonePreset } from './interlock-presets.js';

const TAB_DEFS = [
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
     * Open the modal for a station
     * @param {object} station - the station object from the scenario
     * @param {object} scenario - the full scenario (for connection lookups)
     * @param {function} onSave - callback when save is clicked
     */
    open(station, scenario, onSave) {
        this._station = station;
        this._scenario = scenario;
        this._onSave = onSave;
        this._activeTab = 'inputReady-on';

        // Determine mode
        this._isCustom = !!station.config.interlockRules;

        // Load rules into editable state
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

        this._createOverlay();
        this._render();
        document.addEventListener('keydown', this._boundKeyHandler);
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

        // Get available presets for this station type
        const presets = getPresetsForType(station.type);
        const presetKeys = Object.keys(presets);

        // Build preset selector (visible only in Custom mode)
        const presetOptions = presetKeys.map(key =>
            `<option value="${key}">${this._escape(presets[key].name)}</option>`
        ).join('');

        modal.innerHTML = `
            <div class="interlock-modal-header">
                <span class="interlock-modal-title">条件設定: ${this._escape(station.id)}</span>
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
                    ${TAB_DEFS.map(tab => `
                        <button class="interlock-tab ${this._activeTab === tab.id ? 'active' : ''}" data-tab="${tab.id}">
                            ${tab.label}
                        </button>
                    `).join('')}
                </div>
                <div class="interlock-tab-content" id="il-tab-content">
                    ${this._renderTabContent()}
                </div>
                <div class="interlock-signals-info">
                    <span class="interlock-signals-title">信号一覧（現在の定義）:</span>
                    ${this._editSignals.map(s => {
                        const disp = SIGNAL_DISPLAY[s.name];
                        return `<span class="interlock-signal-badge">${disp ? disp.label : s.name}</span>`;
                    }).join(' ')}
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

        const targetDisplay = SIGNAL_DISPLAY[tab.target] ? SIGNAL_DISPLAY[tab.target].label : tab.target;
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
            r.target !== 'inputReady' && r.target !== 'outputReady'
        );

        let html = '<div class="interlock-tab-header">補助ルール:</div>';

        if (otherRules.length === 0) {
            html += '<div class="interlock-conditions-empty">補助ルールはありません</div>';
        } else {
            otherRules.forEach((rule, ruleIdx) => {
                const globalIdx = this._editRules.indexOf(rule);
                const targetDisplay = SIGNAL_DISPLAY[rule.target] ? SIGNAL_DISPLAY[rule.target].label : rule.target;
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
            const signalDisp = SIGNAL_DISPLAY[cond.signal] ? SIGNAL_DISPLAY[cond.signal].label : cond.signal;
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
            const disp = SIGNAL_DISPLAY[s.name] ? SIGNAL_DISPLAY[s.name].label : s.name;
            return `<option value="${s.name}" ${currentValue === s.name ? 'selected' : ''}>${disp}</option>`;
        });
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
        rule.conditions.push({ signal: this._editSignals[0]?.name || 'workPresent', value: false });
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
            rule.conditions.push({ signal: this._editSignals[0]?.name || 'workPresent', value: false });
            this._render();
        }
    }

    _removeConditionFromOtherRule(ruleIdx, condIdx) {
        const rule = this._editRules[ruleIdx];
        if (rule && rule.conditions[condIdx] !== undefined) {
            // Check if this is the R5 processingComplete reset rule
            if (this._station.type === 'processing' && rule.target === 'processingComplete' && rule.value === false) {
                if (rule.conditions.length <= 1) {
                    if (!confirm('処理完了リセットルールの最後の条件を削除すると、ステーションが正常にサイクルしなくなる可能性があります。本当に削除しますか？')) {
                        return;
                    }
                }
            }
            rule.conditions.splice(condIdx, 1);
            this._render();
        }
    }

    _deleteOtherRule(ruleIdx) {
        const rule = this._editRules[ruleIdx];
        if (!rule) return;

        // Warn if deleting R5 processingComplete reset rule
        if (this._station.type === 'processing' && rule.target === 'processingComplete' && rule.value === false) {
            if (!confirm('処理完了リセットルールを削除すると、ステーションが正常にサイクルしなくなる可能性があります。本当に削除しますか？')) {
                return;
            }
        }

        this._editRules.splice(ruleIdx, 1);
        this._render();
    }

    _addOtherRule() {
        this._editRules.push({
            target: this._editSignals[0]?.name || 'workPresent',
            value: false,
            conditions: [{ signal: this._editSignals[0]?.name || 'workPresent', value: false }]
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
            r.target !== 'inputReady' && r.target !== 'outputReady'
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
            const preset = getDefaultPreset(this._station.type);
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

        // Apply changes to station
        if (this._isCustom) {
            this._station.config.interlockRules = {
                signals: clonePreset(this._editSignals),
                rules: clonePreset(this._editRules)
            };
        } else {
            // Default mode: remove custom rules
            delete this._station.config.interlockRules;
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
        for (const rule of this._editRules) {
            for (const cond of rule.conditions) {
                if (!signalNames.has(cond.signal)) {
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

        // Check for R5 (processingComplete reset) in processing stations
        if (this._station.type === 'processing') {
            const hasR5 = this._editRules.some(r => r.target === 'processingComplete' && r.value === false);
            if (!hasR5) {
                warnings.push('処理完了リセットルールがありません。ステーションが正常にサイクルしない可能性があります。');
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
