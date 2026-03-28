// --- 1. CONFIGURATION & DYNAMIC DISCOVERY ---
const token = pm.collectionVariables.get("token");
const orgId = pm.collectionVariables.get("orgId");
const envPrefix = pm.collectionVariables.get("envPrefix");
const baseline = pm.collectionVariables.get("baselineEnv");
const throttleMs = parseInt(pm.collectionVariables.get("throttleMs")) || 150;
const host = "http://localhost:3000"; 

// GLOBAL STATUS CONFIGURATION
const EXPECTED_STATUSES = ["RUNNING", "STARTED", "DEPLOYED"];
const UNEXPECTED_STATUSES = ["FAILED", "STOPPED", "UNDEPLOYED", "DELETING"];

const rows = {};
const allVars = pm.collectionVariables.toObject();
const environments = Object.keys(allVars)
    .filter(key => key.startsWith(envPrefix))
    .map(key => ({ label: key, id: allVars[key] }));

// --- 2. EXECUTION ENGINE ---
function startAudit(index) {
    if (index >= environments.length) { finalize(); return; }
    const env = environments[index];
    
    pm.sendRequest({
        url: `${host}/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments`,
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
            url: `${host}/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments/${dep.id}`,
            method: 'GET',
            header: { 'Authorization': `Bearer ${token}`, 'X-ANYPNT-ORG-ID': orgId, 'X-ANYPNT-ENV-ID': env.id }
        }, (err, res) => {
            if (!err && res.code === 200) {
                const d = res.json();
                const norm = d.name.split("-").slice(0, -1).join("-") || d.name;
                if (!rows[norm]) rows[norm] = {};
                rows[norm][env.label] = {
                    appVersion: d.application?.ref?.version || "N/A",
                    status: d.status || "UNKNOWN",
                    runtimeVersion: d.runtimeVersion || "N/A",
                    fullDetail: d 
                };
            }
            processDeps(env, list, dIdx + 1, nextEnv);
        });
    }, throttleMs);
}

// --- 3. VIEWMODEL & VISUALIZER SET ---
function finalize() {
    const envList = environments.map(e => e.label);
    const lastRun = new Date().toLocaleString();
    
    const finalRows = Object.keys(rows).map(appName => {
        const appData = rows[appName];
        const baseVer = appData[baseline]?.appVersion;
        let isMismatch = false;

        const envDetails = envList.map(label => {
            const cur = appData[label];
            let mClass = "v-match";
            if (!cur) mClass = "v-missing";
            else if (label === baseline) mClass = "v-baseline";
            else if (cur.appVersion !== baseVer) { mClass = "v-mismatch"; isMismatch = true; }
            return { envLabel: label, exists: !!cur, ...cur, matchClass: mClass };
        });
        return { appName, envDetails, isMismatch };
    });

    const viewModel = { 
        envs: envList, 
        baseline, 
        finalRows, 
        lastRun,
        expected: EXPECTED_STATUSES, 
        unexpected: UNEXPECTED_STATUSES 
    };
    
    const dataJson = JSON.stringify(viewModel).replace(/</g, "\\u003c");
    pm.visualizer.set(template, { dataJson, envs: envList, baseline: baseline });
}

