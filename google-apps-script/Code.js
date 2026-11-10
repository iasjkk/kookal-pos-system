
/**
 * KOOKAL POS - Google Apps Script API
 *
 * Required Script Properties:
 * SPREADSHEET_ID
 * DRIVE_ROOT_FOLDER_ID
 * INITIAL_ADMIN_USERNAME
 * INITIAL_ADMIN_PASSWORD
 * TOKEN_SIGNING_SECRET
 * GATEWAY_HMAC_SECRET
 *
 * Gateway sends POST JSON:
 * {
 *   method: "GET" | "POST" | "PATCH",
 *   path: "/auth/login",
 *   timestamp: "unix milliseconds",
 *   nonce: "unique random string",
 *   signature: "base64 HMAC-SHA256",
 *   payload: { ... }
 * }
 *
 * Signature input:
 * timestamp + "\n" + nonce + "\n" + method + "\n" +
 * path + "\n" + SHA256(JSON.stringify(payload))
 */

const KOOKAL = {
  timezone: "Asia/Kolkata",
  sessionHours: 12,
  pbkdf2Iterations: 12000,
  maxRequestBytes: 1000000,
  sheets: {
    Users: [
      "user_id", "username", "password_hash", "password_salt",
      "role", "status", "created_at", "created_by", "last_login",
      "full_name", "active"
    ],
    Meal_Periods: ["period_id", "name", "active", "created_at"],
    Categories: [
      "category_id", "meal_period_id", "name", "description",
      "display_order", "status", "created_at", "updated_at"
    ],
    Menu_Items: [
      "item_id", "category_id", "name", "description", "price",
      "gst_rate", "gst_inclusive", "status", "created_at", "updated_at"
    ],
    Bills: [
      "bill_id", "bill_number", "bill_date", "cashier_id",
      "subtotal", "discount", "gst_amount", "grand_total",
      "payment_status", "bill_status", "cancelled_by",
      "cancellation_reason", "created_at", "cancelled_at",
      "customer_name", "order_type", "table_no", "payment_method",
      "tax_total"
    ],
    Bill_Items: [
      "bill_item_id", "bill_id", "item_id", "item_name",
      "quantity", "unit_price", "gst_rate", "gst_amount",
      "line_total"
    ],
    Payments: [
      "payment_id", "bill_id", "payment_method", "amount",
      "transaction_reference", "created_at"
    ],
    Audit_Logs: [
      "log_id", "user_id", "action", "entity_type", "entity_id",
      "details", "created_at"
    ],
    Settings: ["setting_key", "setting_value", "updated_at", "updated_by"]
  }
};

/* =========================
   ENTRY POINTS
========================= */

function doGet() {
  return json_({ ok: true, service: "KOOKAL POS API", message: "Use the signed gateway." });
}

function doPost(e) {
  try {
    const raw = e && e.postData ? e.postData.contents : "";
    if (!raw || raw.length > KOOKAL.maxRequestBytes) {
      return json_({ status: 400, body: { error: "Invalid request body." } });
    }

    const envelope = JSON.parse(raw);
    verifyGateway_(envelope);

    const method = String(envelope.method || "GET").toUpperCase();
    const path = normalizePath_(envelope.path || "");
    const payload = envelope.payload || {};

    const result = dispatch_(method, path, payload);
    return json_({ status: 200, body: result });
  } catch (err) {
    const message = err && err.message ? err.message : "Internal server error";
    const status = err && err.httpStatus ? err.httpStatus : 500;
    return json_({ status: status, body: { error: message } });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizePath_(path) {
  let p = String(path).split("?")[0];
  if (!p.startsWith("/")) p = "/" + p;
  return p.replace(/\/+$/, "") || "/";
}

/* =========================
   INITIALIZATION
========================= */

function initializeKookalStorage() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = requiredProperty_("SPREADSHEET_ID");
  const rootFolderId = requiredProperty_("DRIVE_ROOT_FOLDER_ID");

  const ss = SpreadsheetApp.openById(spreadsheetId);
  initializeDatabaseTabs_(ss);
  initializeDriveFolders_(DriveApp.getFolderById(rootFolderId));
  ensureSecrets_();
  createInitialAdmin_();

  return {
    success: true,
    spreadsheet: ss.getName(),
    sheets: Object.keys(KOOKAL.sheets),
    adminUsername: props.getProperty("INITIAL_ADMIN_USERNAME")
  };
}

function initializeDatabaseTabs_(ss) {
  Object.keys(KOOKAL.sheets).forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);

    const expected = KOOKAL.sheets[name];
    const lastCol = Math.max(sheet.getLastColumn(), 1);
    let existing = sheet.getLastRow()
      ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String)
      : [];

    if (!existing.some(v => v.trim())) {
      sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
      sheet.setFrozenRows(1);
      return;
    }

    // Preserve existing columns and append missing columns.
    expected.forEach(header => {
      if (existing.indexOf(header) === -1) {
        const newCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, newCol).setValue(header);
        existing.push(header);
      }
    });
    sheet.setFrozenRows(1);
  });
}

