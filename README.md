# Agent 365 Bridge for Claude Code

Connect **Claude Code** to **Microsoft Agent 365 MCP servers** — giving Claude direct access to Outlook Mail, Calendar, Word, Excel, PowerPoint, Teams, SharePoint, OneDrive, Copilot Search, Knowledge, and User Profile data through the enterprise-grade MCP tooling gateway.

## Architecture

```
┌─────────────┐      stdio       ┌──────────────────┐     HTTPS + Auth     ┌─────────────────────────┐
│ Claude Code  │ ◄──────────────► │  MCP Proxy Bridge │ ◄──────────────────► │  Agent 365 MCP Servers  │
│ (CLI / IDE)  │   MCP protocol   │  (this project)   │   StreamableHTTP    │  (Mail, Calendar, Word, │
└─────────────┘                  └──────────────────┘                      │   Teams, SharePoint...) │
                                                                           └─────────────────────────┘
```

The bridge runs as a **local stdio MCP server** that Claude Code connects to. When Claude calls a tool (e.g. `createMessage`, `getEvents`), the bridge authenticates with Azure Entra ID using **delegated permissions** and forwards the call to the appropriate Agent 365 MCP server — acting on behalf of the signed-in user.

## Why this project exists?

While Microsoft provides a rich set of tools for building and managing AI agents, there is currently a "protocol gap" for 3rd-party coding agents like Claude Code:

1. **Protocol Translation**: Claude Code and most local IDEs speak the **stdio** dialect of the Model Context Protocol (MCP). However, the **Agent 365 Tooling Gateway** (the enterprise cloud back-end) speaks **StreamableHTTP**. This project acts as the necessary protocol translator.
2. **Access to the "Synthetic Workforce"**: Agent 365 is designed to be the control plane for a new generation of autonomous agents. This bridge allows Claude to tap into that same infrastructure, giving a 3rd-party LLM the same enterprise-governed tools used by Microsoft's first-party agents.
3. **Action over Search**: Unlike pure semantic search tools (like WorkIQ), this bridge focuses on **deterministic actions**. It exposes the granular Tooling Servers for Mail, Excel, Word, and Teams, allowing Claude to manipulate data, not just find it.
4. **Developer-First Auth**: It simplifies the complex "Frontier Preview" and "StreamableHTTP" authentication handshake into a standard MCP sign-in flow that just works.

## Status

✅ **Production-tested and working** — Successfully authenticated and discovered 20+ tools from Microsoft Agent 365 MCP servers (Mail, Excel, Knowledge, and more confirmed).

## Prerequisites

