import path from 'node:path';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { PublisherOptions, PublisherStatic } from '@electron-forge/publisher-static';
import debug from 'debug';
import { PublisherAzureConfig } from './Config';

const d = debug('electron-forge:publish:azure');

type AzureArtifact = {
  path: string;
  keyPrefix: string;
  platform: string;
  arch: string;
  isReleaseFile: boolean;
};

export default class PublisherAzure extends PublisherStatic<PublisherAzureConfig> {
  name = 'azure';

  private blobKeySafe = (key: string) => {
    return key.replace(/@/g, '_').replace(/\//g, '_');
  };

  private createBlobServiceClient(): BlobServiceClient {
    const { connectionString, storageAccount, storageAccessKey, sasUrl } = this.config;

    if (connectionString) {
      return BlobServiceClient.fromConnectionString(connectionString);
    }

    if (storageAccount && storageAccessKey) {
      const credential = new StorageSharedKeyCredential(storageAccount, storageAccessKey);
      const url = `https://${storageAccount}.blob.core.windows.net`;
      return new BlobServiceClient(url, credential);
    }

    if (sasUrl) {
      return new BlobServiceClient(sasUrl);
    }

    const envConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (envConnectionString) {
      return BlobServiceClient.fromConnectionString(envConnectionString);
    }

    throw new Error(
      'No Azure credentials provided. Set one of: connectionString, storageAccount+storageAccessKey, sasUrl, or the AZURE_STORAGE_CONNECTION_STRING environment variable.',
    );
  }

  async publish({ makeResults, setStatusLine }: PublisherOptions): Promise<void> {
    const artifacts: AzureArtifact[] = [];

    for (const makeResult of makeResults) {
      artifacts.push(
        ...makeResult.artifacts.map(artifact => ({
          path: artifact,
          keyPrefix: this.config.folder || this.blobKeySafe(makeResult.packageJSON.name),
          platform: makeResult.platform,
          arch: makeResult.arch,
          isReleaseFile: path.basename(artifact, path.extname(artifact)) === 'RELEASES',
        })),
      );
    }

    const blobServiceClient = this.createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(this.config.container);

    d('uploading to container:', this.config.container);

    if (this.config.public) {
      await containerClient.setAccessPolicy('blob');
    }

    let uploaded = 0;
    const updateStatusLine = () => setStatusLine(`Uploading distributable (${uploaded}/${artifacts.length})`);

    updateStatusLine();
    await Promise.all(
      artifacts.map(async artifact => {
        d('uploading:', artifact.path);
        const blobKey = this.keyForArtifact(artifact);
        const blockBlobClient = containerClient.getBlockBlobClient(blobKey);

        const uploadOptions: Parameters<typeof blockBlobClient.uploadFile>[1] = {
          onProgress: ev => {
            d('Upload Progress (%s) %d bytes', path.basename(artifact.path), ev.loadedBytes);
          },
        };

        if (
          artifact.isReleaseFile &&
          typeof this.config.releaseFileCacheControlMaxAge !== 'undefined' &&
          Number.isInteger(this.config.releaseFileCacheControlMaxAge) &&
          this.config.releaseFileCacheControlMaxAge >= 0
        ) {
          uploadOptions.blobHTTPHeaders = {
            blobCacheControl: `max-age=${this.config.releaseFileCacheControlMaxAge}`,
          };
        }

        await blockBlobClient.uploadFile(artifact.path, uploadOptions);
        uploaded += 1;
        updateStatusLine();
      }),
    );
  }
}

export { PublisherAzure, PublisherAzureConfig };
