# Setting up Microsoft sign-in (Azure AD / Entra ID app registration)

## Current status

Microsoft sign-in is implemented end to end in this build — authorization, token exchange, refresh, and account connection all work — but it is off by default and stays off until you supply your own Microsoft Entra ID app registration. This app never ships a client ID in its source, and it can never sign anyone in on your behalf: you have to register your own application with Microsoft first, exactly as any desktop mail client that supports "Sign in with Microsoft" does. This article walks through that registration from nothing, then how to hand the result to this app.

This app uses what this project calls **"Cheap Version" OAuth**: there is no local network listener of any kind, and by default there is nothing for you to host or register beyond the app itself. The browser tab that opens for sign-in ends on a page whose *address bar* carries the result; you copy that address and paste it back into the app, which parses it automatically. By default this app registers with Microsoft's own documented placeholder for exactly this shape of native application — `https://login.microsoftonline.com/common/oauth2/nativeclient` — so most people need zero redirect-URI setup beyond checking one box in Step 2. A custom HTTPS redirect (for example, your own domain, or a stable tunnel you already run) is optional and only needed if you have a reason to prefer one; see Configuration below.

## Behavior

What registering an app actually gives you: an **Application (client) ID**, a public, non-secret identifier that tells Microsoft's identity platform "a request claiming to be this app is allowed to ask a user to sign in." Nothing else. This app is a *public client* — a desktop application that cannot keep a secret confidential — so it authenticates using PKCE (Proof Key for Code Exchange) alone, never a client secret. You should not create one, and if you do, this app will never send it.

### Step 1 — Prerequisites

