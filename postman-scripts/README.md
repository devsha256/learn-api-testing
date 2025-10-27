# API Comparison Testing Framework - User Guide

## Overview

This Postman collection provides automated comparison testing between Mule and Boomi API implementations. It executes requests against both systems simultaneously, compares responses, and generates detailed reports with visual side-by-side JSON comparisons.

---

## Features

**Dual API Testing** - Automatically calls both Mule and Boomi APIs in parallel  
**Smart JSON Comparison** - Intelligently compares responses with proper array alignment and object key sorting  
**Visual Diff Display** - Side-by-side JSON visualization with color-coded differences  
**Exempted Fields** - Skip comparison for specific fields (timestamps, IDs, etc.)  
**CSV Reports** - Export full test results including cURL commands for reproduction  
**Individual & Batch Testing** - Run single requests or entire collection  

***

## Setup Instructions

### 1. Collection Variables

Configure these variables in your collection:

| Variable | Description | Example |
|----------|-------------|---------|
| `mule_base_url` | Mule API base URL | `https://mule-api.company.com` |
| `boomi_base_url` | Boomi API base URL | `https://boomi-api.company.com` |
| `exempted_fields` | JSON array of fields to skip | `["timestamp", "id", "createdAt"]` |
| `variables` | Variables to preserve after cleanup | `["mule_base_url","boomi_base_url"]` |

**Optional Authentication Variables:**

| Variable | Description |
|----------|-------------|
| `boomi_auth_type` | Auth type: `same`, `basic`, `bearer`, or `api-key` |
| `boomi_username` | For basic auth |
| `boomi_password` | For basic auth |
| `boomi_bearer_token` | For bearer token auth |
| `boomi_api_key` | For API key auth |
| `boomi_api_key_header` | Header name for API key (default: `X-API-Key`) |

### 2. URL Pattern

Your Mule requests should follow this pattern:
```
https://mule-base.com:443/service-name/ws/rest/endpoint
```

The framework automatically transforms to:
```
https://boomi-base.com/ws/rest/endpoint
```

**Note:** Port numbers (`:443`, `:8080`) are handled automatically. Service names are stripped before `/ws/rest/`.

***

## Usage Guide

### Individual Request Testing

**Purpose:** Test a single API endpoint with visual comparison

