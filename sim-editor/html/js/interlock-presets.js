// Interlock Presets — signal and rule definitions for each station type (10-signal model)

// Signal display names
// Note: workType:<type> signals are generated dynamically and displayed as "ワーク種類: <type>"
export const SIGNAL_DISPLAY = {
    inputWorkPresent:      { label: '入力ワーク有 (IWP)',      abbr: 'IWP' },
    processingWorkPresent: { label: '処理中ワーク有 (PWP)',    abbr: 'PWP' },
    outputWorkPresent:     { label: '出力ワーク有 (OWP)',      abbr: 'OWP' },
    running:               { label: '加工中 (RUN)',            abbr: 'RUN' },
    complete:              { label: '処理完了 (CPL)',           abbr: 'CPL' },
    processReady:          { label: '加工準備 (PR)',            abbr: 'PR' },
    inputReady:            { label: '搬入可 (IR)',              abbr: 'IR' },
    outputReady:           { label: '搬出可 (OR)',              abbr: 'OR' },
    workFull:              { label: 'ワーク滞留 (WF)',         abbr: 'WF' },
    workEmpty:             { label: 'ワーク枯渇 (WE)',         abbr: 'WE' },
    allPortsFull:          { label: '全ポート満杯 (APF)',      abbr: 'APF' },
    allPortsEmpty:         { label: '全ポート空 (APE)',        abbr: 'APE' }
};

/**
 * Get display label for a signal name (handles dynamic workType:* signals)
 */
export function getSignalLabel(signalName) {
    if (SIGNAL_DISPLAY[signalName]) return SIGNAL_DISPLAY[signalName].label;
    if (signalName.startsWith('workType:')) return `ワーク種類: ${signalName.substring(9)}`;
    // Dynamic port signals: port1Full, port2Empty, port1HasWork, etc.
    const portFullMatch = signalName.match(/^port(\d+)Full$/);
    if (portFullMatch) return `ポート${portFullMatch[1]}満杯`;
    const portEmptyMatch = signalName.match(/^port(\d+)Empty$/);
    if (portEmptyMatch) return `ポート${portEmptyMatch[1]}空`;
    const portHasWorkMatch = signalName.match(/^port(\d+)HasWork$/);
    if (portHasWorkMatch) return `ポート${portHasWorkMatch[1]}ワーク有`;
    return signalName;
}

// Standard 10 signals (all initial=false)
function tenSignals() {
    return [
        { name: 'inputWorkPresent', initial: false },
        { name: 'processingWorkPresent', initial: false },
        { name: 'outputWorkPresent', initial: false },
        { name: 'running', initial: false },
        { name: 'complete', initial: false },
        { name: 'processReady', initial: false },
        { name: 'inputReady', initial: false },
        { name: 'outputReady', initial: false },
        { name: 'workFull', initial: false },
        { name: 'workEmpty', initial: false }
    ];
}

