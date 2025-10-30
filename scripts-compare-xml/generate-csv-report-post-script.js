// ========================================================================
// Utility Functions
// ========================================================================
const getReportCount = () => parseInt(pm.collectionVariables.get("report_request_count") || "0");
const getReportData = (index) => {
    const paddedIndex = String(index).padStart(3, '0');
    return pm.collectionVariables.get(`report_data_${paddedIndex}`);
};
const escapeCSV = (text) => {
    if (!text && text !== 0) return '';
    
    const str = String(text);
    
    // Always wrap in quotes and escape internal quotes by doubling them
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
};
const escapeForTemplate = (str) => str.replace(/`/g, '\\`');

// ========================================================================
// Report Loading
// ========================================================================
const parseReportData = (reportData, index) => {
    try {
        const report = JSON.parse(reportData);
        console.log(`Loaded report ${index}: ${report.requestName}`);
        return report;
    } catch (e) {
        console.error(`Failed to parse report ${index}: ${e.message}`);
        return null;
    }
};

const loadReports = (reportCount) => {
    const reports = [];
    for (let i = 1; i <= reportCount; i++) {
        const reportData = getReportData(i);
        if (reportData) {
            const report = parseReportData(reportData, i);
            if (report) reports.push(report);
        }
    }
    return reports;
};

// ========================================================================
// CSV Generation - PROPER ESCAPING
// ========================================================================
const createFullCSVRow = (report) => {
    const stats = report.statistics;
    return [
        report.serialNumber,
        escapeCSV(report.requestName),
        escapeCSV(stats.status),
        stats.matchPercentage,
        stats.totalLines,
        stats.matchedLines,
        stats.mismatchedLines,
        stats.exemptedLines,
        escapeCSV(stats.exemptedFields || ''),
        stats.boomiStatus,
        stats.mulesoftStatus,
        escapeCSV(stats.timestamp),
        escapeCSV(report.curlCommand),
        escapeCSV(report.boomiResponse),
        escapeCSV(report.mulesoftResponse)
    ].join(',');
};

const createSummaryCSVRow = (report) => {
    const stats = report.statistics;
    return [
        report.serialNumber,
        escapeCSV(report.requestName),
        escapeCSV(stats.status),
        stats.matchPercentage,
        stats.totalLines,
        stats.matchedLines,
        stats.mismatchedLines,
        stats.exemptedLines,
        escapeCSV(stats.exemptedFields || ''),
        stats.boomiStatus,
        stats.mulesoftStatus,
        escapeCSV(stats.timestamp)
    ].join(',');
};

const generateFullCSV = (reports) => {
    const header = 'Serial,Request Name,Status,Match %,Total Lines,Matched,Mismatched,Exempted,Exempted Fields,Boomi Status,MuleSoft Status,Timestamp,cURL Command,Boomi Response,MuleSoft Response\n';
    const rows = reports.map(createFullCSVRow).join('\n');
    return header + rows + '\n';
};

const generateSummaryCSV = (reports) => {
    const header = 'Serial,Request Name,Status,Match %,Total Lines,Matched,Mismatched,Exempted,Exempted Fields,Boomi Status,MuleSoft Status,Timestamp\n';
    const rows = reports.map(createSummaryCSVRow).join('\n');
    return header + rows + '\n';
};

// ========================================================================
// Statistics Calculation
// ========================================================================
const countPassedReports = (reports) => reports.filter(r => r.statistics.status === 'PASSED').length;
const countFailedReports = (reports) => reports.filter(r => r.statistics.status === 'FAILED').length;
const sumTotalLines = (reports) => reports.reduce((sum, r) => sum + r.statistics.totalLines, 0);
const sumTotalMismatches = (reports) => reports.reduce((sum, r) => sum + r.statistics.mismatchedLines, 0);
const calculateAvgMatchPercentage = (reports) => {
    if (reports.length === 0) return 0;
    return Math.round(reports.reduce((sum, r) => sum + r.statistics.matchPercentage, 0) / reports.length);
};
const generateSummaryStats = (reports) => ({
    total: reports.length,
    passed: countPassedReports(reports),
    failed: countFailedReports(reports),
    totalLines: sumTotalLines(reports),
    totalMismatches: sumTotalMismatches(reports),
    avgMatchPercentage: calculateAvgMatchPercentage(reports)
});

// ========================================================================
// HTML Generation
// ========================================================================
const formatTimestamp = (timestamp) => new Date(timestamp).toLocaleString();
const generateTableRows = (reports) => reports.map(report => {
    const stats = report.statistics;
    const statusClass = stats.status === 'PASSED' ? 'status-passed' : 'status-failed';
    return `
        <tr>
            <td>${report.serialNumber}</td>
            <td>${escapeCSV(report.requestName)}</td>
            <td><span class="status-badge ${statusClass}">${stats.status}</span></td>
            <td>${stats.matchPercentage}%</td>
            <td>${stats.totalLines}</td>
            <td>${stats.matchedLines}</td>
            <td>${stats.mismatchedLines}</td>
            <td>${stats.exemptedLines}</td>
            <td>${stats.exemptedFields}</td>
            <td>${stats.boomiStatus}</td>
            <td>${stats.mulesoftStatus}</td>
            <td>${formatTimestamp(stats.timestamp)}</td>
        </tr>
    `;
}).join('');

const generateHTML = (reports, summaryStats, csvSummaryContent, csvFullContent) => {
    const tableRows = generateTableRows(reports);

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Test Execution Report</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
        <script src="https://d3js.org/d3.v7.min.js"></script>
        <style>
            :root {
                --md-sys-color-primary: #6750A4;
                --md-sys-color-on-primary: #FFFFFF;
                --md-sys-color-primary-container: #EADDFF;
                --md-sys-color-on-primary-container: #21005D;
                --md-sys-color-secondary-container: #E8DEF8;
                --md-sys-color-on-secondary-container: #1D192B;
                --md-sys-color-surface: #FFFBFE;
                --md-sys-color-surface-variant: #E7E0EC;
                --md-sys-color-on-surface: #1C1B1F;
                --md-sys-color-on-surface-variant: #49454F;
                --md-sys-color-outline: #79747E;
                --md-sys-color-error: #B3261E;
                --md-sys-color-success: #27ae60;
                --border-radius: 16px;
                --spacing-small: 8px;
                --spacing-medium: 16px;
                --spacing-large: 24px;
            }
            body { margin: 0; padding: var(--spacing-large); box-sizing: border-box; font-family: 'Roboto', 'Arial', sans-serif; background-color: #F7F2FA; color: var(--md-sys-color-on-surface); }
            .main-container { display: flex; flex-direction: column; gap: var(--spacing-large); }
            .card { background-color: var(--md-sys-color-surface); border-radius: var(--border-radius); padding: var(--spacing-large); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .header-card h1 { font-size: 24px; font-weight: 500; margin: 0 0 var(--spacing-medium) 0; }
            .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--spacing-medium); }
            .stat-item { display: flex; flex-direction: column; padding: var(--spacing-medium); border-radius: 12px; background-color: var(--md-sys-color-surface-variant); }
            .stat-item .label { font-size: 12px; color: var(--md-sys-color-on-surface-variant); }
            .stat-item .value { font-size: 20px; font-weight: 500; }
            .stat-item .value.passed { color: var(--md-sys-color-success); }
            .stat-item .value.failed { color: var(--md-sys-color-error); }
            .tab-bar { display: flex; border-bottom: 1px solid var(--md-sys-color-outline); margin-bottom: var(--spacing-large); }
            .tab-button { padding: var(--spacing-medium); cursor: pointer; border: none; background: none; font-family: inherit; font-size: 14px; font-weight: 500; color: var(--md-sys-color-on-surface-variant); border-bottom: 2px solid transparent; margin-bottom: -1px; }
            .tab-button.active { color: var(--md-sys-color-primary); border-bottom-color: var(--md-sys-color-primary); }
            .tab-content { display: none; }
            .tab-content.active { display: block; }
            .content-section { display: flex; flex-direction: column; gap: var(--spacing-large); }
            .table-container { max-height: 60vh; overflow: auto; border: 1px solid var(--md-sys-color-surface-variant); border-radius: var(--border-radius); }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            thead { position: sticky; top: 0; background: var(--md-sys-color-surface); z-index: 10; }
            th { padding: var(--spacing-medium); text-align: left; font-weight: 700; color: var(--md-sys-color-on-surface-variant); border-bottom: 1px solid var(--md-sys-color-outline); white-space: nowrap; }
            td { padding: var(--spacing-medium); border-bottom: 1px solid var(--md-sys-color-surface-variant); vertical-align: middle; }
            tbody tr:hover { background-color: var(--md-sys-color-primary-container); }
            .status-badge { padding: 4px 8px; border-radius: 8px; font-weight: 500; font-size: 11px; text-transform: uppercase; }
            .status-passed { background-color: #C8E6C9; color: #2E7D32; }
            .status-failed { background-color: #FFCDD2; color: #C62828; }
            .copy-btn { background-color: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); border: none; padding: 10px 24px; border-radius: 20px; cursor: pointer; font-size: 14px; font-weight: 500; }
            .copy-btn.secondary { background-color: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container); }
            .btn-group { display: flex; gap: var(--spacing-medium); margin-top: var(--spacing-medium); }
            .chart-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: var(--spacing-large); align-items: center; justify-items: center; }
            .chart-title { font-size: 16px; font-weight: 500; text-align: center; margin-bottom: var(--spacing-medium); }
        </style>
    </head>
    <body>
        <div class="main-container">
            <div class="card header-card">
                <h1>Test Execution Report</h1>
                <div class="summary-grid">
                    <div class="stat-item"><span class="label">Total Requests</span><span class="value">${summaryStats.total}</span></div>
                    <div class="stat-item"><span class="label">Passed</span><span class="value passed">${summaryStats.passed}</span></div>
                    <div class="stat-item"><span class="label">Failed</span><span class="value failed">${summaryStats.failed}</span></div>
                    <div class="stat-item"><span class="label">Avg Match %</span><span class="value">${summaryStats.avgMatchPercentage}%</span></div>
                    <div class="stat-item"><span class="label">Total Lines</span><span class="value">${summaryStats.totalLines}</span></div>
                    <div class="stat-item"><span class="label">Mismatches</span><span class="value">${summaryStats.totalMismatches}</span></div>
                </div>
            </div>
            <div class="tab-bar">
                <button class="tab-button active" onclick="showTab('report')">Report</button>
                <button class="tab-button" onclick="showTab('charts')">Charts</button>
            </div>
            <div id="report" class="tab-content active">
                <div class="content-section">
                    <div class="card">
                         <h3>Export Reports</h3>
                         <div class="btn-group">
                             <button class="copy-btn" id="copySummary">Copy Summary CSV</button>
                             <button class="copy-btn secondary" id="copyFull">Copy Full CSV</button>
                         </div>
                         <div id="copy-info"></div>
                    </div>
                    <div class="card table-container">
                        <table>
                            <thead>
                                <tr><th>#</th><th>Request Name</th><th>Status</th><th>Match %</th><th>Lines</th><th>Matched</th><th>Mismatch</th><th>Exempt</th><th>Exempted Fields</th><th>Boomi</th><th>Mule</th><th>Timestamp</th></tr>
                            </thead>
                            <tbody>${tableRows}</tbody>
                        </table>
                    </div>
                </div>
            </div>
            <div id="charts" class="tab-content">
                <div class="card chart-container">
                    <div>
                        <h3 class="chart-title">Overall Status</h3>
                        <div id="status-chart"></div>
                    </div>
                    <div>
                         <h3 class="chart-title">Mismatches per Request</h3>
                         <div id="mismatch-chart"></div>
                    </div>
                </div>
            </div>
        </div>
        <script>
            const reportsData = ${JSON.stringify(reports)};
            function showTab(tabName) {
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
                document.getElementById(tabName).classList.add('active');
                event.currentTarget.classList.add('active');
            }
            function drawCharts() {
                const statusData = [{status: 'Passed', count: ${summaryStats.passed}}, {status: 'Failed', count: ${summaryStats.failed}}];
                const width = 250, height = 250, margin = 40, radius = Math.min(width, height) / 2 - margin;
                const statusSvg = d3.select("#status-chart").append("svg").attr("width", width).attr("height", height).append("g").attr("transform", "translate(" + width / 2 + "," + height / 2 + ")");
                const color = d3.scaleOrdinal().domain(statusData.map(d => d.status)).range(['#27ae60', '#B3261E']);
                const pie = d3.pie().value(d => d.count);
                const data_ready = pie(statusData);
                const arc = d3.arc().innerRadius(radius * 0.5).outerRadius(radius);
                const outerArc = d3.arc().innerRadius(radius * 0.9).outerRadius(radius * 0.9);
                statusSvg.selectAll('path').data(data_ready).join('path').attr('d', arc).attr('fill', d => color(d.data.status)).attr("stroke", "#FFFBFE").style("stroke-width", "2px");
                statusSvg.selectAll('polyline').data(data_ready).join('polyline').attr("stroke", "black").style("fill", "none").attr("stroke-width", 1).attr('points', d => [arc.centroid(d), outerArc.centroid(d), [outerArc.centroid(d)[0] * 1.2, outerArc.centroid(d)[1] * 1.2]]);
                statusSvg.selectAll('text').data(data_ready).join('text').text(d => d.data.status + ' (' + d.data.count + ')').attr('transform', d => 'translate(' + [outerArc.centroid(d)[0] * 1.3, outerArc.centroid(d)[1] * 1.3] + ')').style('text-anchor', d => (d.startAngle + d.endAngle) / 2 < Math.PI ? 'start' : 'end').style("font-size", 12);
                const mismatchData = reportsData.map(r => ({ name: r.requestName.length > 20 ? r.requestName.substring(0, 17) + '...' : r.requestName, mismatches: r.statistics.mismatchedLines }));
                const barMargin = {top: 20, right: 20, bottom: 90, left: 40}, barWidth = 400 - barMargin.left - barMargin.right, barHeight = 300 - barMargin.top - barMargin.bottom;
                const mismatchSvg = d3.select("#mismatch-chart").append("svg").attr("width", barWidth + barMargin.left + barMargin.right).attr("height", barHeight + barMargin.top + barMargin.bottom).append("g").attr("transform", "translate(" + barMargin.left + "," + barMargin.top + ")");
                const x = d3.scaleBand().range([0, barWidth]).domain(mismatchData.map(d => d.name)).padding(0.2);
                mismatchSvg.append("g").attr("transform", "translate(0," + barHeight + ")").call(d3.axisBottom(x)).selectAll("text").attr("transform", "translate(-10,0)rotate(-45)").style("text-anchor", "end");
                const y = d3.scaleLinear().domain([0, d3.max(mismatchData, d => d.mismatches) || 1]).range([barHeight, 0]);
                mismatchSvg.append("g").call(d3.axisLeft(y));
                mismatchSvg.selectAll("rect").data(mismatchData).enter().append("rect").attr("x", d => x(d.name)).attr("y", d => y(d.mismatches)).attr("width", x.bandwidth()).attr("height", d => barHeight - y(d.mismatches)).attr("fill", "#6750A4");
            }
            drawCharts();
            const summaryCSV = \`${escapeForTemplate(csvSummaryContent)}\`;
            const fullCSV = \`${escapeForTemplate(csvFullContent)}\`;
            document.getElementById('copySummary').addEventListener('click', () => copyToClipboard(summaryCSV, 'Summary CSV Copied!'));
            document.getElementById('copyFull').addEventListener('click', () => copyToClipboard(fullCSV, 'Full CSV Copied!'));
            function copyToClipboard(text, message) {
                const ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                const info = document.getElementById('copy-info');
                info.textContent = message;
                setTimeout(() => info.textContent = '', 3000);
            }
        </script>
    </body>
    </html>`;
};

