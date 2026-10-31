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
dsh-asc-studio
```

Open the **App Store** panel and connect with your App Store Connect API credentials: Issuer ID, Key ID, and `.p8` file.

The plugin edits existing versions and languages. Creating versions, adding languages, and submitting for review remain in App Store Connect.

To update in DSH 0.2.1-rc.5, uninstall from DSH's plugin manager, then add `dsh-asc-studio@latest`. This keeps the plugin's local data and Keychain credentials. The cleanup-and-uninstall action inside ASC Studio deletes them.

## Agent workflow

Open your project in DSH and ask, for example:

> Draft release notes from the Git changes since v1.2.0 and fill the current App Store version’s English and Chinese drafts.

The Agent prepares drafts. You review and sync them in the panel.

## Data and privacy

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
