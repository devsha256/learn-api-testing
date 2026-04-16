// --- DEBUG LOGGING ---
console.log("🚀 SSO Bridge: Checking for session cookies...");

// Helper to check if cookies are present in the request
const hasCookies = pm.request.headers.get("Cookie");
if (hasCookies) {
    console.log("🍪 Cookies detected in outgoing request headers!");
} else {
    console.warn("🚫 NO COOKIES found in request. Postman is not sniffing Chrome yet.");
}

if (pm.response.code === 401 || pm.response.code === 403) {
    console.warn("⚠️ Anypoint returned 401. Showing Login UI.");
    
    // Replace YOUR-ORG with your vanity domain if you use one
    const ssoUrl = "https://anypoint.mulesoft.com/accounts/login";

    const template = `
    <div style="text-align:center; padding:40px; font-family: 'Roboto', sans-serif; background: #FEF7FF; height:100vh;">
        <span class="material-icons" style="font-size:64px; color:#6750A4;">security</span>
        <h2 style="color:#1C1B1F; margin:16px 0;">SSO Authentication</h2>
        
        <div style="background:white; border:1px solid #CAC4D0; border-radius:12px; padding:20px; margin-top:10px;">
            <p style="font-size:13px; color:#666; margin-bottom:15px;">Login session not detected. Use the button below:</p>
            
            <button id="copyBtn" 
               style="background:#6750A4; color:white; padding:12px 24px; border-radius:12px; border:none; font-weight:500; width:100%; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
               <span class="material-icons" style="font-size:18px;">content_copy</span>
               COPY LOGIN URL
            </button>
            
            <p id="snackbar" style="font-size:11px; color:#2E7D32; font-weight:bold; margin-top:8px; visibility:hidden;">COPIED TO CLIPBOARD!</p>
        </div>
        
        <div style="margin-top:20px; font-size:12px; color:#49454F; line-height:1.6;">
            1. Paste URL in <b>Standard Chrome Tab</b> & Log in.<br>
            2. Return to Postman and click <b>SEND</b> again.<br>
            <br>
            <small style="color:#888;">Note: Incognito tabs will not work.</small>
        </div>

        <textarea id="fallback" style="position:fixed; left:-9999px;">${ssoUrl}</textarea>
    </div>
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    
    <script>
        document.getElementById('copyBtn').addEventListener('click', () => {
            const ta = document.getElementById('fallback');
            ta.select();
            document.execCommand('copy');
            document.getElementById('snackbar').style.visibility = 'visible';
            document.getElementById('copyBtn').style.background = '#2E7D32';
            setTimeout(() => { 
                document.getElementById('snackbar').style.visibility = 'hidden';
                document.getElementById('copyBtn').style.background = '#6750A4';
            }, 2000);
        });
    </script>
    `;
    pm.visualizer.set(template);

} else if (pm.response.code === 200) {
    console.log("✅ Success! Session verified. Exchanging for Bearer...");
    
    pm.sendRequest({
        url: 'https://anypoint.mulesoft.com/accounts/login',
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        body: { mode: 'raw', raw: JSON.stringify({}) }
    }, (err, res) => {
        if (!err && res.code === 200) {
            const token = res.json().access_token;
            pm.collectionVariables.set("token", token);
            console.log("🎯 Token saved to {{token}}");
            
            pm.visualizer.set(\`
                <div style="text-align:center; padding:40px; font-family: 'Roboto', sans-serif;">
                    <span class="material-icons" style="font-size:64px; color:#2E7D32;">check_circle</span>
                    <h2 style="color:#1C1B1F;">Bridge Connected</h2>
                    <p>Bearer token captured. You can now run the Audit script.</p>
                </div>
                <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
            \`);
        } else {
            console.error("❌ Token exchange failed even with 200 status.");
        }
    });
}
