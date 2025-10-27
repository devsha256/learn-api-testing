// Skip utility requests
if (pm.info.requestName.startsWith("_") || pm.info.requestName.startsWith("[")) {
    console.log("Skipping pre-request for: " + pm.info.requestName);
    return;
}

const requestCounter = pm.collectionVariables.get("report_request_count");
if (!requestCounter || requestCounter === "0") {
    pm.collectionVariables.set("report_request_count", "0");
}

const currentCount = parseInt(pm.collectionVariables.get("report_request_count") || "0") + 1;
pm.collectionVariables.set("report_request_count", currentCount.toString());
pm.collectionVariables.set("current_report_index", currentCount.toString());

console.log("Processing request #" + currentCount + ": " + pm.info.requestName);

const muleBaseUrl = pm.collectionVariables.get("mule_base_url");
const boomiBaseUrl = pm.collectionVariables.get("boomi_base_url");

if (!muleBaseUrl || !boomiBaseUrl) {
    console.error("Missing base URLs in collection variables");
    return;
}

const currentRequest = pm.request;
const method = currentRequest.method;
const requestUrl = pm.request.url;

function transformMuleUrlToBoomi(requestUrl, muleBase, boomiBase) {
    try {
        const fullUrl = requestUrl.toString();
        
        // Parse URLs using native URL API
        const muleBaseUrl = new URL(muleBase);
        const boomiBaseUrl = new URL(boomiBase);
        const fullUrlObj = new URL(fullUrl);
        
        // Get origins (protocol + host + port)
        const muleOrigin = muleBaseUrl.origin;
        const boomiOrigin = boomiBaseUrl.origin;
        
        console.log("Mule origin: " + muleOrigin);
        console.log("Boomi origin: " + boomiOrigin);
        console.log("Full request path: " + fullUrlObj.pathname);
        
        // Get the path after the mule base
        let requestPath = fullUrlObj.pathname;
        
        // Remove mule base path if it exists (usually just "/")
        const muleBasePath = muleBaseUrl.pathname;
        if (muleBasePath !== '/' && requestPath.startsWith(muleBasePath)) {
            requestPath = requestPath.substring(muleBasePath.length);
        }
        
        // Ensure path starts with /
        if (!requestPath.startsWith('/')) {
            requestPath = '/' + requestPath;
        }
        
        // Split into segments
        const pathSegments = requestPath.split('/').filter(s => s.length > 0);
        console.log("Path segments: [" + pathSegments.join(', ') + "]");
        
        // AUTOMATICALLY REMOVE APP NAME (first segment if it's not a standard API keyword)
        if (pathSegments.length > 0) {
            const firstSegment = pathSegments[0];
            const standardApiKeywords = ['ws', 'api', 'rest', 'graphql', 'v1', 'v2', 'v3'];
            
            // If first segment is NOT a standard API keyword, it's likely an app name - remove it
            if (!standardApiKeywords.includes(firstSegment.toLowerCase())) {
                console.log("Auto-removing app name: " + firstSegment);
                pathSegments.shift(); // Remove first segment
            }
        }
        
        // Reconstruct path
        const finalPath = '/' + pathSegments.join('/');
        console.log("Final path: " + finalPath);
        
        // Add boomi base path if it exists
        const boomiBasePath = boomiBaseUrl.pathname;
        const boomiFullPath = (boomiBasePath !== '/' && boomiBasePath) 
            ? boomiBasePath + finalPath 
            : finalPath;
        
        // Build final URL
        const boomiUrl = boomiOrigin + boomiFullPath + fullUrlObj.search;
        
        console.log("Transformed URL: " + boomiUrl);
        return boomiUrl;
        
    } catch (error) {
        console.error("URL transformation error: " + error.message);
        return null;
    }
}

const boomiUrl = transformMuleUrlToBoomi(requestUrl, muleBaseUrl, boomiBaseUrl);

console.log("Mule URL: " + requestUrl.toString());
console.log("Boomi URL: " + boomiUrl);

if (!boomiUrl) {
    console.error("Failed to generate Boomi URL");
    return;
}

// Collect headers with RESOLVED VALUES (not variables)
const headers = {};
const excludedHeaders = ['host', 'content-length', 'connection', 'user-agent', 'postman-token'];

currentRequest.headers.each(function(header) {
    const headerKey = header.key.toLowerCase();
    if (!header.disabled && excludedHeaders.indexOf(headerKey) === -1) {
        // Use pm.variables.replaceIn to resolve dynamic variables like {{$guid}}
        const resolvedValue = pm.variables.replaceIn(header.value);
        headers[header.key] = resolvedValue;
    }
});

