// --- CONFIGURATION & DISCOVERY ---
const token = pm.collectionVariables.get("token");
const orgId = pm.collectionVariables.get("orgId");
const baselineEnvKey = pm.collectionVariables.get("baselineEnv") || "dev";
const throttleMs = parseInt(pm.collectionVariables.get("throttleMs")) || 120;

// Dynamically discover environments from variables prefixed with 'digital-'
const allVars = pm.collectionVariables.toObject();
const environments = Object.keys(allVars)
    .filter(key => key.startsWith("digital-"))
    .map(key => ({
        label: key.replace("digital-", ""),
        id: allVars[key]
    }));

const rows = {};
const debugLog = [];

function log(msg) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${msg}`);
    debugLog.push({ timestamp, message: msg });
}

// --- NORMALIZATION LOGIC ---
function normalizeAppName(name) {
    const parts = name.split("-");
    if (parts.length <= 1) return name;
    parts.pop();
    return parts.join("-");
}

// --- API EXECUTION ENGINE ---
async function runAuditor() {
    log(`Starting audit for ${environments.length} environments...`);

    for (const env of environments) {
        log(`Processing Environment: ${env.label}`);
        
        try {
            const listResponse = await new Promise((resolve, reject) => {
                pm.sendRequest({
                    url: `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments`,
                    method: 'GET',
                    header: {
                        'Authorization': `Bearer ${token}`,
                        'X-ANYPNT-ORG-ID': orgId,
                        'X-ANYPNT-ENV-ID': env.id
                    }
                }, (err, res) => err ? reject(err) : resolve(res));
            });

            const deployments = listResponse.json().items || [];
            log(`Found ${deployments.length} deployments in ${env.label}`);

            for (const dep of deployments) {
                await new Promise(r => setTimeout(r, throttleMs));

                const detailResponse = await new Promise((resolve, reject) => {
                    pm.sendRequest({
                        url: `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments/${dep.id}`,
                        method: 'GET',
                        header: {
                            'Authorization': `Bearer ${token}`,
                            'X-ANYPNT-ORG-ID': orgId,
                            'X-ANYPNT-ENV-ID': env.id
                        }
                    }, (err, res) => err ? reject(err) : resolve(res));
                });

                const data = detailResponse.json();
                const normalizedName = normalizeAppName(data.name);

                if (!rows[normalizedName]) rows[normalizedName] = {};
                
                rows[normalizedName][env.label] = {
                    appVersion: data.application?.ref?.version || "N/A",
                    runtimeVersion: data.runtimeVersion || "N/A",
                    status: data.status || "UNKNOWN"
                };
            }
        } catch (e) {
            log(`Error processing ${env.label}: ${e.message}`);
        }
    }

    finalize();
}

function finalize() {
    // PRE-CALCULATE MATCH STATUS TO PREVENT HANDLEBARS ERRORS
    const finalRows = Object.keys(rows).map(appName => {
        const appData = rows[appName];
        const baselineVersion = appData[baselineEnvKey]?.appVersion;
        
        const envDetails = environments.map(env => {
            const current = appData[env.label];
            let matchClass = "v-mismatch";
            
            if (!current) {
                matchClass = "v-missing";
            } else if (env.label === baselineEnvKey) {
                matchClass = "v-baseline";
            } else if (current.appVersion === baselineVersion) {
                matchClass = "v-match";
            }

            return {
                envLabel: env.label,
                exists: !!current,
                appVersion: current?.appVersion || "N/A",
                runtimeVersion: current?.runtimeVersion || "N/A",
                status: current?.status || "",
                matchClass: matchClass
            };
        });

        return { appName, envDetails };
    });

    const debugJsonStr = JSON.stringify({
        generatedAt: new Date().toISOString(),
        data: rows,
        logs: debugLog
    });

    pm.collectionVariables.set("ch2_compare_debug", debugJsonStr);

    const visualizerData = {
        finalRows,
        envs: environments.map(e => e.label),
        baseline: baselineEnvKey,
        debugJson: debugJsonStr
    };

    pm.visualizer.set(template, visualizerData);
    log("Audit Complete. Open Visualizer.");
}

// --- VISUALIZER HTML + CSS + JS (INLINE) ---
const template = `
<!DOCTYPE html>
<html>
<head>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500&display=swap" rel="stylesheet">
    <style>
        :root {
            --md-sys-color-primary: #6750A4;
            --md-sys-color-on-primary: #FFFFFF;
            --md-sys-color-surface: #FEF7FF;
            --md-sys-color-outline: #79747E;
            --success: #2E7D32;
            --error: #B3261E;
            --missing: #757575;
            --baseline: #0288D1;
        }
        body { font-family: 'Roboto', sans-serif; margin: 0; background: var(--md-sys-color-surface); width: 100vw; }
        .top-bar {
            background: #F3EDF7; padding: 16px 24px; display: flex; justify-content: space-between;
            align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); position: sticky; top: 0; z-index: 100;
        }
        .btn {
            background: var(--md-sys-color-primary); color: white; border: none; padding: 10px 24px;
            border-radius: 20px; cursor: pointer; font-weight: 500; margin-left: 8px;
        }
        .btn-secondary { background: var(--md-sys-color-outline); }
        .card { margin: 24px; background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.12); overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; min-width: 800px; }
        th { background: #F3EDF7; text-align: left; padding: 16px; position: sticky; top: 0; border-bottom: 1px solid var(--md-sys-color-outline); }
        td { padding: 16px; border-bottom: 1px solid #E0E0E0; vertical-align: top; }
        .status-chip { padding: 4px 12px; border-radius: 16px; font-size: 11px; font-weight: bold; display: inline-block; margin-top: 4px; }
        .v-match { color: var(--success); font-weight: bold; }
        .v-mismatch { color: var(--error); font-weight: bold; }
        .v-missing { color: var(--missing); font-style: italic; }
        .v-baseline { color: var(--baseline); font-weight: bold; }
        #snackbar {
            visibility: hidden; min-width: 250px; background-color: #322F35; color: #F4EFF4;
            text-align: center; border-radius: 4px; padding: 14px; position: fixed; left: 50%; bottom: 30px; transform: translateX(-50%);
        }
        #snackbar.show { visibility: visible; }
    </style>
</head>
<body>
    <div class="top-bar">
        <h2 style="margin:0">Deployment Auditor</h2>
        <div>
            <button class="btn btn-secondary" onclick="copyDebug()">Copy Debug JSON</button>
            <button class="btn" onclick="exportCSV()">Copy to CSV</button>
        </div>
    </div>

    <div class="card">
        <table>
            <thead>
                <tr>
                    <th>Application Name</th>
                    {{#each envs}}
                    <th>{{this}} {{#if (eq this ../baseline)}}(Baseline){{/if}}</th>
                    {{/each}}
                </tr>
            </thead>
            <tbody>
                {{#each finalRows}}
                <tr>
                    <td><strong>{{appName}}</strong></td>
                    {{#each envDetails}}
                    <td>
                        {{#if exists}}
                            <div class="{{matchClass}}">v{{appVersion}}</div>
                            <div style="font-size: 12px; color: #666;">RT: {{runtimeVersion}}</div>
                            <span class="status-chip" style="background: #E8DEF8;">{{status}}</span>
                        {{else}}
                            <span class="v-missing">Not Deployed</span>
                        {{/if}}
                    </td>
                    {{/each}}
                </tr>
                {{/each}}
            </tbody>
        </table>
    </div>

    <div id="snackbar">Content copied to clipboard</div>

    <script>
        const data = pm.getData();

        function exportCSV() {
            let csv = "Application,Baseline," + data.envs.join(",") + "\\n";
            data.finalRows.forEach(row => {
                let csvRow = [row.appName];
                // Find baseline version
                let base = row.envDetails.find(e => e.envLabel === data.baseline);
                csvRow.push(base ? base.appVersion : "N/A");
                // Add all env versions
                row.envDetails.forEach(e => csvRow.push(e.appVersion));
                csv += csvRow.join(",") + "\\n";
            });
            copyToClipboard(csv);
        }

        function copyDebug() {
            copyToClipboard(data.debugJson);
        }

        function copyToClipboard(text) {
            const textArea = document.createElement("textarea");
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            showToast();
        }

        function showToast() {
            const x = document.getElementById("snackbar");
            x.className = "show";
            setTimeout(() => { x.className = ""; }, 3000);
        }

        Handlebars.registerHelper('eq', function(a, b) { return a === b; });
    </script>
</body>
</html>
`;

runAuditor();
