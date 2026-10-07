"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const DATABASE_PATH = path.join(DATA_DIR, "store.sqlite");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;
const MAX_REQUEST_BYTES = 64 * 1024;
const sessions = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });

const database = new DatabaseSync(DATABASE_PATH);
database.exec("PRAGMA foreign_keys = ON");

const hasCategories = database.prepare(`
    SELECT 1 AS found
    FROM sqlite_master
    WHERE type = 'table' AND name = 'categories'
`).get();

if (!hasCategories) {
    database.exec(
        fs.readFileSync(path.join(ROOT, "database.sql"), "utf8")
    );
    database.exec("DELETE FROM inventory; DELETE FROM products;");
}

function columnExists(table, column) {
    return database.prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((item) => item.name === column);
}

if (!columnExists("orders", "pincode")) {
    database.exec(
        "ALTER TABLE orders ADD COLUMN pincode TEXT NOT NULL DEFAULT ''"
    );
}

database.exec(`
    CREATE TABLE IF NOT EXISTS inventory_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        movement_type TEXT NOT NULL,
        quantity_change INTEGER NOT NULL,
        stock_after INTEGER NOT NULL CHECK(stock_after >= 0),
        reference TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(product_id) REFERENCES products(id)
    );
`);

const productQuery = database.prepare(`
    SELECT
        p.id,
        p.name,
        p.category_id,
        p.price,
        p.mrp,
        p.weight,
        p.image,
        p.rating,
        c.name AS category,
        i.stock,
        i.reserved,
        MAX(0, i.stock - i.reserved) AS available
    FROM products p
    JOIN categories c ON c.id = p.category_id
    JOIN inventory i ON i.product_id = p.id
`);

function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
    });
    response.end(JSON.stringify(payload));
}

function readJson(request) {
    return new Promise((resolve, reject) => {
        let body = "";

        request.on("data", (chunk) => {
            body += chunk;
            if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) {
                reject(Object.assign(new Error("Request is too large."), {
                    statusCode: 413
                }));
                request.destroy();
            }
        });
        request.on("end", () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch {
                reject(Object.assign(new Error("Request body must be valid JSON."), {
                    statusCode: 400
                }));
            }
        });
        request.on("error", reject);
    });
}

function requireAdmin(request) {
    const token = (request.headers.authorization || "")
        .replace(/^Bearer\s+/i, "");
    const expiresAt = sessions.get(token);

    if (!token || !expiresAt || expiresAt <= Date.now()) {
        sessions.delete(token);
        throw Object.assign(new Error("Store staff sign-in is required."), {
            statusCode: 401
        });
    }
}

function validateText(value, label, maxLength) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
        throw Object.assign(new Error(`Enter a valid ${label}.`), {
            statusCode: 400
        });
    }
    return value.trim();
}

function catalog() {
    return {
        categories: database.prepare(`
            SELECT id, name, icon FROM categories ORDER BY id
        `).all(),
        products: productQuery.all()
    };
}

