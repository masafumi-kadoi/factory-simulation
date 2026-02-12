// Executions page logic

let allExecutions = [];
let currentFilter = 'all';

document.addEventListener('DOMContentLoaded', () => {
    setupFilters();
    loadAllExecutions();
});

function setupFilters() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderExecutions();
        });
    });
}

async function loadAllExecutions() {
    const container = document.getElementById('executions-container');

    try {
        const data = await PortalAPI.getScenarios();
        const scenarios = data.scenarios || [];

        if (scenarios.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">\uD83D\uDCCB</div>
                    <p>No scenarios found</p>
                    <p class="text-muted">Create and run a simulation to see execution history</p>
                </div>
            `;
            return;
        }

        // Fetch executions for all scenarios in parallel
        const executionResults = await Promise.all(
            scenarios.map(async (s) => {
                try {
                    const execData = await PortalAPI.getExecutions(s.scenarioId);
                    return (execData.executions || []).map(e => ({
                        ...e,
                        scenarioName: s.name,
                        scenarioId: s.scenarioId
                    }));
                } catch {
                    return [];
                }
            })
        );

        allExecutions = executionResults.flat();
        allExecutions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        renderExecutions();
    } catch (err) {
        container.innerHTML = `<div class="error-message">Failed to load executions: ${escapeHtml(err.message)}</div>`;
    }
}

function renderExecutions() {
    const container = document.getElementById('executions-container');
    const filtered = currentFilter === 'all'
        ? allExecutions
        : allExecutions.filter(e => e.status === currentFilter);

    if (filtered.length === 0) {
        const msg = currentFilter === 'all'
            ? 'No executions yet'
            : `No ${currentFilter} executions`;
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">\u23F3</div>
                <p>${msg}</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Scenario</th>
                    <th>Status</th>
                    <th>Start Time</th>
                    <th>End Condition</th>
                    <th>Created</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${filtered.map(exec => renderExecutionRow(exec)).join('')}
            </tbody>
        </table>
    `;
}

function renderExecutionRow(exec) {
    const statusClass = `status-${exec.status}`;
    const startTime = formatDateTime(exec.startTime);
    const createdAt = formatDateTime(exec.createdAt);

    const endInfo = exec.endConditionType === 'duration'
        ? `${exec.endConditionValue} min`
        : formatDateTime(exec.endConditionValue);

    let actions = '';
    if (exec.status === 'completed' && exec.simulationId) {
        actions = `<a href="http://localhost:8081/?simulationId=${encodeURIComponent(exec.simulationId)}" target="_blank" class="btn btn-outline btn-sm">Visualize</a>`;
    }

    let errorHtml = '';
    if (exec.status === 'error' && exec.errorMessage) {
        errorHtml = `<br><span class="text-muted" style="font-size: 0.75rem">${escapeHtml(exec.errorMessage)}</span>`;
    }

    return `
        <tr>
            <td>${escapeHtml(exec.scenarioName)}</td>
            <td><span class="status-badge ${statusClass}">${exec.status}</span>${errorHtml}</td>
            <td>${startTime}</td>
            <td>${endInfo}</td>
            <td>${createdAt}</td>
            <td>${actions}</td>
        </tr>
    `;
}

function formatDateTime(str) {
    if (!str) return '-';
    try {
        const d = new Date(str);
        if (isNaN(d.getTime())) return str;
        return d.toLocaleString('ja-JP', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    } catch {
        return str;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
