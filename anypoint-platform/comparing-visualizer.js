// 1. DATA & DISCOVERY
const token = pm.collectionVariables.get("token");
const orgId = pm.collectionVariables.get("orgId");
const baselineEnvKey = pm.collectionVariables.get("baselineEnv") || "dev";
const environments = Object.keys(pm.collectionVariables.toObject())
    .filter(k => k.startsWith("digital-"))
    .map(k => ({ label: k.replace("digital-", ""), id: pm.collectionVariables.get(k) }));

const rows = {};

// 2. CORE ENGINE: RECURSIVE SERIAL FETCH
function startAudit(index) {
    if (index >= environments.length) {
        render();
        return;
    }
    const env = environments[index];
    pm.sendRequest({
        url: `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments`,
        method: 'GET',
        header: { 'Authorization': `Bearer ${token}`, 'X-ANYPNT-ORG-ID': orgId, 'X-ANYPNT-ENV-ID': env.id }
    }, (err, res) => {
        if (!err && res.code === 200) {
            const items = res.json().items || [];
            fetchDetails(env, items, 0, () => startAudit(index + 1));
        } else { startAudit(index + 1); }
    });
}

function fetchDetails(env, list, dIdx, nextEnv) {
    if (dIdx >= list.length) { nextEnv(); return; }
    const dep = list[dIdx];
    pm.sendRequest({
        url: `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments/${dep.id}`,
        method: 'GET',
        header: { 'Authorization': `Bearer ${token}`, 'X-ANYPNT-ORG-ID': orgId, 'X-ANYPNT-ENV-ID': env.id }
    }, (err, res) => {
        if (!err && res.code === 200) {
            const d = res.json();
            const parts = d.name.split("-");
            const normName = parts.length > 1 ? parts.slice(0, -1).join("-") : d.name;

            if (!rows[normName]) rows[normName] = {};
            rows[normName][env.label] = { 
                v: d.application?.ref?.version || "0.0.0", 
                rt: d.runtimeVersion || "N/A" 
            };
        }
        setTimeout(() => fetchDetails(env, list, dIdx + 1, nextEnv), 150);
    });
}

// 3. THE LOGIC FIX: PRE-CALCULATE MISMATCHES
function render() {
    const finalData = Object.keys(rows).map(name => {
        const app = rows[name];
        const base = app[baselineEnvKey]?.v;
        let hasDiff = false;

        const envs = environments.map(e => {
            const curr = app[e.label];
            let css = "v-match";
            if (!curr) css = "v-missing";
            else if (e.label === baselineEnvKey) css = "v-baseline";
            else if (curr.v !== base) {
                css = "v-mismatch";
                hasDiff = true; // THIS TRACKS THE CORE FEATURE
            }
            return { label: e.label, val: curr?.v || "N/A", rt: curr?.rt || "", css };
        });
        return { name, envs, hasDiff };
    });

    pm.visualizer.set(template, { finalData, envList: environments.map(e => e.label), base: baselineEnvKey });
}

// 4. THE UI: ZERO-BREAK MATERIAL DESIGN
const template = `
<!DOCTYPE html>
<html>
<head>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Roboto', sans-serif; margin: 0; background: #FEF7FF; color: #1C1B1F; }
        .header { 
            position: sticky; top: 0; background: white; z-index: 10; 
            padding: 16px; border-bottom: 1px solid #CAC4D0;
            display: flex; align-items: center; gap: 20px;
        }
        .search { flex: 1; padding: 12px 20px; border-radius: 24px; border: 1px solid #79747E; outline: none; }
        
        /* THE TOGGLE FIX */
        .tgl-grp { display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 14px; }
        .tgl-box { width: 40px; height: 20px; background: #938F99; border-radius: 10px; position: relative; transition: .3s; }
        .tgl-box::after { content: ""; position: absolute; width: 14px; height: 14px; background: white; border-radius: 50%; top: 3px; left: 3px; transition: .3s; }
        #tglInput:checked + .tgl-box { background: #6750A4; }
        #tglInput:checked + .tgl-box::after { left: 23px; }

        .btn { background: #6750A4; color: white; border: none; padding: 10px 20px; border-radius: 20px; cursor: pointer; font-weight: 500; }
        
        table { width: 100%; border-collapse: collapse; background: white; }
        th { text-align: left; padding: 16px; background: #F3EDF7; border-bottom: 2px solid #CAC4D0; font-size: 12px; }
        td { padding: 16px; border-bottom: 1px solid #E7E0EC; }
        
        .mismatch-row { background: #FFF8F8; }
        .v-match { color: #2E7D32; font-weight: bold; }
        .v-mismatch { color: #B3261E; font-weight: bold; }
        .v-baseline { color: #0061A4; font-weight: bold; border-left: 4px solid #0061A4; padding-left: 8px; }
        .v-missing { color: #938F99; }
    </style>
</head>
<body>
    <div class="header">
        <input type="text" class="search" id="srch" placeholder="Filter applications..." onkeyup="ui()">
        <label class="tgl-grp">
            <input type="checkbox" id="tglInput" style="display:none" onchange="ui()">
            <div class="tgl-box"></div>
            <span>Mismatches Only</span>
        </label>
        <button class="btn" onclick="copy()">Copy Report</button>
    </div>

    <table>
        <thead>
            <tr>
                <th>App Name</th>
                {{#each envList}}<th>{{this}}</th>{{/each}}
            </tr>
        </thead>
        <tbody id="tbody">
            {{#each finalData}}
            <tr class="row {{#if hasDiff}}mismatch-row{{/if}}" data-n="{{name}}" data-m="{{hasDiff}}">
                <td><strong>{{name}}</strong></td>
                {{#each envs}}
                <td>
                    <div class="{{css}}">v{{val}}</div>
                    <div style="font-size:10px; color:#444">RT: {{rt}}</div>
                </td>
                {{/each}}
            </tr>
            {{/each}}
        </tbody>
    </table>

    <script>
        const d = pm.getData();
        function ui() {
            const q = document.getElementById('srch').value.toLowerCase();
            const mOnly = document.getElementById('tglInput').checked;
            document.querySelectorAll('.row').forEach(r => {
                const name = r.getAttribute('data-n').toLowerCase();
                const isM = r.getAttribute('data-m') === 'true';
                r.style.display = (name.includes(q) && (!mOnly || isM)) ? '' : 'none';
            });
        }
        function copy() {
            let c = "App,Baseline," + d.envList.join(",") + "\\n";
            d.finalData.forEach(r => {
                let l = [r.name];
                let b = r.envs.find(e => e.label === d.base);
                l.push(b ? b.val : "N/A");
                r.envs.forEach(e => l.push(e.val));
                c += l.join(",") + "\\n";
            });
            const el = document.createElement('textarea');
            el.value = c; document.body.appendChild(el); el.select();
            document.execCommand('copy'); document.body.removeChild(el);
            alert("Report Copied");
        }
    </script>
</body>
</html>
`;

startAudit(0);