function initializeDriveFolders_(root) {
  const names = [
    "DATABASE", "BACKUPS", "DAILY_REPORTS", "MONTHLY_REPORTS",
    "AUDIT_LOGS", "EXPORTS"
  ];
  names.forEach(name => {
    const found = root.getFoldersByName(name);
    if (!found.hasNext()) root.createFolder(name);
  });
}

function testKookalConnection() {
  const ss = SpreadsheetApp.openById(requiredProperty_("SPREADSHEET_ID"));
  const root = DriveApp.getFolderById(requiredProperty_("DRIVE_ROOT_FOLDER_ID"));
  return {
    spreadsheet: ss.getName(),
    driveFolder: root.getName(),
    sheetNames: ss.getSheets().map(s => s.getName())
  };
}

function ensureSecrets_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("TOKEN_SIGNING_SECRET")) {
    props.setProperty("TOKEN_SIGNING_SECRET", randomSecret_());
  }
  if (!props.getProperty("GATEWAY_HMAC_SECRET")) {
    props.setProperty("GATEWAY_HMAC_SECRET", randomSecret_());
  }
}

function randomSecret_() {
  return Utilities.getUuid().replace(/-/g, "") +
    Utilities.getUuid().replace(/-/g, "") +
    Utilities.getUuid().replace(/-/g, "");
}

function createInitialAdmin_() {
  const username = requiredProperty_("INITIAL_ADMIN_USERNAME");
  const password = requiredProperty_("INITIAL_ADMIN_PASSWORD");

  if (password.length < 12) {
    throw new Error("INITIAL_ADMIN_PASSWORD must be at least 12 characters.");
  }

  const users = rows_("Users");
  const existing = users.find(u => String(u.username).toLowerCase() === username.toLowerCase());
  if (existing) return;

  const salt = randomSecret_();
  const hash = passwordHash_(password, salt);
  insert_("Users", {
    username: username,
    password_hash: hash,
    password_salt: salt,
    role: "admin",
    status: "ACTIVE",
    active: true,
    full_name: "KOOKAL Administrator",
    created_at: now_(),
    created_by: "SYSTEM"
  });
}

/* =========================
   GATEWAY SECURITY
========================= */

function verifyGateway_(env) {
  const secret = requiredProperty_("GATEWAY_HMAC_SECRET");
  const timestamp = String(env.timestamp || "");
  const nonce = String(env.nonce || "");
  const method = String(env.method || "").toUpperCase();
  const path = normalizePath_(env.path || "");
  const payloadText = JSON.stringify(env.payload || {});
  const signature = String(env.signature || "");

  if (!timestamp || !nonce || !signature || !method || !path) {
    throw httpError_(401, "Missing gateway authentication.");
  }

  const ts = Number(timestamp);
  if (!isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    throw httpError_(401, "Gateway request expired.");
  }

  const payloadHash = sha256Hex_(payloadText);
  const signed = [timestamp, nonce, method, path, payloadHash].join("\n");
  const expected = Utilities.base64Encode(
    Utilities.computeHmacSha256Signature(signed, secret)
  );

  if (!constantTimeEqual_(expected, signature)) {
    throw httpError_(401, "Invalid gateway signature.");
  }

  const cache = CacheService.getScriptCache();
  const replayKey = "nonce_" + sha256Hex_(nonce);
  if (cache.get(replayKey)) throw httpError_(401, "Duplicate gateway request.");
  cache.put(replayKey, "1", 600);
}

function constantTimeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/* =========================
   ROUTER
========================= */

function dispatch_(method, path, p) {
  if (method === "POST" && path === "/auth/login") return login_(p);
  if (method === "GET" && path === "/auth/me") return { user: requireUser_(p).publicUser };

  const user = requireUser_(p);

  if (method === "GET" && path === "/menu") return getMenu_();
  if (method === "POST" && path === "/menu/periods") {
    requireRole_(user, ["admin"]);
    return createPeriod_(p, user);
  }
  if (method === "POST" && path === "/menu/categories") {
    requireRole_(user, ["admin"]);
    return createCategory_(p, user);
  }
  if (method === "POST" && path === "/menu/items") {
    requireRole_(user, ["admin"]);
    return createItem_(p, user);
  }

  let m;
  if (method === "PATCH" && (m = path.match(/^\/menu\/items\/(\d+)\/availability$/))) {
    requireRole_(user, ["admin"]);
    return updateItemAvailability_(Number(m[1]), p, user);
  }
  if (method === "GET" && path === "/users") {
    requireRole_(user, ["admin"]);
    return { users: rows_("Users").map(publicUser_) };
  }
  if (method === "POST" && path === "/users") {
    requireRole_(user, ["admin"]);
    return createUser_(p, user);
  }
  if (method === "PATCH" && (m = path.match(/^\/users\/(\d+)\/active$/))) {
    requireRole_(user, ["admin"]);
    return updateUserActive_(Number(m[1]), p, user);
  }
  if (method === "POST" && path === "/bills") return createBill_(p, user);
  if (method === "GET" && path === "/bills") return getBills_(user);
  if (method === "POST" && (m = path.match(/^\/bills\/(\d+)\/cancel$/))) {
    requireRole_(user, ["admin", "manager"]);
    return cancelBill_(Number(m[1]), p, user);
  }
  if (method === "GET" && path === "/reports/summary") {
    requireRole_(user, ["admin", "manager"]);
    return reportSummary_(p);
  }
  if (method === "GET" && path === "/audit") {
    requireRole_(user, ["admin", "manager"]);
    return { logs: rows_("Audit_Logs").slice(-200).reverse() };
  }

  throw httpError_(404, "API route not found: " + method + " " + path);
}

/* =========================
   AUTHENTICATION
========================= */

function login_(p) {
  const username = String(p.username || "").trim();
  const password = String(p.password || "");
  if (!username || !password) throw httpError_(400, "Username and password are required.");

  const user = rows_("Users").find(u =>
    String(u.username).toLowerCase() === username.toLowerCase()
  );

  if (!user || !isActive_(user) ||
      passwordHash_(password, String(user.password_salt)) !== String(user.password_hash)) {
    throw httpError_(401, "Invalid username or password.");
  }

  updateById_("Users", user.user_id, {
    last_login: now_()
  }, "user_id");

  const token = createToken_(user);
  audit_(user.user_id, "LOGIN", "USER", user.user_id, "User logged in");

  return { token: token, user: publicUser_(user) };
}

function createToken_(user) {
  const payload = {
    id: Number(user.user_id),
    username: user.username,
    full_name: user.full_name || user.username,
    role: user.role,
    iat: Date.now(),
    exp: Date.now() + KOOKAL.sessionHours * 60 * 60 * 1000,
    jti: randomSecret_().slice(0, 24)
  };
  const encoded = base64Url_(JSON.stringify(payload));
  const signature = base64Url_(
    Utilities.computeHmacSha256Signature(
      encoded, requiredProperty_("TOKEN_SIGNING_SECRET")
    )
  );
  return encoded + "." + signature;
}

