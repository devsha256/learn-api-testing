# SOAP/XML API Comparison Testing Framework - User Guide

## Overview

This Postman collection provides automated comparison testing between Mule and Boomi SOAP/XML API implementations. It executes SOAP requests against both systems simultaneously, compares XML responses, and generates detailed reports with visual side-by-side XML comparisons.

***

## Features

 **Dual SOAP API Testing** - Automatically calls both Mule and Boomi SOAP APIs in parallel  
 **Smart XML Comparison** - Intelligently compares XML/SOAP responses with proper element alignment  
 **Visual XML Diff Display** - Side-by-side XML visualization with color-coded differences  
 **Exempted XML Elements** - Skip comparison for specific elements (timestamps, IDs, etc.)  
 **CSV Reports** - Export full test results including complete SOAP requests  
 **Individual & Batch Testing** - Run single SOAP requests or entire collection  
 **Namespace Aware** - Handles SOAP namespaces and prefixes correctly  

***

## Setup Instructions

### 1. Collection Variables

Configure these variables in your collection:

| Variable | Description | Example |
|----------|-------------|---------|
| `mule_base_url` | Mule SOAP API base URL | `https://mule-api.company.com` |
| `boomi_base_url` | Boomi SOAP API base URL | `https://boomi-api.company.com` |
| `exempted_xml_paths` | JSON array of XML elements to skip | `["timestamp", "requestId", "correlationId"]` |
| `variables` | Variables to preserve after cleanup | `["mule_base_url","boomi_base_url"]` |

**Optional Authentication Variables:**

| Variable | Description |
|----------|-------------|
| `boomi_auth_type` | Auth type: `same`, `basic`, or `bearer` |
| `boomi_username` | For basic auth |
| `boomi_password` | For basic auth |
| `boomi_bearer_token` | For bearer token auth |

### 2. URL Pattern

Your Mule SOAP requests should follow this pattern:
```
https://mule-base.com:443/service-name/ws/soap/endpoint
```

The framework automatically transforms to:
```
https://boomi-base.com/ws/soap/endpoint
```

**Note:** 
- Port numbers (`:443`, `:8080`) are handled automatically
- Service names are stripped before `/ws/soap/` or `/ws/rest/`
- Works for both SOAP and REST XML responses

***

## Usage Guide

### Individual SOAP Request Testing

**Purpose:** Test a single SOAP endpoint with visual XML comparison

