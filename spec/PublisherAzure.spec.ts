import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { ForgeMakeResult, ResolvedForgeConfig } from '@electron-forge/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublisherAzure } from '../src/PublisherAzure';

vi.mock('@azure/storage-blob', () => {
  const BlobServiceClientMock = vi.fn();
  (BlobServiceClientMock as any).fromConnectionString = vi.fn();
  return {
    BlobServiceClient: BlobServiceClientMock,
    StorageSharedKeyCredential: vi.fn(),
  };
});

describe('PublisherAzure', () => {
  let publisher: PublisherAzure;
  let tmpDir: string;

  let mockUploadFile: ReturnType<typeof vi.fn>;
  let mockSetAccessPolicy: ReturnType<typeof vi.fn>;
  let mockGetBlockBlobClient: ReturnType<typeof vi.fn>;
  let mockGetContainerClient: ReturnType<typeof vi.fn>;
  let mockBlobServiceClient: { getContainerClient: ReturnType<typeof vi.fn> };

  const mockForgeConfig = {} as ResolvedForgeConfig;
  const mockSetStatusLine = vi.fn();

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'electron-forge-azure-test-'));
    await fs.promises.writeFile(path.join(tmpDir, 'test-app-1.0.0.dmg'), 'fake-dmg-content');
    await fs.promises.writeFile(path.join(tmpDir, 'test-app-1.0.0.exe'), 'fake-exe-content');
    await fs.promises.writeFile(path.join(tmpDir, 'RELEASES'), 'fake-releases-content');
    await fs.promises.writeFile(path.join(tmpDir, 'RELEASES.json'), 'fake-releases-json-content');

    mockUploadFile = vi.fn().mockResolvedValue(undefined);
    mockSetAccessPolicy = vi.fn().mockResolvedValue(undefined);
    mockGetBlockBlobClient = vi.fn().mockReturnValue({ uploadFile: mockUploadFile });
    mockGetContainerClient = vi.fn().mockReturnValue({
      setAccessPolicy: mockSetAccessPolicy,
      getBlockBlobClient: mockGetBlockBlobClient,
    });
    mockBlobServiceClient = { getContainerClient: mockGetContainerClient };

    vi.mocked(BlobServiceClient).mockImplementation(() => mockBlobServiceClient as any);
    vi.mocked(BlobServiceClient.fromConnectionString).mockReturnValue(mockBlobServiceClient as any);
    vi.mocked(StorageSharedKeyCredential).mockImplementation(() => ({}) as any);
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
  });

  describe('constructor', () => {
    it('should create a PublisherAzure instance with correct name', () => {
      publisher = new PublisherAzure({ container: 'test-container' });
      expect(publisher.name).toBe('azure');
    });
  });

  describe('createBlobServiceClient', () => {
    const publishEmpty = (p: PublisherAzure) =>
      p.publish({
        makeResults: [],
        dir: tmpDir,
        forgeConfig: mockForgeConfig,
        setStatusLine: mockSetStatusLine,
      });

    it('should use connectionString from config (highest priority)', async () => {
      publisher = new PublisherAzure({
        connectionString:
          'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=abc123;EndpointSuffix=core.windows.net',
        container: 'test-container',
      });
      await publishEmpty(publisher);
      expect(BlobServiceClient.fromConnectionString).toHaveBeenCalledWith(
        'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=abc123;EndpointSuffix=core.windows.net',
      );
      expect(BlobServiceClient).not.toHaveBeenCalled();
    });

    it('should use storageAccount and storageAccessKey when provided', async () => {
      publisher = new PublisherAzure({
        storageAccount: 'myaccount',
        storageAccessKey: 'mykey==',
        container: 'test-container',
      });
      await publishEmpty(publisher);
      expect(StorageSharedKeyCredential).toHaveBeenCalledWith('myaccount', 'mykey==');
      expect(BlobServiceClient).toHaveBeenCalledWith('https://myaccount.blob.core.windows.net', expect.any(Object));
      expect(BlobServiceClient.fromConnectionString).not.toHaveBeenCalled();
    });

    it('should use sasUrl when provided', async () => {
      const sasUrl = 'https://myaccount.blob.core.windows.net?sv=2020-08-04&ss=b&sp=rwdlacuptfx';
      publisher = new PublisherAzure({ sasUrl, container: 'test-container' });
      await publishEmpty(publisher);
      expect(BlobServiceClient).toHaveBeenCalledWith(sasUrl);
      expect(BlobServiceClient.fromConnectionString).not.toHaveBeenCalled();
    });

    it('should use AZURE_STORAGE_CONNECTION_STRING env var as fallback', async () => {
      const envConnStr =
        'DefaultEndpointsProtocol=https;AccountName=env;AccountKey=envkey;EndpointSuffix=core.windows.net';
      process.env.AZURE_STORAGE_CONNECTION_STRING = envConnStr;
      publisher = new PublisherAzure({ container: 'test-container' });
      await publishEmpty(publisher);
      expect(BlobServiceClient.fromConnectionString).toHaveBeenCalledWith(envConnStr);
    });

    it('should throw when no credentials are provided', async () => {
      publisher = new PublisherAzure({ container: 'test-container' });
      await expect(publishEmpty(publisher)).rejects.toThrow('No Azure credentials provided');
    });
  });

  describe('publish', () => {
    let mockMakeResults: ForgeMakeResult[];

    beforeEach(() => {
      mockMakeResults = [
        {
          artifacts: [path.join(tmpDir, 'test-app-1.0.0.dmg')],
          packageJSON: { name: 'test-app', version: '1.0.0' },
          platform: 'darwin',
          arch: 'x64',
        },
        {
          artifacts: [path.join(tmpDir, 'test-app-1.0.0.exe')],
          packageJSON: { name: 'test-app', version: '1.0.0' },
          platform: 'win32',
          arch: 'x64',
        },
      ] as ForgeMakeResult[];
    });

    it('should upload all artifacts to the configured container', async () => {
      publisher = new PublisherAzure({
        connectionString: 'fake-connection-string',
        container: 'test-container',
      });

      await publisher.publish({
        makeResults: mockMakeResults,
        dir: tmpDir,
        forgeConfig: mockForgeConfig,
        setStatusLine: mockSetStatusLine,
      });

      expect(mockGetContainerClient).toHaveBeenCalledWith('test-container');
      expect(mockUploadFile).toHaveBeenCalledTimes(2);
    });

    it('should update status line during uploads', async () => {
      publisher = new PublisherAzure({
        connectionString: 'fake-connection-string',
        container: 'test-container',
      });

      await publisher.publish({
        makeResults: mockMakeResults,
        dir: tmpDir,
        forgeConfig: mockForgeConfig,
        setStatusLine: mockSetStatusLine,
      });

      expect(mockSetStatusLine).toHaveBeenCalledWith('Uploading distributable (0/2)');
      expect(mockSetStatusLine).toHaveBeenCalledWith('Uploading distributable (1/2)');
      expect(mockSetStatusLine).toHaveBeenCalledWith('Uploading distributable (2/2)');
    });

    it('should use custom folder when provided', async () => {
      publisher = new PublisherAzure({
        connectionString: 'fake-connection-string',
        container: 'test-container',
        folder: 'custom-folder',
      });

      await publisher.publish({
        makeResults: mockMakeResults,
        dir: tmpDir,
        forgeConfig: mockForgeConfig,
        setStatusLine: mockSetStatusLine,
      });

      expect(mockGetBlockBlobClient).toHaveBeenCalledWith(expect.stringContaining('custom-folder/'));
    });

    it('should set container public access when public is true', async () => {
      publisher = new PublisherAzure({
        connectionString: 'fake-connection-string',
        container: 'test-container',
        public: true,
      });

      await publisher.publish({
        makeResults: mockMakeResults,
        dir: tmpDir,
        forgeConfig: mockForgeConfig,
        setStatusLine: mockSetStatusLine,
      });

      expect(mockSetAccessPolicy).toHaveBeenCalledWith('blob');
    });

    it('should not set access policy when public is not set', async () => {
      publisher = new PublisherAzure({
        connectionString: 'fake-connection-string',
        container: 'test-container',
      });

      await publisher.publish({
        makeResults: mockMakeResults,
        dir: tmpDir,
        forgeConfig: mockForgeConfig,
        setStatusLine: mockSetStatusLine,
      });

      expect(mockSetAccessPolicy).not.toHaveBeenCalled();
    });

    it('should pass an onProgress handler to uploadFile', async () => {
      publisher = new PublisherAzure({
        connectionString: 'fake-connection-string',
        container: 'test-container',
      });

      await publisher.publish({
        makeResults: mockMakeResults,
        dir: tmpDir,
        forgeConfig: mockForgeConfig,
        setStatusLine: mockSetStatusLine,
      });

      expect(mockUploadFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ onProgress: expect.any(Function) }),
      );
    });

    it('should set Cache-Control blobHTTPHeaders for RELEASES file', async () => {
      publisher = new PublisherAzure({
        connectionString: 'fake-connection-string',
        container: 'test-container',
        releaseFileCacheControlMaxAge: 3600,
      });

      await publisher.publish({
        makeResults: [
          {
            artifacts: [path.join(tmpDir, 'RELEASES')],
            packageJSON: { name: 'test-app', version: '1.0.0' },
            platform: 'win32',
            arch: 'x64',
          } as ForgeMakeResult,
        ],
        dir: tmpDir,
        forgeConfig: mockForgeConfig,
        setStatusLine: mockSetStatusLine,
      });

      expect(mockUploadFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          blobHTTPHeaders: { blobCacheControl: 'max-age=3600' },
        }),
      );
    });

    it('should set Cache-Control blobHTTPHeaders for RELEASES.json file', async () => {
      publisher = new PublisherAzure({
        connectionString: 'fake-connection-string',
        container: 'test-container',
        releaseFileCacheControlMaxAge: 3600,
      });

      await publisher.publish({
        makeResults: [
          {
            artifacts: [path.join(tmpDir, 'RELEASES.json')],
            packageJSON: { name: 'test-app', version: '1.0.0' },
            platform: 'win32',
            arch: 'x64',
          } as ForgeMakeResult,
        ],
        dir: tmpDir,
        forgeConfig: mockForgeConfig,
        setStatusLine: mockSetStatusLine,
      });

      expect(mockUploadFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          blobHTTPHeaders: { blobCacheControl: 'max-age=3600' },
        }),
      );
    });

    it('should set Cache-Control for both RELEASES and RELEASES.json in the same upload', async () => {
      publisher = new PublisherAzure({
        connectionString: 'fake-connection-string',
        container: 'test-container',
        releaseFileCacheControlMaxAge: 3600,
      });

      await publisher.publish({
        makeResults: [
          {
            artifacts: [path.join(tmpDir, 'RELEASES'), path.join(tmpDir, 'RELEASES.json')],
            packageJSON: { name: 'test-app', version: '1.0.0' },
            platform: 'win32',
            arch: 'x64',
          } as ForgeMakeResult,
        ],
        dir: tmpDir,
        forgeConfig: mockForgeConfig,
        setStatusLine: mockSetStatusLine,
      });

      expect(mockUploadFile).toHaveBeenCalledTimes(2);
      for (const [, options] of mockUploadFile.mock.calls) {
        expect(options.blobHTTPHeaders).toEqual({
          blobCacheControl: 'max-age=3600',
        });
      }
    });

    it('should not set Cache-Control for non-RELEASES files', async () => {
      publisher = new PublisherAzure({
        connectionString: 'fake-connection-string',
        container: 'test-container',
        releaseFileCacheControlMaxAge: 3600,
      });

      await publisher.publish({
        makeResults: mockMakeResults,
        dir: tmpDir,
        forgeConfig: mockForgeConfig,
        setStatusLine: mockSetStatusLine,
      });

      for (const [, options] of mockUploadFile.mock.calls) {
        expect(options.blobHTTPHeaders).toBeUndefined();
      }
    });

    it('should not set Cache-Control when releaseFileCacheControlMaxAge is not configured', async () => {
      publisher = new PublisherAzure({
        connectionString: 'fake-connection-string',
        container: 'test-container',
      });

      await publisher.publish({
        makeResults: [
          {
            artifacts: [path.join(tmpDir, 'RELEASES')],
            packageJSON: { name: 'test-app', version: '1.0.0' },
            platform: 'win32',
            arch: 'x64',
          } as ForgeMakeResult,
        ],
        dir: tmpDir,
        forgeConfig: mockForgeConfig,
        setStatusLine: mockSetStatusLine,
      });

      const [, options] = mockUploadFile.mock.calls[0];
      expect(options.blobHTTPHeaders).toBeUndefined();
    });
  });

  describe('blobKeySafe', () => {
    it('should replace @ and / characters with underscores', () => {
      publisher = new PublisherAzure({ container: 'test-container' });
      const result = (publisher as any).blobKeySafe('test@example.com/path/to/file');
      expect(result).toBe('test_example.com_path_to_file');
    });
  });
});
