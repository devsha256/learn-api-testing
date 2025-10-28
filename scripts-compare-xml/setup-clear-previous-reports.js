const previousCount = parseInt(pm.collectionVariables.get("report_request_count") || "0");
console.log("Starting cleanup - previous count: " + previousCount);
let preserveVars = [];
const preserveVarsStr = pm.collectionVariables.get("variables");
if (preserveVarsStr) {
    try {
        preserveVars = JSON.parse(preserveVarsStr);
    } catch (e) {
        console.log("Variables not in JSON format. Using empty list.");
        preserveVars = [];
    }
}
const systemVars = [
    "mule_base_url", "boomi_base_url", "exempted_fields", "boomi_auth_type",
    "boomi_username", "boomi_password", "boomi_bearer_token", "boomi_api_key",
    "boomi_api_key_header", "variables"
];
const allPreservedVars = systemVars.concat(preserveVars);
console.log("Will preserve " + allPreservedVars.length + " variables");
let clearedReports = 0;
for (let i = 1; i <= previousCount; i++) {
    const varName = "report_data_" + i.toString().padStart(3, '0');
    pm.collectionVariables.unset(varName);
    clearedReports++;
}
const tempVars = [
    "report_request_count", "current_report_index", "temp_request_name",
    "temp_request_curl", "boomi_response", "boomi_status", "boomi_error",
    "csv_full_report", "csv_summary_report"
];
let clearedTemp = 0;
for (let i = 0; i < tempVars.length; i++) {
    const varName = tempVars[i];
    if (allPreservedVars.indexOf(varName) === -1) {
        pm.collectionVariables.unset(varName);
        clearedTemp++;
    }
}
pm.collectionVariables.set("report_request_count", "0");
console.log("Cleanup done: " + clearedReports + " reports, " + clearedTemp + " temp vars");

let varList = '';
for (let i = 0; i < allPreservedVars.length; i++) {
    varList += `<li>${allPreservedVars[i]}</li>`;
}

// --- Separated CSS and HTML Structure for robustness ---
const style = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:12px;padding:30px;text-align:center;background:#f5f5f5}
.box{background:#fff;padding:30px;border-radius:4px;max-width:500px;margin:0 auto;box-shadow:0 2px 4px rgba(0,0,0,0.1)}
h2{color:#27ae60;margin-bottom:15px;font-size:18px}
.stats{margin:20px 0;padding:15px;background:#ecf0f1;border-radius:4px}
p{color:#7f8c8d;font-size:12px;margin:8px 0}
.preserved{margin-top:20px;padding:15px;background:#ecf0f1;border-radius:4px;text-align:left}
.preserved h3{font-size:13px;color:#2c3e50;margin-bottom:10px}
.preserved ul{list-style:none;padding:0;font-size:11px;color:#7f8c8d;max-height:200px;overflow-y:auto}
.preserved li{padding:4px 8px;border-bottom:1px solid #bdc3c7}
.preserved li:last-child{border-bottom:none}
.signature{margin-top:20px;font-size:10px;color:#95a5a6;font-style:italic}
`;

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>${style}</style>
</head>
<body>
<div class="box">
<h2>Setup Complete</h2>
<div class="stats">
<p>Cleared ${clearedReports} report entries</p>
<p>Cleared ${clearedTemp} temporary variables</p>
</div>
<div class="preserved">
<h3>Preserved Variables (${allPreservedVars.length})</h3>
<ul>${varList}</ul>
</div>
<div class="signature">S. 2025</div>
</div>
</body>
</html>`;

pm.visualizer.set(html);