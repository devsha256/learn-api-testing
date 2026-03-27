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
        body, html { margin: 0; padding: 0; height: 100%; font-family: 'Roboto', sans-serif; background: var(--md-s); overflow: hidden; }
        .wrapper { display: flex; height: 100vh; width: 100vw; }
        
        /* Sidebar Navigation */
        .sidebar { 
            width: 64px; background: var(--md-c); border-right: 1px solid #CAC4D0; 
            display: flex; flex-direction: column; align-items: center; padding-top: 20px; gap: 12px;
        }
        .nav-btn { 
            width: 44px; height: 44px; border-radius: 12px; display: flex; 
            align-items: center; justify-content: center; cursor: pointer; color: #49454F;
        }
        .nav-btn.active { background: #EADDFF; color: #21005D; }

        /* Content Area */
        .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .header { 
            padding: 12px 20px; display: flex; align-items: center; gap: 16px; 
            background: #fff; border-bottom: 1px solid #CAC4D0;
        }
        .search-input { flex: 1; height: 40px; border-radius: 20px; border: 1px solid #79747E; padding: 0 16px; font-size: 14px; outline: none; }
        
        /* M3 Toggle Switch */
        .toggle-group { display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 500; cursor: pointer; }
        .m3-switch { position: relative; width: 36px; height: 20px; background: #938F99; border-radius: 10px; transition: .2s; }
        .m3-switch::after { content: ""; position: absolute; width: 14px; height: 14px; background: #fff; border-radius: 50%; top: 3px; left: 3px; transition: .2s; }
        #mismatchTog:checked + .m3-switch { background: var(--md-p); }
        #mismatchTog:checked + .m3-switch::after { left: 19px; }

        .btn-action { background: var(--md-p); color: #fff; border: none; padding: 10px 20px; border-radius: 20px; font-weight: 500; cursor: pointer; }

        /* Table Design */
        .scroll-view { flex: 1; overflow: auto; }
        table { width: 100%; border-collapse: collapse; min-width: 1000px; }
        th { position: sticky; top: 0; background: #F7F2FA; padding: 16px; text-align: left; font-size: 12px; border-bottom: 2px solid #CAC4D0; z-index: 10; color: #49454F; }
        td { padding: 16px; border-bottom: 1px solid #E7E0EC; vertical-align: top; }
        
        .row-mismatch { background-color: #FFF8F8; }
        .row-mismatch:hover { background-color: #FFEBEE; }
        
        .v-match { color: var(--ok); font-weight: 700; }
        .v-mismatch { color: var(--err); font-weight: 700; }
        .v-baseline { color: var(--base); font-weight: 700; border-left: 4px solid var(--base); padding-left: 8px; }
        .v-missing { color: #938F99; font-style: italic; }
        .rt-label { font-size: 10px; color: #444; margin-top: 4px; }
        
        .pane { display: none; height: 100%; } .pane.active { display: block; }
        #toast { visibility: hidden; position: fixed; bottom: 20px; left: 80px; background: #322F35; color: #fff; padding: 12px 24px; border-radius: 4px; z-index: 1000; }
        #toast.show { visibility: visible; }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="sidebar">
            <div class="nav-btn active" onclick="switchPane('audit', this)" title="Audit Dashboard"><span class="material-icons">fact_check</span></div>
            <div class="nav-btn" onclick="switchPane('stats', this)" title="Statistics"><span class="material-icons">analytics</span></div>
        </div>
        
        <div class="main">
            <header class="header">
                <input type="text" id="appSearch" class="search-input" placeholder="Search applications..." onkeyup="applyFilters()">
                <label class="toggle-group">
                    <span>Mismatches Only</span>
                    <input type="checkbox" id="mismatchTog" style="display:none" onchange="applyFilters()">
                    <div class="m3-switch"></div>
                </label>
                <button class="btn-action" onclick="copyReport()">Copy CSV</button>
            </header>

            <div id="audit" class="pane active">
                <div class="scroll-view">
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

            <div id="stats" class="pane">
                <div style="padding: 40px;">
                    <h3>Audit Summary</h3>
                    <div id="statOutput"></div>
                </div>
            </div>
        </div>
    </div>

    <div id="toast">Report Copied</div>

    <script>
        const d = pm.getData();

        function switchPane(id, el) {
            document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.getElementById(id).classList.add('active');
            el.classList.add('active');
            
            if(id === 'stats') {
                const total = d.finalRows.length;
                const mismatches = d.finalRows.filter(r => r.rowMismatch).length;
                document.getElementById('statOutput').innerHTML = \`
                    <p>Total Applications: <strong>\${total}</strong></p>
                    <p>Out of Sync: <strong style="color:var(--err)">\${mismatches}</strong></p>
                    <p>Health Score: <strong>\${Math.round(((total-mismatches)/total)*100)}%</strong></p>
                \`;
            }
        }

        function applyFilters() {
            const query = document.getElementById('appSearch').value.toLowerCase();
            const onlyM = document.getElementById('mismatchTog').checked;
            document.querySelectorAll('.app-row').forEach(row => {
                const name = row.getAttribute('data-name').toLowerCase();
                const isM = row.getAttribute('data-mismatch') === 'true';
                const show = name.includes(query) && (!onlyM || isM);
                row.style.display = show ? '' : 'none';
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
            el.value = csv;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            
            const t = document.getElementById('toast');
            t.className = 'show';
            setTimeout(() => t.className = '', 3000);
        }
    </script>
</body>
</html>
`;

runAudit(0);
