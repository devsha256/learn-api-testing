// Skip if this is a utility request
if (pm.info.requestName.startsWith("_") || pm.info.requestName.startsWith("[")) {
    console.log("Skipping utility request:", pm.info.requestName);
    return;
}

console.log("\n=== Comparing Responses for: " + pm.info.requestName + " ===");

// Polling configuration
let attempts = 0;
const maxAttempts = 20;
const pollInterval = 500;

// Start polling for Boomi response
function waitForBoomiResponse() {
    attempts++;
    const boomiResponse = pm.collectionVariables.get("boomi_response");
    const boomiStatus = pm.collectionVariables.get("boomi_status");
    
    console.log("Polling attempt " + attempts + "/" + maxAttempts + "...");
    
    if (boomiResponse && boomiResponse !== "" && boomiResponse !== "undefined" && boomiResponse !== null) {
        console.log("Boomi response ready after " + (attempts * pollInterval) + "ms");
        executeComparison();
    } else if (attempts >= maxAttempts) {
        console.error("Boomi response timeout after " + (maxAttempts * pollInterval) + "ms");
        console.error("Current boomiResponse value:", boomiResponse);
        
        pm.test("Boomi response received within timeout", function() {
            pm.expect.fail("Boomi response not available after " + (maxAttempts * pollInterval) + "ms timeout");
        });
        
        const errorTemplate = '<div style="padding:40px;text-align:center;font-family:Arial;background:#fff3cd;border-radius:8px"><h2 style="color:#856404">Timeout Waiting for Boomi Response</h2><p style="color:#856404;margin-top:20px">Boomi API did not respond within ' + (maxAttempts * pollInterval / 1000) + ' seconds</p><p style="color:#721c24;font-size:14px;margin-top:15px">Possible causes:</p><ul style="text-align:left;display:inline-block;color:#721c24"><li>Boomi API is slow or timing out</li><li>Network connectivity issues</li><li>Boomi authentication failed</li><li>Incorrect Boomi URL configuration</li></ul><p style="color:#856404;font-size:12px;margin-top:20px">Check the Console for detailed logs</p></div>';
        
        pm.visualizer.set(errorTemplate);
    } else {
        setTimeout(waitForBoomiResponse, pollInterval);
    }
}

waitForBoomiResponse();

