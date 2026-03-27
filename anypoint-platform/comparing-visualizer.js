const envPrefix = pm.collectionVariables.get("envPrefix");
const baselineEnvKey = pm.collectionVariables.get("baselineEnv");
const token = pm.collectionVariables.get("token");
const orgId = pm.collectionVariables.get("orgId");

const rows = {};
const allVars = pm.collectionVariables.toObject();
// Identify environments strictly using the envPrefix
const environments = Object.keys(allVars)
    .filter(key => key.startsWith(envPrefix))
    .map(key => ({ label: key, id: allVars[key] }));

function normalizeAppName(name) {
    const parts = name.split("-");
    return parts.length > 1 ? parts.slice(0, -1).join("-") : name;
}

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
    pm.sendRequest({
        url: `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments/${dep.id}`,
        method: 'GET',
        header: { 'Authorization': `Bearer ${token}`, 'X-ANYPNT-ORG-ID': orgId, 'X-ANYPNT-ENV-ID': env.id }
    }, (err, res) => {
        if (!err && res.code === 200) {
            const d = res.json(), norm = normalizeAppName(d.name);
            if (!rows[norm]) rows[norm] = {};
            rows[norm][env.label] = { appVersion: d.application?.ref?.version || "N/A", runtimeVersion: d.runtimeVersion || "N/A", status: d.status || "UNKNOWN" };
        }
        processDeps(env, list, dIdx + 1, next);
    });
}

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
    pm.visualizer.set(template, { finalRows, envs: environments.map(e => e.label), baseline: baselineEnvKey });
}

const template = `
<!DOCTYPE html>
<html>
<head>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <style>
        :root { --primary: #6750A4; --surface: #FEF7FF; --err-bg: #FFDAD6; --err-text: #B3261E; }
        body, html { height: 100%; width: 100vw; margin: 0; font-family: 'Roboto'; background: var(--surface); overflow: hidden; }
        .wrapper { display: flex; height: 100vh; width: 100vw; }
        .sidebar { width: 64px; background: #F3EDF7; border-right: 1px solid #CAC4D0; display: flex; flex-direction: column; align-items: center; padding-top: 20px; }
        .container { flex: 1; display: flex; flex-direction: column; width: calc(100vw - 64px); }
        .header { padding: 8px 16px; background: white; border-bottom: 1px solid #CAC4D0; display: flex; align-items: center; justify-content: space-between; height: 56px; }
        .table-area { flex: 1; overflow: auto; width: 100%; }
        table { width: 100%; border-collapse: collapse; }
        th { position: sticky; top: 0; background: #F7F2FA; padding: 12px; text-align: left; font-size: 12px; border-bottom: 2px solid #CAC4D0; z-index: 10; }
        td { padding: 12px; border-bottom: 1px solid #E7E0EC; }
        .mismatch-row { background-color: var(--err-bg) !important; }
        .v-mismatch { color: var(--err-text); font-weight: 900; text-decoration: underline; }
        .v-match { color: #2E7D32; font-weight: 700; }
        .v-baseline { color: #0061A4; font-weight: 700; }
        .col-idx { width: 45px; text-align: center; }
        #snackbar { visibility: hidden; position: fixed; bottom: 20px; left: 80px; background: #322F35; color: white; padding: 12px; border-radius: 4px; }
        #snackbar.show { visibility: visible; }
        textarea#fb { position: absolute; left: -9999px; }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="sidebar"><span class="material-icons" style="color:var(--primary)">fact_check</span></div>
        <div class="container">
            <header class="header">
                <input type="text" id="search" onkeyup="update()" placeholder="Search..." style="background:#ECE6F0; border:none; padding:8px 16px; border-radius:20px; width:250px;">
                <div style="display:flex; align-items:center; gap:10px; font-size:13px;">
                    <span>Show Mismatches Only</span>
                    <input type="checkbox" id="toggle" onchange="update()">
                </div>
                <button onclick="copyCSV()" style="background:var(--primary); color:white; border:none; padding:8px 16px; border-radius:12px; cursor:pointer;">COPY CSV</button>
            </header>
            <div class="table-area">
                <table id="auditTable">
                    <thead><tr><th class="col-idx">#</th><th>App Name</th>{{#each envs}}<th>{{this}}</th>{{/each}}</tr></thead>
                    <tbody id="tb">
                        {{#each finalRows}}
                        <tr class="app-row {{#if isMismatch}}mismatch-row{{/if}}" data-name="{{appName}}" data-mismatch="{{isMismatch}}">
                            <td class="col-idx row-idx"></td>
                            <td><strong>{{appName}}</strong></td>
                            {{#each envDetails}}
                            <td>
                                {{#if exists}}<div class="{{matchClass}}">v{{appVersion}}</div><div style="font-size:10px">RT: {{runtimeVersion}}</div>
                                {{else}}<span style="color:#999">---</span>{{/if}}
                            </td>
                            {{/each}}
                        </tr>
                        {{/each}}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
    <textarea id="fb"></textarea>
    <div id="snackbar">CSV Copied</div>
    <script>
        const d = pm.getData();
        function update() {
            const q = document.getElementById('search').value.toLowerCase();
            const onlyM = document.getElementById('toggle').checked;
            let count = 0;
            document.querySelectorAll('.app-row').forEach(row => {
                const nameMatch = row.getAttribute('data-name').toLowerCase().includes(q);
                const mismatchMatch = !onlyM || row.getAttribute('data-mismatch') === 'true';
                const visible = nameMatch && mismatchMatch;
                row.style.display = visible ? '' : 'none';
                if(visible) row.querySelector('.row-idx').textContent = ++count;
            });
        }
        function copyCSV() {
            let csv = "App,Baseline," + d.envs.join(",") + "\\n";
            d.finalRows.forEach(r => {
                let base = r.envDetails.find(e => e.label === d.baseline)?.appVersion || "N/A";
                csv += r.appName + "," + base + "," + r.envDetails.map(e => e.appVersion || "N/A").join(",") + "\\n";
            });
            const ta = document.getElementById('fb'); ta.value = csv; ta.select(); document.execCommand('copy');
            const s = document.getElementById('snackbar'); s.className = 'show'; setTimeout(() => s.className = '', 2000);
        }
        update();
    </script>
</body>
</html>
`;
startAudit(0);
