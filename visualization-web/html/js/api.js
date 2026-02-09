// API client for simulation-core backend

const API_BASE = '/api';

// Fetch all simulations
async function fetchSimulations() {
    try {
        const response = await fetch(`${API_BASE}/simulations`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Failed to fetch simulations:', error);
        alert('Failed to load simulations. Please check if the backend is running.');
        throw error;
    }
}

// Fetch a single simulation
async function fetchSimulation(id) {
    try {
        const response = await fetch(`${API_BASE}/simulations/${id}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Failed to fetch simulation ${id}:`, error);
        alert(`Failed to load simulation. Please check if simulation ID '${id}' exists.`);
        throw error;
    }
}

// Fetch scenario details
async function fetchScenario(id) {
    try {
        const response = await fetch(`${API_BASE}/scenarios/${id}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Failed to fetch scenario ${id}:`, error);
        alert(`Failed to load scenario. Please check if scenario ID '${id}' exists.`);
        throw error;
    }
}

// Fetch simulation logs
async function fetchLogs(id) {
    try {
        const response = await fetch(`${API_BASE}/simulations/${id}/logs`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Failed to fetch logs for simulation ${id}:`, error);
        alert(`Failed to load simulation logs.`);
        throw error;
    }
}

// Fetch work lineage
async function fetchLineage(id) {
    try {
        const response = await fetch(`${API_BASE}/simulations/${id}/lineage`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Failed to fetch lineage for simulation ${id}:`, error);
        alert(`Failed to load work lineage.`);
        throw error;
    }
}
