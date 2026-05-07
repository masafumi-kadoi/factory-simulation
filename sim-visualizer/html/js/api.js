// API client - unified gateway at /api/
const API_BASE = '/api';

async function _checkOk(res, label) {
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`${label}: ${res.status} ${res.statusText}${body ? ' — ' + body.substring(0, 200) : ''}`);
    }
    return res;
}

async function _fetchWithRetry(url, label, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url);
            await _checkOk(res, label);
            return res.json();
        } catch (err) {
            if (i === retries) throw err;
            await new Promise(r => setTimeout(r, 500 * (i + 1)));
        }
    }
}

// --- Legacy simulation endpoints (backward compat) ---

export async function fetchSimulation(simulationId) {
    return _fetchWithRetry(`${API_BASE}/simulations/${simulationId}`, 'fetchSimulation');
}

export async function fetchScenario(scenarioId) {
    return _fetchWithRetry(`${API_BASE}/scenarios/${scenarioId}`, 'fetchScenario');
}

export async function fetchLogs(simulationId) {
    return _fetchWithRetry(`${API_BASE}/simulations/${simulationId}/logs`, 'fetchLogs');
}

// --- New WDH data source endpoints ---

export async function fetchDataSources() {
    return _fetchWithRetry(`${API_BASE}/data-sources`, 'fetchDataSources');
}

export async function fetchDataSource(id) {
    return _fetchWithRetry(`${API_BASE}/data-sources/${id}`, 'fetchDataSource');
}

export async function fetchLayout(dataSourceId) {
    return _fetchWithRetry(`${API_BASE}/data-sources/${dataSourceId}/layout`, 'fetchLayout');
}

export async function fetchEvents(dataSourceId, from, to) {
    const params = new URLSearchParams();
    if (from) params.set('from', from instanceof Date ? from.toISOString() : String(from));
    if (to) params.set('to', to instanceof Date ? to.toISOString() : String(to));
    return _fetchWithRetry(
        `${API_BASE}/data-sources/${dataSourceId}/events?${params}`,
        'fetchEvents'
    );
}

export async function fetchExecutions() {
    return _fetchWithRetry(`${API_BASE}/executions`, 'fetchExecutions');
}
