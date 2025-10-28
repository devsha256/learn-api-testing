// ========================================
// DATA EXTRACTION
// ========================================

/**
 * Safely extracts data from response
 * @param {Object} response - Postman response object
 * @returns {Object} - Parsed response data
 */
const extractResponseData = (response) => {
    try {
        return response.json();
    } catch (error) {
        console.error('Error parsing response:', error);
        return { results: [] };
    }
};

/**
 * Gets variable from Postman with fallback
 * @param {string} key - Variable key
 * @param {*} defaultValue - Default value
 * @returns {*} - Variable value or default
 */
const getVariable = (key, defaultValue = null) => {
    try {
        const value = pm.variables.get(key);
        return value ? JSON.parse(value) : defaultValue;
    } catch (error) {
        console.error(`Error getting variable ${key}:`, error);
        return defaultValue;
    }
};

// ========================================
// FIELD MAPPING
// ========================================

/**
 * Converts field name to lowercase for response mapping
 * @param {string} field - Field name (e.g., "Logs.Status")
 * @returns {string} - Lowercase field (e.g., "logs.status")
 */
const toLowercaseKey = (field) => field.toLowerCase();

/**
 * Creates field mapping object
 * @param {Array<string>} fields - Array of field names
 * @returns {Object} - Mapping object {displayField: responseKey}
 */
const createFieldMapping = (fields) => 
    fields.reduce((mapping, field) => ({
        ...mapping,
        [field]: toLowercaseKey(field)
    }), {});

/**
 * Transforms single entry from response format to display format
 * @param {Object} entry - Response entry with lowercase keys
 * @param {Array<string>} fields - Display field names
 * @param {Object} fieldMapping - Field mapping object
 * @returns {Object} - Transformed entry with display keys
 */
const transformEntry = (entry, fields, fieldMapping) =>
    fields.reduce((transformed, field) => ({
        ...transformed,
        [field]: entry[fieldMapping[field]] ?? null
    }), {});

/**
 * Transforms all response data
 * @param {Array<Object>} entries - Response entries
 * @param {Array<string>} fields - Display field names
 * @param {Object} fieldMapping - Field mapping object
 * @returns {Array<Object>} - Transformed entries
 */
const transformData = (entries, fields, fieldMapping) =>
    entries.map(entry => transformEntry(entry, fields, fieldMapping));

// ========================================
// FILTER UTILITIES
// ========================================

/**
 * Counts active filters
 * @param {Object} filters - Filters object
 * @returns {number} - Count of active filters
 */
const countActiveFilters = (filters) =>
    Object.values(filters).filter(value => value && value !== '').length;

// ========================================
// DEBUG LOGGING
// ========================================

/**
 * Logs transformation debug information
 * @param {Object} data - Debug data object
 */
const logTransformDebug = ({ fieldMapping, sampleData, totalRecords, activeFilters }) => {
    console.log('═══════════════════════════════════════');
    console.log('POST-RESPONSE SCRIPT EXECUTION');
    console.log('═══════════════════════════════════════');
    console.log('Field mapping:', fieldMapping);
    console.log('Total records:', totalRecords);
    console.log('Active filters count:', activeFilters);
    console.log('Sample transformed data:', sampleData);
    console.log('═══════════════════════════════════════');
};

// ========================================
// MAIN EXECUTION
// ========================================

// Extract data
const responseData = extractResponseData(pm.response);
const logEntries = responseData.results || [];
const dbFields = getVariable('db_fields', []);
const currentFilters = getVariable('current_filters', {});

// Create field mapping and transform data
const fieldMapping = createFieldMapping(dbFields);
const transformedData = transformData(logEntries, dbFields, fieldMapping);

// Calculate statistics
const activeFiltersCount = countActiveFilters(currentFilters);
const timestamp = new Date().toLocaleString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: true
});

// Debug logging
logTransformDebug({
    fieldMapping,
    sampleData: transformedData[0],
    totalRecords: transformedData.length,
    activeFilters: activeFiltersCount
});

// ========================================
// VISUALIZER TEMPLATE
// ========================================