function requireUser_(p) {
  const token = String(p.token || "");
  const parts = token.split(".");
  if (parts.length !== 2) throw httpError_(401, "Authentication required.");

  const expected = base64Url_(
    Utilities.computeHmacSha256Signature(
      parts[0], requiredProperty_("TOKEN_SIGNING_SECRET")
    )
  );
  if (!constantTimeEqual_(expected, parts[1])) {
    throw httpError_(401, "Invalid session.");
  }

  let payload;
  try {
    payload = JSON.parse(Utilities.newBlob(
      Utilities.base64DecodeWebSafe(parts[0])
    ).getDataAsString());
  } catch (_) {
    throw httpError_(401, "Invalid session.");
  }

  if (!payload.exp || Date.now() > Number(payload.exp)) {
    throw httpError_(401, "Session expired.");
  }

  const user = rows_("Users").find(u => Number(u.user_id) === Number(payload.id));
  if (!user || !isActive_(user)) throw httpError_(401, "User account is inactive.");

  return { row: user, publicUser: publicUser_(user) };
}

function requireRole_(user, roles) {
  if (roles.indexOf(String(user.row.role).toLowerCase()) === -1) {
    throw httpError_(403, "You do not have permission to perform this action.");
  }
}

function publicUser_(u) {
  return {
    id: Number(u.user_id),
    username: u.username,
    full_name: u.full_name || u.username,
    role: String(u.role || "cashier").toLowerCase(),
    active: isActive_(u)
  };
}

function isActive_(u) {
  return String(u.status || "").toUpperCase() === "ACTIVE" ||
    String(u.status || "").toUpperCase() === "TRUE" ||
    u.active === true || String(u.active).toLowerCase() === "true";
}

/* =========================
   MENU
========================= */

function getMenu_() {
  const periods = rows_("Meal_Periods").filter(activeRow_);
  const categories = rows_("Categories").filter(activeRow_);
  const items = rows_("Menu_Items").filter(activeRow_).map(item => {
    const category = categories.find(c => Number(c.category_id) === Number(item.category_id));
    return {
      id: Number(item.item_id),
      category_id: Number(item.category_id),
      category_name: category ? category.name : "",
      meal_period_id: category ? Number(category.meal_period_id) : 0,
      name: item.name,
      description: item.description || "",
      price: Number(item.price || 0),
      gst_rate: Number(item.gst_rate || 0),
      gst_inclusive: bool_(item.gst_inclusive),
      active: true
    };
  });

  return {
    periods: periods.map(x => ({
      id: Number(x.period_id), name: x.name, active: true
    })),
    categories: categories.map(x => ({
      id: Number(x.category_id),
      meal_period_id: Number(x.meal_period_id || 0),
      name: x.name,
      description: x.description || "",
      active: true
    })),
    items: items
  };
}

function createPeriod_(p, user) {
  const name = requiredText_(p.name, "Period name");
  if (rows_("Meal_Periods").some(x => x.name.toLowerCase() === name.toLowerCase())) {
    throw httpError_(409, "Meal period already exists.");
  }
  const id = insert_("Meal_Periods", {
    name: name, active: true, created_at: now_()
  });
  audit_(user.row.user_id, "CREATE_MEAL_PERIOD", "MEAL_PERIOD", id, name);
  return { id: id, name: name };
}

function createCategory_(p, user) {
  const name = requiredText_(p.name, "Category name");
  const periodId = Number(p.meal_period_id || p.period_id || 0);
  if (!rows_("Meal_Periods").some(x => Number(x.period_id) === periodId)) {
    throw httpError_(400, "Select a valid meal period.");
  }
  const id = insert_("Categories", {
    meal_period_id: periodId,
    name: name,
    description: String(p.description || ""),
    display_order: Number(p.display_order || 0),
    status: "ACTIVE",
    created_at: now_(),
    updated_at: now_()
  });
  audit_(user.row.user_id, "CREATE_CATEGORY", "CATEGORY", id, name);
  return { id: id, name: name };
}

