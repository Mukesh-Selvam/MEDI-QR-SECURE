import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { Client } from "pg";
import { expect, test, type Browser, type Page } from "@playwright/test";

interface KeycloakTokenResponse {
  access_token: string;
}

interface KeycloakUser {
  id: string;
  username?: string;
  email?: string;
  enabled?: boolean;
  emailVerified?: boolean;
  requiredActions?: string[];
}

interface KeycloakRole {
  id: string;
  name: string;
}

interface MailpitMessages {
  messages: Array<{ ID: string; Subject: string }>;
}

interface MailpitMessage {
  Text: string;
}

const keycloakBaseUrl =
  process.env.KEYCLOAK_BASE_URL ?? "http://localhost:8080";
const browserTestBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const realm = process.env.KEYCLOAK_REALM ?? "mediqr";
const adminUsername = process.env.KEYCLOAK_ADMIN_USER ?? "admin";
const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
const testSuffix = randomUUID();
const clinicianUsername = `e2e-clinician-${testSuffix}`;
const clinicianEmail = `${clinicianUsername}@mediqr.invalid`;
const clinicianPassword = `Aa1!${randomBytes(32).toString("hex")}`;
let adminToken: string;
let clinicianKeycloakId: string;
let clinicianDatabaseId: string;
let clinicianTotpSecret = "";
const patientUserIds = new Set<string>();
const patientDatabaseIds = new Set<string>();
const emergencyVisibleDocumentIds = new Set<string>();

async function configureFakeClinicianMfa(browser: Browser): Promise<void> {
  const page = await browser.newPage();
  try {
    await page.goto(new URL("/login/clinician", browserTestBaseUrl).toString());
    await page
      .getByRole("link", { name: "Continue with secure sign-in" })
      .click();
    await page.locator("#username").fill(clinicianUsername);
    await page.locator("#password").fill(clinicianPassword);
    await page.locator("#kc-login").click();

    const setupTotp = page.locator("#kc-totp-settings-form");
    await setupTotp.waitFor({ state: "visible", timeout: 15_000 });
    await page.locator("#mode-manual").click();
    const secret = (await page.locator("#kc-totp-secret-key").innerText())
      .replace(/\s+/g, "")
      .toUpperCase();
    clinicianTotpSecret = secret;
    await page.locator("#userLabel").fill("MediQR E2E");
    await page.locator("#totp").fill(generateTotp(secret));
    await page.locator("#saveTOTPBtn").click();

    await expect(page).toHaveURL(/\/login\/clinician\?auth=mfa-setup/);
    const setupCookies = await page.context().cookies();
    expect(
      setupCookies.some(({ name }) => name === "__Host-mediqr-access"),
    ).toBe(false);
  } finally {
    await page.close();
  }
}

async function signInFakeClinician(page: Page): Promise<void> {
  if (!clinicianTotpSecret) {
    throw new Error("The shared fake clinician MFA fixture is unavailable.");
  }
  await page.goto("/login/clinician");
  await page
    .getByRole("link", { name: "Continue with secure sign-in" })
    .click();
  const usernameInput = page.locator("#username");
  if (await usernameInput.count()) {
    await usernameInput.fill(clinicianUsername);
  }
  await page.locator("#password").fill(clinicianPassword);
  await page.locator("#kc-login").click();
  await page.locator("#kc-otp-login-form").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await waitForNextTotpWindow();
  await page.locator("#otp").fill(generateTotp(clinicianTotpSecret));
  await page.locator("#kc-login").click();
  await expect(page).toHaveURL(/\/login\/clinician\?auth=success/);
}

