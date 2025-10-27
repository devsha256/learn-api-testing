const reportCount = parseInt(pm.collectionVariables.get("report_request_count") || "0");

if (reportCount === 0) {
    pm.visualizer.set(`<div style="padding:40px;text-align:center;font-family:Arial;background:#fff3cd"><h2>No Reports</h2><p>No requests were executed</p></div>`);
    console.log("No reports to display");
    return;
}

console.log("Generating report for " + reportCount + " requests");

const reports = [];

for (let i = 1; i <= reportCount; i++) {
    const paddedIndex = String(i).padStart(3, '0');
    const reportData = pm.collectionVariables.get("report_data_" + paddedIndex);
    
    if (reportData) {
        try {
            const report = JSON.parse(reportData);
            reports.push(report);
            console.log("Loaded report " + i + ": " + report.requestName);
        } catch (e) {
            console.error("Failed to parse report " + i + ": " + e.message);
        }
    }
}

if (reports.length === 0) {
    pm.visualizer.set(`<div style="padding:40px;text-align:center;font-family:Arial;background:#fff3cd"><h2>No Reports</h2><p>Failed to load report data</p></div>`);
    return;
}

// Generate CSV - FULL DATA NO TRUNCATION
function escapeCSV(text) {
    if (!text && text !== 0) return '';
    const str = String(text);
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// Full detailed CSV
let csvFullContent = 'Serial,Request Name,Status,Match %,Total Lines,Matched,Mismatched,Exempted,Boomi Status,MuleSoft Status,Timestamp,cURL Command,Boomi Response,MuleSoft Response\n';

reports.forEach(function(report) {
    const stats = report.statistics;
    const row = [
        report.serialNumber,
        escapeCSV(report.requestName),
        escapeCSV(stats.status),
        stats.matchPercentage,
        stats.totalLines,
        stats.matchedLines,
        stats.mismatchedLines,
        stats.exemptedLines,
        stats.boomiStatus,
        stats.mulesoftStatus,
        escapeCSV(stats.timestamp),
        escapeCSV(report.curlCommand),
        escapeCSV(report.boomiResponse),
        escapeCSV(report.mulesoftResponse)
    ].join(',');
    
    csvFullContent += row + '\n';
});

// Summary CSV
let csvSummaryContent = 'Serial,Request Name,Status,Match %,Total Lines,Matched,Mismatched,Exempted,Boomi Status,MuleSoft Status,Timestamp\n';

reports.forEach(function(report) {
    const stats = report.statistics;
    const row = [
        report.serialNumber,
        escapeCSV(report.requestName),
        escapeCSV(stats.status),
        stats.matchPercentage,
        stats.totalLines,
        stats.matchedLines,
        stats.mismatchedLines,
        stats.exemptedLines,
        stats.boomiStatus,
        stats.mulesoftStatus,
        escapeCSV(stats.timestamp)
    ].join(',');
    
    csvSummaryContent += row + '\n';
});

console.log("Full CSV size: " + csvFullContent.length + " characters");
console.log("Summary CSV size: " + csvSummaryContent.length + " characters");

// Store in collection variables for clipboard access
pm.collectionVariables.set("csv_full_report", csvFullContent);
pm.collectionVariables.set("csv_summary_report", csvSummaryContent);

// Generate summary statistics
const headerBg = reports.some(r => r.statistics.status === 'FAILED') ? '#c0392b' : '#27ae60';

const summaryStats = {
    total: reports.length,
    passed: reports.filter(r => r.statistics.status === 'PASSED').length,
    failed: reports.filter(r => r.statistics.status === 'FAILED').length,
    totalLines: reports.reduce((sum, r) => sum + r.statistics.totalLines, 0),
    totalMismatches: reports.reduce((sum, r) => sum + r.statistics.mismatchedLines, 0),
    avgMatchPercentage: Math.round(reports.reduce((sum, r) => sum + r.statistics.matchPercentage, 0) / reports.length)
};

// Generate table rows
let tableRows = reports.map(function(report) {
    const stats = report.statistics;
    const statusClass = stats.status === 'PASSED' ? 'passed' : 'failed';
    
    return `<tr class="${statusClass}">
        <td>${report.serialNumber}</td>
        <td class="req-name">${report.requestName}</td>
        <td class="status">${stats.status}</td>
        <td>${stats.matchPercentage}%</td>
        <td>${stats.totalLines}</td>
        <td>${stats.matchedLines}</td>
        <td>${stats.mismatchedLines}</td>
        <td>${stats.exemptedLines}</td>
        <td>${stats.boomiStatus}</td>
        <td>${stats.mulesoftStatus}</td>
        <td class="timestamp">${new Date(stats.timestamp).toLocaleString()}</td>
    </tr>`;
}).join('');

const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:12px;padding:20px;background:#f5f5f5}
.header{background:${headerBg};color:#fff;padding:20px;border-radius:6px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.1)}
.header h1{font-size:20px;margin-bottom:12px}
.summary{display:flex;gap:30px;font-size:13px;flex-wrap:wrap}
.summary div{display:flex;flex-direction:column;gap:4px}
.summary .label{opacity:0.9;font-size:11px}
.summary .value{font-size:18px;font-weight:bold}
.copy-section{background:#fff;padding:15px;border-radius:6px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,0.1)}
.copy-section h3{font-size:14px;margin-bottom:12px;color:#333}
.btn-group{display:flex;gap:10px;margin-bottom:8px}
.copy-btn{background:#2196F3;color:#fff;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;transition:background 0.2s}
.copy-btn:hover{background:#1976D2}
.copy-btn.secondary{background:#607D8B}
.copy-btn.secondary:hover{background:#455A64}
.info{font-size:11px;color:#666;padding:8px;background:#f5f5f5;border-radius:4px;margin-top:8px}
.table-container{background:#fff;border-radius:6px;overflow:auto;max-height:600px;box-shadow:0 1px 4px rgba(0,0,0,0.1)}
table{width:100%;border-collapse:collapse;font-size:11px}
thead{position:sticky;top:0;background:#37474f;color:#fff;z-index:10}
th{padding:12px 8px;text-align:left;font-weight:600;font-size:10px;border-right:1px solid #263238;white-space:nowrap}
td{padding:8px;border-bottom:1px solid #eceff1;border-right:1px solid #eceff1;font-size:11px;vertical-align:top}
.req-name{font-weight:500;color:#1976D2;max-width:250px}
.status{font-weight:600;text-transform:uppercase}
.timestamp{font-size:10px;color:#666}
tr.passed{background:#f1f8e9}
tr.passed .status{color:#2e7d32}
tr.failed{background:#ffebee}
tr.failed .status{color:#c62828}
tr:hover{background:#e3f2fd}
.signature{text-align:right;margin-top:15px;font-size:9px;color:#95a5a6;font-style:italic}
</style>
</head>
<body>
<div class="header">
<h1>Test Execution Report</h1>
<div class="summary">
<div><span class="label">Total Requests</span><span class="value">${summaryStats.total}</span></div>
<div><span class="label">Passed</span><span class="value" style="color:#4caf50">${summaryStats.passed}</span></div>
<div><span class="label">Failed</span><span class="value" style="color:#f44336">${summaryStats.failed}</span></div>
<div><span class="label">Avg Match</span><span class="value">${summaryStats.avgMatchPercentage}%</span></div>
<div><span class="label">Total Lines</span><span class="value">${summaryStats.totalLines}</span></div>
<div><span class="label">Total Mismatches</span><span class="value">${summaryStats.totalMismatches}</span></div>
</div>
</div>
<div class="copy-section">
<h3>Export Reports</h3>
<div class="btn-group">
<button class="copy-btn" id="copySummary">Copy Summary CSV</button>
<button class="copy-btn secondary" id="copyFull">Copy Full CSV (with responses & cURL)</button>
</div>
<div class="info">
<strong>Summary CSV:</strong> ${csvSummaryContent.length.toLocaleString()} characters<br>
<strong>Full CSV:</strong> ${csvFullContent.length.toLocaleString()} characters (includes complete cURL commands)
</div>
</div>
<div class="table-container">
<table>
<thead>
<tr>
<th>#</th>
<th>Request Name</th>
<th>Status</th>
<th>Match %</th>
<th>Lines</th>
<th>Matched</th>
<th>Mismatch</th>
<th>Exempt</th>
<th>Boomi</th>
<th>Mule</th>
<th>Timestamp</th>
</tr>
</thead>
<tbody>${tableRows}</tbody>
</table>
</div>
<div class="signature">S. 2025</div>
<script>
// Access data from Postman collection variables
const summaryCSV = \`${csvSummaryContent.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;
const fullCSV = \`${csvFullContent.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;

document.getElementById('copySummary').addEventListener('click', function() {
    copyToClipboard(summaryCSV, 'Summary CSV copied to clipboard!');
});

document.getElementById('copyFull').addEventListener('click', function() {
    copyToClipboard(fullCSV, 'Full CSV copied to clipboard!');
});

function copyToClipboard(text, message) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    
    try {
        document.execCommand('copy');
        showMessage(message + ' (' + text.length.toLocaleString() + ' characters)', 'success');
    } catch (err) {
        showMessage('Failed to copy: ' + err.message, 'error');
    }
    
    document.body.removeChild(textarea);
}

function showMessage(text, type) {
    const info = document.querySelector('.info');
    const msg = document.createElement('div');
    msg.textContent = text;
    msg.style.cssText = 'margin-top:8px;padding:8px;border-radius:4px;font-weight:500;';
    msg.style.background = type === 'success' ? '#d4edda' : '#f8d7da';
    msg.style.color = type === 'success' ? '#155724' : '#721c24';
    info.appendChild(msg);
    setTimeout(function() { msg.remove(); }, 3000);
}
</script>
</body>
</html>`;

pm.visualizer.set(html);
console.log("Report visualizer rendered with " + reports.length + " entries");
console.log("CSV data stored in collection variables");
