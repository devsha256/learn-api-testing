// 1. DYNAMIC CONFIGURATION
const envPrefix = pm.collectionVariables.get("envPrefix");
const baselineEnvKey = pm.collectionVariables.get("baselineEnv");
const token = pm.collectionVariables.get("token");
const orgId = pm.collectionVariables.get("orgId");
const throttleMs = parseInt(pm.collectionVariables.get("throttleMs")) || 150;

const rows = {};
const allVars = pm.collectionVariables.toObject();

// Identify environments strictly using the envPrefix (includes last hyphen)
const environments = Object.keys(allVars)
    .filter(key => key.startsWith(envPrefix))
    .map(key => ({ label: key, id: allVars[key] }));

function normalizeAppName(name) {
    const parts = name.split("-");
    return parts.length > 1 ? parts.slice(0, -1).join("-") : name;
}

// 2. RECURSIVE ENGINE
function startAudit(index) {
    if (index >= environments.length) { finalize(); return; }
    const env = environments[index];
    pm.sendRequest({
        url: `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments`,
        method: 'GET',
        header: { 'Authorization': `Bearer ${token}`, 'X-ANYPNT-ORG-ID': orgId, 'X-ANYPNT-ENV-ID': env.id }
    }, (err, res) => {
        if (err || res.code !== 200) { startAudit(index + 1); return; }
        const items = res.json().items || [];
        processDeps(env, items, 0, () => startAudit(index + 1));
    });
}

function processDeps(env, list, dIdx, next) {
    if (dIdx >= list.length) { next(); return; }
    const dep = list[dIdx];
    setTimeout(() => {
        pm.sendRequest({
            url: `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments/${dep.id}`,
            method: 'GET',
            header: { 'Authorization': `Bearer ${token}`, 'X-ANYPNT-ORG-ID': orgId, 'X-ANYPNT-ENV-ID': env.id }
        }, (err, res) => {
            if (!err && res.code === 200) {
                const d = res.json(), norm = normalizeAppName(d.name);
                if (!rows[norm]) rows[norm] = {};
                rows[norm][env.label] = { 
                    appVersion: d.application?.ref?.version || "N/A", 
                    runtimeVersion: d.runtimeVersion || "N/A", 
                    status: d.status || "UNKNOWN" 
                };
            }
            processDeps(env, list, dIdx + 1, next);
        });
    }, throttleMs);
}

// 3. FINALIZER
function finalize() {
    const finalRows = Object.keys(rows).map(appName => {
        const appData = rows[appName];
        const baseVer = appData[baselineEnvKey]?.appVersion;
        let isMismatch = false;
        const envDetails = environments.map(env => {
            const cur = appData[env.label];
            let mClass = "v-match";
            if (!cur) mClass = "v-missing";
            else if (env.label === baselineEnvKey) mClass = "v-baseline";
            else if (cur.appVersion !== baseVer) { mClass = "v-mismatch"; isMismatch = true; }
            return { label: env.label, exists: !!cur, ...cur, matchClass: mClass };
        });
        return { appName, envDetails, isMismatch };
    });

    pm.visualizer.set(template, { 
        finalRows, 
        envs: environments.map(e => e.label), 
        baseline: baselineEnvKey 
    });
}

