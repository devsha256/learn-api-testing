/**
 * MULESOFT CLOUDHUB 2.0 DEPLOYMENT AUDITOR
 * Logic: Recursive Serial Execution (Postman Sandbox Compatible)
 * UI: Google Material Design 3 (High Contrast Edition)
 */

// 1. CONFIGURATION & DISCOVERY
const token = pm.collectionVariables.get("token");
const orgId = pm.collectionVariables.get("orgId");
const baselineEnvKey = pm.collectionVariables.get("baselineEnv") || "dev";
const throttleMs = parseInt(pm.collectionVariables.get("throttleMs")) || 150;

const rows = {};
const allVars = pm.collectionVariables.toObject();

// Discover digital-* variables
const environments = Object.keys(allVars)
    .filter(key => key.startsWith("digital-"))
    .map(key => ({ 
        label: key.replace("digital-", ""), 
        id: allVars[key] 
    }));

console.log(`[START] Audit initiated for ${environments.length} environments.`);

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
    console.log(`[FETCH] Accessing: ${env.label}`);

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
            console.error(`[ERROR] Environment ${env.label} unreachable or unauthorized.`);
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
    const finalRows = Object.keys(rows).map(appName => {
        const appData = rows[appName];
        const baseVer = appData[baselineEnvKey]?.appVersion;
        let rowHasMismatch = false;
        
        const envDetails = environments.map(env => {
            const cur = appData[env.label];
            let mClass = "v-mismatch";
            
            if (!cur) {
                mClass = "v-missing";
            } else if (env.label === baselineEnvKey) {
                mClass = "v-baseline";
            } else if (cur.appVersion === baseVer) {
                mClass = "v-match";
            } else {
                rowHasMismatch = true; // Flag for high-contrast row highlighting
            }

            return { 
                envLabel: env.label, 
                exists: !!cur, 
                appVersion: cur?.appVersion || "N/A", 
                runtimeVersion: cur?.runtimeVersion || "N/A", 
                status: cur?.status || "", 
                matchClass: mClass 
            };
        });

        return { appName, envDetails, isMismatch: rowHasMismatch };
    });

    pm.visualizer.set(template, {
        finalRows, 
        envs: environments.map(e => e.label),
        baseline: baselineEnvKey
    });
    console.log("[COMPLETE] Visualizer updated with audit results.");
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
            --md-sys-color-surface-container: #F3EDF7;
            --md-sys-color-outline: #CAC4D0;
            --md-sys-color-error: #B3261E;
            --md-sys-color-error-container: #FFDAD6;
            --md-sys-color-success: #2E7D32;
        }

        body, html { height: 100%; width: 100%; margin: 0; padding: 0; font-family: 'Roboto', sans-serif; overflow: hidden; }
        .wrapper { display: flex; height: 100vh; width: 100vw; }
        
        /* Sidebar */
        .sidebar {
            width: 72px; background: var(--md-sys-color-surface-container);
            border-right: 1px solid var(--md-sys-color-outline);
            display: flex; flex-direction: column; align-items: center; padding-top: 16px; gap: 12px;
        }
        .nav-item {
            width: 48px; height: 48px; border-radius: 12px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; color: #49454F;
        }
        .nav-item.active { background: #EADDFF; color: #21005D; }

        .container { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

        /* Header Controls */
        .header {
            padding: 8px 16px; background: var(--md-sys-color-surface);
            border-bottom: 1px solid var(--md-sys-color-outline);
            display: flex; align-items: center; gap: 16px;
        }
        .search-bar {
            background: #ECE6F0; border-radius: 28px; padding: 0 16px;
            display: flex; align-items: center; flex: 1; max-width: 350px; height: 40px;
        }
        .search-bar input { border: none; background: transparent; outline: none; width: 100%; font-size: 14px; }

        /* Table Area */
        .table-area { flex: 1; overflow: auto; background: white; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th { 
            position: sticky; top: 0; background: #F7F2FA; z-index: 10;
            padding: 12px 16px; text-align: left; font-size: 12px; color: #49454F;
            border-bottom: 2px solid var(--md-sys-color-outline);
        }
        td { padding: 12px 16px; border-bottom: 1px solid #E7E0EC; }

        /* Mismatch Highlighting */
        tr.mismatch-row { background-color: var(--md-sys-color-error-container) !important; }
        tr.mismatch-row td { border-bottom: 1px solid #F9AFAF; }
        
        .v-match { color: var(--md-sys-color-success); font-weight: 700; }
        .v-mismatch { color: var(--md-sys-color-error); font-weight: 900; text-decoration: underline; }
        .v-baseline { color: #0061A4; font-weight: 700; }
        .v-missing { color: #999; font-style: italic; }

        .btn-fab {
            background: var(--md-sys-color-primary); color: white; border: none;
            padding: 8px 16px; border-radius: 12px; display: flex; align-items: center; gap: 8px;
            font-weight: 500; cursor: pointer;
        }

        #snackbar {
            visibility: hidden; min-width: 200px; background: #322F35; color: white;
            padding: 12px 20px; position: fixed; bottom: 20px; left: 88px; border-radius: 4px; z-index: 1000;
        }
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
                    <span class="material-icons" style="font-size:20px; color:#49454F">search</span>
                    <input type="text" id="searchInput" onkeyup="filterTable()" placeholder="Search apps...">
                </div>
                <button class="btn-fab" id="copyCsvBtn">
                    <span class="material-icons">content_copy</span> Copy CSV
                </button>
            </header>

            <div class="table-area">
                <table id="auditTable">
                    <thead>
                        <tr>
                            <th style="width: 25%;">App Name</th>
                            {{#each envs}}
                            <th>{{this}}</th>
                            {{/each}}
                        </tr>
                    </thead>
                    <tbody>
                        {{#each finalRows}}
                        <tr class="app-row {{#if isMismatch}}mismatch-row{{/if}}" data-name="{{appName}}">
                            <td><strong>{{appName}}</strong></td>
                            {{#each envDetails}}
                            <td>
                                {{#if exists}}
                                    <div class="{{matchClass}}">v{{appVersion}}</div>
                                    <div style="font-size:10px; color:#444">RT: {{runtimeVersion}}</div>
                                    <div style="font-size:9px; color:#666; font-weight:500">{{status}}</div>
                                {{else}}
                                    <span class="v-missing">---</span>
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
        const snack = document.getElementById('snackbar');

        function toast(msg) {
            snack.textContent = msg;
            snack.classList.add('show');
            setTimeout(() => snack.classList.remove('show'), 2000);
        }

        async function copyText(text) {
            try {
                if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(text);
                    return true;
                }
            } catch (e) { }

            try {
                const ta = document.getElementById('csvFallback');
                ta.value = text;
                ta.focus(); ta.select();
                const ok = document.execCommand('copy');
                ta.blur();
                return !!ok;
            } catch (e) { return false; }
        }

        document.getElementById('copyCsvBtn').addEventListener('click', async () => {
            let csv = "App,Baseline," + d.envs.join(",") + "\\n";
            d.finalRows.forEach(r => {
                let row = [r.appName];
                let b = r.envDetails.find(e => e.envLabel === d.baseline);
                row.push(b ? b.appVersion : "N/A");
                r.envDetails.forEach(e => row.push(e.appVersion));
                csv += row.join(",") + "\\n";
            });
            const ok = await copyText(csv);
            toast(ok ? 'CSV copied to clipboard' : 'Copy failed');
        });

        function filterTable() {
            const query = document.getElementById('searchInput').value.toLowerCase();
            document.querySelectorAll('.app-row').forEach(row => {
                const name = row.getAttribute('data-name').toLowerCase();
                row.style.display = name.includes(query) ? '' : 'none';
            });
        }
    </script>
</body>
</html>
`;

// 6. START EXECUTION
processEnvironment(0);
