const express = require('express');
const morgan = require('morgan');
const app = express();
const PORT = 3000;

app.use(morgan('dev')); // Logs requests to console
app.use(express.json());

// --- MOCK DATA STORE ---
const orgId = "5e35e1fa-c86f-4691-b626-1eb1db3f87e5";
const environments = [
    { id: "env-dev-123", name: "Retail-Digital-Dev" },
    { id: "env-preprod-456", name: "Retail-Digital-PreProd" },
    { id: "env-prod-789", name: "Retail-Digital-Prod" }
];

const mockApps = [
    { baseName: "vc-digital-accounts-eapi", versions: { "env-dev-123": "1.0.3", "env-preprod-456": "1.0.3", "env-prod-789": "1.0.3" } },
    { baseName: "vc-digital-email-sapi", versions: { "env-dev-123": "1.0.4", "env-preprod-456": "1.0.3", "env-prod-789": "1.0.2" } },
    { baseName: "vc-digital-reporting-papi", versions: { "env-dev-123": "1.0.8", "env-preprod-456": "1.0.5", "env-prod-789": "1.0.5" } }
];

// --- 1. GET ENVIRONMENTS ---
app.get('/accounts/api/organizations/:orgId/environments', (req, res) => {
    res.json({
        data: environments.map(e => ({
            id: e.id,
            name: e.name,
            organizationId: orgId,
            isProduction: e.name.includes('Prod')
        }))
    });
});

// --- 2. GET ALL APPS FOR AN ENVIRONMENT ---
app.get('/amc/application-manager/api/v2/organizations/:orgId/environments/:envId/deployments', (req, res) => {
    const { envId } = req.params;
    const env = environments.find(e => e.id === envId);
    
    if (!env) return res.status(404).json({ message: "Env not found" });

    // Generate list items based on our mockApps
    const items = mockApps.map((app, index) => ({
        id: `dep-${envId}-${index}`,
        name: `${app.baseName}-${env.name.split('-').pop().toLowerCase()}`
    }));

    res.json({ items });
});

// --- 3. GET APP DETAILS (Version Extraction) ---
app.get('/amc/application-manager/api/v2/organizations/:orgId/environments/:envId/deployments/:depId', (req, res) => {
    const { envId, depId } = req.params;
    
    // Extract index from mock depId "dep-env-dev-123-0"
    const appIdx = parseInt(depId.split('-').pop());
    const app = mockApps[appIdx];
    const env = environments.find(e => e.id === envId);

    if (!app || !env) return res.status(404).json({ message: "Detail not found" });

    res.json({
        id: depId,
        name: `${app.baseName}-${env.name.split('-').pop().toLowerCase()}`,
        status: "RUNNING",
        runtimeVersion: "4.4.0",
        application: {
            ref: {
                groupId: "com.vistracorp",
                artifactId: app.baseName,
                version: app.versions[envId] || "1.0.0"
            }
        }
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Anypoint Mock Server running at http://localhost:${PORT}`);
    console.log(`OrgID: ${orgId}`);
});