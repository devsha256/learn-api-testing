// Define your filter fields as collection variables
// Example: field1, field2, field3, etc.

let filterParts = [];

// Get all your field variables (you'll add these based on your fields)
const fields = ['field1', 'field2', 'field3', 'timestamp', 'status']; // Replace with your actual fields

fields.forEach(field => {
    let value = pm.collectionVariables.get(field);
    if (value && value !== '') {
        // Handle different data types
        if (typeof value === 'string') {
            filterParts.push(`${field}='${value}'`);
        } else {
            filterParts.push(`${field}=${value}`);
        }
    }
});

// Build the WHERE condition
let whereCondition = filterParts.length > 0 ? filterParts.join(' AND ') : '1=1';

// Set the filter query parameter
pm.collectionVariables.set('where_condition', whereCondition);

console.log('Generated WHERE clause:', whereCondition);
