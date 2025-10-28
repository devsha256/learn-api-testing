// Get the response data
let responseData = pm.response.json();
let logEntries = responseData.results || [];

// Extract all unique field names from the first entry
let fields = logEntries.length > 0 ? Object.keys(logEntries[0]) : [];

// Create the HTML template with interactive filtering
let template = `
<style>
    table {
        border-collapse: collapse;
        width: 100%;
        margin: 20px 0;
        font-family: Arial, sans-serif;
    }
    th {
        background-color: #0066cc;
        color: white;
        padding: 12px;
        text-align: left;
        cursor: pointer;
        position: relative;
        user-select: none;
    }
    th:hover {
        background-color: #0052a3;
    }
    th::after {
        content: ' ⇅';
        font-size: 12px;
        opacity: 0.5;
    }
    td {
        border: 1px solid #ddd;
        padding: 10px;
    }
    tr:nth-child(even) {
        background-color: #f2f2f2;
    }
    tr:hover {
        background-color: #e6f2ff;
    }
    .filter-input {
        width: 100%;
        padding: 5px;
        margin-top: 5px;
        box-sizing: border-box;
    }
    .stats {
        background: #f5f5f5;
        padding: 10px;
        margin-bottom: 10px;
        border-radius: 4px;
    }
</style>

<div class="stats">
    <strong>Total Records:</strong> {{total}}
</div>

<table id="dataTable">
    <thead>
        <tr>
            {{#each fields}}
            <th onclick="filterColumn('{{this}}')">{{this}}</th>
            {{/each}}
        </tr>
        <tr>
            {{#each fields}}
            <th><input type="text" class="filter-input" id="filter_{{this}}" 
                placeholder="Filter {{this}}..." 
                onkeyup="applyFilters()"></th>
            {{/each}}
        </tr>
    </thead>
    <tbody id="tableBody">
        {{#each data}}
        <tr>
            {{#each ../fields}}
            <td>{{lookup ../this this}}</td>
            {{/each}}
        </tr>
        {{/each}}
    </tbody>
</table>

<script>
    let originalData = {{{json data}}};
    let fields = {{{json fields}}};
    
    function applyFilters() {
        let filteredData = originalData;
        
        // Apply all active filters
        fields.forEach(field => {
            let filterValue = document.getElementById('filter_' + field).value.toLowerCase();
            if (filterValue) {
                filteredData = filteredData.filter(row => {
                    let cellValue = String(row[field] || '').toLowerCase();
                    return cellValue.includes(filterValue);
                });
            }
        });
        
        renderTable(filteredData);
    }
    
    function renderTable(data) {
        let tbody = document.getElementById('tableBody');
        tbody.innerHTML = '';
        
        data.forEach(row => {
            let tr = document.createElement('tr');
            fields.forEach(field => {
                let td = document.createElement('td');
                td.textContent = row[field] || '';
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }
    
    function filterColumn(columnName) {
        document.getElementById('filter_' + columnName).focus();
    }
    
    // Sort functionality
    let sortOrder = {};
    fields.forEach(field => { sortOrder[field] = 1; });
    
    function sortTable(columnIndex, columnName) {
        let table = document.getElementById('dataTable');
        let rows = Array.from(table.querySelectorAll('tbody tr'));
        
        rows.sort((a, b) => {
            let aVal = a.cells[columnIndex].textContent;
            let bVal = b.cells[columnIndex].textContent;
            
            // Try numeric comparison first
            if (!isNaN(aVal) && !isNaN(bVal)) {
                return (parseFloat(aVal) - parseFloat(bVal)) * sortOrder[columnName];
            }
            return aVal.localeCompare(bVal) * sortOrder[columnName];
        });
        
        sortOrder[columnName] *= -1;
        
        let tbody = document.getElementById('tableBody');
        tbody.innerHTML = '';
        rows.forEach(row => tbody.appendChild(row));
    }
</script>
`;

// Set the visualizer
pm.visualizer.set(template, {
    data: logEntries,
    fields: fields,
    total: logEntries.length
});
