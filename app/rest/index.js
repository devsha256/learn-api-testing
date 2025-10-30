const express = require('express');
const app = express();
const PORT = 8000;

// Middleware to parse JSON bodies in POST requests
app.use(express.json());
const error = {
  "errordetails": [{
    "code": "E",
    "message": "Invalid token at url at position 14."
  }]
}
const user1 = {
    "login": "devsha256",
    "id": 136232364,
    "node_id": "U_kgDOCB69rA",
    "isActive": true,
    "avatar_url": "https://avatars.githubusercontent.com/u/136232364?v=4",
    "gravatar_id": "",
    "url": "https://api.github.com/users/devsha256",
    "html_url": "https://github.com/devsha256",
    "followers_url": "https://api.github.com/users/devsha256/followers",
    "following_url": "https://api.github.com/users/devsha256/following{/other_user}",
    "gists_url": "https://api.github.com/users/devsha256/gists{/gist_id}",
    "starred_url": "https://api.github.com/users/devsha256/starred{/owner}{/repo}",
    "subscriptions_url": "https://api.github.com/users/devsha256/subscriptions",
    "organizations_url": "https://api.github.com/users/devsha256/orgs",
    "repos_url": "https://api.github.com/users/devsha256/repos",
    "events_url": "https://api.github.com/users/devsha256/events{/privacy}",
    "received_events_url": "https://api.github.com/users/devsha256/received_events",
    "type": "Admin",
    "user_view_type": "public",
    "site_admin": false,
    "name": "saddam hossain",
    "company": null,
    "blog": "https://devsha256.github.io",
    "location": "Kolkata, India",
    "email": null,
    "hireable": null,
    "bio": "I am a \"Go, get it!\" kind of person, who is also a Mulesoft Certified Developer (Level 1 & 2) \r\nMulesoft Certified Platform Architect.\r\nI work <TBD>\r\nI Use: DataWeave, Javascript, Java & Python",
    "twitter_username": null,
    "public_repos": 8,
    "public_gists": 0,
    "followers": 0,
    "following": 2,
    "created_at": "2023-06-11T09:23:40Z",
    "updated_at": "2025-10-21T08:39:14Z"
}

const user2 = {
    "login": "devsha256",
    "id": 136232364,
    "node_id": "U_kgDOCB69rA",
    "avatar_url": "https://avatars.githubusercontent.com/u/136232364?v=4",
    "gravatar_id": "",
    "url": "https://api.github.com/users/devsha256",
    "html_url": "https://github.com/devsha256",
    "followers_url": "https://api.github.com/users/devsha256/followers",
    "following_url": "https://api.github.com/users/devsha256/following{/other_user}",
    "gists_url": "https://api.github.com/users/devsha256/gists{/gist_id}",
    "starred_url": "https://api.github.com/users/devsha256/starred{/owner}{/repo}",
    "subscriptions_url": "https://api.github.com/users/devsha256/subscriptions",
    "organizations_url": "https://api.github.com/users/devsha256/orgs",
    "repos_url": "https://api.github.com/users/devsha256/repos",
    "events_url": "https://api.github.com/users/devsha256/events{/privacy}",
    "received_events_url": "https://api.github.com/users/devsha256/received_events",
    "type": "User",
    "user_view_type": "public",
    "site_admin": false,
    "name": "saddam hossain",
    "company": null,
    "blog": "https://devsha256.github.io",
    "location": "Kolkata, India",
    "email": "test@gmail.com",
    "hireable": null,
    "bio": "I am Mulesoft Certified Developer (Level 1 & 2) \r\nMulesoft Certified Platform Architect.\r\nI work <TBD>\r\nI Use: DataWeave, Javascript, Java & Python",
    "twitter_username": null,
    "public_repos": 8,
    "public_gists": 0,
    "followers": 0,
    "following": 2,
    "created_at": "2023-06-11T09:23:40Z",
    "last_updated": "2025-10-21T08:39:14Z"
}


// GET /users/:userId - fetches from GitHub API
app.get('/ws/rest/users/:userId', async (req, res) => {
  const userId = req.params.userId;
  
  try {
    // Note: 'fetch' is usually available in modern Node.js environments
    // const response = await fetch(`https://api.github.com/users/${userId}`, {
    //   headers: {
    //     'User-Agent': 'Express-App'
    //   }
    // });
    
    // if (!response.ok) {
    //   return res.status(response.status).json({ 
    //     error: 'User not found or API error' 
    //   });
    // }
    
    // const userData = await response.json();
    // res.json(userData);
    res.json(user1);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch user data',
      message: error.message 
    });
  }
});

// GET /app/users/:userId - fetches from GitHub API
app.get('/app/ws/rest/users/:userId', async (req, res) => {
  const userId = req.params.userId;
  
  try {
  //   const response = await fetch(`https://api.github.com/users/${userId}`, {
  //     headers: {
  //       'User-Agent': 'Express-App'
  //     }
  //   });
    
  //   if (!response.ok) {
  //     return res.status(response.status).json({ 
  //       error: 'User not found or API error' 
  //     });
  //   }
    
  //   const userData = await response.json();
  //   res.json(userData);
  res.json(user2);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch user data',
      message: error.message 
    });
  }
});

// --- NEW ENDPOINTS ADDED BELOW ---

// POST /app/user - Creates a new user resource
app.post('/app/ws/rest/user', (req, res) => {
    const correlationId = req.header('x-correlation-id');
    const userPayload = req.body; // JSON body is available here

    console.log(`[POST /app/user] Correlation ID: ${correlationId}`);
    console.log(`[POST /app/user] Received Payload:`, userPayload);

    // Dummy logic: Assume the user creation was successful
    if (!userPayload || !userPayload.username) {
        return res.status(400).json({
            status: 'Failed',
            message: 'Invalid request: username is required in the body.'
        });
    }
    
    res.status(201).json({
        status: 'Success',
        message: `User '${userPayload.username}' created successfully via /app/user. Correlation ID: ${correlationId}`
    });
});

// POST /user - Creates a new user resource
app.post('/ws/rest/user', (req, res) => {
    const correlationId = req.header('x-correlation-id');
    const userPayload = req.body;

    console.log(`[POST /user] Correlation ID: ${correlationId}`);
    console.log(`[POST /user] Received Payload:`, userPayload);

    // Dummy logic: Simulate a successful response
    if (!userPayload || !userPayload.email) {
        return res.status(400).json({
            status: 'Failed',
            message: 'Invalid request: email is required in the body.'
        });
    }

    res.status(201).json({
        status: 'Success',
        message: `User '${userPayload.username}' created successfully via /app/user. Correlation ID: ${correlationId}`
    });
});


// Start the server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});