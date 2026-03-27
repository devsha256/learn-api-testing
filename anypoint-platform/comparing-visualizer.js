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
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <style>
        :root {
            --md-sys-color-primary: #6750A4;
            --md-sys-color-on-primary: #FFFFFF;
            --md-sys-color-surface: #FEF7FF;
            --md-sys-color-surface-container: #F3EDF7;
            --md-sys-color-outline: #79747E;
            --md-sys-color-error: #B3261E;
            --md-sys-color-success: #2E7D32;
            --md-sys-color-baseline: #0061A4;
        }

        body {
            font-family: 'Roboto', sans-serif;
            background-color: var(--md-sys-color-surface);
            color: #1C1B1F;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        /* Top Bar - M3 Elevation 2 */
        .top-app-bar {
            background-color: var(--md-sys-color-surface-container);
            padding: 12px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            box-shadow: 0px 2px 4px rgba(0, 0, 0, 0.05);
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .title { font-size: 22px; font-weight: 400; color: #1C1B1F; }

        /* Buttons - M3 Tonal Button Style */
        .btn-container { display: flex; gap: 8px; }
        .btn {
            background-color: var(--md-sys-color-primary);
            color: var(--md-sys-color-on-primary);
            border: none;
            padding: 10px 24px;
            border-radius: 20px;
            font-weight: 500;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: box-shadow 0.2s;
        }
        .btn:hover { box-shadow: 0px 1px 3px rgba(0,0,0,0.3); }
        .btn-secondary { background-color: #EADDFF; color: #21005D; }

        /* Table Card - M3 Elevated */
        .main-content { padding: 24px; overflow-x: auto; }
        .data-card {
            background: #FFFFFF;
            border-radius: 16px;
            border: 1px solid #CAC4D0;
            overflow: hidden;
        }

        table { width: 100%; border-collapse: collapse; min-width: 900px; }
        
        th {
            background-color: var(--md-sys-color-surface-container);
            padding: 16px;
            text-align: left;
            font-weight: 700;
            font-size: 14px;
            letter-spacing: 0.1px;
            color: #49454F;
            border-bottom: 1px solid var(--md-sys-color-outline);
        }

        td {
            padding: 16px;
            border-bottom: 1px solid #E7E0EC;
            vertical-align: middle;
        }

        tr:last-child td { border-bottom: none; }
        tr:hover { background-color: #F7F2FA; }

        /* Version Chips & Typography */
        .app-name { font-weight: 500; color: #1D1B20; font-size: 15px; }
        .version-text { font-size: 16px; margin-bottom: 2px; }
        
        .v-match { color: var(--md-sys-color-success); font-weight: 700; }
        .v-mismatch { color: var(--md-sys-color-error); font-weight: 700; }
        .v-baseline { color: var(--md-sys-color-baseline); font-weight: 700; }
        .v-missing { color: #938F99; font-style: italic; font-size: 13px; }

        .rt-text { font-size: 11px; color: #49454F; text-transform: uppercase; letter-spacing: 0.5px; }
        
        .status-badge {
            display: inline-flex;
            align-items: center;
            padding: 4px 12px;
            background-color: #E8DEF8;
            color: #1D192B;
            border-radius: 8px;
            font-size: 11px;
            font-weight: 500;
            margin-top: 6px;
        }

        /* Snackbar */
        #snackbar {
            visibility: hidden; min-width: 250px; background-color: #322F35; color: #F4EFF4;
            text-align: left; border-radius: 4px; padding: 14px 24px; position: fixed;
            left: 24px; bottom: 24px; z-index: 1000; box-shadow: 0 3px 5px rgba(0,0,0,0.3);
        }
        #snackbar.show { visibility: visible; animation: fadein 0.5s, fadeout 0.5s 2.5s; }
        @keyframes fadein { from {bottom: 0; opacity: 0;} to {bottom: 24px; opacity: 1;} }
        @keyframes fadeout { from {bottom: 24px; opacity: 1;} to {bottom: 0; opacity: 0;} }
    </style>
</head>
<body>
    <div class="top-app-bar">
        <div class="title">CH2.0 Deployment Auditor</div>
        <div class="btn-container">
            <button class="btn btn-secondary" onclick="copyDebug()">
                <span class="material-icons">bug_report</span> Debug JSON
            </button>
            <button class="btn" onclick="copyCSV()">
                <span class="material-icons">content_copy</span> Copy CSV
            </button>
        </div>
    </div>

    <div class="main-content">
        <div class="data-card">
            <table>
                <thead>
                    <tr>
                        <th>Application</th>
                        {{#each envs}}
                        <th>{{this}} {{#if (eq this ../baseline)}}(Baseline){{/if}}</th>
                        {{/each}}
                    </tr>
                </thead>
                <tbody>
                    {{#each finalRows}}
                    <tr>
                        <td><div class="app-name">{{appName}}</div></td>
                        {{#each envDetails}}
                        <td>
                            {{#if exists}}
                                <div class="version-text {{matchClass}}">v{{appVersion}}</div>
                                <div class="rt-text">RT: {{runtimeVersion}}</div>
                                <div class="status-badge">{{status}}</div>
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
    </div>

    <div id="snackbar">Content copied to clipboard</div>

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
            navigator.clipboard.writeText(csv).then(() => showToast("CSV Copied to Clipboard"));
        }

        function copyDebug() {
            navigator.clipboard.writeText(d.debugJson).then(() => showToast("Debug JSON Copied"));
        }

        function showToast(msg) {
            const x = document.getElementById("snackbar");
            x.innerText = msg;
            x.className = "show";
            setTimeout(() => { x.className = ""; }, 3000);
        }
    </script>
</body>
</html>
`;

// START THE RECURSION
processEnvironment(0);