function createItem_(p, user) {
  const name = requiredText_(p.name, "Item name");
  const categoryId = Number(p.category_id);
  if (!rows_("Categories").some(c => Number(c.category_id) === categoryId)) {
    throw httpError_(400, "Select a valid category.");
  }
  const price = Number(p.price);
  const gst = Number(p.gst_rate || 0);
  if (!isFinite(price) || price < 0 || !isFinite(gst) || gst < 0) {
    throw httpError_(400, "Invalid price or GST rate.");
  }
  const id = insert_("Menu_Items", {
    category_id: categoryId,
    name: name,
    description: String(p.description || ""),
    price: price,
    gst_rate: gst,
    gst_inclusive: bool_(p.gst_inclusive),
    status: "ACTIVE",
    created_at: now_(),
    updated_at: now_()
  });
  audit_(user.row.user_id, "CREATE_MENU_ITEM", "MENU_ITEM", id, name);
  return { id: id, name: name };
}

function updateItemAvailability_(id, p, user) {
  const item = rows_("Menu_Items").find(x => Number(x.item_id) === id);
  if (!item) throw httpError_(404, "Menu item not found.");
  const active = p.active === true || String(p.active).toLowerCase() === "true";
  updateById_("Menu_Items", id, {
    status: active ? "ACTIVE" : "INACTIVE",
    updated_at: now_()
  }, "item_id");
  audit_(user.row.user_id, "UPDATE_ITEM_AVAILABILITY", "MENU_ITEM", id, String(active));
  return { success: true, active: active };
}

/* =========================
   USER MANAGEMENT
========================= */

function createUser_(p, user) {
  const username = requiredText_(p.username, "Username");
  const fullName = requiredText_(p.full_name, "Full name");
  const password = String(p.password || "");
  const role = String(p.role || "cashier").toLowerCase();

  if (username.length < 3 || fullName.length < 2 || password.length < 8) {
    throw httpError_(400, "Username must be 3+ characters, full name 2+, password 8+.");
  }
  if (["admin", "manager", "cashier"].indexOf(role) === -1) {
    throw httpError_(400, "Invalid user role.");
  }
  if (rows_("Users").some(u => String(u.username).toLowerCase() === username.toLowerCase())) {
    throw httpError_(409, "Username already exists.");
  }

  const salt = randomSecret_();
  const id = insert_("Users", {
    username: username,
    full_name: fullName,
    password_salt: salt,
    password_hash: passwordHash_(password, salt),
    role: role,
    status: "ACTIVE",
    active: true,
    created_at: now_(),
    created_by: user.row.username
  });
  audit_(user.row.user_id, "CREATE_USER", "USER", id, username);
  return { user: publicUser_(rows_("Users").find(x => Number(x.user_id) === id)) };
}

function updateUserActive_(id, p, user) {
  if (id === Number(user.row.user_id)) {
    throw httpError_(400, "You cannot deactivate your own account.");
  }
  const target = rows_("Users").find(u => Number(u.user_id) === id);
  if (!target) throw httpError_(404, "User not found.");
  const active = p.active === true || String(p.active).toLowerCase() === "true";
  updateById_("Users", id, {
    status: active ? "ACTIVE" : "INACTIVE",
    active: active
  }, "user_id");
  audit_(user.row.user_id, "UPDATE_USER_STATUS", "USER", id, String(active));
  return { success: true, active: active };
}

/* =========================
   BILLING
========================= */