| Requirement | Purpose |
|-------------|---------|
| **Node.js ≥ 18** | Runtime |
| **Claude Code CLI** | MCP client |
| **Frontier Preview** | Required for Agent 365 access ([enroll here](https://adoption.microsoft.com/copilot/frontier-program/)) |
| **Azure AD App Registration** | Authentication (see setup guide below) |
| **A365 CLI** (optional) | Agent registration & mock server — requires [.NET 8+](https://dotnet.microsoft.com/download) |

---

## Setup Guide

### Step 1: Install & Build

```bash
git clone https://github.com/ITSpecialist111/Agent365-Bridge.git
cd Agent365-Bridge
npm install
npm run build
```

---

### Step 2: Create an Azure AD App Registration

You need an Azure AD app registration to authenticate with the Agent 365 platform. Follow these steps in the [Azure Portal](https://portal.azure.com):

#### 2a. Register the application

1. Navigate to **Microsoft Entra ID** → **App registrations** → **New registration**
2. Fill in the details:
   - **Name**: `Agent365-Claude-Bridge` (or any name you prefer)
   - **Supported account types**: _"Accounts in this organizational directory only"_ (Single tenant)
   - **Redirect URI**: Leave blank
3. Click **Register**

#### 2b. Collect the required details

From the app registration **Overview** page, copy these two values:

| Field | Where to find it | `.env` variable |
|-------|-------------------|-----------------|
| **Directory (tenant) ID** | Overview page, top section | `AZURE_TENANT_ID` |
| **Application (client) ID** | Overview page, top section | `AZURE_CLIENT_ID` |

#### 2c. Create a client secret _(optional — server deployment only)_

> **Note:** If you're only using Claude Code / Claude Desktop with the default **Device Code** sign-in flow, you can **skip this step entirely**. The Device Code flow is a public client flow and does not require a client secret.
>
> A client secret is only needed if you plan to:
> - Deploy the bridge as an **HTTP server** with On-Behalf-Of (OBO) auth (`AUTH_MODE=obo`)
> - Use **Application permissions** with Client Credentials (`AUTH_MODE=client_credentials`)

1. Go to **Certificates & secrets** (left sidebar)
2. Click **New client secret**
3. Enter a description (e.g. `Agent365 Bridge`) and choose an expiry period
4. Click **Add**
5. **Copy the "Value" immediately** — this is your `AZURE_CLIENT_SECRET`

> ⚠️ The secret value is only shown once. If you lose it, you'll need to create a new one.

#### 2d. Add API Permissions

1. Go to **API permissions** (left sidebar)
2. Click **Add a permission** → **APIs my organization uses**
3. Search for **Agent 365 Tools** (or the app ID `ea9ffc3e-8a23-4a7d-836d-234d7c7565c1`)
4. Select **Delegated permissions** and add the scopes you need:

| Permission | Description |
|------------|-------------|
| `McpServers.Calendar.All` | Calendar MCP Server |
| `McpServers.CopilotMCP.All` | Copilot MCP Server |
| `McpServers.DASearch.All` | M365 Copilot Agent Directory |
| `McpServers.Dataverse.All` | Dataverse MCP Server |
| `McpServers.Excel.All` | Excel MCP Server |
| `McpServers.Files.All` | ODSP Files Tool MCP Server |
| `McpServers.Knowledge.All` | Knowledge MCP Server |
| `McpServers.Mail.All` | Mail MCP Server |
| `McpServers.Me.All` | Me MCP Server (User Profile) |
| `McpServers.OneDriveSharePoint.All` | OneDrive & SharePoint MCP Server |
| `McpServers.PowerPoint.All` | PowerPoint MCP Server |
| `McpServers.SharepointLists.All` | SharePoint Lists MCP Server |
| `McpServers.Teams.All` | Teams MCP Server |
| `McpServers.Word.All` | Word MCP Server |

5. Click **Grant admin consent for [your organization]** (blue button at the top)
6. Verify that each permission shows a green ✅ checkmark under **Status**

#### 2e. Enable public client flows

This is **required** for the device code sign-in flow:

1. Go to **Authentication** (left sidebar)
2. Scroll to **Advanced settings** at the bottom
3. Set **"Allow public client flows"** to **Yes**
4. Click **Save**

---

### Step 3: Configure the `.env` file

Create a `.env` file in the project root with your credentials:

```env
# Azure Entra ID Authentication
AZURE_TENANT_ID=your-directory-tenant-id
AZURE_CLIENT_ID=your-application-client-id

# Client secret — only needed for OBO (server) or client_credentials mode.
# For the default Device Code flow (Claude Code / Claude Desktop), leave this blank or omit it.
# AZURE_CLIENT_SECRET=your-client-secret-value

# Agent 365 Configuration
MCP_PLATFORM_ENDPOINT=https://agent365.svc.cloud.microsoft
MCP_PLATFORM_AUTHENTICATION_SCOPE=ea9ffc3e-8a23-4a7d-836d-234d7c7565c1/.default

# Runtime
NODE_ENV=development
```

---

### Step 4: First Run — Device Code Sign-In

Start the bridge:

```bash
node dist/index.js
```

On first run, you'll be prompted to sign in via your browser:

```
[agent365-bridge] Starting Agent 365 MCP Bridge for Claude Code...
[agent365-bridge] Using Device Code credential (Delegated permissions)
[agent365-bridge] Authentication configured
[agent365-bridge] Discovering Agent 365 MCP servers...
[agent365-bridge] ========================================
[agent365-bridge] SIGN IN REQUIRED
[agent365-bridge] Go to: https://microsoft.com/devicelogin
[agent365-bridge] Enter code: XXXXXXXX
[agent365-bridge] ========================================
```

**To complete sign-in:**

1. Open [https://microsoft.com/devicelogin](https://microsoft.com/devicelogin) in your browser
2. Enter the code shown in the terminal
3. Sign in with your **Microsoft 365 account**

Once authenticated, the bridge discovers all available MCP tools:

```
[agent365-bridge] Discovered 20 tools from mcp_MailTools
[agent365-bridge]   mcp_ExcelServer: CreateWorkbook...
[agent365-bridge]   ... retrieve_federated_knowledge
[agent365-bridge] MCP proxy server started on stdio
```

> **Note:** Each new process start requires a fresh device code sign-in. Tokens are cached in memory for the duration of the session.

---

### Step 5: Register with Claude Code

```bash
npm run register
```

This registers the bridge as a global MCP server in Claude Code. After this, Agent 365 tools are available in **any** Claude Code session.

---

### Step 6: Use Claude Code

Open Claude Code — Agent 365 tools will appear automatically. Try:

```
> Search my Outlook inbox for emails about the Q4 report
> Create a new Word document summarizing the project status
> List my upcoming calendar events for this week
> Post a message in the Engineering team channel
> Find files in SharePoint related to the budget
> Create an Excel workbook with monthly revenue data
```

---

---

## Universal MCP Support (Claude Desktop & Others)

This bridge complies with the **Model Context Protocol (MCP)** specification, meaning it can be used with **any** MCP-compatible client, not just Claude Code CLI.

### adding to Claude Desktop (Windows/Mac)

To use Agent 365 tools inside the Claude Desktop app:

1. Open your config file:
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   - **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`

2. Add the bridge configuration:

```json
{
  "mcpServers": {
    "agent365-bridge": {
      "command": "node",
      "args": [
        "C:/path/to/your/Agent365/dist/index.js"
      ]
    }
  }
}
```

> **Note**: Update the path to match where you cloned this repository.

3. Restart Claude Desktop. The tools will appear in the 🔌 menu.

---

## Available MCP Servers

The bridge connects to all 13 Agent 365 MCP servers:

| Server | Scope | Description |
|--------|-------|-------------|
| **Outlook Mail** | `McpServers.Mail.All` | Read, compose, send, search, and manage emails |
| **Outlook Calendar** | `McpServers.Calendar.All` | Create, view, update, and manage calendar events |
| **Word** | `McpServers.Word.All` | Create and read Word documents, add comments |
| **Excel** | `McpServers.Excel.All` | Create workbooks, manage spreadsheets |
| **PowerPoint** | `McpServers.PowerPoint.All` | Create and modify presentations |
| **Teams** | `McpServers.Teams.All` | Chat, channels, and messaging operations |
| **OneDrive & SharePoint** | `McpServers.OneDriveSharePoint.All` | File upload, search, and metadata |
| **SharePoint Lists** | `McpServers.SharepointLists.All` | List and item CRUD operations |
| **Copilot Search** | `McpServers.CopilotMCP.All` | AI-powered search across M365 data |
| **Knowledge** | `McpServers.Knowledge.All` | Federated knowledge retrieval |
| **User Profile** | `McpServers.Me.All` | Profile, manager, direct reports, user search |
| **Files** | `McpServers.Files.All` | ODSP Files tool operations |
| **Agent Directory** | `McpServers.DASearch.All` | Copilot Agent Directory search |
| **Dataverse** | `McpServers.Dataverse.All` | CRUD operations, FetchXML, and Web API for Dataverse |
| **Files** | `McpServers.Files.All` | ODSP Files tool operations |

---

## Agent 365 Bridge vs. Microsoft WorkIQ

While this bridge connects Claude to the core Agent 365 infrastructure for **action and orchestration**, Microsoft also provides [WorkIQ](https://github.com/microsoft/work-iq-mcp), an "intelligence layer" for M365.

| Feature | Agent 365 Bridge (This Project) | Microsoft WorkIQ |
| :--- | :--- | :--- |
| **Primary Goal** | **Action & Automation**: Send mail, create docs, update calendar. | **Context & Intelligence**: "Summarize my meetings regarding X", "What did Sarah say?" |
| **Data Scope** | 13+ Granular M365 Services (Word, Excel, Teams, etc.) | Federated search across Mail, Teams, and SharePoint. |
| **Authentication** | Custom App Registration (Device Code by default — no client secret needed). | Microsoft-managed App (requires one-time Tenant Admin consent). |
| **Setup Mode** | Local Proxy to Remote HTTP Gateway. | Native Local stdio Server. |

### Using Both Together
For the best experience, we recommend running both servers side-by-side in Claude. This gives Claude "hands" (the bridge) and a "brain" (WorkIQ).

**Claude Desktop Configuration (`%APPDATA%/Claude/claude_desktop_config.json`):**

```json
{
  "mcpServers": {
    "agent365-bridge": {
      "command": "node",
      "args": ["C:/Path/To/Agent365-Bridge/dist/index.js"]
    },
    "workiq": {
      "command": "npx",
      "args": ["-y", "@microsoft/workiq", "mcp"]
    }
  }
}
```

> [!NOTE]
> WorkIQ is currently in Public Preview. For setup instructions and admin consent details, visit the [official WorkIQ repository](https://github.com/microsoft/work-iq-mcp).

## Authentication Modes

| Mode | When to use | Config | Client Secret? |
|------|-------------|--------|----------------|
| **Device Code** (default) | Claude Code / Desktop with Delegated permissions | Set `AZURE_TENANT_ID` + `AZURE_CLIENT_ID` | **No** — public client flow |
| **Client Credentials** | Application-type permissions (headless) | Add `AUTH_MODE=client_credentials` + `AZURE_CLIENT_SECRET` | **Yes** |
| **OBO (On-Behalf-Of)** | HTTP server deployment (Copilot Studio) | Add `AUTH_MODE=obo` + `AZURE_CLIENT_SECRET` | **Yes** |
| **Bearer Token** | Testing with a pre-acquired token | Set `BEARER_TOKEN` in `.env` | No |
| **Mock** | Local development without Azure | Endpoint set to `localhost` | No |

## Project Structure

```
├── src/
│   ├── index.ts                    # Entry point
│   ├── auth/
│   │   ├── token-provider.ts       # Device Code / Client Secret / Bearer auth
│   │   └── token-cache.ts          # JWT token caching with auto-refresh
│   ├── config/
│   │   ├── configuration.ts        # Loads .env + ToolingManifest.json
│   │   └── types.ts                # TypeScript interfaces
│   ├── discovery/
│   │   └── server-discovery.ts     # Discovers MCP servers (manifest or gateway)
│   └── proxy/
│       ├── mcp-proxy-server.ts     # stdio MCP server for Claude Code
│       └── tool-forwarder.ts       # Forwards tool calls to remote servers
├── scripts/
│   ├── setup.ts                    # Interactive setup wizard
│   ├── register-claude.ts          # Registers bridge with Claude Code CLI
│   └── start-mock.ts              # Starts mock server for development
├── ToolingManifest.json            # Declares 13 available MCP servers
├── .mcp.json                       # Claude Code project-level MCP config
├── .env.example                    # Environment variable template
├── package.json
└── tsconfig.json
```

## npm Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Run with ts-node (development) |
| `npm run start` | Run compiled output |
| `npm run setup` | Interactive setup wizard |
| `npm run register` | Register bridge with Claude Code CLI |
| `npm run mock` | Start mock server + register |
| `npm run clean` | Remove `dist/` directory |

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Access denied by Frontier access control` | Tenant not enrolled in Frontier preview | [Enroll here](https://adoption.microsoft.com/copilot/frontier-program/) |
| `Scope 'McpServers.X.All' is not present` | API permissions not added or not consented | Add permissions in Azure Portal → Grant admin consent |
| `Application not found in directory` | Wrong Tenant ID for the app registration | Check the Directory (tenant) ID on the app's Overview page |
| `AADSTS7000218: request body must contain client_assertion` | Public client flows not enabled | Set "Allow public client flows" to Yes in Authentication settings |
| `Scope doesn't exist on the resource` | Manifest scope names don't match Azure API | Update `ToolingManifest.json` scope names or use `/.default` |
| `No authentication configured` | Missing credentials in `.env` | Add `AZURE_TENANT_ID` and `AZURE_CLIENT_ID` to `.env` |

## References

- [Agent 365 Tooling Servers Overview](https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview)
- [Agent 365 SDK and CLI](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/)
- [Agent 365 CLI Install](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/agent-365-cli) (requires .NET 8+: `dotnet tool install --global Microsoft.Agents.A365.DevTools.Cli --prerelease`)
- [Agent 365 Samples](https://github.com/microsoft/Agent365-samples)
- [MCP Server Reference](https://learn.microsoft.com/en-us/microsoft-agent-365/mcp-server-reference/)
- [Frontier Preview Program](https://adoption.microsoft.com/copilot/frontier-program/)

## Disclaimer

**Authentication & Liability**: This project is an open-source bridge and is not an official Microsoft product. It uses your own Azure AD App Registration and operates under the context of the signed-in user. You are responsible for managing the security of your client secrets and tokens. The maintainers of this repository accept no liability for any data loss, security breaches, or unexpected charges incurred by using this software. Use at your own risk.
