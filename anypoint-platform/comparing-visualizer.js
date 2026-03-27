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
<html>
<head>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <style>
        :root {
            --primary: #6750A4;
            --surface: #FEF7FF;
            --container: #F3EDF7;
            --outline: #CAC4D0;
            --error: #B3261E;
            --success: #2E7D32;
        }

        /* 1. Viewport Fix: No margins, allow natural scrolling */
        body, html { 
            margin: 0; padding: 0; width: 100%; height: 100%;
            font-family: 'Roboto', sans-serif; background: var(--surface);
        }

        .layout { display: flex; min-height: 100vh; width: 100%; }

        /* Sidebar - Slim & Static */
        .sidebar {
            width: 64px; background: var(--container);
            border-right: 1px solid var(--outline);
            display: flex; flex-direction: column; align-items: center; padding-top: 20px; gap: 20px;
            position: sticky; top: 0; height: 100vh;
        }
        .nav-item {
            width: 40px; height: 40px; border-radius: 12px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; color: #49454F;
        }
        .nav-item.active { background: #EADDFF; color: #21005D; }

        /* Main Content - Full Width */
        .content { flex: 1; display: flex; flex-direction: column; width: calc(100% - 64px); }

        .header {
            padding: 12px 20px; background: white;
            border-bottom: 1px solid var(--outline);
            display: flex; align-items: center; gap: 20px;
            position: sticky; top: 0; z-index: 100;
        }

        .search-box {
            background: #ECE6F0; border-radius: 24px; padding: 0 16px;
            display: flex; align-items: center; flex: 1; height: 44px;
        }
        .search-box input {
            border: none; background: transparent; outline: none; width: 100%; padding: 8px; font-size: 14px;
        }

        /* 2. Toggle Fix: Classy M3 Switch */
        .switch-group { display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 500; cursor: pointer; }
        .m3-switch {
            position: relative; width: 40px; height: 20px; background: #938F99; border-radius: 10px; transition: 0.2s;
        }
        .m3-switch::before {
            content: ""; position: absolute; width: 14px; height: 14px; background: white;
            border-radius: 50%; top: 3px; left: 3px; transition: 0.2s;
        }
        input:checked + .m3-switch { background: var(--primary); }
        input:checked + .m3-switch::before { left: 23px; }

        /* 3. Table Fix: Use the whole width, allow vertical scroll */
        .table-container { width: 100%; overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; table-layout: auto; }
        th { 
            background: #F7F2FA; padding: 16px; text-align: left; font-size: 12px; 
            color: #49454F; border-bottom: 1px solid var(--outline);
        }
        td { padding: 14px 16px; border-bottom: 1px solid #E7E0EC; }

        tr.mismatch { background: #FFF8F8; }
        .v-match { color: var(--success); font-weight: 700; }
        .v-mismatch { color: var(--error); font-weight: 700; }
        .v-baseline { color: #0061A4; font-weight: 700; border-left: 3px solid #0061A4; padding-left: 8px; }

        .btn-copy {
            background: var(--primary); color: white; border: none; padding: 10px 16px;
            border-radius: 20px; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 13px;
        }

        #snackbar {
            visibility: hidden; position: fixed; bottom: 20px; left: 84px;
            background: #322F35; color: white; padding: 12px 24px; border-radius: 4px; z-index: 1000;
        }
        #snackbar.show { visibility: visible; }
    </style>
</head>
<body>
    <div class="layout">
        <div class="sidebar">
            <div class="nav-item active"><span class="material-icons">fact_check</span></div>
            <div class="nav-item"><span class="material-icons">insights</span></div>
        </div>

        <div class="content">
            <div class="header">
                <div class="search-box">
                    <span class="material-icons" style="font-size:20px">search</span>
                    <input type="text" id="srch" onkeyup="doUpdate()" placeholder="Filter apps...">
                </div>
                
                <label class="switch-group">
                    <span>Mismatches</span>
                    <input type="checkbox" id="tog" onchange="doUpdate()" style="display:none">
                    <div class="m3-switch"></div>
                </label>

                <button class="btn-copy" onclick="doCopy()">
                    <span class="material-icons" style="font-size:18px">content_copy</span> Copy Report
                </button>
            </div>

            <div class="table-container">
                <table id="target">
                    <thead>
                        <tr>
                            <th>Application Name</th>
                            {{#each envs}}<th>{{this}}</th>{{/each}}
                        </tr>
                    </thead>
                    <tbody>
                        {{#each finalRows}}
                        <tr class="item-row {{#if isMismatch}}mismatch{{/if}}" 
                            data-n="{{appName}}" 
                            data-m="{{isMismatch}}">
                            <td><strong>{{appName}}</strong></td>
                            {{#each envDetails}}
                            <td>
                                {{#if exists}}
                                    <div class="{{matchClass}}">v{{appVersion}}</div>
                                    <div style="font-size:10px; color:#444">RT: {{runtimeVersion}}</div>
                                {{else}}<span style="color:#CCC">---</span>{{/if}}
                            </td>
                            {{/each}}
                        </tr>
                        {{/each}}
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <div id="snackbar" id="toast">Report Copied</div>

    <script>
        const data = pm.getData();

        // 1. FIXED TOGGLE & SEARCH LOGIC
        function doUpdate() {
            const q = document.getElementById('srch').value.toLowerCase();
            const onlyM = document.getElementById('tog').checked;
            const rows = document.querySelectorAll('.item-row');

            rows.forEach(r => {
                const name = r.getAttribute('data-n').toLowerCase();
                const isM = r.getAttribute('data-m') === 'true';
                const show = name.includes(q) && (!onlyM || isM);
                r.style.display = show ? '' : 'none';
            });
        }

        // 2. FIXED CLIPBOARD LOGIC (PROPER FALLBACK)
        function doCopy() {
            let csv = "App,Baseline," + data.envs.join(",") + "\\n";
            data.finalRows.forEach(r => {
                let line = [r.appName];
                let b = r.envDetails.find(e => e.envLabel === data.baseline);
                line.push(b ? b.appVersion : "N/A");
                r.envDetails.forEach(e => line.push(e.appVersion));
                csv += line.join(",") + "\\n";
            });

            const el = document.createElement('textarea');
            el.value = csv;
            el.setAttribute('readonly', '');
            el.style.position = 'absolute';
            el.style.left = '-9999px';
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            
            showToast("Audit Report copied to clipboard");
        }

        function showToast(m) {
            const s = document.getElementById("snackbar");
            s.innerText = m;
            s.className = "show";
            setTimeout(() => { s.className = ""; }, 3000);
        }
    </script>
</body>
</html>
`;

processEnvironment(0);
