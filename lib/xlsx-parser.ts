import * as XLSX from "xlsx";

export async function parseXlsx(buf: Buffer) {
  const workbook = XLSX.read(buf, { type: "buffer" });
  const sheetName = workbook.SheetNames[0]; // Take the first sheet
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" }); 
  return rows; 
}
