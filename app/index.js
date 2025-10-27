const express = require('express');
const app = express();
const PORT = 8000;

// Middleware to parse JSON bodies in POST requests
app.use(express.json());

// XML response template for the SOAP endpoints
const customerXmlResponse = `
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
        <getCustomerResponse xmlns="http://example.com/customer">
            <Customer>
                <id>CUST-001</id>
                <name>Acme Corp.</name>
                <status>Active</status>
                <isActive>true</isActive>
                <billingAddress>
                    <street>123 Integration Way</street>
                    <city>MuleCity</city>
                    <zip>90210</zip>
                </billingAddress>
                <orders>
                  <order>
                    <Id>OZ001</Id>
                    <ProductId>PZ0001</ProductId>
                    <ProductName>PP1</ProductName>
                  </order>
                  <order>
                    <Id>OZ002</Id>
                    <ProductId>PZ0002</ProductId>
                    <ProductName>PP2</ProductName>
                  </order>
                </orders>
            </Customer>
        </getCustomerResponse>
    </soap:Body>
</soap:Envelope>
`.trim(); // .trim() removes leading/trailing whitespace

// XML response template for the SOAP endpoints
const customerV2XmlResponse = `
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
                <gender>male</gender>
                <orders>
                  <order>
                    <Id>OZ001</Id>
                    <ProductId>PZ0001</ProductId>
                    <ProductName>PP1</ProductName>
                  </order>
                  <order>
                    <Id>OZ003</Id>
                    <ProductId>PZ0003</ProductId>
                    <ProductName>PP3</ProductName>
                  </order>
                </orders>
            </Customer>
        </getCustomerResponse>
    </soap:Body>
</soap:Envelope>
`.trim(); // .trim() removes leading/trailing whitespace

// --- NEW SOAP ENDPOINTS ---

// GET /app/customer - Returns XML/SOAP response
app.get('/app/ws/soap/customer', (req, res) => {
    console.log('[GET /app/customer] Sending XML response.');
    res.set('Content-Type', 'application/xml');
    res.status(200).send(customerV2XmlResponse);
});

// GET /customer (Using the exact path requested) - Returns XML/SOAP response
app.get('/ws/soap/customer', (req, res) => {
    console.log('[GET /customer] Sending XML response.');
    res.set('Content-Type', 'application/xml');
    res.status(200).send(customerXmlResponse);
});



// Start the server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