function executeComparison() {
    const boomiResponse = pm.collectionVariables.get("boomi_response");
    const boomiStatus = pm.collectionVariables.get("boomi_status");
    const boomiError = pm.collectionVariables.get("boomi_error");
    const mulesoftResponse = pm.response.text();

    if (!boomiResponse || boomiResponse === "") {
        console.error("Boomi response is empty or undefined");
        
        pm.test("Boomi response exists", function() {
            pm.expect(boomiResponse).to.exist;
            pm.expect(boomiResponse).to.not.equal("");
        });
        
        const errorTemplate = '<div style="padding:40px;text-align:center;font-family:Arial;background:#f8d7da;border-radius:8px"><h2 style="color:#721c24">Empty Boomi Response</h2><p style="color:#721c24">Boomi response is empty or undefined</p></div>';
        
        pm.visualizer.set(errorTemplate);
        return;
    }

    if (boomiResponse.startsWith("ERROR:")) {
        console.error("Boomi request failed:", boomiResponse);
        
        pm.test("Boomi API call succeeded", function() {
            pm.expect(boomiResponse).to.not.include("ERROR:");
        });
        
        const errorMsg = boomiResponse.replace('ERROR: ', '');
        const errorTemplate = '<div style="padding:40px;text-align:center;font-family:Arial;background:#f8d7da;border-radius:8px"><h2 style="color:#721c24">Boomi API Error</h2><p style="color:#721c24;margin-top:20px">' + errorMsg + '</p></div>';
        
        pm.visualizer.set(errorTemplate);
        return;
    }

    console.log("\nResponse Statistics:");
    console.log("  Boomi Status:", boomiStatus);
    console.log("  MuleSoft Status:", pm.response.code);
    console.log("  Boomi Length:", boomiResponse.length, "characters");
    console.log("  MuleSoft Length:", mulesoftResponse.length, "characters");

    function splitIntoLines(text) {
        if (!text) return [];
        return text.split(/\r?\n/);
    }

    const boomiLines = splitIntoLines(boomiResponse);
    const mulesoftLines = splitIntoLines(mulesoftResponse);

    console.log("  Boomi Lines:", boomiLines.length);
    console.log("  MuleSoft Lines:", mulesoftLines.length);

    function compareLineByLine(lines1, lines2) {
        const maxLines = Math.max(lines1.length, lines2.length);
        const comparisonResults = [];
        let mismatchCount = 0;
        
        for (let i = 0; i < maxLines; i++) {
            const boomiLine = lines1[i] !== undefined ? lines1[i] : '';
            const mulesoftLine = lines2[i] !== undefined ? lines2[i] : '';
            const isMatch = boomiLine === mulesoftLine;
            
            if (!isMatch) {
                mismatchCount++;
                console.log("  Mismatch at line " + (i + 1));
            }
            
            comparisonResults.push({
                lineNumber: i + 1,
                boomiLine: boomiLine,
                mulesoftLine: mulesoftLine,
                isMatch: isMatch
            });
        }
        
        return {
            results: comparisonResults,
            totalMismatches: mismatchCount,
            totalLines: maxLines
        };
    }

    const comparison = compareLineByLine(boomiLines, mulesoftLines);

    console.log("\nComparison Complete:");
    console.log("  Total Lines:", comparison.totalLines);
    console.log("  Mismatched Lines:", comparison.totalMismatches);
    console.log("  Match Rate:", Math.round(((comparison.totalLines - comparison.totalMismatches) / comparison.totalLines) * 100) + "%");

    pm.test("Boomi API responded successfully", function() {
        pm.expect(boomiStatus).to.be.oneOf([200, 201, 202, 204]);
    });

    pm.test("MuleSoft API responded successfully", function() {
        pm.expect(pm.response.code).to.be.oneOf([200, 201, 202, 204]);
    });

    pm.test("Response line counts match", function() {
        pm.expect(boomiLines.length).to.equal(mulesoftLines.length);
    });

    pm.test("All lines match exactly", function() {
        pm.expect(comparison.totalMismatches).to.equal(0);
    });

    const matchPercentage = comparison.totalLines > 0 ? Math.round(((comparison.totalLines - comparison.totalMismatches) / comparison.totalLines) * 100) : 100;

    const headerColor = comparison.totalMismatches > 0 ? '#dc3545' : '#28a745';
    const statusText = comparison.totalMismatches > 0 ? 'FAILED' : 'PASSED';
    
    let tableRows = '';
    for (let i = 0; i < comparison.results.length; i++) {
        const row = comparison.results[i];
        const rowClass = row.isMatch ? 'match-row' : 'mismatch-row';
        const boomiText = row.boomiLine || '<span class="empty-line">(empty line)</span>';
        const mulesoftText = row.mulesoftLine || '<span class="empty-line">(empty line)</span>';
        tableRows += '<tr class="' + rowClass + '"><td class="line-num">' + row.lineNumber + '</td><td>' + boomiText + '</td><td>' + mulesoftText + '</td></tr>';
    }

    const template = '<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;padding:20px;background:#f5f5f5}.header{background:' + headerColor + ';color:white;padding:20px;border-radius:8px;margin-bottom:20px;box-shadow:0 2px 4px rgba(0,0,0,0.1)}.header h2{margin:0 0 10px 0;font-size:24px}.header-stats{display:flex;gap:30px;margin-top:15px;font-size:14px;flex-wrap:wrap}.stat-item{display:flex;align-items:center;gap:8px}.stat-value{font-weight:bold;font-size:16px}.legend{background:white;padding:15px;border-radius:8px;margin-bottom:20px;box-shadow:0 2px 4px rgba(0,0,0,0.1);display:flex;gap:30px;align-items:center;flex-wrap:wrap}.legend-title{font-weight:bold;color:#333}.legend-item{display:flex;align-items:center;gap:10px}.legend-box{width:30px;height:20px;border:1px solid #ddd;border-radius:3px}.legend-box.match{background-color:#ffffff}.legend-box.mismatch{background-color:#ffe6e6}.comparison-container{background:white;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);overflow:hidden;max-height:80vh;overflow-y:auto}table{width:100%;border-collapse:collapse}thead{position:sticky;top:0;z-index:10}th{background-color:#2c3e50;color:white;padding:15px 10px;text-align:left;font-weight:600;border-right:2px solid #34495e}th:last-child{border-right:none}th.line-num{width:80px;text-align:center}th.response-column{width:45%}td{padding:8px 10px;vertical-align:top;border-bottom:1px solid #e0e0e0;border-right:1px solid #e0e0e0;font-family:Consolas,monospace;font-size:13px;white-space:pre-wrap;word-break:break-all}td:last-child{border-right:none}td.line-num{text-align:center;font-weight:bold;color:#666;background-color:#f8f9fa;font-family:Arial,sans-serif}tr.match-row{background-color:#ffffff}tr.mismatch-row{background-color:#ffe6e6}tr.mismatch-row td.line-num{background-color:#ffcccc;color:#c0392b;font-weight:bold}tr:hover td{background-color:#f0f0f0}tr.mismatch-row:hover td{background-color:#ffd6d6}.empty-line{color:#999;font-style:italic}.success-message{text-align:center;padding:40px;background:white;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);margin-top:20px}.success-icon{font-size:64px;color:#28a745;margin-bottom:20px}</style></head><body><div class="header"><h2>Boomi vs MuleSoft Response Comparison</h2><div class="header-stats"><div class="stat-item"><span>Request:</span><span class="stat-value">' + pm.info.requestName + '</span></div><div class="stat-item"><span>Total Lines:</span><span class="stat-value">' + comparison.totalLines + '</span></div><div class="stat-item"><span>Mismatched Lines:</span><span class="stat-value">' + comparison.totalMismatches + '</span></div><div class="stat-item"><span>Match Rate:</span><span class="stat-value">' + matchPercentage + '%</span></div><div class="stat-item"><span>Status:</span><span class="stat-value">' + statusText + '</span></div></div></div><div class="legend"><span class="legend-title">Legend:</span><div class="legend-item"><div class="legend-box match"></div><span>Matching Lines</span></div><div class="legend-item"><div class="legend-box mismatch"></div><span>Mismatched Lines</span></div></div>';

    if (comparison.totalMismatches > 0) {
        template += '<div class="comparison-container"><table><thead><tr><th class="line-num">Line</th><th class="response-column">Boomi Response</th><th class="response-column">MuleSoft Response</th></tr></thead><tbody>' + tableRows + '</tbody></table></div>';
    } else {
        template += '<div class="success-message"><div class="success-icon">✓</div><h3 style="color:#28a745;margin-bottom:10px">Perfect Match!</h3><p style="color:#666;font-size:16px">All ' + comparison.totalLines + ' lines match exactly between Boomi and MuleSoft responses</p></div>';
    }

    template += '</body></html>';

    pm.visualizer.set(template);
}
