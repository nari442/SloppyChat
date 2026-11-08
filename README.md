# Sloppy Chat

![Sloppy Chat logo](src/assets/sloppychat.svg)

Sloppy is an end-to-end encrypted chat platform. Messages and images are encrypted in your browser with AES-256-GCM; message keys are wrapped using ECDH P-256 and HKDF-SHA-256, and messages are signed with ECDSA P-256. Supabase provides account sessions, encrypted message routing, trusted-device approvals, and private storage for encrypted images.

Free to use, modify, and redistribute under the [MIT License](LICENSE). Source code: [github.com/nari442/SloppyChat](https://github.com/nari442/SloppyChat).

[![React](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20Postgres-3fcf8e?logo=supabase&logoColor=white)](https://supabase.com/)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## How It Works

1. Create an account with a generated 12-character handle, a strong password, and an optional preferred name. The preferred name defaults to the handle.
2. Approve each new browser from an existing trusted device.
3. Accept message requests before opening direct conversations; verify safety codes before sending.
4. Messages are encrypted and signed in the browser. Image files are encrypted before upload to a private Storage bucket.
5. Manage theme, notifications, blocked users, devices, and conversation history from the app.

Share a direct-chat link in the form `https://your-domain.example/ccq42t7rpzea`. Opening it after sign-in pre-fills the request composer; the sender chooses and confirms the first message before sending.

```mermaid
flowchart LR
  A[Your browser] -->|Encrypt and sign| B[Supabase Auth]
  A -->|Ciphertext and routing| C[(Postgres with RLS)]
  A -->|Encrypted image bytes| D[Private Storage]
  C -->|Ciphertext| E[Other trusted browser]
  D -->|Encrypted bytes| E
  E -->|Verify and decrypt locally| F[Readable message]
```

## Requirements

- Node.js 22.12 or newer and npm.
- A Supabase project with Auth, Postgres, Realtime, and Storage enabled.
- Email confirmation disabled for password-only registration. Handles map to synthetic `@auth.sloppy.chat` aliases; these are not real email addresses.

## Local Development

```sh
npm install
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in your local environment or hosting provider. Use only the Supabase publishable/anon key in browser configuration. Never use a service-role key in a `VITE_` variable.

For an existing deployment, run `database/005_display_names.sql` once in the Supabase SQL Editor. It adds preferred names to profiles and creates the owner-checked RPC used by Settings. Refresh the PostgREST schema after execution if prompted.

The app also requires the existing Sloppy Supabase schema, Auth settings, Realtime publication, and private encrypted-image bucket. This repository does not include the original database bootstrap files.

## Security Notes

- Message text and attachment keys are encrypted and signed in the browser. Supabase stores ciphertext, encrypted image blobs, and the metadata needed to route conversations.
- Conversation membership, blocking, device approval, and Storage access are guarded by RLS and database functions. Apply all migrations before exposing the app.
- Browser notifications contain no message text and are opt-in. The preference is stored per browser. The app does not implement background push.
- A compromised browser, malicious browser extension, or injected script can access plaintext while Sloppy is open. End-to-end encryption does not protect a compromised client.
- The local signing key is held in the browser's IndexedDB vault. Losing all approved devices can make the account's existing encrypted history inaccessible; there is no email recovery path.
- Conversation participants, timestamps, message sizes, and routing metadata are visible to the Supabase project. Blocking prevents app-level access but cannot retract data already copied by another participant.
- Review Supabase Auth settings, database policies, Edge Function secrets, and deployment logs before publishing a project.

## Account and Conversation Controls

Settings include system/light/dark appearance, password changes, browser-notification preferences, blocked-user management, and trusted-device/message-request approvals.

Conversation actions include local renaming, hiding a conversation from your list, clearing your visible history, blocking participants, and deleting a direct conversation for both participants. Group history cannot be deleted for everyone by a single member.

Images are limited to 2 MB per original file. Only PNG, JPEG, WebP, GIF, and AVIF are accepted; SVG is rejected. Image bytes are encrypted before upload and decrypted only in the browser.

## Checks

```sh
npm test
npm run lint
npm run build
```

## Deployment

Build with `npm run build` and publish the generated `dist/` directory to a static host. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the host's build environment. Configure the host to serve `index.html` for a single 12-character handle path so `/ccq42t7rpzea` reaches the client router.

## License

Sloppy Chat is released under the [MIT License](LICENSE). You may use, modify, distribute, sublicense, and sell copies subject to its terms.