let requestBody = null;
let bodyMode = null;

if (currentRequest.body && ['POST', 'PUT', 'PATCH', 'DELETE'].indexOf(method) !== -1) {
    bodyMode = currentRequest.body.mode;
    switch(bodyMode) {
        case 'raw':
            // Resolve variables in body too
            requestBody = pm.variables.replaceIn(currentRequest.body.raw);
            break;
        case 'formdata':
            const formData = {};
            currentRequest.body.formdata.each(function(item) {
                if (!item.disabled) {
                    formData[item.key] = pm.variables.replaceIn(item.value);
                }
            });
            requestBody = formData;
            break;
        case 'urlencoded':
            const urlencodedData = {};
            currentRequest.body.urlencoded.each(function(item) {
                if (!item.disabled) {
                    urlencodedData[item.key] = pm.variables.replaceIn(item.value);
                }
            });
            requestBody = urlencodedData;
            break;
        case 'graphql':
            requestBody = JSON.stringify({
                query: pm.variables.replaceIn(currentRequest.body.graphql.query),
                variables: currentRequest.body.graphql.variables
            });
            break;
    }
}

if (requestBody && method !== 'GET') {
    const existingContentType = headers['Content-Type'] || headers['content-type'];
    if (!existingContentType && bodyMode === 'raw') {
        const trimmedBody = requestBody.trim();
        if (trimmedBody.startsWith('{') || trimmedBody.startsWith('[')) {
            headers['Content-Type'] = 'application/json';
        } else if (trimmedBody.startsWith('<')) {
            headers['Content-Type'] = 'application/xml';
        }
    }
}

const authType = pm.collectionVariables.get("boomi_auth_type") || "same";

if (authType !== "same") {
    if (authType === "basic") {
        const boomiUsername = pm.collectionVariables.get("boomi_username");
        const boomiPassword = pm.collectionVariables.get("boomi_password");
        if (boomiUsername && boomiPassword) {
            headers['Authorization'] = 'Basic ' + btoa(boomiUsername + ":" + boomiPassword);
        }
    } else if (authType === "bearer") {
        const boomiToken = pm.collectionVariables.get("boomi_bearer_token");
        if (boomiToken) {
            headers['Authorization'] = 'Bearer ' + boomiToken;
        }
    } else if (authType === "api-key") {
        const boomiApiKey = pm.collectionVariables.get("boomi_api_key");
        const boomiApiKeyHeader = pm.collectionVariables.get("boomi_api_key_header") || "X-API-Key";
        if (boomiApiKey) {
            headers[boomiApiKeyHeader] = boomiApiKey;
        }
    }
}

const boomiRequest = {
    url: boomiUrl,
    method: method,
    header: headers
};

if (requestBody) {
    if (bodyMode === 'raw') {
        boomiRequest.body = { mode: 'raw', raw: requestBody };
    } else if (bodyMode === 'formdata') {
        boomiRequest.body = { mode: 'formdata', formdata: requestBody };
    } else if (bodyMode === 'urlencoded') {
        boomiRequest.body = { mode: 'urlencoded', urlencoded: requestBody };
    } else {
        boomiRequest.body = { mode: 'raw', raw: typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody) };
    }
}

// Generate COMPLETE cURL with resolved values
let curlCommand = 'curl --location \'' + requestUrl.toString() + '\'';

if (method !== 'GET') {
    curlCommand += ' \\\n--request ' + method;
}

// Add all headers with RESOLVED values
const headerKeys = Object.keys(headers);
headerKeys.forEach(function(headerKey) {
    const headerValue = headers[headerKey];
    const escapedValue = String(headerValue).replace(/'/g, "'\\''");
    curlCommand += ' \\\n--header \'' + headerKey + ': ' + escapedValue + '\'';
});

// Add COMPLETE body without any truncation
if (requestBody && bodyMode === 'raw') {
    let escapedBody = String(requestBody).replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
    curlCommand += ' \\\n--data-raw \'' + escapedBody + '\'';
}

// Store in collection variable - NO LENGTH LIMIT
pm.collectionVariables.set("temp_request_name", pm.info.requestName);
pm.collectionVariables.set("temp_request_curl", curlCommand);

console.log("cURL generated successfully, length: " + curlCommand.length + " characters");

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
