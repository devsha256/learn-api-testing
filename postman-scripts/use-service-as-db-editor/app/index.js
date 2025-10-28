const express = require('express');
const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Mock data
const mockLogs = [
    {
        correlationid: "corr-001",
        id: "log-001",
        env: "DEV",
        processname: "OrderProcessing",
        apiname: "CreateOrder",
        businessunit: "Sales",
        processid: "proc-001",
        message: "Order created successfully",
        status: "SUCCESS",
        errormessage: "",
        datetimestamp: "2025-10-28T10:15:30Z",
        cstdatetimestamp: "2025-10-28T04:15:30"
    },
    {
        correlationid: "corr-002",
        id: "log-002",
        env: "PROD",
        processname: "PaymentProcessing",
        apiname: "ProcessPayment",
        businessunit: "Finance",
        processid: "proc-002",
        message: "Payment processed",
        status: "SUCCESS",
        errormessage: "",
        datetimestamp: "2025-10-28T11:20:45Z",
        cstdatetimestamp: "2025-10-28T05:20:45"
    },
    {
        correlationid: "corr-003",
        id: "log-003",
        env: "PROD",
        processname: "OrderProcessing",
        apiname: "UpdateOrder",
        businessunit: "Sales",
        processid: "proc-003",
        message: "Order update failed",
        status: "ERROR",
        errormessage: "Database connection timeout",
        datetimestamp: "2025-10-28T12:30:00Z",
        cstdatetimestamp: "2025-10-28T06:30:00"
    },
    {
        correlationid: "corr-004",
        id: "log-004",
        env: "DEV",
        processname: "UserManagement",
        apiname: "CreateUser",
        businessunit: "IT",
        processid: "proc-004",
        message: "User created",
        status: "SUCCESS",
        errormessage: "",
        datetimestamp: "2025-10-28T13:45:15Z",
        cstdatetimestamp: "2025-10-28T07:45:15"
    },
    {
        correlationid: "corr-005",
        id: "log-005",
        env: "PROD",
        processname: "InventoryManagement",
        apiname: "UpdateInventory",
        businessunit: "Operations",
        processid: "proc-005",
        message: "Inventory updated",
        status: "SUCCESS",
        errormessage: "",
        datetimestamp: "2025-10-28T14:00:00Z",
        cstdatetimestamp: "2025-10-28T08:00:00"
    }
];

/**
 * Parses SQL WHERE clause and filters data
 * @param {Array} data - Array of log entries
 * @param {string} filterClause - SQL WHERE clause
 * @returns {Array} - Filtered data
 */
const filterData = (data, filterClause) => {
    if (!filterClause || filterClause === '1=1') {
        return data;
    }

    // Split by AND (case-insensitive)
    const conditions = filterClause.split(/\s+AND\s+/i);

    return data.filter(item => {
        return conditions.every(condition => {
            // Parse condition: FIELD OPERATOR VALUE
            const likeMatch = condition.match(/(\w+)\s+LIKE\s+'([^']+)'/i);
            if (likeMatch) {
                const [, field, pattern] = likeMatch;
                const value = String(item[field.toLowerCase()] || '');
                const regex = new RegExp(pattern.replace(/%/g, '.*'), 'i');
                return regex.test(value);
            }

            // Handle !=
            const neMatch = condition.match(/(\w+)\s*!=\s*'([^']+)'/);
            if (neMatch) {
                const [, field, value] = neMatch;
                return String(item[field.toLowerCase()] || '') !== value;
            }

            // Handle >=
            const gteMatch = condition.match(/(\w+)\s*>=\s*(.+)/);
            if (gteMatch) {
                const [, field, value] = gteMatch;
                const itemValue = item[field.toLowerCase()];
                return itemValue >= value.replace(/'/g, '');
            }

            // Handle <=
            const lteMatch = condition.match(/(\w+)\s*<=\s*(.+)/);
            if (lteMatch) {
                const [, field, value] = lteMatch;
                const itemValue = item[field.toLowerCase()];
                return itemValue <= value.replace(/'/g, '');
            }

            // Handle >
            const gtMatch = condition.match(/(\w+)\s*>\s*(.+)/);
            if (gtMatch) {
                const [, field, value] = gtMatch;
                const itemValue = item[field.toLowerCase()];
                return itemValue > value.replace(/'/g, '');
            }

            // Handle <
            const ltMatch = condition.match(/(\w+)\s*<\s*(.+)/);
            if (ltMatch) {
                const [, field, value] = ltMatch;
                const itemValue = item[field.toLowerCase()];
                return itemValue < value.replace(/'/g, '');
            }

            // Handle =
            const eqMatch = condition.match(/(\w+)\s*=\s*'?([^']+)'?/);
            if (eqMatch) {
                const [, field, value] = eqMatch;
                return String(item[field.toLowerCase()] || '') === value.replace(/'/g, '');
            }

            return true;
        });
    });
};

// Main API endpoint
app.get('/test-app/log', (req, res) => {
    const filterClause = req.query.filter || '1=1';
    
    console.log('═══════════════════════════════════════');
    console.log('API REQUEST RECEIVED');
    console.log('Filter clause:', filterClause);
    console.log('═══════════════════════════════════════');

    try {
        const filteredResults = filterData(mockLogs, filterClause);

        const response = {
            logRetrieveResponse: {
                totalRecordCount: filteredResults.length,
                currentPageRecordCount: filteredResults.length,
                rowsPerPage: null,
                totalPagesCount: 1,
                results: filteredResults
            }
        };

        console.log('Filtered results:', filteredResults.length, 'records');
        console.log('═══════════════════════════════════════\n');

        res.json(response);
    } catch (error) {
        console.error('Error processing filter:', error);
        res.status(400).json({
            error: 'Invalid filter clause',
            message: error.message
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`Mock API Server running on http://localhost:${PORT}`);
    console.log(`Test endpoint: http://localhost:${PORT}/test-app/log?filter=STATUS='SUCCESS'`);
});
