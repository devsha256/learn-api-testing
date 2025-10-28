// ========================================
// FILTER CONFIGURATION
// ========================================
const filters = {
    // Define your filters here (Table.Field: value)
    // 'Logs.Status': 'active',
    // 'Logs.Level': 'error',
    // 'Users.UserId': '12345',
    // 'Logs.Timestamp': '>2025-10-01',
};

// ========================================
// DATABASE FIELDS CONFIGURATION
// ========================================
const dbFields = [
    'Logs.Id',
    'Logs.Timestamp',
    'Logs.Level',
    'Logs.Message',
    'Users.UserId',
    'Sessions.SessionId',
    'Logs.IpAddress',
    'Logs.Status',
    'Logs.ResponseTime',
    'Logs.ErrorCode',
    'Logs.Method',
    'Logs.Endpoint'
];

// ========================================
// PURE FUNCTIONS FOR QUERY BUILDING
// ========================================

/**
 * Determines the SQL operator and formats value based on input
 * @param {string} value - Filter value
 * @returns {Object} - {operator, formattedValue}
 */
const getOperatorAndValue = (value) => {
    const valueStr = value.toString().trim();
    
    // LIKE operator for wildcard
    if (valueStr.includes('%')) {
        return { operator: 'LIKE', formattedValue: `'${valueStr}'` };
    }
    
    // NOT EQUAL operator
    if (valueStr.startsWith('!')) {
        return { operator: '!=', formattedValue: `'${valueStr.substring(1)}'` };
    }
    
    // Comparison operators (>, <, >=, <=)
    if (/^[><]=?/.test(valueStr)) {
        const match = valueStr.match(/^([><]=?)(.+)/);
        return { operator: match[1], formattedValue: match[2] };
    }
    
    // Numeric value
    if (!isNaN(valueStr) && valueStr !== '') {
        return { operator: '=', formattedValue: valueStr };
    }
    
    // Default string equality
    return { operator: '=', formattedValue: `'${valueStr}'` };
};

/**
 * Creates a SQL condition string from field and value
 * @param {string} field - Database field name
 * @param {string} value - Filter value
 * @returns {string} - SQL condition
 */
const createCondition = (field, value) => {
    const { operator, formattedValue } = getOperatorAndValue(value);
    return `${field} ${operator} ${formattedValue}`;
};

/**
 * Checks if a filter value is valid
 * @param {*} value - Value to check
 * @returns {boolean}
 */
const isValidFilterValue = (value) => 
    value !== null && 
    value !== undefined && 
    value !== '' && 
    value !== 'undefined';

/**
 * Builds WHERE clause from filters object
 * @param {Object} filters - Filters object
 * @returns {string} - SQL WHERE clause
 */
const buildWhereClause = (filters) => {
    const conditions = Object.entries(filters)
        .filter(([_, value]) => isValidFilterValue(value))
        .map(([field, value]) => createCondition(field, value));
    
    return conditions.length > 0 ? conditions.join(' AND ') : '1=1';
};

/**
 * Logs debug information
 * @param {string} whereClause - Generated WHERE clause
 * @param {Object} filters - Active filters
 */
const logDebugInfo = (whereClause, filters) => {
    console.log('═══════════════════════════════════════');
    console.log('PRE-REQUEST SCRIPT EXECUTION');
    console.log('═══════════════════════════════════════');
    console.log('Generated WHERE clause:', whereClause);
    console.log('Active filters:', JSON.stringify(filters, null, 2));
    console.log('Database fields:', dbFields);
    console.log('═══════════════════════════════════════');
};

// ========================================
// EXECUTION
// ========================================

// Build WHERE clause using functional composition
const whereCondition = buildWhereClause(filters);

// Set Postman variables
pm.variables.set('where_condition', whereCondition);
pm.variables.set('db_fields', JSON.stringify(dbFields));
pm.variables.set('current_filters', JSON.stringify(filters));

// Log debug information
logDebugInfo(whereCondition, filters);
