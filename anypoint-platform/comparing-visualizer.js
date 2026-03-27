/**
 * MULESOFT CH2.0 DEPLOYMENT AUDITOR (MATERIAL 3)
 * Full Unified Script: Discovery + Execution + Visualization
 */

// 1. --- CONFIGURATION & DISCOVERY ---
const token = pm.collectionVariables.get("token");
const orgId = pm.collectionVariables.get("orgId");
const baselineEnvKey = pm.collectionVariables.get("baselineEnv") || "dev";
const throttleMs = parseInt(pm.collectionVariables.get("throttleMs")) || 150;

const rows = {};
const allVars = pm.collectionVariables.toObject();
const environments = Object.keys(allVars)
    .filter(key => key.startsWith("digital-"))
    .map(key => ({ label: key.replace("digital-", ""), id: allVars[key] }));

console.log(`[START] Auditor initialized for ${environments.length} environments.`);

// 2. --- UTILS ---
function normalizeAppName(name) {
    const parts = name.split("-");
    return parts.length > 1 ? parts.slice(0, -1).join("-") : name;
}

// 3. --- RECURSIVE ASYNC ENGINE (The Core) ---
function runAudit(envIndex) {
    if (envIndex >= environments.length) {
        finalize();
        return;
    }

    const env = environments[envIndex];
    console.log(`[FETCH] Environment: ${env.label}...`);

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
            console.error(`[SKIP] ${env.label} failed or unauthorized.`);
            runAudit(envIndex + 1);
            return;
        }

        const items = res.json().items || [];
        processAppsSerial(env, items, 0, () => {
            runAudit(envIndex + 1); // Next environment
        });
    });
}

function processAppsSerial(env, apps, appIndex, onDone) {
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
                const normName = normalizeAppName(data.name);

                if (!rows[normName]) rows[normName] = {};
                rows[normName][env.label] = {
                    appVersion: data.application?.ref?.version || "N/A",
                    runtimeVersion: data.runtimeVersion || "N/A",
                    status: data.status || "UNKNOWN"
                };
            }
            processAppsSerial(env, apps, appIndex + 1, onDone);
        });
    }, throttleMs);
}

// 4. --- DATA FINALIZATION & VISUALIZER ---
function finalize() {
    console.log("[DATA] Aggregating results...");
    
    const finalRows = Object.keys(rows).map(appName => {
        const appData = rows[appName];
        const baseVer = appData[baselineEnvKey]?.appVersion;
        let rowMismatch = false;
        
        const envDetails = environments.map(env => {
            const cur = appData[env.label];
            let mClass = "v-mismatch";
            
            if (!cur) mClass = "v-missing";
            else if (env.label === baselineEnvKey) mClass = "v-baseline";
            else if (cur.appVersion === baseVer) mClass = "v-match";
            else rowMismatch = true; // Mark row for highlighting

            return { envLabel: env.label, exists: !!cur, appVersion: cur?.appVersion || "N/A", 
                     runtimeVersion: cur?.runtimeVersion || "N/A", status: cur?.status || "", matchClass: mClass };
        });

        return { appName, envDetails, isMismatch: rowMismatch };
    });

    const vizPayload = {
        finalRows,
        envs: environments.map(e => e.label),
        baseline: baselineEnvKey
    };

    pm.visualizer.set(template, vizPayload);
    console.log("[COMPLETE] Audit finished. Open Visualizer tab.");
}

