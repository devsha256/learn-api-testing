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

function normalizeAppName(name) {
    const parts = name.split("-");
    return parts.length > 1 ? parts.slice(0, -1).join("-") : name;
}

// 2. EXECUTION ENGINE
function processEnvironment(index) {
    if (index >= environments.length) { finalize(); return; }
    const env = environments[index];
    pm.sendRequest({
        url: `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments`,
        method: 'GET',
        header: { 'Authorization': `Bearer ${token}`, 'X-ANYPNT-ORG-ID': orgId, 'X-ANYPNT-ENV-ID': env.id }
    }, (err, res) => {
        if (!err && res.code === 200) {
            processDeployments(env, res.json().items || [], 0, () => processEnvironment(index + 1));
        } else { processEnvironment(index + 1); }
    });
}

function processDeployments(env, list, depIndex, onComplete) {
    if (depIndex >= list.length) { onComplete(); return; }
    const dep = list[depIndex];
    setTimeout(() => {
        pm.sendRequest({
            url: `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments/${dep.id}`,
            method: 'GET',
            header: { 'Authorization': `Bearer ${token}`, 'X-ANYPNT-ORG-ID': orgId, 'X-ANYPNT-ENV-ID': env.id }
        }, (err, res) => {
            if (!err && res.code === 200) {
                const d = res.json();
                const normName = normalizeAppName(d.name);
                if (!rows[normName]) rows[normName] = {};
                rows[normName][env.label] = { v: d.application?.ref?.version || "N/A", rt: d.runtimeVersion || "N/A", status: d.status };
            }
            processDeployments(env, list, depIndex + 1, onComplete);
        });
    }, throttleMs);
}

// 3. FINALIZER (MISMATCH LOGIC)
function finalize() {
    const finalRows = Object.keys(rows).map(appName => {
        const appData = rows[appName];
        const baseVer = appData[baselineEnvKey]?.v;
        let rowMismatch = false;

        const envDetails = environments.map(env => {
            const cur = appData[env.label];
            let mClass = "v-match";
            if (!cur) mClass = "v-missing";
            else if (env.label === baselineEnvKey) mClass = "v-baseline";
            else if (cur.v !== baseVer) { 
                mClass = "v-mismatch"; 
                rowMismatch = true; // Flag row if it deviates from baseline
            }
            return { envLabel: env.label, exists: !!cur, v: cur?.v || "N/A", rt: cur?.rt || "N/A", mClass };
        });
        return { appName, envDetails, rowMismatch };
    });

    pm.visualizer.set(template, { 
        finalRows, 
        envs: environments.map(e => e.label), 
        baseline: baselineEnvKey 
    });
}

