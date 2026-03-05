export interface PublisherAzureConfig {
  /**
   * Azure Storage connection string (highest priority auth method).
   *
   * E.g. `DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net`
   *
   * Falls back to `AZURE_STORAGE_CONNECTION_STRING` environment variable if not provided.
   */
  connectionString?: string;
  /**
   * Azure Storage account name. Use together with `storageAccessKey`.
   */
  storageAccount?: string;
  /**
   * Azure Storage account key. Use together with `storageAccount`.
   */
  storageAccessKey?: string;
  /**
   * Pre-built SAS URL for the storage account.
   *
   * E.g. `https://<account>.blob.core.windows.net?<sas-token>`
   */
  sasUrl?: string;
  /**
   * The name of the Azure Blob Storage container to upload artifacts to.
   */
  container: string;
  /**
   * The blob prefix (folder) to upload artifacts to.
   *
   * Default: sanitized app name
   */
  folder?: string;
  /**
   * Whether to set the container to blob public access level.
   *
   * Default: false
   */
  public?: boolean;
  /**
   * Custom function to provide the blob key for a given file.
   */
  keyResolver?: (fileName: string, platform: string, arch: string) => string;
  /**
   * Set the Cache-Control max-age (in seconds) for RELEASES files.
   *
   * Default: Cache-Control is not set
   */
  releaseFileCacheControlMaxAge?: number;
}