// --- 4. THE TEMPLATE ---
const template = `
<!DOCTYPE html>
<html>
<head>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Material+Icons&display=swap" rel="stylesheet">
    <style>
        :root { 
            --p: #6750A4; --s: #FEF7FF; --o: #CAC4D0; --err-bg: #FFDAD6; --sur: #F3EDF7; 
            --sync: #2E7D32; --m3-success-bg: #C7EBCB; --m3-success-tx: #002107;
            --m3-error-bg: #F9DEDC; --m3-error-tx: #410002;
        }
        body, html { height: 100%; width: 100%; margin: 0; padding: 0; font-family: 'Roboto'; background: var(--s); overflow: hidden; }
        .wrapper { display: flex; height: 100vh; width: 100vw; }
        .sidebar { width: 64px; background: var(--sur); border-right: 1px solid var(--o); display: flex; flex-direction: column; align-items: center; padding-top: 20px; gap: 20px; }
        .nav-btn { width: 48px; height: 48px; border-radius: 14px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #49454F; transition: 0.2s; }
        .nav-btn.active { background: #EADDFF; color: #21005D; }
        
        .container { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .header { padding: 8px 16px; background: white; border-bottom: 1px solid var(--o); display: flex; align-items: center; justify-content: space-between; height: 56px; box-sizing: border-box; }
        .page { display: none; flex: 1; overflow: auto; width: 100%; }
        .page.active { display: flex; flex-direction: column; }

        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; padding: 24px; }
        .stat-card { background: white; border: 1px solid var(--o); border-radius: 16px; padding: 24px; }
        .drift-item { display: flex; align-items: center; gap: 12px; margin-top: 12px; font-size: 12px; }
        .drift-track { flex: 1; height: 8px; background: #E7E0EC; border-radius: 4px; overflow: hidden; }
        .drift-fill { height: 100%; transition: width 0.5s; }

        .table-area { width: 100%; flex: 1; overflow: auto; }
        table { width: 100%; border-collapse: collapse; min-width: 100%; }
        th { position: sticky; top: 0; background: #F7F2FA; padding: 12px 16px; text-align: left; font-size: 12px; border-bottom: 2px solid var(--o); z-index: 10; }
        td { padding: 8px 16px; border-bottom: 1px solid #E7E0EC; font-size: 13px; }
        .mismatch-row { background-color: var(--err-bg) !important; }
        
        td .cell-content { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
        .v-match, .v-baseline { font-weight: 700; cursor: pointer; }
        .v-match { color: var(--sync); }
        .v-baseline { color: #0061A4; }
        .v-mismatch { color: #B3261E; font-weight: 900; text-decoration: underline; cursor: pointer; }
        
        .status-chip { display: inline-flex; align-items: center; padding: 0 8px; height: 20px; border-radius: 6px; font-size: 10px; font-weight: 600; text-transform: uppercase; margin-top: 0 !important; }

        /* Multi-Toggle Header */
        .header-controls { display: flex; align-items: center; gap: 24px; }
        .toggle-wrap { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 500; cursor: pointer; color: #49454F; }
        .switch { position: relative; width: 34px; height: 18px; background: #79747E; border-radius: 10px; transition: 0.2s; }
        .switch::after { content: ''; position: absolute; width: 12px; height: 12px; background: white; border-radius: 50%; top: 3px; left: 3px; transition: 0.2s; }
        input:checked + .switch { background: var(--p); }
        input:checked + .switch::after { left: 19px; }

        #modal-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 2000; align-items: center; justify-content: center; }
        #modal-card { background: #FFF; width: 85%; max-width: 800px; max-height: 80%; border-radius: 28px; display: flex; flex-direction: column; box-shadow: 0 8px 12px rgba(0,0,0,0.2); }
        .modal-header { padding: 24px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--o); }
        .modal-body { padding: 24px; overflow: auto; flex: 1; }
        pre { background: #F4F4F4; padding: 16px; border-radius: 12px; font-size: 12px; border: 1px solid var(--o); }

        #snackbar { visibility: hidden; min-width: 200px; background: #322F35; color: white; padding: 12px 24px; position: fixed; bottom: 24px; left: 88px; border-radius: 4px; z-index: 1000; }
        #snackbar.show { visibility: visible; }
    </style>
</head>
<body>
    <script type="application/json" id="data-json">{{{dataJson}}}</script>
    <div class="wrapper">
        <nav class="sidebar">
            <div class="nav-btn active" onclick="showPage('audit', this)"><span class="material-icons">fact_check</span></div>
            <div class="nav-btn" onclick="showPage('stats', this)"><span class="material-icons">insights</span></div>
        </nav>
        <main class="container">
            <header class="header">
                <div class="header-controls">
                    <input type="text" id="search" onkeyup="updateUI()" placeholder="Search apps..." style="width:140px; padding:6px 12px; border-radius:20px; border:none; background:#ECE6F0; outline:none; font-size:13px;">
                    
                    <label class="toggle-wrap">
                        <input type="checkbox" id="mismatchToggle" onchange="updateUI()" style="display:none">
                        <div class="switch"></div>
                        <span>Mismatches</span>
                    </label>

                    <label class="toggle-wrap">
                        <input type="checkbox" id="runningToggle" onchange="updateUI()" style="display:none">
                        <div class="switch"></div>
                        <span>Running Only</span>
                    </label>

                    <div style="font-size:10px; color:#999; border-left: 1px solid #CCC; padding-left: 12px;">Refreshed: <span id="lastRunTime"></span></div>
                </div>
                <button class="btn" id="copyBtn" style="background:var(--p); color:white; border:none; padding:8px 16px; border-radius:12px; cursor:pointer; font-weight:500; font-size:12px;">COPY CSV</button>
            </header>
            
            <div id="page-audit" class="page active">
                <div class="table-area"><table><thead><tr><th style="text-align:center;width:40px">#</th><th>App Name</th>{{#each envs}}<th>{{this}}</th>{{/each}}</tr></thead><tbody id="tableBody"></tbody></table></div>
            </div>
            
            <div id="page-stats" class="page"><div class="stats-grid" id="stats-content"></div></div>
        </main>
    </div>

    <div id="modal-overlay" onclick="closeModal()">
        <div id="modal-card" onclick="event.stopPropagation()">
            <div class="modal-header">
                <h2 id="modal-title" style="margin:0; font-weight:400;">Details</h2>
                <span class="material-icons" onclick="closeModal()" style="cursor:pointer">close</span>
            </div>
            <div class="modal-body"><pre id="json-viewer"></pre></div>
        </div>
    </div>

    <div id="snackbar">CSV Copied</div>
    <textarea id="fallback" style="position:fixed;left:-9999px"></textarea>
    
    <script>
        const data = JSON.parse(document.getElementById("data-json").textContent);
        document.getElementById('lastRunTime').textContent = data.lastRun;
        
        function showPage(pId, el) {
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.getElementById('page-'+pId).classList.add('active');
            el.classList.add('active');
            if(pId==='stats') renderStats();
        }

        function showDetails(appName, envLabel) {
            const app = data.finalRows.find(r => r.appName === appName);
            const detail = app.envDetails.find(e => e.envLabel === envLabel)?.fullDetail;
            if(!detail) return;
            document.getElementById('modal-title').textContent = appName + " (" + envLabel + ")";
            document.getElementById('json-viewer').textContent = JSON.stringify(detail, null, 2);
            document.getElementById('modal-overlay').style.display = 'flex';
        }

        function closeModal() { document.getElementById('modal-overlay').style.display = 'none'; }

        function updateUI() {
            const q = document.getElementById('search').value.toLowerCase();
            const showOnlyMismatches = document.getElementById('mismatchToggle').checked;
            const showOnlyRunning = document.getElementById('runningToggle').checked;
            const tbody = document.getElementById('tableBody');
            tbody.innerHTML = '';
            let count = 0;

            data.finalRows.forEach(r => {
                const matchesSearch = r.appName.toLowerCase().includes(q);
                const matchesMismatch = !showOnlyMismatches || r.isMismatch;
                
                // Logic for "Running Only" filter
                const hasRunningEnv = r.envDetails.some(e => e.exists && data.expected.includes(e.status));
                const matchesRunning = !showOnlyRunning || hasRunningEnv;

                if(matchesSearch && matchesMismatch && matchesRunning) {
                    count++;
                    const row = document.createElement('tr');
                    if(r.isMismatch) row.className = 'mismatch-row';
                    let cells = '<td style="text-align:center; color:#888">' + count + '</td>';
                    cells += '<td><div style="font-weight:500; color:#1C1B1F">' + r.appName + '</div></td>';
                    r.envDetails.forEach(e => {
                        if(e.exists) {
                            const isGood = data.expected.includes(e.status);
                            const isBad = data.unexpected.includes(e.status);
                            const sBg = isGood ? 'var(--m3-success-bg)' : (isBad ? 'var(--m3-error-bg)' : '#E0E0E0');
                            const sTx = isGood ? 'var(--m3-success-tx)' : (isBad ? 'var(--m3-error-tx)' : '#444444');
                            cells += '<td><div class="cell-content">' + 
                                        '<span class="' + e.matchClass + '" onclick="showDetails(\\''+r.appName+'\\', \\''+e.envLabel+'\\')">v' + e.appVersion + '</span>' + 
                                        '<span class="status-chip" style="background:' + sBg + '; color:' + sTx + '">' + e.status + '</span>' + 
                                     '</div></td>';
                        } else { cells += '<td><span style="color:#999; font-style:italic">---</span></td>'; }
                    });
                    row.innerHTML = cells;
                    tbody.appendChild(row);
                }
            });
        }

        function renderStats() {
            let totalSlots = (data.envs.length - 1) * data.finalRows.length;
            let syncCount = 0;
            const runtimes = {};
            const statusMap = {};

            data.finalRows.forEach(r => {
                const bV = r.envDetails.find(e => e.envLabel === data.baseline)?.appVersion;
                r.envDetails.forEach(e => { 
                    if(e.envLabel !== data.baseline && e.appVersion === bV) syncCount++;
                    if(e.exists) {
                        runtimes[e.runtimeVersion] = (runtimes[e.runtimeVersion] || 0) + 1;
                        statusMap[e.status] = (statusMap[e.status] || 0) + 1;
                    }
                });
            });

            const score = Math.round((syncCount/totalSlots)*100) || 0;
            const rtHtml = Object.entries(runtimes).map(([v, c]) => \`<div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px"><span>\${v}</span><b>\${c}</b></div>\`).join('');
            const statusHtml = Object.entries(statusMap).map(([s, c]) => \`<div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px"><span>\${s}</span><b>\${c}</b></div>\`).join('');

            document.getElementById('stats-content').innerHTML = \`
                <div class="stat-card"><h3>Compliance Score</h3><div style="font-size:48px; font-weight:700; color:var(--p)">\${score}%</div><p style="font-size:12px; color:#666">Alignment relative to \${data.baseline}</p></div>
                <div class="stat-card"><h3>Version Drift</h3><div class="drift-item"><span>Synced</span><div class="drift-track"><div class="drift-fill" style="width:\${score}%; background:var(--sync)"></div></div></div><div class="drift-item"><span>Mismatched</span><div class="drift-track"><div class="drift-fill" style="width:\${100-score}%; background:#B3261E"></div></div></div></div>
                <div class="stat-card"><h3>Deployment Status</h3><div style="margin-top:12px">\${statusHtml || 'No data'}</div></div>
                <div class="stat-card"><h3>Runtime Inventory</h3><div style="margin-top:12px">\${rtHtml || 'No data'}</div></div>
            \`;
        }

        document.getElementById('copyBtn').addEventListener('click', () => {
            const csv = [["App",...data.envs].join(","),...data.finalRows.map(r=>[r.appName,...r.envDetails.map(e=>e.appVersion||"N/A")].join(","))].join("\\n");
            const ta = document.getElementById('fallback'); ta.value=csv; ta.select(); document.execCommand('copy');
            const s=document.getElementById('snackbar'); s.className='show'; setTimeout(()=>s.className='',2000);
        });

        updateUI();
    </script>
</body>
</html>
`;

startAudit(0);