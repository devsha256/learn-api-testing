/**
 * MULESOFT CLOUDHUB 2.0 DEPLOYMENT AUDITOR
 * Logic: Recursive Serial Execution with Prefix-Based Variable Discovery
 * UI: Edge-to-Edge Material Design 3 with Indexing & Mismatch Toggles
 */

// 1. CONFIGURATION & DYNAMIC DISCOVERY
const token = pm.collectionVariables.get("token");
const orgId = pm.collectionVariables.get("orgId");
const envPrefix = pm.collectionVariables.get("envPrefix"); 
const baselineEnvKey = pm.collectionVariables.get("baselineEnv") || "dev";
const throttleMs = parseInt(pm.collectionVariables.get("throttleMs")) || 150;

const rows = {};
const allVars = pm.collectionVariables.toObject();

// Discover environments based on envPrefix match
const environments = Object.keys(allVars)
    .filter(key => key.startsWith(envPrefix))
    .map(key => ({ 
        label: key.replace(envPrefix + "-", "").toLowerCase(), 
        id: allVars[key]
    }));

console.log(`[START] Audit initiated. Found ${environments.length} environments.`);

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
            console.error(`[ERROR] ${env.label} failed.`);
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

// 4. FINALIZER
function finalize() {
    const finalRows = Object.keys(rows).sort().map((appName, index) => {
        const appData = rows[appName];
        const baseVer = appData[baselineEnvKey]?.appVersion;
        let rowHasMismatch = false;
        
        const envDetails = environments.map(env => {
            const cur = appData[env.label];
            let mClass = "v-mismatch";
            
            if (!cur) mClass = "v-missing";
            else if (env.label === baselineEnvKey) mClass = "v-baseline";
            else if (cur.appVersion === baseVer) mClass = "v-match";
            else { rowHasMismatch = true; }

            return { 
                envLabel: env.label, 
                exists: !!cur, 
                appVersion: cur?.appVersion || "N/A", 
                runtimeVersion: cur?.runtimeVersion || "N/A", 
                matchClass: mClass 
            };
        });

        return { 
            index: index + 1,
            appName, 
            envDetails, 
            isMismatch: rowHasMismatch 
        };
    });

    pm.visualizer.set(template, {
        finalRows, 
        envs: environments.map(e => e.label),
        baseline: baselineEnvKey
    });
}

