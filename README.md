# electron-forge-publisher-azure

An [Electron Forge](https://www.electronforge.io/) publisher that uploads build artifacts to [Azure Blob Storage](https://azure.microsoft.com/en-us/products/storage/blobs).

## Installation

```bash
npm install --save-dev electron-forge-publisher-azure
```

## Usage

```js
// forge.config.js
module.exports = {
  publishers: [
    {
      name: 'electron-forge-publisher-azure',
      config: {
        connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
        container: 'releases',
      },
    },
  ],
};
```

## Configuration

| Option                          | Type       | Required | Description                                                          |
| ------------------------------- | ---------- | -------- | -------------------------------------------------------------------- |
| `container`                     | `string`   | **Yes**  | Azure Blob Storage container name                                    |
| `connectionString`              | `string`   | No       | Azure Storage connection string                                      |
| `storageAccount`                | `string`   | No       | Storage account name (use with `storageAccessKey`)                   |
| `storageAccessKey`              | `string`   | No       | Storage account key (use with `storageAccount`)                      |
| `sasUrl`                        | `string`   | No       | Pre-built SAS URL for the storage account                            |
| `folder`                        | `string`   | No       | Blob prefix/folder (default: sanitized app name)                     |
| `public`                        | `boolean`  | No       | Set container to blob public access (default: `false`)               |
| `keyResolver`                   | `function` | No       | Custom function `(fileName, platform, arch) => string` for blob keys |
| `releaseFileCacheControlMaxAge` | `number`   | No       | `Cache-Control: max-age=N` (seconds) for RELEASES files              |

## Authentication

Credentials are resolved in the following priority order:

### 1. Connection String (config)

```js
config: {
  connectionString: 'DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net',
  container: 'releases',
}
```

### 2. Account Name + Key

```js
config: {
  storageAccount: 'mystorageaccount',
  storageAccessKey: 'base64encodedkey==',
  container: 'releases',
}
```

### 3. SAS URL

```js
config: {
  sasUrl: 'https://mystorageaccount.blob.core.windows.net?sv=2020-08-04&ss=b&...',
  container: 'releases',
}
```

### 4. Environment Variable

Set `AZURE_STORAGE_CONNECTION_STRING` in your environment. The publisher will use it automatically with no config required beyond `container`.

```js
config: {
  container: 'releases',
}
```

## Local Development with Azurite

[Azurite](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite) is a local Azure Storage emulator. The easiest way to run it is via the [Azurite VS Code extension](https://marketplace.visualstudio.com/items?itemName=Azurite.azurite).

**Setup:**

1. Install the [Azurite extension](https://marketplace.visualstudio.com/items?itemName=Azurite.azurite) in VS Code
2. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **Azurite: Start Blob Service**
3. Create your container (`releases` in demo) using [Azure Storage Explorer](https://azure.microsoft.com/en-us/products/storage/storage-explorer) or the Azure CLI pointed at the local emulator

Then configure the publisher to connect to Azurite.

**Recommended: SAS URL (most compatible)**

Generate a SAS token in [Azure Storage Explorer](https://azure.microsoft.com/en-us/products/storage/storage-explorer) for your Azurite container (right-click the container → Get Shared Access Signature), then use `sasUrl`:

```js
// forge.config.js
module.exports = {
  publishers: [
    {
      name: 'electron-forge-publisher-azure',
      config: {
        sasUrl: 'http://127.0.0.1:10000/devstoreaccount1?sv=2018-03-28&sp=...',
        container: 'releases',
      },
    },
  ],
};
```

This avoids Shared Key signature compatibility issues between newer `@azure/storage-blob` SDK versions and older Azurite installations.

**Alternative: connection string**

The connection string approach uses Shared Key signing, which can fail with 403 on write operations if your SDK version is newer than your installed Azurite version supports. If you want to use it, ensure the Azurite extension is up to date:

```js
config: {
  // Well-known Azurite dev credentials — safe to commit, not real secrets
  connectionString:
    'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;',
  container: 'releases',
}
```

> **Note:** Azurite listens on `http://127.0.0.1:10000` by default.

## Using the Source Directly in an Electron Project

If you want to iterate on the publisher alongside your Electron app — without publishing to npm — you can reference the source directly using a relative `file:` path.

**1. Clone this repo next to your Electron project:**

```
my-electron-app/
electron-forge-publisher-azure/
```

**2. In your Electron app's `package.json`, add a local dependency:**

```json
{
  "devDependencies": {
    "electron-forge-publisher-azure": "file:../electron-forge-publisher-azure"
  }
}
```

**3. Build the publisher source first (needed so `dist/` exists):**

```bash
# In electron-forge-publisher-azure/
npx tsc
```

**4. Install in your Electron app:**

```bash
# In my-electron-app/
npm install
```

**5. Reference it in `forge.config.js` by package name as normal:**

```js
// forge.config.js
module.exports = {
  publishers: [
    {
      name: 'electron-forge-publisher-azure',
      config: {
        connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
        container: 'releases',
      },
    },
  ],
};
```

After making changes to the publisher source, re-run `npx tsc` in the publisher directory and re-run your `electron-forge publish` command. No reinstall is needed because `file:` symlinks the directory.

## Public Access

Setting `public: true` calls `setAccessPolicy('blob')` on the container before uploads begin. This makes all blobs in the container publicly readable via their URL.

> **Note:** Container access policy changes may take up to 30 seconds to propagate.

## Overwriting Releases

Azure Blob Storage will overwrite existing blobs with the same key. There is no versioning or conflict protection by default. Ensure you don't overwrite your own releases by publishing twice with the same version on the same platform.