// 4. MATERIAL DESIGN 3 TEMPLATE
const template = `
<!DOCTYPE html>
<html>
<head>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <style>
        :root {
            --md-sys-color-primary: #6750A4;
            --md-sys-color-on-primary: #FFFFFF;
            --md-sys-color-surface: #FEF7FF;
            --md-sys-color-surface-container: #F3EDF7;
            --md-sys-color-outline: #79747E;
            --md-sys-color-error-container: #FFDAD6;
            --md-sys-color-error: #B3261E;
        }

        body, html { height: 100%; width: 100vw; margin: 0; padding: 0; font-family: 'Roboto', sans-serif; background: var(--md-sys-color-surface); overflow: hidden; }
        .wrapper { display: flex; height: 100vh; width: 100vw; }
        
        /* Sidebar - M3 Navigation Rail Style */
        .sidebar { width: 72px; background: var(--md-sys-color-surface-container); border-right: 1px solid var(--md-sys-color-outline); display: flex; flex-direction: column; align-items: center; padding-top: 16px; }
        
        .container { flex: 1; display: flex; flex-direction: column; width: calc(100vw - 72px); }

        /* Header */
        .header { padding: 8px 16px; background: white; border-bottom: 1px solid var(--md-sys-color-outline); display: flex; align-items: center; justify-content: space-between; height: 64px; box-sizing: border-box; }
        
        .search-box { background: #ECE6F0; border-radius: 28px; padding: 0 16px; display: flex; align-items: center; flex: 1; max-width: 320px; height: 48px; }
        .search-box input { border: none; background: transparent; outline: none; width: 100%; font-size: 16px; margin-left: 8px; }

        /* Material 3 Switch Component */
        .m3-switch-label { display: flex; align-items: center; gap: 12px; cursor: pointer; font-size: 14px; font-weight: 500; color: #49454F; }
        .m3-switch { position: relative; width: 52px; height: 32px; background: #79747E; border-radius: 16px; transition: 0.2s; }
        .m3-switch::before { content: ""; position: absolute; width: 24px; height: 24px; background: white; border-radius: 50%; top: 4px; left: 4px; transition: 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.4); }
        input#mismatchToggle:checked + .m3-switch { background: var(--md-sys-color-primary); }
        input#mismatchToggle:checked + .m3-switch::before { left: 24px; background: white; }

        /* Table */
        .table-area { flex: 1; overflow: auto; width: 100%; }
        table { width: 100%; border-collapse: collapse; table-layout: auto; }
        th { position: sticky; top: 0; background: #F7F2FA; padding: 16px; text-align: left; font-size: 12px; letter-spacing: 0.5px; border-bottom: 1px solid var(--md-sys-color-outline); z-index: 10; color: #49454F; }
        td { padding: 16px; border-bottom: 1px solid #E7E0EC; vertical-align: middle; }
        
        .col-idx { width: 48px; text-align: center !important; color: #938F99; }
        
        /* Mismatch Contrast */
        tr.mismatch-row { background-color: var(--md-sys-color-error-container); }
        .v-mismatch { color: var(--md-sys-color-error); font-weight: 900; text-decoration: underline; font-size: 15px; }
        .v-match { color: #2E7D32; font-weight: 700; }
        .v-baseline { color: #0061A4; font-weight: 700; }

        .btn-filled { background: var(--md-sys-color-primary); color: white; border: none; padding: 12px 24px; border-radius: 100px; display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 500; font-size: 14px; }

        #snackbar { visibility: hidden; min-width: 250px; background: #322F35; color: #F4EFF4; padding: 14px 24px; position: fixed; bottom: 24px; left: 88px; border-radius: 4px; z-index: 999; }
        #snackbar.show { visibility: visible; }
        textarea#csvExportArea { position: absolute; left: -9999px; }
    </style>
</head>
<body>
    <div class="wrapper">
        <nav class="sidebar"><span class="material-icons" style="color:var(--md-sys-color-primary); margin-top:20px;">fact_check</span></nav>
        <main class="container">
            <header class="header">
                <div class="search-box">
                    <span class="material-icons">search</span>
                    <input type="text" id="searchInput" onkeyup="updateUI()" placeholder="Search applications...">
                </div>

                <label class="m3-switch-label">
                    <span>Mismatches Only</span>
                    <input type="checkbox" id="mismatchToggle" onchange="updateUI()" style="display:none">
                    <div class="m3-switch"></div>
                </label>

                <button class="btn-filled" id="copyBtn">
                    <span class="material-icons">content_copy</span> COPY CSV
                </button>
            </header>

            <div class="table-area">
                <table id="auditTable">
                    <thead>
                        <tr>
                            <th class="col-idx">#</th>
                            <th>Application Name</th>
                            {{#each envs}}<th>{{this}}</th>{{/each}}
                        </tr>
                    </thead>
                    <tbody id="tableBody">
                        {{#each finalRows}}
                        <tr class="app-row {{#if isMismatch}}mismatch-row{{/if}}" data-name="{{appName}}" data-mismatch="{{isMismatch}}">
                            <td class="col-idx dynamic-idx"></td>
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

    <textarea id="csvExportArea"></textarea>
    <div id="snackbar"></div>

    <script>
        const d = pm.getData();

        function updateUI() {
            const query = document.getElementById('searchInput').value.toLowerCase();
            const hideMatches = document.getElementById('mismatchToggle').checked;
            let visibleCount = 0;

            document.querySelectorAll('.app-row').forEach(row => {
                const name = row.getAttribute('data-name').toLowerCase();
                const isMismatch = row.getAttribute('data-mismatch') === 'true';
                const visible = name.includes(query) && (!hideMatches || isMismatch);

                row.style.display = visible ? '' : 'none';
                if(visible) {
                    visibleCount++;
                    row.querySelector('.dynamic-idx').textContent = visibleCount;
                }
            });
        }

        function showToast(msg) {
            const s = document.getElementById("snackbar");
            s.textContent = msg;
            s.className = "show";
            setTimeout(() => s.className = "", 3000);
        }

        // --- THE TRACE-LOGGED COPY FUNCTION ---
        document.getElementById('copyBtn').addEventListener('click', function() {
            console.group("[CSV EXPORT TRACE]");
            console.log("Timestamp:", new Date().toLocaleTimeString());

            try {
                let csv = "App,Baseline," + d.envs.join(",") + "\\n";
                d.finalRows.forEach(r => {
                    let base = r.envDetails.find(e => e.label === d.baseline)?.appVersion || "N/A";
                    csv += r.appName + "," + base + "," + r.envDetails.map(e => e.appVersion || "N/A").join(",") + "\\n";
                });
                console.log("CSV Payload generated. Length:", csv.length);

                const ta = document.getElementById('csvExportArea');
                ta.value = csv;
                
                console.log("Attempting focus and selection...");
                ta.focus();
                ta.select();
                
                const success = document.execCommand('copy');
                
                if (success) {
                    console.log("RESULT: execCommand reported success.");
                    showToast("CSV Copied to Clipboard!");
                } else {
                    console.warn("RESULT: execCommand reported failure. Attempting modern Clipboard API...");
                    navigator.clipboard.writeText(csv).then(() => {
                        console.log("RESULT: navigator.clipboard success.");
                        showToast("CSV Copied to Clipboard!");
                    }).catch(err => {
                        console.error("CRITICAL: All copy methods failed.", err);
                        showToast("Copy Failed. Check Postman Console.");
                    });
                }
            } catch (err) {
                console.error("ERROR: Script exception during copy:", err);
            }
            console.groupEnd();
        });

        updateUI(); // Initial indexing
    </script>
</body>
</html>
`;

startAudit(0);
