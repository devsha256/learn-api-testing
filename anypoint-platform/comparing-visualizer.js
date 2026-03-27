// 1. DYNAMIC CONFIGURATION
const token = pm.collectionVariables.get("token");
const orgId = pm.collectionVariables.get("orgId");
const envPrefix = pm.collectionVariables.get("envPrefix"); // e.g., "retail-digital"
const baselineEnvKey = pm.collectionVariables.get("baselineEnv") || "preprod"; // Full key name from your image
const throttleMs = parseInt(pm.collectionVariables.get("throttleMs")) || 150;

const rows = {};
const debugLog = [];

// 2. DYNAMIC DISCOVERY: Find all vars starting with your prefix
const allVars = pm.collectionVariables.toObject();
const environments = Object.keys(allVars)
    .filter(key => key.startsWith(envPrefix + "-"))
    .map(key => ({
        label: key, // Keep full name (e.g., retail-digital-dev)
        id: allVars[key]
    }));

function log(msg) {
    const ts = new Date().toISOString().split('T')[1].split('Z')[0];
    console.log(`[${ts}] ${msg}`);
    debugLog.push(`${ts}: ${msg}`);
}

function normalizeAppName(name) {
    const parts = name.split("-");
    return parts.length > 1 ? parts.slice(0, -1).join("-") : name;
}

// 3. RECURSIVE SERIAL ENGINE (Postman Sandbox Compatible)
function startAudit(index) {
    if (index >= environments.length) {
        finalize();
        return;
    }

    const env = environments[index];
    log(`Auditing: ${env.label}`);

    pm.sendRequest({
        url: `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments`,
        method: 'GET',
        header: { 'Authorization': `Bearer ${token}`, 'X-ANYPNT-ORG-ID': orgId, 'X-ANYPNT-ENV-ID': env.id }
    }, (err, res) => {
        if (err || res.code !== 200) {
            log(`Error in ${env.label}: ${res ? res.code : 'No Response'}`);
            startAudit(index + 1);
            return;
        }

        const items = res.json().items || [];
        processDeps(env, items, 0, () => startAudit(index + 1));
    });
}

function processDeps(env, list, dIdx, nextEnv) {
    if (dIdx >= list.length) { nextEnv(); return; }

    const dep = list[dIdx];
    setTimeout(() => {
        pm.sendRequest({
            url: `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments/${dep.id}`,
            method: 'GET',
            header: { 'Authorization': `Bearer ${token}`, 'X-ANYPNT-ORG-ID': orgId, 'X-ANYPNT-ENV-ID': env.id }
        }, (err, res) => {
            if (!err && res.code === 200) {
                const d = res.json();
                const norm = normalizeAppName(d.name);
                if (!rows[norm]) rows[norm] = {};
                rows[norm][env.label] = {
                    appVersion: d.application?.ref?.version || "N/A",
                    runtimeVersion: d.runtimeVersion || "N/A",
                    status: d.status || "UNKNOWN"
                };
            }
            processDeps(env, list, dIdx + 1, nextEnv);
        });
    }, throttleMs);
}

// 4. FINALIZER & MATERIAL 3 UI
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
            else if (cur.appVersion !== baseVer) {
                mClass = "v-mismatch";
                isMismatch = true;
            }
            return { label: env.label, exists: !!cur, ...cur, matchClass: mClass };
        });

        return { appName, envDetails, isMismatch };
    });

    pm.visualizer.set(template, {
        finalRows, 
        envs: environments.map(e => e.label),
        baseline: baselineEnvKey
    });
    log("Audit Complete. Ready to Visualize.");
}

