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
            --md-sys-color-error: #B3261E; /* Material Red 40 */
            --md-sys-color-error-container: #FFDAD6; /* Material Red 90 */
            --md-sys-color-success: #2E7D32;
        }

        /* 1. Viewport Fix: Zero margins/padding to capture full screen */
        body, html { 
            height: 100%; width: 100%; margin: 0; padding: 0; 
            font-family: 'Roboto', sans-serif; background: var(--md-sys-color-surface); 
            overflow: hidden;
        }

        .wrapper { display: flex; height: 100vh; width: 100vw; }

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

        .header {
            padding: 8px 16px; background: var(--md-sys-color-surface);
            border-bottom: 1px solid var(--md-sys-color-outline);
            display: flex; align-items: center; gap: 16px;
        }

        .search-bar {
            background: #ECE6F0; border-radius: 28px; padding: 0 16px;
            display: flex; align-items: center; flex: 1; max-width: 300px; height: 40px;
        }
        .search-bar input { border: none; background: transparent; outline: none; width: 100%; }

        /* 2. Padding Fix: Table area takes full width */
        .table-area { flex: 1; overflow: auto; background: white; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th { 
            position: sticky; top: 0; background: #F7F2FA; z-index: 10;
            padding: 12px 16px; text-align: left; font-size: 12px; color: #49454F;
            border-bottom: 2px solid var(--md-sys-color-outline);
        }
        td { padding: 12px 16px; border-bottom: 1px solid #E7E0EC; word-break: break-all; }

        /* 3. Contrast Fix: Stronger Highlighting for Mismatches */
        tr.mismatch-row { background-color: var(--md-sys-color-error-container) !important; }
        tr.mismatch-row td { border-bottom: 1px solid #F9AFAF; }
        tr.mismatch-row:hover { background-color: #FFCFCC !important; }
        
        .v-match { color: var(--md-sys-color-success); font-weight: 700; }
        .v-mismatch { color: var(--md-sys-color-error); font-weight: 900; text-decoration: underline; }
        .v-baseline { color: #0061A4; font-weight: 700; }

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
        
        /* Fallback textarea for copy */
        #csvFallback { position: absolute; left: -9999px; top: 0; }
    </style>
</head>
<body>
    <div class="wrapper">
        <nav class="sidebar">
            <div class="nav-item active" onclick="switchTab('audit', this)"><span class="material-icons">fact_check</span></div>
            <div class="nav-item" onclick="switchTab('stats', this)"><span class="material-icons">insights</span></div>
        </nav>

        <main class="container">
            <header class="header">
                <div class="search-bar">
                    <span class="material-icons" style="font-size:20px">search</span>
                    <input type="text" id="searchInput" onkeyup="filterTable()" placeholder="Search apps...">
                </div>
                <button class="btn-fab" id="copyCsvBtn">
                    <span class="material-icons">content_copy</span> Copy CSV
                </button>
            </header>

            <div id="audit" class="tab-content">
                <div class="table-area">
                    <table id="auditTable">
                        <thead>
                            <tr>
                                <th style="width: 30%;">App Name</th>
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
            setTimeout(() => snack.classList.remove('show'), 1800);
        }

        async function copyText(text) {
            try {
                if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(text);
                    return true;
                }
            } catch (e) { /* fall through */ }

            try {
                const ta = document.getElementById('csvFallback');
                ta.value = text;
                ta.focus();
                ta.select();
                const ok = document.execCommand('copy');
                ta.blur();
                return !!ok;
            } catch (e) {
                return false;
            }
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
            toast(ok ? 'CSV copied to clipboard' : 'Copy failed (clipboard blocked)');
        });

        function filterTable() {
            const query = document.getElementById('searchInput').value.toLowerCase();
            document.querySelectorAll('.app-row').forEach(row => {
                const name = row.getAttribute('data-name').toLowerCase();
                row.style.display = name.includes(query) ? '' : 'none';
            });
        }
        
        function switchTab(tabId, el) {
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            el.classList.add('active');
            // Logic to toggle content could go here
        }
    </script>
</body>
</html>
`;

runAudit(0);