function createBill_(p, user) {
  const lines = Array.isArray(p.items) ? p.items : [];
  if (!lines.length) throw httpError_(400, "A bill must contain at least one item.");

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    let subtotal = 0;
    let taxTotal = 0;
    const billLines = [];

    lines.forEach(line => {
      const itemId = Number(line.item_id || line.id);
      const item = rows_("Menu_Items").find(x =>
        Number(x.item_id) === itemId && activeRow_(x)
      );
      if (!item) throw httpError_(400, "A selected menu item is unavailable.");

      const quantity = Number(line.quantity);
      if (!isFinite(quantity) || quantity <= 0 || quantity > 1000) {
        throw httpError_(400, "Invalid item quantity.");
      }

      const unitPrice = Number(item.price);
      const rate = Number(item.gst_rate || 0);
      const inclusive = bool_(item.gst_inclusive);
      const gross = round2_(unitPrice * quantity);
      const tax = inclusive
        ? round2_(gross - gross / (1 + rate / 100))
        : round2_(gross * rate / 100);
      const lineTotal = inclusive ? gross : round2_(gross + tax);

      subtotal += gross;
      taxTotal += tax;

      billLines.push({
        item_id: itemId,
        item_name: item.name,
        quantity: quantity,
        unit_price: unitPrice,
        gst_rate: rate,
        gst_amount: tax,
        line_total: lineTotal
      });
    });

    subtotal = round2_(subtotal);
    taxTotal = round2_(taxTotal);
    const discount = Math.min(
      subtotal,
      Math.max(0, Number(p.discount || 0))
    );
    const grandTotal = round2_(
      billLines.reduce((sum, x) => sum + x.line_total, 0) - discount
    );

    const billId = nextId_("Bills", "bill_id");
    const billNo = nextBillNumber_();
    const createdAt = now_();

    insertWithId_("Bills", "bill_id", billId, {
      bill_number: billNo,
      bill_date: createdAt,
      cashier_id: user.row.user_id,
      subtotal: subtotal,
      discount: discount,
      gst_amount: taxTotal,
      tax_total: taxTotal,
      grand_total: grandTotal,
      payment_status: "PAID",
      bill_status: "PAID",
      customer_name: String(p.customer_name || ""),
      order_type: String(p.order_type || "Takeaway"),
      table_no: String(p.table_no || ""),
      payment_method: String(p.payment_method || "Cash"),
      created_at: createdAt
    });

    billLines.forEach(line => {
      insert_("Bill_Items", {
        bill_id: billId,
        item_id: line.item_id,
        item_name: line.item_name,
        quantity: line.quantity,
        unit_price: line.unit_price,
        gst_rate: line.gst_rate,
        gst_amount: line.gst_amount,
        line_total: line.line_total
      });
    });

    insert_("Payments", {
      bill_id: billId,
      payment_method: String(p.payment_method || "Cash"),
      amount: grandTotal,
      transaction_reference: String(p.transaction_reference || ""),
      created_at: createdAt
    });

    audit_(user.row.user_id, "CREATE_BILL", "BILL", billId, billNo);
    return billResponse_(billId);
  } finally {
    lock.releaseLock();
  }
}

function getBills_(user) {
  let bills = rows_("Bills").sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at))
  );
  if (String(user.row.role).toLowerCase() === "cashier") {
    bills = bills.filter(b => Number(b.cashier_id) === Number(user.row.user_id));
  }
  return {
    bills: bills.slice(0, 500).map(b => billResponse_(Number(b.bill_id)))
  };
}

function billResponse_(id) {
  const b = rows_("Bills").find(x => Number(x.bill_id) === id);
  if (!b) throw httpError_(404, "Bill not found.");
  const cashier = rows_("Users").find(u => Number(u.user_id) === Number(b.cashier_id));
  const items = rows_("Bill_Items").filter(x => Number(x.bill_id) === id).map(x => ({
    item_id: Number(x.item_id || 0),
    item_name: x.item_name,
    quantity: Number(x.quantity || 0),
    unit_price: Number(x.unit_price || 0),
    gst_rate: Number(x.gst_rate || 0),
    gst_amount: Number(x.gst_amount || 0),
    line_total: Number(x.line_total || 0)
  }));

  return {
    id: Number(b.bill_id),
    bill_no: b.bill_number,
    bill_number: b.bill_number,
    customer_name: b.customer_name || "",
    order_type: b.order_type || "Takeaway",
    table_no: b.table_no || "",
    subtotal: Number(b.subtotal || 0),
    discount: Number(b.discount || 0),
    tax_total: Number(b.tax_total || b.gst_amount || 0),
    grand_total: Number(b.grand_total || 0),
    payment_method: b.payment_method || "",
    status: b.bill_status || "PAID",
    created_at: b.created_at,
    items: items,
    cashier_name: cashier ? (cashier.full_name || cashier.username) : ""
  };
}

