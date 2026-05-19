// Execution settings page logic

let currentScenarioId = null;
let currentInitialConditions = null;
let currentStations = []; // Station list from scenario
let isManualMode = false;

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    currentScenarioId = params.get('scenarioId');

    if (!currentScenarioId) {
        document.getElementById('scenario-summary').innerHTML =
            '<div class="error-message">No scenario ID specified</div>';
        return;
    }

    // Set back link
    document.getElementById('btn-back').href = `scenario.html?id=${encodeURIComponent(currentScenarioId)}`;
    document.getElementById('breadcrumb-scenario').href = `scenario.html?id=${encodeURIComponent(currentScenarioId)}`;

    // Set default start date to today
    const today = new Date();
    document.getElementById('start-date').value = today.toISOString().split('T')[0];

    // Radio button handling
    setupRadioButtons();

    // Fetch conditions button
    document.getElementById('btn-fetch-conditions').addEventListener('click', fetchInitialConditions);

    // Manual conditions button
    document.getElementById('btn-manual-conditions').addEventListener('click', setManualConditions);

    // Clear conditions button
    document.getElementById('btn-clear-conditions').addEventListener('click', clearConditions);

    // Execute button
    document.getElementById('btn-execute').addEventListener('click', executeSimulation);

    loadScenarioSummary();
    loadStationList();
});

function setupRadioButtons() {
    const radioOptions = document.querySelectorAll('.radio-option');

    function selectOption(option) {
        const alreadySelected = option.classList.contains('selected');
        if (alreadySelected) return;

        radioOptions.forEach(o => {
            o.classList.remove('selected');
            o.querySelector('input[type="radio"]').checked = false;
            const inputs = o.querySelectorAll('.radio-inputs input');
            inputs.forEach(i => i.disabled = true);
        });

        option.classList.add('selected');
        option.querySelector('input[type="radio"]').checked = true;
        const inputs = option.querySelectorAll('.radio-inputs input');
        inputs.forEach(i => i.disabled = false);
    }

    radioOptions.forEach(option => {
        // .radio-inputs 内のクリックは親に伝播させない
        const radioInputsDiv = option.querySelector('.radio-inputs');
        if (radioInputsDiv) {
            radioInputsDiv.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            // disabledなinputをクリックしたときにオプション切替 + フォーカス
            radioInputsDiv.addEventListener('mousedown', (e) => {
                const input = e.target.closest('input');
                if (input && input.disabled) {
                    e.preventDefault();
                    selectOption(option);
                    input.focus();
                }
            });
        }

        option.addEventListener('click', () => selectOption(option));
    });
}

