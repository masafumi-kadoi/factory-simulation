// sim-executor API client

const API_BASE = '/api/executor';

const ExecutorAPI = {
    // Get executions for a scenario
    async getExecutions(scenarioId) {
        const resp = await fetch(`${API_BASE}/executions?scenarioId=${encodeURIComponent(scenarioId)}`);
        if (!resp.ok) throw new Error(`Failed to get executions: ${resp.statusText}`);
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
};
