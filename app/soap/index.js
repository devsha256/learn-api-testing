const express = require('express');
const app = express();
const PORT = 8000; // Using a different port (8001) for the SOAP service

// Middleware to parse incoming request body as raw text, which is typical for XML/SOAP
// The type '*/*' ensures it processes any content type, including text/xml or application/soap+xml
app.use(express.text({ type: '*/*' }));

// --- XML Response Templates ---

// Response for successful GET requests
const getCustomerXmlResponse = `
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
        <getCustomerResponse xmlns="http://example.com/customer">
            <Customer>
                <id>CUST-001</id>
                <name>Acme Corp.</name>
                <status>Active</status>
                <billingAddress>
                    <street>123 Integration Way</street>
                    <city>MuleCity</city>
                    <zip>90210</zip>
                </billingAddress>
            </Customer>
        </getCustomerResponse>
    </soap:Body>
</soap:Envelope>
`.trim();

// Response for successful POST requests (201 Created)
const createCustomerXmlResponse = `
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
        <createCustomerResponse xmlns="http://example.com/customer">
            <status>201</status>
            <message>Customer resource created successfully.</message>
            <newId>CUST-002</newId>
        </createCustomerResponse>
    </soap:Body>
</soap:Envelope>
`.trim();

// --- SOAP ENDPOINTS ---

// GET /app/customer - Returns XML/SOAP response
app.get('/app/ws/soap/customer', (req, res) => {
    console.log('[GET /app/customer] Sending XML response.');
    res.set('Content-Type', 'application/xml');
    res.status(200).send(getCustomerXmlResponse);
});

// GET /custome - Returns XML/SOAP response (uses exact path requested)
app.get('/ws/soap/customer', (req, res) => {
    console.log('[GET /custome] Sending XML response.');
    res.set('Content-Type', 'application/xml');
    res.status(200).send(getCustomerXmlResponse);
});

// POST /app/customer - Accepts XML body and returns 201 Success
app.post('/ws/soap/customer', (req, res) => {
    const correlationId = req.header('x-crrelation-id') || 'N/A';
    const requestBody = req.body; // Contains the raw XML body as a string

    console.log(`[POST /app/customer] Correlation ID: ${correlationId}`);
    console.log('[POST /app/customer] Received XML Body (simulated structure check):');
    // In a real scenario, you would parse the XML (e.g., using 'xml2js' library) and validate it here.
    console.log(requestBody.substring(0, 100) + '...'); // Log a snippet of the incoming XML

    // Simulate successful creation
    res.set('Content-Type', 'application/xml');
    res.status(201).send(createCustomerXmlResponse);
});

// POST /app/customer - Accepts XML body and returns 201 Success
app.post('/app/ws/soap/customer', (req, res) => {
    const correlationId = req.header('x-crrelation-id') || 'N/A';
    const requestBody = req.body; // Contains the raw XML body as a string

    console.log(`[POST /app/customer] Correlation ID: ${correlationId}`);
    console.log('[POST /app/customer] Received XML Body (simulated structure check):');
    // In a real scenario, you would parse the XML (e.g., using 'xml2js' library) and validate it here.
    console.log(requestBody.substring(0, 100) + '...'); // Log a snippet of the incoming XML

    // Simulate successful creation
    res.set('Content-Type', 'application/xml');
    res.status(201).send(createCustomerXmlResponse);
});


// Start the server
app.listen(PORT, () => {
  console.log(`SOAP Server is running at http://localhost:${PORT}`);
  console.log(`Endpoints available: GET /app/customer, GET /custome, POST /app/customer`);
});

