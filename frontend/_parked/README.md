# Parked pages

Screens from the original design prototype for features Craton doesn't have yet. They drew made-up
data, so they were taken out of the app (and out of type-checking, see `tsconfig.json`) rather than
shown to people as if they worked. Each moves back under `app/` once its backend exists.

| Page | Needs |
| --- | --- |
| `[owner]/followers`, `[owner]/following` | Follow graph in the API |
| `[owner]/[repo]/wiki` (+ `components/wiki-view.tsx`) | Wiki storage and editing |
| `[owner]/[repo]/fork` | Forks (a repository copy that shares chunks) |
| `[owner]/[repo]/settings/collaborators` | Per-repository collaborators for personal repos |
| `orgs/[org]/teams` | Teams inside organizations |
| `orgs/[org]/billing` | Paid plans and invoices |
| `settings/ssh-keys` | SSH transport for the CLI |