**Steps:**
1. Select any SOAP request in the collection (except utility requests starting with `_` or `

**Visual Output:**
- **White rows** - Matching XML elements
- **Light Red rows** - Mismatched elements or values
- **Light Yellow rows** - Exempted elements
- **Pale Yellow rows** - Elements only in Boomi response
- **Light Blue rows** - Elements only in Mule response
- **Arrows** - Direction of mismatch (→ only in Boomi, ← only in Mule, ↔ value differs)

**XML Display Format:**
- Simple elements: `<status>SUCCESS</status>` (single line)
- Complex elements: Multi-line with proper indentation
- Proper HTML escaping: `<`, `>` displayed correctly
- Maintains XML hierarchy and structure

### Collection Runner (Regression Testing)

**Purpose:** Run multiple SOAP tests and generate comprehensive report

**Steps:**
1. Click **Runner** button (top right)
2. Select your collection
3. Configure:
   - Iterations: `1`
   - Delay: `500ms` (recommended for SOAP APIs)
4. Click **Run Collection**
5. After completion, execute the **[REPORT]** request
6. View results in **Visualize** tab
7. Click **Copy Summary CSV** or **Copy Full CSV** to export

**Report Contents:**
- **Summary CSV** - Statistics only (lightweight)
- **Full CSV** - Includes complete SOAP request XML and full responses

***

## Understanding XML Comparison Results

### Test Status

| Status | Meaning |
|--------|---------|
| **PASSED** | All XML elements match (excluding exempted elements) |
| **FAILED** | One or more XML elements differ |

### Statistics

- **Total Lines** - Number of XML lines compared
- **Matched** - Lines with identical XML elements
- **Mismatched** - Lines with different values or structure
- **Exempted** - Lines excluded from comparison (configured elements)
- **Match %** - Percentage of matching lines

### XML Element Comparison Rules

1. **Tag Names** - Must match exactly (case-sensitive)
2. **Text Content** - Compared after trimming whitespace
3. **Attributes** - Not currently compared (focus on element structure)
4. **Order** - Elements compared in document order
5. **Namespaces** - Prefixes ignored, comparing local names only

***

## Working with SOAP Responses

### SOAP Envelope Structure

The framework handles standard SOAP envelopes:

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <!-- Headers compared if present -->
  </soap:Header>
  <soap:Body>
    <!-- Main response body compared -->
  </soap:Body>
</soap:Envelope>
```

### SOAP Faults

SOAP fault responses are compared just like success responses:
- Fault codes are compared
- Fault strings are compared
- Detail elements are compared

Status codes 500 are accepted for fault responses.

***

## Best Practices

### 1. Configure Exempted XML Elements

Always exempt elements that legitimately differ between systems:

```json
["timestamp", "requestId", "correlationId", "uuid", "generatedDate"]
```

The comparison will skip any XML element whose tag name contains these strings.

### 2. Clean Between Runs

Execute the **[CLEANUP]** request before starting a new test run to clear old data.

### 3. Handle SOAP Headers

If your SOAP requests include custom headers (like WS-Security), ensure they're properly configured in your request headers.

### 4. Content-Type Header

Ensure your SOAP requests use the correct Content-Type:
- SOAP 1.1: `text/xml; charset=utf-8`
- SOAP 1.2: `application/soap+xml; charset=utf-8`

### 5. Review Failed Tests

When SOAP tests fail:
1. Check the individual request's **Visualize** tab
2. Look for **arrow indicators** (→, ←, ↔) showing XML differences
3. Check if difference is in exempted element (should be yellow)
4. Use **Full CSV** SOAP request column to reproduce exact request

***

## XML-Specific Features

### Merged Display for Simple Elements

Elements with only text content display on one line:
```xml
<userId>12345</userId>
```

Elements with child elements display across multiple lines:
```xml
<user>
  <id>12345</id>
  <name>John Doe</name>
</user>
```

### Indentation

XML hierarchy is preserved with indentation:
- Root elements: No indentation
- Child elements: 20px per level
- Nested elements: Cumulative indentation

### HTML Escaping

All XML content is properly escaped for display:
- `<` becomes `&lt;`
- `>` becomes `&gt;`
- `&` becomes `&amp;`

***

## Utility Requests

| Request | Purpose | When to Use |
|---------|---------|-------------|
| `[CLEANUP]` | Clear all test data | Before starting new SOAP test run |
| `[REPORT]` | Generate CSV report | After collection runner completes |

**Note:** Requests starting with `_` or `

***

## Troubleshooting

### Issue: "Timeout waiting for Boomi response"
**Solution:** 
- Increase `maxAttempts` to 30 in Collection Post-request Script
- SOAP APIs can be slower than REST APIs
- Check Boomi endpoint is accessible

### Issue: Boomi URL transformation fails
**Solution:** 
- Verify `mule_base_url` and `boomi_base_url` are set correctly
- Check console for transformation debug output
- Ensure URL follows pattern: `protocol://host/service-name/ws/soap/endpoint`

### Issue: SOAP request body not sent
**Solution:** 
- Ensure request body mode is set to `raw`
- Verify Content-Type header is set
- Check SOAP envelope is valid XML

### Issue: XML elements misaligned in visualization
**Solution:** 
- This can happen with complex nested structures
- Check console logs for parsing errors
- Ensure XML is well-formed (no unclosed tags)

### Issue: Namespaces causing false mismatches
**Solution:** 
- Add namespace prefixes to exempted elements
- Example: `["soap:Header", "xmlns", "ns1:"]`

***

## Advanced Configuration

### Custom SOAP Headers

To add custom SOAP headers (like WS-Security), add them to your request's Headers tab:

```
Content-Type: text/xml; charset=utf-8
SOAPAction: "http://example.com/MyAction"
Authorization: Bearer {{token}}
```

These headers are automatically included in Boomi requests.

### Modifying XML Comparison Logic

To change how XML elements are compared, edit the `alignXMLLines` function in Collection Post-request Script:

```javascript
// Example: Make tag comparison case-insensitive
if (left.tag.toLowerCase() === right.tag.toLowerCase())
```

### Custom URL Transformation

If your URL pattern differs, modify the `transformMuleUrlToBoomi` function in Collection Pre-request Script:

```javascript
function transformMuleUrlToBoomi(requestUrl, muleBase, boomiBase) {
    const fullUrl = requestUrl.toString();
    let result = fullUrl.replace(muleBase, boomiBase);
    // Customize this regex for your pattern
    result = result.replace(/\/[^\/]+\/ws\/soap\//, '/ws/soap/');
    return result;
}
```

***

## CSV Report Format

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

12. **cURL Command** - Complete curl command (note: cURL with XML body may need formatting)
13. **Boomi Response** - Full SOAP/XML response (minified)
14. **MuleSoft Response** - Full SOAP/XML response (minified)

***

## SOAP Defect Reporting Workflow

When filing defects based on SOAP test failures:

1. Run the failing SOAP request individually
2. Take screenshot of **Visualize** tab showing XML differences
3. Copy **Full CSV** from [REPORT] request
4. Extract the **SOAP request XML** from the CSV
5. Include in defect:
   - Screenshot of XML comparison
   - Complete SOAP request XML
   - Expected vs Actual XML elements
   - Match percentage
   - Exempted elements list

***

## Performance Considerations

### SOAP vs REST
- SOAP responses are typically larger than REST
- SOAP parsing takes slightly longer
- Consider increasing delays to 1000ms for large SOAP responses

### Large SOAP Envelopes
- Responses over 100KB may take longer to parse
- Consider exempting large text blocks if they're not critical
- Use minified XML storage to reduce memory usage

### Namespace Handling
- Complex namespace hierarchies increase parsing time
- Framework ignores namespace prefixes for comparison
- Focus is on element structure and content

***

## Known Limitations

1. **Attribute Comparison** - XML attributes are not currently compared (only element structure and text content)
2. **Mixed Content** - Elements with both text and child elements may not display perfectly
3. **CDATA Sections** - CDATA content is treated as regular text
4. **XML Comments** - Comments are ignored (not included in comparison)
5. **Processing Instructions** - PIs are ignored (except XML declaration)

***

## Support & Maintenance

**Version:** 1.0 (XML/SOAP Edition)  
**Last Updated:** October 2025  
**Signature:** S. 2025

For questions or issues:
- Review console logs in Postman for detailed debugging
- Check that XML is well-formed before comparing
- Verify SOAP envelope structure is correct

***

## Comparison with JSON Version

This SOAP/XML framework shares the same architecture as the JSON comparison framework:

| Feature | JSON Version | XML/SOAP Version |
|---------|--------------|------------------|
| Side-by-side comparison |  |  |
| Exempted fields |  |  |
| CSV reports |  |  |
| cURL commands |  |  (SOAP XML body) |
| Individual testing |  |  |
| Batch testing |  |  |
| Smart alignment | Arrays by value | Elements by tag name |
| Display format | JSON tree | XML tree with merged simple elements |
| Namespace support | N/A |  Basic support |

***

## Quick Start Checklist

- [ ] Set `mule_base_url` collection variable
- [ ] Set `boomi_base_url` collection variable
- [ ] Configure `exempted_xml_paths` array
- [ ] Add SOAP requests to collection (with proper Content-Type headers)
- [ ] Test one request individually first
- [ ] Run collection runner for batch testing
- [ ] Execute [REPORT] request
- [ ] Export CSV for records

***

**Ready to test your SOAP APIs? Start with a single request to verify the setup, then scale up to full regression testing!** 