// 5. --- MATERIAL 3 UI TEMPLATE ---
const template = `
<!DOCTYPE html>
<html>
<head>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <style>
        :root {
            --md-sys-color-primary: #6750A4;
            --md-sys-color-surface: #FEF7FF;
            --md-sys-color-outline: #CAC4D0;
            --md-sys-color-error-container: #FFDAD6;
        }

        body, html { 
            height: 100%; width: 100vw; margin: 0; padding: 0; 
            font-family: 'Roboto', sans-serif; background: var(--md-sys-color-surface); 
            overflow: hidden; 
        }

        .wrapper { display: flex; height: 100vh; width: 100vw; }

        .sidebar {
            width: 72px; background: #F3EDF7; border-right: 1px solid var(--md-sys-color-outline);
            display: flex; flex-direction: column; align-items: center; padding-top: 16px; gap: 12px;
        }

        .container { flex: 1; display: flex; flex-direction: column; height: 100vh; width: calc(100vw - 72px); }

        .header {
            padding: 8px 16px; background: white; border-bottom: 1px solid var(--md-sys-color-outline);
            display: flex; align-items: center; justify-content: space-between; height: 56px;
        }

        .search-bar { background: #ECE6F0; border-radius: 28px; padding: 0 16px; display: flex; align-items: center; width: 300px; height: 40px; }
        .search-bar input { border: none; background: transparent; outline: none; width: 100%; font-size: 14px; }

        .table-area { flex: 1; overflow: auto; background: white; width: 100%; }
        table { width: 100%; border-collapse: collapse; min-width: 100%; }
        
        th { 
            position: sticky; top: 0; background: #F7F2FA; z-index: 10;
            padding: 16px; text-align: left; font-size: 12px; color: #49454F;
            border-bottom: 2px solid var(--md-sys-color-outline);
        }
        
        .col-index { width: 50px; text-align: center !important; font-weight: bold; color: #938F99; }

        td { padding: 16px; border-bottom: 1px solid #E7E0EC; vertical-align: middle; }

        tr.mismatch-row { background-color: var(--md-sys-color-error-container) !important; }
        .v-mismatch { color: #B3261E; font-weight: 900; text-decoration: underline; }
        .v-match { color: #2E7D32; font-weight: 700; }
        .v-baseline { color: #0061A4; font-weight: 700; }

        .btn-fab { background: var(--md-sys-color-primary); color: white; border: none; padding: 10px 20px; border-radius: 12px; display: flex; align-items: center; gap: 8px; cursor: pointer; }

        #snackbar { visibility: hidden; min-width: 200px; background: #322F35; color: white; padding: 12px; position: fixed; bottom: 20px; left: 88px; border-radius: 4px; z-index: 999; }
        #snackbar.show { visibility: visible; }
        
        #hidden-copy-area { position: absolute; left: -9999px; }
    </style>
</head>
<body>
    <div class="wrapper">
        <nav class="sidebar">
            <div class="nav-item active"><span class="material-icons">fact_check</span></div>
        </nav>

        <main class="container">
            <header class="header">
                <div class="search-bar">
                    <span class="material-icons" style="font-size:20px; color:#444">search</span>
                    <input type="text" id="searchInput" onkeyup="filterTable()" placeholder="Search apps...">
                </div>
                
                <div style="display:flex; align-items:center; gap:12px;">
                    <span style="font-size:13px; font-weight:500">Mismatches Only</span>
                    <input type="checkbox" id="mismatchToggle" onchange="filterTable()">
                </div>

                <button class="btn-fab" id="btn-copy">
                    <span class="material-icons">content_copy</span> COPY CSV
                </button>
            </header>

            <div class="table-area">
                <table id="auditTable">
                    <thead>
                        <tr>
                            <th class="col-index">#</th>
                            <th>Application Name</th>
                            {{#each envs}}
                            <th>{{this}} {{#if (eq this ../baseline)}}(B){{/if}}</th>
                            {{/each}}
                        </tr>
                    </thead>
                    <tbody id="tableBody">
                        {{#each finalRows}}
                        <tr class="app-row {{#if isMismatch}}mismatch-row{{/if}}" data-name="{{appName}}" data-mismatch="{{isMismatch}}">
                            <td class="col-index row-index"></td>
                            <td><strong>{{appName}}</strong></td>
                            {{#each envDetails}}
                            <td>
                                {{#if exists}}
                                    <div class="{{matchClass}}">v{{appVersion}}</div>
                                    <div style="font-size:10px; color:#444">RT: {{runtimeVersion}}</div>
                                {{else}}
                                    <span style="color:#999">---</span>
                                {{/if}}
                            </td>
                            {{/each}}
                        </tr>
                        {{/each}}
                    </tbody>
                </table>
            </div>
        </main>
    </div>

    <textarea id="hidden-copy-area"></textarea>
    <div id="snackbar">CSV Copied to Clipboard</div>

    <script>
        const d = pm.getData();

        function filterTable() {
            const query = document.getElementById('searchInput').value.toLowerCase();
            const showOnlyMismatches = document.getElementById('mismatchToggle').checked;
            const rows = document.querySelectorAll('.app-row');
            let counter = 0;

            rows.forEach(row => {
                const name = row.getAttribute('data-name').toLowerCase();
                const mismatch = row.getAttribute('data-mismatch') === 'true';
                const matchSearch = name.includes(query);
                const matchToggle = !showOnlyMismatches || mismatch;

                if (matchSearch && matchToggle) {
                    row.style.display = '';
                    counter++;
                    row.querySelector('.row-index').textContent = counter;
                } else {
                    row.style.display = 'none';
                }
            });
        }

        // --- FIXED COPY LOGIC ---
        document.getElementById('btn-copy').addEventListener('click', function() {
            let csv = "App,Baseline," + d.envs.join(",") + "\\n";
            d.finalRows.forEach(r => {
                let row = [r.appName];
                let b = r.envDetails.find(e => e.envLabel === d.baseline);
                row.push(b ? b.appVersion : "N/A");
                r.envDetails.forEach(e => row.push(e.appVersion));
                csv += row.join(",") + "\\n";
            });

            const ta = document.getElementById('hidden-copy-area');
            ta.value = csv;
            ta.focus();
            ta.select();
            
            try {
                const ok = document.execCommand('copy');
                if (ok) {
                    const sb = document.getElementById("snackbar");
                    sb.className = "show";
                    setTimeout(() => sb.className = "", 2500);
                }
            } catch (err) { console.error("Copy failed", err); }
        });

        // Init indices
        filterTable();
        Handlebars.registerHelper('eq', (a, b) => a === b);
    </script>
</body>
</html>
`;

// 6. --- START RECURSION ---
if (environments.length > 0) {
    runAudit(0);
} else {
    console.error("[ERROR] No environments with 'digital-' prefix found.");
}
