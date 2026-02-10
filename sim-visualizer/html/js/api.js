// API client for factory simulation backend

// Use API server on port 8080
const API_BASE = 'http://localhost:8080/api';

export async function fetchSimulation(simulationId) {
    const response = await fetch(`${API_BASE}/simulations/${simulationId}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch simulation: ${response.statusText}`);
    }
    return response.json();
}

export async function fetchScenario(scenarioId) {
    const response = await fetch(`${API_BASE}/scenarios/${scenarioId}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch scenario: ${response.statusText}`);
    }
    return response.json();
}

export async function fetchLogs(simulationId) {
    const response = await fetch(`${API_BASE}/simulations/${simulationId}/logs`);
    if (!response.ok) {
        throw new Error(`Failed to fetch logs: ${response.statusText}`);
    }
    return response.json();
}
