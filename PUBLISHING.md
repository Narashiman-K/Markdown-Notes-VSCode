# Publishing Suprasūtā Markdown Notes

Two marketplaces, because one editor family cannot use the other's.

| | Who it reaches | Account needed |
| --- | --- | --- |
| **VS Code Marketplace** | VS Code only | Azure DevOps (Microsoft) |
| **Open VSX** | Antigravity, Cursor, VSCodium, Gitpod, Theia | GitHub + a signed Eclipse agreement |

Microsoft's terms do not let forks use its marketplace, so Open VSX is not
optional if Antigravity users are meant to find this.

**Never paste an access token into a chat, an issue, or a commit.** Every
command below that takes one is a command you run yourself in your own
terminal.

---

## Part 1 — VS Code Marketplace

### 1. Create the publisher

Go to **<https://marketplace.visualstudio.com/manage/createpublisher>** and sign
in with your Microsoft account.

| Field | Value |
| --- | --- |
| ID | `narashiman-k` |
| Display name | `Narashiman Krishnamurthy` |

The ID must be exactly `narashiman-k` — it is already written into
`package.json`, and it cannot be changed after creation.

### 2. Create a Personal Access Token

Go to **<https://dev.azure.com/>**, click your avatar (top right) →
**Personal access tokens** → **New Token**.

| Field | Value | Why it matters |
| --- | --- | --- |
| Name | `vsce-publish` | Anything |
| Organization | **All accessible organizations** | The single most common cause of a failed publish. The default is one organization, and that token will be rejected. |
| Expiration | Up to 1 year | You will need a new one when it lapses |
| Scopes | **Custom defined** → scroll to **Marketplace** → tick **Manage** | `Acquire` and `Publish` alone are not enough |

Copy the token when it appears. It is shown exactly once.

### 3. Log in

```powershell
cd "D:\Calude Co-work space\Build Projects\Markdown-Notes-VSCode-AG-Extension"
npx @vscode/vsce login narashiman-k
```

Paste the token when prompted. It is stored in your own credential store —
nothing is written into the project.

### 4. Publish

```powershell
npx @vscode/vsce publish --packagePath build\suprasuta-markdown-notes-1.0.0.vsix
```

The listing appears within a few minutes, then takes up to fifteen more to pass
Microsoft's automated virus scan before it is installable.

---

## Part 2 — Open VSX (Antigravity, Cursor)

This is the slower half, because of one agreement that has to be processed.

### 1. Sign in

Go to **<https://open-vsx.org>** and sign in with GitHub.

### 2. Sign the Eclipse Publisher Agreement

Open VSX is run by the Eclipse Foundation and will not accept a first publish
without it.

1. Create an Eclipse account at **<https://accounts.eclipse.org/user/register>**
2. **Use the same email address as your GitHub account.** If the two do not
   match, Open VSX cannot connect them and the publish is refused with a
   message about a missing agreement — this is the usual reason a first attempt
   fails
3. On your Eclipse profile, add your GitHub username under **Social Media Links**
4. Back on <https://open-vsx.org>, open your profile menu and follow the prompt
   to **sign the Publisher Agreement**

### 3. Create an access token

**<https://open-vsx.org/user-settings/tokens>** → **Generate New Token**.
Copy it; it is shown once.

### 4. Claim the namespace and publish

```powershell
cd "D:\Calude Co-work space\Build Projects\Markdown-Notes-VSCode-AG-Extension"

# Paste your token at the prompt rather than typing it into the command,
# so it does not end up in your PowerShell history.
$t = Read-Host "Open VSX token" -AsSecureString
$env:OVSX_PAT = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($t))

npx ovsx create-namespace narashiman-k
npx ovsx publish build\suprasuta-markdown-notes-1.0.0.vsix

Remove-Item Env:\OVSX_PAT
```

`create-namespace` only ever runs once. Open VSX publishes immediately — there
is no review queue.

---

## Part 3 — GitHub release

Go to **<https://github.com/Narashiman-K/Markdown-Notes-VSCode/releases/new>**.

| Field | Value |
| --- | --- |
| Tag | `v1.0.0` — already pushed, pick it from the list |
| Title | `1.0.0 — first public release` |
| Description | Paste the `1.0.0` section of [CHANGELOG.md](CHANGELOG.md) |
| Attach | `build\suprasuta-markdown-notes-1.0.0.vsix` |

Attaching the `.vsix` matters more than it looks: it is the only way someone on
a fork with no marketplace access, or behind a corporate proxy, can install it
at all.

---

## When something fails

| Message | Cause |
| --- | --- |
| `401 Unauthorized` from vsce | The PAT was scoped to one organization instead of **All accessible organizations** |
| `403 Forbidden` from vsce | Scope is missing **Marketplace → Manage** |
| `ERROR The Publisher 'narashiman-k' was not found` | Step 1 was skipped, or the ID was typed differently |
| `Missing publisher agreement` from ovsx | The Eclipse account email does not match the GitHub account email |
| `ERROR namespace already exists` | `create-namespace` was already run. Skip it and publish |
| Published but not installable for ~15 min | Normal. Microsoft's virus scan runs after the listing goes live |

## Releasing an update later

```powershell
npm version patch          # or minor / major — updates package.json
npm run package
npx @vscode/vsce publish --packagePath build\suprasuta-markdown-notes-<new>.vsix
npx ovsx publish build\suprasuta-markdown-notes-<new>.vsix
git push --follow-tags
```

Both marketplaces refuse a version number that has already been published, so
the version bump is not optional.
