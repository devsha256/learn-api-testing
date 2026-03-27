// 1. CONFIGURATION
const token = pm.collectionVariables.get("token");
const orgId = pm.collectionVariables.get("orgId");
const baselineEnvKey = pm.collectionVariables.get("baselineEnv") || "dev";
const throttleMs = parseInt(pm.collectionVariables.get("throttleMs")) || 120;

const rows = {};
const debugLog = [];

// 2. DISCOVERY LOGIC
const allVars = pm.collectionVariables.toObject();
const environments = Object.keys(allVars)
    .filter(key => key.startsWith("digital-"))
    .map(key => ({ label: key.replace("digital-", ""), id: allVars[key] }));

function log(msg) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${msg}`);
    debugLog.push({ timestamp, message: msg });
}

function normalizeAppName(name) {
    const parts = name.split("-");
    return parts.length > 1 ? parts.slice(0, -1).join("-") : name;
}

// 3. THE PROMISE WRAPPER (CRITICAL FOR SANDBOX STABILITY)
const sendReq = (options) => {
    return new Promise((resolve, reject) => {
        pm.sendRequest(options, (err, res) => {
            if (err) return reject(err);
            resolve(res);
        });
    });
};

// 4. MAIN EXECUTION ENGINE
async function runAuditor() {
    log(`Starting audit for ${environments.length} environments...`);
    
    if (environments.length === 0) {
        log("ERROR: No 'digital-' variables found. Check naming.");
        return;
    }

    for (const env of environments) {
        log(`Fetching deployments for: ${env.label}`);
        try {
            const listRes = await sendReq({
                url: `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments`,
                method: 'GET',
                header: { 'Authorization': `Bearer ${token}`, 'X-ANYPNT-ORG-ID': orgId, 'X-ANYPNT-ENV-ID': env.id }
            });

            const deployments = listRes.json().items || [];
            
            for (const dep of deployments) {
                // Throttling to prevent 429s
                await new Promise(r => setTimeout(r, throttleMs));

                const detailRes = await sendReq({
                    url: `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments/${dep.id}`,
                    method: 'GET',
                    header: { 'Authorization': `Bearer ${token}`, 'X-ANYPNT-ORG-ID': orgId, 'X-ANYPNT-ENV-ID': env.id }
                });

                const data = detailRes.json();
                const normName = normalizeAppName(data.name);

                if (!rows[normName]) rows[normName] = {};
                rows[normName][env.label] = {
                    appVersion: data.application?.ref?.version || "N/A",
                    runtimeVersion: data.runtimeVersion || "N/A",
                    status: data.status || "UNKNOWN"
                };
            }
        } catch (e) {
            log(`Failed ${env.label}: ${e.message}`);
        }
    }
    finalize();
}

function finalize() {
    const finalRows = Object.keys(rows).map(appName => {
        const appData = rows[appName];
        const baseVer = appData[baselineEnvKey]?.appVersion;
        
        const envDetails = environments.map(env => {
            const cur = appData[env.label];
            let mClass = "v-mismatch";
            if (!cur) mClass = "v-missing";
            else if (env.label === baselineEnvKey) mClass = "v-baseline";
            else if (cur.appVersion === baseVer) mClass = "v-match";

            return { envLabel: env.label, exists: !!cur, appVersion: cur?.appVersion || "N/A", 
                     runtimeVersion: cur?.runtimeVersion || "N/A", status: cur?.status || "", matchClass: mClass };
        });
        return { appName, envDetails };
    });

    const dJson = JSON.stringify({ data: rows, logs: debugLog });
    pm.collectionVariables.set("ch2_compare_debug", dJson);

    pm.visualizer.set(template, {
        finalRows, envs: environments.map(e => e.label),
        baseline: baselineEnvKey, debugJson: dJson
    });
    log("Audit Complete. VISUALIZER READY.");
}

// 5. HTML TEMPLATE (Minified for brevity)
const template = `
<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&display=swap" rel="stylesheet">
<style>
    body { font-family: 'Roboto', sans-serif; background: #FEF7FF; margin: 0; padding: 20px; }
    .card { background: white; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #F3EDF7; padding: 12px; text-align: left; border-bottom: 2px solid #79747E; }
    td { padding: 12px; border-bottom: 1px solid #EEE; vertical-align: top; }
    .v-match { color: #2E7D32; font-weight: bold; }
    .v-mismatch { color: #B3261E; font-weight: bold; }
    .v-baseline { color: #0288D1; font-weight: bold; }
    .v-missing { color: #757575; font-style: italic; }
    .status-chip { font-size: 10px; background: #E8DEF8; padding: 2px 6px; border-radius: 10px; }
    .toolbar { margin-bottom: 15px; display: flex; gap: 10px; }
    button { background: #6750A4; color: white; border: none; padding: 8px 16px; border-radius: 20px; cursor: pointer; }
</style>
</head><body>
    <div class="toolbar">
        <button onclick="copyCSV()">Copy CSV</button>
        <button style="background:#79747E" onclick="copyDebug()">Copy Debug JSON</button>
    </div>
    <div class="card"><table><thead><tr><th>App Name</th>{{#each envs}}<th>{{this}}</th>{{/each}}</tr></thead>
    <tbody>{{#each finalRows}}<tr><td><strong>{{appName}}</strong></td>{{#each envDetails}}<td>
    {{#if exists}}<div class="{{matchClass}}">v{{appVersion}}</div><div style="font-size:11px">RT: {{runtimeVersion}}</div>
    <span class="status-chip">{{status}}</span>{{else}}<span class="v-missing">N/A</span>{{/if}}</td>{{/each}}</tr>{{/each}}
    </tbody></table></div>
    <script>
        const d = pm.getData();
        function copyCSV() {
            let c = "App,Baseline," + d.envs.join(",") + "\\n";
            d.finalRows.forEach(r => {
                let row = [r.appName];
                let b = r.envDetails.find(e => e.envLabel === d.baseline);
                row.push(b ? b.appVersion : "N/A");
                r.envDetails.forEach(e => row.push(e.appVersion));
                c += row.join(",") + "\\n";
            });
            navigator.clipboard.writeText(c).then(() => alert("CSV Copied"));
        }
        function copyDebug() { navigator.clipboard.writeText(d.debugJson).then(() => alert("Debug Copied")); }
    </script>
</body></html>`;

// 6. START EXECUTION
runAuditor();
