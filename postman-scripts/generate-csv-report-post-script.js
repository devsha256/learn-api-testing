const totalCount = parseInt(pm.collectionVariables.get("report_request_count") || "0");
const reportData = [];

for (let i = 1; i <= totalCount; i++) {
    const paddedIndex = i.toString().padStart(3, '0');
    const dataStr = pm.collectionVariables.get("report_data_" + paddedIndex);
    if (dataStr) {
        try {
            reportData.push(JSON.parse(dataStr));
        } catch (e) {
            console.error("Failed to parse report entry " + i);
        }
    }
}

console.log("Report generated: " + reportData.length + " requests");

let fullCsvContent = 'Serial,Request,cURL,Boomi Response,MuleSoft Response,Total,Matched,Mismatched,Exempted,Match %,Status,Boomi Status,MuleSoft Status,Timestamp\n';

for (let i = 0; i < reportData.length; i++) {
    const row = reportData[i];
    const stats = row.statistics;
    
    function escapeCSV(str) {
        if (!str) return '""';
        str = String(str).substring(0, 1000);
        return '"' + str.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, ' ') + '"';
    }
    
    fullCsvContent += row.serialNumber + ',' + escapeCSV(row.requestName) + ',' + escapeCSV(row.curlCommand) + ',' + escapeCSV(row.boomiResponse) + ',' + escapeCSV(row.mulesoftResponse) + ',' + stats.totalLines + ',' + stats.matchedLines + ',' + stats.mismatchedLines + ',' + stats.exemptedLines + ',' + stats.matchPercentage + ',' + stats.status + ',' + stats.boomiStatus + ',' + stats.mulesoftStatus + ',' + stats.timestamp + '\n';
}

let summaryCsvContent = 'Serial,Request,Total,Matched,Mismatched,Exempted,Match %,Status,Timestamp\n';

for (let i = 0; i < reportData.length; i++) {
    const row = reportData[i];
    const stats = row.statistics;
    summaryCsvContent += row.serialNumber + ',"' + row.requestName.replace(/"/g, '""') + '",' + stats.totalLines + ',' + stats.matchedLines + ',' + stats.mismatchedLines + ',' + stats.exemptedLines + ',' + stats.matchPercentage + ',' + stats.status + ',' + stats.timestamp + '\n';
}

let totalRequests = reportData.length;
let passedRequests = 0;
let failedRequests = 0;
let totalMatchPercentage = 0;

for (let i = 0; i < reportData.length; i++) {
    const stats = reportData[i].statistics;
    if (stats.status === 'PASSED') {
        passedRequests++;
    } else {
        failedRequests++;
    }
    totalMatchPercentage += parseFloat(stats.matchPercentage);
}

const avgMatchPercentage = totalRequests > 0 ? Math.round(totalMatchPercentage / totalRequests) : 0;

let tableRows = '';
for (let i = 0; i < reportData.length; i++) {
    const row = reportData[i];
    const stats = row.statistics;
    const statusClass = stats.status === 'PASSED' ? 'pass' : 'fail';
    tableRows += '<tr><td>' + row.serialNumber + '</td><td><strong>' + row.requestName + '</strong></td><td>' + stats.totalLines + '</td><td>' + stats.matchedLines + '</td><td>' + stats.mismatchedLines + '</td><td>' + stats.exemptedLines + '</td><td>' + stats.matchPercentage + '%</td><td class="' + statusClass + '"><div class="status-badge">' + stats.status + '</div></td></tr>';
}

const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:12px;padding:15px;background:#f5f5f5}.header{background:linear-gradient(135deg,#2c3e50,#34495e);color:#fff;padding:20px;border-radius:4px;margin-bottom:15px}.header h1{font-size:18px;margin-bottom:8px}.header-subtitle{font-size:11px;opacity:0.9}.summary-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:15px}.card{background:#fff;padding:15px;border-radius:4px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.1)}.card-value{font-size:24px;font-weight:bold;margin-bottom:5px}.card.pass .card-value{color:#27ae60}.card.fail .card-value{color:#c0392b}.card.avg .card-value{color:#3498db}.card-label{font-size:10px;color:#7f8c8d}.export-section{background:#fff;padding:15px;border-radius:4px;margin-bottom:15px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}.export-title{font-weight:bold;font-size:11px;margin-bottom:10px;color:#333}.export-buttons{display:flex;gap:10px}.export-btn{background:#3498db;color:#fff;border:none;padding:8px 16px;border-radius:3px;cursor:pointer;font-size:11px;font-weight:500}.export-btn:hover{background:#2980b9}.export-btn.secondary{background:#95a5a6}.export-btn.secondary:hover{background:#7f8c8d}.export-msg{display:none;margin-top:8px;padding:8px;background:#d4edda;color:#155724;border-radius:3px;font-size:11px}.table-container{background:#fff;border-radius:4px;overflow:auto;max-height:60vh;box-shadow:0 1px 3px rgba(0,0,0,0.1)}table{width:100%;border-collapse:collapse;font-size:11px}thead{position:sticky;top:0;background:#34495e;color:#fff;z-index:10}th{padding:10px 8px;text-align:left;font-weight:600;font-size:10px;border-right:1px solid #2c3e50}th:first-child{width:40px;text-align:center}td{padding:10px 8px;border-bottom:1px solid #ecf0f1;border-right:1px solid #ecf0f1;font-size:11px}td:first-child{text-align:center;font-weight:bold;background:#f8f9fa}tr:hover{background:#f8f9fa}.status-badge{display:inline-block;padding:4px 8px;border-radius:3px;font-weight:bold;font-size:10px}td.pass .status-badge{background:#d4edda;color:#155724}td.fail .status-badge{background:#f8d7da;color:#721c24}.signature{text-align:right;margin-top:10px;font-size:9px;color:#95a5a6;font-style:italic}</style></head><body><div class="header"><h1>Migration Test Report</h1><div class="header-subtitle">Generated ' + new Date().toLocaleString() + '</div></div><div class="summary-cards"><div class="card"><div class="card-value">' + totalRequests + '</div><div class="card-label">Total</div></div><div class="card pass"><div class="card-value">' + passedRequests + '</div><div class="card-label">Passed</div></div><div class="card fail"><div class="card-value">' + failedRequests + '</div><div class="card-label">Failed</div></div><div class="card avg"><div class="card-value">' + avgMatchPercentage + '%</div><div class="card-label">Avg Match</div></div></div><div class="export-section"><div class="export-title">Export CSV Reports</div><div class="export-buttons"><button class="export-btn" onclick="copyFull()">Copy Full CSV</button><button class="export-btn secondary" onclick="copySummary()">Copy Summary CSV</button></div><div id="msg" class="export-msg">CSV copied to clipboard</div></div><div class="table-container"><table><thead><tr><th>No</th><th>Request</th><th>Total</th><th>Matched</th><th>Mismatched</th><th>Exempted</th><th>Match %</th><th>Status</th></tr></thead><tbody>' + tableRows + '</tbody></table></div><div class="signature">S. 2025</div><textarea id="fullCsv" style="position:absolute;left:-9999px">' + fullCsvContent.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</textarea><textarea id="summaryCsv" style="position:absolute;left:-9999px">' + summaryCsvContent.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</textarea><script>function copyFull(){var t=document.getElementById("fullCsv");t.select();document.execCommand("copy");showMsg()}function copySummary(){var t=document.getElementById("summaryCsv");t.select();document.execCommand("copy");showMsg()}function showMsg(){var e=document.getElementById("msg");e.style.display="block";setTimeout(function(){e.style.display="none"},2000)}</script></body></html>';

pm.visualizer.set(html);
