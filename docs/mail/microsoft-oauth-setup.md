# Setting up Microsoft sign-in (Azure AD / Entra ID app registration)

## Current status

**Setup guide for a real, working prerequisite, not yet verified against a live tenant.** Microsoft sign-in is implemented end to end in this build — authorization, token exchange, refresh, and account connection all work — but it is off by default and stays off until you supply your own Microsoft Entra ID app registration. This app never ships a client ID in its source, and it can never sign anyone in on your behalf: you have to register your own application with Microsoft first, exactly as any desktop mail client that supports "Sign in with Microsoft" does. This article walks through that registration from nothing, then how to hand the result to this app. Nobody on this project has completed this walkthrough against a real Microsoft tenant yet, so one part of it — whether Microsoft's loopback redirect-URI matching accepts the exact URI this app sends — is flagged explicitly below as unverified. If you hit a redirect-URI error, the exact Microsoft error code is what this project needs to fix it.

## Behavior

What registering an app actually gives you: an **Application (client) ID**, a public, non-secret identifier that tells Microsoft's identity platform "a request claiming to be this app is allowed to ask a user to sign in." Nothing else. This app is a *public client* — a desktop application that cannot keep a secret confidential — so it authenticates using PKCE (Proof Key for Code Exchange) alone, never a client secret. You should not create one, and if you do, this app will never send it.

### Step 1 — Prerequisites

