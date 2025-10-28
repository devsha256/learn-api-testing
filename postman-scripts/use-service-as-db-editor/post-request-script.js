// Post-Response Script (Tests Tab)
const responseData = pm.response.json();
const logEntries = responseData.results || [];
const dbFields = JSON.parse(pm.variables.get('db_fields') || '[]');
const currentFilters = JSON.parse(pm.variables.get('current_filters') || '{}');

// ========================================
// MAP FIELDS TO LOWERCASE RESPONSE KEYS
// ========================================
// Create mapping from dbFields (Table.Field) to response keys (lowercase)
const fieldMapping = {};
const displayFields = []; // Fields for display (with table identifiers)
const responseKeys = []; // Lowercase keys for data access

dbFields.forEach(field => {
    // Convert field name to lowercase for response mapping
    // E.g., "Logs.Status" -> "logs.status"
    const lowercaseKey = field.toLowerCase();
    fieldMapping[field] = lowercaseKey;
    displayFields.push(field);
    responseKeys.push(lowercaseKey);
});

// Transform response data to use display field names
const transformedData = logEntries.map(entry => {
    const transformedEntry = {};
    dbFields.forEach(field => {
        const lowercaseKey = fieldMapping[field];
        // Map lowercase response key to display field name
        transformedEntry[field] = entry[lowercaseKey] !== undefined ? entry[lowercaseKey] : null;
    });
    return transformedEntry;
});

// Calculate active filters count
const activeFiltersCount = Object.keys(currentFilters).filter(key => 
    currentFilters[key] && currentFilters[key] !== ''
).length;

console.log('Field mapping:', fieldMapping);
console.log('Transformed data sample:', transformedData[0]);

