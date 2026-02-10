// Validation utilities

export function validateScenario(scenario) {
    const errors = [];

    // Check if there's at least one source
    const sources = scenario.stations.filter(s => s.type === 'source');
    if (sources.length === 0) {
        errors.push('少なくとも1つのSourceステーションが必要です');
    }

    // Check if there's at least one drain
    const drains = scenario.stations.filter(s => s.type === 'drain');
    if (drains.length === 0) {
        errors.push('少なくとも1つのDrainステーションが必要です');
    }

    // Check each station
    scenario.stations.forEach(station => {
        const stationErrors = validateStation(station);
        Object.entries(stationErrors).forEach(([key, error]) => {
            errors.push(`${station.id}: ${error}`);
        });
    });

    // Check for disconnected stations
    const connectedStations = new Set();
    scenario.connections.forEach(conn => {
        connectedStations.add(conn.from);
        connectedStations.add(conn.to);
    });

    scenario.stations.forEach(station => {
        if (!connectedStations.has(station.id)) {
            errors.push(`${station.id}が接続されていません`);
        }
    });

    // Check for circular references (simple check)
    const graph = new Map();
    scenario.stations.forEach(s => graph.set(s.id, []));
    scenario.connections.forEach(c => {
        if (graph.has(c.from)) {
            graph.get(c.from).push(c.to);
        }
    });

    // Check for cycles using DFS
    const visited = new Set();
    const recStack = new Set();

    for (const stationId of scenario.stations.map(s => s.id)) {
        if (hasCycleAdvanced(stationId, graph, visited, recStack)) {
            errors.push('循環参照が検出されました');
            break;
        }
    }

    // Check for interlock warnings (Phase 2 enhancement)
    const interlockWarnings = checkInterlockWarnings(scenario);
    errors.push(...interlockWarnings);

    return errors;
}

export function validateStation(station) {
    const errors = {};
    const config = station.config;

    if (station.type === 'source') {
        if (!config.workCount || config.workCount < 1) {
            errors.workCount = 'workCountは1以上である必要があります';
        }
        if (!config.departureTime || config.departureTime <= 0) {
            errors.departureTime = 'departureTimeは0より大きい必要があります';
        }
    } else if (station.type === 'processing') {
        if (!config.processingTime || config.processingTime <= 0) {
            errors.processingTime = 'processingTimeは0より大きい必要があります';
        }
        if (!config.arrivalTime || config.arrivalTime <= 0) {
            errors.arrivalTime = 'arrivalTimeは0より大きい必要があります';
        }
        if (!config.departureTime || config.departureTime <= 0) {
            errors.departureTime = 'departureTimeは0より大きい必要があります';
        }
    } else if (station.type === 'drain') {
        if (!config.arrivalTime || config.arrivalTime <= 0) {
            errors.arrivalTime = 'arrivalTimeは0より大きい必要があります';
        }
    }

    return errors;
}

function hasCycle(nodeId, graph, visited) {
    if (visited.has(nodeId)) {
        return true;
    }

    visited.add(nodeId);
    const neighbors = graph.get(nodeId) || [];

    for (const neighbor of neighbors) {
        if (hasCycle(neighbor, graph, new Set(visited))) {
            return true;
        }
    }

    return false;
}

function hasCycleAdvanced(nodeId, graph, visited, recStack) {
    if (recStack.has(nodeId)) {
        return true; // Cycle detected
    }

    if (visited.has(nodeId)) {
        return false; // Already processed
    }

    visited.add(nodeId);
    recStack.add(nodeId);

    const neighbors = graph.get(nodeId) || [];
    for (const neighbor of neighbors) {
        if (hasCycleAdvanced(neighbor, graph, visited, recStack)) {
            return true;
        }
    }

    recStack.delete(nodeId);
    return false;
}

function checkInterlockWarnings(scenario) {
    const warnings = [];

    scenario.stations.forEach(station => {
        if (station.type === 'processing') {
            const config = station.config;
            const processingTime = config.processingTime || 0;
            const arrivalTime = config.arrivalTime || 0;
            const departureTime = config.departureTime || 0;

            // Check if departureTime is sufficient
            // departureTime should ideally be >= processingTime to avoid interlock
            if (departureTime < processingTime) {
                warnings.push(
                    `⚠️ ${station.id}: departureTime (${departureTime}s) < processingTime (${processingTime}s). インターロックの可能性があります。推奨値: ${processingTime}s以上`
                );
            }

            // Check if times are reasonable
            if (arrivalTime <= 0 || departureTime <= 0) {
                warnings.push(`⚠️ ${station.id}: arrivalTimeとdepartureTimeは0より大きくする必要があります`);
            }
        }
    });

    return warnings;
}
