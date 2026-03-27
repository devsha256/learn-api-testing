/**
 * MULESOFT CH2.0 DEPLOYMENT AUDITOR
 * FIXED: Uses 'envPrefix' collection variable for discovery.
 * FIXED: Full viewport Material 3 UI.
 * FIXED: Robust Copy to Clipboard.
 */

// 1. --- CONFIGURATION & DYNAMIC DISCOVERY ---
const token = pm.collectionVariables.get("token");
const orgId = pm.collectionVariables.get("orgId");
const baselineEnvKey = pm.collectionVariables.get("baselineEnv") || "dev";
const envPrefix = pm.collectionVariables.get("envPrefix"); // e.g., "Retail-Digital"
const throttleMs = parseInt(pm.collectionVariables.get("throttleMs")) || 150;

if (!envPrefix) {
    console.error("[CRITICAL] 'envPrefix' variable is missing from the collection.");
}

const rows = {};
const allVars = pm.collectionVariables.toObject();

// Identify environments ONLY if they start with the user-defined envPrefix
const environments = Object.keys(allVars)
    .filter(key => key.startsWith(envPrefix))
    .map(key => ({
        label: key.replace(envPrefix + "-", ""), // e.g., "Retail-Digital-Dev" -> "Dev"
        id: allVars[key],
        rawKey: key
    }));

console.log(`[START] Found ${environments.length} environments matching prefix: ${envPrefix}`);

// 2. --- EXECUTION ENGINE ---
function runAudit(envIndex) {
    if (envIndex >= environments.length) {
        finalize();
        return;
    }

    const env = environments[envIndex];
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
            console.error(`[SKIP] Error fetching ${env.label}`);
            runAudit(envIndex + 1);
            return;
        }
        processApps(env, res.json().items || [], 0, () => runAudit(envIndex + 1));
    });
}

function processApps(env, apps, appIndex, onDone) {
    if (appIndex >= apps.length) {
        onDone();
        return;
    }

    const app = apps[appIndex];
    const detailOptions = {
        url: `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments/${app.id}`,
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
                // Normalization Rule: Remove the environment suffix from app name
                const parts = data.name.split("-");
                const normName = parts.length > 1 ? parts.slice(0, -1).join("-") : data.name;

                if (!rows[normName]) rows[normName] = {};
                rows[normName][env.label] = {
                    appVersion: data.application?.ref?.version || "N/A",
                    runtimeVersion: data.runtimeVersion || "N/A",
                    status: data.status || "UNKNOWN"
                };
            }
            processApps(env, apps, appIndex + 1, onDone);
        });
    }, throttleMs);
}

// 3. --- VISUALIZATION ---
function finalize() {
    const finalRows = Object.keys(rows).map(appName => {
        const appData = rows[appName];
        const baseVer = appData[baselineEnvKey]?.appVersion;
        let rowMismatch = false;
        
        const envDetails = environments.map(env => {
            const cur = appData[env.label];
            let mClass = "v-mismatch";
            if (!cur) mClass = "v-missing";
            else if (env.label.toLowerCase() === baselineEnvKey.toLowerCase()) mClass = "v-baseline";
            else if (cur.appVersion === baseVer) mClass = "v-match";
            else rowMismatch = true;

            return { envLabel: env.label, exists: !!cur, appVersion: cur?.appVersion || "N/A", 
                     runtimeVersion: cur?.runtimeVersion || "N/A", matchClass: mClass };
        });
        return { appName, envDetails, isMismatch: rowMismatch };
    });

    pm.visualizer.set(template, {
        finalRows,
        envs: environments.map(e => e.label),
        baseline: baselineEnvKey,
        prefix: envPrefix
    });
    console.log("[COMPLETE] Visualizer updated.");
}