// Material Design 3 Template with interactive filtering
const template = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    
    <!-- Roboto Font -->
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
    
    <!-- Material Icons -->
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    
    <style>
        /* Material Design 3 Theme */
        :root {
            --md-sys-color-primary: #6750A4;
            --md-sys-color-on-primary: #FFFFFF;
            --md-sys-color-primary-container: #EADDFF;
            --md-sys-color-on-primary-container: #21005D;
            --md-sys-color-secondary: #625B71;
            --md-sys-color-on-secondary: #FFFFFF;
            --md-sys-color-secondary-container: #E8DEF8;
            --md-sys-color-on-secondary-container: #1D192B;
            --md-sys-color-tertiary: #7D5260;
            --md-sys-color-surface: #FEF7FF;
            --md-sys-color-surface-variant: #E7E0EC;
            --md-sys-color-on-surface: #1D1B20;
            --md-sys-color-on-surface-variant: #49454F;
            --md-sys-color-outline: #79747E;
            --md-sys-color-outline-variant: #CAC4D0;
            --md-sys-color-error: #B3261E;
            --md-sys-color-on-error: #FFFFFF;
            --md-sys-color-success: #00695C;
            
            /* Elevation */
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

        /* Material Design 3 Typography */
        .md-typescale-headline-small {
            font-size: 24px;
            font-weight: 400;
            line-height: 32px;
            letter-spacing: 0;
        }

        .md-typescale-title-medium {
            font-size: 16px;
            font-weight: 500;
            line-height: 24px;
            letter-spacing: 0.15px;
        }

        .md-typescale-body-medium {
            font-size: 14px;
            font-weight: 400;
            line-height: 20px;
            letter-spacing: 0.25px;
        }

        .md-typescale-label-large {
            font-size: 14px;
            font-weight: 500;
            line-height: 20px;
            letter-spacing: 0.1px;
        }

        /* App Bar */
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

        /* Stats Card */
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

        /* Filter Section */
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

        .filter-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }

        /* Material Design 3 Text Field */
        .md-text-field {
            position: relative;
            display: flex;
            flex-direction: column;
        }

        .md-text-field input {
            font-family: 'Roboto', sans-serif;
            font-size: 16px;
            padding: 16px 16px 8px 16px;
            border: 1px solid var(--md-sys-color-outline);
            border-radius: 4px;
            background: transparent;
            color: var(--md-sys-color-on-surface);
            outline: none;
            transition: all 0.2s;
        }

        .md-text-field input:focus {
            border-color: var(--md-sys-color-primary);
            border-width: 2px;
            padding: 16px 15px 8px 15px;
        }

        .md-text-field label {
            position: absolute;
            left: 16px;
            top: 16px;
            font-size: 16px;
            color: var(--md-sys-color-on-surface-variant);
            transition: all 0.2s;
            pointer-events: none;
            background: white;
            padding: 0 4px;
        }

        .md-text-field input:focus + label,
        .md-text-field input:not(:placeholder-shown) + label {
            top: -8px;
            font-size: 12px;
            color: var(--md-sys-color-primary);
        }

        .md-text-field .helper-text {
            font-size: 12px;
            color: var(--md-sys-color-on-surface-variant);
            margin-top: 4px;
            margin-left: 16px;
        }

        /* Material Design 3 Buttons */
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
            text-transform: none;
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

        .md-button-outlined {
            background: transparent;
            color: var(--md-sys-color-primary);
            border: 1px solid var(--md-sys-color-outline);
        }

        .md-button-outlined:hover {
            background: rgba(103, 80, 164, 0.08);
        }

        .md-button-text {
            background: transparent;
            color: var(--md-sys-color-primary);
        }

        .md-button-text:hover {
            background: rgba(103, 80, 164, 0.08);
        }

        .button-group {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }

        /* Data Table Container */
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

        /* Material Design 3 Data Table */
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
            transition: opacity 0.2s;
        }

        .md-data-table th:hover .material-icons {
            opacity: 1;
        }

        .md-data-table td {
            padding: 16px;
            border-bottom: 1px solid var(--md-sys-color-outline-variant);
            color: var(--md-sys-color-on-surface);
        }

        .md-data-table tbody tr {
            transition: background-color 0.2s;
        }

        .md-data-table tbody tr:hover {
            background-color: rgba(103, 80, 164, 0.04);
        }

        .md-data-table tbody tr:last-child td {
            border-bottom: none;
        }

        /* Chip for Active Filters */
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
            transition: all 0.2s;
        }

        .md-chip:hover {
            box-shadow: var(--md-sys-elevation-1);
        }

        .md-chip .material-icons {
            font-size: 18px;
            cursor: pointer;
            opacity: 0.7;
        }

        .md-chip .material-icons:hover {
            opacity: 1;
        }

        .field-name {
            font-family: 'Courier New', monospace;
            font-size: 13px;
            color: var(--md-sys-color-on-secondary-container);
        }

        /* Empty State */
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

        /* Code Block */
        .code-block {
            background: #1E1E1E;
            color: #D4D4D4;
            padding: 16px;
            border-radius: 8px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            overflow-x: auto;
            margin: 16px 0;
            line-height: 1.6;
        }

        .code-block .keyword {
            color: #569CD6;
        }

        .code-block .string {
            color: #CE9178;
        }

        .code-block .comment {
            color: #6A9955;
            font-style: italic;
        }

        .code-block .property {
            color: #9CDCFE;
        }

        /* Dialog/Modal */
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1000;
            align-items: center;
            justify-content: center;
        }

        .modal.active {
            display: flex;
        }

        .modal-content {
            background: white;
            border-radius: 28px;
            padding: 24px;
            max-width: 700px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: var(--md-sys-elevation-3);
        }

        .modal-title {
            font-size: 24px;
            font-weight: 400;
            margin-bottom: 16px;
            color: var(--md-sys-color-on-surface);
        }

        .modal-actions {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            margin-top: 24px;
        }

        /* Scrollbar Styling */
        .table-wrapper::-webkit-scrollbar,
        .modal-content::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }

        .table-wrapper::-webkit-scrollbar-track,
        .modal-content::-webkit-scrollbar-track {
            background: var(--md-sys-color-surface-variant);
        }

        .table-wrapper::-webkit-scrollbar-thumb,
        .modal-content::-webkit-scrollbar-thumb {
            background: var(--md-sys-color-outline);
            border-radius: 4px;
        }

        .table-wrapper::-webkit-scrollbar-thumb:hover,
        .modal-content::-webkit-scrollbar-thumb:hover {
            background: var(--md-sys-color-on-surface-variant);
        }

        /* Info banner */
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

        .info-banner .material-icons {
            font-size: 20px;
        }
    </style>
