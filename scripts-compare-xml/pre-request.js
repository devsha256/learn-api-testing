// ========================================================================
// Collection Pre-Request Script - XML Framework
// Handles both regression mode and normal SOAP/XML request processing
// ========================================================================

const getCollectionVar = (key) => pm.collectionVariables.get(key);
const setCollectionVar = (key, value) => pm.collectionVariables.set(key, value);

const isCollectionRunner = () => pm.info.iteration !== undefined && pm.info.iteration >= 0;
const hasCurlData = () => pm.iterationData.get("cURL Command");
const isRegressionMode = () => isCollectionRunner() && hasCurlData();
const shouldSkipUtilityRequest = (requestName) => requestName.startsWith("_") || requestName.startsWith("[");

const transformMuleUrlToBoomi = (requestUrl, muleBase, boomiBase) => {
    let result = requestUrl.replace(muleBase, boomiBase);
    result = result.replace(/\/[^/]+\/ws\/(soap|rest)\//, '/ws/$1/');
    return result;
};

// ========================================================================
// Collection Variable Management
// ========================================================================
const initializeRequestCounter = () => {
    const requestCounter = getCollectionVar("report_request_count");
    if (!requestCounter || requestCounter === "0") {
        setCollectionVar("report_request_count", "0");
    }
};

const incrementRequestCounter = () => {
    const currentCount = parseInt(getCollectionVar("report_request_count") || "0") + 1;
    setCollectionVar("report_request_count", currentCount.toString());
    setCollectionVar("current_report_index", currentCount.toString());
    return currentCount;
};

// ========================================================================
// Regression Mode Handling
// ========================================================================
const handleRegressionMode = () => {
    console.log("=== REGRESSION MODE DETECTED ===");
    setCollectionVar("regression_mode", "true");
    setCollectionVar("regression_curl", pm.iterationData.get("cURL Command"));
    setCollectionVar("regression_request_name", pm.iterationData.get("Request Name") || "Unknown");
    initializeRequestCounter();
    const currentCount = incrementRequestCounter();
    console.log(`Regression test #${currentCount}: ${pm.iterationData.get("Request Name")}`);
    console.log("Variables set. Allowing [Regression Test Runner] to execute...");
};

// ========================================================================
// Header Processing
// ========================================================================
const EXCLUDED_HEADERS = ['host', 'content-length', 'connection', 'user-agent', 'postman-token'];
const shouldIncludeHeader = (header) => !header.disabled && !EXCLUDED_HEADERS.includes(header.key.toLowerCase());
const processHeaders = (currentRequest) => {
    const headers = {};
    currentRequest.headers.each((header) => {
        if (shouldIncludeHeader(header)) {
            const resolvedValue = pm.variables.replaceIn(header.value);
            headers[header.key] = resolvedValue;
        }
    });
    return headers;
};

// ========================================================================
// Body Processing
// ========================================================================
const processRequestBody = (currentRequest, method) => {
    if (!currentRequest.body || method === 'GET') {
        return null;
    }
    const bodyMode = currentRequest.body.mode;
    if (bodyMode === 'raw') {
        return pm.variables.replaceIn(currentRequest.body.raw);
    }
    return null;
};

// ========================================================================
// Content Type Detection
// ========================================================================
const detectContentType = (body) => {
    if (!body) return null;
    const trimmed = String(body).trim();
    if (trimmed.startsWith('<')) {
        return 'application/xml';
    }
    return null;
};

const addContentTypeIfNeeded = (headers, requestBody) => {
    if (!requestBody) return;
    const existingContentType = headers['Content-Type'] || headers['content-type'];
    if (!existingContentType) {
        const contentType = detectContentType(requestBody);
        if (contentType) {
            headers['Content-Type'] = contentType;
        }
    }
};

// ========================================================================
// Authentication Handling
// ========================================================================
const addBasicAuth = (headers) => {
    const boomiUsername = getCollectionVar("boomi_username");
    const boomiPassword = getCollectionVar("boomi_password");
    if (boomiUsername && boomiPassword) {
        headers['Authorization'] = `Basic ${btoa(`${boomiUsername}:${boomiPassword}`)}`;
    }
};

const addBearerAuth = (headers) => {
    const boomiToken = getCollectionVar("boomi_bearer_token");
    if (boomiToken) {
        headers['Authorization'] = `Bearer ${boomiToken}`;
    }
};

const addApiKeyAuth = (headers) => {
    const boomiApiKey = getCollectionVar("boomi_api_key");
    const boomiApiKeyHeader = getCollectionVar("boomi_api_key_header") || "X-API-Key";
    if (boomiApiKey) {
        headers[boomiApiKeyHeader] = boomiApiKey;
    }
};

const applyAuthentication = (headers) => {
    const authType = getCollectionVar("boomi_auth_type") || "same";
    if (authType === "same") return;
    const authHandlers = {
        'basic': () => addBasicAuth(headers),
        'bearer': () => addBearerAuth(headers),
        'api-key': () => addApiKeyAuth(headers)
    };
    const handler = authHandlers[authType];
    if (handler) handler();
};

// ========================================================================
// Request Building
// ========================================================================
const buildBoomiRequest = (boomiUrl, method, headers, requestBody) => {
    const boomiRequest = {
        url: boomiUrl,
        method: method,
        header: headers
    };
    if (requestBody) {
        boomiRequest.body = {
            mode: 'raw',
            raw: requestBody
        };
    }
    return boomiRequest;
};

// ========================================================================
// cURL Command Generation - FIXED
// ========================================================================

const escapeForCurl = (str) => {
    // Escape single quotes properly for shell
    return String(str).replace(/'/g, "'\\''");
};

const escapeBody = (body) => {
    // Escape backslashes and quotes
    return String(body)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "'\\''");
};

const buildCurlBase = (requestUrl, method) => {
    // FIXED: Always include --request, even for GET
    let curlCommand = `curl --location --request ${method} '${requestUrl}'`;
    return curlCommand;
};

const addCurlHeaders = (curlCommand, headers) => {
    return Object.keys(headers).reduce((cmd, headerKey) => {
        const headerValue = headers[headerKey];
        const escapedValue = escapeForCurl(headerValue);
        return `${cmd} \\\n--header '${headerKey}: ${escapedValue}'`;
    }, curlCommand);
};

const addCurlBody = (curlCommand, requestBody) => {
    if (requestBody && typeof requestBody === 'string') {
        const escapedBody = escapeBody(requestBody);
        return `${curlCommand} \\\n--data-raw '${escapedBody}'`;
    }
    return curlCommand;
};

const generateCurlCommand = (requestUrl, method, headers, requestBody) => {
    let curlCommand = buildCurlBase(requestUrl, method);
    curlCommand = addCurlHeaders(curlCommand, headers);
    curlCommand = addCurlBody(curlCommand, requestBody);
    return curlCommand;
};


// ========================================================================
// Response Handling
// ========================================================================
const handleBoomiError = (err) => {
    console.error("Boomi request failed:", err.message);
    setCollectionVar("boomi_response", `ERROR: ${err.message}`);
    setCollectionVar("boomi_status", 0);
};

const handleBoomiSuccess = (response) => {
    setCollectionVar("boomi_response", response.text());
    setCollectionVar("boomi_status", response.code);
    console.log(`Boomi response received: ${response.code}`);
};

const sendBoomiRequest = (boomiRequest) => {
    pm.sendRequest(boomiRequest, (err, response) => {
        if (err) {
            handleBoomiError(err);
        } else {
            handleBoomiSuccess(response);
        }
    });
};

// ========================================================================
// Main Workflow - Normal Request Processing
// ========================================================================
const processNormalRequest = () => {
    initializeRequestCounter();
    const currentCount = incrementRequestCounter();
    console.log(`Processing request #${currentCount}: ${pm.info.requestName}`);

    const muleBaseUrl = pm.variables.replaceIn(getCollectionVar("mule_base_url"));
    const boomiBaseUrl = pm.variables.replaceIn(getCollectionVar("boomi_base_url"));
    
    if (!muleBaseUrl || !boomiBaseUrl) {
        console.error("Missing base URLs in collection variables");
        return;
    }

    const currentRequest = pm.request;
    const method = currentRequest.method;
    const requestUrl = pm.variables.replaceIn(pm.request.url.toString());
    const boomiUrl = transformMuleUrlToBoomi(requestUrl, muleBaseUrl, boomiBaseUrl);

    console.log(`Mule URL: ${requestUrl}`);
    console.log(`Boomi URL: ${boomiUrl}`);
    
    if (!boomiUrl) {
        console.error("Failed to generate Boomi URL");
        return;
    }

    const headers = processHeaders(currentRequest);
    const requestBody = processRequestBody(currentRequest, method);
    addContentTypeIfNeeded(headers, requestBody);
    applyAuthentication(headers);

    const boomiRequest = buildBoomiRequest(boomiUrl, method, headers, requestBody);
    const curlCommand = generateCurlCommand(requestUrl, method, headers, requestBody);

    setCollectionVar("temp_request_name", pm.info.requestName);
    setCollectionVar("temp_request_curl", curlCommand);
    console.log(`cURL generated successfully, length: ${curlCommand.length} characters`);

    sendBoomiRequest(boomiRequest);
};

// ========================================================================
// Entry Point
// ========================================================================
if (isRegressionMode()) {
    handleRegressionMode();
    return;
}

setCollectionVar("regression_mode", "false");

if (shouldSkipUtilityRequest(pm.info.requestName)) {
    console.log(`Skipping pre-request for: ${pm.info.requestName}`);
    return;
}

processNormalRequest();
