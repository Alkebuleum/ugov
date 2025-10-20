
## Firebase setup

1) Create a Firebase project and enable **Firestore** and **Functions**.
2) Copy `.env.sample` to `.env.local` and fill in your config.
3) (Optional) Use emulators:
   - Set `VITE_USE_EMULATORS=true`
   - From `firebase/functions`, run `npm i && npm run serve`

### Firestore data model
- `proposals/{id}`
  - `title` (string)
  - `bodyMd` (string, **Markdown/GFM**)
  - `status` ('Submitted' | 'Active' | 'Deciding' | 'Rejected')
  - `author` { name, address?, avatar }
  - `createdAt` (timestamp)
  - `counters` { comments, votes }
  - `amount` (string | null)
- `comments/{id}` (optional per-proposal subcollection in future)

### Content strategy
- Store **Markdown** in `bodyMd`; render with `react-markdown` + `remark-gfm` with **sanitize**.
- For images or attachments, upload to Firebase **Storage** and embed links in markdown.

### Writes
- The client currently writes via `createProposal()` that **directly** adds docs to Firestore for easy demo.
- For production, use the callable function `createProposal` and add AmVault signature verification in `functions/src/index.ts`.
