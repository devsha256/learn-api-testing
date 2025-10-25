// This now properly exits early for [SETUP] and [REPORT] requests
if (pm.info.requestName.startsWith("_") || pm.info.requestName.startsWith("[")) {
    console.log("Skipping utility request: " + pm.info.requestName);
    return; // Exits immediately, doesn't run any comparison logic
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
        let pathAfterBase = fullUrl.replace(muleBase, '');
        if (pathAfterBase.startsWith('/')) {
            pathAfterBase = pathAfterBase.substring(1);
        }
        const urlParts = pathAfterBase.split('?');
        const pathPart = urlParts[0];
        const queryPart = urlParts.length > 1 ? '?' + urlParts[1] : '';
        const pathSegments = pathPart.split('/').filter(s => s.length > 0);
        if (pathSegments.length > 0 && pathSegments[0] !== 'ws') {
            pathSegments.shift();
        }
        const cleanBoomiBase = boomiBase.replace(/\/$/, '');
        const transformedPath = pathSegments.join('/');
        return cleanBoomiBase + '/' + transformedPath + queryPart;
    } catch (error) {
        console.error("URL transformation failed:", error);
        return null;
    }
}

const boomiUrl = transformMuleUrlToBoomi(requestUrl, muleBaseUrl, boomiBaseUrl);

if (!boomiUrl) {
    console.error("Failed to generate Boomi URL");
    return;
}

const headers = {};
const excludedHeaders = ['host', 'content-length', 'connection', 'user-agent', 'postman-token'];

currentRequest.headers.each((header) => {
    const headerKey = header.key.toLowerCase();
    if (!header.disabled && !excludedHeaders.includes(headerKey)) {
        headers[header.key] = header.value;
    }
});

let requestBody = null;
let bodyMode = null;

if (currentRequest.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    bodyMode = currentRequest.body.mode;
    switch(bodyMode) {
        case 'raw':
            requestBody = currentRequest.body.raw;
            break;
        case 'formdata':
            const formData = {};
            currentRequest.body.formdata.each((item) => {
                if (!item.disabled) {
                    formData[item.key] = item.value;
                }
            });
            requestBody = formData;
            break;
        case 'urlencoded':
            const urlencodedData = {};
            currentRequest.body.urlencoded.each((item) => {
                if (!item.disabled) {
                    urlencodedData[item.key] = item.value;
                }
            });
            requestBody = urlencodedData;
            break;
        case 'graphql':
            requestBody = JSON.stringify({
                query: currentRequest.body.graphql.query,
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

let curlCommand = 'curl -X ' + method + ' "' + requestUrl.toString() + '"';
currentRequest.headers.each((header) => {
    if (!header.disabled) {
        curlCommand += ' -H "' + header.key + ': ' + header.value + '"';
    }
});
if (requestBody && bodyMode === 'raw') {
    const bodyEscaped = requestBody.replace(/"/g, '\\"').substring(0, 500);
    curlCommand += ' -d "' + bodyEscaped + '..."';
}

pm.collectionVariables.set("temp_request_name", pm.info.requestName);
pm.collectionVariables.set("temp_request_curl", curlCommand);

console.log("Calling Boomi API...");

pm.sendRequest(boomiRequest, (err, response) => {
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
