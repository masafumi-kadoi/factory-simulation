// Scenario detail page logic

let currentScenarioId = null;
let allExecutions = [];
let execSort = 'newest';

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    currentScenarioId = params.get('id');

    if (!currentScenarioId) {
        document.getElementById('scenario-info').innerHTML =
            '<div class="error-message">No scenario ID specified</div>';
        return;
    }

    document.getElementById('btn-new-execution').addEventListener('click', () => {
        window.location.href = `execution.html?scenarioId=${encodeURIComponent(currentScenarioId)}`;
    });

    setupExecSortButtons();
    loadScenarioInfo();
    loadExecutions();
});

function setupExecSortButtons() {
    document.querySelectorAll('.exec-sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            execSort = btn.dataset.sort;
            document.querySelectorAll('.exec-sort-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderExecutions();
        });
    });
}

async function loadScenarioInfo() {
    const container = document.getElementById('scenario-info');
    try {
        const data = await ExecutorAPI.getScenarios();
        const scenario = (data.scenarios || []).find(s => s.scenarioId === currentScenarioId);

        if (!scenario) {
            container.innerHTML = '<div class="error-message">Scenario not found</div>';
            return;
        }

        document.getElementById('breadcrumb-name').textContent = scenario.name;
        document.title = `sim-executor - ${scenario.name}`;

        const simdbInfo = scenario.simdbConfig
            ? `${scenario.simdbConfig.database || 'DB'} @ ${scenario.simdbConfig.host || ''}`
            : 'Not configured';

        container.innerHTML = `
            <h2>${escapeHtml(scenario.name)}</h2>
            <div class="info-grid">
                <span class="info-label">Stations:</span>
                <span class="info-value">${scenario.stationCount}</span>
                <span class="info-label">Connections:</span>
                <span class="info-value">${scenario.connectionCount}</span>
                <span class="info-label">SimDB:</span>
                <span class="info-value">${escapeHtml(simdbInfo)}</span>
            </div>
            <div style="margin-top: 1rem">
                <a href="/editor/editor.html?scenarioId=${encodeURIComponent(currentScenarioId)}" target="_blank" class="btn btn-outline btn-sm">Edit in Scenario Editor</a>
            </div>
        `;

        document.getElementById('btn-new-execution').disabled = false;
    } catch (err) {
        container.innerHTML = `<div class="error-message">Failed to load scenario: ${escapeHtml(err.message)}</div>`;
    }
}

async function loadExecutions() {
    const container = document.getElementById('executions-container');
    try {
        const data = await ExecutorAPI.getExecutions(currentScenarioId);
        allExecutions = data.executions || [];
        renderExecutions();
    } catch (err) {
        container.innerHTML = `<div class="error-message">Failed to load executions: ${escapeHtml(err.message)}</div>`;
    }
}

function getSortedExecutions() {
    const sorted = [...allExecutions];
    switch (execSort) {
        case 'newest':
            sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            break;
        case 'oldest':
            sorted.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            break;
        case 'status': {
            const order = { 'running': 0, 'pending': 1, 'completed': 2, 'error': 3 };
            sorted.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
            break;
        }
    }
    return sorted;
}

function renderExecutions() {
    const container = document.getElementById('executions-container');

    if (allExecutions.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">&#128203;</div>
                <p>No executions yet</p>
                <p class="empty-hint">Click "New Execution" to run a simulation</p>
            </div>
        `;
        return;
    }

    const sorted = getSortedExecutions();
    container.innerHTML = '<div class="execution-list">' +
        sorted.map((exec, i) => renderExecutionItem(exec, allExecutions.length - allExecutions.indexOf(exec))).join('') +
        '</div>';

    // Attach delete button event listeners
    container.querySelectorAll('.delete-exec-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const execId = btn.dataset.execId;
            if (!confirm('この実行履歴を削除しますか？')) return;
            try {
                await ExecutorAPI.deleteExecution(execId);
                allExecutions = allExecutions.filter(e => e.id !== execId);
                renderExecutions();
            } catch (err) {
                alert('削除に失敗しました: ' + err.message);
            }
        });
    });
}

function renderExecutionItem(exec, number) {
    const statusClass = `status-${escapeHtml(exec.status)}`;
    const statusLabel = escapeHtml({
        'completed': 'Completed',
        'running': 'Running',
        'error': 'Error',
        'pending': 'Pending'
    }[exec.status] || exec.status);

    const startTime = formatDateTime(exec.startTime);
    const endInfo = exec.endConditionType === 'duration'
        ? `${exec.endConditionValue} min`
        : formatDateTime(exec.endConditionValue);
    const createdAt = formatDateTime(exec.createdAt);

    let errorHtml = '';
    if (exec.status === 'error' && exec.errorMessage) {
        let displayError = exec.errorMessage;
        try {
            const parsed = JSON.parse(exec.errorMessage);
            displayError = parsed.message || exec.errorMessage;
        } catch (_) {}
        errorHtml = `<div class="error-message" style="margin-top: 0.5rem; font-size: 0.8rem">${escapeHtml(displayError)}</div>`;
    }

    let actions = '';
    if (exec.status === 'completed' && exec.simulationId) {
        const vizParam = exec.dataSourceId
            ? `ds=${encodeURIComponent(exec.dataSourceId)}`
            : `ds=${encodeURIComponent(exec.simulationId)}`;
        actions = `
            <a href="/visualizer/?${vizParam}" target="_blank" class="btn btn-outline btn-sm">View in sim-visualizer</a>
            <a href="execution.html?scenarioId=${encodeURIComponent(currentScenarioId)}&rerun=${encodeURIComponent(exec.id)}" class="btn btn-outline btn-sm">Re-run</a>
        `;
    } else if (exec.status === 'error') {
        actions = `
            <a href="execution.html?scenarioId=${encodeURIComponent(currentScenarioId)}&rerun=${encodeURIComponent(exec.id)}" class="btn btn-outline btn-sm">Retry</a>
        `;
    }

    actions += `<button class="btn btn-danger btn-sm delete-exec-btn" data-exec-id="${escapeHtml(exec.id)}">Delete</button>`;

    return `
        <div class="execution-item">
            <div class="execution-header">
                <span class="execution-title">#${number} ${startTime} (${endInfo})</span>
                <span class="status-badge ${statusClass}">${statusLabel}</span>
            </div>
            <div class="execution-meta">Created: ${createdAt}</div>
            ${errorHtml}
            <div class="execution-actions">${actions}</div>
        </div>
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
