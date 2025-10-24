// Skip if this is a utility/debug request (starts with underscore or bracket)
if (pm.info.requestName.startsWith("_") || pm.info.requestName.startsWith("[")) {
    console.log("Skipping utility request:", pm.info.requestName);
    return;
}

// Skip if no URL (shouldn't happen, but safety check)
if (!pm.request.url) {
    return;
}

console.log(`\n=== Processing Request: ${pm.info.requestName} ===`);

// Get base URLs from collection variables
const muleBaseUrl = pm.collectionVariables.get("mule_base_url");
const boomiBaseUrl = pm.collectionVariables.get("boomi_base_url");

// Validate configuration
if (!muleBaseUrl || !boomiBaseUrl) {
    console.error("Missing base URLs in collection variables");
    console.error("Required: mule_base_url, boomi_base_url");
    return;
}

// Get current request details
const currentRequest = pm.request;
const method = currentRequest.method;
const requestUrl = pm.request.url;

console.log("HTTP Method:", method);

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

// Extract and copy ALL headers (excluding host-specific ones)
const headers = {};
const excludedHeaders = ['host', 'content-length', 'connection', 'user-agent', 'postman-token'];

currentRequest.headers.each((header) => {
    const headerKey = header.key.toLowerCase();
    
    // Skip disabled headers and excluded ones
    if (!header.disabled && !excludedHeaders.includes(headerKey)) {
        headers[header.key] = header.value;
    }
});

console.log("Headers copied:", Object.keys(headers).length);

// Extract body payload for POST, PUT, PATCH, DELETE
let requestBody = null;
let bodyMode = null;

if (currentRequest.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    bodyMode = currentRequest.body.mode;
    
    console.log("Body mode:", bodyMode);
    
    switch(bodyMode) {
        case 'raw':
            requestBody = currentRequest.body.raw;
            console.log("Raw body length:", requestBody ? requestBody.length : 0);
            break;
            
        case 'formdata':
            const formData = {};
            currentRequest.body.formdata.each((item) => {
                if (!item.disabled) {
                    formData[item.key] = item.value;
                }
            });
            requestBody = formData;
            console.log("Form data fields:", Object.keys(formData).length);
            break;
            
        case 'urlencoded':
            const urlencodedData = {};
            currentRequest.body.urlencoded.each((item) => {
                if (!item.disabled) {
                    urlencodedData[item.key] = item.value;
                }
            });
            requestBody = urlencodedData;
            console.log("URL-encoded fields:", Object.keys(urlencodedData).length);
            break;
            
        case 'graphql':
            requestBody = JSON.stringify({
                query: currentRequest.body.graphql.query,
                variables: currentRequest.body.graphql.variables
            });
            console.log("GraphQL body prepared");
            break;
            
        default:
            console.warn("Unsupported body mode:", bodyMode);
    }
}

// Handle Content-Type explicitly
if (requestBody && method !== 'GET') {
    const existingContentType = headers['Content-Type'] || headers['content-type'];
    
    if (!existingContentType && bodyMode === 'raw') {
        // Auto-detect based on body content
        const trimmedBody = requestBody.trim();
        if (trimmedBody.startsWith('{') || trimmedBody.startsWith('[')) {
            headers['Content-Type'] = 'application/json';
            console.log("Auto-detected Content-Type: application/json");
        } else if (trimmedBody.startsWith('<')) {
            headers['Content-Type'] = 'application/xml';
            console.log("Auto-detected Content-Type: application/xml");
        } else {
            headers['Content-Type'] = 'text/plain';
            console.log("Auto-detected Content-Type: text/plain");
        }
    }
}

// Handle authentication if needed (optional)
const authType = pm.collectionVariables.get("boomi_auth_type") || "same";

if (authType !== "same") {
    if (authType === "basic") {
        const boomiUsername = pm.collectionVariables.get("boomi_username");
        const boomiPassword = pm.collectionVariables.get("boomi_password");
        
        if (boomiUsername && boomiPassword) {
            const credentials = btoa(boomiUsername + ":" + boomiPassword);
            headers['Authorization'] = 'Basic ' + credentials;
            console.log("Added Basic authentication for Boomi");
        }
        
    } else if (authType === "bearer") {
        const boomiToken = pm.collectionVariables.get("boomi_bearer_token");
        
        if (boomiToken) {
            headers['Authorization'] = 'Bearer ' + boomiToken;
            console.log("Added Bearer token for Boomi");
        }
        
    } else if (authType === "api-key") {
        const boomiApiKey = pm.collectionVariables.get("boomi_api_key");
        const boomiApiKeyHeader = pm.collectionVariables.get("boomi_api_key_header") || "X-API-Key";
        
        if (boomiApiKey) {
            headers[boomiApiKeyHeader] = boomiApiKey;
            console.log("Added API key for Boomi:", boomiApiKeyHeader);
        }
    }
}

// Build Boomi request object
const boomiRequest = {
    url: boomiUrl,
    method: method,
    header: headers
};

// Add body if applicable
if (requestBody) {
    if (bodyMode === 'raw') {
        boomiRequest.body = {
            mode: 'raw',
            raw: requestBody
        };
    } else if (bodyMode === 'formdata') {
        boomiRequest.body = {
            mode: 'formdata',
            formdata: requestBody
        };
    } else if (bodyMode === 'urlencoded') {
        boomiRequest.body = {
            mode: 'urlencoded',
            urlencoded: requestBody
        };
    } else {
        boomiRequest.body = {
            mode: 'raw',
            raw: typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody)
        };
    }
}

console.log("\n📋 Boomi Request Summary:");
console.log("  Method:", boomiRequest.method);
console.log("  URL:", boomiRequest.url);
console.log("  Headers:", Object.keys(boomiRequest.header).length);
console.log("  Has Body:", !!boomiRequest.body);

// Make Boomi request
console.log("\n📡 Sending Boomi request...");

pm.sendRequest(boomiRequest, (err, response) => {
    if (err) {
        console.error("Boomi request failed:", err);
        pm.collectionVariables.set("boomi_response", "ERROR: " + err.message);
        pm.collectionVariables.set("boomi_status", 0);
        pm.collectionVariables.set("boomi_error", JSON.stringify(err));
    } else {
        const responseText = response.text();
        pm.collectionVariables.set("boomi_response", responseText);
        pm.collectionVariables.set("boomi_status", response.code);
        pm.collectionVariables.set("boomi_error", null);
        
        console.log("Boomi response received");
        console.log("  Status:", response.code);
        console.log("  Length:", responseText.length);
        console.log("  Content-Type:", response.headers.get('content-type'));
    }
});