- A Microsoft account (a personal outlook.com/hotmail.com/live.com account, or a work/school account) that can access the [Azure portal](https://portal.azure.com) or [Microsoft Entra admin center](https://entra.microsoft.com). Signing up for one, if you do not already have one, is free and quick.
- Any individual Microsoft account can normally register an application in its own Microsoft Entra ID directory without special administrator rights — this is a self-service feature enabled by default for most tenants. If your organization has disabled self-service app registration, you will need to ask an administrator to either register the app for you or grant you the "Application Developer" role.
- No Azure subscription or payment is required. App registration is free.

### Step 2 — Create the app registration

1. Go to [entra.microsoft.com](https://entra.microsoft.com) and sign in. (You can also reach the same page through [portal.azure.com](https://portal.azure.com) → search for "Microsoft Entra ID" → **App registrations** in the left sidebar.)
2. Select **App registrations**, then **+ New registration**.
3. **Name**: anything you like — it is shown to you and to anyone who signs in through it, but it does not need to match this project's name. For example, `Material Email (local)`.
4. **Supported account types**: choose **Accounts in any organizational directory and personal Microsoft accounts (e.g. Skype, Xbox)**. This is the option that lets both a personal Outlook.com/Hotmail account and a work/school Microsoft 365 account sign in through the same registration, and it corresponds to this app's default tenant setting of `common` (see Step 5).
   - If you only ever intend to connect one specific organization's mailboxes, you can instead choose **Accounts in this organizational directory only** and set `MATERIAL_EMAIL_MICROSOFT_TENANT` to your tenant ID or verified domain (Step 5) — but `common` is the simpler default and works for both account types.
5. **Redirect URI**: set the platform dropdown to **Mobile and desktop applications** (not "Web" and not "Single-page application" — those are for different application types). Microsoft's own suggested list under this platform includes a checkbox for its documented native-client placeholder — check that one. It resolves to `https://login.microsoftonline.com/common/oauth2/nativeclient`, which is exactly the redirect URI this app sends by default. Nothing else to configure here for most people; skip straight to Step 3.
   - **Prefer your own HTTPS address instead?** You can register any stable HTTPS URL you control under the same "Mobile and desktop applications" platform (for example, a page on a domain you own, or a persistent tunnel address) and point this app at it with the `MATERIAL_EMAIL_MICROSOFT_REDIRECT_URI` environment variable (Step 5). The manual-paste mechanism works identically either way — this app never needs that address to serve anything, since nothing is listening on it; Microsoft only needs it to redirect the browser there so you can copy the resulting address back. This is entirely optional.
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
6. Also confirm `offline_access` is present under **Microsoft Graph** delegated permissions — most new registrations include this by default. It is what lets Microsoft issue a refresh token at all; without it, this app's sign-in would work once and then be unable to reconnect once the short-lived access token expired, and it deliberately refuses to treat a token as connected without one (see Failure modes in [Accounts and connectivity](accounts-and-connectivity.md)).
7. If your organization requires administrator consent for these permissions (a padlock or "Not granted" label appears next to them), a Microsoft 365 administrator for that tenant will need to grant consent, either by selecting **Grant admin consent** here (if you have that role) or by asking your administrator to. A personal Microsoft account (outlook.com/hotmail.com) does not need admin consent — it consents for itself on first sign-in.

### Step 5 — Hand the client ID to Material Email

Set the `MATERIAL_EMAIL_MICROSOFT_CLIENT_ID` environment variable to the Application (client) ID you copied in Step 3, then start the app from an environment where that variable is set. Optionally set `MATERIAL_EMAIL_MICROSOFT_TENANT` if you chose a single-organization registration in Step 2 (leave it unset, or set it to `common`, for the recommended multi-account registration). Optionally set `MATERIAL_EMAIL_MICROSOFT_REDIRECT_URI` only if you registered your own HTTPS redirect in Step 2 instead of using Microsoft's default sentinel.

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

Open Material Email, go to **Settings → Mail accounts → Add account**, choose **OAuth 2 browser foundation** as the authentication mode, and select **Microsoft** as the provider. The app should now report Microsoft as **configured** rather than **not configured**, and the **Start browser sign-in** button should be enabled.

1. Select **Start browser sign-in**. Your default browser opens to Microsoft's sign-in page.
2. Complete sign-in with your Microsoft account, and consent to the permissions from Step 4 if prompted.
3. Microsoft redirects the browser to the registered redirect URI with the sign-in result attached as query parameters — this is the page whose **address bar** now carries what the app needs. Nothing needs to load successfully on that page; only the address itself matters.
4. Copy the complete address from the browser's address bar.
5. Return to Material Email and paste it into the **Pasted address** field, then select **Continue**. The app parses the address itself, checks it against the exact sign-in attempt it started, and completes the exchange.
6. The app reports **Signed in**.

Fill in the account's display name, email address, and IMAP/SMTP server settings (`outlook.office365.com:993` TLS for incoming, `smtp.office365.com:587` STARTTLS for outgoing are Microsoft's standard values), then **Test settings** or **Connect account**.

## Configuration

| Environment variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MATERIAL_EMAIL_MICROSOFT_CLIENT_ID` | Yes, to enable Microsoft sign-in at all | unset (Microsoft stays disabled) | The Application (client) ID from Step 3 |
| `MATERIAL_EMAIL_MICROSOFT_TENANT` | No | `common` | `common` (personal + work/school), `organizations` (work/school only), `consumers` (personal only), or a specific tenant ID/verified domain |
| `MATERIAL_EMAIL_MICROSOFT_REDIRECT_URI` | No | Microsoft's native-client sentinel (`https://login.microsoftonline.com/common/oauth2/nativeclient`) | A clean HTTPS URL (no query string or fragment) you have separately registered under the same app registration in Step 2, if you prefer not to use the default sentinel |

All three are read once, at application startup, from the process environment. Changing any of them requires restarting the app. A malformed value (anything containing whitespace, control characters, a non-HTTPS scheme, or — for the redirect URI — a query string or fragment) is reported clearly and disables Microsoft sign-in for that session rather than crashing the application — a typo in an environment variable must never be the reason a mail client fails to start. See [Accounts and connectivity](accounts-and-connectivity.md) for what "configured" versus "not configured" changes in the interface.

## Failure modes

- **The pasted address does not match**: the app stays on the same waiting state and does not advance, so you can try again immediately. This happens if the wrong address was copied, if it was copied before sign-in actually finished, or if the sign-in attempt has since timed out (a fresh attempt always starts with **Start browser sign-in** again). Copy the full address from the browser's own address bar after sign-in completes, and paste the whole thing.
- **Redirect URI mismatch** (`AADSTS50011: The redirect URI ... does not match the redirect URIs configured for the application` or `AADSTS9002327`), seen *in the browser* before you ever get to paste anything back: the redirect URI this app sent does not match what is registered. If you used the default sentinel from Step 2, re-check that the exact checkbox was selected under "Mobile and desktop applications". If you set `MATERIAL_EMAIL_MICROSOFT_REDIRECT_URI`, confirm that exact URL (scheme, host, and path, with no trailing differences) is registered under the same platform type.
- **`AADSTS65001: The user or administrator has not consented to use the application`**: the IMAP/SMTP permissions from Step 4 were added but never consented to. A personal account should have been prompted to consent during sign-in; if it was not, or if this is a work/school account, an administrator may need to grant consent explicitly.
- **`AADSTS700016: Application ... was not found in the directory`**: the client ID was copied incorrectly, or belongs to a different tenant than the one being signed into. Re-copy the Application (client) ID from the Overview page.
- **`AADSTS90561` or similar tenant-restriction errors**: the account you are signing in with belongs to an organization whose administrator has restricted which applications can be used. This is a policy decision made by that organization, not something this app or its registration can override.
- **Sign-in succeeds but the account cannot connect**: Exchange Online's legacy IMAP/SMTP authentication (the protocols this app uses, distinct from Graph API mail access) may be disabled tenant-wide by a Microsoft 365 administrator — this became common after Microsoft began deprecating legacy protocol access for security reasons. If IMAP/SMTP access is blocked at the tenant level, no client-side registration change will restore it; ask the mailbox's administrator whether Authenticated SMTP/IMAP is enabled for that account.
- **A refresh token was never issued**: this app refuses to treat a code exchange as successful if the response carries no refresh token (see [Accounts and connectivity](accounts-and-connectivity.md)), because `offline_access` was requested but apparently not honoured. Confirm `offline_access` is present under the app's Microsoft Graph delegated permissions (Step 4).

## Security considerations

- No client secret exists anywhere in this flow. The registration is a public client using PKCE; Microsoft's identity platform is designed for exactly this shape of desktop application.
- No local network listener is ever opened for this flow, on any port, at any point — there is nothing to bind, nothing to firewall, and nothing on this machine ever accepts an inbound connection as part of signing in. The redirect result reaches the app only because you copy and paste it.
- The Application (client) ID and redirect URI are read only from the environment at startup and are never written into this app's source, its persisted state, its local history, or any log.
- A completed sign-in's access and refresh tokens are encrypted with Windows `safeStorage` before being written to disk, and are never sent to this app's renderer process or exposed over its IPC boundary in decrypted form — see [Accounts and connectivity](accounts-and-connectivity.md) for the full token-vault design.
- Revoking access from Microsoft's side (at [account.live.com/consent/Manage](https://account.live.com/consent/Manage) for a personal account, or through your organization's admin center for a work/school account) immediately stops this app's stored refresh token from working; the app will report the account as needing to be reconnected.

## Verification

Every piece of this app's Microsoft OAuth implementation — the pasted-redirect state machine, token exchange, refresh, per-account vault storage, and account connection — is tested against a real local HTTP fixture server that speaks the token-endpoint protocol and a real Electron end-to-end harness that drives the paste flow through the actual UI, never a mocked network call. None of it has been exercised against Microsoft's actual identity platform. This guide is written from the Microsoft identity platform's own published documentation and from this app's own implementation. If you complete this walkthrough, whether it works on the first try or you hit one of the failure modes above, that result is valuable information for this project either way.

## Suggested articles

- [Accounts and connectivity](accounts-and-connectivity.md)
- [Identities and signatures](identities-and-signatures.md)
