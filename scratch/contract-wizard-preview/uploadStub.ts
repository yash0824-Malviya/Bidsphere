import { logFixtureAction } from "./apiStub";
export async function uploadFileToERPNextDetailed(file: File, doctype: string, name: string, options: unknown) {
  logFixtureAction({ action: "upload", doctype, name, filename: file.name, options, noErpWrites: true });
  return { name: "FILE-UI-QA", file_id: "FILE-UI-QA", file_name: file.name, file_url: `/private/files/fixture-${encodeURIComponent(file.name)}` };
}
