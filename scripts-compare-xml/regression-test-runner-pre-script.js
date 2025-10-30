// ========================================================================
// REGRESSION TEST RUNNER - Pre-request Script (XML Framework)
// This script runs ONLY for the [Regression Test Runner] request
// ========================================================================

const getCollectionVar = (key) => pm.collectionVariables.get(key);
const setCollectionVar = (key, value) => pm.collectionVariables.set(key, value);

const isRegressionMode = () => getCollectionVar("regression_mode") === "true";

const unescapeQuotes = (str) => str.replace(/\\'/g, "'").replace(/\\\\/g, "\\");

const transformMuleUrlToBoomi = (requestUrl, muleBase, boomiBase) => {
    let result = requestUrl.replace(muleBase, boomiBase);
    result = result.replace(/\/[^/]+\/ws\/(soap|rest)\//, '/ws/$1/');
    return result;
};

// ========================================================================
// cURL Parsing Functions - FIXED to handle line continuations
// ========================================================================

const URL_PATTERNS = [
    /curl\s+--location\s+--request\s+\w+\s+'([^']+)'/,  // Standard format with --request
    /curl\s+--location\s+'([^']+)'/,                      // Fallback without --request
];

const extractUrlFromCurl = (curlCommand) => {
    if (!curlCommand || typeof curlCommand !== 'string') return null;
    
    // CRITICAL FIX: Remove line continuations (space + backslash + space/newline)
    const cleanedCommand = curlCommand.replace(/\s*\\\s*/g, ' ');
    
    console.log(`Cleaned cURL: ${cleanedCommand.substring(0, 100)}...`);
    
    for (const pattern of URL_PATTERNS) {
        const match = cleanedCommand.match(pattern);
        if (match && match[1]) {
            console.log(`Matched URL: ${match[1]}`);
            return match[1];
        }
    }
    return null;
};

const extractMethodFromCurl = (curlCommand) => {
    // Remove line continuations
    const cleanedCommand = curlCommand.replace(/\s*\\\s*/g, ' ');
    const match = cleanedCommand.match(/--request\s+(\w+)/);
    return match ? match[1] : 'GET';
};

const extractHeadersFromCurl = (curlCommand) => {
    // Remove line continuations
    const cleanedCommand = curlCommand.replace(/\s*\\\s*/g, ' ');
    const headers = {};
    
    // Match headers with both single and double quotes
    const headerRegex = /--header\s+['"]((?:[^'"\\]|\\.)*?):\s*((?:[^'"\\]|\\.)*)['"](?=\s|$)/g;
    let match;
    while ((match = headerRegex.exec(cleanedCommand)) !== null) {
        headers[match[1].trim()] = match[2].trim();
    }
    return headers;
};

const extractBodyFromCurl = (curlCommand) => {
    // Remove line continuations
    const cleanedCommand = curlCommand.replace(/\s*\\\s*/g, ' ');
    
    // Match --data-raw with proper quote handling
    const match = cleanedCommand.match(/--data-raw\s+'([\s\S]*?)'\s*(?=$|--)/);
    return match && match[1] ? unescapeQuotes(match[1]) : null;
};

// ========================================================================
// Request Configuration
// ========================================================================
const parseRequestComponents = (curlCommand) => {
    const url = extractUrlFromCurl(curlCommand);
    const method = extractMethodFromCurl(curlCommand);
    const headers = extractHeadersFromCurl(curlCommand);
    const body = extractBodyFromCurl(curlCommand);
    
    return { url, method, headers, body };
};

const logExtractionResults = (components) => {
    console.log(`Extracted URL: ${components.url}`);
    console.log(`Extracted Method: ${components.method}`);
    console.log(`Extracted Headers: ${Object.keys(components.headers).length}`);
    console.log(`Has Body: ${components.body ? "Yes (" + components.body.substring(0, 50) + "...)" : "No"}`);
};

