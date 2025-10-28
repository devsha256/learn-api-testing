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

console.log("Processing SOAP request #" + currentCount + ": " + pm.info.requestName);

const muleBaseUrl = pm.collectionVariables.get("mule_base_url");
const boomiBaseUrl = pm.collectionVariables.get("boomi_base_url");

if (!muleBaseUrl || !boomiBaseUrl) {
    console.error("Missing base URLs");
    return;
}

const currentRequest = pm.request;
const method = currentRequest.method;
const requestUrl = pm.request.url;

// Transform URL
function transformMuleUrlToBoomi(requestUrl, muleBase, boomiBase) {
    const fullUrl = requestUrl.toString();
    let result = fullUrl.replace(muleBase, boomiBase);
    result = result.replace(/\/[^\/]+\/ws\/(soap|rest)\//, '/ws/$1/');
    return result;
}

const boomiUrl = transformMuleUrlToBoomi(requestUrl, muleBaseUrl, boomiBaseUrl);

if (!boomiUrl) {
    console.error("Failed to generate Boomi URL");
    return;
}

// Collect headers
const headers = {};
const excludedHeaders = ['host', 'content-length', 'connection', 'user-agent', 'postman-token'];

currentRequest.headers.each(function(header) {
    if (!header.disabled && excludedHeaders.indexOf(header.key.toLowerCase()) === -1) {
        headers[header.key] = pm.variables.replaceIn(header.value);
    }
});

// Get SOAP/XML body
let requestBody = null;
if (currentRequest.body && currentRequest.body.mode === 'raw') {
    requestBody = pm.variables.replaceIn(currentRequest.body.raw);
}

// Handle auth
const authType = pm.collectionVariables.get("boomi_auth_type") || "same";

if (authType !== "same") {
    if (authType === "basic") {
        const username = pm.collectionVariables.get("boomi_username");
        const password = pm.collectionVariables.get("boomi_password");
        if (username && password) {
            headers['Authorization'] = 'Basic ' + btoa(username + ":" + password);
        }
    } else if (authType === "bearer") {
        const token = pm.collectionVariables.get("boomi_bearer_token");
        if (token) {
            headers['Authorization'] = 'Bearer ' + token;
        }
    }
}

// Build boomi request
const boomiRequest = {
    url: boomiUrl,
    method: method,
    header: headers,
    body: {
        mode: 'raw',
        raw: requestBody
    }
};

// Generate cURL
let curlCommand = 'curl --location \'' + requestUrl.toString() + '\'';
if (method !== 'GET') {
    curlCommand += ' \\\n--request ' + method;
}

Object.keys(headers).forEach(function(key) {
    const escapedValue = String(headers[key]).replace(/'/g, "'\\''");
    curlCommand += ' \\\n--header \'' + key + ': ' + escapedValue + '\'';
});

if (requestBody) {
    const escapedBody = requestBody.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
    curlCommand += ' \\\n--data-raw \'' + escapedBody + '\'';
}

pm.collectionVariables.set("temp_request_name", pm.info.requestName);
pm.collectionVariables.set("temp_request_curl", curlCommand);

console.log("Calling Boomi SOAP API...");

pm.sendRequest(boomiRequest, function(err, response) {
    if (err) {
        console.error("Boomi request failed: " + err.message);
        pm.collectionVariables.set("boomi_response", "ERROR: " + err.message);
        pm.collectionVariables.set("boomi_status", 0);
    } else {
        pm.collectionVariables.set("boomi_response", response.text());
        pm.collectionVariables.set("boomi_status", response.code);
        console.log("Boomi response received: " + response.code);
    }
});