const showNoReportsMessage = (message) => {
    const style = `
    :root {
        --md-sys-color-primary: #6750A4;
        --md-sys-color-on-primary: #FFFFFF;
        --md-sys-color-primary-container: #EADDFF;
        --md-sys-color-on-primary-container: #21005D;
        --md-sys-color-surface: #FFFBFE;
        --md-sys-color-surface-variant: #E7E0EC;
        --md-sys-color-on-surface: #1C1B1F;
        --md-sys-color-on-surface-variant: #49454F;
        --md-sys-color-outline: #79747E;
        --border-radius: 16px;
        --spacing-small: 8px;
        --spacing-medium: 16px;
        --spacing-large: 24px;
    }

    body {
        margin: 0;
        padding: var(--spacing-large);
        font-family: 'Roboto', Arial, sans-serif;
        background-color: var(--md-sys-color-surface);
        color: var(--md-sys-color-on-surface);
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        text-align: center;
    }

    .container {
        background-color: var(--md-sys-color-surface);
        border-radius: var(--border-radius);
        padding: var(--spacing-large);
        max-width: 480px;
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-medium);
        align-items: center;
    }

    .heading {
        font-size: 24px;
        font-weight: 500;
        color: var(--md-sys-color-primary);
        margin-bottom: var(--spacing-small);
    }

    .message {
        font-size: 16px;
        color: var(--md-sys-color-on-surface-variant);
        margin-bottom: var(--spacing-medium);
    }

    svg#animation {
        width: 100%;
        height: 220px;
    }
    `;

    const html = `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&display=swap" rel="stylesheet">
        <style>${style}</style>
        <script src="https://d3js.org/d3.v7.min.js"></script>
        <title>No Reports</title>
    </head>
    <body>
        <div class="container">
            <h2>No Reports Found</h2>
            <p>${message}</p>
            <svg id="animation"></svg>
        </div>
        <script>
            const svg = d3.select('#animation');
            const width = svg.node().getBoundingClientRect().width;
            const height = svg.node().getBoundingClientRect().height;
            const centerX = width / 2;
            const centerY = height / 2;
            const numBubbles = 15;

            const bubbles = d3.range(numBubbles).map(() => ({}));

            const bubbleElements = svg.selectAll('circle')
                .data(bubbles)
                .join('circle')
                .attr('cx', centerX)
                .attr('cy', centerY)
                .attr('r', 0)
                .attr('fill', 'var(--md-sys-color-primary)')
                .style('opacity', 0.7);

            function animate(selection) {
                selection.transition()
                    .delay((d, i) => i * 250) // Stagger the start of each bubble
                    .duration(3500)
                    .attr('r', Math.min(width, height) / 2)
                    .style('opacity', 0)
                    .on('end', function() {
                        d3.select(this).attr('r', 0).style('opacity', 0.7);
                        animate(d3.select(this)); // Restart the animation for this specific bubble
                    });
            }
            
            animate(bubbleElements);
        </script>
    </body>
    </html>`;

    pm.visualizer.set(html);
};


// ========================================================================
// Main Execution
// ========================================================================
const reportCount = getReportCount();

if (reportCount > 0) {
    const reports = loadReports(reportCount);
    const summaryStats = generateSummaryStats(reports);
    const csvSummaryContent = generateSummaryCSV(reports);
    const csvFullContent = generateFullCSV(reports);
    const html = generateHTML(reports, summaryStats, csvSummaryContent, csvFullContent);
    pm.visualizer.set(html);
} else {
    // This will now call the updated function with the D3 animation
    showNoReportsMessage("No reports were generated during this run. Please check your test setup and collection variables.");
}
