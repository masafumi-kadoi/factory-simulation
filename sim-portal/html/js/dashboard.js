// Dashboard page logic

const TOOLS = [
    {
        name: 'sim-editor',
        icon: '\u270F\uFE0F',
        title: 'Scenario Editor',
        desc: 'Create and edit factory simulation scenarios with a visual editor.',
        url: SERVICE_URLS['sim-editor'],
        status: 'online'
    },
    {
        name: 'sim-executor',
        icon: '\u25B6\uFE0F',
        title: 'Simulation Executor',
        desc: 'Execute simulations with initial conditions from SimDB.',
        url: SERVICE_URLS['sim-executor'],
        status: 'online'
    },
    {
        name: 'sim-visualizer',
        icon: '\uD83D\uDCCA',
        title: 'Result Visualizer',
        desc: 'Visualize simulation results with 3D timeline view.',
        url: SERVICE_URLS['sim-visualizer'],
        status: 'online'
    },
    {
        name: 'sim-explorer',
        icon: '\uD83D\uDD0D',
        title: 'Parameter Explorer',
        desc: 'Sweep static parameters and explore optimization space.',
        url: null,
        status: 'coming-soon'
    }
];

document.addEventListener('DOMContentLoaded', () => {
    renderToolCards();
    loadStats();
    loadRecentExecutions();
});

function renderToolCards() {
    const container = document.getElementById('tools-container');
    container.innerHTML = TOOLS.map(tool => {
        if (tool.url) {
            return `
                <a href="${tool.url}" target="_blank" class="tool-card">
                    <div class="tool-card-icon">${tool.icon}</div>
                    <div class="tool-card-title">${escapeHtml(tool.title)}</div>
                    <div class="tool-card-desc">${escapeHtml(tool.desc)}</div>
                    <span class="tool-card-status online">Online</span>
                </a>
            `;
        } else {
            return `
                <div class="tool-card disabled">
                    <div class="tool-card-icon">${tool.icon}</div>
                    <div class="tool-card-title">${escapeHtml(tool.title)}</div>
                    <div class="tool-card-desc">${escapeHtml(tool.desc)}</div>
                    <span class="tool-card-status coming-soon">Coming Soon</span>
                </div>
            `;
        }
    }).join('');
}

async function loadStats() {
    try {
        const data = await PortalAPI.getScenarios();
        const scenarios = data.scenarios || [];
        const totalExecutions = scenarios.reduce((sum, s) => sum + (s.executionCount || 0), 0);

        document.getElementById('stat-scenarios').textContent = scenarios.length;
        document.getElementById('stat-executions').textContent = totalExecutions;
    } catch (err) {
        document.getElementById('stat-scenarios').textContent = '?';
        document.getElementById('stat-executions').textContent = '?';
    }

    // Service count
    try {
        const services = await PortalAPI.checkAllServices();
        const onlineCount = services.filter(s => s.status === 'up').length;
        document.getElementById('stat-services').textContent = `${onlineCount}/${services.length}`;
    } catch {
        document.getElementById('stat-services').textContent = '?';
    }
}

async function loadRecentExecutions() {
    const container = document.getElementById('recent-container');

    try {
        const data = await PortalAPI.getScenarios();
        const scenarios = data.scenarios || [];

        if (scenarios.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">\uD83D\uDCCB</div>
                    <p>No scenarios yet</p>
                    <p class="text-muted">Create a scenario in sim-editor to get started</p>
                </div>
            `;
            return;
        }

        // Fetch executions for all scenarios in parallel
        const executionResults = await Promise.all(
            scenarios.map(async (s) => {
                try {
                    const execData = await PortalAPI.getExecutions(s.scenarioId);
                    return (execData.executions || []).map(e => ({ ...e, scenarioName: s.name }));
                } catch {
                    return [];
                }
            })
        );

        const allExecutions = executionResults.flat();
        allExecutions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const recent = allExecutions.slice(0, 5);

        if (recent.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">\u23F3</div>
                    <p>No executions yet</p>
                    <p class="text-muted">Run a simulation in sim-executor</p>
                </div>
            `;
            return;
        }

        container.innerHTML = '<div class="recent-list">' +
            recent.map(exec => {
                const statusClass = `status-${exec.status}`;
                const time = formatDateTime(exec.createdAt);
                const viewLink = exec.status === 'completed' && exec.simulationId
                    ? `<a href="${SERVICE_URLS['sim-visualizer']}/?simulationId=${encodeURIComponent(exec.simulationId)}" target="_blank" class="btn btn-outline btn-sm">View</a>`
                    : '';

                return `
                    <div class="recent-item">
                        <span class="recent-scenario">${escapeHtml(exec.scenarioName)}</span>
                        <span class="status-badge ${statusClass}">${exec.status}</span>
                        <span class="recent-time">${time}</span>
                        <span class="recent-actions">${viewLink}</span>
                    </div>
                `;
            }).join('') +
            '</div>';
    } catch (err) {
        container.innerHTML = `<div class="error-message">Failed to load executions: ${escapeHtml(err.message)}</div>`;
    }
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
