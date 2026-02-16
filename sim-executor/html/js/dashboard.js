// Dashboard page logic

let allScenarios = [];
let currentSort = 'name';

document.addEventListener('DOMContentLoaded', () => {
    loadScenarios();
    setupSortButtons();
});

function setupSortButtons() {
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentSort = btn.dataset.sort;
            document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderScenarios();
        });
    });
}

async function loadScenarios() {
    const container = document.getElementById('scenarios-container');
    try {
        const data = await ExecutorAPI.getScenarios();
        allScenarios = data.scenarios || [];

        renderScenarios();
    } catch (err) {
        container.innerHTML = `
            <div class="error-message">
                Failed to load scenarios: ${escapeHtml(err.message)}
            </div>
        `;
    }
}

function getSortedScenarios() {
    const sorted = [...allScenarios];
    switch (currentSort) {
        case 'name':
            sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
            break;
        case 'createdAt':
            sorted.sort((a, b) => {
                const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return tb - ta;
            });
            break;
        case 'updatedAt':
            sorted.sort((a, b) => {
                const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
                const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
                return tb - ta;
            });
            break;
    }
    return sorted;
}

function renderScenarios() {
    const container = document.getElementById('scenarios-container');
    const scenarios = getSortedScenarios();

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