test.describe("browser authentication", () => {
  test.beforeAll(async ({ browser }) => {
    if (!adminPassword) {
      throw new Error("KEYCLOAK_ADMIN_PASSWORD is required for browser tests.");
    }
    adminToken = await getKeycloakAdminToken();
    clinicianKeycloakId = await createFakeClinician();
    clinicianDatabaseId = await seedUnverifiedClinician();
    await configureFakeClinicianMfa(browser);
  });

  test.afterAll(async () => {
    if (emergencyVisibleDocumentIds.size) {
      const connection = await createDatabaseClient();
      try {
        await connection.connect();
        for (const documentId of emergencyVisibleDocumentIds) {
          await connection.query("DELETE FROM documents WHERE id = $1", [
            documentId,
          ]);
        }
      } finally {
        await connection.end();
      }
    }
    if (patientDatabaseIds.size || patientUserIds.size) {
      const connection = await createDatabaseClient();
      try {
        await connection.connect();
        for (const patientDatabaseId of patientDatabaseIds) {
          await connection.query(
            "DELETE FROM emergency_profiles WHERE patient_id = $1",
            [patientDatabaseId],
          );
        }
        for (const patientUserId of patientUserIds) {
          await connection.query(
            `UPDATE users
             SET status = 'suspended', phone = NULL, email = NULL, keycloak_id = NULL
             WHERE id = $1`,
            [patientUserId],
          );
        }
      } finally {
        await connection.end();
      }
    }

    if (clinicianDatabaseId) {
      const connection = await createDatabaseClient();
      try {
        await connection.connect();
        await connection.query("DELETE FROM clinicians WHERE user_id = $1", [
          clinicianDatabaseId,
        ]);
        await connection.query(
          `UPDATE users
           SET status = 'suspended', phone = NULL, email = NULL, keycloak_id = NULL
           WHERE id = $1`,
          [clinicianDatabaseId],
        );
      } finally {
        await connection.end();
      }
    }

    if (adminToken && clinicianKeycloakId) {
      await keycloakRequest(
        `/admin/realms/${realm}/users/${clinicianKeycloakId}`,
        { method: "DELETE" },
      );
    }
  });

  test("patient completes OTP sign-in using a fake number", async ({
    page,
  }) => {
    const phone = `+919${randomBytes(4).readUInt32BE(0).toString().padStart(10, "0").slice(-9)}`;
    await page.goto("/login/patient");
    await page.locator('input[type="tel"]').fill(phone.slice(3));
    await page.getByRole("button", { name: "Send Verification OTP" }).click();

    const otpInput = page.locator('input[placeholder="123456"]');
    await expect(otpInput).toBeVisible();
    const otp = await readOtpFromMailpit(phone);
    await otpInput.fill(otp);
    await page.getByRole("button", { name: "Verify & Sign In" }).click();
    await expect(
      page.getByText("Authenticated (Session Active)"),
    ).toBeVisible();
    await expect(page.getByText("Role: patient")).toBeVisible();
    const profileResponse = await page.request.get("/api/v1/auth/me");
    expect(profileResponse.ok()).toBeTruthy();
    const profile = (await profileResponse.json()) as {
      id: string;
      patientId: string | null;
    };
    patientUserIds.add(profile.id);
    expect(profile.patientId).not.toBeNull();
    expect(profile.patientId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    if (!profile.patientId) {
      throw new Error("OTP login did not return a patient profile.");
    }
    patientDatabaseIds.add(profile.patientId);

    await page.goto("/patient/emergency");
    await expect(
      page.getByRole("heading", { name: "Emergency details" }),
    ).toBeVisible();
    const emergencyOptIn = page.getByRole("checkbox", {
      name: /Allow emergency access to these details/,
    });
    await expect(emergencyOptIn).not.toBeChecked();
    await page.getByLabel("Allergies").fill("FAKE E2E declared allergy");
    await page
      .getByRole("button", { name: "Add an emergency contact" })
      .click();
    await page.getByLabel("Contact name").fill("FAKE E2E Contact");
    await page.getByLabel("Relationship").fill("guardian");
    await page.getByLabel("Contact phone").fill("+910000000000");
    await emergencyOptIn.check();
    await page.getByRole("button", { name: "Save emergency details" }).click();
    await expect(
      page
        .getByRole("status")
        .getByText("Your emergency details have been saved."),
    ).toBeVisible();
    await emergencyOptIn.uncheck();
    await page.getByRole("button", { name: "Save emergency details" }).click();
    await expect(
      page
        .getByRole("status")
        .getByText("Your emergency details have been saved."),
    ).toBeVisible();

    const documentId = randomUUID();
    const documentDate = new Date("2026-10-04T00:00:00.000Z");
    const connection = await createDatabaseClient();
    try {
      await connection.connect();
      await connection.query(
        `INSERT INTO documents (
           id, patient_id, uploader_id, upload_source, document_type,
           storage_key, storage_bucket, mime_type, file_size_bytes, status,
           scan_status, document_date
         ) VALUES (
           $1, $2, $3, 'patient-uploaded', 'prescription',
           $4, 'fake-bucket', 'application/pdf', 12, 'ready',
           'clean', $5
         )`,
        [documentId, profile.patientId, profile.id, randomUUID(), documentDate],
      );
      emergencyVisibleDocumentIds.add(documentId);
    } finally {
      await connection.end();
    }
    await page.goto("/vault/timeline");
    await expect(
      page.getByRole("heading", { name: "My Medical Records" }),
    ).toBeVisible();
    const emergencyVisibility = page.getByRole("checkbox", {
      name: /Show prescription dated/,
    });
    await expect(emergencyVisibility).toBeVisible();
    await expect(emergencyVisibility).not.toBeChecked();
    const visibilityUpdate = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response
          .url()
          .includes(
            `/api/v1/emergency-access/documents/${documentId}/visibility`,
          ),
    );
    await emergencyVisibility.click();
    const visibilityResponse = await visibilityUpdate;
    expect(visibilityResponse.status(), await visibilityResponse.text()).toBe(
      200,
    );
    await expect(emergencyVisibility).toBeChecked();
    await page.reload();
    await expect(
      page.getByRole("checkbox", { name: /Show prescription dated/ }),
    ).toBeChecked();

    await page.goto("/patient/notifications");
    await expect(
      page.getByRole("heading", { name: "Notifications" }),
    ).toBeVisible();
    await expect(
      page.getByText("There are no notifications yet."),
    ).toBeVisible();
  });

  test("emergency details stay unavailable when the account has no patient profile", async ({
    page,
  }) => {
    await page.route("**/api/v1/auth/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ patientId: null, role: "patient" }),
      }),
    );
    await page.route("**/api/v1/access/requests/inbox", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ wards: [] }),
      }),
    );

    await page.goto("/patient/emergency");
    await expect(page.locator("main p[role='alert']")).toContainText(
      "No patient profile is available for this account.",
    );
    await expect(page.locator("form")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Save emergency details" }),
    ).toHaveCount(0);
  });

  test("clinician signs in through Keycloak but unverified access is denied", async ({
    page,
  }) => {
    await signInFakeClinician(page);
    const sessionResponse = await page.request.get("/api/auth/session");
    const sessionBody: unknown = await sessionResponse.json();
    const sessionSummary =
      typeof sessionBody === "object" && sessionBody !== null
        ? {
            status: sessionResponse.status(),
            role:
              "role" in sessionBody && typeof sessionBody.role === "string"
                ? sessionBody.role
                : undefined,
            isVerified:
              "isVerified" in sessionBody &&
              typeof sessionBody.isVerified === "boolean"
                ? sessionBody.isVerified
                : undefined,
          }
        : { status: sessionResponse.status() };
    expect(sessionSummary).toEqual({
      status: 200,
      role: "clinician",
      isVerified: false,
    });
    await expect(
      page.getByRole("heading", { name: "Pending verification" }),
    ).toBeVisible();

    const patientDataResponse = await page.request.get(
      `/api/v1/patients/${randomUUID()}`,
    );
    expect(patientDataResponse.status()).toBe(403);
  });

  test("clinician scans, patient approves, reads a document, and revokes access", async ({
    browser,
  }, testInfo) => {
    const connection = await createDatabaseClient();
    let patientRecordId = "";
    try {
      await connection.connect();
      await connection.query(
        `UPDATE clinicians SET is_verified = true, verified_at = now()
         WHERE user_id = $1`,
        [clinicianDatabaseId],
      );
    } finally {
      await connection.end();
    }

    const patientContext = await browser.newContext();
    const patientPage = await patientContext.newPage();
    const phone = `+919${randomBytes(4).readUInt32BE(0).toString().padStart(10, "0").slice(-9)}`;
    await patientPage.goto("/login/patient");
    await patientPage.locator('input[type="tel"]').fill(phone.slice(3));
    await patientPage
      .getByRole("button", { name: "Send Verification OTP" })
      .click();
    const patientOtp = await readOtpFromMailpit(phone);
    await patientPage.locator('input[placeholder="123456"]').fill(patientOtp);
    await patientPage.getByRole("button", { name: "Verify & Sign In" }).click();
    await expect(
      patientPage.getByText("Authenticated (Session Active)"),
    ).toBeVisible();

    const profileResponse = await patientPage.request.get("/api/v1/auth/me");
    if (!profileResponse.ok()) {
      throw new Error("The fake patient session could not be resolved.");
    }
    const profile = (await profileResponse.json()) as {
      id?: string;
      patientId?: string | null;
    };
    if (!profile.id)
      throw new Error("The fake patient session was not resolved.");
    if (!profile.patientId) {
      throw new Error("The fake patient profile was not provisioned.");
    }
    patientUserIds.add(profile.id);
    patientDatabaseIds.add(profile.patientId);
    patientRecordId = profile.patientId;
    if (!patientRecordId)
      throw new Error("The fake patient record was not created.");

    await patientPage.goto("/patient/credentials");
    const credentialResponsePromise = patientPage.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/qr/credentials") &&
        response.request().method() === "POST",
    );
    await patientPage
      .getByRole("button", { name: "Create printed QR" })
      .click();
    const credentialResponse = await credentialResponsePromise;
    if (!credentialResponse.ok()) {
      throw new Error("The patient QR credential could not be issued.");
    }
    const credential = (await credentialResponse.json()) as {
      credentialToken?: string;
    };
    if (!credential.credentialToken) {
      throw new Error("The patient QR credential response was incomplete.");
    }

    const uploadResult = await patientPage.evaluate(
      async ({ patientId, pdfContent }) => {
        const csrfCookie = document.cookie
          .split("; ")
          .find((item) => item.startsWith("__Host-mediqr-csrf="));
        const csrfToken = csrfCookie
          ? decodeURIComponent(csrfCookie.slice("__Host-mediqr-csrf=".length))
          : "";
        const form = new FormData();
        form.append("documentType", "lab");
        form.append("patientId", patientId);
        form.append("documentDate", new Date().toISOString());
        form.append(
          "file",
          new File([pdfContent], "fake-lab.pdf", {
            type: "application/pdf",
          }),
        );
        const response = await fetch("/api/v1/vault/upload", {
          method: "POST",
          headers: {
            "x-csrf-token": csrfToken,
            "x-mediqr-patient-id": patientId,
          },
          body: form,
          cache: "no-store",
        });
        const body: unknown = await response.json();
        return { status: response.status, body };
      },
      { patientId: patientRecordId, pdfContent: createMinimalTestPdf() },
    );
    if (uploadResult.status !== 202) {
      throw new Error("The fake record could not be staged for scanning.");
    }
    const uploadedDocumentId =
      typeof uploadResult.body === "object" &&
      uploadResult.body !== null &&
      "id" in uploadResult.body &&
      typeof uploadResult.body.id === "string"
        ? uploadResult.body.id
        : undefined;
    if (!uploadedDocumentId) {
      throw new Error("The fake record upload response was incomplete.");
    }
    await expect
      .poll(async () => {
        const response = await patientPage.request.get(
          `/api/v1/vault/${uploadedDocumentId}/status`,
        );
        if (!response.ok()) return "unavailable";
        const state = (await response.json()) as { status?: string };
        return state.status;
      })
      .toBe("ready");

    const clinicianContext = await browser.newContext();
    const clinicianPage = await clinicianContext.newPage();
    await signInFakeClinician(clinicianPage);

    await clinicianPage.goto(
      `/request-access/#credential=${encodeURIComponent(credential.credentialToken)}`,
    );
    await expect(
      clinicianPage.getByRole("checkbox", { name: "Laboratory results" }),
    ).toBeVisible({ timeout: 15_000 });
    await clinicianPage
      .getByRole("checkbox", { name: "Laboratory results" })
      .check();
    const accessRequestResponsePromise = clinicianPage.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/access/requests") &&
        response.request().method() === "POST",
    );
    await clinicianPage
      .getByRole("button", { name: "Send request to patient" })
      .click();
    const accessRequestResponse = await accessRequestResponsePromise;
    if (!accessRequestResponse.ok()) {
      const failure: unknown = await accessRequestResponse.json();
      const message =
        typeof failure === "object" &&
        failure !== null &&
        "message" in failure &&
        typeof failure.message === "string"
          ? failure.message
          : "No public error detail was returned.";
      throw new Error(
        `The access request failed with HTTP ${accessRequestResponse.status()}: ${message}`,
      );
    }
    const accessRequestBody = (await accessRequestResponse.json()) as {
      requestId?: string;
    };
    if (!accessRequestBody.requestId) {
      throw new Error("The access request response was incomplete.");
    }
    await expect(
      clinicianPage.getByText(
        "Request sent. Waiting for the patient to review it.",
      ),
    ).toBeVisible();

    await patientPage.goto("/patient/access");
    await expect(
      patientPage.getByRole("heading", { name: "Review this request" }),
    ).toBeVisible();
    await expect(
      patientPage.getByText("Laboratory results", { exact: true }),
    ).toBeVisible();
    await expect(patientPage.getByText(/access lasts 24 hours/i)).toBeVisible();
    await patientPage.getByRole("button", { name: "Approve access" }).click();
    await expect(
      patientPage.getByRole("status").filter({ hasText: "Access approved" }),
    ).toBeVisible();
    await patientPage.screenshot({
      path: testInfo.outputPath("consent-flow-approved.png"),
      fullPage: true,
    });

    const consoleStatusResponsePromise = clinicianPage.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/access/requests/") &&
        response.url().endsWith("/status") &&
        response.request().method() === "GET",
    );
    const consoleTimelineResponsePromise = clinicianPage.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/vault/requests/") &&
        response.url().endsWith("/timeline") &&
        response.request().method() === "GET",
    );
    await clinicianPage
      .getByRole("link", { name: "Open clinician records console" })
      .click();
    const consoleStatusResponse = await consoleStatusResponsePromise;
    if (!consoleStatusResponse.ok()) {
      const failure: unknown = await consoleStatusResponse.json();
      const publicMessage =
        typeof failure === "object" &&
        failure !== null &&
        "message" in failure &&
        typeof failure.message === "string"
          ? failure.message.replace(
              /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
              "[opaque id]",
            )
          : "No public error detail was returned.";
      throw new Error(
        `The clinician status check returned HTTP ${consoleStatusResponse.status()}: ${publicMessage}`,
      );
    }
    expect(consoleStatusResponse.status()).toBe(200);
    const consoleTimelineResponse = await consoleTimelineResponsePromise;
    expect(consoleTimelineResponse.status()).toBe(200);
    await expect(
      clinicianPage.getByRole("heading", {
        name: "Consent-scoped record view",
      }),
    ).toBeVisible();
    await expect(clinicianPage.getByText("Access is active")).toBeVisible();
    await expect(
      clinicianPage.getByRole("heading", { name: "Laboratory records" }),
    ).toBeVisible();
    await clinicianPage
      .getByRole("region", { name: "Record timeline" })
      .getByRole("button", { name: /Patient uploaded/ })
      .click();
    await expect(
      clinicianPage.locator(
        'section[aria-label="Read-only secure record viewer"] canvas',
      ),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      clinicianPage.getByRole("button", { name: /download/i }),
    ).toHaveCount(0);

    const firstRead = await clinicianPage.request.get(
      `/api/v1/vault/${uploadedDocumentId}/stream`,
    );
    expect(firstRead.status()).toBe(200);
    expect(firstRead.headers()["content-type"]).toContain("application/pdf");
    expect((await firstRead.body()).toString()).toContain("%PDF-1.4");

    await patientPage.getByRole("button", { name: "End this access" }).click();
    await expect(
      patientPage.getByRole("status").filter({ hasText: "Access ended" }),
    ).toBeVisible();
    await expect(
      clinicianPage
        .getByRole("alert")
        .filter({ hasText: "Consent has been revoked" }),
    ).toBeVisible({
      timeout: 10_000,
    });
    await patientPage.screenshot({
      path: testInfo.outputPath("consent-flow-revoked.png"),
      fullPage: true,
    });

    function createMinimalTestPdf(): string {
      const content = "BT /F1 16 Tf 24 120 Td (Fake laboratory record) Tj ET\n";
      const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
      ];
      let document = "%PDF-1.4\n";
      const offsets: number[] = [];
      for (const [index, body] of objects.entries()) {
        offsets.push(Buffer.byteLength(document));
        document += `${index + 1} 0 obj\n${body}\nendobj\n`;
      }

      const crossReferenceOffset = Buffer.byteLength(document);
      document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
      for (const offset of offsets) {
        document += `${String(offset).padStart(10, "0")} 00000 n \n`;
      }
      document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
      document += `startxref\n${crossReferenceOffset}\n%%EOF`;
      return document;
    }

    const readAfterRevocation = await clinicianPage.request.get(
      `/api/v1/vault/${uploadedDocumentId}/stream`,
    );
    expect(readAfterRevocation.status()).toBe(403);
    const historyText = await patientPage
      .locator('section[aria-labelledby="history-heading"]')
      .innerText();
    expect(historyText).toContain("requested access");
    expect(historyText).toContain("approved access");
    expect(historyText).toContain("viewed a laboratory record");
    expect(historyText).toContain("ended access");
    expect(historyText).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    expect(historyText).not.toContain("fake-lab.pdf");
    await expectCliToDetectAuditTampering(accessRequestBody.requestId);
    await clinicianContext.close();
    await patientContext.close();
  });
});

