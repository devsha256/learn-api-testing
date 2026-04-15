// --- 1. CHECK IF SESSION EXISTS ---
if (pm.response.code === 401 || pm.response.code === 403) {
    // User is NOT logged in. Show the Login Bridge UI.
    const loginUrl = "https://anypoint.mulesoft.com/accounts/login/YOUR_ORG_DOMAIN"; // Replace YOUR_ORG_DOMAIN
    
    const template = `
    <div style="text-align:center; padding:50px; font-family:Roboto,sans-serif;">
        <img src="https://vignette.wikia.nocookie.net/logopedia/images/2/21/MuleSoft_Logo.png" width="200">
        <h2>SSO Session Expired</h2>
        <p>Click below to log in via your company SSO. Once done, come back here and click "Refresh".</p>
        <a href="${loginUrl}" target="_blank" 
           style="background:#6750A4; color:white; padding:12px 24px; border-radius:12px; text-decoration:none; font-weight:bold; display:inline-block; margin-top:20px;">
           LOGIN TO ANYPOINT SSO
        </a>
        <br><br>
        <button onclick="window.location.reload()" style="cursor:pointer; background:none; border:1px solid #6750A4; color:#6750A4; padding:8px 16px; border-radius:8px;">
            I'm Logged In - Refresh
        </button>
    </div>
    `;
    pm.visualizer.set(template);
} else {
    // --- 2. USER IS LOGGED IN! ---
    // The browser session is active. Now we extract the bearer token.
    // Postman's internal browser (if Interceptor is on) or the cookie-sync 
    // allows us to see the profile.
    
    // We need the token. Often the profile API doesn't return the raw Bearer.
    // But we can trigger a hidden 'POST /login' which returns the token if the cookie is present.
    
    pm.sendRequest({
        url: 'https://anypoint.mulesoft.com/accounts/login',
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        body: { mode: 'raw', raw: JSON.stringify({}) } // Sending empty body with active cookie
    }, (err, res) => {
        if (!err && res.json().access_token) {
            const token = res.json().access_token;
            pm.collectionVariables.set("token", token);
            
            pm.visualizer.set(\`
                <div style="color:green; text-align:center; padding:20px;">
                    <i class="material-icons" style="font-size:48px;">check_circle</i>
                    <h2>Token Captured!</h2>
                    <p>Bearer token has been saved to your collection variables.</p>
                    <code style="background:#eee; padding:5px;">\${token.substring(0,10)}...</code>
                </div>
            \`);
        }
    });
}