async function loadScenarioSummary() {
    const container = document.getElementById('scenario-summary');
    try {
        const data = await ExecutorAPI.getScenarios();
        const scenario = (data.scenarios || []).find(s => s.scenarioId === currentScenarioId);

        if (!scenario) {
            container.innerHTML = '<div class="error-message">Scenario not found</div>';
            return;
        }

        document.getElementById('breadcrumb-scenario').textContent = scenario.name;
        document.title = `sim-executor - ${scenario.name} - Execution`;

        const simdbInfo = scenario.simdbConfig
            ? `${scenario.simdbConfig.database || 'DB'} @ ${scenario.simdbConfig.host || ''}`
            : 'Not configured';

        container.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between">
                <div>
                    <strong style="font-size: 1.125rem">${escapeHtml(scenario.name)}</strong>
                    <div style="color: #6c757d; font-size: 0.85rem; margin-top: 0.25rem">
                        SimDB: ${escapeHtml(simdbInfo)}
                    </div>
                </div>
            </div>
        `;

        if (!scenario.simdbConfig) {
            document.getElementById('btn-fetch-conditions').disabled = true;
            document.getElementById('btn-fetch-conditions').textContent = 'SimDB not configured';
        }
    } catch (err) {
        container.innerHTML = `<div class="error-message">Failed to load scenario: ${escapeHtml(err.message)}</div>`;
    }
}

async function loadStationList() {
    try {
        const data = await ExecutorAPI.getScenarioDetail(currentScenarioId);
        currentStations = (data.stations || []).map(s => ({
            id: s.id,
            name: s.name || '',
            type: s.type
        }));
    } catch (err) {
        console.error('Failed to load station list:', err);
        currentStations = [];
    }
}

function setManualConditions() {
    if (currentStations.length === 0) {
        document.getElementById('conditions-container').innerHTML =
            '<div class="error-message">Station list not available. Please wait for scenario to load.</div>';
        return;
    }

    isManualMode = true;

    // Pre-populate with existing conditions if available
    const existing = currentInitialConditions || {};

    renderEditableConditionsTable(existing);
    document.getElementById('btn-clear-conditions').style.display = '';
    document.getElementById('btn-execute').disabled = false;
    document.getElementById('warnings-container').innerHTML = '';
}

function clearConditions() {
    currentInitialConditions = null;
    isManualMode = false;
    document.getElementById('btn-clear-conditions').style.display = 'none';
    document.getElementById('btn-execute').disabled = true;
    document.getElementById('warnings-container').innerHTML = '';
    document.getElementById('conditions-container').innerHTML = `
        <div class="empty-state" style="padding: 1.5rem">
            <p class="empty-hint">Click "Fetch from SimDB" or "Set Manually" to configure initial conditions</p>
        </div>
    `;
}

function renderEditableConditionsTable(conditions) {
    const container = document.getElementById('conditions-container');

    const rows = currentStations.map(station => {
        const cond = conditions[station.id];
        const workId = cond && cond.currentWork ? cond.currentWork.id : '';
        const elapsed = cond ? (cond.elapsedTime || 0) : 0;
        const quality = cond && cond.currentWork ? (cond.currentWork.qualityStatus || '') : '';
        const hasWork = !!(cond && cond.currentWork);

        return `
            <tr data-station-id="${escapeHtml(station.id)}">
                <td>
                    <span class="station-id-label">${station.name ? escapeHtml(station.name) : escapeHtml(station.id)}</span>
                    ${station.name ? `<span style="color:#6c757d;font-size:0.75rem;margin-left:0.25rem">(${escapeHtml(station.id)})</span>` : ''}
                    <span class="station-type-tag type-${escapeHtml(station.type)}">${escapeHtml(station.type)}</span>
                </td>
                <td><input type="text" class="condition-input" data-field="workId" value="${escapeHtml(workId)}" placeholder="(empty)"></td>
                <td><input type="number" class="condition-input" data-field="elapsed" value="${hasWork ? elapsed : ''}" placeholder="0" min="0" step="1"></td>
                <td>
                    <select class="condition-input" data-field="quality">
                        <option value="">-</option>
                        <option value="OK" ${quality === 'OK' ? 'selected' : ''}>OK</option>
                        <option value="NG" ${quality === 'NG' ? 'selected' : ''}>NG</option>
                    </select>
                </td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <table class="conditions-table conditions-editable">
            <thead>
                <tr>
                    <th>Station</th>
                    <th>Work ID</th>
                    <th>Elapsed (sec)</th>
                    <th>Quality</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        <div class="conditions-help">
            Work IDが空のステーションはワークなし(idle)として扱われます
        </div>
    `;
}

function collectManualConditions() {
    const conditions = {};
    const rows = document.querySelectorAll('.conditions-editable tbody tr');

    rows.forEach(row => {
        const stationId = row.dataset.stationId;
        const workId = row.querySelector('[data-field="workId"]').value.trim();
        const elapsed = parseFloat(row.querySelector('[data-field="elapsed"]').value) || 0;
        const quality = row.querySelector('[data-field="quality"]').value || null;

        if (workId) {
            conditions[stationId] = {
                currentWork: {
                    id: workId,
                    qualityStatus: quality
                },
                elapsedTime: elapsed
            };
        } else {
            conditions[stationId] = {
                currentWork: null,
                elapsedTime: 0
            };
        }
    });

    return conditions;
}

async function fetchInitialConditions() {
    const btn = document.getElementById('btn-fetch-conditions');
    const container = document.getElementById('conditions-container');
    const warningsContainer = document.getElementById('warnings-container');

    const startDate = document.getElementById('start-date').value;
    const startTime = document.getElementById('start-time').value;

    if (!startDate || !startTime) {
        container.innerHTML = '<div class="error-message">Please set start date and time first</div>';
        return;
    }

    const startTimeISO = `${startDate}T${startTime}:00Z`;

    btn.disabled = true;
    btn.textContent = 'Fetching...';
    container.innerHTML = '<div class="loading">Fetching initial conditions from SimDB...</div>';
    warningsContainer.innerHTML = '';

    try {
        const data = await ExecutorAPI.getInitialConditions(currentScenarioId, startTimeISO);
        currentInitialConditions = data.initialConditions || {};
        isManualMode = false;

        renderConditionsTable(currentInitialConditions);

        // Show warnings
        if (data.warnings && data.warnings.length > 0) {
            warningsContainer.innerHTML = data.warnings.map(w =>
                `<div class="warning-box"><span class="warning-icon">&#9888;</span> ${escapeHtml(w.stationId)}: ${escapeHtml(w.message)}</div>`
            ).join('');
        }

        document.getElementById('btn-clear-conditions').style.display = '';
        document.getElementById('btn-execute').disabled = false;
    } catch (err) {
        container.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        currentInitialConditions = null;
        document.getElementById('btn-execute').disabled = true;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Fetch from SimDB';
    }
}

