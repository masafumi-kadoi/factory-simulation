// Execution settings page logic

let currentScenarioId = null;
let currentInitialConditions = null;

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

    // Execute button
    document.getElementById('btn-execute').addEventListener('click', executeSimulation);

    loadScenarioSummary();
});

function setupRadioButtons() {
    const radioOptions = document.querySelectorAll('.radio-option');
    radioOptions.forEach(option => {
        option.addEventListener('click', () => {
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
        });
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

    const startTimeISO = `${startDate}T${startTime}:00`;

    btn.disabled = true;
    btn.textContent = 'Fetching...';
    container.innerHTML = '<div class="loading">Fetching initial conditions from SimDB...</div>';
    warningsContainer.innerHTML = '';

    try {
        const data = await ExecutorAPI.getInitialConditions(currentScenarioId, startTimeISO);
        currentInitialConditions = data.initialConditions || {};

        renderConditionsTable(currentInitialConditions);

        // Show warnings
        if (data.warnings && data.warnings.length > 0) {
            warningsContainer.innerHTML = data.warnings.map(w =>
                `<div class="warning-box"><span class="warning-icon">&#9888;</span> ${escapeHtml(w.stationId)}: ${escapeHtml(w.message)}</div>`
            ).join('');
        }

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
                <td>${quality || '<span class="no-work">-</span>'}</td>
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
    const startTimeISO = `${startDate}T${startTime}:00`;

    // Get end condition
    const endType = document.querySelector('input[name="end-type"]:checked').value;
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
        endCondition = { type: 'absolute', value: `${endDate}T${endTime}:00` };
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

        resultContainer.innerHTML = `
            <div class="info-panel" style="border-color: #28a745">
                <strong>Simulation completed</strong>
                <div class="info-grid" style="margin-top: 0.5rem">
                    <span class="info-label">Execution ID:</span>
                    <span class="info-value">${escapeHtml(result.executionId)}</span>
                    <span class="info-label">Simulation ID:</span>
                    <span class="info-value">${escapeHtml(result.simulationId)}</span>
                    <span class="info-label">Status:</span>
                    <span class="info-value"><span class="status-badge status-${result.status}">${result.status}</span></span>
                </div>
                <div style="margin-top: 1rem; display: flex; gap: 0.5rem">
                    <a href="http://localhost:8081/?simulationId=${encodeURIComponent(result.simulationId)}" target="_blank" class="btn btn-primary btn-sm">View in sim-visualizer</a>
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
