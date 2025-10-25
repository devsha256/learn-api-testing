if (pm.info.requestName.startsWith("_") || pm.info.requestName.startsWith("[")) {
    return;
}

// Check if running in Collection Runner
const isCollectionRunner = pm.info.iterationCount > 1;
const isIndividualExecution = !isCollectionRunner;

if (isIndividualExecution) {
    console.log("Individual execution mode - will show detailed comparison");
} else {
    console.log("Collection Runner mode - silent execution");
}

let attempts = 0;
const maxAttempts = 20;
const pollInterval = 500;

function waitForBoomiResponse() {
    attempts++;
    const boomiResponse = pm.collectionVariables.get("boomi_response");
    
    if (boomiResponse && boomiResponse !== "" && boomiResponse !== "undefined" && boomiResponse !== null) {
        executeComparison();
    } else if (attempts >= maxAttempts) {
        console.error("Boomi response timeout");
        pm.test("Boomi response received", function() {
            pm.expect.fail("Timeout waiting for Boomi response");
        });
        
        // Show timeout message in visualizer for individual execution
        if (isIndividualExecution) {
            const errorHtml = '<div style="padding:40px;text-align:center;font-family:Arial;background:#fff3cd;border-radius:4px"><h2 style="color:#856404">Timeout</h2><p>Boomi response not received within 10 seconds</p></div>';
            pm.visualizer.set(errorHtml);
        }
    } else {
        setTimeout(waitForBoomiResponse, pollInterval);
    }
}

waitForBoomiResponse();