</head>
<body>
    <!-- App Bar -->
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

    <!-- Stats Cards -->
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

    <!-- Filter Section -->
    <div class="filter-section">
        <div class="filter-header">
            <h2 class="md-typescale-headline-small">Query Filters</h2>
            <button class="md-button md-button-text" onclick="toggleFilters()">
                <span class="material-icons">tune</span>
                <span id="filter-toggle-text">Show Filters</span>
            </button>
        </div>

        <!-- Info Banner -->
        <div class="info-banner">
            <span class="material-icons">info</span>
            <span>Modify filters in the Pre-request Script using <strong>Table.Field</strong> format, then re-send the request.</span>
        </div>

        <!-- Active Filter Chips -->
        <div class="filter-chips" id="activeFilters"></div>

        <!-- Filter Grid (Display Only) -->
        <div class="filter-grid" id="filterGrid" style="display: none;">
            {{#each fields}}
            <div class="md-text-field">
                <input type="text" id="filter_{{this}}" placeholder=" " value="{{lookup ../currentFilters this}}" readonly>
                <label>{{this}}</label>
                <div class="helper-text">Current filter value</div>
            </div>
            {{/each}}
        </div>

        <div class="button-group" id="filterButtons" style="display: none;">
            <button class="md-button md-button-filled" onclick="showFilterInstructions()">
                <span class="material-icons">code</span>
                View Filter Code
            </button>
            <button class="md-button md-button-outlined" onclick="copyFilterTemplate()">
                <span class="material-icons">content_copy</span>
                Copy Filter Template
            </button>
            <button class="md-button md-button-text" onclick="exportToCSV()">
                <span class="material-icons">download</span>
                Export CSV
            </button>
        </div>
    </div>

    <!-- Data Table -->
    <div class="table-container">
        <div class="table-header">
            <div class="md-typescale-title-medium">Query Results</div>
            <div class="button-group">
                <button class="md-button md-button-text" onclick="exportToCSV()">
                    <span class="material-icons">file_download</span>
                    Export
                </button>
            </div>
        </div>
        <div class="table-wrapper">
            <table class="md-data-table" id="dataTable">
                <thead>
                    <tr>
                        {{#each fields}}
                        <th onclick="sortTable('{{this}}')">
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
                                    <div class="md-typescale-headline-small">No Data Found</div>
                                    <div class="md-typescale-body-medium">Adjust your filters in the Pre-request Script and try again</div>
                                </div>
                            </td>
                        </tr>
                    {{/if}}
                </tbody>
            </table>
        </div>
    </div>

    <!-- Modal -->
    <div class="modal" id="filterModal">
        <div class="modal-content">
            <h2 class="modal-title">Filter Configuration</h2>
            <p class="md-typescale-body-medium" style="margin-bottom: 16px;">
                To modify filters, update the <strong>filters</strong> object in your Pre-request Script using <strong>Table.Field</strong> format:
            </p>
            <div class="code-block" id="filterCode"></div>
            <p class="md-typescale-body-medium" style="margin-top: 16px;">
                <strong>Note:</strong> Field names use Table.Field format but are automatically mapped to lowercase response keys.
            </p>
            <div class="modal-actions">
                <button class="md-button md-button-text" onclick="closeModal()">Close</button>
                <button class="md-button md-button-filled" onclick="copyCodeToClipboard()">
                    <span class="material-icons">content_copy</span>
                    Copy Code
                </button>
            </div>
        </div>
    </div>

    <script>
        // Data storage
        let allData = {{{json data}}};
        let fields = {{{json fields}}};
        let currentFilters = {{{json currentFilters}}};
        let sortState = {};
        let filteredData = [...allData];

        console.log('Loaded data:', allData.length, 'records');
        console.log('Fields:', fields);
        console.log('Active filters:', currentFilters);

        // Initialize sort state
        fields.forEach(field => {
            sortState[field] = { direction: 'none' };
        });

        // Toggle filter section
        function toggleFilters() {
            const grid = document.getElementById('filterGrid');
            const buttons = document.getElementById('filterButtons');
            const toggleText = document.getElementById('filter-toggle-text');
            
            if (grid.style.display === 'none') {
                grid.style.display = 'grid';
                buttons.style.display = 'flex';
                toggleText.textContent = 'Hide Filters';
            } else {
                grid.style.display = 'none';
                buttons.style.display = 'none';
                toggleText.textContent = 'Show Filters';
            }
        }

        // Update active filter chips
        function updateActiveFilterChips() {
            const container = document.getElementById('activeFilters');
            container.innerHTML = '';
            
            Object.keys(currentFilters).forEach(field => {
                if (currentFilters[field] && currentFilters[field] !== '') {
                    const chip = document.createElement('div');
                    chip.className = 'md-chip';
                    chip.innerHTML = \`
                        <span class="field-name">\${field}</span>
                        <span>=</span>
                        <span>\${currentFilters[field]}</span>
                    \`;
                    container.appendChild(chip);
                }
            });

            if (container.children.length === 0) {
                container.innerHTML = '<div class="md-typescale-body-medium" style="color: var(--md-sys-color-on-surface-variant);">No active filters</div>';
            }
        }

        // Show filter instructions modal
        function showFilterInstructions() {
            const modal = document.getElementById('filterModal');
            const codeBlock = document.getElementById('filterCode');
            
            // Generate filter code with syntax highlighting
            let filterCode = '<span class="keyword">const</span> filters = {\\n';
            fields.forEach(field => {
                const value = currentFilters[field] || '';
                if (value) {
                    filterCode += \`  <span class="comment">// Active filter</span>\\n\`;
                    filterCode += \`  <span class="property">'\${field}'</span>: <span class="string">'\${value}'</span>,\\n\`;
                } else {
                    filterCode += \`  <span class="comment">// '\${field}': '',</span>\\n\`;
                }
            });
            filterCode += '};';
            
            codeBlock.innerHTML = filterCode;
            modal.classList.add('active');
        }

        // Close modal
        function closeModal() {
            document.getElementById('filterModal').classList.remove('active');
        }

        // Copy filter template
        function copyFilterTemplate() {
            let template = 'const filters = {\\n';
            fields.forEach(field => {
                const value = currentFilters[field] || '';
                if (value) {
                    template += \`  '\${field}': '\${value}',\\n\`;
                } else {
                    template += \`  // '\${field}': '',\\n\`;
                }
            });
            template += '};';
            
            navigator.clipboard.writeText(template).then(() => {
                alert('Filter template copied to clipboard!');
            }).catch(err => {
                console.error('Copy failed:', err);
                prompt('Copy this code:', template);
            });
        }

        // Copy code to clipboard
        function copyCodeToClipboard() {
            const codeBlock = document.getElementById('filterCode');
            const text = codeBlock.textContent;
            
            navigator.clipboard.writeText(text).then(() => {
                alert('Code copied to clipboard!');
                closeModal();
            }).catch(err => {
                console.error('Copy failed:', err);
                prompt('Copy this code:', text);
            });
        }

        // Sort table
        function sortTable(field) {
            const headers = document.querySelectorAll('th');
            const fieldIndex = fields.indexOf(field);
            
            // Toggle sort direction
            if (sortState[field].direction === 'none' || sortState[field].direction === 'desc') {
                sortState[field].direction = 'asc';
            } else {
                sortState[field].direction = 'desc';
            }

            // Reset other fields
            fields.forEach(f => {
                if (f !== field) sortState[f].direction = 'none';
            });

            // Sort the data
            filteredData.sort((a, b) => {
                let aVal = a[field];
                let bVal = b[field];

                // Handle null/undefined
                if (aVal == null) return 1;
                if (bVal == null) return -1;

                // Numeric comparison
                if (!isNaN(aVal) && !isNaN(bVal)) {
                    return sortState[field].direction === 'asc' 
                        ? parseFloat(aVal) - parseFloat(bVal)
                        : parseFloat(bVal) - parseFloat(aVal);
                }

                // Date comparison (ISO format)
                const aDate = new Date(aVal);
                const bDate = new Date(bVal);
                if (!isNaN(aDate) && !isNaN(bDate)) {
                    return sortState[field].direction === 'asc'
                        ? aDate - bDate
                        : bDate - aDate;
                }

                // String comparison
                aVal = String(aVal).toLowerCase();
                bVal = String(bVal).toLowerCase();
                
                if (sortState[field].direction === 'asc') {
                    return aVal.localeCompare(bVal);
                } else {
                    return bVal.localeCompare(aVal);
                }
            });

            // Update header icons
            headers.forEach((header, idx) => {
                const icon = header.querySelector('.material-icons');
                if (idx === fieldIndex) {
                    icon.textContent = sortState[field].direction === 'asc' ? 'arrow_upward' : 'arrow_downward';
                } else {
                    icon.textContent = 'unfold_more';
                }
            });

            // Re-render table
            renderTable(filteredData);
        }

        // Render table
        function renderTable(data) {
            const tbody = document.getElementById('tableBody');
            
            if (data.length === 0) {
                tbody.innerHTML = \`
                    <tr>
                        <td colspan="\${fields.length}">
                            <div class="empty-state">
                                <div class="material-icons">inbox</div>
                                <div class="md-typescale-headline-small">No Data Found</div>
                                <div class="md-typescale-body-medium">Adjust your filters in the Pre-request Script and try again</div>
                            </div>
                        </td>
                    </tr>
                \`;
                return;
            }

            tbody.innerHTML = '';
            data.forEach(row => {
                const tr = document.createElement('tr');
                fields.forEach(field => {
                    const td = document.createElement('td');
                    const value = row[field];
                    td.textContent = value != null ? value : '';
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
        }

        // Export to CSV
        function exportToCSV() {
            // Use field names as headers
            let csv = fields.join(',') + '\\n';
            
            filteredData.forEach(row => {
                const values = fields.map(field => {
                    let val = row[field] != null ? row[field] : '';
                    val = String(val).replace(/"/g, '""');
                    return val.includes(',') || val.includes('\\n') || val.includes('"') ? \`"\${val}"\` : val;
                });
                csv += values.join(',') + '\\n';
            });

            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`query_results_\${new Date().getTime()}.csv\`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }

        // Close modal when clicking outside
        document.getElementById('filterModal').addEventListener('click', function(e) {
            if (e.target === this) {
                closeModal();
            }
        });

        // Initialize
        updateActiveFilterChips();
        
        // Show filters if there are active filters
        if (Object.keys(currentFilters).some(key => currentFilters[key] && currentFilters[key] !== '')) {
            toggleFilters();
        }
    </script>
</body>
</html>
`;

// Set visualizer with data
pm.visualizer.set(template, {
    data: transformedData,
    fields: displayFields,
    currentFilters: currentFilters,
    totalRecords: transformedData.length,
    displayedRecords: transformedData.length,
    activeFiltersCount: activeFiltersCount,
    timestamp: new Date().toLocaleString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true
    })
});
