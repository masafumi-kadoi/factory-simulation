// Interlock Presets — signal and rule definitions for each station type

// Signal display names
export const SIGNAL_DISPLAY = {
    workPresent:        { label: 'ワーク有り (WP)',  abbr: 'WP' },
    processingComplete: { label: '処理完了 (PC)',    abbr: 'PC' },
    inputReady:         { label: '搬入可 (IR)',      abbr: 'IR' },
    outputReady:        { label: '搬出可 (OR)',      abbr: 'OR' }
};

export const INTERLOCK_PRESETS = {
    source: {
        standard: {
            name: 'Standard Source',
            description: '通常のSourceステーション。ワーク生成時に搬出可ON、搬出後にOFF。',
            signals: [
                { name: 'workPresent', initial: false },
                { name: 'outputReady', initial: false }
            ],
            rules: [
                { id: 'R1', target: 'outputReady', value: true,  conditions: [{ signal: 'workPresent', value: true }] },
                { id: 'R2', target: 'outputReady', value: false, conditions: [{ signal: 'workPresent', value: false }] }
            ]
        }
    },
    processing: {
        standard: {
            name: 'Standard Processing',
            description: '通常の製造ライン向け。ワークを1つずつ受け入れ、処理完了後に搬出。',
            signals: [
                { name: 'workPresent', initial: false },
                { name: 'processingComplete', initial: false },
                { name: 'inputReady', initial: false },
                { name: 'outputReady', initial: false }
            ],
            rules: [
                { id: 'R1', target: 'inputReady',        value: true,  conditions: [{ signal: 'processingComplete', value: false }, { signal: 'workPresent', value: false }] },
                { id: 'R2', target: 'inputReady',        value: false, conditions: [{ signal: 'processingComplete', value: false }, { signal: 'workPresent', value: true }] },
                { id: 'R3', target: 'outputReady',       value: true,  conditions: [{ signal: 'processingComplete', value: true },  { signal: 'workPresent', value: true }] },
                { id: 'R4', target: 'outputReady',       value: false, conditions: [{ signal: 'processingComplete', value: true },  { signal: 'workPresent', value: false }] },
                { id: 'R5', target: 'processingComplete', value: false, conditions: [{ signal: 'processingComplete', value: true }, { signal: 'workPresent', value: false }, { signal: 'outputReady', value: false }] }
            ]
        },
        simple: {
            name: 'Simple (現行互換)',
            description: '現行のハードコード動作と同等。シンプルなテスト用途向け。',
            signals: [
                { name: 'workPresent', initial: false },
                { name: 'processingComplete', initial: false },
                { name: 'inputReady', initial: false },
                { name: 'outputReady', initial: false }
            ],
            rules: [
                { id: 'R1', target: 'inputReady',  value: true,  conditions: [{ signal: 'workPresent', value: false }] },
                { id: 'R2', target: 'inputReady',  value: false, conditions: [{ signal: 'workPresent', value: true }] },
                { id: 'R3', target: 'outputReady', value: true,  conditions: [{ signal: 'processingComplete', value: true }] },
                { id: 'R4', target: 'outputReady', value: false, conditions: [{ signal: 'processingComplete', value: false }] },
                { id: 'R5', target: 'processingComplete', value: false, conditions: [{ signal: 'processingComplete', value: true }, { signal: 'workPresent', value: false }, { signal: 'outputReady', value: false }] }
            ]
        },
        buffer: {
            name: 'Buffer Station',
            description: 'バッファ付きステーション。処理中でも次のワークを受け入れ可能。',
            signals: [
                { name: 'workPresent', initial: false },
                { name: 'processingComplete', initial: false },
                { name: 'inputReady', initial: false },
                { name: 'outputReady', initial: false }
            ],
            rules: [
                { id: 'R1', target: 'inputReady',  value: true,  conditions: [{ signal: 'workPresent', value: false }] },
                { id: 'R2', target: 'inputReady',  value: true,  conditions: [{ signal: 'processingComplete', value: true }] },
                { id: 'R3', target: 'inputReady',  value: false, conditions: [{ signal: 'workPresent', value: true }, { signal: 'processingComplete', value: false }] },
                { id: 'R4', target: 'outputReady', value: true,  conditions: [{ signal: 'processingComplete', value: true }, { signal: 'workPresent', value: true }] },
                { id: 'R5', target: 'outputReady', value: false, conditions: [{ signal: 'processingComplete', value: true }, { signal: 'workPresent', value: false }] },
                { id: 'R6', target: 'processingComplete', value: false, conditions: [{ signal: 'processingComplete', value: true }, { signal: 'workPresent', value: false }, { signal: 'outputReady', value: false }] }
            ]
        }
    },
    drain: {
        standard: {
            name: 'Standard Drain',
            description: '通常のDrainステーション。空き状態で搬入可ON、ワーク消費後にOFF。',
            signals: [
                { name: 'workPresent', initial: false },
                { name: 'inputReady', initial: false }
            ],
            rules: [
                { id: 'R1', target: 'inputReady', value: true,  conditions: [{ signal: 'workPresent', value: false }] },
                { id: 'R2', target: 'inputReady', value: false, conditions: [{ signal: 'workPresent', value: true }] }
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