async function expectCliToDetectAuditTampering(
  requestId: string,
): Promise<void> {
  const connection = await createDatabaseClient();
  let auditEventId: string | undefined;
  let originalAction: string | undefined;
  let tamperingCommitted = false;

  try {
    await connection.connect();
    const event = await connection.query<{
      id: string;
      action: string;
    }>(
      `SELECT id, action
       FROM audit_events
       WHERE resource_type = 'access_request'
         AND resource_id = $1
         AND action = 'DOCUMENT_TIMELINE_VIEWED'
       ORDER BY event_index DESC
       LIMIT 1`,
      [requestId],
    );
    auditEventId = event.rows[0]?.id;
    originalAction = event.rows[0]?.action;
    if (!auditEventId || !originalAction) {
      throw new Error("The consent-scoped timeline audit event is missing.");
    }

    await connection.query("BEGIN");
    await connection.query("ALTER TABLE audit_events DISABLE TRIGGER USER");
    await connection.query(
      "UPDATE audit_events SET action = 'AUDIT_CHAIN_TAMPER_TEST' WHERE id = $1",
      [auditEventId],
    );
    await connection.query("ALTER TABLE audit_events ENABLE TRIGGER USER");
    await connection.query("COMMIT");
    tamperingCommitted = true;

    const verifier = spawnSync(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["--filter", "@mediqr/api", "audit:verify"],
      {
        cwd: resolve(process.cwd(), "../.."),
        encoding: "utf8",
        shell: process.platform === "win32",
        timeout: 60_000,
      },
    );
    const verifierOutput = `${verifier.stdout ?? ""}${verifier.stderr ?? ""}`;
    if (
      verifier.error ||
      verifier.status === 0 ||
      !verifierOutput.includes("Audit chain verification failed")
    ) {
      throw new Error(
        "The audit verifier CLI did not detect the tampered row.",
      );
    }
  } finally {
    if (tamperingCommitted && auditEventId && originalAction) {
      await connection.query("BEGIN");
      await connection.query("ALTER TABLE audit_events DISABLE TRIGGER USER");
      await connection.query(
        "UPDATE audit_events SET action = $1 WHERE id = $2",
        [originalAction, auditEventId],
      );
      await connection.query("ALTER TABLE audit_events ENABLE TRIGGER USER");
      await connection.query("COMMIT");
    }
    await connection.end();
  }
}

