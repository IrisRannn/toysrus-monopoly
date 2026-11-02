import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import ExcelJS from "exceljs";
import { validateQuestion, GameError } from "./engine.js";
export const COLUMNS = [
  "tile",
  "question",
  "A",
  "B",
  "C",
  "D",
  "answer",
  "explanation",
];
export async function importQuestions(format, content) {
  let rows;
  if (format === "csv")
    rows = parse(content, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
      max_record_size: 15000,
    });
  else if (format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    const bytes = Buffer.from(content, "base64");
    if (bytes.length > 5 * 1024 * 1024)
      throw new GameError("Excel文件不能超过5MB");
    await workbook.xlsx.load(bytes);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new GameError("Excel缺少工作表");
    if (sheet.rowCount > 1001) throw new GameError("一次最多导入1000题");
    const headers = sheet.getRow(1).values.slice(1).map(String);
    rows = [];
    sheet.eachRow((row, i) => {
      if (i > 1)
        rows.push(
          Object.fromEntries(
            headers.map((h, j) => [h, row.getCell(j + 1).text]),
          ),
        );
    });
  } else throw new GameError("只支持CSV或XLSX格式");
  if (!rows.length || rows.length > 1000)
    throw new GameError("请导入1–1000道题目");
  return rows.map((r, i) => {
    try {
      return validateQuestion({
        tile: Number(r.tile),
        text: r.question,
        options: { A: r.A, B: r.B, C: r.C, D: r.D },
        answer: String(r.answer || "")
          .trim()
          .toUpperCase(),
        explanation: r.explanation,
      });
    } catch (e) {
      throw new GameError(`第${i + 2}行：${e.message}`);
    }
  });
}
export function safeCsv(rows, columns) {
  // Spreadsheet formula injection protection for employee-entered nicknames.
  return (
    "\uFEFF" +
    stringify(
      rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [
            k,
            typeof v === "string" && /^[\s]*[=+@-]/.test(v) ? "'" + v : v,
          ]),
        ),
      ),
      { header: true, columns },
    )
  );
}
