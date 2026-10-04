import { describe, expect, it } from "vitest";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { KMS_ADAPTER_TOKEN } from "../crypto/vault-crypto.service.js";
import { LocalKmsAdapter } from "../kms/local-kms.adapter.js";
import { StorageService } from "../storage/storage.service.js";
import { VaultModule } from "../vault.module.js";

describe("VaultModule provider configuration", () => {
  it("registers the environment-configured storage service and local KMS adapter binding", () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, VaultModule) as unknown[];

    expect(providers).toContain(StorageService);
    expect(providers).toContain(LocalKmsAdapter);
    expect(providers).toContainEqual({
      provide: KMS_ADAPTER_TOKEN,
      useExisting: LocalKmsAdapter,
    });
  });
});
