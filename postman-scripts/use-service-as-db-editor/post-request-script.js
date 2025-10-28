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
        return { logRetrieveResponse: { results: [] } };
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
 * Converts uppercase field to lowercase for response mapping
 * @param {string} field - Field name (e.g., "STATUS")
 * @returns {string} - Lowercase field (e.g., "status")
 */
const toLowercaseKey = (field) => field.toLowerCase();

/**
 * Creates field mapping object
 * @param {Array<string>} fields - Array of uppercase field names
 * @returns {Object} - Mapping object {FIELD: field}
 */
const createFieldMapping = (fields) => 
    fields.reduce((mapping, field) => ({
        ...mapping,
        [field]: toLowercaseKey(field)
    }), {});

/**
 * Transforms single entry from response format to display format
 * @param {Object} entry - Response entry with lowercase keys
 * @param {Array<string>} fields - Display field names (uppercase)
 * @param {Object} fieldMapping - Field mapping object
 * @returns {Object} - Transformed entry with uppercase keys
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
// DEBUG LOGGING
// ========================================

/**
 * Logs transformation debug information
 * @param {Object} data - Debug data object
 */
const logTransformDebug = ({ fieldMapping, sampleData, totalRecords }) => {
    console.log('═══════════════════════════════════════');
    console.log('POST-RESPONSE SCRIPT EXECUTION');
    console.log('═══════════════════════════════════════');
    console.log('Field mapping:', fieldMapping);
    console.log('Total records:', totalRecords);
    console.log('Sample transformed data:', sampleData);
    console.log('═══════════════════════════════════════');
};

// ========================================
// MAIN EXECUTION
// ========================================

// Extract data
const responseData = extractResponseData(pm.response);
const logRetrieveResponse = responseData.logRetrieveResponse || {};
const logEntries = logRetrieveResponse.results || [];
const dbFields = getVariable('db_fields', []);

// Create field mapping and transform data
const fieldMapping = createFieldMapping(dbFields);
const transformedData = transformData(logEntries, dbFields, fieldMapping);

// Debug logging
logTransformDebug({
    fieldMapping,
    sampleData: transformedData[0],
    totalRecords: transformedData.length
});

// ========================================
// VISUALIZER TEMPLATE - MINIMAL TABLE ONLY
// ========================================

const template = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Roboto', sans-serif;
            background-color: #fafafa;
            color: #212121;
            padding: 16px;
        }

        .table-wrapper {
            overflow-x: auto;
            overflow-y: auto;
            max-height: calc(100vh - 32px);
            background: white;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.12);
        }

        .data-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
            table-layout: auto;
        }

        .data-table thead {
            background: #f5f5f5;
        }

        .data-table th {
            padding: 12px 16px;
            text-align: left;
            font-weight: 500;
            color: #616161;
            border-bottom: 2px solid #e0e0e0;
            position: sticky;
            top: 0;
            background: #f5f5f5;
            z-index: 10;
            cursor: pointer;
            user-select: none;
            white-space: nowrap;
        }

        .data-table th:hover {
            background: #eeeeee;
        }

        .data-table th .header-content {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }

        .data-table th .material-icons {
            font-size: 16px;
            opacity: 0.5;
        }

        .data-table td {
            padding: 12px 16px;
            border-bottom: 1px solid #e0e0e0;
            color: #212121;
            white-space: nowrap;
        }

        .data-table td.wrap-text {
            white-space: normal;
            word-wrap: break-word;
            word-break: break-word;
            max-width: 400px;
            min-width: 200px;
        }

        .data-table tbody tr:hover {
            background-color: #f5f5f5;
        }

        .data-table tbody tr:last-child td {
            border-bottom: none;
        }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #9e9e9e;
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
            background: #f5f5f5;
        }

        .table-wrapper::-webkit-scrollbar-thumb {
            background: #bdbdbd;
            border-radius: 4px;
        }

        .table-wrapper::-webkit-scrollbar-thumb:hover {
            background: #9e9e9e;
        }
    </style>