- A Microsoft account (a personal outlook.com/hotmail.com/live.com account, or a work/school account) that can access the [Azure portal](https://portal.azure.com) or [Microsoft Entra admin center](https://entra.microsoft.com).
- Any individual Microsoft account can normally register an application in its own Microsoft Entra ID directory without special administrator rights — this is a self-service feature enabled by default for most tenants. If your organization has disabled self-service app registration, you will need to ask an administrator to either register the app for you or grant you the "Application Developer" role.
- No Azure subscription or payment is required. App registration is free.

### Step 2 — Create the app registration

1. Go to [entra.microsoft.com](https://entra.microsoft.com) and sign in. (You can also reach the same page through [portal.azure.com](https://portal.azure.com) → search for "Microsoft Entra ID" → **App registrations** in the left sidebar.)
2. Select **App registrations**, then **+ New registration**.
3. **Name**: anything you like — it is shown to you and to anyone who signs in through it, but it does not need to match this project's name. For example, `Material Email (local)`.
4. **Supported account types**: choose **Accounts in any organizational directory and personal Microsoft accounts (e.g. Skype, Xbox)**. This is the option that lets both a personal Outlook.com/Hotmail account and a work/school Microsoft 365 account sign in through the same registration, and it corresponds to this app's default tenant setting of `common` (see Step 5).
   - If you only ever intend to connect one specific organization's mailboxes, you can instead choose **Accounts in this organizational directory only** and set `MATERIAL_EMAIL_MICROSOFT_TENANT` to your tenant ID or verified domain (Step 5) — but `common` is the simpler default and works for both account types.
5. **Redirect URI**: set the platform dropdown to **Mobile and desktop applications** (not "Web" and not "Single-page application" — those are for different application types and this app's PKCE/loopback flow will not work correctly registered under either). In the redirect URI box, Microsoft's own suggested list includes a checkbox for `http://localhost` — check that one. This is Microsoft's documented placeholder for a native/desktop app that receives its callback on a locally bound port chosen at runtime.
   - **What this app actually sends is `http://127.0.0.1:<port>/oauth/callback`**, where `<port>` is a fresh randomly assigned port on every sign-in attempt and the path is always exactly `/oauth/callback`. Whether Microsoft's `http://localhost` registration accepts that literal IP address and that path suffix, rather than only a bare `http://localhost:<port>` with no path, is the one thing this project has not verified against a real tenant. Register `http://localhost` as instructed above and try signing in (Step 6 below tells this app how). If it fails with a redirect-URI mismatch error (typically `AADSTS50011` or `AADSTS9002327`), that is exactly the information this project needs — see Failure modes below for how to report it.
6. Select **Register**.

### Step 3 — Copy the Application (client) ID

On the app's **Overview** page, copy the **Application (client) ID** — a GUID that looks like `12345678-90ab-cdef-1234-567890abcdef`. This is not a secret. It identifies your registration the way a return address identifies an envelope; it does not let anyone impersonate you or read your mail on its own. You will hand this value to Material Email in Step 5.

Do **not** open **Certificates & secrets** and create a client secret. A desktop application has no way to keep a secret confidential — anyone who has the installed app has the secret too — so Microsoft's own guidance for native/public clients is PKCE without a secret, which is exactly what this app does. If a secret exists on the registration, this app will never read or send it; it is simply unused.

### Step 4 — Add the IMAP/SMTP permissions

This app connects to Outlook/Exchange mailboxes using the same IMAP and SMTP protocols it uses for every other provider, not the Microsoft Graph API — so the permissions it needs are the legacy Exchange Online protocol scopes, not Graph mail scopes.

1. In your app registration, select **API permissions** → **+ Add a permission**.
2. Select **APIs my organization uses**, then search for and select **Office 365 Exchange Online**.
3. Choose **Delegated permissions**.
4. Search for and check:
   - `IMAP.AccessAsUser.All`
   - `SMTP.Send`
5. Select **Add permissions**.
6. Also confirm `offline_access` and `openid` are present under **Microsoft Graph** delegated permissions — most new registrations include these by default. `offline_access` is what lets Microsoft issue a refresh token at all; without it, this app's sign-in would work once and then be unable to reconnect once the short-lived access token expired, and it deliberately refuses to treat a token as connected without one (see Failure modes in [Accounts and connectivity](accounts-and-connectivity.md)).
7. If your organization requires administrator consent for these permissions (a padlock or "Not granted" label appears next to them), a Microsoft 365 administrator for that tenant will need to grant consent, either by selecting **Grant admin consent** here (if you have that role) or by asking your administrator to. A personal Microsoft account (outlook.com/hotmail.com) does not need admin consent — it consents for itself on first sign-in.

### Step 5 — Hand the client ID to Material Email

Set the `MATERIAL_EMAIL_MICROSOFT_CLIENT_ID` environment variable to the Application (client) ID you copied in Step 3, then start the app from an environment where that variable is set. Optionally set `MATERIAL_EMAIL_MICROSOFT_TENANT` if you chose a single-organization registration in Step 2 (leave it unset, or set it to `common`, for the recommended multi-account registration).

**PowerShell, for the current session only:**

```powershell
$env:MATERIAL_EMAIL_MICROSOFT_CLIENT_ID = "12345678-90ab-cdef-1234-567890abcdef"
```

Then launch the app from that same PowerShell window.

**PowerShell, permanently for your Windows user account** (takes effect in new terminal sessions and app launches after this runs; you do not need to run this as Administrator):

```powershell
[Environment]::SetEnvironmentVariable("MATERIAL_EMAIL_MICROSOFT_CLIENT_ID", "12345678-90ab-cdef-1234-567890abcdef", "User")
```

**Via Windows Settings**, if you prefer a graphical path: open **Settings → System → About → Advanced system settings → Environment Variables**, and add `MATERIAL_EMAIL_MICROSOFT_CLIENT_ID` under your user's variables with the client ID as its value. Sign out and back in, or restart, for it to take effect everywhere.

Never commit this value to source control, paste it into a chat log expecting it to stay private, or share it publicly — while it is not a secret in the cryptographic sense (nothing can be extracted from it alone), it is still specific to your registration, and there is no reason to publish it.

### Step 6 — Sign in

Open Material Email, go to **Settings → Mail accounts → Add account**, choose **OAuth 2 browser foundation** as the authentication mode, and select **Microsoft** as the provider. The app should now report Microsoft as **configured** rather than **not configured**, and the **Start browser authorization** button should be enabled. Select it, complete sign-in in your default browser when it opens, and return to the app — it should report **Signed in**. Fill in the account's display name, email address, and IMAP/SMTP server settings (`outlook.office365.com:993` TLS for incoming, `smtp.office365.com:587` STARTTLS for outgoing are Microsoft's standard values), then **Test settings** or **Connect account**.

## Configuration

| Environment variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MATERIAL_EMAIL_MICROSOFT_CLIENT_ID` | Yes, to enable Microsoft sign-in at all | unset (Microsoft stays disabled) | The Application (client) ID from Step 3 |
| `MATERIAL_EMAIL_MICROSOFT_TENANT` | No | `common` | `common` (personal + work/school), `organizations` (work/school only), `consumers` (personal only), or a specific tenant ID/verified domain |

Both are read once, at application startup, from the process environment. Changing either requires restarting the app. A malformed value (anything containing whitespace, control characters, or characters outside a plain tenant identifier) is reported clearly and disables Microsoft sign-in for that session rather than crashing the application — a typo in an environment variable must never be the reason a mail client fails to start. See [Accounts and connectivity](accounts-and-connectivity.md) for what "configured" versus "not configured" changes in the interface.

## Failure modes

- **Redirect URI mismatch** (`AADSTS50011: The redirect URI ... does not match the redirect URIs configured for the application` or `AADSTS9002327`): Microsoft rejected the callback address this app sent. This is the specific scenario flagged as unverified in Step 2. Report the exact error text and error code back to this project — it tells us precisely which part of `http://127.0.0.1:<port>/oauth/callback` Microsoft's loopback matching does not accept, and the fix belongs in this app's code, not in your registration.
- **`AADSTS65001: The user or administrator has not consented to use the application`**: the IMAP/SMTP permissions from Step 4 were added but never consented to. A personal account should have been prompted to consent during sign-in; if it was not, or if this is a work/school account, an administrator may need to grant consent explicitly.
- **`AADSTS700016: Application ... was not found in the directory`**: the client ID was copied incorrectly, or belongs to a different tenant than the one being signed into. Re-copy the Application (client) ID from the Overview page.
- **`AADSTS90561` or similar tenant-restriction errors**: the account you are signing in with belongs to an organization whose administrator has restricted which applications can be used. This is a policy decision made by that organization, not something this app or its registration can override.
- **Sign-in succeeds but the account cannot connect**: Exchange Online's legacy IMAP/SMTP authentication (the protocols this app uses, distinct from Graph API mail access) may be disabled tenant-wide by a Microsoft 365 administrator — this became common after Microsoft began deprecating legacy protocol access for security reasons. If IMAP/SMTP access is blocked at the tenant level, no client-side registration change will restore it; ask the mailbox's administrator whether Authenticated SMTP/IMAP is enabled for that account.
- **A refresh token was never issued**: this app refuses to treat a code exchange as successful if the response carries no refresh token (see [Accounts and connectivity](accounts-and-connectivity.md)), because `offline_access` was requested but apparently not honoured. Confirm `offline_access` is present under the app's Microsoft Graph delegated permissions (Step 4).

## Security considerations

- No client secret exists anywhere in this flow. The registration is a public client using PKCE; Microsoft's identity platform is designed for exactly this shape of desktop application.
- The Application (client) ID is read only from the environment at startup and is never written into this app's source, its persisted state, its local history, or any log.
- A completed sign-in's access and refresh tokens are encrypted with Windows `safeStorage` before being written to disk, and are never sent to this app's renderer process or exposed over its IPC boundary in decrypted form — see [Accounts and connectivity](accounts-and-connectivity.md) for the full token-vault design.
- Revoking access from Microsoft's side (at [account.live.com/consent/Manage](https://account.live.com/consent/Manage) for a personal account, or through your organization's admin center for a work/school account) immediately stops this app's stored refresh token from working; the app will report the account as needing to be reconnected.

## Verification

Every piece of this app's Microsoft OAuth implementation — token exchange, refresh, per-account vault storage, and account connection — is tested against a real local HTTP fixture server that speaks the token-endpoint protocol, never a mocked network call. None of it has been exercised against Microsoft's actual identity platform. This guide itself has not been walked through end to end by this project; it is written from the Microsoft identity platform's own published documentation and from this app's own implementation, and the one specific point flagged as uncertain (the loopback redirect URI's exact matching behavior) is exactly the kind of detail that only a live attempt can confirm. If you complete this walkthrough, whether it works on the first try or you hit one of the failure modes above, that result is valuable information for this project either way.

## Suggested articles

- [Accounts and connectivity](accounts-and-connectivity.md)
- [Identities and signatures](identities-and-signatures.md)
