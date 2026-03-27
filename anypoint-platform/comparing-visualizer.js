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

// 3. SERIAL EXECUTION ENGINE
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
            processEnvironment(index + 1);
            return;
        }
        const deployments = res.json().items || [];
        processDeployments(env, deployments, 0, () => {
            processEnvironment(index + 1);
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

// 4. FINALIZER (PRE-CALCULATES ALL UI LOGIC)
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

            return { 
                envLabel: env.label, 
                isBaseline: env.label === baselineEnvKey,
                exists: !!cur, 
                appVersion: cur?.appVersion || "N/A", 
                runtimeVersion: cur?.runtimeVersion || "N/A", 
                status: cur?.status || "", 
                matchClass: mClass 
            };
        });
        return { appName, envDetails };
    });

    const debugData = JSON.stringify({ rows });
    pm.collectionVariables.set("ch2_compare_debug", debugData);

    pm.visualizer.set(template, {
        finalRows, 
        envs: environments.map(e => ({ label: e.label, isBaseline: e.label === baselineEnvKey })),
        baseline: baselineEnvKey,
        debugJson: debugData
    });
    console.log("[COMPLETE] Visualizer Ready.");
}

// 5. MATERIAL DESIGN 3 TEMPLATE
const template = `
<!DOCTYPE html>
<html>
<head>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --md-sys-color-primary: #6750A4;
            --md-sys-color-surface: #FEF7FF;
            --md-sys-color-surface-container: #F3EDF7;
            --md-sys-color-outline: #79747E;
            --md-sys-color-error: #B3261E;
            --md-sys-color-success: #2E7D32;
            --md-sys-color-baseline: #0061A4;
        }
        body { font-family: 'Roboto', sans-serif; background: var(--md-sys-color-surface); margin: 0; color: #1C1B1F; }
        .top-bar { background: var(--md-sys-color-surface-container); padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 10; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .main { padding: 24px; }
        .card { background: white; border-radius: 16px; border: 1px solid #CAC4D0; overflow: hidden; }
        table { width: 100%; border-collapse: collapse; min-width: 800px; }
        th { background: var(--md-sys-color-surface-container); padding: 16px; text-align: left; font-size: 14px; border-bottom: 1px solid var(--md-sys-color-outline); }
        td { padding: 16px; border-bottom: 1px solid #E7E0EC; vertical-align: top; }
        .btn { background: var(--md-sys-color-primary); color: white; border: none; padding: 10px 20px; border-radius: 20px; cursor: pointer; font-weight: 500; }
        .v-match { color: var(--md-sys-color-success); font-weight: 700; }
        .v-mismatch { color: var(--md-sys-color-error); font-weight: 700; }
        .v-baseline { color: var(--md-sys-color-baseline); font-weight: 700; }
        .status-badge { display: inline-block; padding: 2px 8px; background: #E8DEF8; border-radius: 8px; font-size: 11px; margin-top: 4px; }
    </style>
</head>
<body>
    <div class="top-bar">
        <div style="font-size: 20px;">Deployment Auditor</div>
        <button class="btn" onclick="copyCSV()">Copy CSV</button>
    </div>
    <div class="main">
        <div class="card">
            <table>
                <thead>
                    <tr>
                        <th>Application</th>
                        {{#each envs}}
                        <th>{{label}} {{#if isBaseline}}<span style="font-size:10px; opacity:0.6">(Baseline)</span>{{/if}}</th>
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
                                <div style="font-size:11px; color:#49454F;">RT: {{runtimeVersion}}</div>
                                <div class="status-badge">{{status}}</div>
                            {{else}}
                                <div style="color:#938F99; font-style:italic;">---</div>
                            {{/if}}
                        </td>
                        {{/each}}
                    </tr>
                    {{/each}}
                </tbody>
            </table>
        </div>
    </div>
    <script>
        const d = pm.getData();
        function copyCSV() {
            let csv = "App,Baseline," + d.envs.map(e => e.label).join(",") + "\\n";
            d.finalRows.forEach(r => {
                let row = [r.appName];
                let b = r.envDetails.find(e => e.isBaseline);
                row.push(b ? b.appVersion : "N/A");
                r.envDetails.forEach(e => row.push(e.appVersion));
                csv += row.join(",") + "\\n";
            });
            navigator.clipboard.writeText(csv).then(() => alert("CSV Copied"));
        }
    </script>
</body>
</html>`;

processEnvironment(0);
