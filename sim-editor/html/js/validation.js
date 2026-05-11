// Validation utilities

export function validateScenario(scenario) {
    const errors = [];
    const warnings = [];

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
            // Entry/Exit inside SubScenario: warn, don't error
            if (station.type === 'entry' || station.type === 'exit') {
                warnings.push(`${station.id} (${station.type})が接続されていません`);
            } else {
                errors.push(`${station.id}が接続されていません`);
            }
        }
    });

    // Validate ModulerStation SubScenarios recursively
    scenario.stations.forEach(station => {
        if (station.type === 'moduler' && station.config.subScenario) {
            const sub = station.config.subScenario;
            const subScenario = {
                stations: sub.stations || [],
                connections: sub.connections || []
            };
            // Check cycle detection inside SubScenario
            const subGraph = new Map();
            subScenario.stations.forEach(s => subGraph.set(s.id, []));
            subScenario.connections.forEach(c => {
                if (subGraph.has(c.from)) subGraph.get(c.from).push(c.to);
            });
            const subVisited = new Set();
            const subRecStack = new Set();
            for (const sid of subScenario.stations.map(s => s.id)) {
                if (hasCycleAdvanced(sid, subGraph, subVisited, subRecStack)) {
                    errors.push(`${station.id}: SubScenario内で循環接続が検出されました`);
                    break;
                }
            }
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

    // Check location_id when SimDB is configured (warnings, not errors)
    if (scenario.simdbConfig && scenario.simdbConfig.host) {
        scenario.stations.forEach(station => {
            if (!station.locationId) {
                warnings.push(`${station.id}: locationIdが未設定です（SimDB接続テスト後に設定できます）`);
            }
        });

        const locationIds = scenario.stations
            .filter(s => s.locationId)
            .map(s => ({ stationId: s.id, locationId: s.locationId }));
        const seen = new Map();
        locationIds.forEach(({ stationId, locationId }) => {
            if (seen.has(locationId)) {
                seen.get(locationId).push(stationId);
            } else {
                seen.set(locationId, [stationId]);
            }
        });
        for (const [locId, stationIds] of seen) {
            if (stationIds.length > 1) {
                errors.push(`locationId ${locId} が重複しています: ${stationIds.join(', ')}`);
            }
        }
    }

    // Validate interlockRules if present
    scenario.stations.forEach(station => {
        if (station.config.interlockRules) {
            const ilErrors = validateInterlockRules(station, scenario);
            ilErrors.errors.forEach(e => errors.push(`${station.id}: ${e}`));
            ilErrors.warnings.forEach(w => warnings.push(`${station.id}: ${w}`));
        }
    });

    // Check for invalid branching/merging patterns
    scenario.stations.forEach(station => {
        const stationType = station.type;

        // Skip entry/exit (they're inside SubScenarios only)
        if (stationType === 'entry' || stationType === 'exit') return;

        // Count outgoing connections (分岐チェック)
        const outgoingCount = scenario.connections.filter(c => c.from === station.id).length;

        // Count incoming connections (合流チェック)
        const incomingCount = scenario.connections.filter(c => c.to === station.id).length;

        // Source, Processing, Merge can only have 1 outgoing connection (Split/Moduler/Switch-divert can have multiple)
        if ((stationType === 'source' || stationType === 'processing' || stationType === 'merge') && outgoingCount > 1) {
            errors.push(`${station.id} (${stationType}): 複数のステーションへの分岐は許可されていません（接続数: ${outgoingCount}）`);
        }
        // Switch divert: 1 outgoing only limitation check (body has 1 in, N out - all N out via regular connections)
        if (stationType === 'switch' && station.config?.direction === 'merge' && outgoingCount > 1) {
            errors.push(`${station.id} (switch/merge): 出力接続は1つのみ許可されます（接続数: ${outgoingCount}）`);
        }

        // Processing, Drain, Split can only have 1 incoming connection (Merge/Moduler/Switch-merge can have multiple)
        if ((stationType === 'processing' || stationType === 'drain' || stationType === 'split') && incomingCount > 1) {
            errors.push(`${station.id} (${stationType}): 複数のステーションからの合流は許可されていません（接続数: ${incomingCount}）`);
        }
        // Switch merge: N incoming allowed; switch divert: 1 incoming only
        if (stationType === 'switch' && station.config?.direction === 'divert' && incomingCount > 1) {
            errors.push(`${station.id} (switch/divert): 入力接続は1つのみ許可されます（接続数: ${incomingCount}）`);
        }

        // Source should not have incoming connections
        if (stationType === 'source' && incomingCount > 0) {
            errors.push(`${station.id} (source): Sourceステーションへの入力接続は許可されていません`);
        }

        // Drain should not have outgoing connections
        if (stationType === 'drain' && outgoingCount > 0) {
            errors.push(`${station.id} (drain): Drainステーションからの出力接続は許可されていません`);
        }
    });

    return { errors, warnings };
}

export function validateStation(station) {
    const errors = {};
    const config = station.config;

    if (station.type === 'source') {
        if (!config.continuous && (!config.workCount || config.workCount < 1)) {
            errors.workCount = 'workCountは1以上である必要があります（またはContinuousをONにしてください）';
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
    } else if (station.type === 'merge') {
        if (config.processingTime != null && config.processingTime < 0) {
            errors.processingTime = 'processingTimeは0以上である必要があります';
        }
        if (!config.arrivalTime || config.arrivalTime <= 0) {
            errors.arrivalTime = 'arrivalTimeは0より大きい必要があります';
        }
        if (!config.departureTime || config.departureTime <= 0) {
            errors.departureTime = 'departureTimeは0より大きい必要があります';
        }
        if (!config.outputWorkType) {
            errors.outputWorkType = 'outputWorkTypeは必須です';
        }
        if (!config.mergeCount || config.mergeCount < 1) {
            errors.mergeCount = 'mergeCountは1以上である必要があります';
        }
        const inPorts = config.inPorts || config.ports || [];
        if (inPorts.length === 0) {
            errors.ports = '入力ポートは1つ以上必要です';
        } else if (inPorts.length !== (config.mergeCount || 0)) {
            errors.ports = `入力ポート数(${inPorts.length})がmergeCount(${config.mergeCount})と一致しません`;
        } else {
            inPorts.forEach((buf, i) => {
                if (!buf.capacity || buf.capacity < 1) errors[`port_${i}_capacity`] = `ポート${i+1}のcapacityは1以上必要です`;
            });
        }
    } else if (station.type === 'split') {
        if (config.processingTime != null && config.processingTime < 0) {
            errors.processingTime = 'processingTimeは0以上である必要があります';
        }
        if (!config.arrivalTime || config.arrivalTime <= 0) {
            errors.arrivalTime = 'arrivalTimeは0より大きい必要があります';
        }
        if (!config.departureTime || config.departureTime <= 0) {
            errors.departureTime = 'departureTimeは0より大きい必要があります';
        }
        if (!config.splitCount || config.splitCount < 1) {
            errors.splitCount = 'splitCountは1以上である必要があります';
        }
        const outPorts = config.outPorts || config.ports || [];
        if (outPorts.length === 0) {
            errors.ports = '出力ポートは1つ以上必要です';
        } else if (outPorts.length !== (config.splitCount || 0)) {
            errors.ports = `出力ポート数(${outPorts.length})がsplitCount(${config.splitCount})と一致しません`;
        }
    } else if (station.type === 'switch') {
        if (!config.direction || (config.direction !== 'merge' && config.direction !== 'divert')) {
            errors.direction = 'direction は "merge" または "divert" を指定してください';
        }
        if (!config.portCount || config.portCount < 2) {
            errors.portCount = 'portCount は 2 以上である必要があります';
        }
        if (!config.arrivalTime || config.arrivalTime <= 0) {
            errors.arrivalTime = 'arrivalTime は 0 より大きい必要があります';
        }
        if (!config.departureTime || config.departureTime <= 0) {
            errors.departureTime = 'departureTime は 0 より大きい必要があります';
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

export function validateInterlockRules(station, scenario) {
    const errors = [];
    const warnings = [];
    const config = station.config.interlockRules;

    if (!config || !config.rules) return { errors, warnings };

    const signalNames = new Set((config.signals || []).map(s => s.name));

    for (const rule of config.rules) {
        if (!rule.target) {
            errors.push('ルールのターゲットが未指定です');
        }
        for (const cond of (rule.conditions || [])) {
            if (!signalNames.has(cond.signal)) {
                errors.push(`信号 '${cond.signal}' は定義されていません`);
            }
            if (cond.stationId) {
                const exists = scenario.stations.some(s => s.id === cond.stationId);
                if (!exists) {
                    errors.push(`ステーション '${cond.stationId}' は存在しません`);
                }
            }
        }
    }

    // Check main signal rules
    const irOn = config.rules.find(r => r.target === 'inputReady' && r.value === true);
    const irOff = config.rules.find(r => r.target === 'inputReady' && r.value === false);
    const orOn = config.rules.find(r => r.target === 'outputReady' && r.value === true);
    const orOff = config.rules.find(r => r.target === 'outputReady' && r.value === false);

    if (!irOn || (irOn.conditions || []).length === 0) {
        warnings.push('搬入可がONになる条件がありません');
    }
    if (!orOn || (orOn.conditions || []).length === 0) {
        warnings.push('搬出可がONになる条件がありません');
    }

    // Check processReady ON rule for processing/split stations
    if (station.type === 'processing' || station.type === 'split') {
        const hasPR = config.rules.some(r => r.target === 'processReady' && r.value === true && (r.conditions || []).length > 0);
        if (!hasPR) {
            warnings.push('加工準備ON (processReady) のルールがありません');
        }
    }

    return { errors, warnings };
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
