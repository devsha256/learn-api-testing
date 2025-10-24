// Extract current MuleSoft request details
const currentRequest = pm.request;
const method = currentRequest.method;
const urlObj = currentRequest.url;

// Get base URLs from collection variables
const muleBaseUrl = pm.collectionVariables.get("mule_base_url");
const boomiBaseUrl = pm.collectionVariables.get("boomi_base_url");

// Get the full MuleSoft URL as string
const fullMuleUrl = urlObj.toString();
console.log("Full MuleSoft URL:", fullMuleUrl);

// Parse URL using string manipulation (Postman-compatible)
function transformMuleUrlToBoomi(muleUrl, muleBase, boomiBase) {
    try {
        console.log("Input - MuleSoft URL:", muleUrl);
        console.log("Input - MuleSoft Base:", muleBase);
        console.log("Input - Boomi Base:", boomiBase);
        
        // Extract the path portion after mule base URL
        let pathAfterBase = muleUrl.replace(muleBase, '');
        
        // Handle case where base URL has trailing slash
        if (pathAfterBase.startsWith('/')) {
            pathAfterBase = pathAfterBase.substring(1);
        }
        
        console.log("Path after base:", pathAfterBase);
        
        // Split by '?' to separate path from query string
        const urlParts = pathAfterBase.split('?');
        const pathPart = urlParts[0];
        const queryPart = urlParts.length > 1 ? '?' + urlParts[1] : '';
        
        console.log("Path part:", pathPart);
        console.log("Query part:", queryPart);
        
        // Split path into segments
        const pathSegments = pathPart.split('/').filter(segment => segment.length > 0);
        console.log("Path segments:", pathSegments);
        
        // Remove first segment (app-env-name) if it's not 'ws'
        if (pathSegments.length > 0 && pathSegments[0] !== 'ws') {
            console.log("Removing app-env segment:", pathSegments[0]);
            pathSegments.shift();
        }
        
        // Reconstruct the path
        const transformedPath = pathSegments.join('/');
        console.log("Transformed path:", transformedPath);
        
        // Ensure boomi base doesn't have trailing slash
        let cleanBoomiBase = boomiBase.replace(/\/$/, '');
        
        // Construct final Boomi URL
        const finalBoomiUrl = cleanBoomiBase + '/' + transformedPath + queryPart;
        
        console.log("Final Boomi URL:", finalBoomiUrl);
        return finalBoomiUrl;
        
    } catch (error) {
        console.error("Error in URL transformation:", error);
        return null;
    }
}

// Transform MuleSoft URL to Boomi URL
const boomiUrl = transformMuleUrlToBoomi(fullMuleUrl, muleBaseUrl, boomiBaseUrl);

if (!boomiUrl) {
    console.error("❌ Failed to transform URL");
    pm.collectionVariables.set("boomi_response", "ERROR: URL transformation failed");
    return;
}

console.log("✅ URL transformation successful");

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
        mode: 'raw',
        raw: requestBody
    } : undefined
};

console.log("=== Boomi Request Details ===");
console.log("Method:", method);
console.log("URL:", boomiUrl);
console.log("Headers count:", Object.keys(headers).length);
console.log("Has body:", !!requestBody);
console.log("============================");

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
        console.log("📡 Calling Boomi API...");
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