// 5. VISUALIZER TEMPLATE
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
            --md-sys-color-surface: #FEF7FF;
            --md-sys-color-outline: #CAC4D0;
            --md-sys-color-error-container: #FFDAD6;
        }

        /* 1. Viewport Fix: Force full height/width and remove all margins */
        body, html { 
            height: 100%; width: 100%; margin: 0; padding: 0; 
            font-family: 'Roboto', sans-serif; background: var(--md-sys-color-surface); 
            overflow: hidden; 
        }

        .wrapper { display: flex; height: 100vh; width: 100vw; }

        /* Sidebar Nav */
        .sidebar {
            width: 72px; background: #F3EDF7; border-right: 1px solid var(--md-sys-color-outline);
            display: flex; flex-direction: column; align-items: center; padding-top: 16px; gap: 12px;
        }
        .nav-item { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #49454F; }
        .nav-item.active { background: #EADDFF; color: #21005D; }

        .container { flex: 1; display: flex; flex-direction: column; height: 100vh; }

        /* Header Fix: Consistent height, zero side gaps */
        .header {
            padding: 8px 16px; background: white; border-bottom: 1px solid var(--md-sys-color-outline);
            display: flex; align-items: center; gap: 20px; height: 56px; box-sizing: border-box;
        }

        .search-bar { background: #ECE6F0; border-radius: 28px; padding: 0 16px; display: flex; align-items: center; flex: 1; max-width: 400px; height: 40px; }
        .search-bar input { border: none; background: transparent; outline: none; width: 100%; font-size: 14px; }
        
        /* 2. Unused Space Fix: Table area takes all remaining height */
        .table-area { flex: 1; overflow: auto; background: white; width: 100%; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        
        th { 
            position: sticky; top: 0; background: #F7F2FA; z-index: 10;
            padding: 12px; text-align: left; font-size: 12px; color: #49454F;
            border-bottom: 2px solid var(--md-sys-color-outline);
        }
        
        /* 3. Index Column: Centered alignment */
        .col-index { width: 50px; text-align: center !important; color: #938F99; font-size: 11px; }
        .col-name { width: 35%; }

        td { padding: 12px; border-bottom: 1px solid #E7E0EC; vertical-align: middle; }

        tr.mismatch-row { background-color: var(--md-sys-color-error-container); }
        .v-match { color: #2E7D32; font-weight: 700; }
        .v-mismatch { color: #B3261E; font-weight: 900; text-decoration: underline; }

        .btn-fab { background: var(--md-sys-color-primary); color: white; border: none; padding: 8px 16px; border-radius: 12px; display: flex; align-items: center; gap: 8px; cursor: pointer; }

        #snackbar { visibility: hidden; min-width: 200px; background: #322F35; color: white; padding: 12px; position: fixed; bottom: 20px; left: 88px; border-radius: 4px; }
        #snackbar.show { visibility: visible; }
        #csvFallback { position: absolute; left: -9999px; }
    </style>
</head>
<body>
    <div class="wrapper">
        <nav class="sidebar">
            <div class="nav-item active"><span class="material-icons">fact_check</span></div>
            <div class="nav-item"><span class="material-icons">insights</span></div>
        </nav>

        <main class="container">
            <header class="header">
                <div class="search-bar">
                    <span class="material-icons" style="font-size:20px">search</span>
                    <input type="text" id="searchInput" onkeyup="updateFilters()" placeholder="Search apps...">
                </div>
                
                <div style="display:flex; align-items:center; gap:8px; font-size:13px;">
                    <span>Mismatches Only</span>
                    <input type="checkbox" id="mismatchToggle" onchange="updateFilters()">
                </div>

                <button class="btn-fab" id="copyCsvBtn">
                    <span class="material-icons">content_copy</span> Copy CSV
                </button>
            </header>

            <div class="table-area">
                <table id="auditTable">
                    <thead>
                        <tr>
                            <th class="col-index">#</th>
                            <th class="col-name">Application Name</th>
                            {{#each envs}}
                            <th>{{this}}</th>
                            {{/each}}
                        </tr>
                    </thead>
                    <tbody id="tableBody">
                        {{#each finalRows}}
                        <tr class="app-row {{#if isMismatch}}mismatch-row{{/if}}" data-name="{{appName}}" data-mismatch="{{isMismatch}}">
                            <td class="row-index col-index"></td>
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

    <textarea id="csvFallback"></textarea>
    <div id="snackbar">CSV Copied</div>

    <script>
        const d = pm.getData();

        // 4. Dynamic Indexing: Recalculate IDs based on what is visible
        function updateFilters() {
            const query = document.getElementById('searchInput').value.toLowerCase();
            const showOnlyMismatches = document.getElementById('mismatchToggle').checked;
            const rows = document.querySelectorAll('.app-row');
            let visibleCount = 0;

            rows.forEach(row => {
                const name = row.getAttribute('data-name').toLowerCase();
                const isMismatch = row.getAttribute('data-mismatch') === 'true';
                
                const matchesSearch = name.includes(query);
                const matchesToggle = !showOnlyMismatches || isMismatch;

                if (matchesSearch && matchesToggle) {
                    row.style.display = '';
                    visibleCount++;
                    row.querySelector('.row-index').textContent = visibleCount;
                } else {
                    row.style.display = 'none';
                }
            });
        }

        async function copyText(text) {
            const ta = document.getElementById('csvFallback');
            ta.value = text;
            ta.select();
            document.execCommand('copy');
            const x = document.getElementById("snackbar");
            x.className = "show";
            setTimeout(() => x.className = "", 2000);
        }

        document.getElementById('copyCsvBtn').addEventListener('click', () => {
            let csv = "App,Baseline," + d.envs.join(",") + "\\n";
            d.finalRows.forEach(r => {
                let row = [r.appName];
                let b = r.envDetails.find(e => e.envLabel === d.baseline);
                row.push(b ? b.appVersion : "N/A");
                r.envDetails.forEach(e => row.push(e.appVersion));
                csv += row.join(",") + "\\n";
            });
            copyText(csv);
        });

        // Initialize Index on load
        updateFilters();
    </script>
</body>
</html>
`;

// 6. START EXECUTION
processEnvironment(0);
