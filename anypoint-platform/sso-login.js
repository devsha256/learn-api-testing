console.log("🚀 SSO Bridge: Initiating Deep Scan...");

// Helper to check what we are actually sending
const requestCookies = pm.request.headers.get("Cookie");
console.log("📡 Outgoing Cookie String: " + (requestCookies ? "Found (Hidden for safety)" : "Empty"));

if (pm.response.code === 401 || pm.response.code === 403) {
    console.warn("⚠️ Anypoint rejected the current cookies (401).");
    
    // UI logic remains the same (Bulletproof Copy)
    const ssoUrl = "https://anypoint.mulesoft.com/accounts/login";
    const template = `
    <div style="text-align:center; padding:40px; font-family: 'Roboto', sans-serif; background: #FEF7FF; height:100vh;">
        <span class="material-icons" style="font-size:64px; color:#6750A4;">security</span>
        <h2 style="color:#1C1B1F; margin:16px 0;">Session Rejected</h2>
        <div style="background:white; border:1px solid #CAC4D0; border-radius:12px; padding:20px; margin-top:10px;">
            <p style="font-size:13px; color:#666; margin-bottom:15px;">Your Chrome session isn't syncing yet.</p>
            <button id="copyBtn" style="background:#6750A4; color:white; padding:12px 24px; border-radius:12px; border:none; font-weight:500; width:100%; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
               <span class="material-icons" style="font-size:18px;">content_copy</span> COPY LOGIN URL
            </button>
            <p id="snackbar" style="font-size:11px; color:#2E7D32; font-weight:bold; margin-top:8px; visibility:hidden;">COPIED!</p>
        </div>
        <div style="margin-top:20px; font-size:12px; color:#49454F; line-height:1.6;">
            1. <b>Close all Anypoint tabs</b> in Chrome.<br>
            2. Paste URL and <b>Log in fresh</b>.<br>
            3. Return to Postman and hit <b>SEND</b>.
        </div>
        <textarea id="fallback" style="position:fixed; left:-9999px;">${ssoUrl}</textarea>
    </div>
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <script>
        document.getElementById('copyBtn').addEventListener('click', () => {
            const ta = document.getElementById('fallback');
            ta.select(); document.execCommand('copy');
            document.getElementById('snackbar').style.visibility = 'visible';
            setTimeout(() => { document.getElementById('snackbar').style.visibility = 'hidden'; }, 2000);
        });
    </script>`;
    pm.visualizer.set(template);

} else if (pm.response.code === 200) {
    console.log("✅ Session Valid! Attempting Exchange...");

    pm.sendRequest({
        url: 'https://anypoint.mulesoft.com/accounts/login',
        method: 'POST',
        header: { 
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest' // Tells AMC this is a programmatic AJAX call
        },
        body: { mode: 'raw', raw: JSON.stringify({}) }
    }, (err, res) => {
        if (!err && res.code === 200) {
            const token = res.json().access_token;
            pm.collectionVariables.set("token", token);
            console.log("🎯 SUCCESS! Token captured.");
            pm.visualizer.set(\`<div style="text-align:center; padding:40px;"><h2 style="color:#2E7D32;">Bridge Connected!</h2></div>\`);
        } else {
            console.error("❌ Exchange Failed. Code: " + res.code);
            console.log("Response Body:", res.text());
        }
    });
}
