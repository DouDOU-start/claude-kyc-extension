import assert from "node:assert/strict";
import test from "node:test";

import { buildXLSXBytes } from "../extension/lib/xlsx.js";

test("XLSX output is a ZIP workbook with inline worksheet data", () => {
  const bytes = buildXLSXBytes({
    sheetName: "KYC结果",
    columns: [
      { header: "序号", key: "index", width: 6 },
      { header: "SK", key: "sk", width: 30 },
      { header: "状态", key: "status", width: 14 },
    ],
    rows: [
      { index: 1, sk: "sk-****-1234", status: "已验证" },
      { index: 2, sk: "sk-****-5678", status: "等待验证" },
    ],
  });
  const buffer = Buffer.from(bytes);
  assert.equal(buffer.subarray(0, 4).toString("hex"), "504b0304");
  assert.equal(buffer.includes(Buffer.from("[Content_Types].xml")), true);
  assert.equal(buffer.includes(Buffer.from("xl/worksheets/sheet1.xml")), true);
  assert.equal(buffer.includes(Buffer.from("<t xml:space=\"preserve\">已验证</t>")), true);
  assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50);
});