</head>
<body>
    <div class="table-wrapper">
        <table class="data-table" id="dataTable">
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
                            </div>
                        </td>
                    </tr>
                {{/if}}
            </tbody>
        </table>
    </div>

    <script>
        'use strict';

        const DATA_CONFIG = {
            allData: {{dataJson}},
            fields: {{fieldsJson}}
        };

        const AppState = (() => {
            const state = {
                allData: DATA_CONFIG.allData || [],
                fields: DATA_CONFIG.fields || [],
                sortState: {},
                filteredData: [...(DATA_CONFIG.allData || [])]
            };

            state.fields.forEach(field => {
                state.sortState[field] = { direction: 'none' };
            });

            return {
                getState: () => ({ ...state }),
                updateState: (updates) => {
                    Object.assign(state, updates);
                    return { ...state };
                }
            };
        })();

        const Utils = {
            formatValue: (value) => value != null ? String(value) : '',
            
            isNumeric: (value) => !isNaN(value) && value !== null && value !== '',
            
            isDate: (value) => !isNaN(Date.parse(value)),
            
            isWrapColumn: (field) => field === 'MESSAGE' || field === 'ERRORMESSAGE',
            
            compareValues: (a, b, isAscending) => {
                const multiplier = isAscending ? 1 : -1;
                if (a == null) return 1;
                if (b == null) return -1;
                
                if (Utils.isNumeric(a) && Utils.isNumeric(b)) {
                    return (parseFloat(a) - parseFloat(b)) * multiplier;
                }
                
                if (Utils.isDate(a) && Utils.isDate(b)) {
                    return (new Date(a) - new Date(b)) * multiplier;
                }
                
                return String(a).toLowerCase().localeCompare(String(b).toLowerCase()) * multiplier;
            }
        };

        const UIRenderer = {
            renderTableBody: (data, fields) => {
                const tbody = document.getElementById('tableBody');

                if (data.length === 0) {
                    tbody.innerHTML = \`
                        <tr>
                            <td colspan="\${fields.length}">
                                <div class="empty-state">
                                    <div class="material-icons">inbox</div>
                                    <h3>No Data Found</h3>
                                </div>
                            </td>
                        </tr>
                    \`;
                    return;
                }

                tbody.innerHTML = data
                    .map(row => \`
                        <tr>
                            \${fields.map(field => {
                                const wrapClass = Utils.isWrapColumn(field) ? 'wrap-text' : '';
                                return \`<td class="\${wrapClass}">\${Utils.formatValue(row[field])}</td>\`;
                            }).join('')}
                        </tr>
                    \`).join('');
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

        const TableActions = {
            sortTable: (field) => {
                console.log('Sorting by field:', field);
                
                const state = AppState.getState();
                const currentDirection = state.sortState[field].direction;
                const newDirection = currentDirection === 'asc' ? 'desc' : 'asc';

                const newSortState = { ...state.sortState };
                Object.keys(newSortState).forEach(f => {
                    newSortState[f].direction = f === field ? newDirection : 'none';
                });

                const sortedData = [...state.filteredData].sort((a, b) => 
                    Utils.compareValues(a[field], b[field], newDirection === 'asc')
                );

                AppState.updateState({ 
                    sortState: newSortState, 
                    filteredData: sortedData 
                });

                UIRenderer.updateSortIcons(field, newDirection, state.fields);
                UIRenderer.renderTableBody(sortedData, state.fields);

                console.log('Sort completed. Direction:', newDirection);
            }
        };

        const init = () => {
            console.log('Table initialized with', AppState.getState().allData.length, 'records');
        };

        init();
    </script>
</body>
</html>
`;

// Convert data to JSON strings
const dataJson = JSON.stringify(transformedData);
const fieldsJson = JSON.stringify(dbFields);

// Set visualizer
pm.visualizer.set(template, {
    data: transformedData,
    fields: dbFields,
    dataJson: dataJson,
    fieldsJson: fieldsJson
});

console.log('Visualizer set successfully. Records:', transformedData.length);