function cancelBill_(id, p, user) {
  const reason = requiredText_(p.reason || p.cancel_reason, "Cancellation reason");
  if (reason.length < 4) throw httpError_(400, "Please provide a reason of at least 4 characters.");

  const bill = rows_("Bills").find(b => Number(b.bill_id) === id);
  if (!bill) throw httpError_(404, "Bill not found.");
  if (String(bill.bill_status).toUpperCase() === "CANCELLED") {
    throw httpError_(409, "Bill is already cancelled.");
  }

  updateById_("Bills", id, {
    bill_status: "CANCELLED",
    payment_status: "CANCELLED",
    cancelled_by: user.row.user_id,
    cancellation_reason: reason,
    cancelled_at: now_()
  }, "bill_id");

  audit_(user.row.user_id, "CANCEL_BILL", "BILL", id, reason);
  return billResponse_(id);
}

/* =========================
   REPORTS
========================= */

function reportSummary_(p) {
  const from = String(p.from || Utilities.formatDate(new Date(), KOOKAL.timezone, "yyyy-MM-dd"));
  const to = String(p.to || from);

  const bills = rows_("Bills").filter(b => {
    const date = String(b.created_at || b.bill_date || "").slice(0, 10);
    return date >= from && date <= to;
  });

  const paid = bills.filter(b => String(b.bill_status).toUpperCase() !== "CANCELLED");
  const cancelled = bills.filter(b => String(b.bill_status).toUpperCase() === "CANCELLED");
  const sum = (arr, key) => round2_(arr.reduce((s, b) => s + Number(b[key] || 0), 0));

  const payments = {};
  paid.forEach(b => {
    const method = b.payment_method || "Other";
    payments[method] = (payments[method] || 0) + Number(b.grand_total || 0);
  });

  const cashierMap = {};
  paid.forEach(b => {
    const u = rows_("Users").find(x => Number(x.user_id) === Number(b.cashier_id));
    const name = u ? (u.full_name || u.username) : "Unknown";
    cashierMap[name] = (cashierMap[name] || 0) + Number(b.grand_total || 0);
  });

  const itemMap = {};
  paid.forEach(b => {
    rows_("Bill_Items").filter(x => Number(x.bill_id) === Number(b.bill_id)).forEach(x => {
      itemMap[x.item_name] = (itemMap[x.item_name] || 0) + Number(x.quantity || 0);
    });
  });

  const dailyMap = {};
  paid.forEach(b => {
    const d = String(b.created_at || "").slice(0, 10);
    dailyMap[d] = (dailyMap[d] || 0) + Number(b.grand_total || 0);
  });

  const sales = sum(paid, "grand_total");
  const tax = sum(paid, "tax_total") || sum(paid, "gst_amount");

  return {
    from: from,
    to: to,
    totals: {
      bill_count: paid.length,
      sales: sales,
      cancelled: sum(cancelled, "grand_total"),
      tax: tax
    },
    average_bill: paid.length ? round2_(sales / paid.length) : 0,
    payments: Object.keys(payments).map(k => ({ name: k, value: round2_(payments[k]) })),
    byCashier: Object.keys(cashierMap).map(k => ({ name: k, sales: round2_(cashierMap[k]) })),
    byItem: Object.keys(itemMap).map(k => ({ name: k, quantity: itemMap[k] })),
    daily: Object.keys(dailyMap).sort().map(k => ({ date: k, sales: round2_(dailyMap[k]) }))
  };
}

/* =========================
   AUDIT
========================= */

function audit_(userId, action, entityType, entityId, details) {
  insert_("Audit_Logs", {
    user_id: userId,
    action: action,
    entity_type: entityType,
    entity_id: String(entityId || ""),
    details: String(details || ""),
    created_at: now_()
  });
}

/* =========================
   SHEET HELPERS
========================= */

function spreadsheet_() {
  return SpreadsheetApp.openById(requiredProperty_("SPREADSHEET_ID"));
}

function sheet_(name) {
  const s = spreadsheet_().getSheetByName(name);
  if (!s) throw new Error("Missing sheet: " + name + ". Run initializeKookalStorage().");
  return s;
}

