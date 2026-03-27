// --- 1. CONFIGURATION & DYNAMIC DISCOVERY ---
const token = pm.collectionVariables.get("token");
const orgId = pm.collectionVariables.get("orgId");
const envPrefix = pm.collectionVariables.get("envPrefix");
const baseline = pm.collectionVariables.get("baselineEnv");
const throttleMs = parseInt(pm.collectionVariables.get("throttleMs")) || 150;

const rows = {};
const allVars = pm.collectionVariables.toObject();
const environments = Object.keys(allVars)
    .filter(key => key.startsWith(envPrefix + "-"))
    .map(key => ({ label: key, id: allVars[key] }));

// --- 2. EXECUTION ENGINE ---
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
                const norm = d.name.split("-").slice(0, -1).join("-") || d.name;
                if (!rows[norm]) rows[norm] = {};
                rows[norm][env.label] = {
                    appVersion: d.application?.ref?.version || "N/A",
                    runtimeVersion: d.runtimeVersion || "N/A"
                };
            }
            processDeps(env, list, dIdx + 1, nextEnv);
        });
    }, throttleMs);
}

// --- 3. VIEWMODEL & VISUALIZER SET ---
function finalize() {
    const finalRows = Object.keys(rows).map(appName => {
        const appData = rows[appName];
        const baseVer = appData[baseline]?.appVersion;
        let isMismatch = false;

        const envDetails = environments.map(env => {
            const cur = appData[env.label];
            let mClass = "v-match";
            if (!cur) mClass = "v-missing";
            else if (env.label === baseline) mClass = "v-baseline";
            else if (cur.appVersion !== baseVer) { mClass = "v-mismatch"; isMismatch = true; }
            return { envLabel: env.label, exists: !!cur, ...cur, matchClass: mClass };
        });
        return { appName, envDetails, isMismatch };
    });

    const viewModel = { envs: environments.map(e => e.label), baseline, finalRows };
    const dataJson = JSON.stringify(viewModel).replace(/</g, "\\u003c");
    pm.visualizer.set(template, { dataJson });
}

