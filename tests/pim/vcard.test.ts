import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseVCardBundle, PimService, VCardParseError } from "../../src/main/pim";

const contentOnly = <Entity extends { uid: string; createdAt: string; updatedAt: string; revision: number }>(entity: Entity) => {
  const { createdAt: _createdAt, updatedAt: _updatedAt, revision: _revision, ...content } = entity;
  return content;
};

describe("vCard import and export", () => {
  it("round-trips stable UIDs, Unicode, escaping, multiple values, structured addresses, and mailing-list members", async () => {
    const sourceDirectory = await mkdtemp(path.join(os.tmpdir(), "material-email-vcard-source-"));
    const source = new PimService(sourceDirectory);
    const contact = await source.createContact({
      uid: "92d5b61b-a55e-4d02-a9d1-29124e389900",
      displayName: "陳美玲, Mei-Ling Chan",
      name: { given: "美玲", family: "陳", suffix: "PhD" },
      nickname: "Mei;Ling",
      emails: [
        { value: "mei.ling@example.test", types: ["work"], preferred: true },
        { value: "ml@example.test", types: ["home"] },
      ],
      phones: [
        { value: "+852 2123 4567", types: ["work", "voice"], preferred: true },
        { value: "+852 9123 4567", types: ["cell"] },
      ],
      addresses: [
        {
          extended: "18/F; East Wing",
          street: "1 Queen's Road Central",
          locality: "Hong Kong",
          region: "HK",
          postalCode: "000000",
          country: "Hong Kong",
          types: ["work"],
          preferred: true,
        },
      ],
      organization: "Very Long Local-First Computing Cooperative with Enough Characters to Exercise UTF-8 Line Folding",
      title: "Principal Engineer",
      notes: "Line one, with comma; and semicolon.\n第二行保留換行。",
    });
    const mailingList = await source.createMailingList({
      uid: "97d3f14f-d5a8-4ce8-9b78-e28d0c45fe52",
      name: "香港工程師",
      description: "Local contacts only",
      memberUids: [contact.uid],
    });

    const exported = await source.exportVCard();
    expect(exported).toContain("VERSION:4.0\r\n");
    expect(exported).toContain("KIND:group\r\n");
    expect(exported).toMatch(/\r\n [^\r\n]+/);
    expect(exported.endsWith("\r\n")).toBe(true);

    const targetDirectory = await mkdtemp(path.join(os.tmpdir(), "material-email-vcard-target-"));
    const target = new PimService(targetDirectory);
    const imported = await target.importVCard(exported);
    expect(imported.created).toBe(2);
    expect(imported.updated).toBe(0);
    expect(imported.unchanged).toBe(0);
    expect(contentOnly(imported.contacts[0]!)).toEqual(contentOnly(contact));
    expect(contentOnly(imported.mailingLists[0]!)).toEqual(contentOnly(mailingList));
    expect((await target.listMailingListMembers(mailingList.uid)).map(member => member.uid)).toEqual([contact.uid]);

    const secondImport = await target.importVCard(exported);
    expect(secondImport).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
  });

  it("imports quoted-printable vCard 3.0 text and rejects malformed or ambiguous bundles", () => {
    const parsed = parseVCardBundle(
      [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "UID:legacy-contact",
        "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9 Contact",
        "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Contact;Jos=C3=A9;;;",
        "EMAIL;TYPE=INTERNET;TYPE=PREF:legacy@example.test",
        "TEL;TYPE=CELL:+1 555 0100",
        "NOTE;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Line=20one=",
        "=0ALine=20two",
        "END:VCARD",
        "",
      ].join("\r\n"),
    );
    expect(parsed.contacts[0]).toMatchObject({
      uid: "legacy-contact",
      displayName: "José Contact",
      name: { given: "José", family: "Contact" },
      emails: [{ value: "legacy@example.test", preferred: true }],
      phones: [{ value: "+1 555 0100" }],
      notes: "Line one\nLine two",
    });

    expect(() => parseVCardBundle("BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Missing end")).toThrow(VCardParseError);
    expect(() =>
      parseVCardBundle(
        "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:duplicate\r\nFN:One\r\nEND:VCARD\r\n" +
          "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:duplicate\r\nFN:Two\r\nEND:VCARD\r\n",
      ),
    ).toThrow("Duplicate contact UID");
    expect(() => parseVCardBundle("BEGIN:VCARD\r\nUID:no-version\r\nFN:No Version\r\nEND:VCARD\r\n")).toThrow(
      "exactly one VERSION",
    );
    expect(() =>
      parseVCardBundle("BEGIN:VCARD\r\nVERSION:4.0\r\nUID:one\r\nUID:two\r\nFN:Duplicate UID\r\nEND:VCARD\r\n"),
    ).toThrow("more than one UID");
  });

  it("resolves mailto mailing-list members without silently discarding unresolved URIs", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-vcard-mailto-"));
    const service = new PimService(directory);
    const bundle = [
      "BEGIN:VCARD",
      "VERSION:4.0",
      "UID:mailto-contact",
      "FN:Mailto Contact",
      "EMAIL:member@example.test",
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:4.0",
      "UID:mailto-list",
      "KIND:group",
      "FN:Mailto List",
      "MEMBER:mailto:member@example.test",
      "END:VCARD",
      "",
    ].join("\r\n");

    await service.importVCard(bundle);
    expect((await service.listMailingListMembers("mailto-list")).map(contact => contact.uid)).toEqual(["mailto-contact"]);

    expect(() =>
      parseVCardBundle(
        "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:bad-list\r\nKIND:group\r\nFN:Bad List\r\nMEMBER:https://example.test/contact\r\nEND:VCARD\r\n",
      ),
    ).toThrow("Unsupported mailing-list MEMBER URI");

    const unmatchedDirectory = await mkdtemp(path.join(os.tmpdir(), "material-email-vcard-unmatched-"));
    const unmatched = new PimService(unmatchedDirectory);
    await expect(
      unmatched.importVCard(
        "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:missing-list\r\nKIND:group\r\nFN:Missing List\r\nMEMBER:mailto:missing@example.test\r\nEND:VCARD\r\n",
      ),
    ).rejects.toThrow("does not match");
    expect(await unmatched.listMailingLists()).toEqual([]);
  });
});
