// Store Boomi response for comparison
const boomiResponse = pm.response.text();
pm.collectionVariables.set("boomi_response", boomiResponse);
pm.collectionVariables.set("boomi_status", pm.response.code);

console.log("Boomi response fetched and stored");
console.log("Status:", pm.response.code);
console.log("Length:", boomiResponse.length);

// Return to the original MuleSoft request
const nextRequest = pm.collectionVariables.get("return_to_request");
if (nextRequest) {
    pm.execution.setNextRequest(nextRequest);
} else {
    pm.execution.setNextRequest(null); // End execution
}
