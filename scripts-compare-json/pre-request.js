// ========================================================================
// REGRESSION MODE DETECTION - CHECK THIS FIRST
// ========================================================================
const isCollectionRunner = pm.info.iteration !== undefined && pm.info.iteration >= 0;
const hasCurlData = pm.iterationData.get("cURL Command");

if (isCollectionRunner && hasCurlData) {
    console.log("=== REGRESSION MODE DETECTED ===");
    
    // Extract data from CSV and store in collection variables
    pm.collectionVariables.set("regression_mode", "true");
    pm.collectionVariables.set("regression_curl", pm.iterationData.get("cURL Command"));
    pm.collectionVariables.set("regression_request_name", pm.iterationData.get("Request Name") || "Unknown");
    
    // Initialize counter
    const requestCounter = pm.collectionVariables.get("report_request_count");
    if (!requestCounter || requestCounter === "0") {
        pm.collectionVariables.set("report_request_count", "0");
    }
    
    const currentCount = parseInt(pm.collectionVariables.get("report_request_count") || "0") + 1;
    pm.collectionVariables.set("report_request_count", currentCount.toString());
    pm.collectionVariables.set("current_report_index", currentCount.toString());
    
    console.log("Regression test #" + currentCount + ": " + pm.iterationData.get("Request Name"));
    console.log("Variables set. Allowing [Regression Test Runner] to execute...");
    
    // Allow the regression request to run - don't skip
    return;
}

// Clear regression mode flag
pm.collectionVariables.set("regression_mode", "false");

// ========================================================================
// SKIP UTILITY REQUESTS - ONLY FOR NORMAL MODE
// ========================================================================
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

const muleBaseUrl = pm.variables.replaceIn(pm.collectionVariables.get("mule_base_url"));
const boomiBaseUrl = pm.variables.replaceIn(pm.collectionVariables.get("boomi_base_url"));

if (!muleBaseUrl || !boomiBaseUrl) {
    console.error("Missing base URLs in collection variables");
    return;
}

const currentRequest = pm.request;
const method = currentRequest.method;
const requestUrl = pm.variables.replaceIn(pm.request.url.toString());

function transformMuleUrlToBoomi(requestUrl, muleBase, boomiBase) {
    const fullUrl = requestUrl;
    let result = fullUrl.replace(muleBase, boomiBase);
    result = result.replace(/\/[^\/]+\/ws\/rest\//, '/ws/rest/');
    return result;
}

const boomiUrl = transformMuleUrlToBoomi(requestUrl, muleBaseUrl, boomiBaseUrl);

console.log("Mule URL: " + requestUrl);
console.log("Boomi URL: " + boomiUrl);

if (!boomiUrl) {
    console.error("Failed to generate Boomi URL");
    return;
}

const headers = {};
const excludedHeaders = ['host', 'content-length', 'connection', 'user-agent', 'postman-token'];

currentRequest.headers.each(function(header) {
    const headerKey = header.key.toLowerCase();
    if (!header.disabled && excludedHeaders.indexOf(headerKey) === -1) {
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

let curlCommand = 'curl --location \'' + requestUrl + '\'';

if (method !== 'GET') {
    curlCommand += ' \\\n--request ' + method;
}

const headerKeys = Object.keys(headers);
headerKeys.forEach(function(headerKey) {
    const headerValue = headers[headerKey];
    const escapedValue = String(headerValue).replace(/'/g, "'\\''");
    curlCommand += ' \\\n--header \'' + headerKey + ': ' + escapedValue + '\'';
});

if (requestBody && bodyMode === 'raw') {
    let escapedBody = String(requestBody).replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
    curlCommand += ' \\\n--data-raw \'' + escapedBody + '\'';
}

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
