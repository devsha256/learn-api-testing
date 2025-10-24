// Extract current request name
const currentRequestName = pm.info.requestName;

// Skip if this IS the Boomi fetcher (prevent infinite loop)
if (currentRequestName === "_Boomi_Fetcher") {
    return;
}

// Skip if this is a folder or other non-MuleSoft request
if (!pm.request.url || currentRequestName.startsWith("_")) {
    return;
}

console.log(`\n=== Processing Request: ${currentRequestName} ===`);

// Get base URLs from collection variables
const muleBaseUrl = pm.collectionVariables.get("mule_base_url");
const boomiBaseUrl = pm.collectionVariables.get("boomi_base_url");

// Get current request details
const currentRequest = pm.request;
const method = currentRequest.method;
const requestUrl = pm.request.url;

// Build Boomi URL from MuleSoft URL
function transformMuleUrlToBoomi(requestUrl, muleBase, boomiBase) {
    try {
        const fullUrl = requestUrl.toString();
        
        // Extract path after mule base
        let pathAfterBase = fullUrl.replace(muleBase, '');
        if (pathAfterBase.startsWith('/')) {
            pathAfterBase = pathAfterBase.substring(1);
        }
        
        // Separate path and query string
        const urlParts = pathAfterBase.split('?');
        const pathPart = urlParts[0];
        const queryPart = urlParts.length > 1 ? '?' + urlParts[1] : '';
        
        // Remove app-env-name segment
        const pathSegments = pathPart.split('/').filter(s => s.length > 0);
        if (pathSegments.length > 0 && pathSegments[0] !== 'ws') {
            pathSegments.shift(); // Remove first segment (app-env-name)
        }
        
        // Build Boomi URL
        const cleanBoomiBase = boomiBase.replace(/\/$/, '');
        const transformedPath = pathSegments.join('/');
        
        return cleanBoomiBase + '/' + transformedPath + queryPart;
        
    } catch (error) {
        console.error("URL transformation error:", error);
        return null;
    }
}

const boomiUrl = transformMuleUrlToBoomi(requestUrl, muleBaseUrl, boomiBaseUrl);

if (!boomiUrl) {
    console.error("Failed to generate Boomi URL");
    return;
}

console.log("MuleSoft URL:", requestUrl.toString());
console.log("Boomi URL:", boomiUrl);

// Store Boomi URL and request details for the helper
pm.collectionVariables.set("boomi_url_dynamic", boomiUrl);
pm.collectionVariables.set("boomi_method", method);
pm.collectionVariables.set("return_to_request", currentRequestName);

// Copy headers for Boomi request
const headers = {};
currentRequest.headers.each((header) => {
    if (!header.disabled && !header.key.toLowerCase().includes('host')) {
        headers[header.key] = header.value;
    }
});

// Copy body if applicable
let requestBody = null;
if (currentRequest.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (currentRequest.body.mode === 'raw') {
        requestBody = currentRequest.body.raw;
    }
}

// Make Boomi request using pm.sendRequest (async but stored)
const boomiRequest = {
    url: boomiUrl,
    method: method,
    header: headers,
    body: requestBody ? { mode: 'raw', raw: requestBody } : undefined
};

console.log("Fetching Boomi response...");

pm.sendRequest(boomiRequest, (err, response) => {
    if (err) {
        console.error("Boomi request failed:", err);
        pm.collectionVariables.set("boomi_response", "ERROR: " + err.message);
        pm.collectionVariables.set("boomi_status", 0);
    } else {
        pm.collectionVariables.set("boomi_response", response.text());
        pm.collectionVariables.set("boomi_status", response.code);
        console.log("Boomi response received");
        console.log("Status:", response.code);
    }
});
