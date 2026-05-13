// Portal API Client
// All API calls go through the reverse proxy (same origin)

const SIMULATION_CORE_URL = '/api';

const SERVICE_URLS = {
    'sim-editor': '/editor',
    'factory-visualizer': '/factory-visualizer',
    'sim-visualizer': '/visualizer',
    'sim-factory-manager': '/factory',
};

const HEALTH_CHECK_TIMEOUT = 3000;

const PortalAPI = {
    // --- Factory APIs ---

    async getFactories() {
        const response = await fetch(`${SIMULATION_CORE_URL}/factories`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    },

    // --- Execution APIs ---

    async getExecutions() {
        const response = await fetch(`${SIMULATION_CORE_URL}/executions`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    },

    // --- Health Check ---

    async checkHealth(url) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);

        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            return { status: response.ok ? 'up' : 'down' };
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                return { status: 'down', reason: 'timeout' };
            }
            return { status: 'down', reason: err.message };
        }
    },

    async checkAllServices() {
        const services = [
            { name: 'realtime-gateway', url: '/api/data-sources', port: null },
            { name: 'sim-factory-manager', url: '/factory/', port: null },
            { name: 'sim-editor', url: '/editor/', port: null },
            { name: 'factory-visualizer', url: '/factory-visualizer/', port: null },
            { name: 'sim-visualizer', url: '/visualizer/', port: null },
        ];

        const results = await Promise.all(
            services.map(async (svc) => {
                if (!svc.url) {
                    // Can't directly check DB from browser
                    return { ...svc, status: 'unknown', reason: 'Not checkable from browser' };
                }
                const health = await PortalAPI.checkHealth(svc.url);
                return { ...svc, ...health };
            })
        );

        return results;
    }
};
