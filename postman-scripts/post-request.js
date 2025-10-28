// Skip utility requests
if (pm.info.requestName.startsWith("_") || pm.info.requestName.startsWith("[")) {
    console.log("Skipping post-request for: " + pm.info.requestName);
    return;
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


    const exemptedFieldsStr = pm.collectionVariables.get("exempted_fields");
    const exemptedFields = exemptedFieldsStr ? JSON.parse(exemptedFieldsStr) : [];

    // ===== NEW: ENHANCED XPATH-STYLE EXEMPTION CHECKER =====
    function isTagExempted(tag, exemptedPatterns) {
        if (!tag || !exemptedPatterns || exemptedPatterns.length === 0) return false;
        
        // Remove namespace prefix (e.g., "soap:Envelope" -> "Envelope")
        const cleanTag = tag.replace(/\w+:/g, '');
        
        for (let i = 0; i < exemptedPatterns.length; i++) {
            const pattern = exemptedPatterns[i].trim();
            
            // Pattern 1: Descendant selector // (matches tag anywhere)
            if (pattern.startsWith('//')) {
                const elementName = pattern.substring(2);
                if (cleanTag === elementName || cleanTag.indexOf(elementName) !== -1) {
                    return true;
                }
            }
            // Pattern 2: Wildcard pattern (contains *)
            else if (pattern.indexOf('*') !== -1) {
                const regexPattern = '^' + pattern.replace(/\*/g, '.*') + '$';
                if (new RegExp(regexPattern).test(cleanTag)) {
                    return true;
                }
            }
            // Pattern 3: Simple tag name match
            else {
                if (cleanTag === pattern || cleanTag.indexOf(pattern) !== -1) {
                    return true;
                }
            }
        }
        return false;
    }


    // HTML escape function
    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }


    // Parse XML to simple tree structure
    function parseXML(xmlString) {
        const lines = [];
        const cleanXml = xmlString.trim();
        
        // Remove XML declaration
        let xml = cleanXml.replace(/<\?xml[^>]*\?>/g, '');
        
        let indent = 0;
        let pos = 0;
        
        while (pos < xml.length) {
            const tagStart = xml.indexOf('<', pos);
            if (tagStart === -1) break;
            
            const tagEnd = xml.indexOf('>', tagStart);
            if (tagEnd === -1) break;
            
            const tag = xml.substring(tagStart, tagEnd + 1);
            
            // Skip comments
            if (tag.startsWith('<!--')) {
                pos = tagEnd + 1;
                continue;
            }
            
            // Closing tag
            if (tag.startsWith('</')) {
                // Check if this should be merged with opening tag
                if (lines.length > 0 && lines[lines.length - 1].type === 'open' && !lines[lines.length - 1].merged) {
                    // Merge with previous opening tag
                    const lastLine = lines[lines.length - 1];
                    lastLine.text = lastLine.text + (lastLine.content || '') + tag;
                    lastLine.merged = true;
                    pos = tagEnd + 1;
                } else {
                    indent--;
                    const tagName = tag.substring(2, tag.length - 1).trim();
                    lines.push({
                        text: tag,
                        indent: indent,
                        type: 'close',
                        tag: tagName
                    });
                    pos = tagEnd + 1;
                }
            }
            // Self-closing tag
            else if (tag.endsWith('/>')) {
                const tagContent = tag.substring(1, tag.length - 2).trim();
                const spacePos = tagContent.indexOf(' ');
                const tagName = spacePos > 0 ? tagContent.substring(0, spacePos) : tagContent;
                lines.push({
                    text: tag,
                    indent: indent,
                    type: 'self-close',
                    tag: tagName
                });
                pos = tagEnd + 1;
            }
            // Opening tag
            else {
                const tagContent = tag.substring(1, tag.length - 1).trim();
                const spacePos = tagContent.indexOf(' ');
                const tagName = spacePos > 0 ? tagContent.substring(0, spacePos) : tagContent;
                
                // Check for text content (no nested tags)
                const nextTagStart = xml.indexOf('<', tagEnd + 1);
                let textContent = '';
                let hasNestedTags = false;
                
                if (nextTagStart > tagEnd + 1) {
                    textContent = xml.substring(tagEnd + 1, nextTagStart).trim();
                    
                    // Check if next tag is a closing tag for this element
                    const nextTag = xml.substring(nextTagStart, xml.indexOf('>', nextTagStart) + 1);
                    if (nextTag === '</' + tagName + '>') {
                        // Simple element with text content only - will be merged
                        hasNestedTags = false;
                    } else if (nextTag.startsWith('</')) {
                        // Closing tag but for different element - has nested structure
                        hasNestedTags = false;
                    } else {
                        // Another opening tag - has nested structure
                        hasNestedTags = true;
                    }
                }
                
                lines.push({
                    text: tag,
                    indent: indent,
                    type: 'open',
                    tag: tagName,
                    content: textContent,
                    hasNested: hasNestedTags,
                    merged: false
                });
                
                if (hasNestedTags || !textContent) {
                    indent++;
                }
                pos = tagEnd + 1;
            }
        }
        
        return lines;
    }



    const boomiLines = parseXML(boomiResponseRaw);
    const muleLines = parseXML(mulesoftResponseRaw);


    console.log("Boomi lines: " + boomiLines.length);
    console.log("Mule lines: " + muleLines.length);


    // Align XML lines
    function alignXMLLines(leftLines, rightLines) {
        const aligned = [];
        let leftIdx = 0;
        let rightIdx = 0;
        
        while (leftIdx < leftLines.length || rightIdx < rightLines.length) {
            const left = leftLines[leftIdx];
            const right = rightLines[rightIdx];
            
            if (!left && right) {
                aligned.push({ boomi: { text: '', indent: right.indent, isEmpty: true }, mule: right, status: 'only_mule' });
                rightIdx++;
            } else if (left && !right) {
                aligned.push({ boomi: left, mule: { text: '', indent: left.indent, isEmpty: true }, status: 'only_boomi' });
                leftIdx++;
            } else if (left.tag === right.tag && left.type === right.type) {
                let status = 'match';
                if (left.text !== right.text) {
                    status = 'mismatch';
                }
                aligned.push({ boomi: left, mule: right, status: status });
                leftIdx++;
                rightIdx++;
            } else {
                // Tag mismatch - check if tag exists ahead
                let foundRight = false;
                for (let i = rightIdx + 1; i < Math.min(rightIdx + 10, rightLines.length); i++) {
                    if (rightLines[i].tag === left.tag) {
                        foundRight = true;
                        break;
                    }
                }
                
                if (!foundRight) {
                    aligned.push({ boomi: left, mule: { text: '', indent: left.indent, isEmpty: true }, status: 'only_boomi' });
                    leftIdx++;
                } else {
                    aligned.push({ boomi: { text: '', indent: right.indent, isEmpty: true }, mule: right, status: 'only_mule' });
                    rightIdx++;
                }
            }
        }
        
        return aligned;
    }


    const aligned = alignXMLLines(boomiLines, muleLines);


    console.log("Aligned lines: " + aligned.length);


    // Calculate stats
    let totalMismatches = 0;
    let totalExempted = 0;


    aligned.forEach(function(pair) {
        const tag = pair.boomi.tag || pair.mule.tag;
        let isExempted = false;
        
        // ===== MODIFIED: ENHANCED EXEMPTION CHECK (ONLY CHANGE) =====
        if (tag) {
            if (isTagExempted(tag, exemptedFields)) {
                pair.status = 'exempted';
                isExempted = true;
                totalExempted++;
            }
        }
        
        if (!isExempted && (pair.status === 'mismatch' || pair.status === 'only_boomi' || pair.status === 'only_mule')) {
            totalMismatches++;
        }
    });


    const totalLines = aligned.length;
    const matchPercentage = totalLines > 0 ? Math.round(((totalLines - totalMismatches - totalExempted) / totalLines) * 100) : 100;
    const statusText = totalMismatches > 0 ? 'FAILED' : 'PASSED';


    console.log("XML Comparison: " + totalMismatches + " mismatches, " + totalExempted + " exempted");


    // Tests
    pm.test("Boomi SOAP API responded", () => pm.expect(boomiStatus).to.be.oneOf([200, 201, 202, 204, 500]));
    pm.test("MuleSoft SOAP API responded", () => pm.expect(pm.response.code).to.be.oneOf([200, 201, 202, 204, 500]));
    pm.test("All non-exempted XML elements match", () => pm.expect(totalMismatches).to.equal(0));


    // Store report
    function minifyXML(xml) {
        if (!xml) return "";
        return xml.trim().replace(/\s+/g, ' ').replace(/>\s+</g, '><');
    }


    const statsObj = {
        totalLines: totalLines,
        matchedLines: totalLines - totalMismatches - totalExempted,
        mismatchedLines: totalMismatches,
        exemptedLines: totalExempted,
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
        boomiResponse: minifyXML(boomiResponseRaw),
        mulesoftResponse: minifyXML(mulesoftResponseRaw),
        statistics: statsObj
    };


    pm.collectionVariables.set("report_data_" + reportIndex.padStart(3, '0'), JSON.stringify(reportEntry));
    pm.collectionVariables.set("temp_request_name", "");
    pm.collectionVariables.set("temp_request_curl", "");


    // Visualizer for individual execution
    if (isIndividualExecution) {
        console.log("Rendering XML visualizer");
        
        let tableRows = aligned.map(function(pair) {
            const bLine = pair.boomi;
            const mLine = pair.mule;
            const status = pair.status;
            
            const bIndent = bLine.indent * 20;
            const mIndent = mLine.indent * 20;
            
            // HTML escape the text
            const bText = bLine.isEmpty ? '' : escapeHtml(bLine.text);
            const mText = mLine.isEmpty ? '' : escapeHtml(mLine.text);
            
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
td{padding:4px 8px;border-bottom:1px solid #ecf0f1;border-right:1px solid #ecf0f1;font-family:Consolas,Monaco,monospace;font-size:11px;vertical-align:top;word-wrap:break-word;white-space:pre-wrap;line-height:1.4;color:#333}
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
<h2>XML/SOAP Response Comparison: ${escapeHtml(requestName)}</h2>
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
<thead><tr><th>Boomi XML</th><th></th><th>MuleSoft XML</th></tr></thead>
<tbody>${tableRows}</tbody>
</table>
</div>
<div class="signature">S. 2025</div>
</body>
</html>`;
        
        pm.visualizer.set(html);
        console.log("XML Visualizer rendered with " + aligned.length + " rows");
    }
}