export const INTERLOCK_PRESETS = {
    source: {
        standard: {
            name: 'Standard Source',
            description: '通常のSourceステーション。ワーク生成時に搬出可ON、搬出後にOFF。',
            signals: tenSignals(),
            rules: [
                { id: 'R1', target: 'outputReady', value: true,  conditions: [{ signal: 'outputWorkPresent', value: true }] },
                { id: 'R2', target: 'outputReady', value: false, conditions: [{ signal: 'outputWorkPresent', value: false }] }
            ]
        }
    },
    processing: {
        standard: {
            name: 'Standard Processing',
            description: '通常の製造ライン向け。ワークを1つずつ受け入れ、処理完了後に搬出。',
            signals: tenSignals(),
            rules: [
                { id: 'R1', target: 'inputReady',  value: true,  conditions: [{ signal: 'inputWorkPresent', value: false }] },
                { id: 'R2', target: 'inputReady',  value: false, conditions: [{ signal: 'inputWorkPresent', value: true }] },
                { id: 'R3', target: 'processReady', value: true, conditions: [{ signal: 'inputWorkPresent', value: true }, { signal: 'running', value: false }, { signal: 'complete', value: false }] },
                { id: 'R4', target: 'processReady', value: false, conditions: [{ signal: 'running', value: true }] },
                { id: 'R5', target: 'outputReady', value: true,  conditions: [{ signal: 'complete', value: true }, { signal: 'outputWorkPresent', value: true }] },
                { id: 'R6', target: 'outputReady', value: false, conditions: [{ signal: 'outputWorkPresent', value: false }] }
            ]
        }
    },
    merge: {
        standard: {
            name: 'Standard Merge',
            description: '結合ステーション。全入力ポート満杯で加工開始、結合完了後に搬出可。IR/IWPはポートから導出。',
            signals: [...tenSignals(), { name: 'allPortsFull', initial: false }],
            rules: [
                { id: 'R1', target: 'processReady', value: true,  conditions: [{ signal: 'allPortsFull', value: true }, { signal: 'running', value: false }, { signal: 'complete', value: false }] },
                { id: 'R2', target: 'processReady', value: false, conditions: [{ signal: 'running', value: true }] },
                { id: 'R3', target: 'outputReady',  value: true,  conditions: [{ signal: 'complete', value: true }, { signal: 'outputWorkPresent', value: true }] },
                { id: 'R4', target: 'outputReady',  value: false, conditions: [{ signal: 'outputWorkPresent', value: false }] }
            ]
        }
    },
    split: {
        standard: {
            name: 'Standard Split',
            description: '分割ステーション。全出力ポート空で搬入可、ワーク到着で加工開始。OR/OWPはポートから導出。',
            signals: [...tenSignals(), { name: 'allPortsEmpty', initial: true }],
            rules: [
                { id: 'R1', target: 'inputReady',   value: true,  conditions: [{ signal: 'allPortsEmpty', value: true }, { signal: 'inputWorkPresent', value: false }, { signal: 'running', value: false }, { signal: 'complete', value: false }] },
                { id: 'R2', target: 'inputReady',   value: false, conditions: [{ signal: 'inputWorkPresent', value: true }] },
                { id: 'R3', target: 'processReady', value: true,  conditions: [{ signal: 'inputWorkPresent', value: true }, { signal: 'running', value: false }, { signal: 'complete', value: false }] },
                { id: 'R4', target: 'processReady', value: false, conditions: [{ signal: 'running', value: true }] }
            ]
        }
    },
    drain: {
        standard: {
            name: 'Standard Drain',
            description: '通常のDrainステーション。空き状態で搬入可ON、ワーク消費後にOFF。',
            signals: tenSignals(),
            rules: [
                { id: 'R1', target: 'inputReady', value: true,  conditions: [{ signal: 'inputWorkPresent', value: false }] },
                { id: 'R2', target: 'inputReady', value: false, conditions: [{ signal: 'inputWorkPresent', value: true }] }
            ]
        }
    },
    entry: {
        standard: {
            name: 'Standard Entry',
            description: 'ModulerStation入口。ワーク到着後すぐに通過。',
            signals: tenSignals(),
            rules: [
                { id: 'R1', target: 'outputReady', value: true,  conditions: [{ signal: 'outputWorkPresent', value: true }] },
                { id: 'R2', target: 'outputReady', value: false, conditions: [{ signal: 'outputWorkPresent', value: false }] },
                { id: 'R3', target: 'inputReady',  value: true,  conditions: [{ signal: 'inputWorkPresent', value: false }] },
                { id: 'R4', target: 'inputReady',  value: false, conditions: [{ signal: 'inputWorkPresent', value: true }] }
            ]
        }
    },
    exit: {
        standard: {
            name: 'Standard Exit',
            description: 'ModulerStation出口。ワーク到着後すぐに通過。',
            signals: tenSignals(),
            rules: [
                { id: 'R1', target: 'outputReady', value: true,  conditions: [{ signal: 'outputWorkPresent', value: true }] },
                { id: 'R2', target: 'outputReady', value: false, conditions: [{ signal: 'outputWorkPresent', value: false }] },
                { id: 'R3', target: 'inputReady',  value: true,  conditions: [{ signal: 'inputWorkPresent', value: false }] },
                { id: 'R4', target: 'inputReady',  value: false, conditions: [{ signal: 'inputWorkPresent', value: true }] }
            ]
        }
    },
    moduler: {
        standard: {
            name: 'Standard Moduler',
            description: 'Modulerステーション。内部ステーション信号の集約。搬入可/搬出可をルールで制御。',
            signals: tenSignals(),
            rules: [
                { id: 'R1', target: 'inputReady',  value: true,  conditions: [{ signal: 'inputWorkPresent', value: false }] },
                { id: 'R2', target: 'inputReady',  value: false, conditions: [{ signal: 'inputWorkPresent', value: true }] },
                { id: 'R3', target: 'outputReady', value: true,  conditions: [{ signal: 'complete', value: true }, { signal: 'outputWorkPresent', value: true }] },
                { id: 'R4', target: 'outputReady', value: false, conditions: [{ signal: 'outputWorkPresent', value: false }] }
            ]
        }
    }
};

/**
 * Get the default preset for a station type
 */
export function getDefaultPreset(stationType) {
    const presets = INTERLOCK_PRESETS[stationType];
    if (!presets) return null;
    return presets.standard || null;
}

/**
 * Get all available presets for a station type
 */
export function getPresetsForType(stationType) {
    return INTERLOCK_PRESETS[stationType] || {};
}

/**
 * Deep-clone a preset so modifications don't affect the original
 */
export function clonePreset(preset) {
    return JSON.parse(JSON.stringify(preset));
}
