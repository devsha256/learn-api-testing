// ========================================================================
// Skip utility requests EXCEPT in regression mode
// ========================================================================
const regressionMode = pm.collectionVariables.get("regression_mode");

if ((pm.info.requestName.startsWith("[")) && regressionMode !== "true") {
    console.log("Skipping utility request: " + pm.info.requestName);
    return;
}

// If in regression mode, log it
if (regressionMode === "true") {
    console.log("=== REGRESSION POST-REQUEST: Processing comparison ===");
}


const isCollectionRunner = pm.info.iteration > 0;
const isIndividualExecution = !isCollectionRunner;

console.log("Request: " + pm.info.requestName + ", Individual: " + isIndividualExecution);

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
        if (isIndividualExecution) {
            pm.visualizer.set(`<div style="padding:40px;text-align:center;font-family:Arial;background:#fff3cd"><h2>Timeout</h2><p>Boomi response not received</p></div>`);
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


    if (!boomiResponseRaw || boomiResponseRaw === "" || boomiResponseRaw.startsWith("ERROR:")) {
        console.error("Boomi response invalid");
        return;
    }

    const skipPayloadLogging = pm.collectionVariables.get("skip_payload_logging") === "true";


    const exemptedFieldsStr = pm.collectionVariables.get("exempted_fields");
    const exemptedFields = exemptedFieldsStr ? JSON.parse(exemptedFieldsStr) : [];


    // Parse responses
    let boomi, mule;
    try { boomi = JSON.parse(boomiResponseRaw); } catch (e) { boomi = boomiResponseRaw; }
    try { mule = JSON.parse(mulesoftResponseRaw); } catch (e) { mule = mulesoftResponseRaw; }


    // ===== ARRAY ALIGNMENT WITH LCS =====
    
    function normalizeArrays(obj) {
        if (Array.isArray(obj)) {
            const allPrimitive = obj.every(item => typeof item !== 'object' || item === null);
            if (allPrimitive) {
                return obj.slice().sort();
            }
            return obj.map(normalizeArrays);
        } else if (obj !== null && typeof obj === 'object') {
            const normalized = {};
            Object.keys(obj).sort().forEach(key => {
                normalized[key] = normalizeArrays(obj[key]);
            });
            return normalized;
        }
        return obj;
    }
    
    const boomiNorm = normalizeArrays(boomi);
    const muleNorm = normalizeArrays(mule);
    
    // Build JSON lines tracking array membership
    function buildJSONLines(obj, path, indent) {
        const lines = [];
        path = path || '';
        indent = indent || 0;
        
        if (obj === null) {
            lines.push({
                text: 'null',
                indent: indent,
                path: path,
                isPrimitive: true
            });
        } else if (typeof obj !== 'object') {
            lines.push({
                text: JSON.stringify(obj),
                indent: indent,
                path: path,
                isPrimitive: true,
                value: obj
            });
        } else if (Array.isArray(obj)) {
            const arrayPath = path;
            const allPrimitive = obj.every(item => typeof item !== 'object' || item === null);
            
            lines.push({ 
                text: '[', 
                indent: indent, 
                path: path, 
                type: 'open-array' 
            });
            
            obj.forEach((item, idx) => {
                const itemPath = path + '[' + idx + ']';
                const comma = idx < obj.length - 1 ? ',' : '';
                const itemLines = buildJSONLines(item, itemPath, indent + 1);
                
                itemLines.forEach((line, lineIdx) => {
                    if (lineIdx === itemLines.length - 1) {
                        line.text += comma;
                    }
                    if (allPrimitive && line.isPrimitive) {
                        line.arrayPath = arrayPath;
                        line.arrayValue = item;
                    }
                    lines.push(line);
                });
            });
            
            lines.push({ 
                text: ']', 
                indent: indent, 
                path: path, 
                type: 'close-array' 
            });
        } else {
            lines.push({ 
                text: '{', 
                indent: indent, 
                path: path, 
                type: 'open-object' 
            });
            
            const keys = Object.keys(obj).sort();
            keys.forEach((key, idx) => {
                const keyPath = path ? path + '.' + key : key;
                const value = obj[key];
                const comma = idx < keys.length - 1 ? ',' : '';
                
                if (typeof value === 'object' && value !== null) {
                    lines.push({
                        text: '"' + key + '": ',
                        indent: indent + 1,
                        path: keyPath,
                        type: 'key'
                    });
                    const valueLines = buildJSONLines(value, keyPath, indent + 1);
                    valueLines.forEach((line, lineIdx) => {
                        if (lineIdx === valueLines.length - 1) {
                            line.text += comma;
                        }
                        lines.push(line);
                    });
                } else {
                    lines.push({
                        text: '"' + key + '": ' + JSON.stringify(value) + comma,
                        indent: indent + 1,
                        path: keyPath,
                        isPrimitive: true,
                        value: value
                    });
                }
            });
            
            lines.push({ 
                text: '}', 
                indent: indent, 
                path: path, 
                type: 'close-object' 
            });
        }
        
        return lines;
    }
    
    const boomiLines = buildJSONLines(boomiNorm, '', 0);
    const muleLines = buildJSONLines(muleNorm, '', 0);
    
    // LCS-based alignment for primitive arrays
    function alignPrimitiveArrays(bLines, mLines) {
        const arrayGroups = {};
        
        // Group array elements by their parent array path
        bLines.forEach((line, idx) => {
            if (line.arrayPath) {
                if (!arrayGroups[line.arrayPath]) {
                    arrayGroups[line.arrayPath] = { boomi: [], mule: [] };
                }
                arrayGroups[line.arrayPath].boomi.push({ line, idx });
            }
        });
        
        mLines.forEach((line, idx) => {
            if (line.arrayPath) {
                if (!arrayGroups[line.arrayPath]) {
                    arrayGroups[line.arrayPath] = { boomi: [], mule: [] };
                }
                arrayGroups[line.arrayPath].mule.push({ line, idx });
            }
        });
        
        const alignmentMap = { boomi: new Map(), mule: new Map() };
        
        // For each array, create alignment using LCS approach
        Object.keys(arrayGroups).forEach(arrayPath => {
            const bItems = arrayGroups[arrayPath].boomi;
            const mItems = arrayGroups[arrayPath].mule;
            
            const bValues = bItems.map(item => item.line.arrayValue);
            const mValues = mItems.map(item => item.line.arrayValue);
            
            // Simple LCS alignment
            const aligned = [];
            let bIdx = 0;
            let mIdx = 0;
            
            while (bIdx < bValues.length || mIdx < mValues.length) {
                if (bIdx >= bValues.length) {
                    aligned.push({ bIdx: null, mIdx: mIdx });
                    mIdx++;
                } else if (mIdx >= mValues.length) {
                    aligned.push({ bIdx: bIdx, mIdx: null });
                    bIdx++;
                } else if (bValues[bIdx] === mValues[mIdx]) {
                    aligned.push({ bIdx: bIdx, mIdx: mIdx });
                    bIdx++;
                    mIdx++;
                } else {
                    let foundInMule = -1;
                    for (let i = mIdx + 1; i < Math.min(mIdx + 10, mValues.length); i++) {
                        if (bValues[bIdx] === mValues[i]) {
                            foundInMule = i;
                            break;
                        }
                    }
                    
                    let foundInBoomi = -1;
                    for (let i = bIdx + 1; i < Math.min(bIdx + 10, bValues.length); i++) {
                        if (mValues[mIdx] === bValues[i]) {
                            foundInBoomi = i;
                            break;
                        }
                    }
                    
                    if (foundInMule === -1 && foundInBoomi === -1) {
                        aligned.push({ bIdx: bIdx, mIdx: null });
                        aligned.push({ bIdx: null, mIdx: mIdx });
                        bIdx++;
                        mIdx++;
                    } else if (foundInMule !== -1 && (foundInBoomi === -1 || (foundInMule - mIdx) <= (foundInBoomi - bIdx))) {
                        aligned.push({ bIdx: null, mIdx: mIdx });
                        mIdx++;
                    } else {
                        aligned.push({ bIdx: bIdx, mIdx: null });
                        bIdx++;
                    }
                }
            }
            
            aligned.forEach(pair => {
                if (pair.bIdx !== null && pair.mIdx !== null) {
                    alignmentMap.boomi.set(bItems[pair.bIdx].idx, mItems[pair.mIdx].idx);
                    alignmentMap.mule.set(mItems[pair.mIdx].idx, bItems[pair.bIdx].idx);
                }
            });
        });
        
        return alignmentMap;
    }
    
    const arrayAlignment = alignPrimitiveArrays(boomiLines, muleLines);
    
    // Smart alignment with array awareness
    function alignWithArrays(leftLines, rightLines, arrayMap) {
        const aligned = [];
        let leftIdx = 0;
        let rightIdx = 0;
        
        while (leftIdx < leftLines.length || rightIdx < rightLines.length) {
            const leftLine = leftLines[leftIdx];
            const rightLine = rightLines[rightIdx];
            
            if (!leftLine && rightLine) {
                aligned.push({
                    boomi: { text: '', indent: rightLine.indent, isEmpty: true, path: rightLine.path },
                    mule: rightLine,
                    status: 'only_mule'
                });
                rightIdx++;
            } else if (leftLine && !rightLine) {
                aligned.push({
                    boomi: leftLine,
                    mule: { text: '', indent: leftLine.indent, isEmpty: true, path: leftLine.path },
                    status: 'only_boomi'
                });
                leftIdx++;
            } else {
                const mappedRight = arrayMap.boomi.get(leftIdx);
                const mappedLeft = arrayMap.mule.get(rightIdx);
                
                if (mappedRight === rightIdx) {
                    aligned.push({
                        boomi: leftLine,
                        mule: rightLine,
                        status: 'match'
                    });
                    leftIdx++;
                    rightIdx++;
                } else if (leftLine.arrayPath && !mappedRight) {
                    aligned.push({
                        boomi: leftLine,
                        mule: { text: '', indent: leftLine.indent, isEmpty: true, path: leftLine.path },
                        status: 'only_boomi'
                    });
                    leftIdx++;
                } else if (rightLine.arrayPath && !mappedLeft) {
                    aligned.push({
                        boomi: { text: '', indent: rightLine.indent, isEmpty: true, path: rightLine.path },
                        mule: rightLine,
                        status: 'only_mule'
                    });
                    rightIdx++;
                } else if (leftLine.path === rightLine.path && leftLine.type === rightLine.type) {
                    let status = 'match';
                    if (leftLine.text !== rightLine.text && !leftLine.type) {
                        status = 'mismatch';
                    }
                    
                    aligned.push({
                        boomi: leftLine,
                        mule: rightLine,
                        status: status
                    });
                    leftIdx++;
                    rightIdx++;
                } else {
                    let rightHasPath = false;
                    for (let i = rightIdx + 1; i < Math.min(rightIdx + 30, rightLines.length); i++) {
                        if (rightLines[i].path === leftLine.path && rightLines[i].type === leftLine.type) {
                            rightHasPath = true;
                            break;
                        }
                    }
                    
                    let leftHasPath = false;
                    for (let i = leftIdx + 1; i < Math.min(leftIdx + 30, leftLines.length); i++) {
                        if (leftLines[i].path === rightLine.path && leftLines[i].type === rightLine.type) {
                            leftHasPath = true;
                            break;
                        }
                    }
                    
                    if (!rightHasPath) {
                        aligned.push({
                            boomi: leftLine,
                            mule: { text: '', indent: leftLine.indent, isEmpty: true, path: leftLine.path },
                            status: 'only_boomi'
                        });
                        leftIdx++;
                    } else if (!leftHasPath) {
                        aligned.push({
                            boomi: { text: '', indent: rightLine.indent, isEmpty: true, path: rightLine.path },
                            mule: rightLine,
                            status: 'only_mule'
                        });
                        rightIdx++;
                    } else {
                        if (leftLine.path < rightLine.path) {
                            aligned.push({
                                boomi: leftLine,
                                mule: { text: '', indent: leftLine.indent, isEmpty: true, path: leftLine.path },
                                status: 'only_boomi'
                            });
                            leftIdx++;
                        } else {
                            aligned.push({
                                boomi: { text: '', indent: rightLine.indent, isEmpty: true, path: rightLine.path },
                                mule: rightLine,
                                status: 'only_mule'
                            });
                            rightIdx++;
                        }
                    }
                }
            }
        }
        
        return aligned;
    }
    
    const aligned = alignWithArrays(boomiLines, muleLines, arrayAlignment);

    // Helper function using regex for exact field matching
    function isFieldExempted(path, exemptedField) {
        if (!path || !exemptedField) return false;
        
        // Escape special regex characters in field name
        const escapedField = exemptedField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        const pattern = new RegExp(
            '^' + escapedField + '$|' +           // Exact match
            '\\.' + escapedField + '($|\\.)|' +   // After dot
            '\\]\\.' + escapedField + '($|\\.)'   // After bracket
        );
        
        return pattern.test(path);
    }

    // Calculate stats and track exempted fields
    let totalMismatches = 0;
    let totalExempted = 0;
    let totalMatched = 0;
    let totalOnlyMule = 0;  // Track but don't count as mismatch
    const exemptedFieldsFound = [];

    aligned.forEach(function(pair) {
        const path = pair.boomi.path || pair.mule.path;
        let isExempted = false;
        let matchedExemptField = null;
        
        // Check for exemption
        if (path) {
            for (let j = 0; j < exemptedFields.length; j++) {
                if (isFieldExempted(path, exemptedFields[j])) {
                    pair.status = 'exempted';
                    isExempted = true;
                    matchedExemptField = exemptedFields[j];
                    totalExempted++;
                    
                    // Track which exempted field was found (avoid duplicates)
                    if (exemptedFieldsFound.indexOf(exemptedFields[j]) === -1) {
                        exemptedFieldsFound.push(exemptedFields[j]);
                    }
                    break;
                }
            }
        }
        
        // Count matches and mismatches
        if (!isExempted) {
            if (pair.status === 'match') {
                // Values match perfectly
                totalMatched++;
            } else if (pair.status === 'mismatch') {
                // Values exist in both but differ - COUNT AS MISMATCH
                totalMismatches++;
            } else if (pair.status === 'only_boomi') {
                // Field in Boomi but missing in Mule - COUNT AS MISMATCH
                totalMismatches++;
            } else if (pair.status === 'only_mule') {
                // Field in Mule but missing in Boomi - IGNORE (Mule can have extra fields)
                totalOnlyMule++;
            }
        }
    });

    // Create comma-separated list of exempted fields found
    const exemptedFieldsList = exemptedFieldsFound.length > 0 ? exemptedFieldsFound.join(', ') : '';

    console.log("=== COMPARISON BREAKDOWN ===");
    console.log("Exempted fields: " + (exemptedFieldsList || "None"));
    console.log("Total matched: " + totalMatched);
    console.log("Total mismatches: " + totalMismatches + " (includes only_boomi)");
    console.log("Total exempted: " + totalExempted);
    console.log("Only in Mule (ignored): " + totalOnlyMule);

    // Tests
    pm.test("Boomi API responded", () => pm.expect(boomiStatus).to.be.oneOf([200, 201, 202, 204]));
    pm.test("MuleSoft API responded", () => pm.expect(pm.response.code).to.be.oneOf([200, 201, 202, 204]));
    pm.test("Boomi & Mule Status code match", () => pm.expect(boomiStatus).to.equal(pm.response.code));
    pm.test("All non-exempted fields match", () => pm.expect(totalMismatches).to.equal(0));

    const totalLines = aligned.length;
    console.log("=== STATISTICS ===");
    console.log("Total aligned lines: " + totalLines);
    console.log("Matched: " + totalMatched);
    console.log("Mismatches: " + totalMismatches);
    console.log("Exempted: " + totalExempted);
    console.log("Only in Mule (ignored): " + totalOnlyMule);

    // Calculate match percentage based on actual matched lines
    // Exclude only_mule from total since we ignore them
    const totalComparedLines = totalMatched + totalMismatches + totalExempted;
    const matchPercentage = totalComparedLines > 0 
        ? Math.round((totalMatched / totalComparedLines) * 100 * 100) / 100 
        : 0;

    // Final status logic: PASSED only if zero mismatches
    // (mismatch or only_boomi = FAILED)
    const statusText = totalMismatches === 0 ? "PASSED" : "FAILED";

    console.log("Match percentage: " + matchPercentage + "%");
    console.log("Overall status: " + statusText);


    function minifyResponse(text) {
        if (!text) return "";
        try { 
            const minified = JSON.stringify(JSON.parse(text.trim()));
            return minified.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        } catch (e) { 
            return text.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        }
    }

    const statsObj = {
        totalLines: totalLines,
        matchedLines: totalMatched,
        mismatchedLines: totalMismatches,
        exemptedLines: totalExempted,
        exemptedFields: exemptedFieldsList,
        matchPercentage: matchPercentage,
        status: statusText,
        boomiStatus: boomiStatus,
        mulesoftStatus: pm.response.code,
        timestamp: new Date().toISOString()
    };

    const reportEntry = {
        serialNumber: parseInt(reportIndex),
        requestName: requestName,
        curlCommand: curlCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
        boomiResponse: skipPayloadLogging ? "[PAYLOAD_SKIPPED]" : minifyResponse(boomiResponseRaw),
        mulesoftResponse: skipPayloadLogging ? "[PAYLOAD_SKIPPED]" : minifyResponse(mulesoftResponseRaw),
        statistics: statsObj
    };

    const paddedIndex = reportIndex.padStart(3, '0');
    
    pm.collectionVariables.set("report_data_" + paddedIndex, JSON.stringify(reportEntry));
    
    console.log("Report stored with cURL length: " + curlCommand.length);

    pm.collectionVariables.set("temp_request_name", "");
    pm.collectionVariables.set("temp_request_curl", "");

    // Visualizer
    if (isIndividualExecution) {
        console.log("Rendering side-by-side JSON visualizer");
        
        let tableRows = aligned.map(pair => {
            const bLine = pair.boomi;
            const mLine = pair.mule;
            const status = pair.status;
            
            const bIndent = bLine.indent * 16;
            const mIndent = mLine.indent * 16;
            
            const bText = bLine.isEmpty ? '' : bLine.text;
            const mText = mLine.isEmpty ? '' : mLine.text;
            
            let pointer = '';
            if (status === 'mismatch') pointer = '↔';
            else if (status === 'only_boomi') pointer = '→';
            else if (status === 'only_mule') pointer = '←';
            
            return `<tr class="${status}">
                <td style="padding-left:${bIndent}px">${bText || '<span class="empty">&nbsp;</span>'}</td>
                <td class="pointer">${pointer}</td>
                <td style="padding-left:${mIndent}px">${mText || '<span class="empty">&nbsp;</span>'}</td>
            </tr>`;
        }).join("");


        const headerBg = totalMismatches > 0 ? '#c0392b' : '#27ae60';

        const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:12px;padding:15px;background:#f5f5f5}
.header{background:${headerBg};color:#fff;padding:15px;border-radius:4px;margin-bottom:15px}
.header h2{font-size:16px;margin-bottom:8px}
.stats{display:flex;gap:20px;font-size:11px;flex-wrap:wrap}
.stats div{display:flex;align-items:center;gap:5px}
.stats .label{opacity:0.9}
.stats .value{font-weight:bold;font-size:13px}
.legend{background:#fff;padding:12px;border-radius:4px;margin-bottom:15px;display:flex;gap:15px;align-items:center;font-size:11px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}
.legend-title{font-weight:bold;color:#333}
.legend-item{display:flex;align-items:center;gap:6px}
.legend-box{width:20px;height:14px;border:1px solid #ddd;border-radius:2px}
.legend-box.match{background:#fff}
.legend-box.mismatch{background:#ffebee}
.legend-box.exempted{background:#fff3cd}
.legend-box.only_boomi{background:#fffde7}
.legend-box.only_mule{background:#e3f2fd}
.table-container{background:#fff;border-radius:4px;overflow:auto;max-height:70vh;box-shadow:0 1px 3px rgba(0,0,0,0.1)}
table{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed}
thead{position:sticky;top:0;background:#34495e;color:#fff;z-index:10}
th{padding:10px 8px;text-align:left;font-weight:600;font-size:10px;border-right:1px solid #2c3e50}
th:first-child{width:47%}
th:nth-child(2){width:6%;text-align:center}
th:last-child{width:47%}
td{padding:4px 8px;border-bottom:1px solid #ecf0f1;border-right:1px solid #ecf0f1;font-family:Consolas,Monaco,monospace;font-size:11px;vertical-align:top;word-wrap:break-word;white-space:pre-wrap;line-height:1.4;max-width:480px}
.pointer{text-align:center;font-size:14px;font-family:Arial;white-space:normal}
tr.match{background:#fff}
tr.mismatch{background:#ffebee}
tr.exempted{background:#fff3cd}
tr.only_boomi{background:#fffde7}
tr.only_mule{background:#e3f2fd}
tr:hover{background:#f1f8e9}
.empty{color:#ddd}
.signature{text-align:right;margin-top:10px;font-size:9px;color:#95a5a6;font-style:italic}
</style>
</head>
<body>
<div class="header">
<h2>Response Comparison: ${requestName}</h2>
<div class="stats">
<div><span class="label">Lines:</span><span class="value">${totalLines}</span></div>
<div><span class="label">Mismatched:</span><span class="value">${totalMismatches}</span></div>
<div><span class="label">Exempted:</span><span class="value">${totalExempted}</span></div>
<div><span class="label">Match:</span><span class="value">${matchPercentage}%</span></div>
<div><span class="label">Status:</span><span class="value">${statusText}</span></div>
</div>
</div>
<div class="legend">
<span class="legend-title">Legend:</span>
<div class="legend-item"><div class="legend-box match"></div><span>Match</span></div>
<div class="legend-item"><div class="legend-box mismatch"></div><span>Mismatch</span></div>
<div class="legend-item"><div class="legend-box exempted"></div><span>Exempted</span></div>
<div class="legend-item"><div class="legend-box only_boomi"></div><span>Only Boomi</span></div>
<div class="legend-item"><div class="legend-box only_mule"></div><span>Only Mule</span></div>
</div>
<div class="table-container">
<table>
<thead><tr><th>Boomi JSON</th><th></th><th>MuleSoft JSON</th></tr></thead>
<tbody>${tableRows}</tbody>
</table>
</div>
<div class="signature">S. 2025</div>
</body>
</html>`;
        
        pm.visualizer.set(html);
        console.log("Visualizer rendered with LCS array alignment");
    }
}
