// Extract current MuleSoft request details
const currentRequest = pm.request;
const method = currentRequest.method;
const urlObj = currentRequest.url;

// Get base URLs from collection variables
const muleBaseUrl = pm.collectionVariables.get("mule_base_url");
const boomiBaseUrl = pm.collectionVariables.get("boomi_base_url");

// Parse MuleSoft URL to extract components
const fullMuleUrl = urlObj.toString();
console.log("Full MuleSoft URL:", fullMuleUrl);

// Strategy: Extract everything after the base URL and remove app-env-name
function transformMuleUrlToBoomi(muleUrl, muleBase, boomiBase) {
    try {
        // Parse the MuleSoft URL
        const muleUrlObj = new URL(muleUrl);
        const muleBaseObj = new URL(muleBase);
        
        // Get the path after the base URL
        let fullPath = muleUrlObj.pathname;
        
        // Remove the base path from MuleSoft base URL if it exists
        const muleBasePath = muleBaseObj.pathname;
        if (fullPath.startsWith(muleBasePath)) {
            fullPath = fullPath.substring(muleBasePath.length);
        }
        
        // Split path into segments
        // Example: /app-env-name/ws/rest/service -> ['app-env-name', 'ws', 'rest', 'service']
        const pathSegments = fullPath.split('/').filter(segment => segment.length > 0);
        
        console.log("Path segments:", pathSegments);
        
        // Remove the first segment (app-env-name) if it exists
        // Pattern: /ws/rest/service is what we want for Boomi
        let boomiPath;
        if (pathSegments.length > 0 && !pathSegments[0].startsWith('ws')) {
            // First segment is app-env-name, remove it
            pathSegments.shift();
            boomiPath = '/' + pathSegments.join('/');
        } else {
            // No app-env-name found, use as is
            boomiPath = '/' + pathSegments.join('/');
        }
        
        // Construct Boomi URL
        const boomiBaseObj = new URL(boomiBase);
        const boomiUrl = boomiBaseObj.origin + boomiBaseObj.pathname + boomiPath;
        
        // Add query parameters from MuleSoft URL
        const queryString = muleUrlObj.search;
        return boomiUrl + queryString;
        
    } catch (error) {
        console.error("Error transforming URL:", error);
        return null;
    }
}

// Transform MuleSoft URL to Boomi URL
const boomiUrl = transformMuleUrlToBoomi(fullMuleUrl, muleBaseUrl, boomiBaseUrl);

console.log("Transformed Boomi URL:", boomiUrl);

// Extract headers
const headers = {};
currentRequest.headers.each((header) => {
    if (!header.disabled) {
        headers[header.key] = header.value;
    }
});

// Extract body payload (if exists)
let requestBody = null;
if (currentRequest.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (currentRequest.body.mode === 'raw') {
        requestBody = currentRequest.body.raw;
    } else if (currentRequest.body.mode === 'formdata') {
        requestBody = currentRequest.body.formdata;
    } else if (currentRequest.body.mode === 'urlencoded') {
        requestBody = currentRequest.body.urlencoded;
    }
}

// Create Boomi request object
const boomiRequest = {
    url: boomiUrl,
    method: method,
    header: headers,
    body: requestBody ? {
        mode: currentRequest.body.mode,
        raw: requestBody
    } : undefined
};

console.log("Calling Boomi API first...");
console.log("Method:", method);
console.log("Boomi URL:", boomiUrl);

// Make synchronous call to Boomi using Promise
const sendRequest = (req) => {
    return new Promise((resolve, reject) => {
        pm.sendRequest(req, (err, res) => {
            if (err) {
                console.log("Boomi request error:", err);
                return reject(err);
            }
            resolve(res);
        });
    });
};

// Execute Boomi request and wait for response
(async () => {
    try {
        const boomiResponse = await sendRequest(boomiRequest);
        
        // Store Boomi response in collection variable
        pm.collectionVariables.set("boomi_response", boomiResponse.text());
        
        console.log("Boomi response received and stored");
        console.log("Status:", boomiResponse.status);
        console.log("Response length:", boomiResponse.text().length);
        
    } catch (error) {
        console.error("Failed to get Boomi response:", error);
        pm.collectionVariables.set("boomi_response", "ERROR: " + error.message);
    }
})();