// --- 4. THE TEMPLATE ---
const template = `
<!DOCTYPE html>
<html>
<head>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <style>
        :root { --p: #6750A4; --s: #FEF7FF; --o: #CAC4D0; --err: #FFDAD6; }
        body, html { height: 100%; width: 100%; margin: 0; padding: 0; font-family: 'Roboto'; background: var(--s); overflow: hidden; }
        .wrapper { display: flex; height: 100vh; width: 100vw; }
        .sidebar { width: 64px; background: #F3EDF7; border-right: 1px solid var(--o); display: flex; flex-direction: column; align-items: center; padding-top: 20px; }
        .container { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .header { padding: 8px 16px; background: white; border-bottom: 1px solid var(--o); display: flex; align-items: center; justify-content: space-between; height: 56px; box-sizing: border-box; gap: 20px; }
        .table-area { flex: 1; overflow: auto; width: 100%; }
        table { width: 100%; border-collapse: collapse; }
        th { position: sticky; top: 0; background: #F7F2FA; padding: 12px 16px; text-align: left; font-size: 12px; border-bottom: 2px solid var(--o); z-index: 10; }
        td { padding: 12px 16px; border-bottom: 1px solid #E7E0EC; }
        .mismatch-row { background-color: var(--err) !important; }
        .v-mismatch { color: #B3261E; font-weight: 900; text-decoration: underline; }
        .v-match { color: #2E7D32; font-weight: 700; }
        .v-baseline { color: #0061A4; font-weight: 700; }
        .btn { background: var(--p); color: white; border: none; padding: 8px 16px; border-radius: 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; font-weight: 500; }
        .idx { width: 40px; text-align: center; color: #777; font-size: 11px; }
        #snackbar { visibility: hidden; min-width: 200px; background: #322F35; color: white; padding: 12px 24px; position: fixed; bottom: 24px; left: 88px; border-radius: 4px; z-index: 1000; }
        #snackbar.show { visibility: visible; }
        
        /* M3 Toggle Switch */
        .toggle-group { display: flex; align-items: center; gap: 12px; font-size: 13px; font-weight: 500; cursor: pointer; }
        .switch { position: relative; width: 44px; height: 24px; background: #79747E; border-radius: 12px; transition: 0.3s; }
        .switch::after { content: ''; position: absolute; width: 18px; height: 18px; background: white; border-radius: 50%; top: 3px; left: 3px; transition: 0.3s; }
        input:checked + .switch { background: var(--p); }
        input:checked + .switch::after { left: 23px; }
    </style>
</head>
<body>
    <script type="application/json" id="data-json">{{{dataJson}}}</script>
    <div class="wrapper">
        <div class="sidebar"><span class="material-icons" style="color:var(--p)">fact_check</span></div>
        <main class="container">
            <header class="header">
                <input type="text" id="search" onkeyup="updateUI()" placeholder="Search..." style="background:#ECE6F0; border:none; padding:8px 16px; border-radius:20px; width:200px;">
                
                <label class="toggle-group">
                    <span>Show Mismatches Only</span>
                    <input type="checkbox" id="mismatchToggle" onchange="updateUI()" style="display:none">
                    <div class="switch"></div>
                </label>

                <button class="btn" id="copyCsvBtn"><span class="material-icons">content_copy</span> COPY CSV</button>
            </header>
            <div class="table-area">
                <table id="auditTable">
                    <thead><tr><th class="idx">#</th><th>Application Name</th>{{#each envs}}<th>{{this}}</th>{{/each}}</tr></thead>
                    <tbody id="tableBody"></tbody>
                </table>
            </div>
        </main>
    </div>
    <div id="snackbar"></div>
    <textarea id="copyFallback" style="position:fixed;left:-9999px;top:-9999px;opacity:0"></textarea>

    <script>
        const data = JSON.parse(document.getElementById("data-json").textContent);
        
        function updateUI() {
            const q = document.getElementById('search').value.toLowerCase();
            const showOnlyMismatches = document.getElementById('mismatchToggle').checked;
            const tbody = document.getElementById('tableBody');
            tbody.innerHTML = '';
            let count = 0;

            data.finalRows.forEach(r => {
                const matchesSearch = r.appName.toLowerCase().includes(q);
                const matchesMismatch = !showOnlyMismatches || r.isMismatch;

                if (matchesSearch && matchesMismatch) {
                    count++;
                    const row = document.createElement('tr');
                    if (r.isMismatch) row.className = 'mismatch-row';
                    
                    let cells = '<td class="idx">' + count + '</td><td><strong>' + r.appName + '</strong></td>';
                    r.envDetails.forEach(e => {
                        cells += '<td>' + (e.exists ? 
                            '<div class="' + e.matchClass + '">v' + e.appVersion + '</div><div style="font-size:10px;color:#666">RT: ' + e.runtimeVersion + '</div>' 
                            : '<span style="color:#999">---</span>') + '</td>';
                    });
                    row.innerHTML = cells;
                    tbody.appendChild(row);
                }
            });
        }

        async function copyText(text) {
            try {
                if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
            } catch(e) {}
            try {
                const ta = document.getElementById("copyFallback");
                ta.value = text; ta.focus(); ta.select();
                const ok = document.execCommand("copy");
                ta.blur(); return !!ok;
            } catch(e) { return false; }
        }

        document.getElementById('copyCsvBtn').addEventListener('click', async () => {
            const csv = [
                ["Application", "Baseline", ...data.envs].map(v => '"' + (v||"").replace(/"/g, '""') + '"').join(","),
                ...data.finalRows.map(r => {
                    const base = r.envDetails.find(e => e.envLabel === data.baseline)?.appVersion || "N/A";
                    return [r.appName, base, ...r.envDetails.map(e => e.appVersion || "N/A")].map(v => '"' + (v||"").replace(/"/g, '""') + '"').join(",");
                })
            ].join("\\n");
            
            const ok = await copyText(csv);
            const s = document.getElementById('snackbar');
            s.textContent = ok ? "CSV copied to clipboard" : "Copy failed";
            s.className = "show";
            setTimeout(() => s.className = "", 2000);
        });

        updateUI();
    </script>
</body>
</html>
`;

startAudit(0);
