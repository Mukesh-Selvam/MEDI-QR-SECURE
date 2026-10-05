"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { z } from "zod";

const profileSchema = z.object({
  bloodGroup: z.string(),
  allergies: z.array(z.string()),
  emergencyContacts: z.array(
    z.object({
      name: z.string(),
      relationship: z.string(),
      phone: z.string(),
    }),
  ),
  enabled: z.boolean(),
});
const userSchema = z.object({
  patientId: z.string().uuid().nullable(),
  role: z.string(),
});
const wardsSchema = z.object({
  wards: z.array(z.object({ id: z.string().uuid(), label: z.string() })),
});

type Profile = z.infer<typeof profileSchema>;

const emptyProfile: Profile = {
  bloodGroup: "",
  allergies: [],
  emergencyContacts: [],
  enabled: false,
};

function readCsrfCookie(): string {
  const cookie = document.cookie
    .split("; ")
    .find((part) => part.startsWith("__Host-mediqr-csrf="));
  return cookie ? decodeURIComponent(cookie.split("=").slice(1).join("=")) : "";
}

export default function PatientEmergencyProfilePage() {
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [allergyText, setAllergyText] = useState("");
  const [patientId, setPatientId] = useState("");
  const [patientChoices, setPatientChoices] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (requestedPatientId?: string) => {
    setLoading(true);
    setError("");
    try {
      const [userResponse, inboxResponse] = await Promise.all([
        fetch("/api/v1/auth/me", { cache: "no-store" }),
        fetch("/api/v1/access/requests/inbox", { cache: "no-store" }),
      ]);
      if (!userResponse.ok)
        throw new Error("Sign in to manage emergency details.");
      const user = userSchema.parse(await userResponse.json());
      const inbox = inboxResponse.ok
        ? wardsSchema.parse(await inboxResponse.json())
        : { wards: [] };
      const choices = [
        ...(user.patientId
          ? [{ id: user.patientId, label: "My profile" }]
          : []),
        ...inbox.wards,
      ];
      const target =
        requestedPatientId &&
        choices.some(({ id }) => id === requestedPatientId)
          ? requestedPatientId
          : choices[0]?.id;
      setPatientChoices(choices);
      if (!target)
        throw new Error("No patient profile is available for this account.");
      setPatientId(target);
      const response = await fetch(`/api/v1/emergency/profiles/${target}`, {
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error("Emergency details could not be loaded.");
      const nextProfile = profileSchema.parse(await response.json());
      setProfile(nextProfile);
      setAllergyText(nextProfile.allergies.join("\n"));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Emergency details could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patientId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const csrfToken = readCsrfCookie();
      if (!csrfToken)
        throw new Error("Your secure session expired. Sign in again.");
      const response = await fetch(`/api/v1/emergency/profiles/${patientId}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          ...profile,
          allergies: allergyText
            .split("\n")
            .map((value) => value.trim())
            .filter(Boolean),
        }),
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error("Emergency details could not be saved.");
      setNotice("Your emergency details have been saved.");
      await load(patientId);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Emergency details could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  function updateContact(
    index: number,
    field: "name" | "relationship" | "phone",
    value: string,
  ) {
    setProfile((current) => {
      const contacts = [...current.emergencyContacts];
      const existing = contacts[index] ?? {
        name: "",
        relationship: "",
        phone: "",
      };
      contacts[index] = { ...existing, [field]: value };
      return { ...current, emergencyContacts: contacts };
    });
  }

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10" aria-busy="true">
        <div className="h-8 w-2/3 animate-pulse rounded bg-[#FBEAE6]" />
        <div className="mt-6 h-48 animate-pulse rounded bg-[#FBEAE6]" />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 text-[#2B2230]">
      <h1 className="font-serif text-3xl font-semibold">Emergency details</h1>
      <p className="mt-3 max-w-[65ch] leading-7">
        These details are entered by you. They are shared only during an
        approved emergency access request.
      </p>

      {patientChoices.length > 1 && (
        <label className="mt-6 block">
          <span className="mb-2 block font-medium">
            Manage a child&apos;s profile
          </span>
          <select
            value={patientId}
            onChange={(event) => void load(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-[#8B7D88] bg-white px-3"
          >
            {patientChoices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <form onSubmit={save} className="mt-8 space-y-6">
        <label className="block">
          <span className="mb-2 block font-medium">Blood group</span>
          <select
            value={profile.bloodGroup}
            onChange={(event) =>
              setProfile((current) => ({
                ...current,
                bloodGroup: event.target.value,
              }))
            }
            className="min-h-11 w-full rounded-lg border border-[#8B7D88] bg-white px-3"
          >
            <option value="">Not provided</option>
            {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"].map(
              (group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ),
            )}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block font-medium">Allergies</span>
          <span className="mb-2 block text-sm">
            Enter one patient-declared item per line. Do not enter diagnoses.
          </span>
          <textarea
            value={allergyText}
            onChange={(event) => setAllergyText(event.target.value)}
            rows={4}
            className="w-full rounded-lg border border-[#8B7D88] bg-white p-3"
          />
        </label>

        <fieldset className="space-y-4">
          <legend className="font-medium">Emergency contacts</legend>
          {profile.emergencyContacts.map((contact, index) => (
            <div
              key={index}
              className="space-y-3 border-l-2 border-[#E8735A] pl-4"
            >
              <label className="block">
                <span className="mb-2 block">Contact name</span>
                <input
                  value={contact.name}
                  onChange={(event) =>
                    updateContact(index, "name", event.target.value)
                  }
                  maxLength={120}
                  className="min-h-11 w-full rounded-lg border border-[#8B7D88] bg-white px-3 dark:bg-[#322936]"
                />
              </label>
              <label className="block">
                <span className="mb-2 block">Relationship</span>
                <input
                  value={contact.relationship}
                  onChange={(event) =>
                    updateContact(index, "relationship", event.target.value)
                  }
                  maxLength={64}
                  className="min-h-11 w-full rounded-lg border border-[#8B7D88] bg-white px-3 dark:bg-[#322936]"
                />
              </label>
              <label className="block">
                <span className="mb-2 block">Contact phone</span>
                <input
                  type="tel"
                  value={contact.phone}
                  onChange={(event) =>
                    updateContact(index, "phone", event.target.value)
                  }
                  maxLength={32}
                  className="min-h-11 w-full rounded-lg border border-[#8B7D88] bg-white px-3 dark:bg-[#322936]"
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  setProfile((current) => ({
                    ...current,
                    emergencyContacts: current.emergencyContacts.filter(
                      (_contact, contactIndex) => contactIndex !== index,
                    ),
                  }))
                }
                className="min-h-11 px-3 font-semibold text-[#7B2930] underline underline-offset-4 dark:text-[#F2B9AC]"
              >
                Remove contact
              </button>
            </div>
          ))}
          {profile.emergencyContacts.length < 5 && (
            <button
              type="button"
              onClick={() =>
                setProfile((current) => ({
                  ...current,
                  emergencyContacts: [
                    ...current.emergencyContacts,
                    { name: "", relationship: "", phone: "" },
                  ],
                }))
              }
              className="min-h-11 rounded-lg border border-[#8B7D88] px-4 font-semibold"
            >
              Add an emergency contact
            </button>
          )}
        </fieldset>

        <label className="flex min-h-11 items-start gap-3">
          <input
            type="checkbox"
            checked={profile.enabled}
            onChange={(event) =>
              setProfile((current) => ({
                ...current,
                enabled: event.target.checked,
              }))
            }
            className="mt-1 size-5 accent-[#4A1D3F]"
          />
          <span>
            Allow emergency access to these details. Off by default. Turning
            this off blocks new emergency access and revokes any active
            emergency grant.
          </span>
        </label>

        {error && (
          <p role="alert" className="text-[#9E3028]">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-[#275A43]">
            {notice}
          </p>
        )}
        <button
          type="submit"
          disabled={saving}
          className="min-h-11 rounded-lg bg-[#4A1D3F] px-5 font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save emergency details"}
        </button>
      </form>
    </main>
  );
}