async function getKeycloakAdminToken(): Promise<string> {
  const response = await fetch(
    `${keycloakBaseUrl}/realms/master/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "admin-cli",
        username: adminUsername,
        password: adminPassword!,
      }),
    },
  );
  if (!response.ok)
    throw new Error("Could not authenticate the browser-test administrator.");
  return ((await response.json()) as KeycloakTokenResponse).access_token;
}

async function createFakeClinician(): Promise<string> {
  const createResponse = await keycloakRequest(`/admin/realms/${realm}/users`, {
    method: "POST",
    body: JSON.stringify({
      username: clinicianUsername,
      email: clinicianEmail,
      enabled: true,
      emailVerified: true,
    }),
  });
  if (createResponse.status !== 201) {
    throw new Error("Could not create the fake Keycloak clinician.");
  }

  const searchResponse = await keycloakRequest(
    `/admin/realms/${realm}/users?username=${encodeURIComponent(clinicianUsername)}&exact=true`,
  );
  const users = (await searchResponse.json()) as KeycloakUser[];
  const user = users[0];
  const id = user?.id;
  if (!searchResponse.ok || !id || !user) {
    throw new Error("Could not resolve the fake Keycloak clinician.");
  }

  const roleResponse = await keycloakRequest(
    `/admin/realms/${realm}/roles/clinician`,
  );
  const role = (await roleResponse.json()) as KeycloakRole;
  if (!roleResponse.ok)
    throw new Error("Could not load the clinician realm role.");
  const mappingResponse = await keycloakRequest(
    `/admin/realms/${realm}/users/${id}/role-mappings/realm`,
    {
      method: "POST",
      body: JSON.stringify([role]),
    },
  );
  if (mappingResponse.status !== 204) {
    throw new Error("Could not assign the fake clinician realm role.");
  }

  const passwordResponse = await keycloakRequest(
    `/admin/realms/${realm}/users/${id}/reset-password`,
    {
      method: "PUT",
      body: JSON.stringify({
        type: "password",
        value: clinicianPassword,
        temporary: false,
      }),
    },
  );
  if (passwordResponse.status !== 204) {
    throw new Error("Could not set the fake clinician test credential.");
  }

  const setupMfaResponse = await keycloakRequest(
    `/admin/realms/${realm}/users/${id}`,
    {
      method: "PUT",
      body: JSON.stringify({
        ...user,
        requiredActions: ["CONFIGURE_TOTP"],
      }),
    },
  );
  if (setupMfaResponse.status !== 204) {
    throw new Error("Could not require MFA setup for the fake clinician.");
  }
  return id;
}

async function seedUnverifiedClinician(): Promise<string> {
  const connection = await createDatabaseClient();
  try {
    await connection.connect();
    const result = await connection.query<{ id: string }>(
      `INSERT INTO users (keycloak_id, email, role, status)
       VALUES ($1, $2, 'clinician', 'active')
       RETURNING id`,
      [clinicianKeycloakId, clinicianEmail],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Could not seed the fake clinician account.");
    await connection.query(
      `INSERT INTO clinicians
         (user_id, full_name, registration_number, state_medical_council, is_verified)
       VALUES ($1, $2, $3, $4, false)`,
      [id, "Fake E2E Clinician", `E2E-${testSuffix}`, "Fake Test Council"],
    );
    return id;
  } finally {
    await connection.end();
  }
}

async function createDatabaseClient(): Promise<Client> {
  return new Client({
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? "5432"),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
}

async function keycloakRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${keycloakBaseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${adminToken}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

async function readOtpFromMailpit(phone: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const listResponse = await fetch(
      "http://127.0.0.1:8025/api/v1/messages?limit=50",
    );
    if (listResponse.ok) {
      const list = (await listResponse.json()) as MailpitMessages;
      const message = list.messages.find((entry) =>
        entry.Subject.includes(phone),
      );
      if (message) {
        const detailResponse = await fetch(
          `http://127.0.0.1:8025/api/v1/message/${encodeURIComponent(message.ID)}`,
        );
        if (detailResponse.ok) {
          const detail = (await detailResponse.json()) as MailpitMessage;
          const otp = /one-time password is:\s*(\d{6})/.exec(detail.Text)?.[1];
          if (otp) return otp;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The development OTP was not delivered to Mailpit.");
}

function generateTotp(base32Secret: string): string {
  const secret = decodeBase32(base32Secret);
  const counter = BigInt(Math.floor(Date.now() / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, "0");
}

async function waitForNextTotpWindow(): Promise<void> {
  const elapsedInWindow = Date.now() % 30_000;
  await new Promise((resolve) =>
    setTimeout(resolve, 30_000 - elapsedInWindow + 1_000),
  );
}

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bitBuffer = 0;
  let bitCount = 0;
  const bytes: number[] = [];
  for (const character of value.replace(/=+$/, "")) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("Keycloak provided an invalid TOTP secret.");
    bitBuffer = (bitBuffer << 5) | digit;
    bitCount += 5;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((bitBuffer >> bitCount) & 0xff);
    }
  }
  return Buffer.from(bytes);
}
