// 1. CONFIGURATION & DISCOVERY
const token = pm.collectionVariables.get("token");
const orgId = pm.collectionVariables.get("orgId");
const baselineEnvKey = pm.collectionVariables.get("baselineEnv") || "dev";
const throttleMs = parseInt(pm.collectionVariables.get("throttleMs")) || 120;

const rows = {};
const allVars = pm.collectionVariables.toObject();
const environments = Object.keys(allVars)
    .filter(key => key.startsWith("digital-"))
    .map(key => ({ label: key.replace("digital-", ""), id: allVars[key] }));

console.log(`[START] Audit for ${environments.length} environments.`);

// 2. HELPER: NAME NORMALIZATION
function normalizeAppName(name) {
    const parts = name.split("-");
    return parts.length > 1 ? parts.slice(0, -1).join("-") : name;
}

// 3. SERIAL EXECUTION ENGINE (OFFICIAL RECURSIVE PATTERN)
function processEnvironment(index) {
    if (index >= environments.length) {
        finalize();
        return;
    }

    const env = environments[index];
    console.log(`[FETCH] Processing: ${env.label}`);

    const listOptions = {
        url: `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments`,
        method: 'GET',
        header: {
            'Authorization': `Bearer ${token}`,
            'X-ANYPNT-ORG-ID': orgId,
            'X-ANYPNT-ENV-ID': env.id
        }
    };

    pm.sendRequest(listOptions, (err, res) => {
        if (err || res.code !== 200) {
            console.error(`[ERROR] Failed ${env.label}`);
            processEnvironment(index + 1); // Skip to next
            return;
        }

        const deployments = res.json().items || [];
        processDeployments(env, deployments, 0, () => {
            processEnvironment(index + 1); // Move to next environment
        });
    });
}

function processDeployments(env, list, depIndex, onComplete) {
    if (depIndex >= list.length) {
        onComplete();
        return;
    }

    const dep = list[depIndex];
    const detailOptions = {
        url: `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments/${dep.id}`,
        method: 'GET',
        header: {
            'Authorization': `Bearer ${token}`,
            'X-ANYPNT-ORG-ID': orgId,
            'X-ANYPNT-ENV-ID': env.id
        }
    };

    setTimeout(() => {
        pm.sendRequest(detailOptions, (err, res) => {
            if (!err && res.code === 200) {
                const data = res.json();
                const normName = normalizeAppName(data.name);

                if (!rows[normName]) rows[normName] = {};
                rows[normName][env.label] = {
                    appVersion: data.application?.ref?.version || "N/A",
                    runtimeVersion: data.runtimeVersion || "N/A",
                    status: data.status || "UNKNOWN"
                };
            }
            processDeployments(env, list, depIndex + 1, onComplete);
        });
    }, throttleMs);
}

// 4. FINALIZER & VISUALIZER
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

    const debugData = JSON.stringify({ rows });
    pm.collectionVariables.set("ch2_compare_debug", debugData);

    pm.visualizer.set(template, {
        finalRows, 
        envs: environments.map(e => e.label),
        baseline: baselineEnvKey,
        debugJson: debugData
    });
    console.log("[COMPLETE] Visualizer Ready.");
}

// 5. TEMPLATE (The visual layer)
const template = `
<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&display=swap" rel="stylesheet">
<style>
    body { font-family: 'Roboto', sans-serif; background: #FEF7FF; padding: 20px; }
    .card { background: white; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); overflow: auto; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #F3EDF7; padding: 12px; text-align: left; border-bottom: 2px solid #79747E; }
    td { padding: 12px; border-bottom: 1px solid #EEE; vertical-align: top; }
    .v-match { color: #2E7D32; font-weight: bold; }
    .v-mismatch { color: #B3261E; font-weight: bold; }
    .v-baseline { color: #0288D1; font-weight: bold; }
    .status-chip { font-size: 10px; background: #E8DEF8; padding: 2px 6px; border-radius: 10px; }
</style>
</head><body>
    <div style="margin-bottom:10px">
        <button onclick="copyCSV()">Copy CSV</button>
    </div>
    <div class="card"><table><thead><tr><th>App Name</th>{{#each envs}}<th>{{this}}</th>{{/each}}</tr></thead>
    <tbody>{{#each finalRows}}<tr><td><strong>{{appName}}</strong></td>{{#each envDetails}}<td>
    {{#if exists}}<div class="{{matchClass}}">v{{appVersion}}</div><div style="font-size:11px">RT: {{runtimeVersion}}</div>
    <span class="status-chip">{{status}}</span>{{else}}<span style="color:#757575">---</span>{{/if}}</td>{{/each}}</tr>{{/each}}
    </tbody></table></div>
    <script>
        const d = pm.getData();
        function copyCSV() {
            let csv = "App,Baseline," + d.envs.join(",") + "\\n";
            d.finalRows.forEach(r => {
                let row = [r.appName];
                let b = r.envDetails.find(e => e.envLabel === d.baseline);
                row.push(b ? b.appVersion : "N/A");
                r.envDetails.forEach(e => row.push(e.appVersion));
                csv += row.join(",") + "\\n";
            });
            navigator.clipboard.writeText(csv).then(() => alert("CSV Copied"));
        }
    </script>
</body></html>`;

// START THE RECURSION
processEnvironment(0);
