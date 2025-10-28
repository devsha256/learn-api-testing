// ========================================
// DEFINE YOUR FILTERS HERE
// ========================================
const filters = {
    // Use table identifiers (case-sensitive, e.g., Table.Field)
    // These will be mapped to lowercase in the response
    
    // Example filters:
    // 'Logs.Status': 'active',
    // 'Logs.Level': 'error',
    // 'Users.UserId': '12345',
    // 'Logs.Timestamp': '>2025-10-01',
    // 'Logs.IpAddress': '192.168.%',  // Use % for LIKE queries
    // 'Logs.ResponseTime': '<1000',
    // 'Sessions.SessionId': 'abc-123-xyz',
    // 'Logs.Message': '%timeout%'
};

// ========================================
// DEFINE YOUR DATABASE FIELDS HERE
// ========================================
// Use proper case with table identifiers (e.g., Table.Field)
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
    // Add all your actual database fields with table identifiers
];

// ========================================
// BUILD WHERE CLAUSE (Don't modify below)
// ========================================
let filterParts = [];

Object.keys(filters).forEach(field => {
    let value = filters[field];
    
    if (value && value !== '' && value !== null && value !== 'undefined') {
        // Handle different data types and operators
        if (value.toString().includes('%')) {
            // LIKE operator for wildcard searches
            filterParts.push(`${field} LIKE '${value}'`);
        } else if (value.toString().startsWith('>') || value.toString().startsWith('<') || value.toString().startsWith('!')) {
            // Comparison operators (>, <, !=)
            if (value.toString().startsWith('!')) {
                filterParts.push(`${field}!='${value.substring(1)}'`);
            } else {
                filterParts.push(`${field}${value}`);
            }
        } else if (!isNaN(value) && value.toString().trim() !== '') {
            // Numeric comparison
            filterParts.push(`${field}=${value}`);
        } else {
            // String equality
            filterParts.push(`${field}='${value}'`);
        }
    }
});

// Set the WHERE condition for the URL
let whereCondition = filterParts.length > 0 ? filterParts.join(' AND ') : '1=1';
pm.variables.set('where_condition', whereCondition);

// Pass data to post-response script
pm.variables.set('db_fields', JSON.stringify(dbFields));
pm.variables.set('current_filters', JSON.stringify(filters));

console.log('Generated WHERE clause:', whereCondition);
console.log('Active filters:', JSON.stringify(filters, null, 2));
console.log('Database fields:', dbFields);