function rows_(name) {
  const s = sheet_(name);
  const values = s.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(row => row.some(v => v !== "")).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function insert_(name, data) {
  const s = sheet_(name);
  const headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0].map(String);
  const idHeader = headers.find(h => /_id$/.test(h));
  const id = idHeader ? nextId_(name, idHeader) : null;
  const row = headers.map(h => {
    if (idHeader && h === idHeader) return id;
    return Object.prototype.hasOwnProperty.call(data, h) ? data[h] : "";
  });
  s.appendRow(row);
  return id;
}

function insertWithId_(name, idHeader, id, data) {
  const s = sheet_(name);
  const headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0].map(String);
  const row = headers.map(h => h === idHeader ? id :
    (Object.prototype.hasOwnProperty.call(data, h) ? data[h] : ""));
  s.appendRow(row);
}

function nextId_(name, idHeader) {
  const values = rows_(name).map(r => Number(r[idHeader] || 0));
  return values.length ? Math.max.apply(null, values) + 1 : 1;
}

function updateById_(name, id, changes, idHeader) {
  const s = sheet_(name);
  const values = s.getDataRange().getValues();
  const headers = values[0].map(String);
  const idIndex = headers.indexOf(idHeader);
  if (idIndex < 0) throw new Error("Missing ID column " + idHeader);
  const rowIndex = values.findIndex((r, i) => i > 0 && Number(r[idIndex]) === Number(id));
  if (rowIndex < 1) throw httpError_(404, "Record not found.");

  Object.keys(changes).forEach(key => {
    const col = headers.indexOf(key);
    if (col >= 0) s.getRange(rowIndex + 1, col + 1).setValue(changes[key]);
  });
}

function requiredProperty_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error("Missing Script Property: " + name);
  return value;
}

/* =========================
   PASSWORD / CRYPTO HELPERS
========================= */

/**
 * PBKDF2-HMAC-SHA256.
 * Passwords are stored as a salt and derived hash, never plaintext.
 */

function passwordHash_(password, salt) {
  const iterations = KOOKAL.pbkdf2Iterations;

  function hexToBytes(hex) {
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substring(i, i + 2), 16));
    }
    return bytes;
  }

  function bytesToHex(bytes) {
    return bytes.map(b =>
      ("0" + ((b + 256) % 256).toString(16)).slice(-2)
    ).join("");
  }

  function hmacHex(key, message) {
    const bytes = Utilities.computeHmacSha256Signature(message, key);
    return bytesToHex(bytes);
  }

  let uHex = hmacHex(password, salt + "\u0000\u0000\u0000\u0001");
  let result = hexToBytes(uHex);

  for (let i = 1; i < iterations; i++) {
    uHex = hmacHex(password, uHex);
    const u = hexToBytes(uHex);

    for (let j = 0; j < result.length; j++) {
      result[j] ^= u[j];
    }
  }

  return Utilities.base64Encode(result);
}


function sha256Hex_(text) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8
  ).map(b => ("0" + ((b + 256) % 256).toString(16)).slice(-2)).join("");
}

function base64Url_(value) {
  return Utilities.base64EncodeWebSafe(value).replace(/=+$/, "");
}

/* =========================
   GENERAL HELPERS
========================= */

function now_() {
  return Utilities.formatDate(new Date(), KOOKAL.timezone, "yyyy-MM-dd'T'HH:mm:ss");
}

function activeRow_(r) {
  return String(r.status || "").toUpperCase() === "ACTIVE" ||
    r.active === true || String(r.active).toLowerCase() === "true";
}

function bool_(v) {
  return v === true || v === 1 || String(v).toLowerCase() === "true" ||
    String(v) === "1";
}

function round2_(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function requiredText_(value, label) {
  const text = String(value || "").trim();
  if (!text) throw httpError_(400, label + " is required.");
  return text;
}

function nextBillNumber_() {
  const date = Utilities.formatDate(new Date(), KOOKAL.timezone, "yyyyMMdd");
  const prefix = "KK-" + date + "-";
  const count = rows_("Bills").filter(b =>
    String(b.bill_number || "").indexOf(prefix) === 0
  ).length + 1;
  return prefix + String(count).padStart(4, "0");
}

function httpError_(status, message) {
  const e = new Error(message);
  e.httpStatus = status;
  return e;
}
