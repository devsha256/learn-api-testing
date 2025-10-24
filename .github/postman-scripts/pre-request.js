// Extract current request details from MuleSoft request
const currentRequest = pm.request;
const method = currentRequest.method;
const urlObj = currentRequest.url;

// Extract path from MuleSoft URL (remove base URL)
const muleBaseUrl = pm.collectionVariables.get("mule_base_url");
const fullUrl = urlObj.toString();
const pathWithParams = fullUrl.replace(muleBaseUrl, '');

// Build Boomi URL with same path and query parameters
const boomiBaseUrl = pm.collectionVariables.get("boomi_base_url");
let boomiUrl = boomiBaseUrl + pathWithParams;

// Extract query parameters
const queryParams = {};
urlObj.query.each((param) => {
    queryParams[param.key] = param.value;
});

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
    }
}

// Create Boomi request object
const boomiRequest = {
    url: boomiUrl,
    method: method,
    header: headers,
    body: requestBody ? {
        mode: 'raw',
        raw: requestBody
    } : undefined
};

console.log("Calling Boomi API first...");
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
        
        // Now the MuleSoft request will proceed automatically
        
    } catch (error) {
        console.error("Failed to get Boomi response:", error);
        pm.collectionVariables.set("boomi_response", "ERROR: " + error.message);
    }
})();
