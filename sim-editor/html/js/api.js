// API Client
const API_BASE = 'http://localhost:8080/api';
const EXECUTOR_API_BASE = 'http://localhost:8084/api/executor';

export class APIClient {
    constructor() {
        this.baseURL = API_BASE;
        this.executorBaseURL = EXECUTOR_API_BASE;
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;

        const config = {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        };

        try {
            const response = await fetch(url, config);

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || `HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }

    // Scenario APIs
    async listScenarios() {
        return this.request('/scenarios', { method: 'GET' });
    }

    async getScenario(scenarioId) {
        return this.request(`/scenarios/${scenarioId}`, { method: 'GET' });
    }

    async createScenario(scenarioData) {
        return this.request('/scenarios', {
            method: 'POST',
            body: JSON.stringify(scenarioData),
        });
    }

    async updateScenario(scenarioId, scenarioData) {
        return this.request(`/scenarios/${scenarioId}`, {
            method: 'PUT',
            body: JSON.stringify(scenarioData),
        });
    }

    async deleteScenario(scenarioId) {
        return this.request(`/scenarios/${scenarioId}`, {
            method: 'DELETE',
        });
    }

    // Simulation APIs
    async runSimulation(simulationRequest) {
        return this.request('/simulations', {
            method: 'POST',
            body: JSON.stringify(simulationRequest),
        });
    }

    async getSimulation(simulationId) {
        return this.request(`/simulations/${simulationId}`, { method: 'GET' });
    }

    async getSimulationLogs(simulationId) {
        return this.request(`/simulations/${simulationId}/logs`, { method: 'GET' });
    }

    // SimDB APIs (via sim-executor backend)
    async testSimDBConnection(scenarioId) {
        const url = `${this.executorBaseURL}/simdb/test-connection`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scenarioId }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || `HTTP error! status: ${response.status}`);
        }

        return await response.json();
    }
}

// Export singleton instance
export const apiClient = new APIClient();