// 4. TEMPLATE (MATERIAL 3 / SIDEBAR / TABS)
const template = `
<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
<style>
    :root { --p: #6750A4; --s: #FEF7FF; --c: #F3EDF7; --err: #B3261E; --ok: #2E7D32; --base: #0061A4; }
    body, html { margin: 0; padding: 0; height: 100%; font-family: 'Roboto', sans-serif; background: var(--s); overflow: hidden; }
    .main { display: flex; height: 100vh; width: 100vw; }
    .side { width: 64px; background: var(--c); border-right: 1px solid #CAC4D0; display: flex; flex-direction: column; align-items: center; padding-top: 20px; gap: 16px; }
    .nav { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #49454F; }
    .nav.active { background: #EADDFF; color: #21005D; }
    .content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .header { padding: 12px 20px; display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #CAC4D0; background: #fff; }
    .search { flex: 1; height: 40px; border-radius: 20px; border: 1px solid #79747E; padding: 0 16px; outline: none; }
    .toggle-wrap { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; font-weight: 500; }
    .switch { position: relative; width: 36px; height: 20px; background: #938F99; border-radius: 10px; transition: .2s; }
    .switch::after { content: ""; position: absolute; width: 14px; height: 14px; background: #fff; border-radius: 50%; top: 3px; left: 3px; transition: .2s; }
    #tog:checked + .switch { background: var(--p); }
    #tog:checked + .switch::after { left: 19px; }
    .btn { background: var(--p); color: #fff; border: none; padding: 10px 16px; border-radius: 20px; font-weight: 500; cursor: pointer; }
    .table-box { flex: 1; overflow: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 900px; }
    th { position: sticky; top: 0; background: #F7F2FA; padding: 14px; text-align: left; font-size: 12px; border-bottom: 2px solid #CAC4D0; z-index: 2; }
    td { padding: 14px; border-bottom: 1px solid #E7E0EC; }
    .mismatch-row { background: #FFF8F8; }
    .v-match { color: var(--ok); font-weight: 700; }
    .v-mismatch { color: var(--err); font-weight: 700; }
    .v-baseline { color: var(--base); font-weight: 700; border-left: 3px solid var(--base); padding-left: 8px; }
    .tab-pane { display: none; height: 100%; } .active-pane { display: block; }
    #toast { visibility: hidden; position: fixed; bottom: 20px; left: 80px; background: #322F35; color: #fff; padding: 12px 20px; border-radius: 4px; }
    #toast.show { visibility: visible; }
</style>
</head><body>
    <div class="main">
        <div class="side">
            <div class="nav active" onclick="tab('audit',this)"><span class="material-icons">fact_check</span></div>
            <div class="nav" onclick="tab('stats',this)"><span class="material-icons">bar_chart</span></div>
        </div>
        <div class="content">
            <header class="header">
                <input type="text" id="srch" class="search" placeholder="Search apps..." onkeyup="filter()">
                <label class="toggle-wrap">
                    <span>Mismatches Only</span>
                    <input type="checkbox" id="tog" style="display:none" onchange="filter()">
                    <div class="switch"></div>
                </label>
                <button class="btn" onclick="copy()">Copy Report</button>
            </header>
            <div id="audit" class="tab-pane active-pane">
                <div class="table-box">
                    <table><thead><tr><th>App Name</th>{{#each envs}}<th>{{this}}</th>{{/each}}</tr></thead>
                    <tbody id="rows">
                        {{#each finalRows}}
                        <tr class="app-row {{#if rowMismatch}}mismatch-row{{/if}}" data-n="{{appName}}" data-m="{{rowMismatch}}">
                            <td><strong>{{appName}}</strong></td>
                            {{#each envDetails}}
                            <td><div class="{{mClass}}">v{{v}}</div><div style="font-size:10px;color:#444">RT: {{rt}}</div></td>
                            {{/each}}
                        </tr>{{/each}}
                    </tbody></table>
                </div>
            </div>
            <div id="stats" class="tab-pane"><div style="padding:40px"><h3>Stats Overview</h3><p id="statsText"></p></div></div>
        </div>
    </div>
    <div id="toast">Report Copied</div>
    <script>
        const d = pm.getData();
        function tab(id,el) {
            document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active-pane'));
            document.querySelectorAll('.nav').forEach(n=>n.classList.remove('active'));
            document.getElementById(id).classList.add('active-pane');
            el.classList.add('active');
            if(id==='stats') {
                const total = d.finalRows.length;
                const bad = d.finalRows.filter(r=>r.rowMismatch).length;
                document.getElementById('statsText').innerText = bad + " out of " + total + " apps have version mismatches.";
            }
        }
        function filter() {
            const q = document.getElementById('srch').value.toLowerCase();
            const m = document.getElementById('tog').checked;
            document.querySelectorAll('.app-row').forEach(r => {
                const name = r.getAttribute('data-n').toLowerCase();
                const isM = r.getAttribute('data-m') === 'true';
                r.style.display = (name.includes(q) && (!m || isM)) ? '' : 'none';
            });
        }
        function copy() {
            let csv = "App,Baseline," + d.envs.join(",") + "\\n";
            d.finalRows.forEach(r => {
                let row = [r.appName];
                let b = r.envDetails.find(e => e.envLabel === d.baseline);
                row.push(b ? b.v : "N/A");
                r.envDetails.forEach(e => row.push(e.v));
                csv += row.join(",") + "\\n";
            });
            const el = document.createElement('textarea');
            el.value = csv; document.body.appendChild(el); el.select();
            document.execCommand('copy'); document.body.removeChild(el);
            const t = document.getElementById('toast'); t.className='show'; setTimeout(()=>t.className='', 3000);
        }
    </script>
</body></html>`;

processEnvironment(0);