const template = `
<!DOCTYPE html>
<html>
<head>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <style>
        :root { --p: #6750A4; --s: #FEF7FF; --err: #FFDAD6; --out: #CAC4D0; }
        body, html { height: 100%; width: 100vw; margin: 0; padding: 0; font-family: 'Roboto', sans-serif; background: var(--s); overflow: hidden; }
        .wrapper { display: flex; height: 100vh; width: 100vw; }
        .sidebar { width: 72px; background: #F3EDF7; border-right: 1px solid var(--out); display: flex; flex-direction: column; align-items: center; padding-top: 16px; }
        .container { flex: 1; display: flex; flex-direction: column; width: calc(100vw - 72px); }
        .header { padding: 0 16px; height: 56px; background: white; border-bottom: 1px solid var(--out); display: flex; align-items: center; justify-content: space-between; }
        .search-bar { background: #ECE6F0; border-radius: 28px; padding: 0 16px; display: flex; align-items: center; width: 300px; height: 40px; }
        .search-bar input { border: none; background: transparent; outline: none; width: 100%; }
        .table-area { flex: 1; overflow: auto; background: white; width: 100%; }
        table { width: 100%; border-collapse: collapse; }
        th { position: sticky; top: 0; background: #F7F2FA; padding: 16px; text-align: left; font-size: 12px; border-bottom: 2px solid var(--out); }
        .idx { width: 45px; text-align: center !important; }
        td { padding: 12px 16px; border-bottom: 1px solid #E7E0EC; }
        tr.mismatch { background-color: var(--err) !important; }
        .v-mismatch { color: #B3261E; font-weight: 900; text-decoration: underline; }
        .v-match { color: #2E7D32; font-weight: 700; }
        .v-baseline { color: #0061A4; font-weight: 700; }
        .btn { background: var(--p); color: white; border: none; padding: 8px 16px; border-radius: 12px; display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 500; }
        #snackbar { visibility: hidden; min-width: 200px; background: #322F35; color: white; padding: 12px; position: fixed; bottom: 20px; left: 88px; border-radius: 4px; z-index: 1000; }
        #snackbar.show { visibility: visible; }
        #copyArea { position: absolute; left: -9999px; }
    </style>
</head>
<body>
    <div class="wrapper">
        <nav class="sidebar"><div style="color:var(--p)"><span class="material-icons">fact_check</span></div></nav>
        <main class="container">
            <header class="header">
                <div style="font-weight:500; display:flex; align-items:center; gap:8px">
                    <span class="material-icons" style="font-size:20px">cloud_sync</span> {{prefix}} Audit
                </div>
                <div class="search-bar">
                    <span class="material-icons" style="font-size:20px; color:#444">search</span>
                    <input type="text" id="q" onkeyup="filter()" placeholder="Search apps...">
                </div>
                <button class="btn" id="cp"><span class="material-icons">content_copy</span> COPY CSV</button>
            </header>
            <div class="table-area">
                <table id="t">
                    <thead><tr><th class="idx">#</th><th>Application Name</th>{{#each envs}}<th>{{this}}</th>{{/each}}</tr></thead>
                    <tbody id="b">
                        {{#each finalRows}}
                        <tr class="r {{#if isMismatch}}mismatch{{/if}}" data-n="{{appName}}">
                            <td class="idx row-idx"></td>
                            <td><strong>{{appName}}</strong></td>
                            {{#each envDetails}}
                            <td>{{#if exists}}<div class="{{matchClass}}">v{{appVersion}}</div><div style="font-size:10px; color:#666">RT: {{runtimeVersion}}</div>{{else}}<span style="color:#999">---</span>{{/if}}</td>
                            {{/each}}
                        </tr>
                        {{/each}}
                    </tbody>
                </table>
            </div>
        </main>
    </div>
    <textarea id="copyArea"></textarea>
    <div id="snackbar">CSV Copied</div>
    <script>
        const d = pm.getData();
        function filter() {
            const q = document.getElementById('q').value.toLowerCase();
            const rows = document.querySelectorAll('.r');
            let c = 0;
            rows.forEach(r => {
                const n = r.getAttribute('data-n').toLowerCase();
                if (n.includes(q)) { r.style.display = ''; c++; r.querySelector('.row-idx').textContent = c; }
                else { r.style.display = 'none'; }
            });
        }
        document.getElementById('cp').addEventListener('click', function() {
            let csv = "App,Baseline," + d.envs.join(",") + "\\n";
            d.finalRows.forEach(r => {
                let row = [r.appName];
                let b = r.envDetails.find(e => e.envLabel === d.baseline);
                row.push(b ? b.appVersion : "N/A");
                r.envDetails.forEach(e => row.push(e.appVersion));
                csv += row.join(",") + "\\n";
            });
            const ta = document.getElementById('copyArea');
            ta.value = csv; ta.select();
            if (document.execCommand('copy')) {
                const s = document.getElementById("snackbar");
                s.className = "show"; setTimeout(() => s.className = "", 2500);
            }
        });
        filter();
    </script>
</body>
</html>
`;

if (environments.length > 0) runAudit(0);
else console.error(`No variables found starting with prefix: ${envPrefix}`);