**Steps:**
1. Select any request in the collection (except utility requests starting with `_` or `

**Visual Output:**
- **Green rows** - Matching fields
- **Red rows** - Mismatched values
- **Yellow rows** - Exempted fields
- **Blank lines** - Missing fields in one response
- **Arrows** - Direction of mismatch (→ only in Boomi, ← only in Mule)

### Collection Runner (Regression Testing)

**Purpose:** Run multiple API tests and generate comprehensive report

**Steps:**
1. Click **Runner** button (top right)
2. Select your collection
3. Configure:
   - Iterations: `1`
   - Delay: `500ms` (recommended)
4. Click **Run Collection**
5. After completion, execute the **[REPORT]** request
6. View results in **Visualize** tab
7. Click **Copy Summary CSV** or **Copy Full CSV** to export

**Report Contents:**
- **Summary CSV** - Statistics only (small file)
- **Full CSV** - Includes complete cURL commands and full responses (use for defect reporting)

***

## Understanding Results

### Test Status

| Status | Meaning |
|--------|---------|
| **PASSED** | All fields match (excluding exempted fields) |
| **FAILED** | One or more mismatches detected |

### Statistics

- **Total Lines** - Number of JSON lines compared
- **Matched** - Lines with identical values
- **Mismatched** - Lines with different values
- **Exempted** - Lines excluded from comparison (configured fields)
- **Match %** - Percentage of matching lines

### Visual Comparison Legend

| Color | Status |
|-------|--------|
| White | Match |
| Light Red | Mismatch |
| Light Yellow | Exempted |
| Light Yellow (pale) | Only in Boomi |
| Light Blue | Only in Mule |

***

## Best Practices

### 1. Configure Exempted Fields

Always exempt fields that legitimately differ:
```json
["timestamp", "requestId", "correlationId", "createdDate", "uuid"]
```

### 2. Clean Between Runs

Execute the **[CLEANUP]** request before starting a new test run to clear old data.

### 3. Handle Dynamic Variables

Headers using Postman variables like `{{$guid}}` are automatically resolved to actual values in cURL commands.

### 4. Review Failed Tests

When tests fail:
1. Check the individual request's **Visualize** tab
2. Look for the **arrow indicators** showing where differences occur
3. Use the **Full CSV** cURL column to reproduce the exact request

### 5. Batch Testing Strategy

For large test suites:
- Group related endpoints in folders
- Run folders independently
- Use meaningful request names
- Add delays between requests (500ms recommended)

***

## Utility Requests

These special requests manage the testing framework:

| Request | Purpose | When to Use |
|---------|---------|-------------|
| `[CLEANUP]` | Clear all test data | Before starting new test run |
| `[REPORT]` | Generate CSV report | After collection runner completes |

**Note:** Requests starting with `_` or `

***

## Troubleshooting

### Issue: "Timeout waiting for Boomi response"
**Solution:** Increase `maxAttempts` or `pollInterval` in Collection Post-request Script

### Issue: Boomi URL transformation fails
**Solution:** Verify `mule_base_url` and `boomi_base_url` are set correctly. Check console for transformation logs.

### Issue: cURL commands truncated in CSV
**Solution:** This should not happen. If it does, check Collection Post-request Script's `escapeCSV` function.

### Issue: Array elements misaligned
**Solution:** Primitive arrays are automatically sorted before comparison. Check if values truly differ.

### Issue: Copy to clipboard doesn't work
**Solution:** Use the button in the Visualize tab, not browser's right-click copy.

***

## Advanced Configuration

### Custom URL Transformation

If your URL pattern differs, modify the `transformMuleUrlToBoomi` function in **Collection Pre-request Script**:

```javascript
function transformMuleUrlToBoomi(requestUrl, muleBase, boomiBase) {
    const fullUrl = requestUrl.toString();
    let result = fullUrl.replace(muleBase, boomiBase);
    result = result.replace(/\/[^\/]+\/ws\/rest\//, '/ws/rest/');
    return result;
}
```

### Extending Exempted Fields

Add to exempted fields dynamically in request Pre-request Scripts:

```javascript
const exempted = JSON.parse(pm.collectionVariables.get("exempted_fields"));
exempted.push("newFieldToExempt");
pm.collectionVariables.set("exempted_fields", JSON.stringify(exempted));
```

***

## Report Format

### Summary CSV Columns

1. Serial Number
2. Request Name
3. Status (PASSED/FAILED)
4. Match Percentage
5. Total Lines
6. Matched Lines
7. Mismatched Lines
8. Exempted Lines
9. Boomi Status Code
10. MuleSoft Status Code
11. Timestamp

### Full CSV Additional Columns

12. **cURL Command** - Complete executable command
13. **Boomi Response** - Full JSON response
14. **MuleSoft Response** - Full JSON response

***

## Developer Defect Workflow

When filing defects based on test failures:

1. Run the failing request individually
2. Take screenshot of **Visualize** tab showing differences
3. Copy **Full CSV** from [REPORT] request
4. Extract the **cURL command** for the failed request
5. Include in defect:
   - Screenshot of comparison
   - cURL command
   - Expected vs Actual values
   - Match percentage

---

## Performance Tips

- Use **Collection Runner** for batch testing (faster than manual)
- Set appropriate delays between requests (500ms default)
- Clean up between runs to avoid memory issues
- Export CSV reports immediately after generation
- For large responses, consider increasing Postman's timeout settings

***

## Support & Maintenance

**Version:** 1.0  
**Last Updated:** October 2025  
**Signature:** S. 2025

For questions or issues, review the console logs in Postman for detailed debugging information.