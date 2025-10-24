┌─────────────────────────────────────────────────┐
│ User clicks "Send" on MuleSoft Request          │
└───────────────┬─────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────┐
│ Collection Pre-request Script Runs              │
│                                                 │
│ 1. Extracts MuleSoft request details            │
│    - Method (GET/POST/PUT/DELETE)               │
│    - URL & Query params                         │
│    - Headers                                    │
│    - Body (if applicable)                       │
│                                                 │
│ 2. Transforms URL (removes app-env-name)        │
│                                                 │
│ 3. Calls pm.sendRequest() with:                 │
│    - Boomi URL                                  │
│    - Same method                                │
│    - Copied headers                             │
│    - Copied body                                │
│                                                 │
│ 4. Stores Boomi response in collection var      │
└───────────────┬─────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────┐
│ MuleSoft Request Executes                       │
│ (Your actual Postman request)                   │
└───────────────┬─────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────┐
│ Collection Tests Script Runs                    │
│                                                 │
│ 1. Retrieves Boomi response from collection var │
│ 2. Gets MuleSoft response                       │
│ 3. Compares line-by-line                        │
│ 4. Displays visualization                       │
└─────────────────────────────────────────────────┘