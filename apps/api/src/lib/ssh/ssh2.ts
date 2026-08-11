import ssh2 from 'ssh2';

/**
 * ssh2 hâlâ CommonJS yayınlıyor. ESM tarafında `import { utils } from 'ssh2'`
 * derleme aşamasında geçiyor ama çalışma zamanında
 * "Named export 'utils' not found" ile patlıyor. Interop'u tek bir yerde
 * çözüp uygulamanın geri kalanının bunu bilmesine gerek bırakmıyoruz.
 */
export const { Client, utils } = ssh2;

/** `new Client()` örneğinin tipi — tip konumunda değer adı kullanılamıyor. */
export type Client = InstanceType<typeof ssh2.Client>;

export type {
  ConnectConfig,
  ClientChannel,
  SFTPWrapper,
  PseudoTtyOptions,
  Stats,
  FileEntry,
  FileEntryWithStats,
} from 'ssh2';