function createOrder(body) {
    const customerName = validateText(body.customerName, "customer name", 100);
    const customerPhone = validateText(body.customerPhone, "mobile number", 10);
    const address = validateText(body.address, "delivery address", 500);
    const pincode = validateText(body.pincode, "pincode", 6);

    if (!/^\d{10}$/.test(customerPhone)) {
        throw Object.assign(new Error("Enter a valid 10-digit mobile number."), {
            statusCode: 400
        });
    }
    if (!/^\d{6}$/.test(pincode)) {
        throw Object.assign(new Error("Enter a valid 6-digit pincode."), {
            statusCode: 400
        });
    }
    if (body.paymentMethod !== "COD") {
        throw Object.assign(new Error("Only Cash on Delivery is enabled for this store."), {
            statusCode: 400
        });
    }
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 30) {
        throw Object.assign(new Error("Your cart is empty or contains too many products."), {
            statusCode: 400
        });
    }

    const items = body.items.map((item) => {
        if (
            !Number.isSafeInteger(item.productId) ||
            !Number.isSafeInteger(item.quantity) ||
            item.quantity < 1 ||
            item.quantity > 100
        ) {
            throw Object.assign(new Error("Cart contains an invalid product quantity."), {
                statusCode: 400
            });
        }
        return { productId: item.productId, quantity: item.quantity };
    });

    if (new Set(items.map((item) => item.productId)).size !== items.length) {
        throw Object.assign(new Error("Cart contains a duplicate product."), {
            statusCode: 400
        });
    }

    database.exec("BEGIN IMMEDIATE");
    try {
        let subtotal = 0;
        const orderItems = [];
        const getProduct = database.prepare(`
            SELECT p.id, p.name, p.price, i.stock, i.reserved
            FROM products p
            JOIN inventory i ON i.product_id = p.id
            WHERE p.id = ?
        `);

        for (const item of items) {
            const product = getProduct.get(item.productId);
            if (!product) {
                throw Object.assign(new Error("A product in your cart is no longer available."), {
                    statusCode: 409
                });
            }
            const available = product.stock - product.reserved;
            if (available < item.quantity) {
                throw Object.assign(
                    new Error(`${product.name}: only ${Math.max(0, available)} available.`),
                    { statusCode: 409 }
                );
            }
            subtotal += product.price * item.quantity;
            orderItems.push({
                ...item,
                name: product.name,
                price: product.price
            });
        }

        const deliveryFee = 25;
        const orderNumber = `ZP${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
        const insertOrder = database.prepare(`
            INSERT INTO orders (
                order_number, customer_name, customer_phone, address,
                payment_method, status, total, pincode
            ) VALUES (?, ?, ?, ?, 'COD', 'PLACED', ?, ?)
        `);
        const orderResult = insertOrder.run(
            orderNumber,
            customerName,
            customerPhone,
            address,
            subtotal + deliveryFee,
            pincode
        );
        const orderId = Number(orderResult.lastInsertRowid);
        const updateStock = database.prepare(`
            UPDATE inventory
            SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP
            WHERE product_id = ? AND stock - reserved >= ?
        `);
        const insertOrderItem = database.prepare(`
            INSERT INTO order_items (order_id, product_id, quantity, unit_price)
            VALUES (?, ?, ?, ?)
        `);
        const insertMovement = database.prepare(`
            INSERT INTO inventory_movements (
                product_id, movement_type, quantity_change, stock_after, reference, reason
            ) VALUES (?, 'ONLINE_ORDER', ?, ?, ?, 'Customer order')
        `);

        for (const item of orderItems) {
            const update = updateStock.run(
                item.quantity,
                item.productId,
                item.quantity
            );
            if (Number(update.changes) !== 1) {
                throw Object.assign(
                    new Error(`${item.name} just sold out. Please review your cart.`),
                    { statusCode: 409 }
                );
            }
            const stockAfter = database.prepare(
                "SELECT stock FROM inventory WHERE product_id = ?"
            ).get(item.productId).stock;
            insertOrderItem.run(orderId, item.productId, item.quantity, item.price);
            insertMovement.run(
                item.productId,
                -item.quantity,
                stockAfter,
                orderNumber
            );
        }

        database.exec("COMMIT");
        return {
            orderNumber,
            total: subtotal + deliveryFee,
            paymentMethod: "COD",
            status: "PLACED"
        };
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}

function adjustInventory(productId, body) {
    const quantity = body.quantity;
    const action = body.action;
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
    const product = database.prepare(`
        SELECT p.id, p.name, i.stock, i.reserved
        FROM products p
        JOIN inventory i ON i.product_id = p.id
        WHERE p.id = ?
    `).get(productId);

    if (!product) {
        throw Object.assign(new Error("Product was not found."), { statusCode: 404 });
    }
    if (
        !Number.isSafeInteger(quantity) ||
        quantity < 0 ||
        quantity > 100000 ||
        !["SALE", "RESTOCK", "COUNT"].includes(action)
    ) {
        throw Object.assign(new Error("Choose a valid stock action and quantity."), {
            statusCode: 400
        });
    }
    if (action !== "COUNT" && quantity < 1) {
        throw Object.assign(new Error("Sale and restock quantities must be at least one."), {
            statusCode: 400
        });
    }

    const stockAfter = action === "SALE"
        ? product.stock - quantity
        : action === "RESTOCK"
            ? product.stock + quantity
            : quantity;
    if (stockAfter < product.reserved) {
        throw Object.assign(
            new Error(`Only ${product.stock - product.reserved} unit(s) can be recorded as an in-store sale.`),
            { statusCode: 409 }
        );
    }

    database.exec("BEGIN IMMEDIATE");
    try {
        database.prepare(`
            UPDATE inventory
            SET stock = ?, updated_at = CURRENT_TIMESTAMP
            WHERE product_id = ?
        `).run(stockAfter, productId);

        const quantityChange = stockAfter - product.stock;
        database.prepare(`
            INSERT INTO inventory_movements (
                product_id, movement_type, quantity_change, stock_after, reason
            ) VALUES (?, ?, ?, ?, ?)
        `).run(productId, action, quantityChange, stockAfter, reason);
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }

    return {
        productId,
        productName: product.name,
        stock: stockAfter,
        available: stockAfter - product.reserved
    };
}

function addProduct(body) {
    const name = validateText(body.name, "product name", 120);
    const weight = validateText(body.weight, "product size or weight", 40);
    const categoryId = body.categoryId;
    const price = body.price;
    const mrp = body.mrp;
    const stock = body.stock;
    const image = typeof body.image === "string" ? body.image.trim() : "";

    if (
        !Number.isSafeInteger(categoryId) ||
        !Number.isFinite(price) ||
        price < 0.01 ||
        Math.round(price * 100) !== price * 100 ||
        !Number.isFinite(mrp) ||
        Math.round(mrp * 100) !== mrp * 100 ||
        mrp < price ||
        !Number.isSafeInteger(stock) ||
        stock < 0 ||
        stock > 100000
    ) {
        throw Object.assign(
            new Error("Enter a valid category, price, MRP, and opening stock."),
            { statusCode: 400 }
        );
    }
    if (image && !/^https?:\/\/\S+$/i.test(image)) {
        throw Object.assign(new Error("Product image must be an http(s) URL."), {
            statusCode: 400
        });
    }
    if (!database.prepare("SELECT 1 FROM categories WHERE id = ?").get(categoryId)) {
        throw Object.assign(new Error("Choose a valid product category."), {
            statusCode: 400
        });
    }

    database.exec("BEGIN IMMEDIATE");
    try {
        const result = database.prepare(`
            INSERT INTO products (
                name, category_id, price, mrp, weight, image, rating
            ) VALUES (?, ?, ?, ?, ?, ?, 0)
        `).run(
            name,
            categoryId,
            price,
            mrp,
            weight,
            image || "https://placehold.co/400x300?text=Product"
        );
        const productId = Number(result.lastInsertRowid);
        database.prepare(`
            INSERT INTO inventory (product_id, stock, reserved)
            VALUES (?, ?, 0)
        `).run(productId, stock);
        database.prepare(`
            INSERT INTO inventory_movements (
                product_id, movement_type, quantity_change, stock_after, reason
            ) VALUES (?, 'OPENING_STOCK', ?, ?, 'New product added')
        `).run(productId, stock, stock);
        database.exec("COMMIT");
        return { id: productId, name, stock };
    } catch (error) {
        database.exec("ROLLBACK");
        if (String(error.message).includes("UNIQUE")) {
            throw Object.assign(new Error("This product could not be added because the details conflict with existing data."), {
                statusCode: 409
            });
        }
        throw error;
    }
}

function updateOrderStatus(orderId, status) {
    const steps = ["PLACED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"];
    if (![...steps, "CANCELLED"].includes(status)) {
        throw Object.assign(new Error("Choose a valid order status."), { statusCode: 400 });
    }

    const order = database.prepare(
        "SELECT id, status FROM orders WHERE id = ?"
    ).get(orderId);
    if (!order) {
        throw Object.assign(new Error("Order was not found."), { statusCode: 404 });
    }

    if (status === "CANCELLED") {
        if (order.status === "DELIVERED" || order.status === "CANCELLED") {
            throw Object.assign(
                new Error("This order can no longer be cancelled."),
                { statusCode: 409 }
            );
        }
        database.exec("BEGIN IMMEDIATE");
        try {
            const items = database.prepare(`
                SELECT product_id, quantity
                FROM order_items
                WHERE order_id = ?
            `).all(orderId);
            for (const item of items) {
                database.prepare(`
                    UPDATE inventory
                    SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP
                    WHERE product_id = ?
                `).run(item.quantity, item.product_id);
                const stock = database.prepare(
                    "SELECT stock FROM inventory WHERE product_id = ?"
                ).get(item.product_id).stock;
                database.prepare(`
                    INSERT INTO inventory_movements (
                        product_id, movement_type, quantity_change,
                        stock_after, reference, reason
                    ) VALUES (?, 'ORDER_CANCELLED', ?, ?, ?, 'Order cancelled; stock returned')
                `).run(
                    item.product_id,
                    item.quantity,
                    stock,
                    database.prepare(
                        "SELECT order_number FROM orders WHERE id = ?"
                    ).get(orderId).order_number
                );
            }
            database.prepare(
                "UPDATE orders SET status = 'CANCELLED' WHERE id = ?"
            ).run(orderId);
            database.exec("COMMIT");
            return { id: orderId, status };
        } catch (error) {
            database.exec("ROLLBACK");
            throw error;
        }
    }

    const oldStep = steps.indexOf(order.status);
    const newStep = steps.indexOf(status);
    if (newStep < oldStep || newStep > oldStep + 1) {
        throw Object.assign(new Error("Move the order forward one step at a time."), {
            statusCode: 409
        });
    }

    database.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, orderId);
    return { id: orderId, status };
}

function getAdminOrders(page = 1) {
    const pageSize = 50;
    const offset = (page - 1) * pageSize;
    const orders = database.prepare(`
        SELECT id, order_number, customer_name, customer_phone, address, pincode,
               payment_method, status, total, created_at
        FROM orders
        ORDER BY id DESC
        LIMIT ? OFFSET ?
    `).all(pageSize, offset);
    const total = database.prepare(
        "SELECT COUNT(*) AS count FROM orders"
    ).get().count;
    const getItems = database.prepare(`
        SELECT p.name, order_items.quantity, order_items.unit_price
        FROM order_items
        JOIN products p ON p.id = order_items.product_id
        WHERE order_items.order_id = ?
    `);
    return {
        orders: orders.map((order) => ({
            ...order,
            items: getItems.all(order.id)
        })),
        page,
        pageSize,
        hasMore: offset + orders.length < total
    };
}

async function handleApi(request, response, url) {
    const pathname = url.pathname;
    const method = request.method;

    if (pathname === "/api/health" && method === "GET") {
        return sendJson(response, 200, { status: "ok" });
    }

    if (pathname === "/api/catalog" && method === "GET") {
        return sendJson(response, 200, catalog());
    }

    if (pathname === "/api/orders" && method === "POST") {
        const body = await readJson(request);
        return sendJson(response, 201, createOrder(body));
    }

    if (pathname === "/api/admin/login" && method === "POST") {
        if (!ADMIN_PASSWORD) {
            return sendJson(response, 503, {
                error: "Store dashboard is disabled. Set ADMIN_PASSWORD before starting the server."
            });
        }
        const body = await readJson(request);
        const submitted = Buffer.from(
            typeof body.password === "string" ? body.password : ""
        );
        const expected = Buffer.from(ADMIN_PASSWORD);
        if (
            submitted.length !== expected.length ||
            !crypto.timingSafeEqual(submitted, expected)
        ) {
            return sendJson(response, 401, { error: "Incorrect store password." });
        }
        const token = crypto.randomBytes(32).toString("hex");
        sessions.set(token, Date.now() + ADMIN_SESSION_MS);
        return sendJson(response, 200, { token });
    }

    if (pathname.startsWith("/api/admin/")) {
        requireAdmin(request);

        if (pathname === "/api/admin/logout" && method === "POST") {
            const token = (request.headers.authorization || "")
                .replace(/^Bearer\s+/i, "");
            sessions.delete(token);
            return sendJson(response, 200, { status: "signed out" });
        }

        if (pathname === "/api/admin/inventory" && method === "GET") {
            return sendJson(response, 200, {
                products: productQuery.all(),
                movements: database.prepare(`
                    SELECT m.id, m.product_id, p.name, m.movement_type,
                           m.quantity_change, m.stock_after, m.reference, m.reason, m.created_at
                    FROM inventory_movements m
                    JOIN products p ON p.id = m.product_id
                    ORDER BY m.id DESC
                    LIMIT 20
                `).all()
            });
        }

        if (pathname === "/api/admin/inventory/adjust" && method === "POST") {
            const body = await readJson(request);
            const productId = Number(body.productId);
            if (!Number.isSafeInteger(productId) || productId < 1) {
                throw Object.assign(new Error("Choose a valid product."), {
                    statusCode: 400
                });
            }
            return sendJson(response, 200, adjustInventory(productId, body));
        }

        if (pathname === "/api/admin/products" && method === "POST") {
            const body = await readJson(request);
            return sendJson(response, 201, addProduct(body));
        }

        if (pathname === "/api/admin/orders" && method === "GET") {
            const page = Number(url.searchParams.get("page") || 1);
            if (
                !Number.isSafeInteger(page) ||
                page < 1 ||
                page > Math.floor(Number.MAX_SAFE_INTEGER / 50)
            ) {
                throw Object.assign(new Error("Choose a valid order-history page."), {
                    statusCode: 400
                });
            }
            return sendJson(response, 200, getAdminOrders(page));
        }

        const statusMatch = pathname.match(/^\/api\/admin\/orders\/(\d+)\/status$/);
        if (statusMatch && method === "PATCH") {
            const body = await readJson(request);
            return sendJson(
                response,
                200,
                updateOrderStatus(Number(statusMatch[1]), body.status)
            );
        }
    }

    return sendJson(response, 404, { error: "Not found." });
}

const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".sql": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml"
};

function serveStatic(response, url) {
    let pathname;
    try {
        pathname = decodeURIComponent(url.pathname);
    } catch {
        return sendJson(response, 400, { error: "Invalid URL path." });
    }
    if (pathname === "/") pathname = "/index.html";
    const publicFiles = new Set(["index.html", "script.js", "style.css"]);
    const relativePath = pathname.replace(/^\/+/, "");
    if (!publicFiles.has(relativePath)) {
        return sendJson(response, 404, { error: "Not found." });
    }
    const filePath = path.join(ROOT, relativePath);

    fs.readFile(filePath, (error, contents) => {
        if (error) {
            sendJson(response, 404, { error: "Not found." });
            return;
        }
        response.writeHead(200, {
            "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
            "X-Content-Type-Options": "nosniff"
        });
        response.end(contents);
    });
}

const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
        handleApi(request, response, url).catch((error) => {
            const statusCode = error.statusCode || 500;
            if (statusCode >= 500) console.error(error);
            if (!response.headersSent) {
                sendJson(response, statusCode, {
                    error: statusCode >= 500
                        ? "The store could not complete that request."
                        : error.message
                });
            } else {
                response.destroy();
            }
        });
        return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
        return sendJson(response, 405, { error: "Method not allowed." });
    }
    serveStatic(response, url);
});

server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
        console.error(
            `Port ${PORT} is already in use on ${HOST}. ` +
            "Stop the other store server with Ctrl+C in its terminal, " +
            "then run npm start again. To use a different port instead, " +
            "set $env:PORT to an unused port before npm start."
        );
        process.exitCode = 1;
        return;
    }

    console.error("The store server could not start.", error);
    process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
    const address = server.address();
    console.log(`Store server listening on http://${HOST}:${address.port}`);
});
