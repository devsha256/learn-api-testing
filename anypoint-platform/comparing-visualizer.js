// ==============================
// CONFIG
// ==============================
const orgId = pm.environment.get("orgId");
const baselineEnv = pm.variables.get("baselineEnv") || "dev";
const throttleMs = 120;

// ==============================
// DISCOVER ENVIRONMENTS
// ==============================
const allVars = pm.collectionVariables.toObject();
const envs = Object.keys(allVars)
    .filter(k => k.startsWith("digital-"))
    .map(k => ({
        name: k.replace("digital-", ""),
        id: allVars[k]
    }));

// Ensure baseline exists
if (!envs.find(e => e.name === baselineEnv)) {
    throw new Error("Baseline environment not found: " + baselineEnv);
}

// ==============================
// STORAGE
// ==============================
let appMatrix = {}; // { appName: { env: version } }

// ==============================
// HELPERS
// ==============================
function normalizeAppName(name) {
    return name.replace(/-(dev|qa|uat|prod)$/i, "");
}

function delay(fn, ms) {
    setTimeout(fn, ms);
}

// ==============================
// STEP 1: PROCESS ENVIRONMENTS RECURSIVELY
// ==============================
function processEnv(index) {
    if (index >= envs.length) {
        finalize();
        return;
    }

    const env = envs[index];

    const listUrl = `/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments`;

    pm.sendRequest({
        url: listUrl,
        method: "GET",
        header: {
            Authorization: pm.request.headers.get("Authorization")
        }
    }, function (err, res) {

        if (err || res.code !== 200) {
            console.log("Failed env:", env.name);
            processEnv(index + 1);
            return;
        }

        const deployments = res.json().data || [];

        processDeployment(env, deployments, 0, function () {
            processEnv(index + 1);
        });
    });
}

// ==============================
// STEP 2: PROCESS DEPLOYMENTS SERIAL
// ==============================
function processDeployment(env, deployments, i, done) {
    if (i >= deployments.length) {
        done();
        return;
    }

    const dep = deployments[i];

    const detailUrl = `/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments/${dep.id}`;

    delay(function () {

        pm.sendRequest({
            url: detailUrl,
            method: "GET",
            header: {
                Authorization: pm.request.headers.get("Authorization")
            }
        }, function (err, res) {

            if (!err && res.code === 200) {
                const data = res.json();

                const rawName = data.application?.name || dep.name;
                const appName = normalizeAppName(rawName);
                const version = data.application?.ref?.version || "N/A";

                if (!appMatrix[appName]) {
                    appMatrix[appName] = {};
                }

                appMatrix[appName][env.name] = version;
            }

            processDeployment(env, deployments, i + 1, done);

        });

    }, throttleMs);
}

// ==============================
// FINALIZE & BUILD AUDIT DATA
// ==============================
function finalize() {

    const rows = Object.keys(appMatrix).map(app => {
        const envData = appMatrix[app];

        const baselineVersion = envData[baselineEnv] || "NOT DEPLOYED";

        let hasMismatch = false;

        envs.forEach(e => {
            const v = envData[e.name] || "NOT DEPLOYED";
            if (v !== baselineVersion) {
                hasMismatch = true;
            }
        });

        return {
            app,
            baselineVersion,
            hasMismatch,
            versions: envData
        };
    });

    renderVisualizer(rows);
}

// ==============================
// VISUALIZER
// ==============================
function renderVisualizer(rows) {

    const template = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>

body {
    margin:0;
    font-family: Roboto, Arial;
    background:#f5f5f5;
    display:flex;
}

/* SIDEBAR */
.sidebar {
    width:200px;
    background:#1f1f1f;
    color:white;
    padding:10px;
}

.sidebar h3 {
    font-size:14px;
    margin-bottom:10px;
}

.tab {
    padding:10px;
    cursor:pointer;
    border-radius:6px;
}

.tab.active {
    background:#333;
}

/* MAIN */
.main {
    flex:1;
    padding:0;
}

/* HEADER */
.controls {
    display:flex;
    gap:10px;
    padding:10px;
    background:white;
    position:sticky;
    top:0;
    z-index:2;
    border-bottom:1px solid #ddd;
}

input {
    padding:6px;
    flex:1;
}

/* TABLE */
table {
    width:100%;
    border-collapse:collapse;
}

thead {
    position:sticky;
    top:50px;
    background:white;
    z-index:1;
}

th, td {
    padding:8px;
    border-bottom:1px solid #eee;
    text-align:left;
}

tr.mismatch {
    background:#ffeaea;
}

td.mismatch {
    color:#d32f2f;
    font-weight:bold;
}

td.baseline {
    background:#e3f2fd;
}

/* SWITCH */
.switch {
    display:flex;
    align-items:center;
    gap:6px;
}

button {
    padding:6px 10px;
    cursor:pointer;
}

</style>
</head>

<body>

<div class="sidebar">
    <h3>Navigation</h3>
    <div class="tab active">Audit View</div>
    <div class="tab">Stats</div>
</div>

<div class="main">

<div class="controls">
    <input id="search" placeholder="Search App..." />
    <label class="switch">
        <input type="checkbox" id="toggleMismatch" />
        Only Mismatch
    </label>
    <button onclick="copyCSV()">Copy CSV</button>
</div>

<table id="table">
<thead>
<tr>
    <th>Application</th>
    ${envs.map(e => `<th>${e.name}</th>`).join("")}
</tr>
</thead>
<tbody></tbody>
</table>

</div>

<script>

const rows = {{rows}};
const envs = {{envs}};
const baselineEnv = "{{baselineEnv}}";

function render() {
    const search = document.getElementById("search").value.toLowerCase();
    const onlyMismatch = document.getElementById("toggleMismatch").checked;

    const tbody = document.querySelector("#table tbody");
    tbody.innerHTML = "";

    rows.forEach(r => {

        if (search && !r.app.toLowerCase().includes(search)) return;
        if (onlyMismatch && !r.hasMismatch) return;

        const tr = document.createElement("tr");
        if (r.hasMismatch) tr.classList.add("mismatch");

        let html = "<td>" + r.app + "</td>";

        envs.forEach(e => {
            const v = r.versions[e.name] || "NOT DEPLOYED";

            let cls = "";
            if (e.name === baselineEnv) cls += "baseline ";
            if (v !== r.baselineVersion) cls += "mismatch";

            html += "<td class='" + cls + "'>" + v + "</td>";
        });

        tr.innerHTML = html;
        tbody.appendChild(tr);
    });
}

document.getElementById("search").addEventListener("input", render);
document.getElementById("toggleMismatch").addEventListener("change", render);

function copyCSV() {
    let csv = "App," + envs.map(e => e.name).join(",") + "\\n";

    rows.forEach(r => {
        const row = [r.app];
        envs.forEach(e => {
            row.push(r.versions[e.name] || "NOT DEPLOYED");
        });
        csv += row.join(",") + "\\n";
    });

    const ta = document.createElement("textarea");
    ta.value = csv;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);

    alert("Copied!");
}

render();

</script>

</body>
</html>
`;

    pm.visualizer.set(template, {
        rows,
        envs,
        baselineEnv
    });
}

// ==============================
// START
// ==============================
processEnv(0);
