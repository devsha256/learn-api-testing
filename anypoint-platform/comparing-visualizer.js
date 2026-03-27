// --- 1. CONFIGURATION & DISCOVERY ---
const token = pm.collectionVariables.get("token");
const orgId = pm.collectionVariables.get("orgId");
const baselineEnvKey = pm.collectionVariables.get("baselineEnv") || "dev";
const throttleMs = parseInt(pm.collectionVariables.get("throttleMs")) || 120;

const rows = {};
const allVars = pm.collectionVariables.toObject();

// Discover "digital-" prefixed environment variables
const environments = Object.keys(allVars)
    .filter(key => key.startsWith("digital-"))
    .map(key => ({
        label: key.replace("digital-", ""),
        id: allVars[key]
    }));

// --- 2. LOGIC HELPERS ---
function normalizeAppName(name) {
    const parts = name.split("-");
    // Standard Rule: strip the last token (the env suffix)
    return parts.length > 1 ? parts.slice(0, -1).join("-") : name;
}

// --- 3. RECURSIVE API ENGINE (SANDBOX STABLE) ---
function runAudit(envIdx) {
    if (envIdx >= environments.length) {
        finalize();
        return;
    }

    const env = environments[envIdx];
    console.log(`[AUDIT] Fetching ${env.label}...`);

    const listReq = {
        url: `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments`,
        method: 'GET',
        header: { 
            'Authorization': `Bearer ${token}`, 
            'X-ANYPNT-ORG-ID': orgId, 
            'X-ANYPNT-ENV-ID': env.id 
        }
    };

    pm.sendRequest(listReq, (err, res) => {
        if (err || res.code !== 200) {
            console.error(`[SKIP] ${env.label} failed.`);
            runAudit(envIdx + 1);
            return;
        }

        const items = res.json().items || [];
        processDetails(env, items, 0, () => runAudit(envIdx + 1));
    });
}

function processDetails(env, list, itemIdx, onComplete) {
    if (itemIdx >= list.length) {
        onComplete();
        return;
    }

    const dep = list[itemIdx];
    const detailReq = {
        url: `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments/${dep.id}`,
        method: 'GET',
        header: { 
            'Authorization': `Bearer ${token}`, 
            'X-ANYPNT-ORG-ID': orgId, 
            'X-ANYPNT-ENV-ID': env.id 
        }
    };

    setTimeout(() => {
        pm.sendRequest(detailReq, (err, res) => {
            if (!err && res.code === 200) {
                const d = res.json();
                const cleanName = normalizeAppName(d.name);
                
                if (!rows[cleanName]) rows[cleanName] = {};
                rows[cleanName][env.label] = {
                    v: d.application?.ref?.version || "N/A",
                    rt: d.runtimeVersion || "N/A",
                    status: d.status || "UNKNOWN"
                };
            }
            processDetails(env, list, itemIdx + 1, onComplete);
        });
    }, throttleMs);
}

// --- 4. FINALIZER & MISMATCH ENGINE ---
function finalize() {
    const finalRows = Object.keys(rows).map(name => {
        const appData = rows[name];
        const baseVer = appData[baselineEnvKey]?.v;
        let rowMismatch = false;

        const envDetails = environments.map(env => {
            const cur = appData[env.label];
            let css = "v-match";
            
            if (!cur) css = "v-missing";
            else if (env.label === baselineEnvKey) css = "v-baseline";
            else if (cur.v !== baseVer) {
                css = "v-mismatch";
                rowMismatch = true; // Flag row for toggle
            }

            return { 
                label: env.label, 
                v: cur?.v || "N/A", 
                rt: cur?.rt || "N/A", 
                status: cur?.status || "", 
                css 
            };
        });

        return { name, envDetails, rowMismatch };
    });

    pm.visualizer.set(template, {
        finalRows,
        envs: environments.map(e => e.label),
        baseline: baselineEnvKey
    });
    console.log("[COMPLETE] Audit finished.");
}

