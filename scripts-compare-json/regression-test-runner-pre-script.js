// ========================================================================
// REGRESSION TEST RUNNER - Pre-request Script
// This script runs ONLY for the [Regression Test Runner] request
// ========================================================================

const regressionMode = pm.collectionVariables.get("regression_mode");

if (regressionMode !== "true") {
    console.log("Not in regression mode, skipping...");
    return;
}

console.log("=== REGRESSION TEST RUNNER STARTED ===");

// Get data extracted by collection pre-request
const curlCommand = pm.collectionVariables.get("regression_curl");
const requestName = pm.collectionVariables.get("regression_request_name");

if (!curlCommand) {
    console.error("No cURL command found from collection pre-request");
    return;
}

console.log("Processing: " + requestName);

// ========================================================================
// cURL Parsing Functions
// ========================================================================

function extractUrlFromCurl(curlCommand) {
    if (!curlCommand || typeof curlCommand !== 'string') {
        return null;
    }
    
    // Pattern 1: curl --location 'URL'
    let match = curlCommand.match(/curl\s+--location\s+'([^']+)'/);
    if (match && match[1]) return match[1];
    
    // Pattern 2: curl --location "URL"
    match = curlCommand.match(/curl\s+--location\s+"([^"]+)"/);
    if (match && match[1]) return match[1];
    
    // Pattern 3: curl 'URL'
    match = curlCommand.match(/curl\s+'([^']+)'/);
    if (match && match[1]) return match[1];
    
    // Pattern 4: curl "URL"
    match = curlCommand.match(/curl\s+"([^"]+)"/);
    if (match && match[1]) return match[1];
    
    // Pattern 5: curl URL (without quotes, before any --)
    match = curlCommand.match(/curl\s+([^\s-][^\s]*)/);
    if (match && match[1]) return match[1];
    
    return null;
}

function extractMethodFromCurl(curlCommand) {
    const match = curlCommand.match(/--request\s+(\w+)/);
    return match ? match[1] : 'GET';
}

function extractHeadersFromCurl(curlCommand) {
    const headers = {};
    const headerRegex = /--header\s+'([^:]+):\s*([^']+)'/g;
    let match;
    while ((match = headerRegex.exec(curlCommand)) !== null) {
        headers[match[1].trim()] = match[2].trim();
    }
    return headers;
}

function extractBodyFromCurl(curlCommand) {
    const match = curlCommand.match(/--data-raw\s+'([\s\S]*?)'\s*$/);
    if (match && match[1]) {
        // Unescape single quotes and backslashes
        return match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    }
    return null;
}

function transformMuleUrlToBoomi(requestUrl, muleBase, boomiBase) {
    let result = requestUrl.replace(muleBase, boomiBase);
    result = result.replace(/\/[^\/]+\/ws\/rest\//, '/ws/rest/');
    return result;
}

// ========================================================================
// Extract Request Components from cURL
// ========================================================================

const extractedUrl = extractUrlFromCurl(curlCommand);
const extractedMethod = extractMethodFromCurl(curlCommand);
const extractedHeaders = extractHeadersFromCurl(curlCommand);
const extractedBody = extractBodyFromCurl(curlCommand);

if (!extractedUrl) {
    console.error("Could not extract URL from cURL command");
    console.log("cURL: " + curlCommand);
    return;
}

console.log("Extracted URL: " + extractedUrl);
console.log("Extracted Method: " + extractedMethod);
console.log("Extracted Headers: " + Object.keys(extractedHeaders).length);
console.log("Has Body: " + (extractedBody ? "Yes" : "No"));

// ========================================================================
// Configure Mule Request (Override placeholder)
// ========================================================================

pm.request.url = extractedUrl;
pm.request.method = extractedMethod;

// Clear and set headers
pm.request.headers.clear();
Object.keys(extractedHeaders).forEach(function(key) {
    pm.request.headers.add({
        key: key,
        value: extractedHeaders[key]
    });
});

// Set body if exists
if (extractedBody) {
    pm.request.body = {
        mode: 'raw',
        raw: extractedBody
    };
}

console.log("Mule request configured: " + extractedMethod + " " + extractedUrl);

// ========================================================================
// Prepare and Send Boomi Request
// ========================================================================

// Get base URLs
const muleBaseUrl = pm.variables.replaceIn(pm.collectionVariables.get("mule_base_url"));
const boomiBaseUrl = pm.variables.replaceIn(pm.collectionVariables.get("boomi_base_url"));

if (!muleBaseUrl || !boomiBaseUrl) {
    console.error("Missing base URLs in collection variables");
    return;
}

// Transform URL for Boomi
const boomiUrl = transformMuleUrlToBoomi(extractedUrl, muleBaseUrl, boomiBaseUrl);
console.log("Boomi URL: " + boomiUrl);

// Get auth configuration
const authType = pm.collectionVariables.get("boomi_auth_type") || "same";

// Prepare Boomi headers (start with extracted headers)
const boomiHeaders = Object.assign({}, extractedHeaders);

// Override auth if needed
if (authType !== "same") {
    if (authType === "basic") {
        const boomiUsername = pm.collectionVariables.get("boomi_username");
        const boomiPassword = pm.collectionVariables.get("boomi_password");
        if (boomiUsername && boomiPassword) {
            boomiHeaders['Authorization'] = 'Basic ' + btoa(boomiUsername + ":" + boomiPassword);
        }
    } else if (authType === "bearer") {
        const boomiToken = pm.collectionVariables.get("boomi_bearer_token");
        if (boomiToken) {
            boomiHeaders['Authorization'] = 'Bearer ' + boomiToken;
        }
    } else if (authType === "api-key") {
        const boomiApiKey = pm.collectionVariables.get("boomi_api_key");
        const boomiApiKeyHeader = pm.collectionVariables.get("boomi_api_key_header") || "X-API-Key";
        if (boomiApiKey) {
            boomiHeaders[boomiApiKeyHeader] = boomiApiKey;
        }
    }
}

// Prepare Boomi request object
const boomiRequest = {
    url: boomiUrl,
    method: extractedMethod,
    header: boomiHeaders
};

// Add body if exists
if (extractedBody) {
    boomiRequest.body = {
        mode: 'raw',
        raw: extractedBody
    };
}

// Store request info for post-request comparison
pm.collectionVariables.set("temp_request_name", requestName);
pm.collectionVariables.set("temp_request_curl", curlCommand);

// Send Boomi request
console.log("Sending Boomi request...");
pm.sendRequest(boomiRequest, function(err, response) {
    if (err) {
        console.error("Boomi request failed:", err.message);
        pm.collectionVariables.set("boomi_response", "ERROR: " + err.message);
        pm.collectionVariables.set("boomi_status", 0);
    } else {
        pm.collectionVariables.set("boomi_response", response.text());
        pm.collectionVariables.set("boomi_status", response.code);
        console.log("Boomi response received: " + response.code);
    }
});

console.log("=== REGRESSION PRE-REQUEST COMPLETE ===");
console.log("Mule request will now execute...");
