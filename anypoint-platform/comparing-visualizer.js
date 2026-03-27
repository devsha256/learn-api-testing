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
        let rowHasMismatch = false;
        
        const envDetails = environments.map(env => {
            const cur = appData[env.label];
            let mClass = "v-mismatch";
            if (!cur) mClass = "v-missing";
            else if (env.label === baselineEnvKey) mClass = "v-baseline";
            else if (cur.appVersion === baseVer) {
                mClass = "v-match";
            } else {
                rowHasMismatch = true; // Mark row as mismatch if any env differs from baseline
            }

            return { envLabel: env.label, exists: !!cur, appVersion: cur?.appVersion || "N/A", 
                     runtimeVersion: cur?.runtimeVersion || "N/A", matchClass: mClass };
        });

        return { appName, envDetails, isMismatch: rowHasMismatch };
    });

    pm.visualizer.set(template, {
        finalRows, 
        envs: environments.map(e => e.label),
        baseline: baselineEnvKey
    });
}

// 5. MATERIAL DESIGN 3 TEMPLATE
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
            --md-sys-color-outline: #CAC4D0;
            --md-sys-color-error: #B3261E;
            --md-sys-color-error-container: #F9DEDC;
            --md-sys-color-success: #2E7D32;
        }

        body, html { 
            height: 100%; margin: 0; padding: 0; 
            font-family: 'Roboto', sans-serif; background: var(--md-sys-color-surface); 
            overflow: hidden;
        }

        .wrapper { display: flex; height: 100vh; width: 100vw; }

        /* Sidebar Navigation */
        .sidebar {
            width: 72px; background: var(--md-sys-color-surface-container);
            border-right: 1px solid var(--md-sys-color-outline);
            display: flex; flex-direction: column; align-items: center; padding-top: 16px; gap: 12px;
        }
        .nav-item {
            width: 48px; height: 48px; border-radius: 12px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; color: #49454F; transition: 0.2s;
        }
        .nav-item.active { background: #EADDFF; color: #21005D; }
        .nav-item:hover:not(.active) { background: #E7E0EC; }

        /* Main Content */
        .container { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

        /* Header & Controls */
        .header {
            padding: 12px 24px; background: var(--md-sys-color-surface);
            border-bottom: 1px solid var(--md-sys-color-outline);
            display: flex; align-items: center; gap: 24px;
        }
        .search-bar {
            background: #ECE6F0; border-radius: 28px; padding: 0 16px;
            display: flex; align-items: center; flex: 1; max-width: 400px; height: 48px;
        }
        .search-bar input {
            border: none; background: transparent; outline: none; padding: 8px; width: 100%; font-size: 16px;
        }
        
        /* Mismatch Toggle Switch */
        .toggle-container { display: flex; align-items: center; gap: 12px; font-size: 14px; font-weight: 500; cursor: pointer; }
        .switch {
            position: relative; width: 52px; height: 32px;
            background: #79747E; border-radius: 16px; transition: 0.3s;
        }
        .switch::after {
            content: ''; position: absolute; width: 24px; height: 24px;
            background: white; border-radius: 50%; top: 4px; left: 4px; transition: 0.3s;
        }
        input#mismatchToggle:checked + .switch { background: var(--md-sys-color-primary); }
        input#mismatchToggle:checked + .switch::after { left: 24px; }

        /* Table Area */
        .table-area { flex: 1; overflow: auto; background: white; }
        table { width: 100%; border-collapse: collapse; min-width: 1000px; }
        th { 
            position: sticky; top: 0; background: #F7F2FA; z-index: 10;
            padding: 16px; text-align: left; font-size: 12px; color: #49454F;
            border-bottom: 1px solid var(--md-sys-color-outline);
        }
        td { padding: 12px 16px; border-bottom: 1px solid #E7E0EC; }
        
        /* Row Highlighting */
        tr.mismatch-row { background-color: #FFF0F0; }
        tr.mismatch-row:hover { background-color: #FFEBEE; }
        
        .v-match { color: var(--md-sys-color-success); font-weight: 700; }
        .v-mismatch { color: var(--md-sys-color-error); font-weight: 700; }
        .v-baseline { color: #0061A4; font-weight: 700; }

        .btn-fab {
            background: var(--md-sys-color-primary); color: white; border: none;
            padding: 10px 20px; border-radius: 16px; display: flex; align-items: center; gap: 8px;
            font-weight: 500; cursor: pointer;
        }

        /* Hidden elements */
        .tab-content { display: none; height: 100%; }
        .tab-content.active { display: block; }
        #snackbar {
            visibility: hidden; min-width: 250px; background: #322F35; color: white;
            padding: 14px 24px; position: fixed; bottom: 24px; left: 88px; border-radius: 4px; z-index: 1000;
        }
        #snackbar.show { visibility: visible; }
    </style>
</head>
<body>
    <div class="wrapper">
        <nav class="sidebar">
            <div class="nav-item active" onclick="switchTab('audit', this)" title="Audit View">
                <span class="material-icons">fact_check</span>
            </div>
            <div class="nav-item" onclick="switchTab('stats', this)" title="Runtime Stats">
                <span class="material-icons">insights</span>
            </div>
        </nav>

        <main class="container">
            <header class="header">
                <div class="search-bar">
                    <span class="material-icons" style="color:#49454F">search</span>
                    <input type="text" id="searchInput" onkeyup="filterTable()" placeholder="Search apps...">
                </div>
                
                <label class="toggle-container">
                    <span>Show Mismatches Only</span>
                    <input type="checkbox" id="mismatchToggle" onchange="filterTable()" style="display:none">
                    <div class="switch"></div>
                </label>

                <button class="btn-fab" onclick="copyCSV()">
                    <span class="material-icons">download</span> Copy CSV
                </button>
            </header>

            <div id="audit" class="tab-content active">
                <div class="table-area">
                    <table id="auditTable">
                        <thead>
                            <tr>
                                <th>App Name</th>
                                {{#each envs}}
                                <th>{{this}}</th>
                                {{/each}}
                            </tr>
                        </thead>
                        <tbody>
                            {{#each finalRows}}
                            <tr class="app-row {{#if isMismatch}}mismatch-row{{/if}}" data-name="{{appName}}" data-mismatch="{{isMismatch}}">
                                <td><strong>{{appName}}</strong></td>
                                {{#each envDetails}}
                                <td>
                                    {{#if exists}}
                                        <div class="{{matchClass}}">v{{appVersion}}</div>
                                        <div style="font-size:10px; color:#666">RT: {{runtimeVersion}}</div>
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

            <div id="stats" class="tab-content">
                <div class="table-area" style="padding:40px;">
                    <h3>Runtime Analytics</h3>
                    <p>Coming Soon: Detailed Memory, CPU, and Patching analysis for CH2.0 clusters.</p>
                </div>
            </div>
        </main>
    </div>

    <div id="snackbar">CSV Copied</div>

    <script>
        const d = pm.getData();

        function switchTab(tabId, el) {
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
            el.classList.add('active');
        }

        function filterTable() {
            const query = document.getElementById('searchInput').value.toLowerCase();
            const showOnlyMismatches = document.getElementById('mismatchToggle').checked;
            const rows = document.querySelectorAll('.app-row');

            rows.forEach(row => {
                const name = row.getAttribute('data-name').toLowerCase();
                const isMismatch = row.getAttribute('data-mismatch') === 'true';
                
                const matchesSearch = name.includes(query);
                const matchesToggle = !showOnlyMismatches || isMismatch;

                row.style.display = (matchesSearch && matchesToggle) ? '' : 'none';
            });
        }

        function copyCSV() {
            let csv = "App,Baseline," + d.envs.join(",") + "\\n";
            d.finalRows.forEach(r => {
                let row = [r.appName];
                let b = r.envDetails.find(e => e.envLabel === d.baseline);
                row.push(b ? b.appVersion : "N/A");
                r.envDetails.forEach(e => row.push(e.appVersion));
                csv += row.join(",") + "\\n";
            });

            // FIXED CLIPBOARD LOGIC
            const textArea = document.createElement("textarea");
            textArea.value = csv;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                showToast("CSV Copied to Clipboard");
            } catch (err) {
                console.error('Copy failed', err);
            }
            document.body.removeChild(textArea);
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

processEnvironment(0);
