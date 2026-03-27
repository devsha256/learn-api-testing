// 1. DATA DISCOVERY
const token = pm.collectionVariables.get("token");
const orgId = pm.collectionVariables.get("orgId");
const baselineEnvKey = pm.collectionVariables.get("baselineEnv") || "dev";
const allVars = pm.collectionVariables.toObject();

const environments = Object.keys(allVars)
    .filter(k => k.startsWith("digital-"))
    .map(k => ({ label: k.replace("digital-", ""), id: allVars[k] }));

const rows = {};

// 2. CORE EXECUTION (Recursive to ensure Postman waits)
function startAudit(index) {
    if (index >= environments.length) {
        render();
        return;
    }
    const env = environments[index];
    console.log("Auditing: " + env.label);

    pm.sendRequest({
        url: `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments`,
        method: 'GET',
        header: { 'Authorization': `Bearer ${token}`, 'X-ANYPNT-ORG-ID': orgId, 'X-ANYPNT-ENV-ID': env.id }
    }, (err, res) => {
        if (!err && res.code === 200) {
            const items = res.json().items || [];
            fetchDetails(env, items, 0, () => startAudit(index + 1));
        } else {
            console.error("Failed to list: " + env.label);
            startAudit(index + 1);
        }
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
            const normName = d.name.split("-").slice(0, -1).join("-") || d.name;

            if (!rows[normName]) rows[normName] = {};
            rows[normName][env.label] = { 
                v: d.application?.ref?.version || "0.0.0", 
                rt: d.runtimeVersion || "N/A" 
            };
        }
        // Throttling to prevent Anypoint 429 errors
        setTimeout(() => fetchDetails(env, list, dIdx + 1, nextEnv), 100);
    });
}

// 3. LOGIC FIX: CALCULATE MISMATCHES BEFORE RENDERING
function render() {
    const finalData = Object.keys(rows).map(name => {
        const app = rows[name];
        const baseVer = app[baselineEnvKey]?.v;
        let isMismatch = false;

        const envs = environments.map(e => {
            const curr = app[e.label];
            let status = "match";
            
            if (!curr) status = "missing";
            else if (e.label === baselineEnvKey) status = "baseline";
            else if (curr.v !== baseVer) {
                status = "mismatch";
                isMismatch = true; // TRACKS CORE MISMATCH FEATURE
            }
            
            return { label: e.label, val: curr?.v || "N/A", rt: curr?.rt || "N/A", status };
        });

        return { name, envs, isMismatch };
    });

    pm.visualizer.set(template, { 
        finalData, 
        envList: environments.map(e => e.label),
        base: baselineEnvKey 
    });
    console.log("Audit Finished. Open Visualizer.");
}

// 4. HTML TEMPLATE (Full Width, Working Toggle)
const template = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica; margin: 0; padding: 0; background: #fff; width: 100%; }
        .toolbar { 
            position: sticky; top: 0; background: #f8f9fa; padding: 15px; 
            border-bottom: 1px solid #dee2e6; display: flex; align-items: center; gap: 20px; z-index: 100;
        }
        input[type="text"] { flex: 1; padding: 10px; border: 1px solid #ced4da; border-radius: 4px; }
        .toggle-btn { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 14px; user-select: none; }
        
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th { background: #e9ecef; text-align: left; padding: 12px; font-size: 13px; border-bottom: 2px solid #dee2e6; }
        td { padding: 12px; border-bottom: 1px solid #dee2e6; word-wrap: break-word; vertical-align: top; }
        
        tr.mismatch-highlight { background-color: #fff5f5; }
        .v-baseline { color: #007bff; font-weight: bold; }
        .v-match { color: #28a745; font-weight: bold; }
        .v-mismatch { color: #dc3545; font-weight: bold; }
        .v-missing { color: #6c757d; font-style: italic; }
        .rt-info { font-size: 10px; color: #6c757d; margin-top: 4px; }
        
        button { background: #007bff; color: white; border: none; padding: 10px 15px; border-radius: 4px; cursor: pointer; }
        button:hover { background: #0056b3; }
    </style>
</head>
<body>
    <div class="toolbar">
        <input type="text" id="search" placeholder="Search apps..." onkeyup="filter()">
        <label class="toggle-btn">
            <input type="checkbox" id="mismatchToggle" onchange="filter()"> 
            <strong>Show Mismatches Only</strong>
        </label>
        <button onclick="copyCSV()">Copy Report</button>
    </div>

    <table>
        <thead>
            <tr>
                <th style="width: 25%;">App Name</th>
                {{#each envList}}<th>{{this}}</th>{{/each}}
            </tr>
        </thead>
        <tbody id="tableBody">
            {{#each finalData}}
            <tr class="app-row {{#if isMismatch}}mismatch-highlight{{/if}}" 
                data-name="{{name}}" 
                data-is-mismatch="{{isMismatch}}">
                <td><strong>{{name}}</strong></td>
                {{#each envs}}
                <td>
                    <div class="v-{{status}}">v{{val}}</div>
                    <div class="rt-info">RT: {{rt}}</div>
                </td>
                {{/each}}
            </tr>
            {{/each}}
        </tbody>
    </table>

    <script>
        const auditData = pm.getData();

        function filter() {
            const query = document.getElementById('search').value.toLowerCase();
            const showOnlyMismatches = document.getElementById('mismatchToggle').checked;
            const rows = document.querySelectorAll('.app-row');

            rows.forEach(row => {
                const name = row.getAttribute('data-name').toLowerCase();
                const isMismatch = row.getAttribute('data-is-mismatch') === 'true';
                
                const matchesSearch = name.includes(query);
                const matchesToggle = !showOnlyMismatches || isMismatch;

                row.style.display = (matchesSearch && matchesToggle) ? '' : 'none';
            });
        }

        function copyCSV() {
            let csv = "App,Baseline," + auditData.envList.join(",") + "\\n";
            auditData.finalData.forEach(r => {
                let row = [r.name];
                let b = r.envs.find(e => e.label === auditData.base);
                row.push(b ? b.val : "N/A");
                r.envs.forEach(e => row.push(e.val));
                csv += row.join(",") + "\\n";
            });

            const el = document.createElement('textarea');
            el.value = csv;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            alert("Report Copied to Clipboard");
        }
    </script>
</body>
</html>
`;

startAudit(0);
