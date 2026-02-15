# Antigravity Quotas VS Code Extension

A lightweight VS Code extension that provides real-time visibility into your Antigravity model quotas directly within the editor.

## Purpose

This extension helps users track their remaining model usage quotas for Antigravity-powered features. It communicates with the local Antigravity sidecar service to fetch and display:

- **Usage Percentage**: Visual indicators (progress bars and color-coded icons) showing remaining quota.
- **Model Details**: Specific quotas for different models (e.g., Cascade).
- **Reset Timers**: Countdown to when your quotas will refresh.
- **Automatic Refresh**: Automatically checks for updates every 5 minutes, with a manual refresh option.

## Features

- **Activity Bar Integration**: A dedicated "Antigravity Quotas" view in the activity bar.
- **Visual Status**:
  - 🟢 **Green (>50%)**: Plenty of quota remaining.
  - 🟡 **Yellow (20-50%)**: Quota running low.
  - 🔴 **Red (<20%)**: Critical quota limit reached.
- **Process Discovery**: Automatically finds the local Antigravity language server across Windows, macOS, and Linux to retrieve data securely.

## Getting Started

### Prerequisites

- [VS Code](https://code.visualstudio.com/) (version 1.80.0 or higher)
- [Node.js](https://nodejs.org/) and `npm`

### Installation (Development)

1.  **Clone the repository**:

    ```bash
    git clone https://github.com/local/antigravity-quota-ext.git
    cd antigravity-quota-ext
    ```

2.  **Install dependencies**:

    ```bash
    npm install
    ```

3.  **Compile the extension**:

    ```bash
    npm run compile
    ```

4.  **Run in Extension Development Host**:
    - Open the project folder in VS Code.
    - Press `F5` to open a new VS Code window with the extension loaded.

### Packaging

To create a `.vsix` file for manual installation:

```bash
npx @vscode/vsce package
```

## How It Works

The extension operates by discovering the local `language_server` process associated with Antigravity. It extracts the necessary `csrf_token` and identifies the local port it is listening on. It then queries the local API endpoint (`/exa.language_server_pb.LanguageServerService/GetUserStatus`) to get the current quota state without requiring external authentication beyond the local sidecar's security.

## License

[MIT](LICENSE) (or specify your license)
