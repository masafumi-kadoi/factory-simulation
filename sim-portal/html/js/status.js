// System status page logic

const SERVICE_DISPLAY = {
    'realtime-gateway': { label: 'Realtime Gateway (API)', icon: '\u2699\uFE0F' },
    'sim-factory-manager': { label: 'Factory Manager (Frontend)', icon: '\uD83C\uDFED' },
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-refresh').addEventListener('click', checkServices);
    checkServices();
});

async function checkServices() {
    const container = document.getElementById('services-container');
    const btn = document.getElementById('btn-refresh');

    btn.disabled = true;
    btn.textContent = 'Checking...';

    // Show checking state
    container.innerHTML = Object.entries(SERVICE_DISPLAY).map(([name, info]) => `
        <div class="service-card">
            <span class="service-indicator checking"></span>
            <div>
                <div class="service-name">${info.icon} ${info.label}</div>
                <div class="service-url">Checking...</div>
            </div>
            <span class="service-status-text text-muted">...</span>
        </div>
    `).join('');

    try {
        const results = await PortalAPI.checkAllServices();

        container.innerHTML = results.map(svc => {
            const display = SERVICE_DISPLAY[svc.name] || { label: escapeHtml(svc.name), icon: '' };
            const indicatorClass = svc.status === 'up' ? 'up' : svc.status === 'unknown' ? 'unknown' : 'down';
            const statusText = svc.status === 'up' ? 'Online'
                : svc.status === 'unknown' ? 'Unknown'
                : 'Offline';
            const statusColor = svc.status === 'up' ? '#28a745'
                : svc.status === 'unknown' ? '#ffc107'
                : '#dc3545';
            const urlText = svc.url ? escapeHtml(svc.url) : '(not directly checkable)';

            return `
                <div class="service-card">
                    <span class="service-indicator ${indicatorClass}"></span>
                    <div>
                        <div class="service-name">${display.icon} ${display.label}</div>
                        <div class="service-url">${urlText}</div>
                    </div>
                    <span class="service-status-text" style="color: ${statusColor}">${statusText}</span>
                </div>
            `;
        }).join('');
    } catch (err) {
        container.innerHTML = `<div class="error-message">Failed to check services: ${escapeHtml(err.message)}</div>`;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Refresh';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