const template = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    
    <style>
        :root {
            --md-sys-color-primary: #6750A4;
            --md-sys-color-on-primary: #FFFFFF;
            --md-sys-color-primary-container: #EADDFF;
            --md-sys-color-on-primary-container: #21005D;
            --md-sys-color-secondary: #625B71;
            --md-sys-color-secondary-container: #E8DEF8;
            --md-sys-color-on-secondary-container: #1D192B;
            --md-sys-color-surface: #FEF7FF;
            --md-sys-color-surface-variant: #E7E0EC;
            --md-sys-color-on-surface: #1D1B20;
            --md-sys-color-on-surface-variant: #49454F;
            --md-sys-color-outline: #79747E;
            --md-sys-color-outline-variant: #CAC4D0;
            --md-sys-elevation-1: 0px 1px 2px rgba(0, 0, 0, 0.3), 0px 1px 3px 1px rgba(0, 0, 0, 0.15);
            --md-sys-elevation-2: 0px 1px 2px rgba(0, 0, 0, 0.3), 0px 2px 6px 2px rgba(0, 0, 0, 0.15);
            --md-sys-elevation-3: 0px 4px 8px 3px rgba(0, 0, 0, 0.15), 0px 1px 3px rgba(0, 0, 0, 0.3);
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Roboto', sans-serif;
            background-color: var(--md-sys-color-surface);
            color: var(--md-sys-color-on-surface);
            padding: 24px;
            line-height: 1.5;
        }

        .app-bar {
            background-color: var(--md-sys-color-primary);
            color: var(--md-sys-color-on-primary);
            padding: 16px 24px;
            margin: -24px -24px 24px -24px;
            box-shadow: var(--md-sys-elevation-2);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .app-bar-title {
            font-size: 22px;
            font-weight: 400;
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .stats-container {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }

        .stat-card {
            background: var(--md-sys-color-primary-container);
            color: var(--md-sys-color-on-primary-container);
            padding: 20px;
            border-radius: 12px;
            box-shadow: var(--md-sys-elevation-1);
            transition: box-shadow 0.2s;
        }

        .stat-card:hover {
            box-shadow: var(--md-sys-elevation-2);
        }

        .stat-label {
            font-size: 12px;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            opacity: 0.8;
            margin-bottom: 4px;
        }

        .stat-value {
            font-size: 32px;
            font-weight: 400;
            line-height: 40px;
        }

        .filter-section {
            background: white;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 24px;
            box-shadow: var(--md-sys-elevation-1);
        }

        .filter-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
        }

        .filter-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 16px;
        }

        .md-chip {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 16px;
            background: var(--md-sys-color-secondary-container);
            color: var(--md-sys-color-on-secondary-container);
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
        }

        .field-name {
            font-family: 'Courier New', monospace;
            font-size: 13px;
        }

        .md-button {
            font-family: 'Roboto', sans-serif;
            font-size: 14px;
            font-weight: 500;
            letter-spacing: 0.1px;
            padding: 10px 24px;
            border: none;
            border-radius: 20px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s;
        }

        .md-button:active {
            transform: scale(0.98);
        }

        .md-button-filled {
            background-color: var(--md-sys-color-primary);
            color: var(--md-sys-color-on-primary);
            box-shadow: var(--md-sys-elevation-1);
        }

        .md-button-filled:hover {
            box-shadow: var(--md-sys-elevation-2);
        }

        .md-button-text {
            background: transparent;
            color: var(--md-sys-color-primary);
        }

        .md-button-text:hover {
            background: rgba(103, 80, 164, 0.08);
        }

        .table-container {
            background: white;
            border-radius: 12px;
            box-shadow: var(--md-sys-elevation-1);
            overflow: hidden;
        }

        .table-header {
            padding: 16px 20px;
            background: var(--md-sys-color-surface-variant);
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--md-sys-color-outline-variant);
        }

        .table-wrapper {
            overflow-x: auto;
            max-height: 600px;
            overflow-y: auto;
        }

        .md-data-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
        }

        .md-data-table thead {
            background: var(--md-sys-color-surface-variant);
        }

        .md-data-table th {
            padding: 16px;
            text-align: left;
            font-weight: 500;
            color: var(--md-sys-color-on-surface-variant);
            border-bottom: 1px solid var(--md-sys-color-outline-variant);
            position: sticky;
            top: 0;
            background: var(--md-sys-color-surface-variant);
            z-index: 10;
            cursor: pointer;
            user-select: none;
            white-space: nowrap;
        }

        .md-data-table th:hover {
            background: rgba(103, 80, 164, 0.12);
        }

        .md-data-table th .header-content {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }

        .md-data-table th .material-icons {
            font-size: 18px;
            opacity: 0.6;
        }

        .md-data-table td {
            padding: 16px;
            border-bottom: 1px solid var(--md-sys-color-outline-variant);
            color: var(--md-sys-color-on-surface);
        }

        .md-data-table tbody tr:hover {
            background-color: rgba(103, 80, 164, 0.04);
        }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--md-sys-color-on-surface-variant);
        }

        .empty-state .material-icons {
            font-size: 64px;
            opacity: 0.3;
            margin-bottom: 16px;
        }

        .table-wrapper::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }

        .table-wrapper::-webkit-scrollbar-track {
            background: var(--md-sys-color-surface-variant);
        }

        .table-wrapper::-webkit-scrollbar-thumb {
            background: var(--md-sys-color-outline);
            border-radius: 4px;
        }

        .info-banner {
            background: var(--md-sys-color-primary-container);
            color: var(--md-sys-color-on-primary-container);
            padding: 12px 16px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="app-bar">
        <div class="app-bar-title">
            <span class="material-icons">storage</span>
            Database Query Editor
        </div>
        <div style="font-size: 14px; opacity: 0.9;">
            <span class="material-icons" style="font-size: 16px; vertical-align: middle;">schedule</span>
            {{timestamp}}
        </div>
    </div>

    <div class="stats-container">
        <div class="stat-card">
            <div class="stat-label">Total Records</div>
            <div class="stat-value">{{totalRecords}}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Displayed</div>
            <div class="stat-value">{{displayedRecords}}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Active Filters</div>
            <div class="stat-value">{{activeFiltersCount}}</div>
        </div>
    </div>

    <div class="filter-section">
        <div class="filter-header">
            <h2>Query Filters</h2>
            <button class="md-button md-button-text" onclick="AppState.toggleFilters()">
                <span class="material-icons">tune</span>
                <span id="filter-toggle-text">View Filters</span>
            </button>
        </div>

        <div class="info-banner">
            <span class="material-icons">info</span>
            <span>Modify filters in Pre-request Script using <strong>Table.Field</strong> format</span>
        </div>

        <div class="filter-chips" id="activeFilters"></div>
    </div>

    <div class="table-container">
        <div class="table-header">
            <div>Query Results</div>
            <button class="md-button md-button-filled" onclick="TableActions.exportToCSV()">
                <span class="material-icons">file_download</span>
                Export CSV
            </button>
        </div>
        <div class="table-wrapper">
            <table class="md-data-table" id="dataTable">
                <thead>
                    <tr>
                        {{#each fields}}
                        <th onclick="TableActions.sortTable('{{this}}')">
                            <div class="header-content">
                                <span>{{this}}</span>
                                <span class="material-icons">unfold_more</span>
                            </div>
                        </th>
                        {{/each}}
                    </tr>
                </thead>
                <tbody id="tableBody">
                    {{#if data}}
                        {{#each data}}
                        <tr>
                            {{#each ../fields}}
                            <td>{{lookup ../this this}}</td>
                            {{/each}}
                        </tr>
                        {{/each}}
                    {{else}}
                        <tr>
                            <td colspan="{{fields.length}}">
                                <div class="empty-state">
                                    <div class="material-icons">inbox</div>
                                    <h3>No Data Found</h3>
                                    <p>Adjust filters in Pre-request Script</p>
                                </div>
                            </td>
                        </tr>
                    {{/if}}
                </tbody>
            </table>
        </div>
    </div>

    <script>
        'use strict';

        // ========================================
        // IMMUTABLE STATE MANAGEMENT
        // ========================================
        const AppState = (() => {
            const state = {
                allData: {{{json data}}},
                fields: {{{json fields}}},
                currentFilters: {{{json currentFilters}}},
                sortState: {},
                filteredData: [...{{{json data}}}]
            };

            // Initialize sort state
            state.fields.forEach(field => {
                state.sortState[field] = { direction: 'none' };
            });

            const getState = () => ({ ...state });
            
            const updateState = (updates) => {
                Object.assign(state, updates);
                return getState();
            };

            const toggleFilters = () => {
                const isVisible = document.getElementById('activeFilters').style.display !== 'none';
                console.log('Toggle filters. Current:', isVisible ? 'visible' : 'hidden');
                // Add toggle logic if needed
            };

            return { getState, updateState, toggleFilters };
        })();

        // ========================================
        // PURE UTILITY FUNCTIONS
        // ========================================
        const Utils = {
            isValidValue: (value) => value != null && value !== '',
            
            formatValue: (value) => value != null ? String(value) : '',
            
            isNumeric: (value) => !isNaN(value) && value !== null && value !== '',
            
            isDate: (value) => !isNaN(Date.parse(value)),
            
            compareValues: (a, b, isAscending) => {
                const multiplier = isAscending ? 1 : -1;
                
                if (a == null) return 1;
                if (b == null) return -1;
                
                // Numeric comparison
                if (Utils.isNumeric(a) && Utils.isNumeric(b)) {
                    return (parseFloat(a) - parseFloat(b)) * multiplier;
                }
                
                // Date comparison
                if (Utils.isDate(a) && Utils.isDate(b)) {
                    return (new Date(a) - new Date(b)) * multiplier;
                }
                
                // String comparison
                return String(a).toLowerCase().localeCompare(String(b).toLowerCase()) * multiplier;
            },
            
            escapeCSV: (value) => {
                const str = Utils.formatValue(value);
                const escaped = str.replace(/"/g, '""');
                return str.includes(',') || str.includes('\\n') || str.includes('"') 
                    ? \`"\${escaped}"\` 
                    : str;
            }
        };

        // ========================================
        // UI RENDERING
        // ========================================
        const UIRenderer = {
            renderFilterChips: (filters) => {
                const container = document.getElementById('activeFilters');
                const activeFilters = Object.entries(filters)
                    .filter(([_, value]) => Utils.isValidValue(value));

                if (activeFilters.length === 0) {
                    container.innerHTML = '<div style="color: var(--md-sys-color-on-surface-variant);">No active filters</div>';
                    return;
                }

                container.innerHTML = activeFilters
                    .map(([field, value]) => \`
                        <div class="md-chip">
                            <span class="field-name">\${field}</span>
                            <span>=</span>
                            <span>\${value}</span>
                        </div>
                    \`)
                    .join('');
            },

            renderTableBody: (data, fields) => {
                const tbody = document.getElementById('tableBody');

                if (data.length === 0) {
                    tbody.innerHTML = \`
                        <tr>
                            <td colspan="\${fields.length}">
                                <div class="empty-state">
                                    <div class="material-icons">inbox</div>
                                    <h3>No Data Found</h3>
                                    <p>Adjust filters in Pre-request Script</p>
                                </div>
                            </td>
                        </tr>
                    \`;
                    return;
                }

                tbody.innerHTML = data
                    .map(row => \`
                        <tr>
                            \${fields.map(field => \`<td>\${Utils.formatValue(row[field])}</td>\`).join('')}
                        </tr>
                    \`)
                    .join('');
            },

            updateSortIcons: (sortedField, direction, allFields) => {
                const headers = document.querySelectorAll('th');
                const fieldIndex = allFields.indexOf(sortedField);

                headers.forEach((header, idx) => {
                    const icon = header.querySelector('.material-icons');
                    if (idx === fieldIndex) {
                        icon.textContent = direction === 'asc' ? 'arrow_upward' : 'arrow_downward';
                    } else {
                        icon.textContent = 'unfold_more';
                    }
                });
            }
        };

        // ========================================
        // TABLE ACTIONS
        // ========================================
        const TableActions = {
            sortTable: (field) => {
                console.log('Sorting by field:', field);
                
                const state = AppState.getState();
                const currentDirection = state.sortState[field].direction;
                const newDirection = currentDirection === 'asc' ? 'desc' : 'asc';

                // Update sort state
                const newSortState = { ...state.sortState };
                Object.keys(newSortState).forEach(f => {
                    newSortState[f].direction = f === field ? newDirection : 'none';
                });

                // Sort data
                const sortedData = [...state.filteredData].sort((a, b) => 
                    Utils.compareValues(a[field], b[field], newDirection === 'asc')
                );

                // Update state and UI
                AppState.updateState({ 
                    sortState: newSortState, 
                    filteredData: sortedData 
                });

                UIRenderer.updateSortIcons(field, newDirection, state.fields);
                UIRenderer.renderTableBody(sortedData, state.fields);

                console.log('Sort completed. Direction:', newDirection);
            },

            exportToCSV: () => {
                console.log('Exporting to CSV...');
                
                const state = AppState.getState();
                const { filteredData, fields } = state;

                // Create CSV content
                const header = fields.join(',');
                const rows = filteredData
                    .map(row => fields.map(field => Utils.escapeCSV(row[field])).join(','))
                    .join('\\n');

                const csv = \`\${header}\\n\${rows}\`;

                // Create and trigger download
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                const timestamp = new Date().getTime();
                
                link.href = url;
                link.download = \`query_results_\${timestamp}.csv\`;
                link.click();
                
                URL.revokeObjectURL(url);

                console.log('CSV export completed. Rows:', filteredData.length);
            }
        };

        // ========================================
        // INITIALIZATION
        // ========================================
        const init = () => {
            console.log('═══════════════════════════════════════');
            console.log('VISUALIZER INITIALIZATION');
            console.log('═══════════════════════════════════════');
            
            const state = AppState.getState();
            
            console.log('Loaded data records:', state.allData.length);
            console.log('Fields:', state.fields);
            console.log('Active filters:', state.currentFilters);
            
            UIRenderer.renderFilterChips(state.currentFilters);
            
            console.log('═══════════════════════════════════════');
        };

        // Execute initialization
        init();
    </script>
</body>
</html>
`;

// Set visualizer
pm.visualizer.set(template, {
    data: transformedData,
    fields: dbFields,
    currentFilters: currentFilters,
    totalRecords: transformedData.length,
    displayedRecords: transformedData.length,
    activeFiltersCount: activeFiltersCount,
    timestamp: timestamp
});

console.log('Visualizer template set successfully');
