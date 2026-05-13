// Dashboard page logic

const TOOLS = [
    {
        name: 'sim-factory-manager',
        icon: '\uD83C\uDFED',
        title: 'Factory Manager',
        desc: 'Manage factory layouts, stations, and live monitoring sessions.',
        url: SERVICE_URLS['sim-factory-manager'],
        status: 'online'
    },
    {
        name: 'sim-editor',
        icon: '\u270F\uFE0F',
        title: 'Scenario Editor',
        desc: 'Create and edit factory simulation scenarios with a visual editor.',
        url: SERVICE_URLS['sim-editor'],
        status: 'online'
    },
    {
        name: 'factory-visualizer',
        icon: '\u25B6\uFE0F',
        title: 'Factory Visualizer',
        desc: 'Visualize and manage factories in 3D. Run simulations with initial conditions from SimDB.',
        url: SERVICE_URLS['factory-visualizer'],
        status: 'online'
    },
    {
        name: 'sim-visualizer',
        icon: '\uD83D\uDCCA',
        title: 'Result Visualizer',
        desc: 'Visualize simulation results and live factory data.',
        url: SERVICE_URLS['sim-visualizer'] + '/index-list.html',
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
        const [factoriesData, execsData] = await Promise.all([
            PortalAPI.getFactories().catch(() => ({ factories: [] })),
            PortalAPI.getExecutions().catch(() => [])
        ]);
        const factories = factoriesData.factories || [];
        const execs = Array.isArray(execsData) ? execsData : [];

        document.getElementById('stat-scenarios').textContent = factories.length;
        document.getElementById('stat-executions').textContent = execs.length;
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
        const execsData = await PortalAPI.getExecutions();
        const allExecutions = Array.isArray(execsData) ? execsData : [];

        if (allExecutions.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">\u23F3</div>
                    <p>No executions yet</p>
                    <p class="text-muted">Run a simulation in Factory Visualizer</p>
                </div>
            `;
            return;
        }

        allExecutions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const recent = allExecutions.slice(0, 5);

        container.innerHTML = '<div class="recent-list">' +
            recent.map(exec => {
                const statusClass = `status-${escapeHtml(exec.status || 'unknown')}`;
                const time = formatDateTime(exec.createdAt);
                const dsId = exec.dataSourceId;
                const label = exec.factoryId ? `Factory: ${escapeHtml(exec.factoryId.substring(0, 8))}` : escapeHtml(exec.scenarioId || '-');
                const viewLink = exec.status === 'completed' && dsId
                    ? `<a href="${SERVICE_URLS['sim-visualizer']}/?ds=${encodeURIComponent(dsId)}" target="_blank" class="btn btn-outline btn-sm">View</a>`
                    : '';

                return `
                    <div class="recent-item">
                        <span class="recent-scenario">${label}</span>
                        <span class="status-badge ${statusClass}">${escapeHtml(exec.status || 'unknown')}</span>
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
