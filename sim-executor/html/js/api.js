// sim-executor API client

const API_BASE = 'http://localhost:8084/api/executor';
const CORE_API_BASE = 'http://localhost:8080/api';

const ExecutorAPI = {
    // Get scenario detail (stations, connections) from simulation-core
    async getScenarioDetail(scenarioId) {
        const resp = await fetch(`${CORE_API_BASE}/scenarios/${encodeURIComponent(scenarioId)}`);
        if (!resp.ok) throw new Error(`Failed to get scenario detail: ${resp.statusText}`);
        return resp.json();
    },

    // Get scenarios list (with execution count)
    async getScenarios() {
        const resp = await fetch(`${API_BASE}/scenarios`);
        if (!resp.ok) throw new Error(`Failed to get scenarios: ${resp.statusText}`);
        return resp.json();
    },

    // Get executions for a scenario
    async getExecutions(scenarioId) {
        const resp = await fetch(`${API_BASE}/executions?scenarioId=${encodeURIComponent(scenarioId)}`);
        if (!resp.ok) throw new Error(`Failed to get executions: ${resp.statusText}`);
        return resp.json();
    },

    // Get initial conditions from SimDB
    async getInitialConditions(scenarioId, startTime) {
        const resp = await fetch(`${API_BASE}/initial-conditions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scenarioId, startTime })
        });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.error || `Failed to get initial conditions: ${resp.statusText}`);
        }
        return resp.json();
    },

    // Execute simulation
    async execute(scenarioId, startTime, endCondition, initialConditions) {
        const resp = await fetch(`${API_BASE}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scenarioId, startTime, endCondition, initialConditions })
        });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.error || `Failed to execute simulation: ${resp.statusText}`);
        }
        return resp.json();
    },

    // Delete an execution
    async deleteExecution(executionId) {
        const resp = await fetch(`${API_BASE}/executions/${encodeURIComponent(executionId)}`, {
            method: 'DELETE'
        });
        if (!resp.ok) throw new Error(`Failed to delete execution: ${resp.statusText}`);
        return resp.json();
    },

    // Test SimDB connection
    async testSimDBConnection(scenarioId) {
        const resp = await fetch(`${API_BASE}/simdb/test-connection`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scenarioId })
        });
        if (!resp.ok) throw new Error(`Failed to test connection: ${resp.statusText}`);
        return resp.json();
    }
};