// --- 5. VISUALIZER TEMPLATE (MATERIAL 3) ---
const template = `
<!DOCTYPE html>
<html>
<head>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <style>
        :root {
            --md-p: #6750A4; --md-s: #FEF7FF; --md-c: #F3EDF7; 
            --err: #B3261E; --ok: #2E7D32; --base: #0061A4;
        }
        
        /* FIX 1: Reset height for natural scrolling */
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; font-family: 'Roboto', sans-serif; background: var(--md-s); }
        
        .wrapper { display: flex; width: 100%; min-height: 100vh; }
        
        /* Sidebar stays sticky while page scrolls */
        .sidebar { 
            width: 64px; background: var(--md-c); border-right: 1px solid #CAC4D0; 
            display: flex; flex-direction: column; align-items: center; padding-top: 20px; gap: 12px;
            position: sticky; top: 0; height: 100vh;
        }
        
        .nav-btn { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #49454F; }
        .nav-btn.active { background: #EADDFF; color: #21005D; }

        .main { flex: 1; display: flex; flex-direction: column; width: calc(100% - 64px); }
        
        .header { 
            padding: 12px 20px; display: flex; align-items: center; gap: 16px; 
            background: #fff; border-bottom: 1px solid #CAC4D0;
            position: sticky; top: 0; z-index: 100;
        }
        
        .search-input { flex: 1; height: 40px; border-radius: 20px; border: 1px solid #79747E; padding: 0 16px; font-size: 14px; outline: none; }
        
        .toggle-group { display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 500; cursor: pointer; }
        .m3-switch { position: relative; width: 36px; height: 20px; background: #938F99; border-radius: 10px; transition: .2s; }
        .m3-switch::after { content: ""; position: absolute; width: 14px; height: 14px; background: #fff; border-radius: 50%; top: 3px; left: 3px; transition: .2s; }
        #mismatchTog:checked + .m3-switch { background: var(--md-p); }
        #mismatchTog:checked + .m3-switch::after { left: 19px; }

        /* FIX 2: Fixed Column Widths to prevent "Dancing" */
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        
        /* App name gets 30%, others split the rest equally */
        th:first-child, td:first-child { width: 30%; }
        th:not(:first-child), td:not(:first-child) { width: auto; }

        th { position: sticky; top: 64px; background: #F7F2FA; padding: 16px; text-align: left; font-size: 12px; border-bottom: 2px solid #CAC4D0; z-index: 50; color: #49454F; }
        td { padding: 16px; border-bottom: 1px solid #E7E0EC; vertical-align: top; word-break: break-all; }
        
        .row-mismatch { background-color: #FFF8F8; }
        .v-match { color: var(--ok); font-weight: 700; }
        .v-mismatch { color: var(--err); font-weight: 700; }
        .v-baseline { color: var(--base); font-weight: 700; border-left: 4px solid var(--base); padding-left: 8px; }
        .rt-label { font-size: 10px; color: #666; margin-top: 4px; }
        
        #toast { visibility: hidden; position: fixed; bottom: 20px; left: 80px; background: #322F35; color: #fff; padding: 12px 24px; border-radius: 4px; z-index: 1000; }
        #toast.show { visibility: visible; }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="sidebar">
            <div class="nav-btn active"><span class="material-icons">fact_check</span></div>
            <div class="nav-btn"><span class="material-icons">analytics</span></div>
        </div>
        
        <div class="main">
            <header class="header">
                <input type="text" id="appSearch" class="search-input" placeholder="Search applications..." onkeyup="applyFilters()">
                <label class="toggle-group">
                    <span>Mismatches Only</span>
                    <input type="checkbox" id="mismatchTog" style="display:none" onchange="applyFilters()">
                    <div class="m3-switch"></div>
                </label>
                <button style="background:var(--md-p); color:#fff; border:none; padding:10px 20px; border-radius:20px; cursor:pointer;" onclick="copyReport()">Copy CSV</button>
            </header>

            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Application Name</th>
                            {{#each envs}}<th>{{this}}</th>{{/each}}
                        </tr>
                    </thead>
                    <tbody id="auditBody">
                        {{#each finalRows}}
                        <tr class="app-row {{#if rowMismatch}}row-mismatch{{/if}}" data-name="{{name}}" data-mismatch="{{rowMismatch}}">
                            <td><strong>{{name}}</strong></td>
                            {{#each envDetails}}
                            <td>
                                <div class="{{mClass}}">v{{v}}</div>
                                <div class="rt-label">RT: {{rt}}</div>
                            </td>
                            {{/each}}
                        </tr>
                        {{/each}}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
    <div id="toast">Report Copied</div>
    <script>
        const d = pm.getData();
        function applyFilters() {
            const query = document.getElementById('appSearch').value.toLowerCase();
            const onlyM = document.getElementById('mismatchTog').checked;
            document.querySelectorAll('.app-row').forEach(row => {
                const name = row.getAttribute('data-name').toLowerCase();
                const isM = row.getAttribute('data-mismatch') === 'true';
                row.style.display = (name.includes(query) && (!onlyM || isM)) ? '' : 'none';
            });
        }
        function copyReport() {
            let csv = "Application,Baseline," + d.envs.join(",") + "\\n";
            d.finalRows.forEach(r => {
                let row = [r.name];
                let b = r.envDetails.find(e => e.envLabel === d.baseline);
                row.push(b ? b.v : "N/A");
                r.envDetails.forEach(e => row.push(e.v));
                csv += row.join(",") + "\\n";
            });
            const el = document.createElement('textarea');
            el.value = csv; document.body.appendChild(el); el.select();
            document.execCommand('copy'); document.body.removeChild(el);
            const t = document.getElementById('toast'); t.className = 'show'; setTimeout(() => t.className = '', 3000);
        }
    </script>
</body>
</html>
`;

runAudit(0);