const template = `
<!DOCTYPE html>
<html>
<head>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <style>
        :root {
            --primary: #6750A4; --surface: #FEF7FF; --outline: #CAC4D0; --err-bg: #FFDAD6; --err-text: #B3261E;
        }
        body, html { height: 100%; width: 100vw; margin: 0; padding: 0; font-family: 'Roboto'; background: var(--surface); overflow: hidden; }
        .wrapper { display: flex; height: 100vh; width: 100vw; }
        .sidebar { width: 64px; background: #F3EDF7; border-right: 1px solid var(--outline); display: flex; flex-direction: column; align-items: center; padding-top: 20px; }
        .container { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .header { padding: 8px 16px; background: white; border-bottom: 1px solid var(--outline); display: flex; align-items: center; justify-content: space-between; height: 56px; }
        .table-area { flex: 1; overflow: auto; background: white; width: 100%; }
        table { width: 100%; border-collapse: collapse; table-layout: auto; }
        th { position: sticky; top: 0; background: #F7F2FA; padding: 16px; text-align: left; font-size: 12px; border-bottom: 2px solid var(--outline); z-index: 10; }
        td { padding: 16px; border-bottom: 1px solid #E7E0EC; }
        .mismatch-row { background-color: var(--err-bg) !important; }
        .v-mismatch { color: var(--err-text); font-weight: 900; text-decoration: underline; }
        .v-match { color: #2E7D32; font-weight: 700; }
        .v-baseline { color: #0061A4; font-weight: 700; }
        .btn { background: var(--primary); color: white; border: none; padding: 10px 20px; border-radius: 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; font-weight: 500; }
        #snackbar { visibility: hidden; min-width: 200px; background: #322F35; color: white; padding: 12px; position: fixed; bottom: 24px; left: 88px; border-radius: 4px; z-index: 1000; }
        #snackbar.show { visibility: visible; }
        textarea#fallback { position: absolute; left: -9999px; }
        .col-idx { width: 40px; text-align: center; color: #777; }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="sidebar"><span class="material-icons" style="color:var(--primary)">fact_check</span></div>
        <div class="container">
            <header class="header">
                <input type="text" id="search" onkeyup="filter()" placeholder="Search apps..." style="background:#ECE6F0; border:none; padding:10px 20px; border-radius:20px; width:300px;">
                <button class="btn" id="copyBtn"><span class="material-icons">content_copy</span> COPY REPORT</button>
            </header>
            <div class="table-area">
                <table id="mainTable">
                    <thead><tr><th class="col-idx">#</th><th>App Name</th>{{#each envs}}<th>{{this}}</th>{{/each}}</tr></thead>
                    <tbody>
                        {{#each finalRows}}
                        <tr class="app-row {{#if isMismatch}}mismatch-row{{/if}}" data-name="{{appName}}">
                            <td class="col-idx idx-cell"></td>
                            <td><strong>{{appName}}</strong></td>
                            {{#each envDetails}}
                            <td>
                                {{#if exists}}
                                    <div class="{{matchClass}}">v{{appVersion}}</div>
                                    <div style="font-size:10px">RT: {{runtimeVersion}}</div>
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
        </div>
    </div>
    <textarea id="fallback"></textarea>
    <div id="snackbar"></div>

    <script>
        const d = pm.getData();
        console.log("[DEBUG] Visualizer Start");

        function filter() {
            const q = document.getElementById('search').value.toLowerCase();
            let count = 0;
            document.querySelectorAll('.app-row').forEach(row => {
                const match = row.getAttribute('data-name').toLowerCase().includes(q);
                row.style.display = match ? '' : 'none';
                if(match) row.querySelector('.idx-cell').textContent = ++count;
            });
        }
        filter();

        // --- CLIPBOARD DEBUG LOGIC ---
        document.getElementById('copyBtn').addEventListener('click', function() {
            console.log("[CLIPBOARD] Starting process...");
            let csv = "App,Baseline," + d.envs.join(",") + "\\n";
            d.finalRows.forEach(r => {
                let base = r.envDetails.find(e => e.label === d.baseline)?.appVersion || "N/A";
                csv += r.appName + "," + base + "," + r.envDetails.map(e => e.appVersion || "N/A").join(",") + "\\n";
            });

            console.log("[CLIPBOARD] CSV Generated. Size: " + csv.length);
            
            const ta = document.getElementById('fallback');
            ta.value = csv;
            ta.focus();
            ta.select();
            
            const success = document.execCommand('copy');
            if (success) {
                console.log("[CLIPBOARD] execCommand successful");
                toast("Report Copied!");
            } else {
                console.error("[CLIPBOARD] execCommand failed. Attempting navigator.clipboard...");
                navigator.clipboard.writeText(csv).then(() => {
                    console.log("[CLIPBOARD] Navigator success");
                    toast("Report Copied!");
                }).catch(e => {
                    console.error("[CLIPBOARD] All methods failed", e);
                    toast("Copy Blocked by Postman");
                });
            }
        });

        function toast(m) {
            const s = document.getElementById('snackbar');
            s.textContent = m; s.className = 'show';
            setTimeout(() => s.className = '', 2500);
        }
    </script>
</body>
</html>
`;

// Start Execution
startAudit(0);
