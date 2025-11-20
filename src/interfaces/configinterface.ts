/**
 * @file configinterface.ts
 * Abstraction layer for configuration access so core logic remains framework-agnostic.
 *
 * This mirrors responsibilities currently handled inside LLConfigService but avoids
 * any direct dependency on VS Code types. All paths MUST be normalized before
 * returning using the NormalizedPath branding from hostinterface.
 */

import { NormalizedPath } from './hostinterface';

/** Keys used by configuration (mirrors LLConfigNames). */
export enum ConfigKey {
  Enabled = 'enabled',
  ClientName = 'client.name',
  ClientVersion = 'client.version',
  ClientProtocolVersion = 'client.protocolVersion',
  UITimeout = 'ui.statusTimeoutSeconds',
  StorageUseLocalConfig = 'storage.useLocalConfig',
  StorageGlobalPath = 'storage.globalPath',
  FilesSupportedExtensions = 'files.supportedExtensions',
  NetworkDisconnectDelayMs = 'network.disconnectDelayMs',
  NetworkDisposeDelayMs = 'network.disposeDelayMs',
  NetworkWebsocketPort = 'network.websocketPort',
  Preprocessor = 'preprocessor',
  PreprocessorEnable = 'preprocessor.enable',
  PreprocessorOptions = 'preprocessor.options',
  PreprocessorIncludePaths = 'preprocessor.includePaths',
  PreprocessorMaxIncludeDepth = 'preprocessor.maxIncludeDepth',
  LastSyntaxID = 'syntax.lastID',
}

/** Scope target for configuration updates. */
export type ConfigScopeTarget = 'workspace' | 'global';
export interface ConfigScope {
  target: ConfigScopeTarget;
  languageId?: string;
}

/** Basic configuration retrieval + mutation + path discovery. */
export interface ConfigInterface {
  /** Read a config value (undefined if not set). */
  getConfig<T>(key: ConfigKey): T | undefined;

  /** Get extensions enabled status */
  isEnabled() : boolean;

  /** Update a config value. Implementations may persist asynchronously. */
  setConfig<T>(key: ConfigKey, value: T, scope?: ConfigScope): Promise<void>;

  /** Path helpers analogous to LLConfigService static methods. */
  getExtensionInstallPath(): Promise<NormalizedPath>;
  getGlobalConfigPath(): Promise<NormalizedPath>;
  /** Workspace-level config path (may fallback to global if local not enabled). */
  getWorkspaceConfigPath(): Promise<NormalizedPath>;

  /** Arbitrary session-scoped values (non-persisted) similar to SessionConfigs. */
  getSessionValue<T>(key: ConfigKey): T | undefined;
  setSessionValue<T>(key: ConfigKey, value: T): void;
}

/** Utility predicate replicating old useLocalConfig logic (host can adapt). */
export interface LocalConfigDecider {
  useLocalConfig(): boolean;
}

export type FullConfigInterface = ConfigInterface & LocalConfigDecider;