const configureMuleRequest = (components) => {
    pm.request.url = components.url;
    pm.request.method = components.method;
    pm.request.headers.clear();
    
    Object.keys(components.headers).forEach((key) => {
        pm.request.headers.add({
            key: key,
            value: components.headers[key]
        });
    });
    
    if (components.body) {
        pm.request.body = {
            mode: 'raw',
            raw: components.body
        };
    }
    
    console.log(`Mule request configured: ${components.method} ${components.url}`);
};

// ========================================================================
// Authentication Handling
// ========================================================================
const addBasicAuth = (headers) => {
    const username = getCollectionVar("boomi_username");
    const password = getCollectionVar("boomi_password");
    if (username && password) {
        headers['Authorization'] = `Basic ${btoa(`${username}:${password}`)}`;
    }
};

const addBearerAuth = (headers) => {
    const token = getCollectionVar("boomi_bearer_token");
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
};

const addApiKeyAuth = (headers) => {
    const apiKey = getCollectionVar("boomi_api_key");
    const headerName = getCollectionVar("boomi_api_key_header") || "X-API-Key";
    if (apiKey) {
        headers[headerName] = apiKey;
    }
};

const applyAuthentication = (headers, authType) => {
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
// Boomi Request Preparation
// ========================================================================
const getBaseUrls = () => ({
    mule: pm.variables.replaceIn(getCollectionVar("mule_base_url")),
    boomi: pm.variables.replaceIn(getCollectionVar("boomi_base_url"))
});

const validateBaseUrls = (baseUrls) => baseUrls.mule && baseUrls.boomi;

const prepareBoomiHeaders = (extractedHeaders, authType) => {
    const boomiHeaders = { ...extractedHeaders };
    applyAuthentication(boomiHeaders, authType);
    return boomiHeaders;
};

const buildBoomiRequest = (url, method, headers, body) => {
    const boomiRequest = {
        url: url,
        method: method,
        header: headers
    };
    if (body) {
        boomiRequest.body = {
            mode: 'raw',
            raw: body
        };
    }
    return boomiRequest;
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
    console.log("Sending Boomi request...");
    pm.sendRequest(boomiRequest, (err, response) => {
        if (err) {
            handleBoomiError(err);
        } else {
            handleBoomiSuccess(response);
        }
    });
};

// ========================================================================
// Main Workflow
// ========================================================================
const processRegressionTest = (curlCommand, requestName) => {
    console.log(`Processing: ${requestName}`);
    const components = parseRequestComponents(curlCommand);
    
    if (!components.url) {
        console.error("Could not extract URL from cURL command");
        console.log(`cURL: ${curlCommand}`);
        return;
    }
    
    logExtractionResults(components);
    configureMuleRequest(components);
    
    const baseUrls = getBaseUrls();
    if (!validateBaseUrls(baseUrls)) {
        console.error("Missing base URLs in collection variables");
        return;
    }
    
    const boomiUrl = transformMuleUrlToBoomi(components.url, baseUrls.mule, baseUrls.boomi);
    console.log(`Boomi URL: ${boomiUrl}`);
    
    const authType = getCollectionVar("boomi_auth_type") || "same";
    const boomiHeaders = prepareBoomiHeaders(components.headers, authType);
    const boomiRequest = buildBoomiRequest(boomiUrl, components.method, boomiHeaders, components.body);
    
    setCollectionVar("temp_request_name", requestName);
    setCollectionVar("temp_request_curl", curlCommand);
    
    sendBoomiRequest(boomiRequest);
    console.log("=== REGRESSION PRE-REQUEST COMPLETE ===");
};

// ========================================================================
// Entry Point
// ========================================================================
if (isRegressionMode()) {
    console.log("=== REGRESSION TEST RUNNER STARTED ===");
    const curlCommand = getCollectionVar("regression_curl");
    const requestName = getCollectionVar("regression_request_name");
    
    if (!curlCommand) {
        console.error("No cURL command found from collection pre-request");
        return;
    }
    
    processRegressionTest(curlCommand, requestName);
} else {
    console.log("Not in regression mode, skipping...");
}
