// API client - unified gateway at /api/
const API_BASE = '/api';

// --- Legacy simulation endpoints (backward compat) ---

export async function fetchSimulation(simulationId) {
    const res = await fetch(`${API_BASE}/simulations/${simulationId}`);
    if (!res.ok) throw new Error(`Failed to fetch simulation: ${res.statusText}`);
    return res.json();
}

export async function fetchScenario(scenarioId) {
    const res = await fetch(`${API_BASE}/scenarios/${scenarioId}`);
    if (!res.ok) throw new Error(`Failed to fetch scenario: ${res.statusText}`);
    return res.json();
}

export async function fetchLogs(simulationId) {
    const res = await fetch(`${API_BASE}/simulations/${simulationId}/logs`);
    if (!res.ok) throw new Error(`Failed to fetch logs: ${res.statusText}`);
    return res.json();
}

// --- New WDH data source endpoints ---

export async function fetchDataSources() {
    const res = await fetch(`${API_BASE}/data-sources`);
    if (!res.ok) throw new Error(`Failed to fetch data sources: ${res.statusText}`);
    return res.json();
}

export async function fetchDataSource(id) {
    const res = await fetch(`${API_BASE}/data-sources/${id}`);
    if (!res.ok) throw new Error(`Failed to fetch data source: ${res.statusText}`);
    return res.json();
}

export async function fetchLayout(dataSourceId) {
    const res = await fetch(`${API_BASE}/data-sources/${dataSourceId}/layout`);
    if (!res.ok) throw new Error(`Failed to fetch layout: ${res.statusText}`);
    return res.json();
}

export async function fetchEvents(dataSourceId, from, to) {
    const params = new URLSearchParams();
    if (from) params.set('from', from instanceof Date ? from.toISOString() : from);
    if (to) params.set('to', to instanceof Date ? to.toISOString() : to);
    const res = await fetch(`${API_BASE}/data-sources/${dataSourceId}/events?${params}`);
    if (!res.ok) throw new Error(`Failed to fetch events: ${res.statusText}`);
    return res.json();
}

export async function fetchExecutions() {
    const res = await fetch(`${API_BASE}/executions`);
    if (!res.ok) throw new Error(`Failed to fetch executions: ${res.statusText}`);
    return res.json();
}
