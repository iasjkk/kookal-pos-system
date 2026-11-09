
/**
 * KOOKAL POS - Google Apps Script Storage Backend
 *
 * Initial responsibilities:
 * 1. Connect to the Google Sheets database.
 * 2. Verify required database tabs.
 * 3. Initialize column headers without deleting existing data.
 * 4. Verify and prepare Drive storage folders.
 *
 * Authentication and billing APIs will be added in later steps.
 */

const KOOKAL_SCHEMA = {
  Users: [
    "user_id",
    "username",
    "password_hash",
    "password_salt",
    "role",
    "status",
    "created_at",
    "created_by",
    "last_login"
  ],

  Categories: [
    "category_id",
    "name",
    "description",
    "display_order",
    "status",
    "created_at",
    "updated_at"
  ],

  Menu_Items: [
    "item_id",
    "category_id",
    "name",
    "description",
    "price",
    "gst_rate",
    "status",
    "created_at",
    "updated_at"
  ],

  Bills: [
    "bill_id",
    "bill_number",
    "bill_date",
    "cashier_id",
    "subtotal",
    "discount",
    "gst_amount",
    "grand_total",
    "payment_status",
    "bill_status",
    "cancelled_by",
    "cancellation_reason",
    "created_at",
    "cancelled_at"
  ],

  Bill_Items: [
    "bill_item_id",
    "bill_id",
    "item_id",
    "item_name",
    "quantity",
    "unit_price",
    "gst_rate",
    "gst_amount",
    "line_total"
  ],

  Payments: [
    "payment_id",
    "bill_id",
    "payment_method",
    "amount",
    "transaction_reference",
    "created_at"
  ],

  Audit_Logs: [
    "log_id",
    "user_id",
    "action",
    "entity_type",
    "entity_id",
    "details",
    "created_at"
  ],

  Settings: [
    "setting_key",
    "setting_value",
    "updated_at",
    "updated_by"
  ]
};

const KOOKAL_DRIVE_FOLDERS = [
  "DATABASE",
  "BACKUPS",
  "DAILY_REPORTS",
  "MONTHLY_REPORTS",
  "AUDIT_LOGS",
  "EXPORTS"
];

/**
 * Main initialization function.
 * Run this manually once from the Apps Script editor.
 */
function initializeKookalStorage() {
  const properties = PropertiesService.getScriptProperties();

  const spreadsheetId = properties.getProperty("SPREADSHEET_ID");
  const driveRootId = properties.getProperty("DRIVE_ROOT_FOLDER_ID");

  if (!spreadsheetId || !driveRootId) {
    throw new Error(
      "Missing SPREADSHEET_ID or DRIVE_ROOT_FOLDER_ID in Script Properties."
    );
  }

  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const rootFolder = DriveApp.getFolderById(driveRootId);

  const databaseResult = initializeDatabaseTabs_(spreadsheet);
  const folderResult = initializeDriveFolders_(rootFolder);

  const result = {
    status: "SUCCESS",
    spreadsheet: spreadsheet.getName(),
    driveFolder: rootFolder.getName(),
    database: databaseResult,
    folders: folderResult,
    initializedAt: new Date().toISOString()
  };

  console.log(JSON.stringify(result, null, 2));

  return result;
}

/**
 * Initialize all required spreadsheet tabs.
 * Existing data is never cleared.
 */
function initializeDatabaseTabs_(spreadsheet) {
  const result = {};

  Object.entries(KOOKAL_SCHEMA).forEach(([sheetName, headers]) => {
    let sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();

    if (lastRow === 0 || lastColumn === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");

      result[sheetName] = "HEADERS_CREATED";
      return;
    }

    const existingHeaders = sheet
      .getRange(1, 1, 1, lastColumn)
      .getValues()[0]
      .map(value => String(value).trim());

    const missingHeaders = headers.filter(
      header => !existingHeaders.includes(header)
    );

    if (missingHeaders.length > 0) {
      const startColumn = lastColumn + 1;

      sheet
        .getRange(1, startColumn, 1, missingHeaders.length)
        .setValues([missingHeaders]);

      sheet
        .getRange(1, startColumn, 1, missingHeaders.length)
        .setFontWeight("bold");
    }

    sheet.setFrozenRows(1);

    result[sheetName] =
      missingHeaders.length > 0
        ? "MISSING_HEADERS_ADDED"
        : "ALREADY_INITIALIZED";
  });

  return result;
}

/**
 * Verify the required Drive folders.
 * Creates a missing folder without deleting existing folders.
 */
function initializeDriveFolders_(rootFolder) {
  const result = {};

  KOOKAL_DRIVE_FOLDERS.forEach(folderName => {
    const folders = rootFolder.getFoldersByName(folderName);

    if (folders.hasNext()) {
      result[folderName] = "EXISTS";
    } else {
      rootFolder.createFolder(folderName);
      result[folderName] = "CREATED";
    }
  });

  return result;
}

/**
 * Verify the connection without changing any data.
 */
function testKookalConnection() {
  const properties = PropertiesService.getScriptProperties();

  const spreadsheetId = properties.getProperty("SPREADSHEET_ID");
  const driveRootId = properties.getProperty("DRIVE_ROOT_FOLDER_ID");

  if (!spreadsheetId || !driveRootId) {
    throw new Error("Storage configuration is incomplete.");
  }

  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const folder = DriveApp.getFolderById(driveRootId);

  const result = {
    spreadsheetConnected: true,
    spreadsheetName: spreadsheet.getName(),
    driveConnected: true,
    driveFolderName: folder.getName(),
    checkedAt: new Date().toISOString()
  };

  console.log(JSON.stringify(result, null, 2));

  return result;
}
