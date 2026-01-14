/**
 * Generate Excel template for campaign recipients
 * Run with: node scripts/generateExcelTemplate.js
 */

const XLSX = require('xlsx');
const path = require('path');

// Create workbook
const wb = XLSX.utils.book_new();

// Header row
const headers = ['phone', 'name', 'company'];
for (let i = 1; i <= 20; i++) {
    headers.push(`var${i}`);
}

// Sample data rows (phone as text with leading apostrophe)
const data = [
    headers,
    ['201001234567', 'أحمد محمد', 'شركة ABC', 'قيمة 1', 'قيمة 2', 'قيمة 3', 'قيمة 4', 'قيمة 5', 'قيمة 6', 'قيمة 7', 'قيمة 8', 'قيمة 9', 'قيمة 10', 'قيمة 11', 'قيمة 12', 'قيمة 13', 'قيمة 14', 'قيمة 15', 'قيمة 16', 'قيمة 17', 'قيمة 18', 'قيمة 19', 'قيمة 20'],
    ['201119876543', 'سارة أحمد', 'شركة XYZ', 'متغير أ', 'متغير ب', 'متغير ج', 'متغير د', 'متغير هـ', 'متغير و', 'متغير ز', 'متغير ح', 'متغير ط', 'متغير ي', 'متغير ك', 'متغير ل', 'متغير م', 'متغير ن', 'متغير س', 'متغير ع', 'متغير ف', 'متغير ص', 'متغير ق', 'متغير ر'],
    ['201551112222', 'محمد علي', 'مؤسسة الفا', 'بيانات 1', 'بيانات 2', 'بيانات 3', 'بيانات 4', 'بيانات 5', 'بيانات 6', 'بيانات 7', 'بيانات 8', 'بيانات 9', 'بيانات 10', 'بيانات 11', 'بيانات 12', 'بيانات 13', 'بيانات 14', 'بيانات 15', 'بيانات 16', 'بيانات 17', 'بيانات 18', 'بيانات 19', 'بيانات 20']
];

// Create worksheet
const ws = XLSX.utils.aoa_to_sheet(data);

// Set phone column to text format (column A)
const range = XLSX.utils.decode_range(ws['!ref']);
for (let row = 1; row <= range.e.r; row++) {
    const cellAddress = XLSX.utils.encode_cell({ r: row, c: 0 });
    if (ws[cellAddress]) {
        ws[cellAddress].t = 's'; // Force text type
        ws[cellAddress].z = '@'; // Text format
    }
}

// Set column widths
ws['!cols'] = [
    { wch: 15 },  // phone
    { wch: 20 },  // name
    { wch: 20 },  // company
    ...Array(20).fill({ wch: 12 })  // var1-var20
];

// Add worksheet to workbook
XLSX.utils.book_append_sheet(wb, ws, 'Recipients');

// Write file
const outputPath = path.join(__dirname, '../public/campaigns/templates/recipients.xlsx');
XLSX.writeFile(wb, outputPath);

console.log(`✅ Excel template created: ${outputPath}`);
console.log('📋 Columns: phone, name, company, var1-var20');
console.log('📱 Phone numbers are formatted as text (will not show as scientific notation)');