function executeComparison() {
    const boomiResponseRaw = pm.collectionVariables.get("boomi_response");
    const boomiStatus = pm.collectionVariables.get("boomi_status");
    const mulesoftResponseRaw = pm.response.text();
    const reportIndex = pm.collectionVariables.get("current_report_index");
    const requestName = pm.collectionVariables.get("temp_request_name") || pm.info.requestName;
    const curlCommand = pm.collectionVariables.get("temp_request_curl") || "";

    if (!boomiResponseRaw || boomiResponseRaw === "") {
        console.error("Boomi response empty");
        if (isIndividualExecution) {
            const errorHtml = '<div style="padding:40px;text-align:center;font-family:Arial;background:#f8d7da;border-radius:4px"><h2 style="color:#721c24">Empty Response</h2><p>Boomi response is empty</p></div>';
            pm.visualizer.set(errorHtml);
        }
        return;
    }
    
    if (boomiResponseRaw.startsWith("ERROR:")) {
        console.error("Boomi API error");
        if (isIndividualExecution) {
            const errorHtml = '<div style="padding:40px;text-align:center;font-family:Arial;background:#f8d7da;border-radius:4px"><h2 style="color:#721c24">Boomi Error</h2><p>' + boomiResponseRaw.replace('ERROR: ', '') + '</p></div>';
            pm.visualizer.set(errorHtml);
        }
        return;
    }

    const exemptedFieldsStr = pm.collectionVariables.get("exempted_fields");
    const exemptedFields = exemptedFieldsStr ? JSON.parse(exemptedFieldsStr) : [];

    function formatResponse(responseText) {
        const trimmed = responseText.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                return JSON.stringify(JSON.parse(trimmed), null, 2);
            } catch (e) {
                return responseText;
            }
        }
        return responseText;
    }

    const boomiResponse = formatResponse(boomiResponseRaw);
    const mulesoftResponse = formatResponse(mulesoftResponseRaw);

    function lineContainsExemptedField(line, exemptedFields) {
        for (let i = 0; i < exemptedFields.length; i++) {
            if (line.includes('"' + exemptedFields[i] + '"') || line.includes('<' + exemptedFields[i] + '>')) {
                return true;
            }
        }
        return false;
    }

    function splitIntoLines(text) {
        return text ? text.split(/\r?\n/) : [];
    }

    const boomiLines = splitIntoLines(boomiResponse);
    const mulesoftLines = splitIntoLines(mulesoftResponse);

    function compareLineByLine(lines1, lines2, exemptedFields) {
        const maxLines = Math.max(lines1.length, lines2.length);
        const comparisonResults = [];
        let mismatchCount = 0;
        let exemptedCount = 0;
        
        for (let i = 0; i < maxLines; i++) {
            const boomiLine = lines1[i] !== undefined ? lines1[i] : '';
            const mulesoftLine = lines2[i] !== undefined ? lines2[i] : '';
            const isMatch = boomiLine === mulesoftLine;
            const isExempted = lineContainsExemptedField(boomiLine, exemptedFields) || lineContainsExemptedField(mulesoftLine, exemptedFields);
            
            let status = 'match';
            if (isExempted) {
                status = 'exempted';
                exemptedCount++;
            } else if (!isMatch) {
                status = 'mismatch';
                mismatchCount++;
            }
            
            comparisonResults.push({
                lineNumber: i + 1,
                boomiLine: boomiLine,
                mulesoftLine: mulesoftLine,
                status: status
            });
        }
        
        return {
            results: comparisonResults,
            totalMismatches: mismatchCount,
            totalExempted: exemptedCount,
            totalLines: maxLines
        };
    }

    const comparison = compareLineByLine(boomiLines, mulesoftLines, exemptedFields);

    console.log("Comparison: " + comparison.totalMismatches + " mismatches, " + comparison.totalExempted + " exempted");

    pm.test("Boomi API responded", function() {
        pm.expect(boomiStatus).to.be.oneOf([200, 201, 202, 204]);
    });

    pm.test("MuleSoft API responded", function() {
        pm.expect(pm.response.code).to.be.oneOf([200, 201, 202, 204]);
    });

    pm.test("Line counts match", function() {
        pm.expect(boomiLines.length).to.equal(mulesoftLines.length);
    });

    pm.test("All non-exempted lines match", function() {
        pm.expect(comparison.totalMismatches).to.equal(0);
    });

    const matchPercentage = comparison.totalLines > 0 ? Math.round(((comparison.totalLines - comparison.totalMismatches - comparison.totalExempted) / comparison.totalLines) * 100) : 100;
    const statusText = comparison.totalMismatches > 0 ? 'FAILED' : 'PASSED';

    function minifyResponse(responseText) {
        if (!responseText) return "";
        try {
            return JSON.stringify(JSON.parse(responseText.trim()));
        } catch (e) {
            return responseText.trim().substring(0, 1000);
        }
    }

    const statsObj = {
        totalLines: comparison.totalLines,
        matchedLines: comparison.totalLines - comparison.totalMismatches - comparison.totalExempted,
        mismatchedLines: comparison.totalMismatches,
        exemptedLines: comparison.totalExempted,
        matchPercentage: matchPercentage,
        status: statusText,
        boomiStatus: boomiStatus,
        mulesoftStatus: pm.response.code,
        timestamp: new Date().toISOString()
    };

    const reportEntry = {
        serialNumber: parseInt(reportIndex),
        requestName: requestName,
        curlCommand: curlCommand,
        boomiResponse: minifyResponse(boomiResponseRaw),
        mulesoftResponse: minifyResponse(mulesoftResponseRaw),
        statistics: statsObj
    };

    const paddedIndex = reportIndex.padStart(3, '0');
    pm.collectionVariables.set("report_data_" + paddedIndex, JSON.stringify(reportEntry));

    pm.collectionVariables.set("temp_request_name", "");
    pm.collectionVariables.set("temp_request_curl", "");

    // Show visualizer ONLY for individual execution
    if (isIndividualExecution) {
        console.log("Rendering visualizer with " + comparison.results.length + " lines");
        
        let tableRows = '';
        for (let i = 0; i < comparison.results.length; i++) {
            const row = comparison.results[i];
            const rowClass = row.status === 'exempted' ? 'exempted' : (row.status === 'mismatch' ? 'mismatch' : 'match');
            const boomiText = row.boomiLine || '<span class="empty">(empty)</span>';
            const mulesoftText = row.mulesoftLine || '<span class="empty">(empty)</span>';
            tableRows += '<tr class="' + rowClass + '"><td>' + row.lineNumber + '</td><td>' + boomiText + '</td><td>' + mulesoftText + '</td></tr>';
        }
        
        const headerBg = comparison.totalMismatches > 0 ? '#c0392b' : '#27ae60';
        
        const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:12px;padding:15px;background:#f5f5f5}.header{background:' + headerBg + ';color:#fff;padding:15px;border-radius:4px;margin-bottom:15px}.header h2{font-size:16px;margin-bottom:8px}.stats{display:flex;gap:20px;font-size:11px;flex-wrap:wrap}.stats div{display:flex;align-items:center;gap:5px}.stats .label{opacity:0.9}.stats .value{font-weight:bold;font-size:13px}.legend{background:#fff;padding:12px;border-radius:4px;margin-bottom:15px;display:flex;gap:15px;align-items:center;font-size:11px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}.legend-title{font-weight:bold;color:#333}.legend-item{display:flex;align-items:center;gap:6px}.legend-box{width:20px;height:14px;border:1px solid #ddd;border-radius:2px}.legend-box.match{background:#fff}.legend-box.mismatch{background:#ffebee}.legend-box.exempted{background:#fff3cd}.table-container{background:#fff;border-radius:4px;overflow:auto;max-height:70vh;box-shadow:0 1px 3px rgba(0,0,0,0.1)}table{width:100%;border-collapse:collapse;font-size:11px}thead{position:sticky;top:0;background:#34495e;color:#fff;z-index:10}th{padding:10px 8px;text-align:left;font-weight:600;font-size:10px;border-right:1px solid #2c3e50}th:first-child{width:50px;text-align:center}td{padding:8px;border-bottom:1px solid #ecf0f1;border-right:1px solid #ecf0f1;font-family:Consolas,monospace;font-size:11px;vertical-align:top;word-break:break-all}td:first-child{text-align:center;font-weight:bold;background:#f8f9fa;font-family:Arial,sans-serif}tr.match{background:#fff}tr.mismatch{background:#ffebee}tr.mismatch td:first-child{background:#ffcdd2;color:#c0392b}tr.exempted{background:#fff3cd}tr.exempted td:first-child{background:#ffecb3;color:#f57c00}tr:hover td{opacity:0.9}.empty{color:#95a5a6;font-style:italic}.signature{text-align:right;margin-top:10px;font-size:9px;color:#95a5a6;font-style:italic}</style></head><body><div class="header"><h2>Response Comparison: ' + requestName + '</h2><div class="stats"><div><span class="label">Lines:</span><span class="value">' + comparison.totalLines + '</span></div><div><span class="label">Mismatched:</span><span class="value">' + comparison.totalMismatches + '</span></div><div><span class="label">Exempted:</span><span class="value">' + comparison.totalExempted + '</span></div><div><span class="label">Match:</span><span class="value">' + matchPercentage + '%</span></div><div><span class="label">Status:</span><span class="value">' + statusText + '</span></div></div></div><div class="legend"><span class="legend-title">Legend:</span><div class="legend-item"><div class="legend-box match"></div><span>Match</span></div><div class="legend-item"><div class="legend-box mismatch"></div><span>Mismatch</span></div><div class="legend-item"><div class="legend-box exempted"></div><span>Exempted</span></div></div><div class="table-container"><table><thead><tr><th>Line</th><th>Boomi Response</th><th>MuleSoft Response</th></tr></thead><tbody>' + tableRows + '</tbody></table></div><div class="signature">S. 2025</div></body></html>';
        
        pm.visualizer.set(html);
        console.log("Visualizer set successfully");
    } else {
        console.log("Collection Runner - skipping visualizer");
    }
}