function renderConditionsTable(conditions) {
    const container = document.getElementById('conditions-container');
    const entries = Object.entries(conditions);

    if (entries.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 1.5rem">
                <p>No works found at the specified time</p>
                <p class="empty-hint">All stations are idle at this start time</p>
            </div>
        `;
        document.getElementById('btn-execute').disabled = false;
        return;
    }

    let rows = entries.map(([stationId, cond]) => {
        const workId = cond.currentWork ? cond.currentWork.id : null;
        const quality = cond.currentWork ? cond.currentWork.qualityStatus : null;
        const elapsed = cond.elapsedTime || 0;

        return `
            <tr>
                <td>${escapeHtml(stationId)}</td>
                <td>${workId ? escapeHtml(workId) : '<span class="no-work">(none)</span>'}</td>
                <td>${workId ? elapsed.toFixed(0) : '<span class="no-work">-</span>'}</td>
                <td>${quality ? escapeHtml(quality) : '<span class="no-work">-</span>'}</td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <table class="conditions-table">
            <thead>
                <tr>
                    <th>Station</th>
                    <th>Work ID</th>
                    <th>Elapsed (sec)</th>
                    <th>Quality</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

async function executeSimulation() {
    const btn = document.getElementById('btn-execute');
    const resultContainer = document.getElementById('execute-result');

    const startDate = document.getElementById('start-date').value;
    const startTime = document.getElementById('start-time').value;

    if (!startDate || !startTime) {
        resultContainer.innerHTML = '<div class="error-message">Please set start date and time first</div>';
        return;
    }

    const startTimeISO = `${startDate}T${startTime}:00Z`;

    // Get end condition
    const endTypeEl = document.querySelector('input[name="end-type"]:checked');
    if (!endTypeEl) {
        resultContainer.innerHTML = '<div class="error-message">Please select an end condition type</div>';
        return;
    }
    const endType = endTypeEl.value;
    let endCondition;
    if (endType === 'duration') {
        const minutes = document.getElementById('duration-value').value;
        endCondition = { type: 'duration', value: minutes };
    } else {
        const endDate = document.getElementById('end-date').value;
        const endTime = document.getElementById('end-time').value;
        if (!endDate || !endTime) {
            resultContainer.innerHTML = '<div class="error-message">Please set end date and time</div>';
            return;
        }
        endCondition = { type: 'absolute', value: `${endDate}T${endTime}:00Z` };
    }

    // Collect conditions from editable table if in manual mode
    if (isManualMode) {
        currentInitialConditions = collectManualConditions();
    }

    btn.disabled = true;
    btn.textContent = 'Executing...';
    resultContainer.innerHTML = '<div class="loading">Running simulation...</div>';

    try {
        const result = await ExecutorAPI.execute(
            currentScenarioId,
            startTimeISO,
            endCondition,
            currentInitialConditions || {}
        );

        const isAsync = result.status === 'pending';
        const vizId = result.dataSourceId || result.simulationId;
        const vizParam = vizId ? `ds=${encodeURIComponent(vizId)}` : '';
        resultContainer.innerHTML = `
            <div class="info-panel" style="border-color: #28a745">
                <strong>${isAsync ? 'Simulation started (running in background)' : 'Simulation completed'}</strong>
                <div class="info-grid" style="margin-top: 0.5rem">
                    <span class="info-label">Execution ID:</span>
                    <span class="info-value">${escapeHtml(result.executionId)}</span>
                    <span class="info-label">Data Source ID:</span>
                    <span class="info-value">${escapeHtml(result.dataSourceId)}</span>
                    <span class="info-label">Status:</span>
                    <span class="info-value"><span class="status-badge status-${escapeHtml(result.status)}">${escapeHtml(result.status)}</span></span>
                </div>
                <div style="margin-top: 1rem; display: flex; gap: 0.5rem">
                    <a href="/visualizer/?${vizParam}" target="_blank" class="btn btn-primary btn-sm">View in sim-visualizer</a>
                    <a href="scenario.html?id=${encodeURIComponent(currentScenarioId)}" class="btn btn-outline btn-sm">Back to Scenario</a>
                </div>
            </div>
        `;
    } catch (err) {
        resultContainer.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Execute Simulation';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
