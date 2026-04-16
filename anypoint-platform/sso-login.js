// --- 1. INITIAL SESSION CHECK ---
console.log("🚀 Starting SSO Token Bridge...");
console.log("📡 Current Postman Version: " + pm.info.version);

if (pm.response.code === 401 || pm.response.code === 403) {
    console.warn("⚠️ No active session found. Showing Login Bridge UI.");
    
    const ssoUrl = "https://anypoint.mulesoft.com/accounts/login";

    const template = `
    <div style="text-align:center; padding:40px; font-family: 'Roboto', sans-serif; background: #FEF7FF; height:100vh;">
        <span class="material-icons" style="font-size:64px; color:#6750A4;">security</span>
        <h2 style="color:#1C1B1F; margin:16px 0;">SSO Authentication</h2>
        <div style="background:white; border:1px solid #CAC4D0; border-radius:12px; padding:20px; margin-top:10px;">
            <p style="font-size:13px; color:#666; margin-bottom:15px;">Paste URL in Chrome, Log in, then hit SEND.</p>
            <button id="copyBtn" style="background:#6750A4; color:white; padding:12px 24px; border-radius:12px; border:none; font-weight:500; width:100%; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
               <span class="material-icons" style="font-size:18px;">content_copy</span> COPY LOGIN URL
            </button>
            <p id="snackbar" style="font-size:11px; color:#2E7D32; font-weight:bold; margin-top:8px; visibility:hidden;">COPIED!</p>
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
            setTimeout(() => { document.getElementById('snackbar').style.visibility = 'hidden'; }, 2000);
        });
    </script>
    `;
    pm.visualizer.set(template);

} else {
    console.log("✅ Cookie detected! (Profile API returned 200)");
    
    // --- 2. THE EXCHANGE (COOKIE -> BEARER) ---
    console.log("🔄 Exchanging Cookie for Bearer Token...");
    
    pm.sendRequest({
        url: 'https://anypoint.mulesoft.com/accounts/login',
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        body: { mode: 'raw', raw: JSON.stringify({}) }
    }, (err, res) => {
        if (err) {
            console.error("❌ Network Error during Exchange:", err);
            return;
        }
        
        if (res.code === 200) {
            const token = res.json().access_token;
            pm.collectionVariables.set("token", token);
            
            console.log("🎯 SUCCESS: Bearer Token Captured!");
            console.log("📦 Saved to Variable: {{token}}");
            
            pm.visualizer.set(`
                <div style="text-align:center; padding:40px; font-family: 'Roboto', sans-serif;">
                    <span class="material-icons" style="font-size:64px; color:#2E7D32;">check_circle</span>
                    <h2>Bridge Connected</h2>
                    <p>Bearer token captured and saved.</p>
                </div>
                <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
            `);
        } else {
            console.error("❌ Exchange Failed. Status Code: " + res.code);
            console.log("💡 Debug Tip: Go to Cookies -> Allowlist and ensure 'mulesoft.com' is present.");
            pm.visualizer.set("<h3>Token Exchange Failed. Check Console for details.</h3>");
        }
    });
}
