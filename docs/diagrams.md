# CodeVault diagrams

## Context-level data flow

```mermaid
flowchart LR
 Student[Student / Team] -->|Account and repository requests| CV[CodeVault]
 CV -->|Files, Git history and activity| Student
 CV <--> DB[(MongoDB metadata)]
 CV <--> GIT[(Git repository storage)]
 Operator[Deployment operator] -->|Environment and persistent volume| Hosting[Render / Vercel]
 Hosting --> CV
```

## Level-1 data flow

```mermaid
flowchart TD
 Client[React client] --> Auth[HTTP-only session middleware]
 Auth -->|Invalid| E401[401 response]
 Auth --> Validate[Zod payload validation]
 Validate --> Access[Repository role check]
 Access -->|Denied| E403[403 or hidden-resource 404]
 Access --> Routes[Route controller]
 Routes <--> Models[Mongoose models]
 Models <--> DB[(MongoDB)]
 Routes <--> Git[Git service]
 Git <--> Disk[(Persistent Git disk)]
 Routes --> Audit[Activity records]
 Audit --> DB
 Routes --> Client
```

## Create repository sequence

```mermaid
sequenceDiagram
 actor Dev as Developer
 participant UI as React
 participant API as Express
 participant DB as MongoDB
 participant Git as Native Git
 Dev->>UI: Submit repository settings
 UI->>API: POST /api/repositories
 API->>API: Validate session and payload
 API->>DB: Check owner/name uniqueness
 API->>Git: Init repository and create first commit
 Git-->>API: Initial commit SHA
 API->>DB: Save repository metadata
 API->>DB: Record activity
 API-->>UI: 201 Created
 UI-->>Dev: Open repository page
```

## Pull-request review and merge sequence

```mermaid
sequenceDiagram
 actor Author
 actor Reviewer
 participant UI as React
 participant API as Express
 participant DB as MongoDB
 participant Git as Git service
 Author->>UI: Create PR from feature to main
 UI->>API: POST /api/pull-requests
 API->>DB: Save PR and activity record
 Reviewer->>UI: Submit approval or change request
 UI->>API: POST /api/pull-requests/:id/reviews
 API->>DB: Upsert reviewer decision
 Author->>UI: Request merge
 UI->>API: POST /api/pull-requests/:id/merge
 API->>DB: Check maintainer role and approval gate
 API->>Git: Preview merge and compare target head
 Git-->>API: Conflict result / mergeable state
 API->>Git: Merge source into target
 Git-->>API: New commit SHA
 API->>DB: Mark PR merged, save SHA, record activity
 API-->>UI: Merged PR
```

## Entity relationships

```mermaid
erDiagram
 USER ||--o{ REPOSITORY : owns
 USER ||--o{ COLLABORATOR : member
 REPOSITORY ||--o{ COLLABORATOR : grants
 REPOSITORY ||--o{ ISSUE : tracks
 REPOSITORY ||--o{ PULL_REQUEST : reviews
 USER ||--o{ PULL_REQUEST : authors
 PULL_REQUEST ||--o{ REVIEW : receives
 USER ||--o{ REVIEW : submits
 USER ||--o{ ACTIVITY : performs
 REPOSITORY o|--o{ ACTIVITY : context
```

## Permission decision flow

```mermaid
flowchart TD
 Req[Protected request] --> Session{Valid session?}
 Session -->|No| NoAuth[401]
 Session -->|Yes| Repo{Repository found?}
 Repo -->|No| Hide[404]
 Repo -->|Yes| Owner{Owner?}
 Owner -->|Yes| Allow[Evaluate action]
 Owner -->|No| Member{Accepted collaborator?}
 Member -->|No and private| Hide
 Member -->|No and public read| Read[Read-only public access]
 Member -->|Yes| Role{Role allows action?}
 Role -->|No| Deny[403]
 Role -->|Yes| Allow
```
