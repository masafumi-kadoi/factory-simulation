// Scenarios page logic

document.addEventListener('DOMContentLoaded', () => {
    loadScenarios();
});

async function loadScenarios() {
    const container = document.getElementById('scenarios-container');

    try {
        const data = await PortalAPI.getScenarios();
        const scenarios = data.scenarios || [];

        if (scenarios.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">\uD83D\uDCC1</div>
                    <p>No scenarios found</p>
                    <p class="text-muted">Create a scenario in sim-editor to get started</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Stations</th>
                        <th>Connections</th>
                        <th>SimDB</th>
                        <th>Executions</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${scenarios.map(s => renderScenarioRow(s)).join('')}
                </tbody>
            </table>
        `;
    } catch (err) {
        container.innerHTML = `<div class="error-message">Failed to load scenarios: ${escapeHtml(err.message)}</div>`;
    }
}

function renderScenarioRow(scenario) {
    const simdbBadge = scenario.simdbConfig
        ? `<span class="simdb-badge configured">${escapeHtml(scenario.simdbConfig.database || 'Configured')}</span>`
        : '<span class="simdb-badge not-configured">Not set</span>';

    const execCount = scenario.executionCount || 0;

    return `
        <tr>
            <td><strong>${escapeHtml(scenario.name)}</strong></td>
            <td>${scenario.stationCount}</td>
            <td>${scenario.connectionCount}</td>
            <td>${simdbBadge}</td>
            <td>${execCount}</td>
            <td>
                <div class="action-links">
                    <a href="http://localhost:8082/editor.html?scenarioId=${encodeURIComponent(scenario.scenarioId)}" target="_blank" class="btn btn-outline btn-sm">Edit</a>
                    <a href="http://localhost:8083/scenario.html?id=${encodeURIComponent(scenario.scenarioId)}" target="_blank" class="btn btn-outline btn-sm">Execute</a>
                    ${execCount > 0 ? `<a href="http://localhost:8083/scenario.html?id=${encodeURIComponent(scenario.scenarioId)}" target="_blank" class="btn btn-outline btn-sm">History</a>` : ''}
                </div>
            </td>
        </tr>
    `;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
