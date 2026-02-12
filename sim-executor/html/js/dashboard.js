// Dashboard page logic

document.addEventListener('DOMContentLoaded', () => {
    loadScenarios();
});

async function loadScenarios() {
    const container = document.getElementById('scenarios-container');
    try {
        const data = await ExecutorAPI.getScenarios();
        const scenarios = data.scenarios || [];

        if (scenarios.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">&#128269;</div>
                    <p>No scenarios found</p>
                    <p class="empty-hint">Create a scenario in sim-editor first</p>
                </div>
            `;
            return;
        }

        container.innerHTML = scenarios.map(s => renderScenarioCard(s)).join('');
    } catch (err) {
        container.innerHTML = `
            <div class="error-message">
                Failed to load scenarios: ${escapeHtml(err.message)}
            </div>
        `;
    }
}

function renderScenarioCard(scenario) {
    const simdbInfo = scenario.simdbConfig
        ? `<span class="simdb-badge">${escapeHtml(scenario.simdbConfig.database || 'DB')} @ ${escapeHtml(scenario.simdbConfig.host || '')}</span>`
        : `<span class="simdb-badge no-config">SimDB未設定</span>`;

    return `
        <div class="card">
            <div class="card-title">${escapeHtml(scenario.name)}</div>
            <div class="card-meta">
                <span>Stations: ${scenario.stationCount}</span>
                <span>Connections: ${scenario.connectionCount}</span>
                ${simdbInfo}
            </div>
            <div class="card-actions">
                <a href="scenario.html?id=${encodeURIComponent(scenario.scenarioId)}" class="btn btn-primary btn-sm">
                    Execution History (${scenario.executionCount})
                </a>
                <a href="http://localhost:8082/editor.html?scenarioId=${encodeURIComponent(scenario.scenarioId)}" target="_blank" class="btn btn-outline btn-sm">
                    Edit in sim-editor
                </a>
            </div>
        </div>
    `;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
