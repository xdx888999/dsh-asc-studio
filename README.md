# ASC Studio

English | [中文](README.zh-CN.md)

Edit App Store Connect listing text and images in the [DeepSeek Harness](https://deepseek.com/harness/) sidebar.

## Features

- Edit localized names, subtitles, descriptions, keywords, release notes, and promotional text.
- Review changes before syncing, with character counts and checks for conflicting edits in ASC.
- Manage screenshots, product page headers, and search result images.
- Preview product and search pages in a device layout.
- Ask the DSH Agent to draft copy and translations, or summarize Git changes into release notes.
- English and Simplified Chinese interface.

## Install

Requires **macOS** and DSH **>=0.2.1-rc.5, <0.3.0**. Tested with DSH 0.2.1-rc.5 in desktop and Web modes on macOS.

In DSH, open **Plugins → Add Plugin** and install:

```text
dsh-asc-studio@0.1.3
```

Open the **App Store** panel and connect with your App Store Connect API credentials: Issuer ID, Key ID, and `.p8` file.

The plugin edits existing versions and languages. Creating versions, adding languages, and submitting for review remain in App Store Connect.

ASC Studio checks for updates when opened and shows a notice when a newer release is available. You can also check in Settings. On DSH 0.2.1-rc.5, follow the notice’s update guide: uninstall from DSH's plugin manager, then add the exact package version shown in the guide. A very recent release may not be selected by `@latest` because of the package manager’s release-age policy. This keeps local data and Keychain credentials. The cleanup-and-uninstall action inside ASC Studio deletes them.

## Agent workflow

Open your project in DSH and ask, for example:

> Draft release notes from the Git changes since v1.2.0 and fill the current App Store version’s English and Chinese drafts.

The Agent prepares drafts. You review and sync them in the panel.

## Data and privacy

Update checks request only public package metadata from npm and cache results in memory for six hours. They do not send ASC credentials, listing text, or images.

API private keys are stored in macOS Keychain. Local preview images can be cleared in settings. Use the plugin’s cleanup action before uninstalling to remove its local data and credentials.

DSH may retain Agent conversations. When using a cloud model, listing text and project content read by the Agent are sent to that model provider. The plugin does not expose private keys to Agent tools.

## Development

Use Node.js 24, then run:

```sh
npm ci
npm run check
```

For local development, install the repository’s absolute path through DSH’s plugin manager.

Pushes to `main` run checks and publish to npm when the package version is new. Keep the versions in `package.json`, `package-lock.json`, and `lib/client.js` in sync. Publishing uses npm trusted publishing through the `npm` GitHub environment.

## License

[MIT](LICENSE). An independent community plugin, not affiliated with Apple or DeepSeek.
